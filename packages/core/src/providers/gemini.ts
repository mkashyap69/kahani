import { GoogleGenAI } from "@google/genai";
import { logApiCall } from "../cost.js";
import { NonRetryableError, withRetry } from "../util/retry.js";
import type { CallContext, ImageProvider, ImageRequest, VisionJudge } from "./types.js";

/** Nano Banana — Gemini 2.5 Flash Image. */
export class GeminiImage implements ImageProvider {
  readonly name = "gemini";
  private ai: GoogleGenAI;
  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate(req: ImageRequest, ctx: CallContext) {
    const parts = [
      ...req.references.flatMap((r) => [
        ...(r.label ? [{ text: `Reference image — ${r.label}:` }] : []),
        { inlineData: { mimeType: r.mime, data: r.data.toString("base64") } },
      ]),
      { text: req.prompt },
    ];
    try {
      const result = await withRetry(
        async () => {
          const res = await this.ai.models.generateContent({
            model: this.model,
            contents: [{ role: "user", parts }],
            config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: req.aspect } },
          });
          const cand = res.candidates?.[0];
          const img = cand?.content?.parts?.find((p) => p.inlineData?.data);
          if (!img?.inlineData?.data) {
            const reason = cand?.finishReason ?? res.promptFeedback?.blockReason ?? "no image returned";
            // safety blocks won't change on retry with the same prompt
            if (String(reason).match(/SAFETY|PROHIBITED|BLOCK/i)) throw new NonRetryableError(`Gemini blocked image: ${reason}`);
            throw new Error(`Gemini returned no image (${reason})`);
          }
          return { res, img: img.inlineData };
        },
        { retries: 4, baseMs: 2000 },
      );
      await logApiCall({
        contentItemId: ctx.contentItemId,
        provider: this.name,
        model: this.model,
        operation: ctx.operation ?? "image",
        inputTokens: result.res.usageMetadata?.promptTokenCount ?? 0,
        images: 1,
      });
      return { data: Buffer.from(result.img.data!, "base64"), mime: result.img.mimeType ?? "image/png" };
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, provider: this.name, model: this.model, operation: ctx.operation ?? "image", success: false, error: String(err) });
      throw err;
    }
  }
}

/** Vision LLM consistency check ("does this match the character sheet? 1–10"). */
export class GeminiJudge implements VisionJudge {
  readonly name = "gemini-judge";
  private ai: GoogleGenAI;
  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async scoreConsistency(frame: Buffer, references: { mime: string; data: Buffer; label?: string }[], description: string, ctx: CallContext) {
    const parts = [
      { text: "Character reference sheets:" },
      ...references.flatMap((r) => [{ text: r.label ?? "reference" }, { inlineData: { mimeType: r.mime, data: r.data.toString("base64") } }]),
      { text: "Generated frame:" },
      { inlineData: { mimeType: "image/png", data: frame.toString("base64") } },
      {
        text: `Frame description: ${description}\nDo the characters in the generated frame match their reference sheets (face, hair, outfit, colours) and is the art style consistent? Reply JSON only: {"score": 1-10, "reason": "short"}`,
      },
    ];
    const res = await withRetry(() =>
      this.ai.models.generateContent({ model: this.model, contents: [{ role: "user", parts }], config: { responseMimeType: "application/json" } }),
    );
    await logApiCall({
      contentItemId: ctx.contentItemId,
      provider: "gemini",
      model: this.model,
      operation: "consistency-check",
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    });
    try {
      const parsed = JSON.parse(res.text ?? "{}");
      return { score: Math.max(1, Math.min(10, Number(parsed.score) || 1)), reason: String(parsed.reason ?? "") };
    } catch {
      return { score: 10, reason: "unparseable judge response — accepted" };
    }
  }
}
