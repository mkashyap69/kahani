import crypto from "node:crypto";
import sharp from "sharp";
import { logApiCall } from "../../cost.js";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import type { BatchImageRequest, BatchPoll, CallContext, ImageBatchProvider, ImageProvider, ImageRequest, VisionJudge } from "../types.js";

const PALETTE = ["#ff6fa8", "#2fb36d", "#f7b733", "#4a90e2", "#e94e3c", "#8e5bd8", "#20b2aa", "#ff8c42"];
const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#d8a47f"];
const SKY: Record<string, [string, string]> = {
  dawn: ["#ffb7c5", "#ffe4b5"],
  day: ["#6ec6ff", "#d6f0ff"],
  evening: ["#ff9a5a", "#ffd28a"],
  night: ["#0f1d40", "#33406b"],
};

const h = (s: string) => crypto.createHash("md5").update(s).digest().readUInt32LE(0);
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

function mouth(emotion: string, cx: number, cy: number, r: number) {
  const w = r * 0.45;
  if (/happy|laugh/.test(emotion)) return `<path d="M${cx - w} ${cy} Q${cx} ${cy + w} ${cx + w} ${cy}" stroke="#222" stroke-width="${r * 0.08}" fill="#a33"/>`;
  if (/surpris|shock|curious/.test(emotion)) return `<ellipse cx="${cx}" cy="${cy + r * 0.05}" rx="${r * 0.13}" ry="${r * 0.18}" fill="#622" stroke="#222" stroke-width="${r * 0.06}"/>`;
  if (/angry|irritat|sad|worr/.test(emotion)) return `<path d="M${cx - w} ${cy + w * 0.5} Q${cx} ${cy - w * 0.3} ${cx + w} ${cy + w * 0.5}" stroke="#222" stroke-width="${r * 0.08}" fill="none"/>`;
  return `<path d="M${cx - w * 0.7} ${cy} L${cx + w * 0.7} ${cy}" stroke="#222" stroke-width="${r * 0.08}"/>`;
}

function character(key: string, x: number, groundY: number, scale: number, emotion: string) {
  const c = PALETTE[h(key) % PALETTE.length];
  const skin = SKIN[h(key + "s") % SKIN.length];
  const r = 70 * scale;
  const bodyH = 220 * scale;
  const headY = groundY - bodyH - r * 0.8;
  const o = Math.max(4, 7 * scale);
  return `
  <g>
    <rect x="${x - r * 1.1}" y="${groundY - bodyH}" width="${r * 2.2}" height="${bodyH}" rx="${r * 0.7}" fill="${c}" stroke="#1b1b1b" stroke-width="${o}"/>
    <circle cx="${x}" cy="${headY}" r="${r}" fill="${skin}" stroke="#1b1b1b" stroke-width="${o}"/>
    <path d="M${x - r} ${headY - r * 0.1} Q${x} ${headY - r * 1.6} ${x + r} ${headY - r * 0.1} Q${x} ${headY - r * 0.7} ${x - r} ${headY - r * 0.1}" fill="#2b1a10"/>
    <circle cx="${x - r * 0.35}" cy="${headY}" r="${r * 0.11}" fill="#111"/>
    <circle cx="${x + r * 0.35}" cy="${headY}" r="${r * 0.11}" fill="#111"/>
    ${mouth(emotion, x, headY + r * 0.42, r)}
    <text x="${x}" y="${groundY + 46 * scale}" font-family="DejaVu Sans" font-weight="bold" font-size="${30 * scale}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="${2 * scale}">${esc(key)}</text>
  </g>`;
}

/** Renders flat 2D "cartoon" placeholder frames (no API) so the pipeline and motion are visible offline. */
export function renderMockFrame(req: ImageRequest): Promise<Buffer> {
  const [W, H] = req.aspect === "9:16" ? [1080, 1920] : req.aspect === "1:1" ? [1024, 1024] : [1920, 1080];
  const m = req.meta ?? {};
  if (m.kind === "logo") return renderMockLogo(W, m);
  const time = /night/.test(req.prompt) ? "night" : /evening/.test(req.prompt) ? "evening" : /dawn/.test(req.prompt) ? "dawn" : "day";
  const [sky1, sky2] = SKY[time];
  const loc = m.location ?? "village";
  const lh = h(loc);
  const ground = ["#7cb342", "#c2a26b", "#8d6e63", "#9ccc65"][lh % 4];
  const groundY = H * 0.78;
  const chars = m.characters ?? [];
  const close = /close-up/.test(req.prompt) || m.kind === "thumbnail";
  const scale = close ? (req.aspect === "9:16" ? 2.6 : 2.2) : req.aspect === "9:16" ? 1.25 : 1;
  const spacing = W / (chars.length + 1);
  const props = Array.from({ length: 3 }, (_, i) => {
    const px = ((lh >> (i * 3)) % 7) / 7 * W + 80;
    return i % 2
      ? `<g><rect x="${px - 10}" y="${groundY - 260}" width="20" height="260" fill="#6d4c41" stroke="#1b1b1b" stroke-width="5"/><circle cx="${px}" cy="${groundY - 300}" r="110" fill="#388e3c" stroke="#1b1b1b" stroke-width="6"/></g>`
      : `<g><rect x="${px - 120}" y="${groundY - 200}" width="240" height="200" fill="#ffcc80" stroke="#1b1b1b" stroke-width="6"/><polygon points="${px - 150},${groundY - 200} ${px},${groundY - 320} ${px + 150},${groundY - 200}" fill="#d84315" stroke="#1b1b1b" stroke-width="6"/></g>`;
  }).join("");
  const sheet = m.kind === "sheet";
  const banner = m.kind === "banner";
  const figures = sheet
    ? [0.2, 0.5, 0.8].map((f, i) => character(chars[0] ?? "hero", W * f, groundY, i === 2 ? 1.25 : 1, ["happy", "surprised", "neutral"][i])).join("")
    : banner
      ? chars.map((k, i) => character(k, i % 2 ? W - 160 - Math.floor(i / 2) * 170 : 160 + Math.floor(i / 2) * 170, groundY, 1, "happy")).join("")
      : chars.map((k, i) => character(k, spacing * (i + 1), close ? H * 1.05 : groundY, scale, m.emotion ?? "neutral")).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    ${time === "night" ? `<circle cx="${W * 0.82}" cy="${H * 0.15}" r="60" fill="#fff8d6"/>` : `<circle cx="${W * 0.82}" cy="${H * 0.15}" r="80" fill="#ffe066" stroke="#1b1b1b" stroke-width="5"/>`}
    <rect y="${groundY}" width="${W}" height="${H - groundY}" fill="${ground}" stroke="#1b1b1b" stroke-width="6"/>
    ${close || sheet ? "" : props}
    ${figures}
    <rect x="20" y="20" width="${Math.min(W - 40, 900)}" height="64" rx="14" fill="#000" fill-opacity="0.45"/>
    <text x="40" y="64" font-family="DejaVu Sans" font-size="30" fill="#fff">${esc((m.title ?? `${loc} · ${m.emotion ?? ""}`).slice(0, 60))}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function renderMockLogo(W: number, m: NonNullable<ImageRequest["meta"]>): Promise<Buffer> {
  const key = m.characters?.[0] ?? m.title ?? "logo";
  const bg = PALETTE[h(key + (m.title ?? "")) % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}">
    <rect width="${W}" height="${W}" fill="${bg}"/>
    <circle cx="${W / 2}" cy="${W / 2}" r="${W * 0.42}" fill="#fff7e0" stroke="#1b1b1b" stroke-width="24"/>
    ${character(key, W / 2, W * 1.02, 2.4, "happy")}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export class MockImage implements ImageProvider {
  readonly name = "mock-image";
  /** the real model this stands in for (tints frames so comparisons are visibly different) */
  constructor(readonly model = "mock") {}
  async generate(req: ImageRequest, ctx: CallContext) {
    let data = await renderMockFrame({ ...req, meta: { ...req.meta, title: this.model === "mock" ? req.meta?.title : `${this.model} · ${req.meta?.title ?? ""}` } });
    if (this.model !== "mock") data = await sharp(data).modulate({ hue: h(this.model) % 360 }).png().toBuffer();
    await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "image", images: 1 });
    return { data, mime: "image/png" };
  }
}

export class MockJudge implements VisionJudge {
  readonly name = "mock-judge";
  async scoreConsistency() {
    return { score: 8, reason: "mock judge" };
  }
}

/** Offline batch: renders immediately and "completes" on the first poll. */
export class MockImageBatch implements ImageBatchProvider {
  readonly name = "mock-batch";
  constructor(readonly model = "mock") {}
  async submit(requests: BatchImageRequest[], label: string) {
    const job = `mock-batch-${label}-${Date.now().toString(36)}`;
    const dir = path.join(config.workDir, "_batches", job);
    await fs.mkdir(dir, { recursive: true });
    const img = new MockImage(this.model);
    for (const r of requests) {
      const res = await img.generate({ prompt: r.prompt, references: r.references, aspect: r.aspect, meta: r.meta }, { operation: "mock-batch" });
      await fs.writeFile(path.join(dir, `${r.key}.png`), res.data);
    }
    return job;
  }
  async poll(job: string): Promise<BatchPoll> {
    const dir = path.join(config.workDir, "_batches", job);
    const results = new Map<string, { data: Buffer; mime: string } | { error: string }>();
    for (const f of await fs.readdir(dir)) results.set(f.replace(/\.png$/, ""), { data: await fs.readFile(path.join(dir, f)), mime: "image/png" });
    return { done: true, results };
  }
  async cancel() {}
}
