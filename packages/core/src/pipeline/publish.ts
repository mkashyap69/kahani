import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { publisherFor } from "../providers/registry.js";
import type { Script } from "../domain/script.js";
import { logger } from "../util/log.js";
import { localCopy, loadItem } from "./common.js";
import { applyMemoryUpdate } from "./memory.js";

const log = logger("publish");

/** Stage 6 — resumable YouTube upload with scheduled publish time, kids flag and AI disclosure. */
export async function runPublishStage(itemId: string): Promise<void> {
  const item = await loadItem(itemId);
  if (item.youtubeVideoId) {
    await applyMemoryUpdate(itemId);
    return; // already uploaded (idempotent)
  }
  if (!item.videoKey) throw new Error("no assembled video to publish");
  const meta = (item.youtubeMeta ?? (item.scriptJson as unknown as Script).youtube) as Script["youtube"] & { uploadSession?: string };
  let title = meta.title;
  let description = meta.description;
  if (item.type === "SHORT") {
    if (!/#shorts/i.test(title)) title = `${title.slice(0, 91)} #Shorts`;
    if (!/#shorts/i.test(description)) description += "\n#Shorts";
  }
  description += "\n\nयह वीडियो AI की मदद से बनाया गया है। (Made with AI-generated visuals and voices.)";

  const publisher = await publisherFor(item.channelId);
  const res = await publisher.publish(
    item.channelId,
    {
      videoPath: await localCopy(itemId, item.videoKey),
      thumbnailPath: item.thumbnailKey ? await localCopy(itemId, item.thumbnailKey) : null,
      title,
      description,
      tags: meta.tags ?? [],
      publishAt: item.scheduledPublishAt,
      madeForKids: item.channel.madeForKids,
      containsSyntheticMedia: true,
      language: item.channel.language,
      playlistId: item.type === "STORY" ? item.channel.storyPlaylistId : item.channel.shortsPlaylistId,
      resumeSession: meta.uploadSession ?? null,
      onSession: async (uri) => {
        await prisma.contentItem.update({ where: { id: itemId }, data: { youtubeMeta: { ...meta, uploadSession: uri } as unknown as Prisma.InputJsonValue } });
      },
    },
    { contentItemId: itemId, operation: "publish" },
  );
  await prisma.contentItem.update({ where: { id: itemId }, data: { youtubeVideoId: res.videoId } });
  log.info(`published via ${publisher.name}: ${res.url}`, { itemId });
  await applyMemoryUpdate(itemId);
  // the work dir only holds re-downloadable copies and intermediates
  await fs.rm(path.join(config.workDir, itemId), { recursive: true, force: true }).catch(() => undefined);
}
