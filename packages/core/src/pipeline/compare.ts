import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { storage } from "../storage/index.js";
import { imageModelInfo, SHOT_KINDS, type ShotKind } from "../providers/image-models.js";
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

export async function createComparison(contentItemId: string, models: string[], shotIdxs?: number[]) {
  if (models.length < 2 || models.length > 4) throw new Error("choose 2–4 models to compare");
  models.forEach((m) => imageModelInfo(m)); // validates ids
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId }, include: { shots: { orderBy: { idx: "asc" } } } });
  if (!item.shots.length) throw new Error("this item has no script/shots yet");
  const idxs = shotIdxs?.length ? shotIdxs.slice(0, 10) : pickShots(item.shots, 10);
  return prisma.imageComparison.create({ data: { contentItemId, models, shotIdxs: idxs } });
}

/** Generate the same shots with every model (same prompt + reference sheets), recording cost and time. */
export async function runComparison(comparisonId: string) {
  const cmp = await prisma.imageComparison.update({ where: { id: comparisonId }, data: { status: "running", error: null, results: [] } });
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
        results.push({ model, idx: shot.idx, key, costInr: info.usd * config.usdToInr, ms: Date.now() - t0 });
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
