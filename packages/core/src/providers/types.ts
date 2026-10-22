/** Every provider call carries the content item it is billed to. */
export interface CallContext {
  contentItemId?: string | null;
  /** billed to a channel launch kit instead of a content item */
  launchKitId?: string | null;
  operation?: string;
}

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  /** optional images for vision checks */
  images?: { mime: string; data: Buffer }[];
  /** "low" for cheap checks, "high" for script writing */
  effort?: "low" | "medium" | "high";
  /** let the model research the live web (Anthropic server-side web search) */
  webSearch?: { maxUses: number };
}

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason?: string | null;
  /** pages the model read while researching */
  sources?: { title: string; url: string }[];
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LLMRequest, ctx: CallContext): Promise<LLMResponse>;
}

export type Aspect = "16:9" | "9:16" | "1:1";

export interface ImageRequest {
  prompt: string;
  /** PNG/JPEG reference images (character sheets, location plate) */
  references: { mime: string; data: Buffer; label?: string }[];
  aspect: Aspect;
  /** used by the mock renderer for readable placeholder frames */
  meta?: { title?: string; characters?: string[]; location?: string; emotion?: string; kind?: string };
}

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  generate(req: ImageRequest, ctx: CallContext): Promise<{ data: Buffer; mime: string }>;
}

export interface VisionJudge {
  readonly name: string;
  /** 1–10: how well the frame matches the character sheets */
  scoreConsistency(
    frame: Buffer,
    references: { mime: string; data: Buffer; label?: string }[],
    description: string,
    ctx: CallContext,
  ): Promise<{ score: number; reason: string }>;
}

export interface TTSRequest {
  text: string;
  speaker: string;
  pitch: number;
  pace: number;
  loudness: number;
  language: string;
}

export interface TTSProvider {
  readonly name: string;
  readonly model: string;
  /** returns WAV bytes */
  synthesize(req: TTSRequest, ctx: CallContext): Promise<Buffer>;
  voices(): { id: string; label: string; gender: "female" | "male" }[];
}

export interface MusicRequest {
  prompt: string;
  lengthSec: number;
  instrumental: boolean;
  /** used by the offline mock to vary the synthesised track */
  mood?: string;
}

/** Background-music generator (e.g. ElevenLabs Eleven Music). */
export interface MusicProvider {
  readonly name: string;
  readonly model: string;
  /** commercial-use note stored with each generated track */
  readonly license: string;
  generate(req: MusicRequest, ctx: CallContext): Promise<{ data: Buffer; mime: string; ext: string }>;
}

export interface MotionRequest {
  imagePath: string;
  /** normalised dialogue audio, when the shot has a line */
  audioPath?: string | null;
  outPath: string;
  durationSec: number;
  framing: string;
  speaking: boolean;
  width: number;
  height: number;
  fps: number;
  /** deterministic variety between shots */
  seed: number;
  /** what the shot shows / says — used by image-to-video models */
  prompt?: string;
  contentType?: "STORY" | "SHORT";
}

export interface MotionProvider {
  readonly name: string;
  /** whether this provider wants to handle this shot (others fall back to Ken Burns) */
  handles(req: Pick<MotionRequest, "framing" | "speaking" | "contentType">): boolean;
  /** writes a silent H.264 clip of exactly durationSec to outPath */
  animate(req: MotionRequest, ctx: CallContext): Promise<void>;
}

export interface PublishRequest {
  videoPath: string;
  thumbnailPath?: string | null;
  title: string;
  description: string;
  tags: string[];
  publishAt?: Date | null;
  madeForKids: boolean;
  /** YouTube "altered or synthetic content" disclosure — always true for this studio */
  containsSyntheticMedia: true;
  language: string;
  /** add the upload to this playlist */
  playlistId?: string | null;
  /** resumable upload session URI from a previous attempt */
  resumeSession?: string | null;
  onSession?: (uri: string) => Promise<void>;
}

export interface Publisher {
  readonly name: string;
  publish(channelId: string, req: PublishRequest, ctx: CallContext): Promise<{ videoId: string; url: string }>;
}

export interface BatchImageRequest {
  key: string;
  prompt: string;
  references: { mime: string; data: Buffer; label?: string }[];
  aspect: Aspect;
  meta?: ImageRequest["meta"];
}

export type BatchPoll =
  | { done: false; state?: string }
  | { done: true; failed: string }
  | { done: true; results: Map<string, { data: Buffer; mime: string } | { error: string }>; failed?: undefined };

/** Asynchronous, discounted image generation (e.g. Gemini Batch API). */
export interface ImageBatchProvider {
  readonly name: string;
  readonly model: string;
  submit(requests: BatchImageRequest[], label: string): Promise<string>;
  poll(job: string): Promise<BatchPoll>;
  cancel(job: string): Promise<void>;
}
