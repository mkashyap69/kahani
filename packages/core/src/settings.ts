import { prisma } from "./db.js";
import { decrypt, encrypt } from "./util/crypto.js";
import { config } from "./config.js";

export const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "SARVAM_API_KEY",
  "FAL_KEY",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export interface RuntimeSettings {
  imageConcurrency: number;
  ttsConcurrency: number;
  motionConcurrency: number;
  /** pause generation when month-to-date spend exceeds this (0 = no cap) */
  monthlyBudgetInr: number;
  consistencyCheck: boolean;
  consistencyThreshold: number;
  anthropicModel: string;
  /** max shots a story may have (cost guard) */
  maxStoryShots: number;
}

const defaults = (): RuntimeSettings => ({
  imageConcurrency: config.defaults.imageConcurrency,
  ttsConcurrency: config.defaults.ttsConcurrency,
  motionConcurrency: config.defaults.motionConcurrency,
  monthlyBudgetInr: 0,
  consistencyCheck: false,
  consistencyThreshold: 6,
  anthropicModel: config.anthropicModel,
  maxStoryShots: 200,
});

export async function getSettings(): Promise<RuntimeSettings> {
  const rows = await prisma.setting.findMany({ where: { isSecret: false } });
  const out = defaults() as unknown as Record<string, unknown>;
  for (const row of rows) {
    if (!(row.key in out)) continue;
    const def = out[row.key];
    out[row.key] = typeof def === "number" ? Number(row.value) : typeof def === "boolean" ? row.value === "true" : row.value;
  }
  return out as unknown as RuntimeSettings;
}

export async function updateSettings(patch: Partial<RuntimeSettings>): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await prisma.setting.upsert({
      where: { key },
      update: { value: String(value), isSecret: false },
      create: { key, value: String(value), isSecret: false },
    });
  }
}

/** DB-stored (encrypted) secret first, then environment variable. */
export async function getSecret(name: SecretKey): Promise<string | undefined> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: `secret:${name}` } });
    if (row?.value) return decrypt(row.value);
  } catch {
    // DB unavailable or bad ENCRYPTION_KEY — fall back to env
  }
  const env = process.env[name];
  return env && env.trim() ? env.trim() : undefined;
}

export async function setSecret(name: SecretKey, value: string | null): Promise<void> {
  const key = `secret:${name}`;
  if (!value) {
    await prisma.setting.deleteMany({ where: { key } });
    return;
  }
  const enc = encrypt(value);
  await prisma.setting.upsert({ where: { key }, update: { value: enc, isSecret: true }, create: { key, value: enc, isSecret: true } });
}

/** Which secrets are configured (never returns values). */
export async function secretStatus(): Promise<Record<SecretKey, "db" | "env" | null>> {
  const rows = await prisma.setting.findMany({ where: { isSecret: true } });
  const inDb = new Set(rows.map((r) => r.key.replace(/^secret:/, "")));
  const out = {} as Record<SecretKey, "db" | "env" | null>;
  for (const k of SECRET_KEYS) out[k] = inDb.has(k) ? "db" : process.env[k]?.trim() ? "env" : null;
  return out;
}
