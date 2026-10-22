import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "../db.js";
import { storage } from "../storage/index.js";
import { assembleVideo } from "../media/assemble.js";
import { defaultCard } from "../media/cards.js";
import { pickMusic, sfxLibrary } from "../media/library.js";
import { hashOf } from "../util/crypto.js";
import { logger } from "../util/log.js";
import { localCopy, loadItem, targetsFor, workDir } from "./common.js";

const log = logger("assemble");

/** Stage 5 — final MP4 for the item. */
export async function runAssembleStage(itemId: string): Promise<void> {
  const item = await loadItem(itemId);
  const targets = await targetsFor(item.type);
  const missing = item.shots.filter((s) => !s.clipKey);
  if (missing.length) throw new Error(`shots missing clips: ${missing.map((s) => s.idx).join(", ")}`);

  const runHash = hashOf(item.shots.map((s) => [s.clipHash, s.audioHash, s.sfx, s.dialogueHi])).slice(0, 10);
  const dir = await workDir(itemId, `assemble-${runHash}`);
  const shots = await Promise.all(
    item.shots.map(async (s) => ({
      clipPath: await localCopy(itemId, s.clipKey!),
      audioPath: s.audioKey ? await localCopy(itemId, s.audioKey) : null,
      audioSeconds: s.audioSeconds,
      durationSec: s.durationSec!,
      location: s.location,
      dialogue: s.dialogueHi,
      speaker: s.speaker,
      sfx: s.sfx,
    })),
  );

  const ch = item.channel;
  const isShort = item.type === "SHORT";
  // Shorts open directly on the hook (no intro) and get a 2s end card only.
  const intro = isShort ? null : ch.introClipKey ? await localCopy(itemId, ch.introClipKey) : await defaultCard("intro", ch.name, targets.width, targets.height, targets.fps);
  const outro = ch.outroClipKey && !isShort ? await localCopy(itemId, ch.outroClipKey) : await defaultCard("outro", ch.name, targets.width, targets.height, targets.fps);
  const outPath = path.join(dir, `${item.type.toLowerCase()}-${itemId}.mp4`);

  const result = await assembleVideo({
    shots,
    width: targets.width,
    height: targets.height,
    fps: targets.fps,
    workDir: dir,
    outPath,
    musicPath: await pickMusic(ch.musicPack, itemId),
    sfxLibrary: await sfxLibrary(),
    introPath: intro,
    outroPath: outro,
    subtitles: ch.subtitlesEnabled,
    crossfadeSec: 0.5,
    maxMainSec: isShort ? 56 : undefined,
  });

  const key = `items/${itemId}/video-${runHash}.mp4`;
  await storage().putFile(key, outPath, "video/mp4");
  await prisma.contentItem.update({ where: { id: itemId }, data: { videoKey: key, durationSec: result.durationSec } });
  log.info(`assembled ${(result.durationSec / 60).toFixed(2)} min video`, { itemId, key });
  // free intermediate scene files; keep the final mp4 locally for publishing
  for (const f of await fs.readdir(dir)) if (/^scene-\d+\.mp4$/.test(f)) await fs.rm(path.join(dir, f), { force: true });
}
