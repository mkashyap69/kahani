import { encodeWav } from "../../media/wav.js";
import { estimateSpeechSeconds } from "../../domain/duration.js";
import { logApiCall } from "../../cost.js";
import { SARVAM_V3_VOICES, SARVAM_VOICES, voiceCatalog } from "../sarvam.js";
import type { CallContext, TTSProvider, TTSRequest } from "../types.js";

/** Synthesises a "babble" voice (pitch per speaker, syllable rhythm) so timing behaves like real speech. */
export function synthBabble(req: TTSRequest, sampleRate = 24000): Buffer {
  const female = [...SARVAM_VOICES, ...SARVAM_V3_VOICES].find((v) => v.id === req.speaker)?.gender !== "male";
  const base = (female ? 210 : 120) * Math.pow(2, req.pitch * 0.5);
  const seconds = Math.max(0.6, estimateSpeechSeconds(req.text, req.pace));
  const n = Math.round(seconds * sampleRate);
  const samples = new Int16Array(n);
  const syll = 4.2 * req.pace;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = base * (1 + 0.08 * Math.sin(2 * Math.PI * 1.3 * t));
    phase += (2 * Math.PI * f) / sampleRate;
    const env = Math.max(0, Math.sin(Math.PI * ((t * syll) % 1))) ** 0.6;
    const edge = Math.min(1, t / 0.05, (seconds - t) / 0.08);
    const v = (Math.sin(phase) * 0.6 + Math.sin(2 * phase) * 0.25 + Math.sin(3 * phase) * 0.1) * env * edge * 0.5 * req.loudness;
    samples[i] = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
  }
  return encodeWav({ sampleRate, channels: 1, samples });
}

export class MockTTS implements TTSProvider {
  readonly name = "mock-tts";
  readonly model = "mock";
  voices() {
    return voiceCatalog();
  }
  async synthesize(req: TTSRequest, ctx: CallContext) {
    await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "tts", characters: req.text.length });
    return synthBabble(req);
  }
}
