import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { assembleVideo, groupScenes, type AssemblyShot } from "../src/media/assemble.js";
import { normalizeLoudness, probeDuration, probeStreams } from "../src/media/ffmpeg.js";
import { parseWav, wavDuration } from "../src/media/wav.js";
import { renderMockFrame } from "../src/providers/mock/image.js";
import { synthBabble } from "../src/providers/mock/tts.js";
import { KenBurnsProvider } from "../src/providers/motion.js";
import { shotDuration } from "../src/domain/duration.js";
import { sfxLibrary, matchSfx, pickMusic } from "../src/media/library.js";
import { defaultCard } from "../src/media/cards.js";

const W = 640;
const H = 360;
const FPS = 30;
let dir: string;
let shots: AssemblyShot[];

/** 3-shot fixture: two locations (→ one crossfade), two dialogue lines, one silent establishing shot. */
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kahani-asm-"));
  process.env.WORK_DIR = path.join(dir, "work");
  const spec = [
    { location: "chai_stall", framing: "wide", text: null, speaker: null, sfx: "birds chirping" },
    { location: "chai_stall", framing: "closeup", text: "अरे बाप रे! ये क्या हो गया?", speaker: "dadi", sfx: null },
    { location: "haveli_courtyard", framing: "medium", text: "दादी, आप फिर से मेरी चाय पी गईं?", speaker: "priya", sfx: "door knock" },
  ];
  const kb = new KenBurnsProvider();
  shots = [];
  for (const [i, s] of spec.entries()) {
    const img = path.join(dir, `img${i}.png`);
    await fs.writeFile(img, await renderMockFrame({ prompt: s.framing, references: [], aspect: "16:9", meta: { characters: ["priya"], location: s.location } }));
    let audioPath: string | null = null;
    let audioSeconds: number | null = null;
    if (s.text) {
      const raw = path.join(dir, `a${i}.raw.wav`);
      audioPath = path.join(dir, `a${i}.wav`);
      await fs.writeFile(raw, synthBabble({ text: s.text, speaker: s.speaker!, pitch: 0, pace: 1, loudness: 1, language: "hi-IN" }));
      await normalizeLoudness(raw, audioPath, -16);
      audioSeconds = wavDuration(parseWav(await fs.readFile(audioPath)));
    }
    const durationSec = shotDuration(audioSeconds, 2.5);
    const clipPath = path.join(dir, `clip${i}.mp4`);
    await kb.animate({ imagePath: img, outPath: clipPath, durationSec, framing: s.framing, speaking: !!s.text, width: W, height: H, fps: FPS, seed: i });
    shots.push({ clipPath, audioPath, audioSeconds, durationSec, location: s.location, dialogue: s.text, speaker: s.speaker, sfx: s.sfx });
  }
}, 120_000);

describe("FFmpeg assembly (3-shot fixture)", () => {
  it("renders Ken Burns clips with exact frame counts", async () => {
    for (const s of shots) expect(await probeDuration(s.clipPath)).toBeCloseTo(s.durationSec, 1);
  });

  it("groups consecutive same-location shots into scenes", () => {
    const scenes = groupScenes(shots);
    expect(scenes.map((s) => s.shots.length)).toEqual([2, 1]);
    expect(scenes[1].start).toBeCloseTo(shots[0].durationSec + shots[1].durationSec, 5);
  });

  it("normalises dialogue to 48 kHz mono", async () => {
    const pcm = parseWav(await fs.readFile(shots[1].audioPath!));
    expect(pcm.sampleRate).toBe(48000);
    expect(pcm.channels).toBe(1);
  });

  it("assembles a playable H.264/AAC MP4 with crossfade, music ducking, SFX, subtitles, intro and outro", async () => {
    const lib = await sfxLibrary();
    expect(matchSfx("birds chirping in the morning", lib)?.file).toBe("birds.wav");
    const intro = await defaultCard("intro", "Test Channel", W, H, FPS);
    const outro = await defaultCard("outro", "Test Channel", W, H, FPS);
    const out = path.join(dir, "final.mp4");
    const res = await assembleVideo({
      shots,
      width: W,
      height: H,
      fps: FPS,
      workDir: path.join(dir, "asm"),
      outPath: out,
      musicPath: await pickMusic("village-warm", "fixture"),
      sfxLibrary: lib,
      introPath: intro,
      outroPath: outro,
      subtitles: true,
      crossfadeSec: 0.5,
    });
    const body = shots.reduce((a, s) => a + s.durationSec, 0);
    const expected = body + (await probeDuration(intro)) + (await probeDuration(outro));
    expect(res.durationSec).toBeGreaterThan(expected - 0.25);
    expect(res.durationSec).toBeLessThan(expected + 0.25);
    const streams = await probeStreams(out);
    const v = streams.find((s) => s.codec_type === "video")!;
    const a = streams.find((s) => s.codec_type === "audio")!;
    expect(v.codec_name).toBe("h264");
    expect([v.width, v.height]).toEqual([W, H]);
    expect(a.codec_name).toBe("aac");
    const ass = await fs.readFile(path.join(dir, "asm", "subs.ass"), "utf8");
    expect(ass).toContain("दादी, आप फिर से मेरी चाय पी गईं?");
  }, 120_000);

  it("caps a vertical short's body length (speeds up ≤1.25×)", async () => {
    const out = path.join(dir, "capped.mp4");
    const body = shots.reduce((a, s) => a + s.durationSec, 0);
    const cap = body / 1.1;
    const res = await assembleVideo({ shots, width: W, height: H, fps: FPS, workDir: path.join(dir, "asm2"), outPath: out, maxMainSec: cap, crossfadeSec: 0 });
    expect(res.durationSec).toBeLessThan(cap + 0.2);
  }, 120_000);
});
