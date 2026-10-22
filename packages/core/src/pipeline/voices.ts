import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { storage } from "../storage/index.js";
import { ttsProvider } from "../providers/registry.js";
import { hashOf } from "../util/crypto.js";
import { errMsg, logger } from "../util/log.js";
import { mapLimit } from "../util/retry.js";
import { getSettings } from "../settings.js";
import { normalizeLoudness } from "../media/ffmpeg.js";
import { parseWav, wavDuration } from "../media/wav.js";
import { FPS, shotDuration, toFrames } from "../domain/duration.js";

/** 30s minimum short − 2s end card, with a little headroom. */
const SHORT_MIN_BODY_SEC = 28.5;
import type { TTSRequest } from "../providers/types.js";
import { loadItem, PartialStageError, shotKey, workDir, type LoadedItem } from "./common.js";

const log = logger("voices");

export function voiceFor(item: LoadedItem, speaker: string): Omit<TTSRequest, "text"> {
  const theme = item.channel.theme;
  const language = item.channel.language;
  if (speaker === "narrator") {
    return { speaker: theme.narratorSpeaker, pitch: theme.narratorPitch, pace: theme.narratorPace, loudness: theme.narratorLoudness, language };
  }
  const c = theme.characters.find((ch) => ch.key === speaker);
  if (!c) return { speaker: theme.narratorSpeaker, pitch: 0, pace: 1, loudness: 1, language };
  return { speaker: c.voiceSpeaker, pitch: c.voicePitch, pace: c.voicePace, loudness: c.voiceLoudness, language };
}

/** Stage 3 — one Sarvam Bulbul call per dialogue line, loudness-normalised to −16 LUFS, durations measured. */
export async function runVoicesStage(itemId: string): Promise<void> {
  const item = await loadItem(itemId);
  const settings = await getSettings();
  const tts = await ttsProvider();
  const dir = await workDir(itemId, "voices");

  const { errors } = await mapLimit(item.shots, settings.ttsConcurrency, async (shot) => {
    if (!shot.dialogueHi?.trim() || !shot.speaker) {
      const durationSec = shotDuration(null, shot.estSeconds);
      if (shot.audioKey || shot.durationSec !== durationSec)
        await prisma.shot.update({ where: { id: shot.id }, data: { audioKey: null, audioHash: null, audioSeconds: null, durationSec } });
      return;
    }
    const req: TTSRequest = { text: shot.dialogueHi.trim(), ...voiceFor(item, shot.speaker) };
    const hash = hashOf({ ...req, model: tts.model });
    if (shot.audioKey && shot.audioHash === hash && shot.durationSec) return;

    const cached = await prisma.assetCache.findUnique({ where: { hash } });
    if (cached && (await storage().exists(cached.key))) {
      const seconds = Number((cached.meta as { seconds?: number } | null)?.seconds ?? 0);
      await prisma.shot.update({
        where: { id: shot.id },
        data: { audioKey: cached.key, audioHash: hash, audioSeconds: seconds, durationSec: shotDuration(seconds, shot.estSeconds), error: null },
      });
      return;
    }
    const raw = await tts.synthesize(req, { contentItemId: itemId, operation: "tts" });
    const rawPath = path.join(dir, `${shot.idx}-${hash.slice(0, 8)}.raw.wav`);
    const normPath = path.join(dir, `${shot.idx}-${hash.slice(0, 8)}.wav`);
    await fs.writeFile(rawPath, raw);
    await normalizeLoudness(rawPath, normPath, -16);
    const seconds = wavDuration(parseWav(await fs.readFile(normPath)));
    const key = shotKey(itemId, shot.idx, "audio", hash, "wav");
    await storage().putFile(key, normPath, "audio/wav");
    await prisma.assetCache.upsert({ where: { hash }, update: { key, meta: { seconds } }, create: { hash, kind: "audio", key, meta: { seconds } } });
    await prisma.shot.update({
      where: { id: shot.id },
      data: { audioKey: key, audioHash: hash, audioSeconds: seconds, durationSec: shotDuration(seconds, shot.estSeconds), error: null },
    });
  });

  for (const e of errors) await prisma.shot.update({ where: { id: item.shots[e.index].id }, data: { error: errMsg(e.error) } });
  if (errors.length) throw new PartialStageError("voices", errors.map((e) => ({ idx: item.shots[e.index].idx, error: errMsg(e.error) })));

  const shots = await prisma.shot.findMany({ where: { contentItemId: itemId }, orderBy: { idx: "asc" }, select: { id: true, durationSec: true } });
  let total = shots.reduce((a, s) => a + (s.durationSec ?? 0), 0);
  // Shorts must land at ≥30s including the 2s end card: hold the last (cliffhanger) shot longer if needed.
  if (item.type === "SHORT" && total < SHORT_MIN_BODY_SEC && shots.length) {
    const last = shots[shots.length - 1];
    const extended = toFrames((last.durationSec ?? 0) + SHORT_MIN_BODY_SEC - total) / FPS;
    await prisma.shot.update({ where: { id: last.id }, data: { durationSec: extended } });
    total += extended - (last.durationSec ?? 0);
  }
  await prisma.contentItem.update({ where: { id: itemId }, data: { durationSec: total } });
  log.info(`voiced ${item.shots.length} shots, runtime ${total.toFixed(1)}s`, { itemId });
}
