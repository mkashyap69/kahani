import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { AAC_ARGS, ffmpeg, probeDuration, probeStreams, toPcmWav, x264Args, youtubeBitrate } from "./ffmpeg.js";
import { encodeWav, mixInto, parseWav } from "./wav.js";
import { buildSubtitlesAss, type Cue } from "./subtitles.js";
import { matchSfx, sfxPath, type SfxEntry } from "./library.js";
import { hashOf } from "../util/crypto.js";

export interface AssemblyShot {
  clipPath: string;
  audioPath: string | null;
  audioSeconds: number | null;
  durationSec: number;
  location: string;
  dialogue: string | null;
  speaker: string | null;
  sfx: string | null;
}

export interface AssemblySpec {
  shots: AssemblyShot[];
  width: number;
  height: number;
  fps: number;
  workDir: string;
  outPath: string;
  musicPath?: string | null;
  sfxLibrary?: SfxEntry[];
  introPath?: string | null;
  outroPath?: string | null;
  subtitles?: boolean;
  /** crossfade on location changes (hard cuts otherwise) */
  crossfadeSec?: number;
  /** shorts: hard cap for the main body (speeds up ≤1.25× then trims) */
  maxMainSec?: number;
  musicVolume?: number;
  sfxVolume?: number;
}

const SR = 48000;

export interface Scene {
  location: string;
  shots: AssemblyShot[];
  start: number;
  duration: number;
}

/** Consecutive shots in the same location form a scene (hard cuts inside, crossfade between). */
export function groupScenes(shots: AssemblyShot[]): Scene[] {
  const scenes: Scene[] = [];
  let t = 0;
  for (const s of shots) {
    const last = scenes[scenes.length - 1];
    if (last && last.location === s.location) {
      last.shots.push(s);
      last.duration += s.durationSec;
    } else scenes.push({ location: s.location, shots: [s], start: t, duration: s.durationSec });
    t += s.durationSec;
  }
  return scenes;
}

/** Lays out dialogue + SFX sample-accurately on the shot timeline. */
async function buildTracks(spec: AssemblySpec, scenes: Scene[], total: number) {
  const n = Math.round(total * SR);
  const dialogue = new Int16Array(n);
  const sfx = new Int16Array(n);
  const cues: Cue[] = [];
  const lib = spec.sfxLibrary ?? [];
  const sfxDir = path.join(spec.workDir, "sfx");
  await fs.mkdir(sfxDir, { recursive: true });

  let t = 0;
  for (const scene of scenes) {
    let sceneT = 0;
    for (const shot of scene.shots) {
      if (shot.audioPath) {
        const pcm = parseWav(await fs.readFile(shot.audioPath));
        if (pcm.sampleRate !== SR || pcm.channels !== 1) throw new Error(`dialogue must be 48k mono: ${shot.audioPath}`);
        mixInto(dialogue, pcm.samples, SR, t, shot.durationSec);
        if (spec.subtitles && shot.dialogue) {
          const end = t + Math.min(shot.durationSec - 0.05, (shot.audioSeconds ?? shot.durationSec) + 0.3);
          cues.push({ start: t + 0.05, end, text: (shot.speaker === "narrator" ? "~" : "") + shot.dialogue });
        }
      }
      const entry = matchSfx(shot.sfx, lib);
      if (entry) {
        const local = path.join(sfxDir, `${hashOf(entry.file).slice(0, 10)}.wav`);
        await fs.access(local).catch(() => toPcmWav(sfxPath(entry), local));
        const pcm = parseWav(await fs.readFile(local));
        // ambience may run to the end of the scene, fading out
        mixInto(sfx, pcm.samples, SR, t, scene.duration - sceneT, spec.sfxVolume ?? 0.45, 0.6);
      }
      t += shot.durationSec;
      sceneT += shot.durationSec;
    }
  }
  const dlgPath = path.join(spec.workDir, "dialogue.wav");
  const sfxTrack = path.join(spec.workDir, "sfx.wav");
  await fs.writeFile(dlgPath, encodeWav({ sampleRate: SR, channels: 1, samples: dialogue }));
  await fs.writeFile(sfxTrack, encodeWav({ sampleRate: SR, channels: 1, samples: sfx }));
  return { dlgPath, sfxTrack, cues };
}

async function concatScene(spec: AssemblySpec, scene: Scene, i: number): Promise<string> {
  const list = path.join(spec.workDir, `scene-${i}.txt`);
  const out = path.join(spec.workDir, `scene-${i}.mp4`);
  await fs.writeFile(list, scene.shots.map((s) => `file '${s.clipPath.replace(/'/g, "'\\''")}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-an", out]);
  return out;
}

const fmtA = "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

/**
 * Stage 5 core: scenes → crossfades → subtitles → intro/outro, mixed with
 * dialogue (top), sidechain-ducked music and SFX, exported as H.264/AAC.
 */
export async function assembleVideo(spec: AssemblySpec): Promise<{ durationSec: number; outPath: string }> {
  await fs.mkdir(spec.workDir, { recursive: true });
  const { width: W, height: H, fps } = spec;
  const xf = spec.crossfadeSec ?? 0.5;
  const scenes = groupScenes(spec.shots);
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  const { dlgPath, sfxTrack, cues } = await buildTracks(spec, scenes, total);
  const sceneFiles: string[] = [];
  for (let i = 0; i < scenes.length; i++) sceneFiles.push(await concatScene(spec, scenes[i], i));

  if (spec.subtitles && cues.length) await fs.writeFile(path.join(spec.workDir, "subs.ass"), buildSubtitlesAss(cues, W, H));

  const args: string[] = [];
  const graph: string[] = [];
  let input = 0;
  const sceneIdx = sceneFiles.map((f) => {
    args.push("-i", f);
    return input++;
  });
  args.push("-i", dlgPath);
  const dlgIdx = input++;
  args.push("-i", sfxTrack);
  const sfxIdx = input++;
  let musicIdx = -1;
  if (spec.musicPath) {
    args.push("-stream_loop", "-1", "-i", spec.musicPath);
    musicIdx = input++;
  }

  // ---- main video: hard cuts within scenes, crossfades between scenes
  const canFade = scenes.length > 1 && xf > 0 && scenes.every((s) => s.duration > xf * 2);
  if (scenes.length === 1) graph.push(`[${sceneIdx[0]}:v]setpts=PTS-STARTPTS[vcat]`);
  else if (!canFade) graph.push(`${sceneIdx.map((i) => `[${i}:v]`).join("")}concat=n=${sceneIdx.length}:v=1:a=0[vcat]`);
  else {
    sceneIdx.forEach((idx, i) => {
      graph.push(i < scenes.length - 1 ? `[${idx}:v]settb=AVTB,tpad=stop_mode=clone:stop_duration=${xf}[p${i}]` : `[${idx}:v]settb=AVTB,setpts=PTS-STARTPTS[p${i}]`);
    });
    let acc = "p0";
    let offset = 0;
    for (let i = 1; i < scenes.length; i++) {
      offset += scenes[i - 1].duration;
      const outLabel = i === scenes.length - 1 ? "vcat" : `x${i}`;
      graph.push(`[${acc}][p${i}]xfade=transition=fade:duration=${xf}:offset=${offset.toFixed(4)}[${outLabel}]`);
      acc = outLabel;
    }
  }
  const subs = spec.subtitles && cues.length ? `,ass=subs.ass:fontsdir=${config.fontsDir}` : "";

  // shorts length guard
  let speed = 1;
  let mainDur = total;
  if (spec.maxMainSec && total > spec.maxMainSec) {
    speed = Math.min(1.25, total / spec.maxMainSec);
    mainDur = Math.min(spec.maxMainSec, total / speed);
  }
  const speedV = speed > 1 ? `,setpts=PTS/${speed.toFixed(4)}` : "";
  const trimV = mainDur < total / speed - 0.01 ? `,trim=duration=${mainDur.toFixed(3)}` : "";
  graph.push(`[vcat]fps=${fps}${subs}${speedV}${trimV},scale=${W}:${H},setsar=1,format=yuv420p[vmain]`);

  // ---- audio mix: dialogue on top, music ducked under dialogue, SFX bed
  graph.push(`[${dlgIdx}:a]${fmtA},asplit=2[dlg][dlgsc]`);
  const mixInputs = ["[dlg]"];
  if (musicIdx >= 0) {
    graph.push(`[${musicIdx}:a]${fmtA},atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${spec.musicVolume ?? 0.25},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(3)}:d=1.5[mus]`);
    graph.push(`[mus][dlgsc]sidechaincompress=threshold=0.015:ratio=12:attack=20:release=400:makeup=1[duck]`);
    mixInputs.push("[duck]");
  } else graph.push(`[dlgsc]anullsink`);
  graph.push(`[${sfxIdx}:a]${fmtA}[sfx]`);
  mixInputs.push("[sfx]");
  const speedA = speed > 1 ? `,atempo=${speed.toFixed(4)}` : "";
  const trimA = trimV ? `,atrim=0:${mainDur.toFixed(3)}` : "";
  graph.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:normalize=0:duration=first${speedA}${trimA},${fmtA}[amain]`);

  // ---- intro / outro (normalised to the output format)
  const parts: { v: string; a: string }[] = [];
  const extra = async (file: string | null | undefined, label: string) => {
    if (!file) return null;
    const streams = await probeStreams(file);
    args.push("-i", file);
    const idx = input++;
    graph.push(`[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},setsar=1,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[${label}v]`);
    if (streams.some((s) => s.codec_type === "audio")) graph.push(`[${idx}:a]${fmtA},asetpts=PTS-STARTPTS[${label}a]`);
    else {
      const d = await probeDuration(file);
      graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${d.toFixed(3)},${fmtA}[${label}a]`);
    }
    return { v: `[${label}v]`, a: `[${label}a]` };
  };
  const intro = await extra(spec.introPath, "intro");
  const outro = await extra(spec.outroPath, "outro");
  if (intro) parts.push(intro);
  parts.push({ v: "[vmain]", a: "[amain]" });
  if (outro) parts.push(outro);
  if (parts.length > 1) {
    graph.push(`${parts.map((p) => p.v + p.a).join("")}concat=n=${parts.length}:v=1:a=1[vout][acat]`);
  } else {
    graph.push(`[vmain]null[vout]`);
    graph.push(`[amain]anull[acat]`);
  }
  graph.push(`[acat]loudnorm=I=-16:TP=-1.5:LRA=11,${fmtA}[aout]`);

  const graphFile = path.join(spec.workDir, "graph.txt");
  await fs.writeFile(graphFile, graph.join(";\n"));
  await ffmpeg(
    [
      ...args,
      "-filter_complex_script",
      graphFile,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      ...x264Args({ fps, bitrateK: youtubeBitrate(W, H) }),
      ...AAC_ARGS,
      spec.outPath,
    ],
    { cwd: spec.workDir },
  );
  return { durationSec: await probeDuration(spec.outPath), outPath: spec.outPath };
}
