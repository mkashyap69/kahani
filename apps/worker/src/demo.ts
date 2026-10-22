/**
 * End-to-end demo: seeds "Gaon Ki Kahaniyan", creates today's story + 2 shorts and runs every stage
 * in-process (no Redis/worker needed), then "publishes" (mock publisher unless the channel is connected).
 *
 *   npm run demo                 # quick demo (~14-shot story, 8-shot shorts); offline mocks when no API keys
 *   npm run demo -- --full       # full-length targets (8–15 min story, 120–200 shots)
 *   npm run demo -- --no-publish # stop at the review queue
 *   npm run demo -- --only=story # just the story episode
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config, createDailyRun, logger, prisma, providerSummary, runStage, seedDemo, storage, type FollowUp } from "@kahani/core";

const args = process.argv.slice(2);
if (!args.includes("--full")) process.env.KAHANI_QUICK = "1";
const publish = !args.includes("--no-publish");
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const log = logger("demo");

async function main() {
  const t0 = Date.now();
  log.info("providers", await providerSummary());
  const channel = await seedDemo();
  const run = await createDailyRun(channel.id, { force: true });
  let items = run.items;
  if (only === "story") {
    await prisma.contentItem.updateMany({ where: { id: { in: items.slice(1).map((i) => i.id) } }, data: { status: "REJECTED" } });
    items = items.slice(0, 1);
  }
  log.info(`created ${items.length} item(s)`, { ids: items.map((i) => `${i.type}:${i.id}`) });

  // simple in-process queue — same follow-up logic the BullMQ worker uses
  const queue: FollowUp[] = [...run.jobs];
  while (queue.length) {
    const job = queue.shift()!;
    if (!items.some((i) => i.id === job.itemId)) continue;
    try {
      queue.push(...(await runStage(job.itemId, job.stage)));
    } catch {
      // recorded on the item as FAILED (with stage + error); keep going with the others
    }
  }

  if (publish) {
    for (const item of items) {
      const fresh = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
      if (fresh.status === "REVIEW") await runStage(item.id, "publish").catch(() => undefined);
    }
  }

  const outDir = path.join(config.repoRoot, "data", "demo");
  await fs.mkdir(outDir, { recursive: true });
  const final = await prisma.contentItem.findMany({ where: { id: { in: items.map((i) => i.id) } }, orderBy: [{ type: "asc" }, { slot: "asc" }] });
  console.log("\n──────── Kahani Studio demo ────────");
  for (const it of final) {
    let file = "-";
    if (it.videoKey) {
      file = path.join(outDir, `${it.type.toLowerCase()}${it.slot ? `-${it.slot}` : ""}.mp4`);
      await storage().download(it.videoKey, file);
    }
    console.log(
      `${it.type.padEnd(5)} ${it.status.padEnd(10)} ${String(it.durationSec?.toFixed(1) ?? "-").padStart(6)}s  ₹${it.costInr.toFixed(2).padStart(7)}  ${it.title ?? ""}\n      → ${file}${it.youtubeVideoId ? `  (published: ${it.youtubeVideoId})` : ""}${it.error ? `\n      ✘ ${it.error}` : ""}`,
    );
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await prisma.$disconnect();
  if (final.some((i) => i.status === "FAILED")) process.exit(1);
}

main().catch(async (err) => {
  log.error(String(err?.stack ?? err));
  await prisma.$disconnect();
  process.exit(1);
});
