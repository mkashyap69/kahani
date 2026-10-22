/**
 * Image-to-video models used as a MotionProvider (animate each still: blinks, talking, gestures).
 * Prices are list-price ESTIMATES in USD per output second — check fal's pricing page.
 */
export interface VideoModelInfo {
  id: string;
  label: string;
  endpoint: string;
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
    endpoint: "blackforestlabs/flux-3-max/image-to-video",
    usdPerSec: { list: 0.17, promo: 0.0425, promoUntil: "2026-11-07" },
    minSec: 5,
    maxSec: 20,
    notes: "720p; output has native audio, which is discarded (dialogue comes from Sarvam)",
  },
];

export function videoModelInfo(id: string): VideoModelInfo {
  const m = VIDEO_MODELS.find((v) => v.id === id);
  if (!m) throw new Error(`unknown video model "${id}"`);
  return m;
}

/** Current per-second price (env override wins, e.g. FLUX_3_MAX_USD_PER_SEC=0.17). */
export function videoUsdPerSec(info: VideoModelInfo, at = new Date()): number {
  const env = process.env[`${info.id.split(":")[1].toUpperCase().replace(/-/g, "_")}_USD_PER_SEC`];
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
