import sharp from "sharp";
import { logApiCall } from "../cost.js";
import { config } from "../config.js";
import { NonRetryableError, sleep, withRetry } from "../util/retry.js";
import type { ImageModelInfo } from "./image-models.js";
import type { CallContext, ImageProvider, ImageRequest } from "./types.js";

const SIZE: Record<string, string> = { "16:9": "landscape_16_9", "9:16": "portrait_16_9", "1:1": "square_hd" };

/** Output size in the shape each endpoint expects. */
export function falSizeInput(info: Pick<ImageModelInfo, "sizeParam">, aspect: "16:9" | "9:16" | "1:1"): Record<string, unknown> {
  if (info.sizeParam === "resolution_aspect") return { resolution: "1k", aspect_ratio: aspect };
  return { image_size: SIZE[aspect] ?? "landscape_16_9" };
}

/** Reference images go inline as data URIs (shrunk to ≤1024px JPEG to keep requests small). */
async function toDataUri(data: Buffer): Promise<string> {
  const jpg = await sharp(data).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

/** fal.ai queue API for Seedream / FLUX.2 / Qwen image models. */
export class FalImage implements ImageProvider {
  readonly name = "fal";
  readonly model: string;
  constructor(
    private apiKey: string,
    private info: ImageModelInfo,
  ) {
    this.model = info.id;
  }

  async generate(req: ImageRequest, ctx: CallContext) {
    const refs = req.references.slice(0, this.info.maxRefs);
    const endpoint = refs.length ? this.info.falEdit! : this.info.falText!;
    const labels = refs.map((r, i) => `Image ${i + 1}: ${r.label ?? "reference"}`).join("; ");
    const input: Record<string, unknown> = {
      prompt: refs.length ? `${req.prompt}\n\nReference images — ${labels}. Keep every character exactly on-model with their reference.` : req.prompt,
      ...falSizeInput(this.info, req.aspect),
      num_images: 1,
      output_format: "png",
    };
    if (this.info.sizeParam !== "resolution_aspect") input.enable_safety_checker = true;
    if (refs.length) input.image_urls = await Promise.all(refs.map((r) => toDataUri(r.data)));
    const headers = { Authorization: `Key ${this.apiKey}`, "content-type": "application/json" };
    try {
      const out = await withRetry(
        async () => {
          const submit = await fetch(`https://queue.fal.run/${endpoint}`, { method: "POST", headers, body: JSON.stringify(input) });
          if (!submit.ok) {
            const text = await submit.text();
            const err = submit.status >= 400 && submit.status < 500 && submit.status !== 429 ? new NonRetryableError(`fal ${submit.status}: ${text}`) : new Error(`fal ${submit.status}: ${text}`);
            throw Object.assign(err, { status: submit.status });
          }
          const job = (await submit.json()) as { status_url: string; response_url: string };
          const deadline = Date.now() + 5 * 60_000;
          for (;;) {
            if (Date.now() > deadline) throw new Error("fal image timed out");
            await sleep(1500);
            const st = (await (await fetch(job.status_url, { headers })).json()) as { status: string };
            if (st.status === "COMPLETED") break;
            if (st.status === "FAILED" || st.status === "ERROR") throw new Error(`fal job failed: ${JSON.stringify(st)}`);
          }
          const res = (await (await fetch(job.response_url, { headers })).json()) as { images?: { url: string; content_type?: string }[]; detail?: unknown };
          const url = res.images?.[0]?.url;
          if (!url) throw new Error(`fal returned no image: ${JSON.stringify(res.detail ?? res).slice(0, 300)}`);
          const img = await fetch(url);
          return { data: Buffer.from(await img.arrayBuffer()), mime: res.images![0].content_type ?? img.headers.get("content-type") ?? "image/png" };
        },
        { retries: 3, baseMs: 2000 },
      );
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: "fal", model: this.info.id, operation: ctx.operation ?? "image", images: 1, costInr: this.info.usd * config.usdToInr });
      return out;
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: "fal", model: this.info.id, operation: ctx.operation ?? "image", success: false, error: String(err) });
      throw err;
    }
  }
}
