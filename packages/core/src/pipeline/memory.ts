import { prisma } from "../db.js";
import { llmProvider } from "../providers/registry.js";
import { buildMemoryCompressPrompt, estimateTokens, MEMORY_COMPRESS_TOKENS } from "../prompts/memory.js";
import { extractJson, type Script } from "../domain/script.js";
import { logger } from "../util/log.js";

const log = logger("memory");

/** Split "summary … Open thread(s): …" into memory text + thread list. */
export function parseMemoryUpdate(update: string): { summary: string; threads: string[] } {
  const m = update.match(/open threads?\s*[:：-]\s*([\s\S]*)$/i);
  if (!m) return { summary: update.trim(), threads: [] };
  const threads = m[1]
    .split(/\n|;|•|(?:^|\s)-\s/)
    .map((t) => t.trim().replace(/^[-*\d.)\s]+/, ""))
    .filter((t) => t.length > 3);
  return { summary: update.slice(0, m.index).trim(), threads };
}

/** After publish: append memory_update to story_memory; compress with the LLM when it exceeds ~3k tokens. */
export async function applyMemoryUpdate(itemId: string): Promise<void> {
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: itemId }, include: { channel: { include: { theme: { include: { storyline: true } } } } } });
  if (item.memoryApplied) return;
  const storyline = item.channel.theme.storyline;
  const script = item.scriptJson as unknown as Script | null;
  // teaser shorts re-cut today's story: nothing new happened
  const contributes = item.type === "STORY" || item.channel.shortsMode === "MINI_STORY";
  if (!storyline || !script || !contributes) {
    await prisma.contentItem.update({ where: { id: itemId }, data: { memoryApplied: true } });
    return;
  }
  const { summary, threads } = parseMemoryUpdate(script.memory_update);
  const label = item.type === "STORY" ? `Episode ${item.episodeNumber ?? storyline.episodeCount + 1}` : `Short (${new Date().toISOString().slice(0, 10)})`;
  let memory = `${storyline.storyMemory.trim()}\n\n[${label}: ${script.title_en}] ${summary}`.trim();
  let openThreads = [...storyline.openThreads, ...threads].slice(-25);

  if (estimateTokens(memory) > MEMORY_COMPRESS_TOKENS) {
    try {
      const llm = await llmProvider();
      const p = buildMemoryCompressPrompt(memory, openThreads);
      const res = await llm.complete(
        { system: p.system, messages: [{ role: "user", content: p.user }], maxTokens: 8000, effort: "medium" },
        { contentItemId: itemId, operation: "memory-compress" },
      );
      const parsed = JSON.parse(extractJson(res.text) ?? "{}") as { story_memory?: string; open_threads?: string[] };
      if (parsed.story_memory && parsed.story_memory.length > 200) {
        memory = parsed.story_memory;
        openThreads = parsed.open_threads ?? openThreads;
        log.info("compressed story memory", { itemId, tokens: estimateTokens(memory) });
      }
    } catch (err) {
      log.warn(`memory compression failed, keeping full memory: ${err}`);
    }
  }

  await prisma.$transaction([
    prisma.storyline.update({
      where: { id: storyline.id },
      data: { storyMemory: memory, openThreads, ...(item.type === "STORY" ? { episodeCount: { increment: 1 } } : {}) },
    }),
    prisma.contentItem.update({ where: { id: itemId }, data: { memoryApplied: true } }),
  ]);
}
