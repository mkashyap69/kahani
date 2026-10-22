import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { stageForStatus, type Stage } from "../domain/status.js";
import { enqueueStage } from "../queue.js";
import type { Script } from "../domain/script.js";
import { setStatus } from "./common.js";

/** Retry the stage an item failed at. Completed shots are kept, so only the failed work is redone. */
export async function retryItem(itemId: string) {
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.status !== "FAILED" || !item.failedStage) throw new Error("item has not failed");
  const stage = stageForStatus(item.failedStage);
  if (!stage) throw new Error(`cannot retry from ${item.failedStage}`);
  await enqueueStage(itemId, stage);
  return stage;
}

/** Re-run the pipeline from a stage (unchanged shots are skipped by hash). */
export async function rerunFrom(itemId: string, stage: Stage) {
  await prisma.contentItem.update({ where: { id: itemId }, data: { videoKey: stage === "publish" ? undefined : null } });
  await enqueueStage(itemId, stage);
}

export async function approveItem(itemId: string) {
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.status !== "REVIEW") throw new Error(`only items in REVIEW can be approved (is ${item.status})`);
  if (!item.videoKey) throw new Error("no video to publish");
  await enqueueStage(itemId, "publish");
}

export async function rejectItem(itemId: string, note?: string) {
  await setStatus(itemId, "REJECTED", { reviewNote: note ?? null });
}

export interface ShotPatch {
  dialogueHi?: string | null;
  speaker?: string | null;
  action?: string;
  imagePromptEn?: string;
  emotion?: string;
  framing?: string;
  sfx?: string | null;
  charactersInFrame?: string[];
  location?: string;
}

const VISUAL: (keyof ShotPatch)[] = ["action", "imagePromptEn", "emotion", "framing", "charactersInFrame", "location"];
const AUDIO: (keyof ShotPatch)[] = ["dialogueHi", "speaker"];

/** Edit one line of the script. Only the affected shots are regenerated downstream. */
export async function updateShot(itemId: string, idx: number, patch: ShotPatch, opts: { rerun?: boolean } = { rerun: true }) {
  const shot = await prisma.shot.findUniqueOrThrow({ where: { contentItemId_idx: { contentItemId: itemId, idx } } });
  const changed = (Object.keys(patch) as (keyof ShotPatch)[]).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify((shot as Record<string, unknown>)[k]));
  if (!changed.length) return null;
  await prisma.shot.update({ where: { id: shot.id }, data: patch as Prisma.ShotUpdateInput });

  // keep script_json in sync (it's the source of truth for metadata/teasers)
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: itemId } });
  const script = item.scriptJson as unknown as Script | null;
  const s = script?.shots.find((x) => x.id === idx);
  if (script && s) {
    if (patch.dialogueHi !== undefined) s.dialogue_hi = patch.dialogueHi ?? "";
    if (patch.speaker !== undefined) s.speaker = patch.speaker;
    if (patch.action !== undefined) s.action = patch.action;
    if (patch.imagePromptEn !== undefined) s.image_prompt_en = patch.imagePromptEn;
    if (patch.emotion !== undefined) s.emotion = patch.emotion;
    if (patch.framing !== undefined) s.framing = patch.framing as Script["shots"][number]["framing"];
    if (patch.sfx !== undefined) s.sfx = patch.sfx;
    if (patch.charactersInFrame !== undefined) s.characters_in_frame = patch.charactersInFrame;
    if (patch.location !== undefined) s.location = patch.location;
    await prisma.contentItem.update({ where: { id: itemId }, data: { scriptJson: script as unknown as Prisma.InputJsonValue } });
  }

  const from: Stage = changed.some((k) => VISUAL.includes(k)) ? "images" : changed.some((k) => AUDIO.includes(k)) ? "voices" : "assemble";
  if (opts.rerun !== false && item.status !== "QUEUED" && item.status !== "SCRIPTING") await rerunFrom(itemId, from);
  return from;
}

/** Force a new image or voice take for one shot, then rebuild the video. */
export async function regenerateShot(itemId: string, idx: number, what: "image" | "voice") {
  const shot = await prisma.shot.findUniqueOrThrow({ where: { contentItemId_idx: { contentItemId: itemId, idx } } });
  if (what === "image") {
    await prisma.shot.update({ where: { id: shot.id }, data: { variant: { increment: 1 }, imageKey: null, imageHash: null } });
    await rerunFrom(itemId, "images");
  } else {
    if (shot.audioHash) await prisma.assetCache.deleteMany({ where: { hash: shot.audioHash } });
    await prisma.shot.update({ where: { id: shot.id }, data: { audioKey: null, audioHash: null } });
    await rerunFrom(itemId, "voices");
  }
}

export async function updateYoutubeMeta(itemId: string, meta: { title: string; description: string; tags: string[] }) {
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: itemId } });
  const current = (item.youtubeMeta ?? {}) as Record<string, unknown>;
  await prisma.contentItem.update({
    where: { id: itemId },
    data: { youtubeMeta: { ...current, title: meta.title.slice(0, 100), description: meta.description.slice(0, 5000), tags: meta.tags } as Prisma.InputJsonValue },
  });
}
