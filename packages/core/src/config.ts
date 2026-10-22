import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root (where /assets and /data live). */
export const REPO_ROOT = process.env.KAHANI_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Static, process-level configuration (env). Runtime-editable settings live in the Setting table. */
export const config = {
  get repoRoot() {
    return REPO_ROOT;
  },
  get assetsDir() {
    return process.env.ASSETS_DIR ?? path.join(REPO_ROOT, "assets");
  },
  get workDir() {
    return process.env.WORK_DIR ?? path.join(REPO_ROOT, "data", "work");
  },
  get fontsDir() {
    return path.join(this.assetsDir, "fonts");
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get providerMode(): "auto" | "mock" | "live" {
    const m = process.env.PROVIDER_MODE ?? "auto";
    return m === "mock" || m === "live" ? m : "auto";
  },
  get ffmpegPreset() {
    return process.env.FFMPEG_PRESET ?? "veryfast";
  },
  get usdToInr() {
    return num("USD_TO_INR", 88);
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  },
  get geminiImageModel() {
    return process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
  },
  get geminiVisionModel() {
    return process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash";
  },
  get sarvamModel() {
    return process.env.SARVAM_TTS_MODEL ?? "bulbul:v2";
  },
  get elevenMusicModel() {
    return process.env.ELEVENLABS_MUSIC_MODEL ?? "music_v1";
  },
  get falLipsyncModel() {
    return process.env.FAL_LIPSYNC_MODEL ?? "veed/fabric-1.0";
  },
  defaults: {
    get imageConcurrency() {
      return num("IMAGE_CONCURRENCY", 4);
    },
    get ttsConcurrency() {
      return num("TTS_CONCURRENCY", 6);
    },
    get motionConcurrency() {
      return num("MOTION_CONCURRENCY", 2);
    },
  },
};
