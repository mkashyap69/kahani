import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { logApiCall } from "../cost.js";
import { config } from "../config.js";
import { hashOf } from "../util/crypto.js";
import { imageModelInfo } from "./image-models.js";
import type { BatchImageRequest, BatchPoll, ImageBatchProvider } from "./types.js";
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
        contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId,
        provider: this.name,
        model: this.model,
        operation: ctx.operation ?? "image",
        inputTokens: result.res.usageMetadata?.promptTokenCount ?? 0,
        images: 1,
        costInr: imageModelInfo(`gemini:${this.model}`).usd * config.usdToInr,
      });
      return { data: Buffer.from(result.img.data!, "base64"), mime: result.img.mimeType ?? "image/png" };
    } catch (err) {
      await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "image", success: false, error: String(err) });
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
      contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId,
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

/**
 * Gemini Batch API for images (~50% of the standard price; results usually within hours, at most 24h).
 * Reference images are uploaded once via the Files API and referenced by URI from a JSONL request file.
 */
export class GeminiBatch implements ImageBatchProvider {
  readonly name = "gemini-batch";
  private ai: GoogleGenAI;
  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async submit(requests: BatchImageRequest[], label: string): Promise<string> {
    const uploaded = new Map<string, string>();
    const uriFor = async (data: Buffer, mime: string) => {
      const h = hashOf(data.toString("base64"));
      if (!uploaded.has(h)) {
        const f = await withRetry(() => this.ai.files.upload({ file: new Blob([new Uint8Array(data)], { type: mime }), config: { mimeType: mime, displayName: `ref-${h.slice(0, 8)}` } }));
        uploaded.set(h, f.uri!);
      }
      return uploaded.get(h)!;
    };
    const lines: string[] = [];
    for (const r of requests) {
      const parts: Record<string, unknown>[] = [];
      for (const ref of r.references) {
        if (ref.label) parts.push({ text: `Reference image — ${ref.label}:` });
        parts.push({ fileData: { fileUri: await uriFor(ref.data, ref.mime), mimeType: ref.mime } });
      }
      parts.push({ text: r.prompt });
      lines.push(
        JSON.stringify({
          key: r.key,
          request: { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: r.aspect } } },
        }),
      );
    }
    const dir = path.join(config.workDir, "_batches");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${hashOf([label, Date.now()]).slice(0, 12)}.jsonl`);
    await fs.writeFile(file, lines.join("\n"));
    const input = await withRetry(() => this.ai.files.upload({ file, config: { mimeType: "jsonl", displayName: `kahani-${label}` } }));
    const job = await withRetry(() => this.ai.batches.create({ model: this.model, src: input.name!, config: { displayName: `kahani-${label}` } }));
    return job.name!;
  }

  async poll(job: string): Promise<BatchPoll> {
    const b = await withRetry(() => this.ai.batches.get({ name: job }));
    const state = String(b.state);
    if (/FAILED|CANCELLED|EXPIRED/.test(state)) return { done: true, failed: `${state}: ${b.error?.message ?? ""}` };
    if (!/SUCCEEDED/.test(state)) return { done: false, state };
    const results = new Map<string, { data: Buffer; mime: string } | { error: string }>();
    const take = (key: string, resp: unknown, err?: unknown) => {
      const r = resp as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] }; finishReason?: string }[] } | undefined;
      const img = r?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      results.set(key, img?.data ? { data: Buffer.from(img.data, "base64"), mime: img.mimeType ?? "image/png" } : { error: err ? JSON.stringify(err).slice(0, 300) : `no image (${r?.candidates?.[0]?.finishReason ?? "unknown"})` });
    };
    if (b.dest?.fileName) {
      const out = path.join(config.workDir, "_batches", `${job.replace(/\W+/g, "_")}.out.jsonl`);
      await this.ai.files.download({ file: b.dest.fileName, downloadPath: out });
      for (const line of (await fs.readFile(out, "utf8")).split("\n")) {
        if (!line.trim()) continue;
        const row = JSON.parse(line) as { key?: string; response?: unknown; error?: unknown };
        if (row.key) take(row.key, row.response, row.error);
      }
    }
    return { done: true, results };
  }

  async cancel(job: string) {
    await this.ai.batches.cancel({ name: job }).catch(() => undefined);
  }
}
