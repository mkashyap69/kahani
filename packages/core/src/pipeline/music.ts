import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { storage } from "../storage/index.js";
import { musicProvider } from "../providers/registry.js";
import { pushYoutubeBranding } from "../providers/youtube.js";
import { probeDuration } from "../media/ffmpeg.js";

const safePack = (p: string) =>
  p
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "custom";

async function measure(key: string) {
  const tmp = path.join(config.workDir, "_music", key.replace(/[\\/]/g, "_"));
  await storage().download(key, tmp);
  return probeDuration(tmp).catch(() => 0);
}

/** Generate one instrumental background track into a pack (ElevenLabs when configured, else the offline synth). */
export async function generateMusicTrack(input: { pack: string; title: string; prompt: string; lengthSec: number; mood?: string }) {
  const pack = safePack(input.pack);
  const music = await musicProvider();
  const res = await music.generate({ prompt: input.prompt, lengthSec: input.lengthSec, instrumental: true, mood: input.mood }, { operation: "music" });
  const key = `music/${pack}/${Date.now().toString(36)}.${res.ext}`;
  await storage().put(key, res.data, res.mime);
  return prisma.musicTrack.create({
    data: { pack, title: input.title, mood: input.mood ?? "", prompt: input.prompt, key, durationSec: await measure(key), source: music.name, license: music.license },
  });
}

/** Add a licensed track you own (e.g. from a stock-music subscription). */
export async function uploadMusicTrack(input: { pack: string; title: string; license: string; data: Buffer; filename: string }) {
  const pack = safePack(input.pack);
  const ext = (path.extname(input.filename).slice(1) || "mp3").toLowerCase();
  if (!["mp3", "m4a", "wav", "ogg", "flac", "aac"].includes(ext)) throw new Error("unsupported audio format");
  const key = `music/${pack}/${Date.now().toString(36)}.${ext}`;
  await storage().put(key, input.data);
  return prisma.musicTrack.create({ data: { pack, title: input.title, key, durationSec: await measure(key), source: "upload", license: input.license } });
}

export async function deleteMusicTrack(id: string) {
  const t = await prisma.musicTrack.delete({ where: { id } });
  await storage().delete(t.key).catch(() => undefined);
}

/** Upload description/keywords/banner and create playlists on the connected YouTube channel. */
export async function pushChannelBranding(channelId: string) {
  const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  let bannerPath: string | null = null;
  if (ch.bannerKey) {
    bannerPath = path.join(config.workDir, "_banners", `${channelId}.jpg`);
    await fs.mkdir(path.dirname(bannerPath), { recursive: true });
    await storage().download(ch.bannerKey, bannerPath);
  }
  return pushYoutubeBranding(channelId, { bannerPath });
}
