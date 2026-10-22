import type { ContentStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { STAGE_RUNNING, type Stage } from "../domain/status.js";
import { errMsg, logger } from "../util/log.js";
import { assertBudget, setStatus, StageDeferred } from "./common.js";
import { runScriptStage } from "./script.js";
import { runImagesStage } from "./images.js";
import { runVoicesStage } from "./voices.js";
import { runMotionStage } from "./motion.js";
import { runAssembleStage } from "./assemble.js";
import { runPublishStage } from "./publish.js";

const log = logger("runner");

const STAGE_FNS: Record<Stage, (itemId: string) => Promise<void>> = {
  script: runScriptStage,
  images: runImagesStage,
  voices: runVoicesStage,
  motion: runMotionStage,
  assemble: runAssembleStage,
  publish: runPublishStage,
};

/** Stages that spend money (paused when the monthly budget is exhausted). */
const PAID: Stage[] = ["script", "images", "voices", "motion"];

export interface FollowUp {
  itemId: string;
  stage: Stage;
  /** re-run later (deferred stages, e.g. waiting on a Gemini batch) */
  delayMs?: number;
}

export function isNonRetryable(err: unknown) {
  return !!(err && typeof err === "object" && (err as { nonRetryable?: boolean }).nonRetryable);
}

/**
 * Runs one stage for one item and returns the jobs to enqueue next.
 * Stages are idempotent: re-running skips shots whose assets already match their input hash.
 * `finalAttempt` controls when a failure is recorded on the item (earlier attempts are retried by BullMQ).
 */
export async function runStage(itemId: string, stage: Stage, opts: { finalAttempt?: boolean } = {}): Promise<FollowUp[]> {
  const item = await prisma.contentItem.findUnique({ where: { id: itemId }, include: { channel: true, children: true } });
  if (!item) return [];
  if (item.status === "PUBLISHED" || item.status === "REJECTED") {
    log.info(`skip ${stage}: item is ${item.status}`, { itemId });
    return [];
  }
  const running = STAGE_RUNNING[stage];
  try {
    if (PAID.includes(stage)) await assertBudget();
    await setStatus(itemId, running);
    const t0 = Date.now();
    await STAGE_FNS[stage](itemId);
    log.info(`✔ ${stage} (${((Date.now() - t0) / 1000).toFixed(1)}s)`, { itemId, type: item.type });
  } catch (err) {
    if (err instanceof StageDeferred) {
      log.info(`… ${stage} deferred: ${err.message} (next check in ${Math.round(err.delayMs / 1000)}s)`, { itemId });
      return [{ itemId, stage, delayMs: err.delayMs }];
    }
    const final = opts.finalAttempt !== false || isNonRetryable(err);
    log.error(`✘ ${stage}: ${errMsg(err)}`, { itemId, final });
    if (final) {
      await prisma.contentItem.update({ where: { id: itemId }, data: { status: "FAILED", failedStage: running, error: errMsg(err).slice(0, 4000) } });
    }
    throw err;
  }

  const next = (to: ContentStatus) => setStatus(itemId, to);
  switch (stage) {
    case "script": {
      await next("SCRIPT_READY");
      const follow: FollowUp[] = [{ itemId, stage: "images" }];
      // teaser shorts are written from today's story script
      if (item.type === "STORY") for (const c of item.children) if (c.status === "QUEUED") follow.push({ itemId: c.id, stage: "script" });
      return follow;
    }
    case "images":
      await next("IMAGES_READY");
      return [{ itemId, stage: "voices" }];
    case "voices":
      return [{ itemId, stage: "motion" }];
    case "motion":
      return [{ itemId, stage: "assemble" }];
    case "assemble":
      if (item.channel.autoPublish) return [{ itemId, stage: "publish" }];
      await next("REVIEW");
      return [];
    case "publish":
      await next("PUBLISHED");
      return [];
  }
}
