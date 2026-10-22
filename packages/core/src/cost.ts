import { prisma } from "./db.js";
import { config } from "./config.js";

/**
 * Estimated list prices (USD unless noted). These are estimates for budgeting only —
 * check each provider's current pricing page. Override per deployment by editing here.
 */
export const PRICING = {
  anthropic: {
    // USD per 1M tokens [input, output]
    "claude-opus-5-5": [4, 20],
    "claude-sonnet-5-5": [2, 10],
    "claude-sonnet-5": [2, 10],
    "claude-sonnet-4-6": [3, 15],
    "claude-sonnet-4-5": [3, 15],
    "claude-haiku-5-5": [0.1, 0.5],
    "claude-haiku-4-5": [1, 5],
  } as Record<string, [number, number]>,
  gemini: {
    imageUsd: 0.039, // per generated 1024px-class image
    textPerMTok: [0.3, 2.5] as [number, number],
  },
  /** Sarvam Bulbul — INR per 10k characters */
  sarvamInrPer10kChars: 15,
  /** fal.ai lip-sync — USD per output second */
  falLipsyncUsdPerSec: 0.08,
};

export interface UsageRecord {
  contentItemId?: string | null;
  provider: string;
  model: string;
  operation: string;
  inputTokens?: number;
  outputTokens?: number;
  characters?: number;
  images?: number;
  seconds?: number;
  success?: boolean;
  error?: string;
  /** override computed cost */
  costInr?: number;
}

export function estimateCostInr(u: UsageRecord): number {
  const fx = config.usdToInr;
  if (u.provider.startsWith("mock")) return 0;
  switch (u.provider) {
    case "anthropic": {
      const [i, o] = PRICING.anthropic[u.model] ?? PRICING.anthropic["claude-sonnet-5-5"];
      return (((u.inputTokens ?? 0) * i + (u.outputTokens ?? 0) * o) / 1e6) * fx;
    }
    case "gemini": {
      const [i, o] = PRICING.gemini.textPerMTok;
      const text = (((u.inputTokens ?? 0) * i + (u.outputTokens ?? 0) * o) / 1e6) * fx;
      return text + (u.images ?? 0) * PRICING.gemini.imageUsd * fx;
    }
    case "sarvam":
      return ((u.characters ?? 0) / 10_000) * PRICING.sarvamInrPer10kChars;
    case "fal":
      return (u.seconds ?? 0) * PRICING.falLipsyncUsdPerSec * fx;
    default:
      return 0;
  }
}

/** Persist an API call + roll its cost into the content item. Never throws. */
export async function logApiCall(u: UsageRecord): Promise<number> {
  const costInr = u.costInr ?? (u.success === false ? 0 : estimateCostInr(u));
  try {
    await prisma.apiCallLog.create({
      data: {
        contentItemId: u.contentItemId ?? null,
        provider: u.provider,
        model: u.model,
        operation: u.operation,
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
        characters: u.characters ?? 0,
        images: u.images ?? 0,
        seconds: u.seconds ?? 0,
        costInr,
        success: u.success ?? true,
        error: u.error?.slice(0, 2000),
      },
    });
    if (u.contentItemId && costInr > 0) {
      await prisma.contentItem.update({ where: { id: u.contentItemId }, data: { costInr: { increment: costInr } } });
    }
  } catch (err) {
    console.warn("[cost] failed to log api call", err);
  }
  return costInr;
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function spendSince(since: Date): Promise<number> {
  const agg = await prisma.apiCallLog.aggregate({ _sum: { costInr: true }, where: { createdAt: { gte: since } } });
  return agg._sum.costInr ?? 0;
}
export const spendToday = () => spendSince(startOfDay());
export const spendThisMonth = () => spendSince(startOfMonth());

export class BudgetExceededError extends Error {
  readonly nonRetryable = true;
  constructor(spent: number, cap: number) {
    super(`Monthly budget exceeded: ₹${spent.toFixed(0)} of ₹${cap.toFixed(0)} — generation paused`);
  }
}
