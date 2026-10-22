import { describe, expect, it } from "vitest";
import { KitSchema, ResearchSchema, parseJsonWith } from "../src/domain/kit.js";
import { castVoices, SARVAM_V3_VOICES, SARVAM_VOICES, voiceCatalog } from "../src/providers/sarvam.js";
import { mockKit, mockResearch } from "../src/providers/mock/kit.js";
import { buildKitPrompt, buildResearchPrompt } from "../src/prompts/launch.js";
import { normalizeKit } from "../src/pipeline/launch.js";
import { moodOf } from "../src/providers/music.js";

const brief = { idea: "Panchatantra animal fables for kids", language: "hi-IN", audience: "", kidSafe: true, notes: "" };

describe("launch kit schema", () => {
  const prompt = buildKitPrompt(brief, null, SARVAM_VOICES, true);
  const raw = mockKit(`${prompt.user}\nKIDS channel`);

  it("accepts a complete kit and slugifies keys", () => {
    const r = parseJsonWith(KitSchema, { ...raw, characters: raw.characters.map((c, i) => (i === 0 ? { ...c, key: "Chiku Chidiya" } : c)) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.characters[0].key).toBe("chiku_chidiya");
  });

  it("parses kits wrapped in prose / code fences", () => {
    expect(parseJsonWith(KitSchema, "Here is the kit:\n```json\n" + JSON.stringify(raw) + "\n```").ok).toBe(true);
  });

  it("rejects thin visual descriptions, duplicate keys and the reserved narrator key", () => {
    const bad = {
      ...raw,
      characters: [{ ...raw.characters[0], visualDescription: "a bird" }, raw.characters[1], { ...raw.characters[2], key: raw.characters[1].key }, { ...raw.characters[3], key: "narrator" }],
    };
    const r = parseJsonWith(KitSchema, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join("\n");
      expect(all).toMatch(/visualDescription/);
      expect(all).toMatch(/duplicate character key/);
      expect(all).toMatch(/reserved/);
    }
  });

  it("requires at least 3 name options, characters and locations", () => {
    expect(parseJsonWith(KitSchema, { ...raw, locations: raw.locations.slice(0, 2) }).ok).toBe(false);
    expect(parseJsonWith(KitSchema, { ...raw, channel: { ...raw.channel, nameOptions: raw.channel.nameOptions.slice(0, 2) } }).ok).toBe(false);
  });

  it("normalisation forces kid-safety from the brief", () => {
    const r = parseJsonWith(KitSchema, { ...raw, theme: { ...raw.theme, kidSafe: false }, channel: { ...raw.channel, madeForKids: false } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const k = normalizeKit(r.value, brief);
      expect(k.theme.kidSafe).toBe(true);
      expect(k.channel.madeForKids).toBe(true);
    }
  });

  it("research brief schema tolerates missing optional lists", () => {
    expect(parseJsonWith(ResearchSchema, { summary: "A niche summary that is long enough." }).ok).toBe(true);
    expect(ResearchSchema.safeParse(mockResearch(buildResearchPrompt(brief).user)).success).toBe(true);
  });
});

describe("voice casting", () => {
  const v = (speaker: string) => ({ speaker, pitch: 0, pace: 1, loudness: 1 });

  it("replaces unknown or wrong-gender voices and keeps main voices distinct", () => {
    const cast = castVoices(
      [
        { gender: "female", age: 30, voice: v("anushka") },
        { gender: "female", age: 28, voice: v("anushka") },
        { gender: "male", age: 40, voice: v("nonexistent") },
        { gender: "male", age: 35, voice: v("vidya") },
      ],
      SARVAM_VOICES,
    );
    const ids = cast.map((c) => c.voice.speaker);
    expect(new Set(ids).size).toBe(4);
    const gender = (id: string) => SARVAM_VOICES.find((x) => x.id === id)!.gender;
    expect(cast.map((c) => gender(c.voice.speaker))).toEqual(["female", "female", "male", "male"]);
  });

  it("does not give a child a deep elderly voice or an old man a child voice", () => {
    const [child, elder] = castVoices(
      [
        { gender: "male", age: 10, voice: v("abhilash") },
        { gender: "male", age: 70, voice: v("hitesh") },
      ],
      SARVAM_VOICES,
    );
    expect(child.voice.speaker).not.toBe("abhilash");
    expect(elder.voice.speaker).not.toBe("hitesh");
  });

  it("clamps voice parameters", () => {
    const [c] = castVoices([{ gender: "female", age: 20, voice: { speaker: "arya", pitch: 3, pace: 9, loudness: 0.1 } }], SARVAM_VOICES);
    expect(c.voice.pitch).toBe(0.75);
    expect(c.voice.pace).toBe(2);
    expect(c.voice.loudness).toBe(0.3);
  });

  it("uses the v3 catalog when bulbul:v3 is configured", () => {
    expect(voiceCatalog("bulbul:v3")).toBe(SARVAM_V3_VOICES);
    expect(SARVAM_V3_VOICES.length).toBeGreaterThan(30);
    expect(voiceCatalog("bulbul:v2")).toBe(SARVAM_VOICES);
  });
});

describe("music", () => {
  it("maps prompts to moods", () => {
    expect(moodOf("spooky night drone")).toBe("suspense");
    expect(moodOf("bouncy cartoon chase")).toBe("playful");
    expect(moodOf("santoor morning")).toBe("warm");
  });
});
