import type { ContentItem } from "@prisma/client";
import { prisma } from "../db.js";
import { spendThisMonth } from "../cost.js";
import { getSettings } from "../settings.js";
import { logger } from "../util/log.js";
import type { FollowUp } from "./runner.js";

const log = logger("daily");

export function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function tzOffsetMs(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - at.getTime();
}

/** Local wall time ("2026-10-22", "18:00") in an IANA timezone → UTC Date. */
export function zonedTime(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0);
  let t = guess - tzOffsetMs(tz, new Date(guess));
  t = guess - tzOffsetMs(tz, new Date(t)); // second pass settles DST edges
  return new Date(t);
}

/**
 * Create today's story + 2 shorts for a channel. Idempotent per (channel, local date):
 * running it twice returns the existing items. Returns the jobs to enqueue.
 */
export async function createDailyRun(channelId: string, opts: { force?: boolean; at?: Date } = {}): Promise<{ items: ContentItem[]; jobs: FollowUp[]; skipped?: string }> {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { theme: { include: { storyline: true } } } });
  if (!channel.active && !opts.force) return { items: [], jobs: [], skipped: "channel inactive" };

  const { monthlyBudgetInr } = await getSettings();
  if (monthlyBudgetInr > 0) {
    const spent = await spendThisMonth();
    if (spent >= monthlyBudgetInr) {
      log.warn(`budget exhausted (₹${spent.toFixed(0)}/${monthlyBudgetInr}) — skipping ${channel.name}`);
      return { items: [], jobs: [], skipped: "monthly budget exceeded" };
    }
  }

  let runDate = localDate(channel.timezone, opts.at);
  const existing = await prisma.dailyRun.findUnique({ where: { channelId_runDate: { channelId, runDate } }, include: { items: true } });
  if (existing?.items.length) {
    if (!opts.force) return { items: existing.items, jobs: [], skipped: "already generated today" };
    // forced extra run on the same day: suffix the run date
    runDate = `${runDate}#${Date.now().toString(36)}`;
  }

  const inFlight = await prisma.contentItem.count({
    where: { channelId, type: "STORY", status: { notIn: ["PUBLISHED", "FAILED", "REJECTED"] } },
  });
  const episodeNumber = (channel.theme.storyline?.episodeCount ?? 0) + inFlight + 1;
  const day = runDate.slice(0, 10);
  const at = (t: string) => {
    const d = zonedTime(day, t, channel.timezone);
    return d > new Date() ? d : null; // in the past → publish immediately
  };

  const items = await prisma.$transaction(async (tx) => {
    const run = await tx.dailyRun.create({ data: { channelId, runDate } });
    const story = await tx.contentItem.create({
      data: { type: "STORY", channelId, dailyRunId: run.id, episodeNumber, scheduledPublishAt: at(channel.storyPublishTime) },
    });
    const shorts = [];
    for (const slot of [1, 2]) {
      shorts.push(
        await tx.contentItem.create({
          data: {
            type: "SHORT",
            channelId,
            dailyRunId: run.id,
            slot,
            parentId: channel.shortsMode === "TEASER" ? story.id : null,
            scheduledPublishAt: at(channel.shortPublishTimes[slot - 1] ?? channel.storyPublishTime),
          },
        }),
      );
    }
    return [story, ...shorts];
  });

  const jobs: FollowUp[] = [{ itemId: items[0].id, stage: "script" }];
  // mini-story shorts don't depend on the story; teasers are enqueued after the story script
  if (channel.shortsMode === "MINI_STORY") jobs.push(...items.slice(1).map((i) => ({ itemId: i.id, stage: "script" as const })));
  log.info(`daily run ${runDate} for ${channel.name}: episode ${episodeNumber} + 2 shorts`);
  return { items, jobs };
}
