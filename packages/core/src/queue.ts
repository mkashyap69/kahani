import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { prisma } from "./db.js";
import type { Stage } from "./domain/status.js";

export const PIPELINE_QUEUE = "kahani-pipeline";
export const STUDIO_QUEUE = "kahani-studio";

export interface StageJob {
  itemId: string;
  stage: Stage;
}
export type StudioJob =
  | { kind: "character-sheet"; characterId: string }
  | { kind: "location-ref"; locationId: string }
  | { kind: "style-test"; themeId: string }
  | { kind: "daily-run"; channelId: string; force?: boolean }
  | { kind: "sync-schedules" }
  | { kind: "launch-kit"; kitId: string; from?: string; only?: string }
  | { kind: "kit-art"; kitId: string; what: "logo" | "banner" }
  | { kind: "kit-music"; kitId: string }
  | { kind: "music-generate"; pack: string; title: string; prompt: string; lengthSec: number; mood?: string }
  | { kind: "youtube-branding"; channelId: string };

let connection: Redis | undefined;
let producer: Redis | undefined;
/** Worker connection (BullMQ workers require maxRetriesPerRequest: null). */
export function redis(): Redis {
  connection ??= new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  return connection;
}
export const bullConnection = (): ConnectionOptions => redis();
/** Producer connection: fails fast (e.g. in the web app) instead of hanging when Redis is down. */
function producerConnection(): Redis {
  producer ??= new Redis(config.redisUrl, { maxRetriesPerRequest: 2, connectTimeout: 5000 });
  return producer;
}

const queues = new Map<string, Queue>();
export function queue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: producerConnection(),
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: 500, removeOnFail: 1000 },
    });
    queues.set(name, q);
  }
  return q;
}

/** Idempotent: one live job per (item, stage). A finished/failed job with the same id is replaced. */
export async function enqueueStage(itemId: string, stage: Stage, delayMs = 0) {
  const q = queue(PIPELINE_QUEUE);
  const jobId = `${itemId}__${stage}`;
  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed" || state === "prioritized" || state === "waiting-children") return existing;
    await existing.remove().catch(() => undefined);
  }
  return q.add(stage, { itemId, stage } satisfies StageJob, { jobId, delay: delayMs });
}

export async function enqueueStudio(job: StudioJob) {
  const id =
    job.kind === "character-sheet"
      ? job.characterId
      : job.kind === "location-ref"
        ? job.locationId
        : job.kind === "style-test"
          ? job.themeId
          : job.kind === "daily-run" || job.kind === "youtube-branding"
            ? job.channelId
            : job.kind === "launch-kit" || job.kind === "kit-music"
              ? job.kitId
              : job.kind === "kit-art"
                ? `${job.kitId}-${job.what}`
                : job.kind === "music-generate"
                  ? `${job.pack}-${Date.now().toString(36)}`
                  : "all";
  const q = queue(STUDIO_QUEUE);
  const jobId = `${job.kind}__${id}`;
  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") return existing;
    await existing.remove().catch(() => undefined);
  }
  return q.add(job.kind, job, { jobId, attempts: job.kind === "daily-run" ? 3 : 1 });
}

/** "HH:mm" + IANA tz → cron in that tz. BullMQ job schedulers handle the timezone. */
export function cronFor(time: string): string {
  const [h, m] = time.split(":").map((x) => parseInt(x, 10));
  return `${m || 0} ${h || 0} * * *`;
}

/** One repeatable "daily-run" per active channel, in the channel's own timezone. */
export async function syncSchedules(): Promise<{ channelId: string; cron: string; tz: string }[]> {
  const q = queue(STUDIO_QUEUE);
  const channels = await prisma.channel.findMany({ where: { active: true } });
  const wanted = new Set(channels.map((c) => `daily__${c.id}`));
  for (const s of await q.getJobSchedulers()) {
    if (s.key.startsWith("daily__") && !wanted.has(s.key)) await q.removeJobScheduler(s.key);
  }
  const out = [];
  for (const c of channels) {
    const cron = cronFor(c.generationTime);
    await q.upsertJobScheduler(`daily__${c.id}`, { pattern: cron, tz: c.timezone }, { name: "daily-run", data: { kind: "daily-run", channelId: c.id } satisfies StudioJob });
    out.push({ channelId: c.id, cron, tz: c.timezone });
  }
  return out;
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  await connection?.quit().catch(() => undefined);
  await producer?.quit().catch(() => undefined);
  connection = undefined;
  producer = undefined;
}
