import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inMotionScope, videoModelInfo, videoUsdPerSec } from "../src/providers/video-models.js";
import { imageModelInfo } from "../src/providers/image-models.js";
import { FalImage, falSizeInput } from "../src/providers/fal-image.js";
import { FalImageToVideoProvider } from "../src/providers/i2v.js";
import { ffmpeg, probeDuration } from "../src/media/ffmpeg.js";
import { renderMockFrame } from "../src/providers/mock/image.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FLUX_3_MAX_USD_PER_SEC;
});

describe("FLUX 3 Max pricing and scope", () => {
  const max = videoModelInfo("i2v:flux-3-max");
  it("uses the promo price until it ends, then list", () => {
    expect(videoUsdPerSec(max, new Date("2026-11-06T23:00:00Z"))).toBe(0.0425);
    expect(videoUsdPerSec(max, new Date("2026-11-07T00:00:00Z"))).toBe(0.17);
  });
  it("lets an env var override the price", () => {
    process.env.FLUX_3_MAX_USD_PER_SEC = "0.1";
    expect(videoUsdPerSec(max)).toBe(0.1);
  });
  it("applies the motion scope", () => {
    const close = { framing: "closeup", speaking: true, contentType: "STORY" as const };
    const wide = { framing: "wide", speaking: false, contentType: "STORY" as const };
    const shortWide = { ...wide, contentType: "SHORT" as const };
    expect([inMotionScope("closeups", close), inMotionScope("closeups", wide)]).toEqual([true, false]);
    expect([inMotionScope("dialogue", { ...wide, speaking: true }), inMotionScope("dialogue", wide)]).toEqual([true, false]);
    expect([inMotionScope("shorts", shortWide), inMotionScope("shorts", close)]).toEqual([true, false]);
    expect(inMotionScope("all", wide)).toBe(true);
  });
});

describe("fal request shapes", () => {
  it("FLUX 3 Image uses resolution + aspect_ratio; others use image_size", () => {
    expect(falSizeInput(imageModelInfo("fal:flux-3-image"), "9:16")).toEqual({ resolution: "1k", aspect_ratio: "9:16" });
    expect(falSizeInput(imageModelInfo("fal:flux-3-klein"), "16:9")).toEqual({ image_size: "landscape_16_9" });
    expect(falSizeInput(imageModelInfo("fal:seedream-4.5"), "1:1")).toEqual({ image_size: "square_hd" });
  });

  it("FalImage submits to the edit endpoint with reference data URIs and returns the image", async () => {
    const png = await renderMockFrame({ prompt: "x", references: [], aspect: "16:9" });
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.startsWith("https://queue.fal.run/")) return Response.json({ status_url: "https://q/status", response_url: "https://q/result" });
      if (url === "https://q/status") return Response.json({ status: "COMPLETED" });
      if (url === "https://q/result") return Response.json({ images: [{ url: "https://cdn/img.png", content_type: "image/png" }] });
      return new Response(new Uint8Array(png));
    });
    const img = await new FalImage("k", imageModelInfo("fal:flux-3-image")).generate(
      { prompt: "Priya at the chai stall", references: [{ mime: "image/png", data: png, label: "Priya sheet" }], aspect: "16:9" },
      { operation: "test" },
    );
    expect(calls[0].url).toBe("https://queue.fal.run/blackforestlabs/flux-3/edit-image");
    const body = calls[0].body as Record<string, unknown>;
    expect((body.image_urls as string[])[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.resolution).toBe("1k");
    expect(img.data.length).toBeGreaterThan(1000);
  }, 30_000);
});

describe("FLUX 3 Max image-to-video provider", () => {
  it("sends the still + prompt, then trims the returned clip to the shot length (no audio)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kahani-i2v-"));
    const still = path.join(dir, "still.png");
    await fs.writeFile(still, await renderMockFrame({ prompt: "close-up", references: [], aspect: "16:9" }));
    // fake provider output: a 6 s clip with audio, different size and fps
    const fake = path.join(dir, "fake.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x352:r=24:d=6", "-f", "lavfi", "-i", "sine=d=6", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", fake]);
    const bytes = await fs.readFile(fake);
    let submitted: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      if (url.startsWith("https://queue.fal.run/")) {
        submitted = JSON.parse(init!.body!);
        return Response.json({ status_url: "https://q/status", response_url: "https://q/result" });
      }
      if (url === "https://q/status") return Response.json({ status: "COMPLETED" });
      if (url === "https://q/result") return Response.json({ video: { url: "https://cdn/v.mp4" } });
      return new Response(new Uint8Array(bytes));
    });
    const provider = new FalImageToVideoProvider("k", videoModelInfo("i2v:flux-3-max"), "closeups");
    const out = path.join(dir, "clip.mp4");
    await provider.animate(
      { imagePath: still, outPath: out, durationSec: 3.4, framing: "closeup", speaking: true, width: 640, height: 360, fps: 30, seed: 1, prompt: "Dadi laughs", contentType: "STORY" },
      { operation: "test" },
    );
    expect(submitted.duration).toBe(5); // model minimum
    expect(String(submitted.image_url)).toMatch(/^data:image\/jpeg;base64,/);
    expect(String(submitted.prompt)).toContain("Dadi laughs");
    expect(await probeDuration(out)).toBeCloseTo(3.4, 1);
    const { stdout } = await import("node:child_process").then((cp) =>
      new Promise<{ stdout: string }>((res) => cp.execFile("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", out], (_, stdout) => res({ stdout }))),
    );
    expect(stdout.trim()).toBe("video,640,360");
  }, 60_000);

  it("falls back to Ken Burns for shots outside the scope (no API call)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kahani-i2v-"));
    const still = path.join(dir, "still.png");
    await fs.writeFile(still, await renderMockFrame({ prompt: "wide", references: [], aspect: "16:9" }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = path.join(dir, "kb.mp4");
    await new FalImageToVideoProvider("k", videoModelInfo("i2v:flux-3-max"), "closeups").animate(
      { imagePath: still, outPath: out, durationSec: 2.5, framing: "wide", speaking: false, width: 640, height: 360, fps: 30, seed: 2, contentType: "STORY" },
      { operation: "test" },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await probeDuration(out)).toBeCloseTo(2.5, 1);
  }, 60_000);
});
