import fs from "node:fs/promises";
import path from "node:path";
import type { ContentStatus, ContentType, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { canTransition } from "../domain/status.js";
import { TARGETS } from "../domain/duration.js";
import { themeBundleInclude } from "../domain/types.js";
import { getSettings } from "../settings.js";
import { BudgetExceededError, spendThisMonth } from "../cost.js";
import { storage } from "../storage/index.js";

export const itemInclude = {
  channel: { include: { theme: { include: themeBundleInclude } } },
  shots: { orderBy: { idx: "asc" } },
  parent: true,
} satisfies Prisma.ContentItemInclude;

export type LoadedItem = Prisma.ContentItemGetPayload<{ include: typeof itemInclude }>;

export function loadItem(id: string): Promise<LoadedItem> {
  return prisma.contentItem.findUniqueOrThrow({ where: { id }, include: itemInclude });
}

export async function setStatus(id: string, to: ContentStatus, extra: Prisma.ContentItemUpdateInput = {}) {
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (item.status !== to && !canTransition(item.status, to)) {
    throw new Error(`illegal status transition ${item.status} → ${to}`);
  }
  return prisma.contentItem.update({
    where: { id },
    data: { status: to, ...(to === "FAILED" ? {} : { error: null, failedStage: null }), ...extra },
  });
}

export async function workDir(itemId: string, ...sub: string[]) {
  const dir = path.join(config.workDir, itemId, ...sub);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Download a storage key into the item's work dir once (idempotent local cache). */
export async function localCopy(itemId: string, key: string): Promise<string> {
  const file = path.join(config.workDir, itemId, "cache", key.replace(/[\\/]/g, "_"));
  try {
    await fs.access(file);
    return file;
  } catch {
    return storage().download(key, file);
  }
}

export interface Targets {
  seconds: [number, number];
  shots: [number, number];
  width: number;
  height: number;
  aspect: "16:9" | "9:16";
  fps: number;
}

/** Content targets. KAHANI_QUICK=1 shrinks stories for fast local demos. */
export async function targetsFor(type: ContentType, storyMinutes = 10): Promise<Targets> {
  const quick = process.env.KAHANI_QUICK === "1";
  if (type === "SHORT") {
    const t = TARGETS.SHORT;
    return { seconds: [t.minSec, t.maxSec], shots: quick ? [8, 9] : [t.minShots, t.maxShots], width: t.width, height: t.height, aspect: t.aspect, fps: 30 };
  }
  const t = TARGETS.STORY;
  const settings = await getSettings();
  if (quick) return { seconds: [30, 90], shots: [12, 14], width: t.width, height: t.height, aspect: t.aspect, fps: 30 };
  const minutes = Math.min(15, Math.max(8, storyMinutes));
  const minSec = Math.max(t.minSec, (minutes - 1.5) * 60);
  const maxSec = Math.min(t.maxSec, (minutes + 1.5) * 60);
  // ≈ 4.5s per shot on average
  const minShots = Math.max(t.minShots, Math.round(minSec / 4.8));
  const maxShots = Math.min(settings.maxStoryShots, t.maxShots, Math.max(minShots + 10, Math.round(maxSec / 4.2)));
  return { seconds: [minSec, maxSec], shots: [minShots, maxShots], width: t.width, height: t.height, aspect: t.aspect, fps: 30 };
}

export async function assertBudget() {
  const { monthlyBudgetInr } = await getSettings();
  if (monthlyBudgetInr > 0) {
    const spent = await spendThisMonth();
    if (spent >= monthlyBudgetInr) throw new BudgetExceededError(spent, monthlyBudgetInr);
  }
}

/** Error thrown when some shots in a stage failed; the successful ones are already persisted. */
export class PartialStageError extends Error {
  constructor(
    stage: string,
    readonly failedShots: { idx: number; error: string }[],
  ) {
    super(`${stage}: ${failedShots.length} shot(s) failed — ${failedShots
      .slice(0, 5)
      .map((f) => `#${f.idx}: ${f.error}`)
      .join("; ")}`);
  }
}

export const shotKey = (itemId: string, idx: number, kind: string, hash: string, ext: string) =>
  `items/${itemId}/${kind}/${String(idx).padStart(4, "0")}-${hash.slice(0, 10)}.${ext}`;

/** Not an error: the stage is waiting on external work (e.g. a Gemini batch) and should run again after `delayMs`. */
export class StageDeferred extends Error {
  readonly deferred = true;
  constructor(
    message: string,
    readonly delayMs: number,
  ) {
    super(message);
  }
}
