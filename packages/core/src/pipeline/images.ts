import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { storage } from "../storage/index.js";
import { imageBatchProviderFor, imageProviderFor, visionJudge } from "../providers/registry.js";
import { imageModelInfo, modelForShot } from "../providers/image-models.js";
import { logApiCall } from "../cost.js";
import { config } from "../config.js";
import { Prisma } from "@prisma/client";
import { composeShotPrompt, thumbnailPrompt } from "../prompts/image.js";
import { hashOf } from "../util/crypto.js";
import { errMsg, logger } from "../util/log.js";
import { mapLimit } from "../util/retry.js";
import { getSettings } from "../settings.js";
import { renderThumbnail } from "../media/subtitles.js";
import type { Script } from "../domain/script.js";
import type { ImageProvider, VisionJudge } from "../providers/types.js";
import { loadItem, PartialStageError, shotKey, StageDeferred, targetsFor, workDir, type LoadedItem } from "./common.js";
import { ensureReferences } from "./references.js";

const log = logger("images");

type ShotRow = LoadedItem["shots"][number];

/** Everything that determines a shot's image. Same inputs → same hash → reuse (no re-paying). */
export function shotImageSpec(item: LoadedItem, shot: ShotRow, aspect: "16:9" | "9:16", model: string) {
  const theme = item.channel.theme;
  const chars = shot.charactersInFrame.map((k) => theme.characters.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
  const location = theme.locations.find((l) => l.key === shot.location);
  const prompt = composeShotPrompt(
    theme,
    { framing: shot.framing, timeOfDay: shot.timeOfDay, action: shot.action, emotion: shot.emotion, imagePromptEn: shot.imagePromptEn, location, characters: chars },
    aspect,
  );
  // first sheet image (turnaround) per character keeps the request small; location plate last
  const refs = [
    ...chars.flatMap((c) => (c.referenceImages[0] ? [{ key: c.referenceImages[0], label: `${c.name} character sheet` }] : [])),
    ...(location?.referenceImage ? [{ key: location.referenceImage, label: `${location.name} location` }] : []),
  ].slice(0, 6);
  const hash = hashOf({ prompt, refs: refs.map((r) => r.key), aspect, model, variant: shot.variant });
  return { prompt, refs, hash, chars, location };
}

async function loadRefs(refs: { key: string; label: string }[]) {
  return Promise.all(refs.map(async (r) => ({ mime: "image/png", data: await storage().get(r.key), label: r.label })));
}

/** Generate one shot image with a given model (consistency check + retries when a judge is passed). */
export async function generateShotImage(
  item: LoadedItem,
  shot: ShotRow,
  modelId: string,
  aspect: "16:9" | "9:16",
  ctx: { contentItemId?: string | null; operation?: string },
  judge?: VisionJudge | null,
  threshold = 6,
) {
  const spec = shotImageSpec(item, shot, aspect, modelId);
  const provider = await imageProviderFor(modelId);
  const refs = await loadRefs(spec.refs);
  let best: { data: Buffer; mime: string; score: number | null } | null = null;
  for (let attempt = 0; attempt <= (judge ? 2 : 0); attempt++) {
    const img = await provider.generate(
      {
        prompt: attempt ? `${spec.prompt}\nIMPORTANT: match the reference sheets exactly (faces, outfits, colours).` : spec.prompt,
        references: refs,
        aspect,
        meta: shotMeta(shot),
      },
      { contentItemId: ctx.contentItemId, operation: `${ctx.operation ?? "shot-image"}${attempt ? "-retry" : ""}` },
    );
    if (!judge || !spec.chars.length) return { ...img, score: null, spec };
    const { score } = await judge.scoreConsistency(img.data, refs.filter((r) => !r.label.endsWith("location")), shot.action, { contentItemId: ctx.contentItemId });
    if (!best || score > (best.score ?? 0)) best = { ...img, score };
    if (score >= threshold) break;
    log.info(`shot ${shot.idx} consistency ${score} < ${threshold}, regenerating`, { itemId: item.id });
  }
  return { ...best!, spec };
}

const shotMeta = (shot: ShotRow) => ({ characters: shot.charactersInFrame, location: shot.location, emotion: shot.emotion, title: `#${shot.idx} ${shot.location} · ${shot.framing}` });

async function saveShotImage(itemId: string, shot: ShotRow, hash: string, img: { data: Buffer; mime: string; score?: number | null }) {
  const key = shotKey(itemId, shot.idx, "images", hash, img.mime.includes("jpeg") ? "jpg" : "png");
  await storage().put(key, img.data, img.mime);
  await prisma.assetCache.upsert({ where: { hash }, update: { key }, create: { hash, kind: "image", key } });
  await prisma.shot.update({ where: { id: shot.id }, data: { imageKey: key, imageHash: hash, consistencyScore: img.score ?? null, error: null } });
}

interface BatchState {
  submittedAt: string;
  jobs: { job: string; model: string; keys: Record<string, number> }[];
}

const BATCH_POLL_MS = () => Number(process.env.IMAGE_BATCH_POLL_SEC ?? 120) * 1000;
const BATCH_MAX_MS = () => Number(process.env.IMAGE_BATCH_MAX_HOURS ?? 20) * 3600_000;

/**
 * Stage 2 — one image per shot (+ thumbnail) with the channel's model for that shot type.
 * Only missing/changed shots are generated. With batch mode on, Gemini shots go through the Batch API:
 * the stage submits, defers itself, and on a later run collects the results (falling back to standard
 * calls for anything that failed or took too long).
 */
export async function runImagesStage(itemId: string): Promise<void> {
  let item = await loadItem(itemId);
  await ensureReferences(item.channel.themeId);
  item = await loadItem(itemId);

  const settings = await getSettings();
  const targets = await targetsFor(item.type);
  const judge = settings.consistencyCheck ? await visionJudge() : null;
  const models = item.channel.imageModels;
  const plan = item.shots.map((shot) => {
    const model = modelForShot(models, shot.framing, { characters: shot.charactersInFrame.length });
    return { shot, model, spec: shotImageSpec(item, shot, targets.aspect, model) };
  });
  let todo = plan.filter((p) => !p.shot.imageKey || p.shot.imageHash !== p.spec.hash);

  // 1) reuse cached assets (same prompt + refs + model → no re-paying)
  const remaining: typeof todo = [];
  for (const p of todo) {
    const cached = await prisma.assetCache.findUnique({ where: { hash: p.spec.hash } });
    if (cached && (await storage().exists(cached.key))) {
      await prisma.shot.update({ where: { id: p.shot.id }, data: { imageKey: cached.key, imageHash: p.spec.hash, error: null } });
    } else remaining.push(p);
  }
  todo = remaining;

  // 2) collect / submit Gemini batches
  const syncTodo: typeof todo = [];
  const state = item.imageBatch as unknown as BatchState | null;
  if (state?.jobs?.length) {
    const age = Date.now() - new Date(state.submittedAt).getTime();
    const pending: BatchState["jobs"] = [];
    for (const j of state.jobs) {
      const batch = await imageBatchProviderFor(j.model);
      const res = await batch.poll(j.job);
      if (!res.done) {
        if (age > BATCH_MAX_MS()) {
          log.warn(`batch ${j.job} still ${res.state} after ${(age / 3600_000).toFixed(1)}h — cancelling, using standard calls`, { itemId });
          await batch.cancel(j.job);
        } else pending.push(j);
        continue;
      }
      if (res.failed !== undefined) {
        log.warn(`batch ${j.job} failed (${res.failed}) — using standard calls`, { itemId });
        continue;
      }
      let ok = 0;
      for (const [k, out] of res.results) {
        const idx = j.keys[k];
        const p = todo.find((t) => t.shot.idx === idx && t.model === j.model);
        if (!p || "error" in out) continue;
        let img: { data: Buffer; mime: string; score?: number | null } = out;
        if (judge && p.spec.chars.length) {
          const refs = (await loadRefs(p.spec.refs)).filter((r) => !r.label.endsWith("location"));
          const { score } = await judge.scoreConsistency(out.data, refs, p.shot.action, { contentItemId: itemId });
          if (score < settings.consistencyThreshold) continue; // regenerated below with standard calls
          img = { ...out, score };
        }
        await saveShotImage(itemId, p.shot, p.spec.hash, img);
        ok++;
      }
      const info = imageModelInfo(j.model);
      const real = !batch.name.startsWith("mock");
      await logApiCall({
        contentItemId: itemId,
        provider: real ? "gemini" : batch.name,
        model: j.model.split(":")[1],
        operation: "shot-image-batch",
        images: ok,
        costInr: real ? ok * (info.batchUsd ?? info.usd) * config.usdToInr : 0,
      });
      log.info(`batch ${j.job}: ${ok}/${Object.keys(j.keys).length} images`, { itemId });
    }
    await prisma.contentItem.update({ where: { id: itemId }, data: { imageBatch: pending.length ? ({ ...state, jobs: pending } as object) : Prisma.DbNull } });
    item = await loadItem(itemId);
    const done = new Set(item.shots.filter((s) => s.imageKey).map((s) => s.idx));
    todo = todo.filter((t) => !done.has(t.shot.idx) || item.shots.find((s) => s.idx === t.shot.idx)?.imageHash !== t.spec.hash);
    if (pending.length) {
      const waiting = new Set(pending.flatMap((j) => Object.values(j.keys)));
      syncTodo.push(...todo.filter((t) => !waiting.has(t.shot.idx)));
      await runSync(item, syncTodo, targets.aspect, judge, settings);
      throw new StageDeferred(`waiting for ${pending.length} Gemini batch job(s)`, BATCH_POLL_MS());
    }
    syncTodo.push(...todo); // whatever the batch didn't deliver
  } else if (item.channel.imageBatch) {
    const byModel = new Map<string, typeof todo>();
    for (const t of todo) {
      if (imageModelInfo(t.model).provider === "gemini") byModel.set(t.model, [...(byModel.get(t.model) ?? []), t]);
      else syncTodo.push(t);
    }
    const jobs: BatchState["jobs"] = [];
    for (const [model, list] of byModel) {
      const requests = await Promise.all(
        list.map(async (t) => ({ key: `s${t.shot.idx}-${t.spec.hash.slice(0, 8)}`, prompt: t.spec.prompt, references: await loadRefs(t.spec.refs), aspect: targets.aspect, meta: shotMeta(t.shot) })),
      );
      const job = await (await imageBatchProviderFor(model)).submit(requests, itemId);
      jobs.push({ job, model, keys: Object.fromEntries(requests.map((r, i) => [r.key, list[i].shot.idx])) });
      log.info(`submitted Gemini batch with ${requests.length} images (${model})`, { itemId, job });
    }
    if (jobs.length) {
      await prisma.contentItem.update({ where: { id: itemId }, data: { imageBatch: { submittedAt: new Date().toISOString(), jobs } as object } });
      await runSync(item, syncTodo, targets.aspect, judge, settings);
      throw new StageDeferred(`submitted ${jobs.length} Gemini batch job(s)`, Math.min(BATCH_POLL_MS(), 30_000));
    }
  } else syncTodo.push(...todo);

  // 3) standard (synchronous) calls
  await runSync(item, syncTodo, targets.aspect, judge, settings);
  await generateThumbnail(item, await imageProviderFor(modelForShot(models, "thumbnail", { characters: 1 })), targets);
}

async function runSync(
  item: LoadedItem,
  todo: { shot: ShotRow; model: string; spec: ReturnType<typeof shotImageSpec> }[],
  aspect: "16:9" | "9:16",
  judge: VisionJudge | null,
  settings: Awaited<ReturnType<typeof getSettings>>,
) {
  if (!todo.length) return;
  log.info(`generating ${todo.length}/${item.shots.length} shot images`, { itemId: item.id, models: [...new Set(todo.map((t) => t.model))] });
  const { errors } = await mapLimit(todo, settings.imageConcurrency, async (t) => {
    const img = await generateShotImage(item, t.shot, t.model, aspect, { contentItemId: item.id }, judge, settings.consistencyThreshold);
    await saveShotImage(item.id, t.shot, t.spec.hash, img);
  });
  for (const e of errors) await prisma.shot.update({ where: { id: todo[e.index].shot.id }, data: { error: errMsg(e.error) } });
  if (errors.length) throw new PartialStageError("images", errors.map((e) => ({ idx: todo[e.index].shot.idx, error: errMsg(e.error) })));
}

async function generateThumbnail(item: LoadedItem, provider: ImageProvider, targets: Awaited<ReturnType<typeof targetsFor>>) {
  const script = item.scriptJson as unknown as Script;
  const meta = (item.youtubeMeta ?? script.youtube) as Script["youtube"];
  const theme = item.channel.theme;
  // main character = most frequent speaker
  const counts = new Map<string, number>();
  for (const s of item.shots) if (s.speaker && s.speaker !== "narrator") counts.set(s.speaker, (counts.get(s.speaker) ?? 0) + 1);
  const mainKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const main = theme.characters.find((c) => c.key === mainKey);
  const prompt = thumbnailPrompt(theme, main, meta.thumbnail_prompt, targets.aspect);
  const refs = main?.referenceImages.length ? await loadRefs([{ key: main.referenceImages[main.referenceImages.length - 1], label: `${main.name} expressions` }]) : [];
  const title = item.title ?? script.title_hi;
  const hash = hashOf({ prompt, title, refs: main?.referenceImages, aspect: targets.aspect, model: provider.model, kind: "thumb" });
  const fresh = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id }, select: { thumbnailKey: true } });
  if (fresh.thumbnailKey?.includes(hash.slice(0, 10))) return;

  const img = await provider.generate(
    { prompt, references: refs, aspect: targets.aspect, meta: { kind: "thumbnail", characters: main ? [main.key] : [], emotion: "surprised", title: "thumbnail" } },
    { contentItemId: item.id, operation: "thumbnail" },
  );
  const dir = await workDir(item.id, "thumb");
  const raw = path.join(dir, `raw-${hash.slice(0, 10)}.png`);
  await fs.writeFile(raw, img.data);
  const [w, h] = targets.aspect === "9:16" ? [1080, 1920] : [1280, 720];
  const out = path.join(dir, `thumb-${hash.slice(0, 10)}.jpg`);
  await renderThumbnail(raw, title, out, w, h);
  const key = `items/${item.id}/thumbnail-${hash.slice(0, 10)}.jpg`;
  await storage().putFile(key, out, "image/jpeg");
  await prisma.contentItem.update({ where: { id: item.id }, data: { thumbnailKey: key } });
}
