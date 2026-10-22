import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageModelInfo, modelForShot } from "../src/providers/image-models.js";
import { imageCostUsd } from "../src/providers/fal-image.js";
import { BytePlusImage } from "../src/providers/byteplus-image.js";
import { BytePlusI2VBackend, DashScopeI2VBackend, ImageToVideoProvider } from "../src/providers/i2v.js";
import { videoModelInfo } from "../src/providers/video-models.js";
import { pickVideoShots } from "../src/pipeline/compare.js";
import { ffmpeg, probeDuration } from "../src/media/ffmpeg.js";
import { renderMockFrame } from "../src/providers/mock/image.js";

afterEach(() => vi.unstubAllGlobals());
process.env.I2V_POLL_MS = "10";

describe("shots with no characters", () => {
  const map = { default: "gemini:gemini-2.5-flash-image", wide: "fal:flux-2-klein-4b", empty: "fal:z-image-turbo" };
  it("uses the 'empty' model only when nobody is in frame", () => {
    expect(modelForShot(map, "wide", { characters: 0 })).toBe("fal:z-image-turbo");
    expect(modelForShot(map, "wide", { characters: 2 })).toBe("fal:flux-2-klein-4b");
    expect(modelForShot(map, "closeup", { characters: 1 })).toBe("gemini:gemini-2.5-flash-image");
  });
  it("never uses a text-only model for a shot with characters, even if configured", () => {
    expect(modelForShot({ default: "fal:z-image-turbo" }, "medium", { characters: 1 })).toBe("gemini:gemini-2.5-flash-image");
    expect(modelForShot({ closeup: "fal:z-image-turbo", default: "fal:seedream-4.5" }, "closeup", { characters: 1 })).toBe("fal:seedream-4.5");
  });
});

describe("per-reference pricing", () => {
  it("adds input-megapixel cost for each reference image", () => {
    expect(imageCostUsd(imageModelInfo("fal:flux-2-klein-4b"), 3)).toBeCloseTo(0.02, 5);
    expect(imageCostUsd(imageModelInfo("fal:flux-2-pro"), 2)).toBeCloseTo(0.06, 5);
    expect(imageCostUsd(imageModelInfo("gemini:gemini-2.5-flash-image"), 4)).toBe(0.039);
  });
});

describe("BytePlus Seedream images", () => {
  it("sends references in `image` and decodes b64_json", async () => {
    const png = await renderMockFrame({ prompt: "x", references: [], aspect: "16:9" });
    let body: Record<string, unknown> = {};
    let url = "";
    vi.stubGlobal("fetch", async (u: string, init?: { body?: string }) => {
      url = u;
      body = JSON.parse(init!.body!);
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    });
    const img = await new BytePlusImage("k", imageModelInfo("byteplus:seedream-4.0")).generate(
      { prompt: "Dadi in the courtyard", references: [{ mime: "image/png", data: png, label: "Dadi sheet" }, { mime: "image/png", data: png, label: "courtyard" }], aspect: "9:16" },
      { operation: "test" },
    );
    expect(url).toMatch(/\/images\/generations$/);
    expect(body.model).toBe("seedream-4-0-250828");
    expect(body.size).toBe("1080x1920");
    expect(Array.isArray(body.image) && (body.image as string[]).length).toBe(2);
    expect(img.mime).toBe("image/png");
  });
});

async function fakeClip(dir: string) {
  const f = path.join(dir, "fake.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x352:r=24:d=5", "-c:v", "libx264", "-preset", "ultrafast", f]);
  return fs.readFile(f);
}

describe("Seedance (BytePlus) and Wan (DashScope) image-to-video", () => {
  it("Seedance: submits a task with first frame + flags, polls, fits the clip", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kahani-sd-"));
    const still = path.join(dir, "s.png");
    await fs.writeFile(still, await renderMockFrame({ prompt: "close-up", references: [], aspect: "16:9" }));
    const clip = await fakeClip(dir);
    let submitted: Record<string, unknown> = {};
    let polls = 0;
    vi.stubGlobal("fetch", async (u: string, init?: { method?: string; body?: string }) => {
      if (u.endsWith("/contents/generations/tasks") && init?.method === "POST") {
        submitted = JSON.parse(init.body!);
        return Response.json({ id: "task-1" });
      }
      if (u.endsWith("/contents/generations/tasks/task-1")) return Response.json(++polls < 2 ? { status: "running" } : { status: "succeeded", content: { video_url: "https://cdn/v.mp4" } });
      return new Response(new Uint8Array(clip));
    });
    const info = videoModelInfo("i2v:seedance-1.5-pro-720p");
    const out = path.join(dir, "o.mp4");
    await new ImageToVideoProvider(new BytePlusI2VBackend("k", info), info, "closeups").animate(
      { imagePath: still, outPath: out, durationSec: 3, framing: "closeup", speaking: true, width: 640, height: 360, fps: 30, seed: 1, prompt: "Priya laughs", contentType: "STORY" },
      { operation: "test" },
    );
    const content = submitted.content as { type: string; text?: string; role?: string }[];
    expect(submitted.generate_audio).toBe(false);
    expect(content[0].text).toContain("--resolution 720p --duration 5");
    expect(content[1].role).toBe("first_frame");
    expect(await probeDuration(out)).toBeCloseTo(3, 1);
  }, 60_000);

  it("Wan: async task with img_url, polls task status, fits the clip", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kahani-wan-"));
    const still = path.join(dir, "s.png");
    await fs.writeFile(still, await renderMockFrame({ prompt: "wide", references: [], aspect: "9:16" }));
    const clip = await fakeClip(dir);
    let submitted: Record<string, unknown> = {};
    let asyncHeader = "";
    vi.stubGlobal("fetch", async (u: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
      if (u.endsWith("/video-synthesis")) {
        submitted = JSON.parse(init!.body!);
        asyncHeader = init!.headers!["X-DashScope-Async"];
        return Response.json({ output: { task_id: "t9", task_status: "PENDING" } });
      }
      if (u.endsWith("/tasks/t9")) return Response.json({ output: { task_status: "SUCCEEDED", video_url: "https://cdn/w.mp4" } });
      return new Response(new Uint8Array(clip));
    });
    const info = videoModelInfo("i2v:wan-2.6-flash-720p");
    const out = path.join(dir, "o.mp4");
    await new ImageToVideoProvider(new DashScopeI2VBackend("k", info), info, "all").animate(
      { imagePath: still, outPath: out, durationSec: 4.2, framing: "wide", speaking: false, width: 360, height: 640, fps: 30, seed: 2, contentType: "SHORT" },
      { operation: "test" },
    );
    expect(asyncHeader).toBe("enable");
    expect(submitted.model).toBe("wan2.6-i2v-flash");
    expect((submitted.parameters as Record<string, unknown>).resolution).toBe("720P");
    expect(String((submitted.input as Record<string, unknown>).img_url)).toMatch(/^data:image\/jpeg;base64,/);
    expect(await probeDuration(out)).toBeCloseTo(4.2, 1);
  }, 60_000);
});

describe("video comparison shot picking", () => {
  it("prefers dialogue close-ups that already have images", () => {
    const shots = [
      { idx: 1, framing: "wide", speaker: "narrator", imageKey: "a" },
      { idx: 2, framing: "closeup", speaker: "priya", imageKey: "b" },
      { idx: 3, framing: "closeup", speaker: "dadi", imageKey: null },
      { idx: 4, framing: "medium", speaker: "dadi", imageKey: "c" },
      { idx: 5, framing: "closeup", speaker: "bholu", imageKey: "d" },
    ];
    expect(pickVideoShots(shots, 2)).toEqual([2, 5]);
    expect(pickVideoShots(shots, 4)).toEqual([1, 2, 4, 5]);
  });
});
