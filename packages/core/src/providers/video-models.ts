/**
 * Image-to-video models used as a MotionProvider (animate each still: blinks, talking, gestures).
 * Prices are list-price ESTIMATES in USD per output second — check fal's pricing page.
 */
export interface VideoModelInfo {
  id: string;
  label: string;
  /** API that serves it */
  provider: "fal" | "byteplus" | "dashscope";
  /** fal endpoint id */
  endpoint?: string;
  /** BytePlus / DashScope model id */
  model?: string;
  resolution: "480p" | "720p";
  /** promotional price and the date it ends (exclusive), then the list price */
  usdPerSec: { list: number; promo?: number; promoUntil?: string };
  minSec: number;
  maxSec: number;
  notes: string;
}

export const VIDEO_MODELS: VideoModelInfo[] = [
  {
    id: "i2v:flux-3-max",
    label: "FLUX 3 Max image-to-video (via fal)",
    provider: "fal",
    endpoint: "blackforestlabs/flux-3-max/image-to-video",
    resolution: "720p",
    usdPerSec: { list: 0.17, promo: 0.0425, promoUntil: "2026-11-07" },
    minSec: 5,
    maxSec: 20,
    notes: "720p; output has native audio, which is discarded (dialogue comes from Sarvam)",
  },
  {
    id: "i2v:seedance-1.5-pro-720p",
    label: "Seedance 1.5 Pro 720p (BytePlus)",
    provider: "byteplus",
    model: process.env.SEEDANCE_MODEL ?? "seedance-1-5-pro-251215",
    resolution: "720p",
    usdPerSec: { list: 0.026 }, // official ModelArk: $0.13 per silent 5 s 720p clip
    minSec: 5,
    maxSec: 10,
    notes: "best value at 720p; silent (audio off)",
  },
  {
    id: "i2v:seedance-1.5-pro-480p",
    label: "Seedance 1.5 Pro 480p (BytePlus)",
    provider: "byteplus",
    model: process.env.SEEDANCE_MODEL ?? "seedance-1-5-pro-251215",
    resolution: "480p",
    usdPerSec: { list: 0.012 }, // official ModelArk: $0.06 per silent 5 s 480p clip
    minSec: 5,
    maxSec: 10,
    notes: "cheapest credible option; upscaled to the video size",
  },
  {
    id: "i2v:wan-2.6-flash-720p",
    label: "Wan 2.6 Flash 720p (Alibaba Model Studio)",
    provider: "dashscope",
    model: "wan2.6-i2v-flash",
    resolution: "720p",
    usdPerSec: { list: 0.025 }, // reseller estimate — check Alibaba Cloud's pricing page
    minSec: 5,
    maxSec: 10,
    notes: "price estimate from resellers; audio off",
  },
  {
    id: "i2v:wan-2.2-flash-480p",
    label: "Wan 2.2 Flash 480p (Alibaba Model Studio)",
    provider: "dashscope",
    model: "wan2.2-i2v-flash",
    resolution: "480p",
    usdPerSec: { list: 0.015 },
    minSec: 5,
    maxSec: 5,
    notes: "very cheap; fixed 5 s clips",
  },
];

export function videoModelInfo(id: string): VideoModelInfo {
  const m = VIDEO_MODELS.find((v) => v.id === id);
  if (!m) throw new Error(`unknown video model "${id}"`);
  return m;
}

/** Current per-second price (env override wins, e.g. FLUX_3_MAX_USD_PER_SEC=0.17). */
export function videoUsdPerSec(info: VideoModelInfo, at = new Date()): number {
  const env = process.env[`${info.id.split(":")[1].toUpperCase().replace(/[-.]/g, "_")}_USD_PER_SEC`];
  if (env && Number.isFinite(Number(env))) return Number(env);
  const { list, promo, promoUntil } = info.usdPerSec;
  return promo !== undefined && promoUntil && at < new Date(`${promoUntil}T00:00:00Z`) ? promo : list;
}

export type MotionScope = "closeups" | "dialogue" | "shorts" | "all";
export const MOTION_SCOPES: { id: MotionScope; label: string }[] = [
  { id: "closeups", label: "Close-up dialogue shots only" },
  { id: "dialogue", label: "Every shot with a speaking character" },
  { id: "shorts", label: "Every shot in Shorts (stories use Ken Burns)" },
  { id: "all", label: "Every shot (most expensive)" },
];

/** Does this shot get the paid video model under the channel's scope? */
export function inMotionScope(scope: string, shot: { framing: string; speaking: boolean; contentType: "STORY" | "SHORT" }): boolean {
  switch (scope) {
    case "all":
      return true;
    case "shorts":
      return shot.contentType === "SHORT";
    case "dialogue":
      return shot.speaking;
    default:
      return shot.framing === "closeup" && shot.speaking;
  }
}
