import { config } from "../config.js";
import { getSecret, getSettings, type SecretKey } from "../settings.js";
import { prisma } from "../db.js";
import { AnthropicLLM } from "./anthropic.js";
import { GeminiBatch, GeminiImage, GeminiJudge } from "./gemini.js";
import { FalImage } from "./fal-image.js";
import { BytePlusImage } from "./byteplus-image.js";
import { DEFAULT_IMAGE_MODEL, imageModelInfo } from "./image-models.js";
import { SarvamTTS } from "./sarvam.js";
import { FalLipSyncProvider, KenBurnsProvider } from "./motion.js";
import { BytePlusI2VBackend, DashScopeI2VBackend, FalI2VBackend, ImageToVideoProvider } from "./i2v.js";
import { videoModelInfo } from "./video-models.js";
import { YouTubePublisher } from "./youtube.js";
import { MockLLM } from "./mock/llm.js";
import { MockImage, MockImageBatch, MockJudge } from "./mock/image.js";
import { MockTTS } from "./mock/tts.js";
import { MockPublisher } from "./mock/publisher.js";
import { ElevenLabsMusic, MockMusic } from "./music.js";
import type { ImageBatchProvider, ImageProvider, LLMProvider, MotionProvider, MusicProvider, Publisher, TTSProvider, VisionJudge } from "./types.js";

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
  return imageProviderFor(DEFAULT_IMAGE_MODEL());
}

/** Provider for a catalog model id ("gemini:…", "fal:…"). Missing keys fall back to a tinted offline mock in auto mode. */
export async function imageProviderFor(modelId: string): Promise<ImageProvider> {
  const info = imageModelInfo(modelId);
  const [, model] = modelId.split(":");
  if (info.provider === "gemini") {
    const k = await key("GEMINI_API_KEY");
    return k ? new GeminiImage(k, model) : new MockImage(modelId === DEFAULT_IMAGE_MODEL() ? "mock" : modelId);
  }
  if (info.provider === "byteplus") {
    const k = await key("BYTEPLUS_ARK_API_KEY");
    return k ? new BytePlusImage(k, info) : new MockImage(modelId);
  }
  const k = await key("FAL_KEY");
  return k ? new FalImage(k, info) : new MockImage(modelId);
}

export async function imageBatchProviderFor(modelId: string): Promise<ImageBatchProvider> {
  const info = imageModelInfo(modelId);
  if (info.provider !== "gemini") throw new Error(`${modelId} has no batch mode`);
  const k = await key("GEMINI_API_KEY");
  return k ? new GeminiBatch(k, modelId.split(":")[1]) : new MockImageBatch(modelId === DEFAULT_IMAGE_MODEL() ? "mock" : modelId);
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

/** Per-channel motion provider: "kenburns" (default), "lipsync" (fal.ai close-up dialogue) or an "i2v:…" video model. */
export async function motionProvider(channelMotion: string, scope = "closeups"): Promise<MotionProvider> {
  if (channelMotion.startsWith("i2v:")) {
    const info = videoModelInfo(channelMotion);
    const secret = info.provider === "fal" ? "FAL_KEY" : info.provider === "byteplus" ? "BYTEPLUS_ARK_API_KEY" : "DASHSCOPE_API_KEY";
    const k = config.providerMode === "mock" ? undefined : await getSecret(secret);
    if (!k) return new KenBurnsProvider();
    const backend = info.provider === "fal" ? new FalI2VBackend(k, info) : info.provider === "byteplus" ? new BytePlusI2VBackend(k, info) : new DashScopeI2VBackend(k, info);
    return new ImageToVideoProvider(backend, info, scope);
  }
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
