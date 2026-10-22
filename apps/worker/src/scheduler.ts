/**
 * Registers/refreshes one BullMQ job scheduler per active channel (cron in the channel's timezone).
 * The worker does this on boot too; run this after changing schedules without restarting.
 *   npm run scheduler            # sync schedules
 *   npm run scheduler -- --now   # also trigger today's run for every active channel
 */
import { closeQueues, enqueueStudio, prisma, syncSchedules } from "@kahani/core";

const schedules = await syncSchedules();
for (const s of schedules) console.log(`channel ${s.channelId}: "${s.cron}" (${s.tz})`);
if (process.argv.includes("--now")) {
  for (const c of await prisma.channel.findMany({ where: { active: true } })) {
    await enqueueStudio({ kind: "daily-run", channelId: c.id });
    console.log(`queued daily run for ${c.name}`);
  }
}
await closeQueues();
await prisma.$disconnect();
