import { z } from "zod";

export const FRAMINGS = ["wide", "medium", "closeup", "over_shoulder"] as const;
export const TIMES_OF_DAY = ["dawn", "day", "evening", "night"] as const;

const slug = z
  .string()
  .min(1)
  .transform((s) => s.trim().toLowerCase().replace(/[\s-]+/g, "_"));

export const ShotSchema = z.object({
  id: z.number().int().positive(),
  location: slug,
  time_of_day: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.enum(TIMES_OF_DAY).catch("day")),
  framing: z
    .string()
    .transform((s) => s.trim().toLowerCase().replace(/[\s-]+/g, "_"))
    .pipe(z.enum(FRAMINGS)),
  characters_in_frame: z.array(slug).max(5),
  speaker: z.union([slug, z.null()]).default(null),
  dialogue_hi: z.string().default(""),
  emotion: z.string().min(1),
  action: z.string().min(1),
  image_prompt_en: z.string().min(10),
  sfx: z.string().nullable().optional().transform((s) => (s && s.trim() ? s.trim() : null)),
  est_seconds: z.number().positive().max(20),
})
  .superRefine((shot, ctx) => {
    if (shot.speaker && !shot.dialogue_hi.trim()) ctx.addIssue({ code: "custom", path: ["dialogue_hi"], message: "speaker set but dialogue_hi is empty" });
    if (!shot.speaker && shot.dialogue_hi.trim()) ctx.addIssue({ code: "custom", path: ["speaker"], message: "dialogue_hi present but speaker is null" });
    if (shot.dialogue_hi && !/[\u0900-\u097F]/.test(shot.dialogue_hi)) ctx.addIssue({ code: "custom", path: ["dialogue_hi"], message: "dialogue_hi must be in Devanagari" });
    const words = shot.dialogue_hi.trim().split(/\s+/).filter(Boolean).length;
    if (words > 28) ctx.addIssue({ code: "custom", path: ["dialogue_hi"], message: `line too long (${words} words, max ~20)` });
    if (shot.speaker && shot.speaker !== "narrator" && shot.framing === "closeup" && shot.characters_in_frame.length === 0) {
      ctx.addIssue({ code: "custom", path: ["speaker"], message: "closeup speaker must be in frame" });
    }
  });

export const ScriptSchema = z
  .object({
    title_hi: z.string().min(1),
    title_en: z.string().min(1),
    logline: z.string().min(1),
    moral: z.string().default(""),
    shots: z.array(ShotSchema).min(3),
    memory_update: z.string().min(1),
    youtube: z.object({
      title: z.string().min(1).max(100),
      description: z.string().min(1).max(5000),
      tags: z.array(z.string()).max(40),
      thumbnail_prompt: z.string().min(5),
    }),
  });

export type Script = z.infer<typeof ScriptSchema>;
export type ScriptShot = z.infer<typeof ShotSchema>;

export interface ScriptContext {
  characterKeys: string[];
  locationKeys: string[];
  minShots: number;
  maxShots: number;
}

export type ValidationResult = { ok: true; script: Script } | { ok: false; errors: string[] };

/** Parse model output (may be wrapped in prose or ``` fences) and validate it. */
export function validateScript(raw: unknown, ctx?: ScriptContext): ValidationResult {
  let value = raw;
  if (typeof raw === "string") {
    const json = extractJson(raw);
    if (!json) return { ok: false, errors: ["response did not contain a JSON object"] };
    try {
      value = JSON.parse(json);
    } catch (e) {
      return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
    }
  }
  const parsed = ScriptSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 25).map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const script = parsed.data;
  const errors: string[] = [];
  if (ctx) {
    const chars = new Set(ctx.characterKeys);
    const locs = new Set(ctx.locationKeys);
    script.shots.forEach((s, i) => {
      if (!locs.has(s.location)) errors.push(`shots.${i}.location: unknown location "${s.location}" (use one of ${[...locs].join(", ")})`);
      for (const c of s.characters_in_frame) if (!chars.has(c)) errors.push(`shots.${i}.characters_in_frame: unknown character "${c}"`);
      if (s.speaker && s.speaker !== "narrator" && !chars.has(s.speaker)) errors.push(`shots.${i}.speaker: unknown speaker "${s.speaker}"`);
    });
    if (script.shots.length < ctx.minShots) errors.push(`too few shots: ${script.shots.length} < ${ctx.minShots}`);
    if (script.shots.length > ctx.maxShots) errors.push(`too many shots: ${script.shots.length} > ${ctx.maxShots}`);
  }
  // renumber ids sequentially so downstream indexing is stable
  script.shots.forEach((s, i) => (s.id = i + 1));
  return errors.length ? { ok: false, errors: errors.slice(0, 25) } : { ok: true, script };
}

export function extractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}
