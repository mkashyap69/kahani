import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logApiCall } from "../cost.js";
import { ffmpeg } from "../media/ffmpeg.js";
import { hashOf } from "../util/crypto.js";
import { NonRetryableError, withRetry } from "../util/retry.js";
import type { CallContext, MusicProvider, MusicRequest } from "./types.js";

/**
 * ElevenLabs Eleven Music (POST /v1/music). Paid plans allow broad commercial use of generated tracks;
 * check ElevenLabs' Eleven Music terms for your plan before monetising.
 */
export class ElevenLabsMusic implements MusicProvider {
  readonly name = "elevenlabs";
  readonly license = "Generated with ElevenLabs Eleven Music — commercial use per your ElevenLabs plan's Eleven Music terms";
  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}

  async generate(req: MusicRequest, ctx: CallContext) {
    const lengthMs = Math.round(Math.min(600, Math.max(10, req.lengthSec)) * 1000);
    try {
      const data = await withRetry(
        async () => {
          const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
            method: "POST",
            headers: { "xi-api-key": this.apiKey, "content-type": "application/json" },
            body: JSON.stringify({ prompt: req.prompt.slice(0, 4000), music_length_ms: lengthMs, model_id: this.model, force_instrumental: req.instrumental }),
          });
          if (!res.ok) {
            const text = await res.text();
            const err = res.status >= 400 && res.status < 500 && res.status !== 429 ? new NonRetryableError(`ElevenLabs ${res.status}: ${text}`) : new Error(`ElevenLabs ${res.status}: ${text}`);
            throw Object.assign(err, { status: res.status });
          }
          return Buffer.from(await res.arrayBuffer());
        },
        { retries: 3, baseMs: 3000 },
      );
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "music", seconds: lengthMs / 1000 });
      return { data, mime: "audio/mpeg", ext: "mp3" };
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "music", success: false, error: String(err) });
      throw err;
    }
  }
}

// mood → [root Hz, scale (semitones), beat seconds, drone level]
const MOODS: Record<string, [number, number[], number, number]> = {
  warm: [220, [0, 2, 4, 7, 9, 7, 4, 2], 0.5, 0.09],
  playful: [261.6, [0, 4, 7, 12, 9, 7, 4, 2], 0.25, 0.05],
  suspense: [110, [0, 1, 5, 6, 0, 3, 1, 0], 1, 0.14],
  emotional: [196, [0, 3, 7, 10, 8, 7, 3, 2], 0.75, 0.1],
  festive: [293.7, [0, 2, 4, 5, 7, 9, 11, 12], 0.25, 0.06],
  calm: [174.6, [0, 2, 4, 7, 9, 12, 9, 7], 1, 0.08],
};
export function moodOf(text: string): keyof typeof MOODS {
  const t = text.toLowerCase();
  if (/suspense|horror|bhoot|mystery|night|spooky|tense/.test(t)) return "suspense";
  if (/playful|funny|comic|kids|bouncy|cartoon|chase/.test(t)) return "playful";
  if (/sad|emotional|tender|moral|heart/.test(t)) return "emotional";
  if (/festive|celebrat|wedding|dhol|festival/.test(t)) return "festive";
  if (/calm|lullaby|peace|soft|ambient/.test(t)) return "calm";
  return "warm";
}

/** Offline placeholder: synthesises a mood-matched loop with FFmpeg (no licence concerns, clearly not production music). */
export class MockMusic implements MusicProvider {
  readonly name = "mock-music";
  readonly model = "ffmpeg-synth";
  readonly license = "Synthesised placeholder (no third-party rights) — replace with licensed music";
  async generate(req: MusicRequest, ctx: CallContext) {
    const [root, scale, beat, drone] = MOODS[req.mood ?? moodOf(req.prompt)];
    const shift = parseInt(hashOf(req.prompt).slice(0, 2), 16) % 5; // vary key per prompt
    const f0 = root * Math.pow(2, shift / 12);
    const notes = scale.map((n, i) => `eq(mod(floor(t/${beat}),${scale.length}),${i})*${n}`).join("+");
    const expr = `${drone}*sin(2*PI*${(f0 / 2).toFixed(2)}*t)+${(drone * 0.6).toFixed(3)}*sin(2*PI*${(f0 * 0.75).toFixed(2)}*t)+0.2*exp(-${(2.5 / beat).toFixed(2)}*mod(t,${beat}))*sin(2*PI*${f0.toFixed(2)}*pow(2,(${notes})/12)*t)`;
    const dur = Math.min(120, Math.max(10, Math.round(req.lengthSec)));
    const out = path.join(os.tmpdir(), `kahani-music-${hashOf([req.prompt, dur]).slice(0, 10)}.m4a`);
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `aevalsrc='${expr}':s=48000:d=${dur}`,
      "-af",
      `aecho=0.8:0.7:60:0.25,lowpass=f=6000,afade=t=in:d=1,afade=t=out:st=${dur - 2}:d=2,aformat=channel_layouts=stereo,loudnorm=I=-20`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      out,
    ]);
    const data = await fs.readFile(out);
    await fs.rm(out, { force: true });
    await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "music", seconds: dur });
    return { data, mime: "audio/mp4", ext: "m4a" };
  }
}
