/**
 * Image model catalog. A model id is "<provider>:<model>", e.g. "gemini:gemini-2.5-flash-image" or "fal:seedream-4.5".
 * Prices are list-price ESTIMATES in USD per generated image (check the provider's pricing page).
 */
export interface ImageModelInfo {
  id: string;
  label: string;
  provider: "gemini" | "fal" | "byteplus" | "apimart" | "evolink";
  /** standard price per image (output) */
  usd: number;
  /** extra price per reference image (models billed per input megapixel) */
  usdPerRef?: number;
  /** BytePlus model id */
  model?: string;
  /** batch price per image (Gemini Batch API only) */
  batchUsd?: number;
  /** fal endpoints: with reference images (edit) and without (text-to-image) */
  falEdit?: string;
  falText?: string;
  maxRefs: number;
  notes: string;
  /** how the endpoint takes the output size (fal models differ) */
  sizeParam?: "image_size" | "resolution_aspect";
}

export const IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: "gemini:gemini-2.5-flash-image",
    label: "Nano Banana (Gemini 2.5 Flash Image)",
    provider: "gemini",
    usd: 0.039,
    batchUsd: 0.0195,
    maxRefs: 6,
    notes: "default; strong character consistency from reference sheets",
  },
  {
    id: "gemini:gemini-3-pro-image-preview",
    label: "Nano Banana Pro (Gemini 3 Pro Image)",
    provider: "gemini",
    usd: 0.134,
    batchUsd: 0.067,
    maxRefs: 6,
    notes: "highest quality, ~3.4× the price — thumbnails / key shots",
  },
  {
    id: "fal:seedream-4.5",
    label: "Seedream 4.5 (ByteDance, via fal)",
    provider: "fal",
    usd: 0.04,
    falEdit: "fal-ai/bytedance/seedream/v4.5/edit",
    falText: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    maxRefs: 10,
    notes: "up to ~10 reference images; good cartoon consistency in tests",
  },
  {
    id: "fal:flux-2-pro",
    label: "FLUX.2 [pro] (via fal)",
    provider: "fal",
    // $0.03 first output MP + $0.015 per extra input MP (references are resized to ~1 MP)
    usd: 0.03,
    usdPerRef: 0.015,
    falEdit: "fal-ai/flux-2-pro/edit",
    falText: "fal-ai/flux-2-pro",
    maxRefs: 4,
    notes: "priced per megapixel; more references cost more",
  },
  {
    id: "fal:qwen-image-edit-2511",
    label: "Qwen Image Edit 2511 (via fal, Apache-2.0 open model)",
    provider: "fal",
    usd: 0.03,
    falEdit: "fal-ai/qwen-image-edit-2511",
    falText: "fal-ai/qwen-image",
    maxRefs: 3,
    notes: "open weights (self-hostable); ~3 references",
  },
  {
    id: "fal:flux-3-image",
    label: "FLUX 3 Image (via fal)",
    provider: "fal",
    usd: 0.048, // 1 MP tier
    falEdit: "blackforestlabs/flux-3/edit-image",
    falText: "blackforestlabs/flux-3/text-to-image",
    maxRefs: 10,
    sizeParam: "resolution_aspect",
    notes: "newest FLUX; 1–10 references; priced by resolution tier",
  },
  {
    id: "fal:flux-3-klein",
    label: "FLUX 3 Image Klein (via fal)",
    provider: "fal",
    // listed $0.008–0.036 by resolution tier (fal marks these as planned prices); ~1 MP estimate
    usd: 0.016,
    falEdit: "blackforestlabs/flux-3/klein/edit-image",
    falText: "blackforestlabs/flux-3/klein/text-to-image",
    maxRefs: 4,
    sizeParam: "image_size",
    notes: "small and cheap — test on wides/backgrounds; consistency unproven",
  },
  {
    id: "fal:flux-2-klein-4b",
    label: "FLUX.2 [klein] 4B (via fal)",
    provider: "fal",
    // ~$0.005 per megapixel of output AND input (references resized to ~1 MP)
    usd: 0.005,
    usdPerRef: 0.005,
    falEdit: "fal-ai/flux-2/klein/4b/edit",
    falText: "fal-ai/flux-2/klein/4b",
    maxRefs: 4,
    sizeParam: "image_size",
    notes: "very cheap, Apache-2.0; small model — check characters stay on-model",
  },
  {
    id: "fal:z-image-turbo",
    label: "Z-Image Turbo (via fal) — shots without characters only",
    provider: "fal",
    usd: 0.005, // ~$0.005 per megapixel
    falText: "fal-ai/z-image/turbo",
    maxRefs: 0,
    sizeParam: "image_size",
    notes: "text-to-image only (no reference sheets) — for establishing shots / empty scenes",
  },
  {
    id: "byteplus:seedream-4.0",
    label: "Seedream 4.0 (BytePlus ModelArk)",
    provider: "byteplus",
    model: process.env.SEEDREAM_4_MODEL ?? "seedream-4-0-250828",
    usd: 0.03,
    maxRefs: 10,
    notes: "official price; multi-reference; older than 4.5",
  },
  {
    id: "byteplus:seedream-5.0-lite",
    label: "Seedream 5.0 Lite (BytePlus ModelArk)",
    provider: "byteplus",
    model: process.env.SEEDREAM_5_LITE_MODEL ?? "seedream-5-0-lite-260128",
    usd: 0.035,
    maxRefs: 14,
    notes: "newer, up to ~14 references",
  },
  {
    id: "apimart:nano-banana",
    label: "Nano Banana via APIMart (gateway)",
    provider: "apimart",
    model: process.env.APIMART_NANO_BANANA_MODEL ?? "gemini-2.5-flash-image",
    usd: 0.0125, // APIMart listed price; official route only
    maxRefs: 6,
    notes: "reseller price, results immediately; falls back to Google on failure",
  },
  {
    id: "evolink:nano-banana",
    label: "Nano Banana via EvoLink (gateway)",
    provider: "evolink",
    model: process.env.EVOLINK_NANO_BANANA_MODEL ?? "gemini-2.5-flash-image",
    usd: 0.02, // estimate — check EvoLink's pricing page
    maxRefs: 6,
    notes: "reseller; falls back to Google on failure",
  },
];

export const DEFAULT_IMAGE_MODEL = () => `gemini:${process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image"}`;

export function imageModelInfo(id: string): ImageModelInfo {
  const known = IMAGE_MODELS.find((m) => m.id === id);
  if (known) return known;
  const [provider, model] = id.split(":");
  // unknown Gemini model ids are allowed (new releases); fal ids must be in the catalog
  if (provider === "gemini" && model) return { id, label: model, provider: "gemini", usd: 0.039, batchUsd: 0.0195, maxRefs: 6, notes: "custom Gemini image model" };
  throw new Error(`unknown image model "${id}"`);
}

export type ShotKind = "default" | "wide" | "medium" | "closeup" | "over_shoulder" | "empty" | "thumbnail";
export const SHOT_KINDS: ShotKind[] = ["default", "wide", "medium", "closeup", "over_shoulder", "empty", "thumbnail"];

const takesRefs = (id: string) => {
  try {
    return imageModelInfo(id).maxRefs > 0;
  } catch {
    return false;
  }
};

/**
 * Channel.imageModels → model id for a shot. "empty" (no characters in frame) wins for character-free shots;
 * a model that can't take reference sheets is never used for a shot with characters.
 */
export function modelForShot(imageModels: unknown, kind: string, opts: { characters?: number } = {}): string {
  const map = (imageModels && typeof imageModels === "object" ? imageModels : {}) as Record<string, string>;
  const chars = opts.characters ?? 1;
  const candidates = [chars === 0 ? map.empty : undefined, map[kind], map.default, DEFAULT_IMAGE_MODEL()].filter(Boolean) as string[];
  return candidates.find((m) => chars === 0 || takesRefs(m)) ?? DEFAULT_IMAGE_MODEL();
}
