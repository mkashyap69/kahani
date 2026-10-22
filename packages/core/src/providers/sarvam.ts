import { logApiCall } from "../cost.js";
import { NonRetryableError, withRetry } from "../util/retry.js";
import type { CallContext, TTSProvider, TTSRequest } from "./types.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const SARVAM_VOICES: { id: string; label: string; gender: "female" | "male" }[] = [
  { id: "anushka", label: "Anushka — clear, young female", gender: "female" },
  { id: "manisha", label: "Manisha — warm female", gender: "female" },
  { id: "vidya", label: "Vidya — mature female", gender: "female" },
  { id: "arya", label: "Arya — bright female", gender: "female" },
  { id: "abhilash", label: "Abhilash — deep male", gender: "male" },
  { id: "karun", label: "Karun — friendly male", gender: "male" },
  { id: "hitesh", label: "Hitesh — energetic male", gender: "male" },
];

/** Sarvam AI Bulbul text-to-speech (hi-IN). */
export class SarvamTTS implements TTSProvider {
  readonly name = "sarvam";
  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}

  voices() {
    return SARVAM_VOICES;
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
      await logApiCall({ contentItemId: ctx.contentItemId, provider: this.name, model: this.model, operation: ctx.operation ?? "tts", characters: req.text.length });
      return audio;
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, provider: this.name, model: this.model, operation: ctx.operation ?? "tts", success: false, error: String(err) });
      throw err;
    }
  }
}
