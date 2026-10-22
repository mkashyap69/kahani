import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { KitStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { storage } from "../storage/index.js";
import { imageProvider, llmProvider, musicProvider } from "../providers/registry.js";
import { castVoices, voiceCatalog } from "../providers/sarvam.js";
import type { LLMMessage, LLMProvider } from "../providers/types.js";
import { KitSchema, ResearchSchema, ReviewSchema, parseJsonWith, type Kit, type Research } from "../domain/kit.js";
import { buildKitPrompt, buildKitReviewPrompt, buildResearchPrompt, type KitBrief } from "../prompts/launch.js";
import { buildCardAss } from "../media/subtitles.js";
import { ffmpeg, probeDuration } from "../media/ffmpeg.js";
import { errMsg, logger } from "../util/log.js";
import type { z } from "zod";

const log = logger("launch-kit");

export const KIT_STEPS = ["research", "write", "review", "art", "music"] as const;
export type KitStep = (typeof KIT_STEPS)[number];
const STEP_STATUS: Record<KitStep, KitStatus> = { research: "RESEARCHING", write: "WRITING", review: "REVIEWING", art: "ART", music: "MUSIC" };

export const kitPack = (kitId: string) => `kit-${kitId}`;
const briefOf = (k: { idea: string; language: string; audience: string; kidSafe: boolean; notes: string }): KitBrief => ({
  idea: k.idea,
  language: k.language,
  audience: k.audience,
  kidSafe: k.kidSafe,
  notes: k.notes,
});

/** Ask the LLM for JSON matching `schema`, feeding validation errors back (up to `attempts`). */
async function askJson<S extends z.ZodTypeAny>(
  llm: LLMProvider,
  schema: S,
  system: string,
  user: string,
  opts: { kitId: string; operation: string; webSearch?: number; attempts?: number; maxTokens?: number },
): Promise<{ value: z.output<S>; sources: { title: string; url: string }[] }> {
  const convo: LLMMessage[] = [{ role: "user", content: user }];
  const sources = new Map<string, string>();
  let errors: string[] = [];
  for (let attempt = 1; attempt <= (opts.attempts ?? 3); attempt++) {
    const res = await llm.complete(
      { system, messages: convo, maxTokens: opts.maxTokens ?? 32000, effort: "high", webSearch: attempt === 1 && opts.webSearch ? { maxUses: opts.webSearch } : undefined },
      { launchKitId: opts.kitId, operation: `${opts.operation}${attempt > 1 ? "-repair" : ""}` },
    );
    for (const s of res.sources ?? []) sources.set(s.url, s.title);
    const parsed = parseJsonWith(schema, res.text);
    if (parsed.ok) return { value: parsed.value, sources: [...sources].map(([url, title]) => ({ url, title })) };
    errors = parsed.errors;
    log.warn(`${opts.operation}: invalid JSON (attempt ${attempt})`, { errors: errors.slice(0, 5) });
    convo.push({ role: "assistant", content: res.text.slice(0, 60000) || "{}" });
    convo.push({ role: "user", content: `That JSON failed validation:\n${errors.map((e) => `- ${e}`).join("\n")}\nReturn the complete corrected JSON object only.` });
  }
  throw new Error(`${opts.operation}: invalid output after retries — ${errors.slice(0, 4).join("; ")}`);
}

/** Enforce brief constraints and a valid, distinct voice cast. */
export function normalizeKit(kit: Kit, brief: KitBrief): Kit {
  const catalog = voiceCatalog();
  const cast = castVoices(kit.characters, catalog);
  const used = new Set(cast.map((c) => c.voice.speaker));
  const [narrator] = castVoices([{ gender: catalog.find((v) => v.id === kit.narrator.speaker)?.gender ?? "female", age: 45, voice: kit.narrator }], catalog.filter((v) => !used.has(v.id)).length ? catalog.filter((v) => !used.has(v.id)) : catalog);
  return {
    ...kit,
    characters: cast,
    narrator: { ...kit.narrator, ...narrator.voice },
    theme: { ...kit.theme, kidSafe: kit.theme.kidSafe || brief.kidSafe },
    channel: { ...kit.channel, madeForKids: kit.channel.madeForKids || brief.kidSafe },
  };
}

async function setKit(id: string, data: Prisma.LaunchKitUpdateInput) {
  return prisma.launchKit.update({ where: { id }, data });
}

// ───────────────────────── steps ─────────────────────────

async function stepResearch(kitId: string) {
  const k = await prisma.launchKit.findUniqueOrThrow({ where: { id: kitId } });
  const p = buildResearchPrompt(briefOf(k));
  const { value, sources } = await askJson(await llmProvider(), ResearchSchema, p.system, p.user, { kitId, operation: "kit-research", webSearch: 12, maxTokens: 24000 });
  const all = new Map(value.sources.map((s) => [s.url, s.title]));
  for (const s of sources) if (!all.has(s.url)) all.set(s.url, s.title);
  const research: Research = { ...value, sources: [...all].map(([url, title]) => ({ url, title })) };
  await setKit(kitId, { research: research as unknown as Prisma.InputJsonValue });
}

async function stepWrite(kitId: string) {
  const k = await prisma.launchKit.findUniqueOrThrow({ where: { id: kitId } });
  const brief = briefOf(k);
  const catalog = voiceCatalog();
  const p = buildKitPrompt(brief, (k.research as unknown as Research) ?? null, catalog, (process.env.SARVAM_TTS_MODEL ?? "bulbul:v2").startsWith("bulbul:v2"));
  const { value } = await askJson(await llmProvider(), KitSchema, p.system, p.user, { kitId, operation: "kit-write", maxTokens: 48000 });
  await setKit(kitId, { kit: normalizeKit(value, brief) as unknown as Prisma.InputJsonValue });
}

async function stepReview(kitId: string) {
  const k = await prisma.launchKit.findUniqueOrThrow({ where: { id: kitId } });
  const brief = briefOf(k);
  const kit = KitSchema.parse(k.kit);
  const p = buildKitReviewPrompt(brief, (k.research as unknown as Research) ?? null, kit, voiceCatalog());
  const { value, sources } = await askJson(await llmProvider(), ReviewSchema, p.system, p.user, { kitId, operation: "kit-review", webSearch: 8, maxTokens: 48000, attempts: 2 });
  const revised = KitSchema.safeParse(value.kit);
  const issues = [...value.issues];
  if (!revised.success) issues.push({ area: "review", problem: "the reviewer's revised kit was invalid, so the original kit was kept", fix: revised.error.issues.slice(0, 3).map((i) => i.message).join("; ") });
  // put names without conflicts first
  const finalKit = normalizeKit(revised.success ? revised.data : kit, brief);
  const conflicted = new Set(value.nameChecks.filter((n) => n.conflict).map((n) => n.name.toLowerCase()));
  finalKit.channel.nameOptions.sort((a, b) => Number(conflicted.has(a.name.toLowerCase())) - Number(conflicted.has(b.name.toLowerCase())));
  await setKit(kitId, { kit: finalKit as unknown as Prisma.InputJsonValue, review: { issues, nameChecks: value.nameChecks, sources } as unknown as Prisma.InputJsonValue, chosenName: 0 });
}

/** Channel banner: art + channel name/tagline rendered by code inside YouTube's all-device safe area (1546×423 centre). */
export async function renderBanner(artKey: string, title: string, subtitle: string, outKey: string) {
  const dir = path.join(config.workDir, "_banners", path.basename(outKey, ".jpg"));
  await fs.mkdir(dir, { recursive: true });
  const art = await storage().download(artKey, path.join(dir, "art.png"));
  await fs.writeFile(
    path.join(dir, "banner.ass"),
    buildCardAss(2560, 1440, [
      { text: title, size: 150, y: 680 },
      ...(subtitle ? [{ text: subtitle, size: 70, color: "&H00FFFFFF&", y: 800 }] : []),
    ]),
  );
  const out = path.join(dir, "banner.jpg");
  await ffmpeg(["-i", art, "-vf", `scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,ass=banner.ass:fontsdir=${config.fontsDir}`, "-frames:v", "1", "-q:v", "3", out], { cwd: dir });
  await storage().putFile(outKey, out, "image/jpeg");
  return outKey;
}

async function stepArt(kitId: string, opts: { only?: "logo" | "banner" } = {}) {
  const k = await prisma.launchKit.findUniqueOrThrow({ where: { id: kitId } });
  const kit = KitSchema.parse(k.kit);
  const img = await imageProvider();
  const nonce = Date.now().toString(36);
  const lead = kit.characters[0];
  const ctx = { launchKitId: kitId };

  if (opts.only !== "banner") {
    const candidates: string[] = [];
    for (let i = 0; i < 3; i++) {
      const variant = ["centred mascot portrait", "mascot waving inside a bold circular badge", "simple iconic emblem of the show's world"][i];
      const res = await img.generate(
        {
          prompt: `${kit.theme.artStylePrompt}\nYouTube channel profile picture (square, shown as a small circle): ${kit.branding.logoPrompt}\nVariant: ${variant}.\nMain character: ${lead.name} — ${lead.visualDescription}\nPalette: ${kit.branding.colorPalette.join(", ")}\nKeep important detail inside the central circle. Absolutely no text or letters.`,
          references: [],
          aspect: "1:1",
          meta: { kind: "logo", characters: [lead.key], title: `${kit.channel.nameOptions[0].name}-${i}` },
        },
        { ...ctx, operation: "kit-logo" },
      );
      const png = await sharp(res.data).resize(800, 800, { fit: "cover" }).png().toBuffer();
      const key = `kits/${kitId}/logo-${nonce}-${i}.png`;
      await storage().put(key, png, "image/png");
      candidates.push(key);
    }
    await setKit(kitId, { logoCandidates: candidates, logoKey: candidates[0] });
  }

  if (opts.only !== "logo") {
    const res = await img.generate(
      {
        prompt: `${kit.theme.artStylePrompt}\nYouTube channel banner art, very wide composition: ${kit.branding.bannerPrompt}\nCast: ${kit.characters.map((c) => `${c.name} — ${c.visualDescription}`).join("\n")}\nKeep the central horizontal band uncluttered (a title is added later). No text or letters.`,
        references: [],
        aspect: "16:9",
        meta: { kind: "banner", characters: kit.characters.map((c) => c.key), location: kit.locations[0]?.key, title: "banner" },
      },
      { ...ctx, operation: "kit-banner" },
    );
    const artKey = `kits/${kitId}/banner-art.png`;
    await storage().put(artKey, res.data, res.mime);
    const name = kit.channel.nameOptions[Math.min(k.chosenName, kit.channel.nameOptions.length - 1)];
    const bannerKey = await renderBanner(artKey, name.nameHi || name.name, kit.channel.tagline, `kits/${kitId}/banner-${nonce}.jpg`);
    await setKit(kitId, { bannerKey });
  }
}

async function stepMusic(kitId: string, opts: { regenerate?: boolean } = {}) {
  const k = await prisma.launchKit.findUniqueOrThrow({ where: { id: kitId } });
  const kit = KitSchema.parse(k.kit);
  const pack = kitPack(kitId);
  if (opts.regenerate) await prisma.musicTrack.deleteMany({ where: { pack } });
  const existing = await prisma.musicTrack.findMany({ where: { pack } });
  const music = await musicProvider();
  for (const [i, t] of kit.music.tracks.entries()) {
    if (existing.some((e) => e.title === t.title)) continue;
    const res = await music.generate(
      { prompt: `${t.prompt}\nOverall direction: ${kit.music.direction}`, lengthSec: t.lengthSec, instrumental: true, mood: t.mood },
      { launchKitId: kitId, operation: "kit-music" },
    );
    const key = `music/${pack}/${i}-${Date.now().toString(36)}.${res.ext}`;
    await storage().put(key, res.data, res.mime);
    const tmp = path.join(config.workDir, "_music", path.basename(key));
    await storage().download(key, tmp);
    const durationSec = await probeDuration(tmp).catch(() => t.lengthSec);
    await prisma.musicTrack.create({ data: { pack, title: t.title, mood: t.mood, prompt: t.prompt, key, durationSec, source: music.name, license: music.license } });
  }
}

const STEP_FNS: Record<KitStep, (id: string) => Promise<void>> = { research: stepResearch, write: stepWrite, review: stepReview, art: (id) => stepArt(id), music: (id) => stepMusic(id) };

/** Run the kit from `from` (default: start) through the end. Each step persists its output, so a retry resumes there. */
export async function runLaunchKit(kitId: string, opts: { from?: KitStep; only?: KitStep } = {}) {
  const start = opts.only ? KIT_STEPS.indexOf(opts.only) : KIT_STEPS.indexOf(opts.from ?? "research");
  const end = opts.only ? start + 1 : KIT_STEPS.length;
  for (const step of KIT_STEPS.slice(start, end)) {
    await setKit(kitId, { status: STEP_STATUS[step], error: null, failedStep: null });
    const t0 = Date.now();
    try {
      await STEP_FNS[step](kitId);
      log.info(`✔ ${step} (${((Date.now() - t0) / 1000).toFixed(1)}s)`, { kitId });
    } catch (err) {
      log.error(`✘ ${step}: ${errMsg(err)}`, { kitId });
      await setKit(kitId, { status: "FAILED", failedStep: STEP_STATUS[step], error: errMsg(err).slice(0, 4000) });
      throw err;
    }
  }
  const k = await prisma.launchKit.findUniqueOrThrow({ where: { id: kitId } });
  if (k.status !== "APPLIED") await setKit(kitId, { status: k.channelId ? "APPLIED" : "READY" });
}

export async function regenerateKitArt(kitId: string, what: "logo" | "banner") {
  await stepArt(kitId, { only: what });
}
export async function regenerateKitMusic(kitId: string) {
  await stepMusic(kitId, { regenerate: true });
}

export const stepForStatus = (s: KitStatus | null | undefined): KitStep | undefined => (Object.entries(STEP_STATUS).find(([, v]) => v === s)?.[0] as KitStep) ?? undefined;

// ───────────────────────── apply ─────────────────────────

/**
 * Create the theme (art style, rules, narrator), characters (with voices), locations, storyline bible,
 * music pack and channel from a reviewed kit. The channel starts PAUSED so the cast sheets can be approved first.
 */
export async function applyLaunchKit(kitId: string): Promise<{ channelId: string; themeId: string; characterIds: string[]; locationIds: string[] }> {
  const k = await prisma.launchKit.findUniqueOrThrow({ where: { id: kitId } });
  if (k.channelId) throw new Error("this kit has already been applied");
  const kit = KitSchema.parse(k.kit);
  const name = kit.channel.nameOptions[Math.min(k.chosenName, kit.channel.nameOptions.length - 1)];
  const hasMusic = (await prisma.musicTrack.count({ where: { pack: kitPack(kitId) } })) > 0;

  // re-render the banner with the chosen name
  let bannerKey = k.bannerKey;
  if (await storage().exists(`kits/${kitId}/banner-art.png`)) {
    bannerKey = await renderBanner(`kits/${kitId}/banner-art.png`, name.nameHi || name.name, kit.channel.tagline, `kits/${kitId}/banner-final-${Date.now().toString(36)}.jpg`);
  }
  const [firstIdea, ...moreIdeas] = kit.storyline.firstEpisodeIdeas;

  const result = await prisma.$transaction(async (tx) => {
    const theme = await tx.theme.create({
      data: {
        name: kit.theme.name,
        genre: kit.theme.genre,
        artStylePrompt: kit.theme.artStylePrompt,
        negativeStyle: kit.theme.negativeStyle,
        tone: kit.theme.tone,
        targetAudience: kit.theme.targetAudience,
        contentRules: kit.theme.contentRules,
        kidSafe: kit.theme.kidSafe,
        narratorSpeaker: kit.narrator.speaker,
        narratorPitch: kit.narrator.pitch,
        narratorPace: kit.narrator.pace,
        narratorLoudness: kit.narrator.loudness,
        storyline: {
          create: {
            premise: kit.storyline.premise,
            worldRules: kit.storyline.worldRules,
            characterArcs: kit.storyline.characterArcs,
            runningGags: kit.storyline.runningGags,
            forbiddenTopics: kit.storyline.forbiddenTopics,
            openThreads: [...kit.storyline.openThreads, ...moreIdeas.map((i) => `Episode idea: ${i}`)].slice(0, 25),
            directives: firstIdea ? { create: [{ text: `Episode 1: ${firstIdea}` }] } : undefined,
          },
        },
      },
    });
    const characterIds: string[] = [];
    for (const c of kit.characters) {
      const row = await tx.character.create({
        data: {
          themeId: theme.id,
          key: c.key,
          name: c.name,
          role: c.role,
          age: c.age,
          personality: c.personality,
          speechStyle: c.catchphrases.length ? `${c.speechStyle}. Catchphrases: ${c.catchphrases.join(" / ")}` : c.speechStyle,
          visualDescription: c.visualDescription,
          voiceSpeaker: c.voice.speaker,
          voicePitch: c.voice.pitch,
          voicePace: c.voice.pace,
          voiceLoudness: c.voice.loudness,
        },
      });
      characterIds.push(row.id);
    }
    const locationIds: string[] = [];
    for (const l of kit.locations) locationIds.push((await tx.location.create({ data: { themeId: theme.id, key: l.key, name: l.name, description: l.description } })).id);
    const channel = await tx.channel.create({
      data: {
        name: name.name,
        themeId: theme.id,
        language: k.language,
        timezone: "Asia/Kolkata",
        active: false,
        storyPublishTime: kit.channel.publishTimes.story,
        shortPublishTimes: [kit.channel.publishTimes.short1, kit.channel.publishTimes.short2],
        madeForKids: kit.channel.madeForKids,
        shortsMode: kit.channel.shortsMode,
        storyTargetMinutes: kit.channel.storyTargetMinutes,
        musicPack: hasMusic ? kitPack(kitId) : "village-warm",
        logoKey: k.logoKey,
        bannerKey,
        description: `${kit.channel.descriptionHi}\n\n${kit.channel.descriptionEn}`.slice(0, 1000),
        keywords: kit.channel.keywords,
        autoPublish: false,
      },
    });
    await tx.launchKit.update({ where: { id: kitId }, data: { channelId: channel.id, status: "APPLIED", bannerKey } });
    return { channelId: channel.id, themeId: theme.id, characterIds, locationIds };
  });
  log.info(`applied kit → channel "${name.name}"`, { kitId, channelId: result.channelId });
  return result;
}
