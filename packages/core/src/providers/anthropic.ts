import Anthropic from "@anthropic-ai/sdk";
import { logApiCall } from "../cost.js";
import { NonRetryableError, withRetry } from "../util/retry.js";
import type { CallContext, LLMProvider, LLMRequest, LLMResponse } from "./types.js";

/**
 * Claude via the official SDK. Streams (long script outputs) and opts into
 * server-side refusal fallbacks ("default" routing) unless ANTHROPIC_FALLBACKS=off.
 */
export class AnthropicLLM implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    // the SDK already retries 408/409/429/5xx; we add an outer jittered retry for stream drops
    this.client = new Anthropic({ apiKey, maxRetries: 3 });
  }

  async complete(req: LLMRequest, ctx: CallContext): Promise<LLMResponse> {
    const useFallbacks = (process.env.ANTHROPIC_FALLBACKS ?? "default") !== "off";
    const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m, i) => {
      const isFirstUser = i === 0 && m.role === "user" && req.images?.length;
      if (!isFirstUser) return { role: m.role, content: m.content };
      return {
        role: "user",
        content: [
          ...req.images!.map(
            (img): Anthropic.Beta.BetaImageBlockParam => ({
              type: "image",
              source: { type: "base64", media_type: img.mime as "image/png", data: img.data.toString("base64") },
            }),
          ),
          { type: "text", text: m.content },
        ],
      };
    });

    const tools: Anthropic.Beta.BetaToolUnion[] | undefined = req.webSearch
      ? [{ type: "web_search_20260209", name: "web_search", max_uses: req.webSearch.maxUses }]
      : undefined;
    try {
      const send = (msgs: Anthropic.Beta.BetaMessageParam[]) =>
        withRetry(
          async () => {
            const stream = this.client.beta.messages.stream({
              model: this.model,
              max_tokens: req.maxTokens ?? 64000,
              system: req.system,
              messages: msgs,
              output_config: { effort: req.effort ?? "high" },
              ...(tools ? { tools } : {}),
              ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
            });
            return stream.finalMessage();
          },
          { retries: 2, baseMs: 3000 },
        );

      // Server-side web search can pause long turns: resume by sending the paused turn back.
      let msg = await send(messages);
      const content: Anthropic.Beta.BetaContentBlock[] = [...msg.content];
      let searches = msg.usage.server_tool_use?.web_search_requests ?? 0;
      let inTok = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
      let outTok = msg.usage.output_tokens;
      for (let i = 0; msg.stop_reason === "pause_turn" && i < 5; i++) {
        msg = await send([...messages, { role: "assistant", content: content as Anthropic.Beta.BetaContentBlockParam[] }]);
        content.push(...msg.content);
        searches += msg.usage.server_tool_use?.web_search_requests ?? 0;
        inTok += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
        outTok += msg.usage.output_tokens;
      }
      const sources = new Map<string, string>();
      for (const b of content) {
        if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
          for (const r of b.content) if (r.type === "web_search_result") sources.set(r.url, r.title);
        }
      }

      if (msg.stop_reason === "refusal") {
        throw new NonRetryableError(`Claude declined the request (${msg.stop_details?.category ?? "unknown category"})`);
      }
      // only the text after the last tool result is the answer
      const lastTool = content.map((b) => b.type).lastIndexOf("web_search_tool_result");
      const text = content
        .slice(lastTool + 1)
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      await logApiCall({
        contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId,
        provider: this.name,
        model: msg.model ?? this.model,
        operation: ctx.operation ?? "llm",
        inputTokens: inTok,
        outputTokens: outTok,
        searches,
      });
      const src = [...sources.entries()].map(([url, title]) => ({ url, title }));
      return { text, inputTokens: inTok, outputTokens: outTok, stopReason: msg.stop_reason, sources: src };
    } catch (err) {
      await logApiCall({
        contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId,
        provider: this.name,
        model: this.model,
        operation: ctx.operation ?? "llm",
        success: false,
        error: String(err),
      });
      throw err;
    }
  }
}
