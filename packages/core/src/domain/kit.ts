import { z } from "zod";
import { extractJson } from "./script.js";

const slug = z
  .string()
  .min(1)
  .transform((s) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40),
  );
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/).catch("18:00");
const text = (min = 1) => z.string().trim().min(min);

export const VoiceSchema = z.object({
  speaker: z.string().trim().toLowerCase(),
  pitch: z.coerce.number().catch(0),
  pace: z.coerce.number().catch(1),
  loudness: z.coerce.number().catch(1),
  rationale: z.string().default(""),
});

export const KitCharacterSchema = z.object({
  key: slug,
  name: text(),
  role: text(),
  age: z.coerce.number().int().min(1).max(120).nullable().catch(null),
  gender: z.enum(["female", "male", "other"]).catch("other"),
  personality: text(10),
  speechStyle: text(10),
  catchphrases: z.array(z.string()).max(6).default([]),
  visualDescription: text(60),
  voice: VoiceSchema,
});

export const KitLocationSchema = z.object({ key: slug, name: text(), description: text(30) });

export const KitSchema = z
  .object({
    channel: z.object({
      nameOptions: z
        .array(z.object({ name: text(), nameHi: z.string().default(""), handle: z.string().default(""), rationale: z.string().default("") }))
        .min(3)
        .max(6),
      tagline: text(),
      descriptionHi: text(20),
      descriptionEn: text(20),
      keywords: z.array(z.string()).max(30).default([]),
      targetAudience: text(),
      madeForKids: z.boolean().catch(false),
      shortsMode: z.enum(["TEASER", "MINI_STORY"]).catch("TEASER"),
      storyTargetMinutes: z.coerce.number().int().min(8).max(15).catch(10),
      publishTimes: z.object({ story: hhmm, short1: hhmm, short2: hhmm }).catch({ story: "18:00", short1: "12:00", short2: "20:30" }),
    }),
    theme: z.object({
      name: text(),
      genre: text(),
      artStylePrompt: text(40),
      negativeStyle: z.string().default(""),
      tone: text(),
      targetAudience: text(),
      contentRules: text(20),
      kidSafe: z.boolean().catch(false),
    }),
    storyline: z.object({
      premise: text(80),
      worldRules: text(20),
      characterArcs: text(20),
      runningGags: text(10),
      forbiddenTopics: z.string().default(""),
      openThreads: z.array(z.string()).max(10).default([]),
      firstEpisodeIdeas: z.array(z.string()).max(10).default([]),
    }),
    characters: z.array(KitCharacterSchema).min(3).max(8),
    narrator: VoiceSchema,
    locations: z.array(KitLocationSchema).min(3).max(8),
    music: z.object({
      direction: text(10),
      tracks: z.array(z.object({ title: text(), mood: z.string().default("warm"), prompt: text(20), lengthSec: z.coerce.number().min(20).max(240).catch(90) })).min(1).max(6),
    }),
    branding: z.object({
      logoPrompt: text(20),
      bannerPrompt: text(20),
      colorPalette: z.array(z.string()).max(8).default([]),
      thumbnailStyleNotes: z.string().default(""),
    }),
  })
  .superRefine((kit, ctx) => {
    const dupe = (arr: string[]) => arr.find((k, i) => arr.indexOf(k) !== i);
    const ck = dupe(kit.characters.map((c) => c.key));
    if (ck) ctx.addIssue({ code: "custom", path: ["characters"], message: `duplicate character key "${ck}"` });
    const lk = dupe(kit.locations.map((l) => l.key));
    if (lk) ctx.addIssue({ code: "custom", path: ["locations"], message: `duplicate location key "${lk}"` });
    if (kit.characters.some((c) => c.key === "narrator")) ctx.addIssue({ code: "custom", path: ["characters"], message: '"narrator" is reserved' });
  });

export type Kit = z.infer<typeof KitSchema>;
export type KitCharacter = z.infer<typeof KitCharacterSchema>;

export const ResearchSchema = z.object({
  summary: text(20),
  audience: z.string().default(""),
  competitors: z.array(z.object({ name: z.string(), whatWorks: z.string().default(""), url: z.string().default("") })).max(15).default([]),
  formatsThatWork: z.array(z.string()).default([]),
  titleThumbnailPatterns: z.array(z.string()).default([]),
  culturalDetails: z.array(z.string()).default([]),
  visualStyle: z.array(z.string()).default([]),
  musicStyle: z.array(z.string()).default([]),
  voiceActing: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  namesToAvoid: z.array(z.string()).default([]),
  sources: z.array(z.object({ title: z.string().default(""), url: z.string() })).default([]),
});
export type Research = z.infer<typeof ResearchSchema>;

export const ReviewSchema = z.object({
  issues: z.array(z.object({ area: z.string(), problem: z.string(), fix: z.string().default("") })).default([]),
  nameChecks: z.array(z.object({ name: z.string(), conflict: z.boolean().catch(false), note: z.string().default("") })).default([]),
  kit: z.unknown(),
});

export function parseJsonWith<S extends z.ZodTypeAny>(schema: S, raw: unknown): { ok: true; value: z.output<S> } | { ok: false; errors: string[] } {
  let value = raw;
  if (typeof raw === "string") {
    const json = extractJson(raw);
    if (!json) return { ok: false, errors: ["no JSON object in response"] };
    try {
      value = JSON.parse(json);
    } catch (e) {
      return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
    }
  }
  const r = schema.safeParse(value);
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: r.error.issues.slice(0, 25).map((i) => `${i.path.join(".")}: ${i.message}`) };
}
