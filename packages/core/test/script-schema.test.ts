import { describe, expect, it } from "vitest";
import { validateScript, extractJson } from "../src/domain/script.js";

const shot = (over: Record<string, unknown> = {}) => ({
  id: 1,
  location: "haveli_courtyard",
  time_of_day: "day",
  framing: "medium",
  characters_in_frame: ["priya", "dadi"],
  speaker: "priya",
  dialogue_hi: "दादी, आप फिर से मेरी चाय पी गईं?",
  emotion: "irritated",
  action: "Priya holds up an empty cup",
  image_prompt_en: "Priya in pink kurta holding an empty steel cup, Dadi grinning",
  sfx: "birds chirping",
  est_seconds: 4,
  ...over,
});

const script = (shots: unknown[] = [shot(), shot({ id: 2 }), shot({ id: 3, speaker: null, dialogue_hi: "" })]) => ({
  title_hi: "चाय की चोरी",
  title_en: "The Tea Thief",
  logline: "Someone keeps drinking Priya's tea.",
  moral: "बाँटने से प्यार बढ़ता है।",
  shots,
  memory_update: "Dadi was caught drinking Priya's tea. Open threads: who taught Dadi to use the phone?",
  youtube: { title: "चाय की चोरी | The Tea Thief", description: "desc", tags: ["hindi"], thumbnail_prompt: "Dadi caught with cup" },
});

const ctx = { characterKeys: ["priya", "dadi", "ramesh"], locationKeys: ["haveli_courtyard", "chai_stall"], minShots: 3, maxShots: 10 };

describe("script JSON schema", () => {
  it("accepts a valid script", () => {
    const r = validateScript(script(), ctx);
    expect(r.ok).toBe(true);
  });

  it("parses JSON wrapped in prose and code fences", () => {
    const text = "Here you go:\n```json\n" + JSON.stringify(script()) + "\n```\nEnjoy!";
    expect(extractJson(text)).not.toBeNull();
    expect(validateScript(text, ctx).ok).toBe(true);
  });

  it("normalises keys and framing casing, renumbers ids", () => {
    const r = validateScript(script([shot({ id: 7, location: "Haveli Courtyard", framing: "Over-Shoulder" }), shot({ id: 9 }), shot({ id: 11 })]), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.shots[0].location).toBe("haveli_courtyard");
      expect(r.script.shots[0].framing).toBe("over_shoulder");
      expect(r.script.shots.map((s) => s.id)).toEqual([1, 2, 3]);
    }
  });

  it("rejects malformed JSON", () => {
    const r = validateScript('{"title_hi": "x", ', ctx);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown framing, missing fields and non-Devanagari dialogue", () => {
    const bad = script([shot({ framing: "drone" }), shot({ dialogue_hi: "Hello there" }), shot({ action: undefined })]);
    const r = validateScript(bad, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/framing/);
      expect(r.errors.join("\n")).toMatch(/Devanagari/);
      expect(r.errors.join("\n")).toMatch(/action/);
    }
  });

  it("rejects speaker without a line and over-long lines", () => {
    const long = Array.from({ length: 30 }, () => "बहुत").join(" ");
    const r = validateScript(script([shot({ dialogue_hi: "" }), shot({ dialogue_hi: long }), shot()]), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("too long"))).toBe(true);
  });

  it("rejects characters/locations that are not in the theme", () => {
    const r = validateScript(script([shot({ location: "moon_base" }), shot({ characters_in_frame: ["villain"] }), shot({ speaker: "ghost" })]), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/unknown location "moon_base"/);
      expect(r.errors.join("\n")).toMatch(/unknown character "villain"/);
      expect(r.errors.join("\n")).toMatch(/unknown speaker "ghost"/);
    }
  });

  it("allows narrator as speaker", () => {
    expect(validateScript(script([shot({ speaker: "narrator", characters_in_frame: [] }), shot(), shot()]), ctx).ok).toBe(true);
  });

  it("enforces shot count bounds", () => {
    const r = validateScript(script(), { ...ctx, minShots: 5 });
    expect(r.ok).toBe(false);
  });
});
