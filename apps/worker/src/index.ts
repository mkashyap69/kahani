/**
 * Kahani Studio worker: consumes the pipeline + studio queues and owns the daily schedules.
 *   npm run worker
 */
import { Worker, UnrecoverableError, type Job } from "bullmq";
import {
  PIPELINE_QUEUE,
  STUDIO_QUEUE,
  bullConnection,
  closeQueues,
  createDailyRun,
  enqueueStage,
  generateCharacterSheet,
  generateLocationReference,
  getSettings,
  isNonRetryable,
  logger,
  prisma,
  providerSummary,
  runStage,
  runStyleTest,
  syncSchedules,
  type StageJob,
  type StudioJob,
} from "@kahani/core";

const log = logger("worker");

async function main() {
  const settings = await getSettings();
  log.info("providers", await providerSummary());

  // Several items move through the pipeline in parallel; per-shot concurrency is limited inside each stage.
  const pipeline = new Worker<StageJob>(
    PIPELINE_QUEUE,
    async (job: Job<StageJob>) => {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      try {
        const follow = await runStage(job.data.itemId, job.data.stage, { finalAttempt });
        for (const f of follow) await enqueueStage(f.itemId, f.stage);
        return { next: follow };
      } catch (err) {
        if (isNonRetryable(err)) throw new UnrecoverableError(String((err as Error).message ?? err));
        throw err;
      }
    },
    { connection: bullConnection(), concurrency: Number(process.env.PIPELINE_CONCURRENCY ?? 3), lockDuration: 10 * 60_000 },
  );

  const studio = new Worker<StudioJob>(
    STUDIO_QUEUE,
    async (job) => {
      const d = job.data;
      switch (d.kind) {
        case "character-sheet":
          return generateCharacterSheet(d.characterId);
        case "location-ref":
          return generateLocationReference(d.locationId);
        case "style-test":
          return runStyleTest(d.themeId);
        case "sync-schedules":
          return syncSchedules();
        case "daily-run": {
          const run = await createDailyRun(d.channelId, { force: d.force });
          for (const j of run.jobs) await enqueueStage(j.itemId, j.stage);
          return { items: run.items.map((i) => i.id), skipped: run.skipped };
        }
      }
    },
    { connection: bullConnection(), concurrency: 4, lockDuration: 10 * 60_000 },
  );

  for (const w of [pipeline, studio]) {
    w.on("failed", (job, err) => log.warn(`job ${job?.name} ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
    w.on("error", (err) => log.error(`worker error: ${err.message}`));
  }

  const schedules = await syncSchedules();
  log.info(`worker ready — ${schedules.length} channel schedule(s)`, { schedules, imageConcurrency: settings.imageConcurrency });

  const shutdown = async () => {
    log.info("shutting down…");
    await Promise.all([pipeline.close(), studio.close()]);
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error(String(err?.stack ?? err));
  process.exit(1);
});
