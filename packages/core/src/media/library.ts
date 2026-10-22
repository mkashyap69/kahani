import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { hashOf } from "../util/crypto.js";

export interface SfxEntry {
  file: string;
  tags: string[];
}

let sfxCache: SfxEntry[] | null = null;
export async function sfxLibrary(): Promise<SfxEntry[]> {
  if (sfxCache) return sfxCache;
  try {
    sfxCache = JSON.parse(await fs.readFile(path.join(config.assetsDir, "sfx", "library.json"), "utf8")) as SfxEntry[];
  } catch {
    sfxCache = [];
  }
  return sfxCache;
}

const STOP = new Set(["a", "an", "the", "of", "in", "and", "with", "sound", "sounds", "noise", "distant", "soft", "loud"]);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((t) => t.replace(/(ing|s)$/, ""))
    .filter((t) => t.length > 2 && !STOP.has(t));

/** Match a script's free-text `sfx` field to the tagged local library (best tag overlap). */
export function matchSfx(query: string | null | undefined, library: SfxEntry[]): SfxEntry | null {
  if (!query) return null;
  const q = new Set(tokens(query));
  let best: { e: SfxEntry; score: number } | null = null;
  for (const e of library) {
    const t = new Set(e.tags.flatMap(tokens));
    let score = 0;
    for (const w of q) if (t.has(w)) score++;
    if (score > 0 && (!best || score > best.score)) best = { e, score };
  }
  return best?.e ?? null;
}

export const sfxPath = (e: SfxEntry) => path.join(config.assetsDir, "sfx", e.file);

/** Deterministically pick a background track from the channel's music pack. */
export async function pickMusic(pack: string, seed: string): Promise<string | null> {
  const dir = path.join(config.assetsDir, "music", pack);
  try {
    const files = (await fs.readdir(dir)).filter((f) => /\.(wav|mp3|m4a|ogg|flac)$/i.test(f)).sort();
    if (!files.length) return null;
    return path.join(dir, files[parseInt(hashOf(seed).slice(0, 8), 16) % files.length]);
  } catch {
    return null;
  }
}

export async function musicPacks(): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(config.assetsDir, "music"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}
