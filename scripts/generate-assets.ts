/**
 * Generates royalty-free placeholder background music packs and a tagged SFX library with FFmpeg synthesis.
 * Replace / extend with real licensed assets: drop files into assets/music/<pack>/ and add entries to
 * assets/sfx/library.json ({ "file": "...", "tags": [...] }).
 *
 *   npm run assets            # generate missing files
 *   npm run assets -- --force # regenerate everything
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "assets");
const force = process.argv.includes("--force");

function ff(args: string[]) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
}
async function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

// note index (semitones) chosen per half-beat from a pentatonic-ish raga phrase
const phrase = (notes: number[], beat: number) =>
  notes.map((n, i) => `eq(mod(floor(t/${beat}),${notes.length}),${i})*${n}`).join("+");

const MUSIC: Record<string, { file: string; expr: string; dur: number }[]> = {
  "village-warm": [
    {
      file: "sitar-pad.m4a",
      dur: 64,
      expr: `0.09*sin(2*PI*110*t)+0.05*sin(2*PI*165*t)+0.03*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.1*t))+0.22*exp(-5*mod(t,0.5))*sin(2*PI*220*pow(2,(${phrase([0, 2, 4, 7, 9, 7, 4, 2, 0, 4, 7, 12, 9, 7, 4, 2], 0.5)})/12)*t)`,
    },
    {
      file: "flute-evening.m4a",
      dur: 64,
      expr: `0.08*sin(2*PI*98*t)+0.04*sin(2*PI*147*t)+0.16*(1-exp(-6*mod(t,1)))*exp(-1.2*mod(t,1))*sin(2*PI*392*pow(2,(${phrase([0, 2, 4, 2, 7, 4, 2, 0], 1)})/12)*t+0.6*sin(2*PI*5*t))`,
    },
  ],
  playful: [
    {
      file: "bouncy.m4a",
      dur: 48,
      expr: `0.1*sin(2*PI*130.8*t)*exp(-6*mod(t,0.5))+0.2*exp(-8*mod(t,0.25))*sin(2*PI*523*pow(2,(${phrase([0, 4, 7, 4, 9, 7, 4, 0], 0.25)})/12)*t)`,
    },
  ],
  suspense: [
    {
      file: "night-drone.m4a",
      dur: 60,
      expr: `0.12*sin(2*PI*55*t)*(0.7+0.3*sin(2*PI*0.2*t))+0.06*sin(2*PI*82.4*t+2*sin(2*PI*0.3*t))+0.1*exp(-3*mod(t,4))*sin(2*PI*440*t)`,
    },
  ],
};

type Sfx = { file: string; tags: string[]; src: string[] };
const SFX: Sfx[] = [
  { file: "birds.wav", tags: ["birds chirping", "morning", "birdsong", "village ambience"], src: ["-f", "lavfi", "-i", "aevalsrc='0.3*sin(2*PI*(3200+900*sin(2*PI*9*t))*t)*gt(sin(2*PI*1.7*t),0.6)+0.2*sin(2*PI*(4100+600*sin(2*PI*13*t))*t)*gt(sin(2*PI*1.1*t+1),0.75)':s=48000:d=6"] },
  { file: "crowd.wav", tags: ["crowd murmur", "people talking", "market", "gathering", "chaupal"], src: ["-f", "lavfi", "-i", "anoisesrc=c=brown:a=0.5:d=6", "-af", "bandpass=f=500:w=400,tremolo=f=3:d=0.4"] },
  { file: "door-knock.wav", tags: ["door knock", "knocking", "knock"], src: ["-f", "lavfi", "-i", "aevalsrc='0.9*exp(-40*mod(t,0.25))*sin(2*PI*160*t)*lt(t,0.75)':s=48000:d=1.2", "-af", "lowpass=f=900"] },
  { file: "cooker-whistle.wav", tags: ["pressure cooker whistle", "whistle", "kitchen"], src: ["-f", "lavfi", "-i", "aevalsrc='0.35*sin(2*PI*(2100+80*sin(2*PI*6*t))*t)*(1-exp(-4*t))*exp(-0.4*t)':s=48000:d=3"] },
  { file: "cow-moo.wav", tags: ["cow moo", "cow", "buffalo", "animal"], src: ["-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*(150-30*t)*t)*sin(PI*t/1.6)+0.2*sin(4*PI*(150-30*t)*t)*sin(PI*t/1.6)':s=48000:d=1.6", "-af", "lowpass=f=1200"] },
  { file: "wind.wav", tags: ["wind", "breeze", "fields", "storm"], src: ["-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.35:d=8", "-af", "lowpass=f=700,tremolo=f=0.3:d=0.6"] },
  { file: "temple-bell.wav", tags: ["temple bell", "bell", "ring", "aarti"], src: ["-f", "lavfi", "-i", "aevalsrc='0.5*exp(-1.5*t)*(sin(2*PI*880*t)+0.5*sin(2*PI*1320*t)+0.3*sin(2*PI*2210*t))':s=48000:d=4"] },
  { file: "boing.wav", tags: ["comedic boing", "boing", "funny", "cartoon", "bounce"], src: ["-f", "lavfi", "-i", "aevalsrc='0.6*sin(2*PI*(200+300*exp(-6*t))*t*(1+0.1*sin(2*PI*12*t)))*exp(-3*t)':s=48000:d=1"] },
  { file: "crickets.wav", tags: ["crickets", "night", "insects", "night ambience"], src: ["-f", "lavfi", "-i", "aevalsrc='0.2*sin(2*PI*4600*t)*gt(sin(2*PI*28*t),0)*gt(sin(2*PI*1.3*t),0.2)':s=48000:d=8"] },
  { file: "footsteps.wav", tags: ["footsteps", "walking", "running", "steps"], src: ["-f", "lavfi", "-i", "anoisesrc=c=brown:a=0.9:d=3", "-af", "lowpass=f=500,volume='if(lt(mod(t,0.45),0.06),1,0)':eval=frame"] },
  { file: "rain.wav", tags: ["rain", "monsoon", "drizzle", "storm"], src: ["-f", "lavfi", "-i", "anoisesrc=c=white:a=0.25:d=8", "-af", "highpass=f=1500,lowpass=f=7000"] },
  { file: "phone-ping.wav", tags: ["phone notification", "phone ring", "message", "ping", "mobile"], src: ["-f", "lavfi", "-i", "aevalsrc='0.5*exp(-8*t)*sin(2*PI*1320*t)+0.5*exp(-8*(t-0.15))*gt(t,0.15)*sin(2*PI*1760*t)':s=48000:d=0.8"] },
  { file: "sting.wav", tags: ["dramatic sting", "suspense", "shock", "reveal", "dramatic"], src: ["-f", "lavfi", "-i", "aevalsrc='0.7*exp(-1.2*t)*(sin(2*PI*55*t)+0.5*sin(2*PI*58*t)+0.3*sin(2*PI*110*t))':s=48000:d=2.5"] },
  { file: "kettle-pour.wav", tags: ["chai", "tea pouring", "kettle", "pouring", "steam"], src: ["-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.3:d=3", "-af", "bandpass=f=2500:w=1500,tremolo=f=9:d=0.5"] },
];

async function main() {
  for (const [pack, tracks] of Object.entries(MUSIC)) {
    const dir = path.join(assets, "music", pack);
    await fs.mkdir(dir, { recursive: true });
    for (const t of tracks) {
      const out = path.join(dir, t.file);
      if (!force && (await exists(out))) continue;
      ff(["-f", "lavfi", "-i", `aevalsrc='${t.expr}':s=48000:d=${t.dur}`, "-af", "aecho=0.8:0.7:60:0.25,lowpass=f=6000,afade=t=in:d=1,afade=t=out:st=" + (t.dur - 2) + ":d=2,aformat=channel_layouts=stereo,loudnorm=I=-20", "-c:a", "aac", "-b:a", "128k", out]);
      console.log("music", pack, t.file);
    }
  }
  const sfxDir = path.join(assets, "sfx");
  await fs.mkdir(sfxDir, { recursive: true });
  for (const s of SFX) {
    const out = path.join(sfxDir, s.file);
    if (!force && (await exists(out))) continue;
    const afIdx = s.src.indexOf("-af");
    const af = afIdx >= 0 ? s.src[afIdx + 1] + "," : "";
    const src = afIdx >= 0 ? s.src.slice(0, afIdx) : s.src;
    ff([...src, "-af", `${af}loudnorm=I=-18,aresample=48000`, "-ac", "1", "-c:a", "pcm_s16le", out]);
    console.log("sfx", s.file);
  }
  await fs.writeFile(path.join(sfxDir, "library.json"), JSON.stringify(SFX.map(({ file, tags }) => ({ file, tags })), null, 2) + "\n");
  console.log("assets ready in", assets);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
