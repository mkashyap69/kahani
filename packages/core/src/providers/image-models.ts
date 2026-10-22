/**
 * Image model catalog. A model id is "<provider>:<model>", e.g. "gemini:gemini-2.5-flash-image" or "fal:seedream-4.5".
 * Prices are list-price ESTIMATES in USD per generated image (check the provider's pricing page).
 */
export interface ImageModelInfo {
  id: string;
  label: string;
  provider: "gemini" | "fal";
  /** standard price per image */
  usd: number;
  /** batch price per image (Gemini Batch API only) */
  batchUsd?: number;
  /** fal endpoints: with reference images (edit) and without (text-to-image) */
  falEdit?: string;
  falText?: string;
  maxRefs: number;
  notes: string;
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
    // $0.03 first output MP + $0.015 per extra input/output MP → ~0.06 with 2 refs
    usd: 0.06,
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

export type ShotKind = "default" | "wide" | "medium" | "closeup" | "over_shoulder" | "thumbnail";
export const SHOT_KINDS: ShotKind[] = ["default", "wide", "medium", "closeup", "over_shoulder", "thumbnail"];

/** Channel.imageModels → model id for a shot framing (or "thumbnail"). */
export function modelForShot(imageModels: unknown, kind: string): string {
  const map = (imageModels && typeof imageModels === "object" ? imageModels : {}) as Record<string, string>;
  return map[kind] || map.default || DEFAULT_IMAGE_MODEL();
}
