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

    try {
      const msg = await withRetry(
        async () => {
          const stream = this.client.beta.messages.stream({
            model: this.model,
            max_tokens: req.maxTokens ?? 64000,
            system: req.system,
            messages,
            output_config: { effort: req.effort ?? "high" },
            ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          });
          return stream.finalMessage();
        },
        { retries: 2, baseMs: 3000 },
      );

      if (msg.stop_reason === "refusal") {
        throw new NonRetryableError(`Claude declined the request (${msg.stop_details?.category ?? "unknown category"})`);
      }
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const inputTokens = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
      await logApiCall({
        contentItemId: ctx.contentItemId,
        provider: this.name,
        model: msg.model ?? this.model,
        operation: ctx.operation ?? "llm",
        inputTokens,
        outputTokens: msg.usage.output_tokens,
      });
      if (msg.stop_reason === "max_tokens") {
        // truncated JSON will fail validation; surface it clearly
        return { text, inputTokens, outputTokens: msg.usage.output_tokens, stopReason: "max_tokens" };
      }
      return { text, inputTokens, outputTokens: msg.usage.output_tokens, stopReason: msg.stop_reason };
    } catch (err) {
      await logApiCall({
        contentItemId: ctx.contentItemId,
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
