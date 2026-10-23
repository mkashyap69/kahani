import { NonRetryableError, sleep, withRetry } from "../util/retry.js";

/**
 * Task-based API gateways (APIMart, EvoLink): POST /v1/{images|videos}/generations → task id,
 * GET /v1/tasks/{id} until completed. Response shapes differ slightly, so parsing is tolerant.
 */
export type Gateway = "apimart" | "evolink";
export const GATEWAY_BASE: Record<Gateway, () => string> = {
  apimart: () => process.env.APIMART_BASE ?? "https://api.apimart.ai/v1",
  evolink: () => process.env.EVOLINK_BASE ?? "https://api.evolink.ai/v1",
};
export const GATEWAY_SECRET = { apimart: "APIMART_API_KEY", evolink: "EVOLINK_API_KEY" } as const;

type Json = Record<string, unknown>;
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Json)[/^\d+$/.test(k) ? Number(k) : k] : undefined), o);

export function taskIdOf(res: unknown): string | null {
  for (const p of ["data.task_id", "task_id", "data.id", "id", "data.0.task_id", "data.0.id"]) {
    const v = get(res, p);
    if (typeof v === "string" && v) return v;
  }
  return null;
}

export function taskStateOf(res: unknown): { state: "running" } | { state: "done"; urls: string[] } | { state: "failed"; error: string } {
  const status = String(get(res, "data.status") ?? get(res, "status") ?? "").toLowerCase();
  if (/fail|error|cancel|expire/.test(status)) return { state: "failed", error: JSON.stringify(get(res, "data.error") ?? get(res, "error") ?? status).slice(0, 300) };
  if (!/complet|succe|done|finish/.test(status)) return { state: "running" };
  const urls: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === "string" && /^https?:/.test(v)) urls.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") collect((v as Json).url ?? (v as Json).urls);
  };
  for (const p of ["data.result.images", "data.result.videos", "data.results", "results", "data.result.url", "data.url", "data.video_url", "data.image_url"]) collect(get(res, p));
  return urls.length ? { state: "done", urls } : { state: "failed", error: `completed without a result URL: ${JSON.stringify(res).slice(0, 300)}` };
}

export class GatewayClient {
  constructor(
    readonly gateway: Gateway,
    private apiKey: string,
  ) {}
  private headers() {
    return { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" };
  }
  async submit(kind: "images" | "videos", body: Json): Promise<string> {
    const res = await withRetry(async () => {
      const r = await fetch(`${GATEWAY_BASE[this.gateway]()}/${kind}/generations`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
      if (!r.ok) {
        const t = await r.text();
        throw Object.assign(r.status >= 400 && r.status < 500 && r.status !== 429 ? new NonRetryableError(`${this.gateway} ${r.status}: ${t}`) : new Error(`${this.gateway} ${r.status}: ${t}`), { status: r.status });
      }
      return r.json();
    });
    const id = taskIdOf(res);
    if (!id) throw new Error(`${this.gateway} returned no task id: ${JSON.stringify(res).slice(0, 300)}`);
    return id;
  }
  async poll(id: string) {
    const r = await withRetry(async () => (await fetch(`${GATEWAY_BASE[this.gateway]()}/tasks/${id}`, { headers: this.headers() })).json());
    return taskStateOf(r);
  }
  /** submit + wait (used for images; videos are polled by the image-to-video provider) */
  async run(kind: "images" | "videos", body: Json, timeoutMs = 5 * 60_000): Promise<string[]> {
    const id = await this.submit(kind, body);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`${this.gateway} task ${id} timed out`);
      await sleep(Number(process.env.GATEWAY_POLL_MS ?? 2000));
      const s = await this.poll(id);
      if (s.state === "failed") throw new Error(`${this.gateway} task failed: ${s.error}`);
      if (s.state === "done") return s.urls;
    }
  }
}
