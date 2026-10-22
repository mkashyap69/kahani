import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { IMAGE_MODELS, imageModelInfo, modelForShot, DEFAULT_IMAGE_MODEL } from "../src/providers/image-models.js";
import { pickShots } from "../src/pipeline/compare.js";
import { MockImageBatch } from "../src/providers/mock/image.js";

describe("image model selection", () => {
  it("uses the per-shot-type model, then the channel default, then the env default", () => {
    const map = { default: "fal:qwen-image-edit-2511", closeup: "fal:seedream-4.5", thumbnail: "gemini:gemini-3-pro-image-preview" };
    expect(modelForShot(map, "closeup")).toBe("fal:seedream-4.5");
    expect(modelForShot(map, "wide")).toBe("fal:qwen-image-edit-2511");
    expect(modelForShot(map, "thumbnail")).toBe("gemini:gemini-3-pro-image-preview");
    expect(modelForShot({}, "wide")).toBe(DEFAULT_IMAGE_MODEL());
    expect(modelForShot(null, "medium")).toBe(DEFAULT_IMAGE_MODEL());
  });

  it("validates model ids (custom Gemini ids allowed, fal ids must be in the catalog)", () => {
    expect(imageModelInfo("fal:seedream-4.5").falEdit).toContain("seedream");
    expect(imageModelInfo("gemini:some-future-image-model").provider).toBe("gemini");
    expect(() => imageModelInfo("fal:unknown-model")).toThrow();
  });

  it("catalog entries are complete: fal text endpoint (+ edit iff it takes references), BytePlus model ids, batch only on Gemini", () => {
    for (const m of IMAGE_MODELS) {
      if (m.provider === "fal") {
        expect(m.falText).toBeTruthy();
        expect(Boolean(m.falEdit)).toBe(m.maxRefs > 0);
      }
      if (m.provider === "byteplus") expect(m.model).toBeTruthy();
      if (m.provider === "gemini") expect(m.batchUsd).toBeLessThan(m.usd);
      else expect(m.batchUsd).toBeUndefined();
    }
  });
});

describe("comparison shot picking", () => {
  const shots = Array.from({ length: 40 }, (_, i) => ({ idx: i + 1, framing: ["wide", "medium", "closeup", "over_shoulder"][i % 4], charactersInFrame: i % 7 === 0 ? [] : ["priya"] }));
  it("picks up to 10 sorted, unique shots covering every framing", () => {
    const picked = pickShots(shots, 10);
    expect(picked.length).toBe(10);
    expect(new Set(picked).size).toBe(10);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
    const framings = new Set(picked.map((i) => shots[i - 1].framing));
    expect(framings.size).toBe(4);
  });
  it("returns everything when there are fewer shots than requested", () => {
    expect(pickShots(shots.slice(0, 5), 10)).toHaveLength(5);
  });
});

describe("batch provider contract (offline mock)", () => {
  it("submits, then poll returns one result per key", async () => {
    process.env.WORK_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "kahani-batch-"));
    const batch = new MockImageBatch();
    const job = await batch.submit(
      [
        { key: "s1-abc", prompt: "wide shot day", references: [], aspect: "16:9", meta: { characters: ["priya"], location: "chai_stall" } },
        { key: "s2-def", prompt: "close-up night", references: [], aspect: "16:9", meta: { characters: ["dadi"], location: "chai_stall" } },
      ],
      "test",
    );
    const res = await batch.poll(job);
    expect(res.done).toBe(true);
    if (res.done && "results" in res) {
      expect([...res.results.keys()].sort()).toEqual(["s1-abc", "s2-def"]);
      const first = res.results.get("s1-abc")!;
      expect("data" in first && first.data.length > 1000).toBe(true);
    }
  });
});
