import fs from "node:fs/promises";
import sharp from "sharp";
import { logApiCall } from "../cost.js";
import { config } from "../config.js";
import { NonRetryableError, sleep, withRetry } from "../util/retry.js";
import { fitClip, KenBurnsProvider } from "./motion.js";
import { GatewayClient, type Gateway } from "./gateway.js";
import { inMotionScope, videoUsdPerSec, type VideoModelInfo } from "./video-models.js";
import type { CallContext, MotionProvider, MotionRequest } from "./types.js";

export interface I2VInput {
  imageDataUri: string;
  prompt: string;
  seconds: number;
  aspect: "16:9" | "9:16";
}
export type I2VPoll = { state: "running" } | { state: "done"; url: string } | { state: "failed"; error: string };

/** One video-generation API (submit a still + prompt, poll until a video URL is ready). */
export interface I2VBackend {
  submit(input: I2VInput): Promise<string>;
  poll(handle: string): Promise<I2VPoll>;
}

async function httpJson<T>(url: string, init: RequestInit, what: string): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      const err = res.status >= 400 && res.status < 500 && res.status !== 429 ? new NonRetryableError(`${what} ${res.status}: ${text}`) : new Error(`${what} ${res.status}: ${text}`);
      throw Object.assign(err, { status: res.status });
    }
    return (await res.json()) as T;
  });
}

/** fal.ai queue API (FLUX 3 Max, …). */
export class FalI2VBackend implements I2VBackend {
  constructor(
    private apiKey: string,
    private info: VideoModelInfo,
  ) {}
  private headers() {
    return { Authorization: `Key ${this.apiKey}`, "content-type": "application/json" };
  }
  async submit(i: I2VInput) {
    const res = await httpJson<{ status_url: string; response_url: string }>(
      `https://queue.fal.run/${this.info.endpoint}`,
      { method: "POST", headers: this.headers(), body: JSON.stringify({ image_url: i.imageDataUri, prompt: i.prompt, duration: i.seconds, resolution: this.info.resolution, aspect_ratio: i.aspect }) },
      "fal",
    );
    return JSON.stringify(res);
  }
  async poll(handle: string): Promise<I2VPoll> {
    const h = JSON.parse(handle) as { status_url: string; response_url: string };
    const st = (await (await fetch(h.status_url, { headers: this.headers() })).json()) as { status: string };
    if (st.status === "FAILED" || st.status === "ERROR") return { state: "failed", error: JSON.stringify(st) };
    if (st.status !== "COMPLETED") return { state: "running" };
    const r = (await (await fetch(h.response_url, { headers: this.headers() })).json()) as { video?: { url: string } };
    return r.video?.url ? { state: "done", url: r.video.url } : { state: "failed", error: `no video: ${JSON.stringify(r).slice(0, 300)}` };
  }
}

/**
 * BytePlus ModelArk (Seedance) — POST /contents/generations/tasks, GET /contents/generations/tasks/{id}.
 * Parameters ride in the prompt as "--resolution/--duration/--camerafixed" flags; audio is off (silent price).
 */
export class BytePlusI2VBackend implements I2VBackend {
  private base = process.env.BYTEPLUS_ARK_BASE ?? "https://ark.ap-southeast.bytepluses.com/api/v3";
  constructor(
    private apiKey: string,
    private info: VideoModelInfo,
  ) {}
  private headers() {
    return { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" };
  }
  async submit(i: I2VInput) {
    const flags = `--resolution ${this.info.resolution} --duration ${i.seconds} --ratio ${i.aspect} --camerafixed true --watermark false`;
    const res = await httpJson<{ id: string }>(
      `${this.base}/contents/generations/tasks`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.info.model,
          content: [
            { type: "text", text: `${i.prompt} ${flags}` },
            { type: "image_url", image_url: { url: i.imageDataUri }, role: "first_frame" },
          ],
          generate_audio: false,
        }),
      },
      "BytePlus",
    );
    return res.id;
  }
  async poll(id: string): Promise<I2VPoll> {
    const r = await httpJson<{ status: string; content?: { video_url?: string }; error?: { message?: string } }>(`${this.base}/contents/generations/tasks/${id}`, { headers: this.headers() }, "BytePlus");
    if (r.status === "succeeded" && r.content?.video_url) return { state: "done", url: r.content.video_url };
    if (r.status === "failed" || r.status === "cancelled" || r.status === "expired") return { state: "failed", error: r.error?.message ?? r.status };
    return { state: "running" };
  }
}

/** Alibaba Cloud Model Studio / DashScope (Wan) — async video-synthesis task, then GET /tasks/{id}. */
export class DashScopeI2VBackend implements I2VBackend {
  private base = process.env.DASHSCOPE_BASE ?? "https://dashscope-intl.aliyuncs.com/api/v1";
  constructor(
    private apiKey: string,
    private info: VideoModelInfo,
  ) {}
  async submit(i: I2VInput) {
    const res = await httpJson<{ output?: { task_id?: string }; message?: string }>(
      `${this.base}/services/aigc/video-generation/video-synthesis`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", "X-DashScope-Async": "enable" },
        body: JSON.stringify({
          model: this.info.model,
          input: { prompt: i.prompt, img_url: i.imageDataUri },
          parameters: { resolution: this.info.resolution.toUpperCase(), duration: i.seconds, prompt_extend: false, watermark: false, audio: false },
        }),
      },
      "DashScope",
    );
    if (!res.output?.task_id) throw new Error(`DashScope returned no task id: ${res.message ?? ""}`);
    return res.output.task_id;
  }
  async poll(id: string): Promise<I2VPoll> {
    const r = await httpJson<{ output?: { task_status?: string; video_url?: string; message?: string } }>(`${this.base}/tasks/${id}`, { headers: { Authorization: `Bearer ${this.apiKey}` } }, "DashScope");
    const st = r.output?.task_status;
    if (st === "SUCCEEDED" && r.output?.video_url) return { state: "done", url: r.output.video_url };
    if (st === "FAILED" || st === "CANCELED" || st === "UNKNOWN") return { state: "failed", error: r.output?.message ?? String(st) };
    return { state: "running" };
  }
}

/** APIMart / EvoLink video task (Seedance via gateway). */
export class GatewayI2VBackend implements I2VBackend {
  private client: GatewayClient;
  constructor(
    apiKey: string,
    private info: VideoModelInfo,
  ) {
    this.client = new GatewayClient(info.provider as Gateway, apiKey);
  }
  submit(i: I2VInput) {
    const common = { model: this.info.model, prompt: i.prompt, image_urls: [i.imageDataUri], duration: i.seconds };
    return this.client.submit(
      "videos",
      this.info.provider === "evolink"
        ? { ...common, aspect_ratio: i.aspect, quality: this.info.resolution }
        : { ...common, size: i.aspect, resolution: this.info.resolution, generate_audio: false },
    );
  }
  async poll(id: string): Promise<I2VPoll> {
    const s = await this.client.poll(id);
    return s.state === "done" ? { state: "done", url: s.urls[0] } : s;
  }
}

/**
 * Image-to-video motion: animates the shot's still (blinks, talking, gestures), trims to the exact shot,
 * drops the model's audio. Shots outside the channel's motion scope — and any failure — use Ken Burns.
 */
export class ImageToVideoProvider implements MotionProvider {
  readonly name: string;
  constructor(
    private backend: I2VBackend,
    readonly info: VideoModelInfo,
    private scope: string,
    private fallback: MotionProvider = new KenBurnsProvider(),
  ) {
    this.name = info.id;
  }

  handles(req: Pick<MotionRequest, "framing" | "speaking" | "contentType">) {
    return inMotionScope(this.scope, { framing: req.framing, speaking: req.speaking, contentType: req.contentType ?? "STORY" });
  }

  billedSeconds(durationSec: number) {
    return Math.min(this.info.maxSec, Math.max(this.info.minSec, Math.ceil(durationSec)));
  }

  async animate(req: MotionRequest, ctx: CallContext): Promise<void> {
    if (!this.handles(req)) return this.fallback.animate(req, ctx);
    const seconds = this.billedSeconds(req.durationSec);
    const jpg = await sharp(await fs.readFile(req.imagePath)).resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const prompt = [
      "2D Indian cartoon animation. Keep the art style, characters, outfits, colours and background exactly as in the image.",
      req.prompt ?? "",
      req.speaking ? "The speaking character talks with natural lip movement and small expressive gestures; others react subtly." : "Gentle ambient motion: blinking, breathing, light movement in the background.",
      "Mostly static camera. No new characters, no text, no scene change.",
    ]
      .filter(Boolean)
      .join(" ");
    try {
      const handle = await this.backend.submit({ imageDataUri: `data:image/jpeg;base64,${jpg.toString("base64")}`, prompt, seconds, aspect: req.height > req.width ? "9:16" : "16:9" });
      const deadline = Date.now() + 15 * 60_000;
      let url: string | null = null;
      while (!url) {
        if (Date.now() > deadline) throw new Error(`${this.info.id} timed out`);
        await sleep(Number(process.env.I2V_POLL_MS ?? 5000));
        const p = await this.backend.poll(handle);
        if (p.state === "failed") throw new Error(`${this.info.id} failed: ${p.error}`);
        if (p.state === "done") url = p.url;
      }
      const raw = req.outPath.replace(/\.mp4$/, ".i2v.mp4");
      await fs.writeFile(raw, Buffer.from(await (await fetch(url)).arrayBuffer()));
      await fitClip(raw, req);
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.info.provider, model: this.info.id, operation: "image-to-video", seconds, costInr: videoUsdPerSec(this.info) * seconds * config.usdToInr });
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.info.provider, model: this.info.id, operation: "image-to-video", success: false, error: String(err) });
      console.warn(`[motion] ${this.info.id} failed, falling back to Ken Burns: ${err}`);
      if (ctx.operation === "compare") throw err; // comparisons must show the failure
      await this.fallback.animate(req, ctx);
    }
  }
}

/** Kept for existing callers: FLUX 3 Max and other fal-hosted video models. */
export class FalImageToVideoProvider extends ImageToVideoProvider {
  constructor(apiKey: string, info: VideoModelInfo, scope: string) {
    super(new FalI2VBackend(apiKey, info), info, scope);
  }
}
