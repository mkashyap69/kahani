import fs from "node:fs/promises";
import path from "node:path";
import { ffmpeg, probeDuration, x264Args } from "../media/ffmpeg.js";
import { logApiCall } from "../cost.js";
import { sleep, withRetry } from "../util/retry.js";
import type { CallContext, MotionProvider, MotionRequest } from "./types.js";

/** Normalise any provider clip to exactly the shot: size, fps, frame count, no audio. */
export async function fitClip(raw: string, req: MotionRequest) {
  const srcDur = await probeDuration(raw);
  const frames = Math.round(req.durationSec * req.fps);
  await ffmpeg([
    "-i",
    raw,
    "-vf",
    `scale=${req.width}:${req.height}:force_original_aspect_ratio=increase,crop=${req.width}:${req.height},fps=${req.fps},tpad=stop_mode=clone:stop_duration=${Math.max(0, req.durationSec - srcDur + 0.1).toFixed(3)},setsar=1,format=yuv420p`,
    "-frames:v",
    String(frames),
    "-an",
    ...x264Args({ fps: req.fps, bitrateK: 0, intermediate: true }),
    req.outPath,
  ]);
  return srcDur;
}

/**
 * Builds the zoompan expressions for a shot.
 * wide → slow lateral pan, medium → gentle zoom/drift, closeup → slow push-in,
 * over_shoulder → slow pan + slight zoom. A subtle sinusoidal "breathing" scale is layered on top.
 */
export function kenBurnsFilter(req: Pick<MotionRequest, "framing" | "durationSec" | "width" | "height" | "fps" | "seed">): string {
  const frames = Math.max(1, Math.round(req.durationSec * req.fps));
  const W = req.width;
  const H = req.height;
  const last = Math.max(1, frames - 1);
  // eased progress 0..1 (smoothstep)
  const p = `(on/${last})`;
  const e = `(${p}*${p}*(3-2*${p}))`;
  const breathe = `0.006*sin(2*PI*on/(${req.fps}*3.2))`;
  const dir = req.seed % 2 === 0 ? 1 : -1;
  const panX = (from: number, to: number) => {
    const [a, b] = dir > 0 ? [from, to] : [to, from];
    return `(iw-iw/zoom)*(${a}+(${b - a})*${e})`;
  };
  const centerY = `(ih-ih/zoom)*0.5`;
  let z: string, x: string, y: string;
  switch (req.framing) {
    case "wide":
      z = `1.12+${breathe}`;
      x = panX(0.1, 0.9);
      y = centerY;
      break;
    case "closeup":
      z = `1.05+0.12*${e}+${breathe}`;
      x = `(iw-iw/zoom)*0.5`;
      y = `(ih-ih/zoom)*0.42`;
      break;
    case "over_shoulder":
      z = `1.10+0.05*${e}+${breathe}`;
      x = panX(0.3, 0.7);
      y = centerY;
      break;
    default: // medium
      z = `1.06+0.06*${e}+${breathe}`;
      x = panX(0.42, 0.58);
      y = `(ih-ih/zoom)*0.45`;
  }
  // render at 2x before zoompan to minimise sub-pixel jitter
  return [
    `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${W * 2}:${H * 2}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${W}x${H}:fps=${req.fps}`,
    `setsar=1`,
    `format=yuv420p`,
  ].join(",");
}

/** Default, zero-cost motion: FFmpeg Ken Burns. */
export class KenBurnsProvider implements MotionProvider {
  readonly name = "kenburns";
  handles() {
    return true;
  }
  async animate(req: MotionRequest): Promise<void> {
    await fs.mkdir(path.dirname(req.outPath), { recursive: true });
    const frames = Math.max(1, Math.round(req.durationSec * req.fps));
    await ffmpeg([
      "-i",
      req.imagePath,
      "-vf",
      kenBurnsFilter(req),
      "-frames:v",
      String(frames),
      "-an",
      ...x264Args({ fps: req.fps, bitrateK: 0, intermediate: true }),
      req.outPath,
    ]);
  }
}

/**
 * Optional lip-sync / image-to-video through fal.ai's queue API.
 * Only used for close-up dialogue shots to keep cost down; everything else falls back to Ken Burns.
 */
export class FalLipSyncProvider implements MotionProvider {
  readonly name = "fal-lipsync";
  constructor(
    private apiKey: string,
    private model: string,
    private fallback: MotionProvider = new KenBurnsProvider(),
  ) {}

  handles(req: Pick<MotionRequest, "framing" | "speaking" | "contentType">) {
    return req.framing === "closeup" && req.speaking;
  }

  async animate(req: MotionRequest, ctx: CallContext): Promise<void> {
    if (!this.handles(req) || !req.audioPath) return this.fallback.animate(req, ctx);
    const toDataUri = async (file: string, mime: string) => `data:${mime};base64,${(await fs.readFile(file)).toString("base64")}`;
    const headers = { Authorization: `Key ${this.apiKey}`, "content-type": "application/json" };
    try {
      const submit = await withRetry(async () => {
        const res = await fetch(`https://queue.fal.run/${this.model}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            image_url: await toDataUri(req.imagePath, "image/png"),
            audio_url: await toDataUri(req.audioPath!, "audio/wav"),
            resolution: "720p",
          }),
        });
        if (!res.ok) throw Object.assign(new Error(`fal submit ${res.status}: ${await res.text()}`), { status: res.status });
        return (await res.json()) as { status_url: string; response_url: string };
      });
      const deadline = Date.now() + 10 * 60_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error("fal lip-sync timed out");
        await sleep(4000);
        const st = (await (await fetch(submit.status_url, { headers })).json()) as { status: string };
        if (st.status === "COMPLETED") break;
        if (st.status === "FAILED" || st.status === "ERROR") throw new Error(`fal job failed: ${JSON.stringify(st)}`);
      }
      const result = (await (await fetch(submit.response_url, { headers })).json()) as { video?: { url: string } };
      if (!result.video?.url) throw new Error("fal returned no video");
      const raw = req.outPath.replace(/\.mp4$/, ".fal.mp4");
      await fs.writeFile(raw, Buffer.from(await (await fetch(result.video.url)).arrayBuffer()));
      const srcDur = await fitClip(raw, req);
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: "fal", model: this.model, operation: "lipsync", seconds: srcDur });
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: "fal", model: this.model, operation: "lipsync", success: false, error: String(err) });
      // never fail an episode because the optional add-on failed
      console.warn(`[motion] lip-sync failed, falling back to Ken Burns: ${err}`);
      await this.fallback.animate(req, ctx);
    }
  }
}
