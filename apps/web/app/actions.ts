"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  applyLaunchKit,
  KitSchema,
  deleteMusicTrack,
  uploadMusicTrack,
  type KitStep,
  approveCharacterSheet,
  approveItem,
  approveLocationReference,
  enqueueStudio,
  prisma,
  regenerateShot,
  rejectCharacterSheet,
  rejectItem,
  rerunFrom,
  retryItem,
  setSecret,
  storage,
  updateSettings,
  updateShot,
  updateYoutubeMeta,
  SECRET_KEYS,
  type SecretKey,
  type Stage,
} from "@kahani/core";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string, d = 0) => {
  const v = Number(f.get(k));
  return Number.isFinite(v) && f.get(k) !== "" ? v : d;
};
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
const lines = (f: FormData, k: string) =>
  str(f, k)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

// ───────────── pipeline ─────────────
export async function runChannelNow(channelId: string) {
  await enqueueStudio({ kind: "daily-run", channelId, force: true });
  revalidatePath("/");
}
export async function retryAction(itemId: string) {
  await retryItem(itemId);
  revalidatePath("/");
  revalidatePath(`/content/${itemId}`);
}
export async function approveAction(itemId: string) {
  await approveItem(itemId);
  revalidatePath("/review");
  revalidatePath(`/content/${itemId}`);
}
export async function rejectAction(itemId: string, note?: string) {
  await rejectItem(itemId, note);
  revalidatePath("/review");
  revalidatePath(`/content/${itemId}`);
}
export async function rerunAction(itemId: string, stage: Stage) {
  await rerunFrom(itemId, stage);
  revalidatePath(`/content/${itemId}`);
}
export async function regenerateAction(itemId: string, idx: number, what: "image" | "voice") {
  await regenerateShot(itemId, idx, what);
  revalidatePath(`/content/${itemId}`);
}

export async function saveShotAction(form: FormData) {
  const itemId = str(form, "itemId");
  const idx = num(form, "idx");
  const speaker = str(form, "speaker");
  await updateShot(itemId, idx, {
    dialogueHi: str(form, "dialogueHi") || null,
    speaker: speaker && speaker !== "-" ? speaker : null,
    action: str(form, "action"),
    imagePromptEn: str(form, "imagePromptEn"),
    emotion: str(form, "emotion"),
    framing: str(form, "framing"),
    sfx: str(form, "sfx") || null,
    charactersInFrame: str(form, "charactersInFrame").split(",").map((s) => s.trim()).filter(Boolean),
    location: str(form, "location"),
  });
  revalidatePath(`/content/${itemId}`);
}

export async function saveMetaAction(form: FormData) {
  const itemId = str(form, "itemId");
  await updateYoutubeMeta(itemId, { title: str(form, "title"), description: str(form, "description"), tags: str(form, "tags").split(",").map((t) => t.trim()).filter(Boolean) });
  const when = str(form, "scheduledPublishAt");
  await prisma.contentItem.update({ where: { id: itemId }, data: { scheduledPublishAt: when ? new Date(when) : null } });
  revalidatePath(`/content/${itemId}`);
}

// ───────────── channels ─────────────
export async function saveChannelAction(form: FormData) {
  const id = str(form, "id");
  const data = {
    name: str(form, "name"),
    themeId: str(form, "themeId"),
    language: str(form, "language") || "hi-IN",
    timezone: str(form, "timezone") || "Asia/Kolkata",
    active: bool(form, "active"),
    generationTime: str(form, "generationTime") || "02:00",
    storyPublishTime: str(form, "storyPublishTime") || "18:00",
    shortPublishTimes: [str(form, "short1Time") || "12:00", str(form, "short2Time") || "20:30"],
    thumbnailStyle: str(form, "thumbnailStyle") || "bold-closeup",
    musicPack: str(form, "musicPack") || "village-warm",
    subtitlesEnabled: bool(form, "subtitlesEnabled"),
    madeForKids: bool(form, "madeForKids"),
    autoPublish: bool(form, "autoPublish"),
    shortsMode: str(form, "shortsMode") === "MINI_STORY" ? ("MINI_STORY" as const) : ("TEASER" as const),
    motionProvider: str(form, "motionProvider") === "lipsync" ? "lipsync" : "kenburns",
    storyTargetMinutes: Math.min(15, Math.max(8, num(form, "storyTargetMinutes", 10))),
    aiDisclosure: true,
  };
  if (!data.name || !data.themeId) throw new Error("name and theme are required");
  const taken = await prisma.channel.findFirst({ where: { themeId: data.themeId, NOT: id ? { id } : undefined } });
  if (taken) throw new Error(`Theme is already used by channel "${taken.name}" (one theme per channel)`);

  const saved = id ? await prisma.channel.update({ where: { id }, data }) : await prisma.channel.create({ data });
  for (const kind of ["intro", "outro"] as const) {
    const file = form.get(`${kind}Clip`);
    if (file && typeof file === "object" && "arrayBuffer" in file && file.size > 0) {
      const key = `channels/${saved.id}/${kind}-${Date.now().toString(36)}.mp4`;
      await storage().put(key, Buffer.from(await file.arrayBuffer()), "video/mp4");
      await prisma.channel.update({ where: { id: saved.id }, data: { [`${kind}ClipKey`]: key } });
    }
    if (bool(form, `clear${kind}`)) await prisma.channel.update({ where: { id: saved.id }, data: { [`${kind}ClipKey`]: null } });
  }
  await enqueueStudio({ kind: "sync-schedules" }).catch(() => undefined);
  revalidatePath("/channels");
  redirect(`/channels/${saved.id}`);
}

export async function disconnectYoutubeAction(channelId: string) {
  await prisma.channel.update({ where: { id: channelId }, data: { oauthTokensEnc: null, youtubeChannelId: null } });
  revalidatePath(`/channels/${channelId}`);
}

// ───────────── themes ─────────────
export async function saveThemeAction(form: FormData) {
  const id = str(form, "id");
  const data = {
    name: str(form, "name"),
    genre: str(form, "genre"),
    artStylePrompt: str(form, "artStylePrompt"),
    negativeStyle: str(form, "negativeStyle"),
    tone: str(form, "tone"),
    targetAudience: str(form, "targetAudience"),
    contentRules: str(form, "contentRules"),
    kidSafe: bool(form, "kidSafe"),
    narratorSpeaker: str(form, "narratorSpeaker") || "vidya",
    narratorPitch: num(form, "narratorPitch", 0),
    narratorPace: num(form, "narratorPace", 1),
    narratorLoudness: num(form, "narratorLoudness", 1),
  };
  if (!data.name || !data.artStylePrompt) throw new Error("name and art style are required");
  const saved = id
    ? await prisma.theme.update({ where: { id }, data })
    : await prisma.theme.create({ data: { ...data, storyline: { create: { premise: "Describe the series premise here." } } } });
  revalidatePath("/themes");
  if (!id) redirect(`/themes/${saved.id}`);
  revalidatePath(`/themes/${saved.id}`);
}

export async function testStyleAction(themeId: string) {
  await prisma.theme.update({ where: { id: themeId }, data: { styleTestStatus: "queued" } });
  await enqueueStudio({ kind: "style-test", themeId });
  revalidatePath(`/themes/${themeId}`);
}

export async function saveStorylineAction(form: FormData) {
  const themeId = str(form, "themeId");
  const data = {
    premise: str(form, "premise"),
    worldRules: str(form, "worldRules"),
    characterArcs: str(form, "characterArcs"),
    runningGags: str(form, "runningGags"),
    forbiddenTopics: str(form, "forbiddenTopics"),
  };
  await prisma.storyline.upsert({ where: { themeId }, update: data, create: { themeId, ...data } });
  revalidatePath(`/themes/${themeId}`);
}

export async function saveMemoryAction(form: FormData) {
  const themeId = str(form, "themeId");
  await prisma.storyline.update({
    where: { themeId },
    data: { storyMemory: str(form, "storyMemory"), openThreads: lines(form, "openThreads"), episodeCount: num(form, "episodeCount", 0) },
  });
  revalidatePath(`/themes/${themeId}/memory`);
}

export async function addDirectiveAction(form: FormData) {
  const themeId = str(form, "themeId");
  const text = str(form, "text");
  if (!text) return;
  const sl = await prisma.storyline.findUniqueOrThrow({ where: { themeId } });
  await prisma.storyDirective.create({ data: { storylineId: sl.id, text } });
  revalidatePath(`/themes/${themeId}/memory`);
}
export async function deleteDirectiveAction(themeId: string, id: string) {
  await prisma.storyDirective.delete({ where: { id } });
  revalidatePath(`/themes/${themeId}/memory`);
}

// ───────────── characters & locations ─────────────
export async function saveCharacterAction(form: FormData) {
  const id = str(form, "id");
  const themeId = str(form, "themeId");
  const data = {
    name: str(form, "name"),
    role: str(form, "role"),
    age: form.get("age") ? num(form, "age") : null,
    personality: str(form, "personality"),
    speechStyle: str(form, "speechStyle"),
    visualDescription: str(form, "visualDescription"),
    voiceSpeaker: str(form, "voiceSpeaker") || "anushka",
    voicePitch: num(form, "voicePitch", 0),
    voicePace: num(form, "voicePace", 1),
    voiceLoudness: num(form, "voiceLoudness", 1),
  };
  const saved = id
    ? await prisma.character.update({ where: { id }, data })
    : await prisma.character.create({ data: { ...data, themeId, key: slug(str(form, "key") || data.name) } });
  revalidatePath(`/themes/${themeId}`);
  redirect(`/themes/${themeId}/characters/${saved.id}`);
}
export async function deleteCharacterAction(themeId: string, id: string) {
  await prisma.character.delete({ where: { id } });
  revalidatePath(`/themes/${themeId}`);
  redirect(`/themes/${themeId}`);
}
export async function generateSheetAction(characterId: string) {
  await prisma.character.update({ where: { id: characterId }, data: { sheetStatus: "GENERATING" } });
  await enqueueStudio({ kind: "character-sheet", characterId });
  revalidatePath("/themes");
}
export async function approveSheetAction(characterId: string) {
  await approveCharacterSheet(characterId);
  revalidatePath("/themes");
}
export async function rejectSheetAction(characterId: string) {
  await rejectCharacterSheet(characterId);
  revalidatePath("/themes");
}

export async function saveLocationAction(form: FormData) {
  const id = str(form, "id");
  const themeId = str(form, "themeId");
  const data = { name: str(form, "name"), description: str(form, "description") };
  if (id) await prisma.location.update({ where: { id }, data });
  else await prisma.location.create({ data: { ...data, themeId, key: slug(str(form, "key") || data.name) } });
  revalidatePath(`/themes/${themeId}`);
}
export async function deleteLocationAction(themeId: string, id: string) {
  await prisma.location.delete({ where: { id } });
  revalidatePath(`/themes/${themeId}`);
}
export async function generateLocationAction(locationId: string) {
  await enqueueStudio({ kind: "location-ref", locationId });
  revalidatePath("/themes");
}
export async function approveLocationAction(locationId: string) {
  await approveLocationReference(locationId);
  revalidatePath("/themes");
}

// ───────────── settings ─────────────
export async function saveSettingsAction(form: FormData) {
  await updateSettings({
    imageConcurrency: Math.max(1, num(form, "imageConcurrency", 4)),
    ttsConcurrency: Math.max(1, num(form, "ttsConcurrency", 6)),
    motionConcurrency: Math.max(1, num(form, "motionConcurrency", 2)),
    monthlyBudgetInr: Math.max(0, num(form, "monthlyBudgetInr", 0)),
    consistencyCheck: bool(form, "consistencyCheck"),
    consistencyThreshold: Math.min(10, Math.max(1, num(form, "consistencyThreshold", 6))),
    anthropicModel: str(form, "anthropicModel") || "claude-sonnet-5-5",
    maxStoryShots: Math.min(200, Math.max(20, num(form, "maxStoryShots", 200))),
  });
  for (const key of SECRET_KEYS) {
    const v = str(form, `secret_${key}`);
    if (v) await setSecret(key as SecretKey, v);
    if (bool(form, `clear_${key}`)) await setSecret(key as SecretKey, null);
  }
  revalidatePath("/settings");
}

// ───────────── launch kit ─────────────
export async function createKitAction(form: FormData) {
  const idea = str(form, "idea");
  if (idea.length < 5) throw new Error("describe the channel idea in a few words");
  const kit = await prisma.launchKit.create({
    data: { idea, language: str(form, "language") || "hi-IN", audience: str(form, "audience"), kidSafe: bool(form, "kidSafe"), notes: str(form, "notes") },
  });
  await enqueueStudio({ kind: "launch-kit", kitId: kit.id });
  redirect(`/launch/${kit.id}`);
}

export async function rerunKitAction(kitId: string, from: KitStep, only = false) {
  await prisma.launchKit.update({ where: { id: kitId }, data: { status: "QUEUED", error: null } });
  await enqueueStudio({ kind: "launch-kit", kitId, ...(only ? { only: from } : { from }) });
  revalidatePath(`/launch/${kitId}`);
}
export async function kitArtAction(kitId: string, what: "logo" | "banner") {
  await enqueueStudio({ kind: "kit-art", kitId, what });
  revalidatePath(`/launch/${kitId}`);
}
export async function kitMusicAction(kitId: string) {
  await enqueueStudio({ kind: "kit-music", kitId });
  revalidatePath(`/launch/${kitId}`);
}
export async function chooseLogoAction(kitId: string, key: string) {
  await prisma.launchKit.update({ where: { id: kitId }, data: { logoKey: key } });
  revalidatePath(`/launch/${kitId}`);
}

function setPath(obj: Record<string, unknown>, path: string, raw: string) {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (const p of parts.slice(0, -1)) cur = (cur[p] ??= /^\d+$/.test(p) ? [] : {}) as Record<string, unknown>;
  const last = parts[parts.length - 1];
  const prev = cur[last];
  cur[last] = Array.isArray(prev)
    ? raw
        .split(/(keywords|catchphrases)$/.test(path) ? "," : "\n")
        .map((x) => x.trim())
        .filter(Boolean)
    : typeof prev === "number"
      ? Number(raw)
      : raw;
}

/** Saves every edited kit field (inputs are named by JSON path, e.g. "characters.0.voice.speaker"). */
export async function saveKitAction(form: FormData) {
  const kitId = str(form, "kitId");
  const k = await prisma.launchKit.findUniqueOrThrow({ where: { id: kitId } });
  const kit = structuredClone(k.kit) as Record<string, unknown>;
  for (const [name, value] of form.entries()) {
    if (name.startsWith("$") || name === "kitId" || name.startsWith("bool:")) continue;
    setPath(kit, name, String(value));
  }
  for (const name of form.keys()) {
    if (!name.startsWith("bool:")) continue;
    const path = name.slice(5);
    const parts = path.split(".");
    let cur = kit as Record<string, unknown>;
    for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
    cur[parts[parts.length - 1]] = form.get(path) === "on";
  }
  const parsed = KitSchema.safeParse(kit);
  if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  await prisma.launchKit.update({ where: { id: kitId }, data: { kit: parsed.data as object, chosenName: num(form, "$chosenName", k.chosenName) } });
  revalidatePath(`/launch/${kitId}`);
}

export async function applyKitAction(kitId: string) {
  const res = await applyLaunchKit(kitId);
  // candidate sheets / plates go to Character Studio for approval
  for (const id of res.characterIds) {
    await prisma.character.update({ where: { id }, data: { sheetStatus: "GENERATING" } });
    await enqueueStudio({ kind: "character-sheet", characterId: id });
  }
  for (const id of res.locationIds) await enqueueStudio({ kind: "location-ref", locationId: id });
  await enqueueStudio({ kind: "sync-schedules" }).catch(() => undefined);
  revalidatePath("/channels");
  redirect(`/channels/${res.channelId}?launched=1`);
}

export async function deleteKitAction(kitId: string) {
  await prisma.launchKit.delete({ where: { id: kitId } });
  revalidatePath("/launch");
  redirect("/launch");
}

export async function pushBrandingAction(channelId: string) {
  await enqueueStudio({ kind: "youtube-branding", channelId });
  revalidatePath(`/channels/${channelId}`);
}

export async function setChannelLogoAction(form: FormData) {
  const channelId = str(form, "channelId");
  for (const kind of ["logo", "banner"] as const) {
    const file = form.get(kind);
    if (file && typeof file === "object" && "arrayBuffer" in file && file.size > 0) {
      const key = `channels/${channelId}/${kind}-${Date.now().toString(36)}${kind === "logo" ? ".png" : ".jpg"}`;
      await storage().put(key, Buffer.from(await file.arrayBuffer()));
      await prisma.channel.update({ where: { id: channelId }, data: { [`${kind}Key`]: key } });
    }
  }
  const description = form.get("description");
  if (typeof description === "string") await prisma.channel.update({ where: { id: channelId }, data: { description: description.trim(), keywords: str(form, "keywords").split(",").map((k) => k.trim()).filter(Boolean) } });
  revalidatePath(`/channels/${channelId}`);
}

// ───────────── music ─────────────
export async function uploadMusicAction(form: FormData) {
  const file = form.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file) || file.size === 0) throw new Error("choose an audio file");
  const license = str(form, "license");
  if (!license) throw new Error("record where the licence comes from (e.g. 'Epidemic Sound subscription, track ID …')");
  await uploadMusicTrack({ pack: str(form, "pack"), title: str(form, "title") || file.name, license, data: Buffer.from(await file.arrayBuffer()), filename: file.name });
  revalidatePath("/music");
}
export async function generateMusicAction(form: FormData) {
  const prompt = str(form, "prompt");
  if (prompt.length < 10) throw new Error("describe the music (instruments, tempo, mood)");
  await enqueueStudio({ kind: "music-generate", pack: str(form, "pack") || "custom", title: str(form, "title") || "Untitled", prompt, lengthSec: num(form, "lengthSec", 90), mood: str(form, "mood") || undefined });
  revalidatePath("/music");
}
export async function deleteMusicAction(id: string) {
  await deleteMusicTrack(id);
  revalidatePath("/music");
}
