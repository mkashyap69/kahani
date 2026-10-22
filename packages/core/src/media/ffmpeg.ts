import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export function run(bin: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new FfmpegError(`${bin} exited with ${code}: ${stderr.trim().split("\n").slice(-6).join(" | ")}`, stderr));
    });
  });
}

export const ffmpeg = (args: string[], opts?: { cwd?: string; timeoutMs?: number }) =>
  run(process.env.FFMPEG_PATH ?? "ffmpeg", ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", ...args], opts);

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(process.env.FFPROBE_PATH ?? "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`could not probe duration of ${file}`);
  return d;
}

export async function probeStreams(file: string): Promise<{ codec_type: string; codec_name: string; width?: number; height?: number }[]> {
  const { stdout } = await run(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-show_streams", "-of", "json", file]);
  return JSON.parse(stdout).streams ?? [];
}

/** Two-pass EBU R128 loudness normalisation → 48 kHz mono s16 WAV. */
export async function normalizeLoudness(input: string, output: string, lufs = -16): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const target = `I=${lufs}:TP=-1.5:LRA=11`;
  let measured: Record<string, string> | null = null;
  try {
    const { stderr } = await run(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-i",
      input,
      "-af",
      `loudnorm=${target}:print_format=json`,
      "-f",
      "null",
      "-",
    ]);
    const json = stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1);
    measured = JSON.parse(json);
  } catch {
    measured = null;
  }
  const valid = measured && Number.isFinite(parseFloat(measured.input_i)) && parseFloat(measured.input_i) > -70;
  const filter = valid
    ? `loudnorm=${target}:measured_I=${measured!.input_i}:measured_TP=${measured!.input_tp}:measured_LRA=${measured!.input_lra}:measured_thresh=${measured!.input_thresh}:offset=${measured!.target_offset}:linear=true`
    : `loudnorm=${target}`;
  await ffmpeg(["-i", input, "-af", `${filter},aresample=48000`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-bitexact", output]);
}

/** Convert any audio file to 48 kHz mono s16 WAV (no loudness change). */
export async function toPcmWav(input: string, output: string): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await ffmpeg(["-i", input, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-bitexact", output]);
}

/** Shared H.264 settings (YouTube recommended: High profile, yuv420p, closed GOP of half the frame rate). */
export function x264Args(opts: { fps: number; bitrateK: number; crf?: number; preset?: string; intermediate?: boolean }): string[] {
  const preset = opts.preset ?? process.env.FFMPEG_PRESET ?? "veryfast";
  if (opts.intermediate) {
    return ["-c:v", "libx264", "-preset", preset, "-crf", String(opts.crf ?? 16), "-pix_fmt", "yuv420p", "-r", String(opts.fps), "-g", String(opts.fps)];
  }
  return [
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    `${opts.bitrateK}k`,
    "-maxrate",
    `${Math.round(opts.bitrateK * 1.5)}k`,
    "-bufsize",
    `${opts.bitrateK * 2}k`,
    "-r",
    String(opts.fps),
    "-g",
    String(Math.round(opts.fps / 2)),
    "-bf",
    "2",
    "-movflags",
    "+faststart",
  ];
}

export const AAC_ARGS = ["-c:a", "aac", "-b:a", "384k", "-ar", "48000", "-ac", "2"];

/** YouTube recommended SDR upload bitrates (kbps) for 30 fps. */
export function youtubeBitrate(width: number, height: number): number {
  const p = Math.min(width, height);
  return p >= 2160 ? 40000 : p >= 1440 ? 16000 : p >= 1080 ? 8000 : p >= 720 ? 5000 : 2500;
}
