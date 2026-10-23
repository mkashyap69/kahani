import sharp from "sharp";
import { logApiCall } from "../cost.js";
import { config } from "../config.js";
import { GatewayClient, type Gateway } from "./gateway.js";
import type { ImageModelInfo } from "./image-models.js";
import type { CallContext, ImageProvider, ImageRequest } from "./types.js";

/** Image model through APIMart / EvoLink; on any failure the shot falls back to the direct provider. */
export class GatewayImage implements ImageProvider {
  readonly name: string;
  readonly model: string;
  private client: GatewayClient;
  constructor(
    apiKey: string,
    private info: ImageModelInfo,
    private fallback: ImageProvider,
  ) {
    this.name = info.provider;
    this.model = info.id;
    this.client = new GatewayClient(info.provider as Gateway, apiKey);
  }

  async generate(req: ImageRequest, ctx: CallContext) {
    const refs = req.references.slice(0, this.info.maxRefs);
    try {
      const image_urls = await Promise.all(
        refs.map(async (r) => `data:image/jpeg;base64,${(await sharp(r.data).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()).toString("base64")}`),
      );
      const labels = refs.map((r, i) => `image ${i + 1}: ${r.label ?? "reference"}`).join("; ");
      const urls = await this.client.run("images", {
        model: this.info.model,
        prompt: refs.length ? `${req.prompt}\n\nReference ${labels}. Keep every character exactly on-model.` : req.prompt,
        size: req.aspect,
        n: 1,
        ...(image_urls.length ? { image_urls } : {}),
      });
      const data = await sharp(Buffer.from(await (await fetch(urls[0])).arrayBuffer())).png().toBuffer();
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.info.provider, model: this.info.id, operation: ctx.operation ?? "image", images: 1, costInr: this.info.usd * config.usdToInr });
      return { data, mime: "image/png" };
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.info.provider, model: this.info.id, operation: ctx.operation ?? "image", success: false, error: String(err) });
      if (ctx.operation === "compare") throw err;
      console.warn(`[image] ${this.info.id} failed, using direct provider ${this.fallback.model}: ${err}`);
      return this.fallback.generate(req, ctx);
    }
  }
}
