import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taskIdOf, taskStateOf } from "../src/providers/gateway.js";
import { GatewayImage } from "../src/providers/gateway-image.js";
import { GatewayI2VBackend, ImageToVideoProvider } from "../src/providers/i2v.js";
import { imageModelInfo } from "../src/providers/image-models.js";
import { videoModelInfo } from "../src/providers/video-models.js";
import { MockImage, renderMockFrame } from "../src/providers/mock/image.js";
import { ffmpeg, probeDuration } from "../src/media/ffmpeg.js";

afterEach(() => vi.unstubAllGlobals());
process.env.GATEWAY_POLL_MS = "5";
process.env.I2V_POLL_MS = "5";

describe("gateway response parsing", () => {
  it("finds task ids in APIMart and EvoLink shapes", () => {
    expect(taskIdOf({ code: 200, data: [{ status: "submitted", task_id: "t1" }] })).toBe("t1");
    expect(taskIdOf({ data: { task_id: "t2" } })).toBe("t2");
    expect(taskIdOf({ id: "task-unified-3", status: "pending" })).toBe("task-unified-3");
  });
  it("reads status and result URLs", () => {
    expect(taskStateOf({ data: { status: "processing" } }).state).toBe("running");
    expect(taskStateOf({ data: { status: "completed", result: { videos: [{ url: ["https://cdn/v.mp4"] }] } } })).toEqual({ state: "done", urls: ["https://cdn/v.mp4"] });
    expect(taskStateOf({ status: "completed", results: ["https://cdn/i.png"] })).toEqual({ state: "done", urls: ["https://cdn/i.png"] });
    expect(taskStateOf({ data: { status: "failed", error: { message: "nsfw" } } }).state).toBe("failed");
    expect(taskStateOf({ status: "completed" }).state).toBe("failed");
  });
});

describe("gateway images", () => {
  it("APIMart: submits with image_urls, downloads the result", async () => {
    const png = await renderMockFrame({ prompt: "x", references: [], aspect: "16:9" });
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (u: string, init?: { method?: string; body?: string }) => {
      if (u.endsWith("/images/generations")) {
        body = JSON.parse(init!.body!);
        return Response.json({ data: [{ task_id: "img1" }] });
      }
      if (u.endsWith("/tasks/img1")) return Response.json({ data: { status: "completed", result: { images: [{ url: ["https://cdn/i.png"] }] } } });
      return new Response(new Uint8Array(png));
    });
    const img = await new GatewayImage("k", imageModelInfo("apimart:nano-banana"), new MockImage()).generate(
      { prompt: "Priya", references: [{ mime: "image/png", data: png, label: "Priya sheet" }], aspect: "9:16" },
      { operation: "test" },
    );
    expect(body.model).toBe("gemini-2.5-flash-image");
    expect(body.size).toBe("9:16");
    expect((body.image_urls as string[])[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(img.mime).toBe("image/png");
  });

  it("falls back to the direct provider when the gateway fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const fallback = new MockImage();
    const spy = vi.spyOn(fallback, "generate");
    process.env.GATEWAY_POLL_MS = "1";
    const img = await new GatewayImage("k", imageModelInfo("evolink:nano-banana"), fallback).generate({ prompt: "x", references: [], aspect: "16:9" }, { operation: "test" });
    expect(spy).toHaveBeenCalledOnce();
    expect(img.data.length).toBeGreaterThan(1000);
  }, 120_000);
});

describe("gateway video", () => {
  for (const id of ["i2v:evolink-seedance-2.0-mini", "i2v:apimart-seedance-2.0"]) {
    it(`${id}: submits the still and fits the clip`, async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kahani-gw-"));
      const still = path.join(dir, "s.png");
      await fs.writeFile(still, await renderMockFrame({ prompt: "close-up", references: [], aspect: "16:9" }));
      const fake = path.join(dir, "f.mp4");
      await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=640x352:r=24:d=5", "-c:v", "libx264", "-preset", "ultrafast", fake]);
      const clip = await fs.readFile(fake);
      let body: Record<string, unknown> = {};
      vi.stubGlobal("fetch", async (u: string, init?: { body?: string }) => {
        if (u.endsWith("/videos/generations")) {
          body = JSON.parse(init!.body!);
          return Response.json({ id: "v1", status: "pending" });
        }
        if (u.endsWith("/tasks/v1")) return Response.json({ status: "completed", results: ["https://cdn/v.mp4"] });
        return new Response(new Uint8Array(clip));
      });
      const info = videoModelInfo(id);
      const out = path.join(dir, "o.mp4");
      await new ImageToVideoProvider(new GatewayI2VBackend("k", info), info, "all").animate(
        { imagePath: still, outPath: out, durationSec: 3.2, framing: "closeup", speaking: true, width: 640, height: 360, fps: 30, seed: 1, contentType: "STORY" },
        { operation: "test" },
      );
      expect(body.model).toBe(info.model);
      expect(body.duration).toBe(4);
      expect((body.image_urls as string[]).length).toBe(1);
      if (id.includes("evolink")) expect(body.quality).toBe("480p");
      else expect(body.generate_audio).toBe(false);
      expect(await probeDuration(out)).toBeCloseTo(3.2, 1);
    }, 60_000);
  }
});
