import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { storage } from "../storage/index.js";
import { imageProvider, visionJudge } from "../providers/registry.js";
import { composeShotPrompt, thumbnailPrompt } from "../prompts/image.js";
import { hashOf } from "../util/crypto.js";
import { errMsg, logger } from "../util/log.js";
import { mapLimit } from "../util/retry.js";
import { getSettings } from "../settings.js";
import { renderThumbnail } from "../media/subtitles.js";
import type { Script } from "../domain/script.js";
import type { ImageProvider } from "../providers/types.js";
import { loadItem, PartialStageError, shotKey, targetsFor, workDir, type LoadedItem } from "./common.js";
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

/** Stage 2 — one Nano Banana image per shot (+ thumbnail). Only missing/changed shots are generated. */
export async function runImagesStage(itemId: string): Promise<void> {
  let item = await loadItem(itemId);
  await ensureReferences(item.channel.themeId);
  item = await loadItem(itemId);

  const settings = await getSettings();
  const targets = await targetsFor(item.type);
  const provider = await imageProvider();
  const judge = settings.consistencyCheck ? await visionJudge() : null;

  const todo = item.shots.filter((s) => !s.imageKey || s.imageHash !== shotImageSpec(item, s, targets.aspect, provider.model).hash);
  log.info(`generating ${todo.length}/${item.shots.length} shot images`, { itemId });

  const { errors } = await mapLimit(todo, settings.imageConcurrency, async (shot) => {
    const spec = shotImageSpec(item, shot, targets.aspect, provider.model);
    const cached = await prisma.assetCache.findUnique({ where: { hash: spec.hash } });
    if (cached && (await storage().exists(cached.key))) {
      await prisma.shot.update({ where: { id: shot.id }, data: { imageKey: cached.key, imageHash: spec.hash, error: null } });
      return;
    }
    const refs = await loadRefs(spec.refs);
    let best: { data: Buffer; mime: string; score: number | null } | null = null;
    for (let attempt = 0; attempt <= (judge ? 2 : 0); attempt++) {
      const img = await provider.generate(
        {
          prompt: attempt ? `${spec.prompt}\nIMPORTANT: match the reference sheets exactly (faces, outfits, colours).` : spec.prompt,
          references: refs,
          aspect: targets.aspect,
          meta: { characters: shot.charactersInFrame, location: shot.location, emotion: shot.emotion, title: `#${shot.idx} ${shot.location} · ${shot.framing}` },
        },
        { contentItemId: itemId, operation: `shot-image${attempt ? "-retry" : ""}` },
      );
      if (!judge || !spec.chars.length) {
        best = { ...img, score: null };
        break;
      }
      const charRefs = refs.filter((r) => !r.label.endsWith("location"));
      const { score } = await judge.scoreConsistency(img.data, charRefs, shot.action, { contentItemId: itemId });
      if (!best || score > (best.score ?? 0)) best = { ...img, score };
      if (score >= settings.consistencyThreshold) break;
      log.info(`shot ${shot.idx} consistency ${score} < ${settings.consistencyThreshold}, regenerating`, { itemId });
    }
    const key = shotKey(itemId, shot.idx, "images", spec.hash, best!.mime.includes("jpeg") ? "jpg" : "png");
    await storage().put(key, best!.data, best!.mime);
    await prisma.assetCache.upsert({ where: { hash: spec.hash }, update: { key }, create: { hash: spec.hash, kind: "image", key } });
    await prisma.shot.update({ where: { id: shot.id }, data: { imageKey: key, imageHash: spec.hash, consistencyScore: best!.score, error: null } });
  });

  for (const e of errors) await prisma.shot.update({ where: { id: todo[e.index].id }, data: { error: errMsg(e.error) } });
  if (errors.length) throw new PartialStageError("images", errors.map((e) => ({ idx: todo[e.index].idx, error: errMsg(e.error) })));

  await generateThumbnail(item, provider, targets);
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
