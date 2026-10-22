import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import type { CallContext, PublishRequest, Publisher } from "../types.js";

/** Writes the "upload" to data/published/ — used when a channel isn't connected to YouTube. */
export class MockPublisher implements Publisher {
  readonly name = "mock-publisher";
  async publish(channelId: string, req: PublishRequest, ctx: CallContext) {
    const dir = path.join(config.repoRoot, "data", "published", channelId);
    await fs.mkdir(dir, { recursive: true });
    const id = `mock_${ctx.contentItemId ?? Date.now()}`;
    await fs.copyFile(req.videoPath, path.join(dir, `${id}.mp4`));
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ ...req, videoPath: undefined }, null, 2));
    return { videoId: id, url: `file://${path.join(dir, `${id}.mp4`)}` };
  }
}
