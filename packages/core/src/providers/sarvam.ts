import { logApiCall } from "../cost.js";
import { NonRetryableError, withRetry } from "../util/retry.js";
import type { CallContext, TTSProvider, TTSRequest } from "./types.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface VoiceInfo {
  id: string;
  label: string;
  gender: "female" | "male";
  /** tone hints used by the automatic voice caster */
  tags?: string[];
}

/** Bulbul v2 speakers (support pitch / pace / loudness). */
export const SARVAM_VOICES: VoiceInfo[] = [
  { id: "anushka", label: "Anushka — clear, young female", gender: "female", tags: ["young", "bright"] },
  { id: "manisha", label: "Manisha — warm female", gender: "female", tags: ["warm", "narrator"] },
  { id: "vidya", label: "Vidya — mature female", gender: "female", tags: ["mature", "elderly", "narrator"] },
  { id: "arya", label: "Arya — bright female", gender: "female", tags: ["young", "child", "energetic"] },
  { id: "abhilash", label: "Abhilash — deep male", gender: "male", tags: ["deep", "mature", "elderly"] },
  { id: "karun", label: "Karun — friendly male", gender: "male", tags: ["friendly", "adult", "narrator"] },
  { id: "hitesh", label: "Hitesh — energetic male", gender: "male", tags: ["young", "energetic", "child"] },
];

/**
 * Bulbul v3 speakers (pace + temperature; no pitch/loudness). Source: Sarvam REST docs.
 * Genders marked * come from third-party plugin docs — confirm with "Preview voice".
 */
const V3_MALE = ["shubh", "aditya", "rahul", "rohan", "amit", "dev", "ratan", "varun", "manan", "sumit", "kabir", "aayan", "ashutosh", "advait"];
const V3_MALE_UNVERIFIED = ["anand", "tarun", "sunny", "mani", "gokul", "vijay", "mohit", "rehan", "soham"];
const V3_FEMALE = ["ritu", "priya", "neha", "pooja", "simran", "kavya", "ishita", "shreya", "roopa", "tanya", "shruti", "suhani", "kavitha", "rupali"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
export const SARVAM_V3_VOICES: VoiceInfo[] = [
  ...V3_FEMALE.map((id) => ({ id, label: `${cap(id)} — female`, gender: "female" as const })),
  ...V3_MALE.map((id) => ({ id, label: `${cap(id)} — male${id === "shubh" ? " (default)" : ""}`, gender: "male" as const })),
  ...V3_MALE_UNVERIFIED.map((id) => ({ id, label: `${cap(id)} — male*`, gender: "male" as const })),
];

/** Voices available for the configured Sarvam model. */
export function voiceCatalog(model = process.env.SARVAM_TTS_MODEL ?? "bulbul:v2"): VoiceInfo[] {
  return model.startsWith("bulbul:v3") ? SARVAM_V3_VOICES : SARVAM_VOICES;
}

export interface VoiceChoice {
  speaker: string;
  pitch: number;
  pace: number;
  loudness: number;
}

/**
 * Make a model-proposed cast valid: unknown speakers are replaced by a voice of the right gender,
 * and main characters get distinct voices whenever the catalog allows it.
 */
export function castVoices<T extends { gender?: string; age?: number | null; voice: VoiceChoice }>(chars: T[], catalog = voiceCatalog()): T[] {
  const used = new Set<string>();
  const pickFor = (gender: string | undefined, age: number | null | undefined) => {
    const g = gender === "male" ? "male" : "female";
    const want = age != null && age < 14 ? ["child", "young"] : age != null && age > 55 ? ["elderly", "mature", "deep"] : ["adult", "friendly", "warm", "bright"];
    const pool = catalog.filter((v) => v.gender === g);
    const scored = pool
      .map((v) => ({ v, s: (used.has(v.id) ? -10 : 0) + (v.tags ?? []).filter((t) => want.includes(t)).length }))
      .sort((a, b) => b.s - a.s);
    return scored[0]?.v.id ?? catalog[0].id;
  };
  return chars.map((c) => {
    const known = catalog.find((v) => v.id === c.voice.speaker?.toLowerCase());
    const genderOk = !known || !c.gender || c.gender === "other" || known.gender === c.gender;
    const tags = known?.tags ?? [];
    const ageClash =
      (c.age != null && c.age < 16 && tags.some((t) => ["deep", "mature", "elderly"].includes(t))) ||
      (c.age != null && c.age > 55 && tags.some((t) => ["child", "young", "energetic"].includes(t)));
    const speaker = known && genderOk && !ageClash && !used.has(known.id) ? known.id : pickFor(c.gender ?? known?.gender, c.age);
    used.add(speaker);
    return {
      ...c,
      voice: {
        speaker,
        pitch: Math.max(-0.75, Math.min(0.75, Number(c.voice.pitch) || 0)),
        pace: Math.max(0.5, Math.min(2, Number(c.voice.pace) || 1)),
        loudness: Math.max(0.3, Math.min(3, Number(c.voice.loudness) || 1)),
      },
    };
  });
}

/** Sarvam AI Bulbul text-to-speech (hi-IN). */
export class SarvamTTS implements TTSProvider {
  readonly name = "sarvam";
  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}

  voices() {
    return voiceCatalog(this.model);
  }

  async synthesize(req: TTSRequest, ctx: CallContext): Promise<Buffer> {
    const v2 = this.model.startsWith("bulbul:v2");
    const body: Record<string, unknown> = {
      text: req.text,
      target_language_code: req.language || "hi-IN",
      speaker: req.speaker,
      pace: clamp(req.pace, 0.3, v2 ? 3 : 2),
      speech_sample_rate: 24000,
      model: this.model,
    };
    if (v2) {
      // pitch / loudness are Bulbul v2 controls
      body.pitch = clamp(req.pitch, -0.75, 0.75);
      body.loudness = clamp(req.loudness, 0.3, 3);
      body.enable_preprocessing = true;
    }
    try {
      const audio = await withRetry(
        async () => {
          const res = await fetch("https://api.sarvam.ai/text-to-speech", {
            method: "POST",
            headers: { "api-subscription-key": this.apiKey, "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const text = await res.text();
            const err = res.status >= 400 && res.status < 500 && res.status !== 429 ? new NonRetryableError(text) : new Error(text);
            (err as Error & { status?: number }).status = res.status;
            throw err;
          }
          const json = (await res.json()) as { audios?: string[] };
          if (!json.audios?.length) throw new Error("Sarvam returned no audio");
          return Buffer.from(json.audios[0], "base64");
        },
        { retries: 4, baseMs: 1500 },
      );
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "tts", characters: req.text.length });
      return audio;
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "tts", success: false, error: String(err) });
      throw err;
    }
  }
}
