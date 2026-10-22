import { config } from "../config.js";
import { getSecret, getSettings, type SecretKey } from "../settings.js";
import { prisma } from "../db.js";
import { AnthropicLLM } from "./anthropic.js";
import { GeminiImage, GeminiJudge } from "./gemini.js";
import { SarvamTTS } from "./sarvam.js";
import { FalLipSyncProvider, KenBurnsProvider } from "./motion.js";
import { YouTubePublisher } from "./youtube.js";
import { MockLLM } from "./mock/llm.js";
import { MockImage, MockJudge } from "./mock/image.js";
import { MockTTS } from "./mock/tts.js";
import { MockPublisher } from "./mock/publisher.js";
import { ElevenLabsMusic, MockMusic } from "./music.js";
import type { ImageProvider, LLMProvider, MotionProvider, MusicProvider, Publisher, TTSProvider, VisionJudge } from "./types.js";

async function key(name: SecretKey): Promise<string | undefined> {
  if (config.providerMode === "mock") return undefined;
  const v = await getSecret(name);
  if (!v && config.providerMode === "live") throw new Error(`PROVIDER_MODE=live but ${name} is not configured`);
  return v;
}

export async function llmProvider(): Promise<LLMProvider> {
  const k = await key("ANTHROPIC_API_KEY");
  return k ? new AnthropicLLM(k, (await getSettings()).anthropicModel) : new MockLLM();
}

export async function imageProvider(): Promise<ImageProvider> {
  const k = await key("GEMINI_API_KEY");
  return k ? new GeminiImage(k, config.geminiImageModel) : new MockImage();
}

export async function visionJudge(): Promise<VisionJudge> {
  const k = await key("GEMINI_API_KEY");
  return k ? new GeminiJudge(k, config.geminiVisionModel) : new MockJudge();
}

export async function ttsProvider(): Promise<TTSProvider> {
  const k = await key("SARVAM_API_KEY");
  return k ? new SarvamTTS(k, config.sarvamModel) : new MockTTS();
}

export async function musicProvider(): Promise<MusicProvider> {
  const k = await key("ELEVENLABS_API_KEY");
  return k ? new ElevenLabsMusic(k, config.elevenMusicModel) : new MockMusic();
}

/** Per-channel motion provider: "kenburns" (default) or "lipsync" (fal.ai for close-up dialogue). */
export async function motionProvider(channelMotion: string): Promise<MotionProvider> {
  if (channelMotion === "lipsync") {
    const k = config.providerMode === "mock" ? undefined : await getSecret("FAL_KEY");
    if (k) return new FalLipSyncProvider(k, config.falLipsyncModel);
  }
  return new KenBurnsProvider();
}

/** Real YouTube when the channel is connected, otherwise the local mock publisher. */
export async function publisherFor(channelId: string): Promise<Publisher> {
  const ch = await prisma.channel.findUnique({ where: { id: channelId }, select: { oauthTokensEnc: true } });
  if (ch?.oauthTokensEnc && config.providerMode !== "mock") return new YouTubePublisher();
  if (config.providerMode === "live") throw new Error("Channel is not connected to YouTube");
  return new MockPublisher();
}

export async function providerSummary() {
  const [llm, img, tts, music] = await Promise.all([llmProvider(), imageProvider(), ttsProvider(), musicProvider()]);
  return { llm: `${llm.name}:${llm.model}`, image: `${img.name}:${img.model}`, tts: `${tts.name}:${tts.model}`, music: `${music.name}:${music.model}`, mode: config.providerMode };
}
