import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { storage } from "../storage/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { imageModelInfo, SHOT_KINDS, type ShotKind } from "../providers/image-models.js";
import { imageCostUsd } from "../providers/fal-image.js";
import { videoModelInfo, videoUsdPerSec } from "../providers/video-models.js";
import { motionProvider } from "../providers/registry.js";
import { ImageToVideoProvider } from "../providers/i2v.js";
import { localCopy, workDir } from "./common.js";
import { errMsg, logger } from "../util/log.js";
import { mapLimit } from "../util/retry.js";
import { loadItem, targetsFor } from "./common.js";
import { generateShotImage } from "./images.js";
import { ensureReferences } from "./references.js";

const log = logger("compare");

export interface ComparisonResult {
  model: string;
  idx: number;
  key?: string;
  costInr: number;
  ms: number;
  error?: string;
  /** offline/no-key run: a placeholder was used, cost is the list-price estimate */
  fallback?: boolean;
}

/** Pick up to n shots spread across the episode, preferring a mix of framings. */
export function pickShots(shots: { idx: number; framing: string; charactersInFrame: string[] }[], n = 10): number[] {
  const withChars = shots.filter((s) => s.charactersInFrame.length);
  const pool = withChars.length >= n ? withChars : shots;
  if (pool.length <= n) return pool.map((s) => s.idx);
  const picked: number[] = [];
  const seenFraming = new Set<string>();
  // first: one of each framing, then evenly spaced
  for (const s of pool) if (!seenFraming.has(s.framing)) (seenFraming.add(s.framing), picked.push(s.idx));
  for (let i = 0; picked.length < n && i < n * 3; i++) {
    const s = pool[Math.floor((i * pool.length) / (n * 3))];
    if (!picked.includes(s.idx)) picked.push(s.idx);
  }
  return picked.slice(0, n).sort((a, b) => a - b);
}

/** Video comparisons sample dialogue close-ups that already have an image. */
export function pickVideoShots(shots: { idx: number; framing: string; speaker: string | null; imageKey: string | null }[], n = 5): number[] {
  const ready = shots.filter((s) => s.imageKey);
  const talking = ready.filter((s) => s.speaker && s.speaker !== "narrator");
  const close = talking.filter((s) => s.framing === "closeup");
  const pool = [...close, ...talking.filter((s) => !close.includes(s)), ...ready.filter((s) => !talking.includes(s))];
  return pool.slice(0, n).map((s) => s.idx).sort((a, b) => a - b);
}

export async function createComparison(contentItemId: string, models: string[], shotIdxs?: number[], kind: "image" | "video" = "image") {
  if (models.length < 2 || models.length > 4) throw new Error("choose 2–4 models to compare");
  models.forEach((m) => (kind === "video" ? videoModelInfo(m) : imageModelInfo(m))); // validates ids
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId }, include: { shots: { orderBy: { idx: "asc" } } } });
  if (!item.shots.length) throw new Error("this item has no script/shots yet");
  if (kind === "video" && !item.shots.some((s) => s.imageKey)) throw new Error("this item has no shot images yet — run its image stage first");
  const max = kind === "video" ? 5 : 10;
  const idxs = shotIdxs?.length ? shotIdxs.slice(0, max) : kind === "video" ? pickVideoShots(item.shots, 5) : pickShots(item.shots, 10);
  return prisma.imageComparison.create({ data: { contentItemId, models, shotIdxs: idxs, kind } });
}

/** Generate the same shots with every model (same prompt + reference sheets), recording cost and time. */
export async function runComparison(comparisonId: string) {
  const cmp = await prisma.imageComparison.update({ where: { id: comparisonId }, data: { status: "running", error: null, results: [] } });
  if (cmp.kind === "video") return runVideoComparison(comparisonId);
  try {
    const item0 = await loadItem(cmp.contentItemId);
    await ensureReferences(item0.channel.themeId);
    const item = await loadItem(cmp.contentItemId);
    const targets = await targetsFor(item.type);
    const shots = item.shots.filter((s) => cmp.shotIdxs.includes(s.idx));
    const results: ComparisonResult[] = [];
    const save = () => prisma.imageComparison.update({ where: { id: comparisonId }, data: { results: results as unknown as Prisma.InputJsonValue } });
    const jobs = cmp.models.flatMap((model) => shots.map((shot) => ({ model, shot })));
    await mapLimit(jobs, 4, async ({ model, shot }) => {
      const t0 = Date.now();
      const info = imageModelInfo(model);
      try {
        const img = await generateShotImage(item, shot, model, targets.aspect, { contentItemId: null, operation: "compare" });
        const key = `compare/${comparisonId}/${model.replace(/[^a-z0-9.-]+/gi, "_")}/${String(shot.idx).padStart(4, "0")}.${img.mime.includes("jpeg") ? "jpg" : "png"}`;
        await storage().put(key, img.data, img.mime);
        results.push({ model, idx: shot.idx, key, costInr: imageCostUsd(info, Math.min(info.maxRefs, img.spec.refs.length)) * config.usdToInr, ms: Date.now() - t0 });
      } catch (err) {
        results.push({ model, idx: shot.idx, costInr: 0, ms: Date.now() - t0, error: errMsg(err).slice(0, 300) });
      }
      await save();
    });
    await prisma.imageComparison.update({ where: { id: comparisonId }, data: { status: "done" } });
    log.info(`comparison done: ${results.length} images`, { comparisonId });
  } catch (err) {
    await prisma.imageComparison.update({ where: { id: comparisonId }, data: { status: "failed", error: errMsg(err).slice(0, 2000) } });
    throw err;
  }
}

/** Use a model for a channel's shot type ("default", "closeup", …, "thumbnail"). */
export async function setChannelImageModel(channelId: string, kind: ShotKind, model: string | null) {
  if (!SHOT_KINDS.includes(kind)) throw new Error(`unknown shot kind ${kind}`);
  if (model) imageModelInfo(model);
  const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  const map = { ...((ch.imageModels as Record<string, string>) ?? {}) };
  if (model) map[kind] = model;
  else delete map[kind];
  await prisma.channel.update({ where: { id: channelId }, data: { imageModels: map } });
}

/** Animate the same shot images with every video model; record cost (list price × billed seconds) and time. */
async function runVideoComparison(comparisonId: string) {
  const cmp = await prisma.imageComparison.findUniqueOrThrow({ where: { id: comparisonId } });
  try {
    const item = await loadItem(cmp.contentItemId);
    const targets = await targetsFor(item.type);
    const shots = item.shots.filter((s) => cmp.shotIdxs.includes(s.idx) && s.imageKey);
    const dir = await workDir(item.id, "compare", comparisonId);
    const results: ComparisonResult[] = [];
    const save = () => prisma.imageComparison.update({ where: { id: comparisonId }, data: { results: results as unknown as Prisma.InputJsonValue } });
    const jobs = cmp.models.flatMap((model) => shots.map((shot) => ({ model, shot })));
    await mapLimit(jobs, 3, async ({ model, shot }) => {
      const t0 = Date.now();
      const info = videoModelInfo(model);
      const durationSec = shot.durationSec ?? Math.max(2.5, shot.estSeconds);
      const provider = await motionProvider(model, "all");
      const real = provider instanceof ImageToVideoProvider;
      const billed = Math.min(info.maxSec, Math.max(info.minSec, Math.ceil(durationSec)));
      const out = path.join(dir, `${model.replace(/[^a-z0-9.-]+/gi, "_")}-${shot.idx}.mp4`);
      try {
        await provider.animate(
          {
            imagePath: await localCopy(item.id, shot.imageKey!),
            outPath: out,
            durationSec,
            framing: shot.framing,
            speaking: !!shot.speaker && shot.speaker !== "narrator",
            width: targets.width,
            height: targets.height,
            fps: targets.fps,
            seed: shot.idx,
            contentType: item.type,
            prompt: [shot.action, `Emotion: ${shot.emotion}.`, shot.speaker && shot.speaker !== "narrator" ? `${shot.speaker} is speaking.` : ""].filter(Boolean).join(" "),
          },
          { contentItemId: null, operation: "compare" },
        );
        const key = `compare/${comparisonId}/${model.replace(/[^a-z0-9.-]+/gi, "_")}/${String(shot.idx).padStart(4, "0")}.mp4`;
        await storage().putFile(key, out, "video/mp4");
        await fs.rm(out, { force: true });
        results.push({ model, idx: shot.idx, key, costInr: videoUsdPerSec(info) * billed * config.usdToInr, ms: Date.now() - t0, fallback: !real });
      } catch (err) {
        results.push({ model, idx: shot.idx, costInr: 0, ms: Date.now() - t0, error: errMsg(err).slice(0, 300) });
      }
      await save();
    });
    await prisma.imageComparison.update({ where: { id: comparisonId }, data: { status: "done" } });
  } catch (err) {
    await prisma.imageComparison.update({ where: { id: comparisonId }, data: { status: "failed", error: errMsg(err).slice(0, 2000) } });
    throw err;
  }
}
