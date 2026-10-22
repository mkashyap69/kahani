import sharp from "sharp";
import { logApiCall } from "../cost.js";
import { config } from "../config.js";
import { NonRetryableError, withRetry } from "../util/retry.js";
import type { ImageModelInfo } from "./image-models.js";
import type { CallContext, ImageProvider, ImageRequest } from "./types.js";

const SIZE: Record<string, string> = { "16:9": "1920x1080", "9:16": "1080x1920", "1:1": "1440x1440" };

/** Seedream via BytePlus ModelArk (POST /images/generations; reference sheets go in `image`). */
export class BytePlusImage implements ImageProvider {
  readonly name = "byteplus";
  readonly model: string;
  private base = process.env.BYTEPLUS_ARK_BASE ?? "https://ark.ap-southeast.bytepluses.com/api/v3";
  constructor(
    private apiKey: string,
    private info: ImageModelInfo,
  ) {
    this.model = info.id;
  }

  async generate(req: ImageRequest, ctx: CallContext) {
    const refs = req.references.slice(0, this.info.maxRefs);
    const images = await Promise.all(
      refs.map(async (r) => `data:image/jpeg;base64,${(await sharp(r.data).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()).toString("base64")}`),
    );
    const labels = refs.map((r, i) => `image ${i + 1}: ${r.label ?? "reference"}`).join("; ");
    const body: Record<string, unknown> = {
      model: this.info.model,
      prompt: refs.length ? `${req.prompt}\n\nReference ${labels}. Keep every character exactly on-model.` : req.prompt,
      size: SIZE[req.aspect] ?? SIZE["16:9"],
      response_format: "b64_json",
      sequential_image_generation: "disabled",
      watermark: false,
    };
    if (images.length) body.image = images.length === 1 ? images[0] : images;
    try {
      const out = await withRetry(async () => {
        const res = await fetch(`${this.base}/images/generations`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          throw Object.assign(res.status >= 400 && res.status < 500 && res.status !== 429 ? new NonRetryableError(`BytePlus ${res.status}: ${text}`) : new Error(`BytePlus ${res.status}: ${text}`), { status: res.status });
        }
        const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
        const d = json.data?.[0];
        if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
        if (d?.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
        throw new Error(`BytePlus returned no image: ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
      });
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: "byteplus", model: this.info.id, operation: ctx.operation ?? "image", images: 1, costInr: this.info.usd * config.usdToInr });
      return { data: await sharp(out).png().toBuffer(), mime: "image/png" };
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: "byteplus", model: this.info.id, operation: ctx.operation ?? "image", success: false, error: String(err) });
      throw err;
    }
  }
}
