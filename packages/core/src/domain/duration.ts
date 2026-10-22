export const DIALOGUE_PADDING_SEC = 0.4;
export const MIN_SHOT_SEC = 2.5;
export const FPS = 30;

/** Round up to a whole number of frames so video and audio never drift. */
export function toFrames(seconds: number, fps = FPS): number {
  return Math.ceil(seconds * fps - 1e-6);
}

/**
 * shot duration = max(audio duration + 0.4s padding, 2.5s), frame-aligned.
 * Silent shots use the script's estimate (still floored at 2.5s).
 */
export function shotDuration(audioSeconds: number | null | undefined, estSeconds?: number, fps = FPS): number {
  const base = audioSeconds && audioSeconds > 0 ? audioSeconds + DIALOGUE_PADDING_SEC : (estSeconds ?? MIN_SHOT_SEC);
  return toFrames(Math.max(base, MIN_SHOT_SEC), fps) / fps;
}

export function totalDuration(shotSeconds: number[]): number {
  return shotSeconds.reduce((a, b) => a + b, 0);
}

/** Targets for each content type. */
export const TARGETS = {
  STORY: { minSec: 8 * 60, maxSec: 15 * 60, minShots: 120, maxShots: 200, width: 1920, height: 1080, aspect: "16:9" as const },
  SHORT: { minSec: 30, maxSec: 58, minShots: 8, maxShots: 15, width: 1080, height: 1920, aspect: "9:16" as const },
};

/** Rough Hindi speech-rate estimate (≈13 Devanagari characters per second at pace 1.0). */
export function estimateSpeechSeconds(text: string, pace = 1): number {
  const chars = text.replace(/[\s,.!?।…"'-]/g, "").length;
  return chars / 13 / Math.max(0.3, pace);
}

/** Estimated on-screen duration of a scripted shot, before any audio exists. */
export function estimateShotSeconds(shot: { dialogue_hi?: string | null; est_seconds: number }): number {
  const speech = shot.dialogue_hi ? estimateSpeechSeconds(shot.dialogue_hi) : 0;
  return Math.max(MIN_SHOT_SEC, speech ? speech + DIALOGUE_PADDING_SEC : shot.est_seconds);
}
