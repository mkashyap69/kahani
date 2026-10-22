import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { hashOf } from "../util/crypto.js";
import { AAC_ARGS, ffmpeg, x264Args } from "./ffmpeg.js";
import { buildCardAss } from "./subtitles.js";

/**
 * Generated default intro (channel title card + jingle) and outro (thanks + subscribe card).
 * Channels can upload their own clips instead; those are normalised by the assembler.
 */
export async function defaultCard(kind: "intro" | "outro", channelName: string, width: number, height: number, fps: number, logoPath?: string | null): Promise<string> {
  const dir = path.join(config.workDir, "_cards");
  await fs.mkdir(dir, { recursive: true });
  const vertical = height > width;
  const dur = kind === "intro" ? 3 : vertical ? 2 : 5;
  const id = hashOf({ kind, channelName, width, height, fps, dur, logo: logoPath ? path.basename(logoPath) : null, v: 4 }).slice(0, 12);
  const out = path.join(dir, `${kind}-${id}.mp4`);
  try {
    await fs.access(out);
    return out;
  } catch {
    // build it
  }
  const s = vertical ? 1.3 : 1;
  const lines =
    kind === "intro"
      ? [
          { text: channelName, size: 130 * s, y: height * (logoPath ? 0.62 : 0.45), fade: true },
          { text: "प्रस्तुत करते हैं एक नई कहानी", size: 60 * s, color: "&H00FFFFFF&", y: height * (logoPath ? 0.75 : 0.6), fade: true },
        ]
      : [
          { text: "देखने के लिए धन्यवाद!", size: 96 * s, y: height * 0.38, fade: true },
          { text: "  SUBSCRIBE करें  ", size: 70 * s, y: height * 0.56, box: "red" },
          { text: channelName, size: 54 * s, color: "&H00FFFFFF&", y: height * 0.72 },
        ];
  const tmp = path.join(dir, `${kind}-${id}.${process.pid}-${Date.now().toString(36)}.tmp.mp4`);
  const assName = `${kind}-${id}.${process.pid}-${Date.now().toString(36)}.ass`;
  await fs.writeFile(path.join(dir, assName), buildCardAss(width, height, lines));
  // warm saffron→magenta gradient + a soft two-note jingle
  const jingle =
    kind === "intro"
      ? "0.25*sin(2*PI*523*t)*exp(-3*t)+0.2*sin(2*PI*659*t)*exp(-3*(t-0.25))*gt(t,0.25)+0.2*sin(2*PI*784*t)*exp(-2*(t-0.5))*gt(t,0.5)"
      : "0.2*sin(2*PI*784*t)*exp(-2*t)+0.2*sin(2*PI*659*t)*exp(-2*(t-0.3))*gt(t,0.3)+0.25*sin(2*PI*523*t)*exp(-1.5*(t-0.6))*gt(t,0.6)";
  // round channel logo above the title (intro) / top-left corner (outro)
  const logoSize = Math.round(Math.min(width, height) * (kind === "intro" ? 0.32 : 0.18));
  const logoPos = kind === "intro" ? `x=(W-w)/2:y=H*0.42-h` : `x=W*0.06:y=H*0.08`;
  const logoInput = logoPath ? ["-loop", "1", "-i", logoPath] : [];
  const vf = `ass=${assName}:fontsdir=${config.fontsDir}`;
  const graph = logoPath
    ? `[2:v]scale=${logoSize}:${logoSize},format=rgba,geq=lum='p(X,Y)':a='if(lt(hypot(X-W/2,Y-H/2),W/2),255,0)'[logo];[0:v][logo]overlay=${logoPos}:shortest=1,${vf},fade=t=in:st=0:d=0.3,fade=t=out:st=${dur - 0.4}:d=0.4,format=yuv420p[v]`
    : `[0:v]${vf},fade=t=in:st=0:d=0.3,fade=t=out:st=${dur - 0.4}:d=0.4,format=yuv420p[v]`;
  await ffmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${width}x${height}:c0=0xff8a00:c1=0xd81b60:x0=0:y0=0:x1=${width}:y1=${height}:d=${dur}:r=${fps}:speed=0.002`,
      "-f",
      "lavfi",
      "-i",
      `aevalsrc='${jingle}':s=48000:d=${dur}`,
      ...logoInput,
      "-filter_complex",
      graph,
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-af",
      "aformat=channel_layouts=stereo",
      "-t",
      String(dur),
      ...x264Args({ fps, bitrateK: 0, intermediate: true }),
      ...AAC_ARGS,
      tmp,
    ],
    { cwd: dir },
  );
  // atomic publish: parallel jobs may build the same card
  await fs.rename(tmp, out);
  return out;
}
