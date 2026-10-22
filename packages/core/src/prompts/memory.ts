export function buildMemoryCompressPrompt(memory: string, openThreads: string[]): { system: string; user: string } {
  return {
    system:
      "You maintain the 'story so far' bible of a long-running animated series. Compress it without losing continuity-critical facts: relationships, secrets revealed, promises made, running gags, character changes, and every unresolved hook. Write in English, chronological, dense bullet points. Output JSON only.",
    user: `Current memory:\n${memory}\n\nOpen threads:\n${openThreads.map((t) => `- ${t}`).join("\n")}\n\nReturn {"story_memory": "compressed text, at most ~1500 words", "open_threads": ["..."]}`,
  };
}

/** ~4 chars per token for English text. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);
export const MEMORY_COMPRESS_TOKENS = 3000;
