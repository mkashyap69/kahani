import path from "node:path";
import { prisma } from "../db.js";
import { storage } from "../storage/index.js";
import { motionProvider } from "../providers/registry.js";
import { KenBurnsProvider } from "../providers/motion.js";
import { hashOf } from "../util/crypto.js";
import { errMsg, logger } from "../util/log.js";
import { mapLimit } from "../util/retry.js";
import { getSettings } from "../settings.js";
import { localCopy, loadItem, PartialStageError, shotKey, targetsFor, workDir } from "./common.js";

const log = logger("motion");

/** Stage 4 — turn each still into a clip of exactly the shot's duration (Ken Burns, or lip-sync for close-ups). */
export async function runMotionStage(itemId: string): Promise<void> {
  const item = await loadItem(itemId);
  const settings = await getSettings();
  const targets = await targetsFor(item.type);
  const provider = await motionProvider(item.channel.motionProvider, item.channel.motionScope);
  const kenBurns = new KenBurnsProvider();
  const dir = await workDir(itemId, "clips");

  const missing = item.shots.filter((s) => !s.imageKey || !s.durationSec);
  if (missing.length) throw new Error(`shots missing image/duration: ${missing.map((s) => s.idx).join(", ")}`);

  const { errors } = await mapLimit(item.shots, settings.motionConcurrency, async (shot) => {
    const speaking = !!shot.audioKey && shot.speaker !== "narrator";
    const p = provider.handles({ framing: shot.framing, speaking, contentType: item.type }) ? provider : kenBurns;
    const hash = hashOf({
      image: shot.imageHash,
      audio: p === kenBurns ? null : shot.audioHash,
      d: shot.durationSec,
      framing: shot.framing,
      provider: p.name,
      w: targets.width,
      h: targets.height,
      fps: targets.fps,
      v: 2,
    });
    if (shot.clipKey && shot.clipHash === hash) return;
    const out = path.join(dir, `${String(shot.idx).padStart(4, "0")}-${hash.slice(0, 8)}.mp4`);
    await p.animate(
      {
        imagePath: await localCopy(itemId, shot.imageKey!),
        audioPath: shot.audioKey ? await localCopy(itemId, shot.audioKey) : null,
        outPath: out,
        durationSec: shot.durationSec!,
        framing: shot.framing,
        speaking,
        width: targets.width,
        height: targets.height,
        fps: targets.fps,
        seed: shot.idx,
        contentType: item.type,
        prompt: [shot.action, `Emotion: ${shot.emotion}.`, shot.speaker && shot.speaker !== "narrator" ? `${shot.speaker} is speaking.` : ""].filter(Boolean).join(" "),
      },
      { contentItemId: itemId, operation: "motion" },
    );
    const key = shotKey(itemId, shot.idx, "clips", hash, "mp4");
    await storage().putFile(key, out, "video/mp4");
    await prisma.shot.update({ where: { id: shot.id }, data: { clipKey: key, clipHash: hash, error: null } });
  });
  for (const e of errors) await prisma.shot.update({ where: { id: item.shots[e.index].id }, data: { error: errMsg(e.error) } });
  if (errors.length) throw new PartialStageError("motion", errors.map((e) => ({ idx: item.shots[e.index].idx, error: errMsg(e.error) })));
  log.info(`animated ${item.shots.length} shots with ${provider.name}`, { itemId });
}
