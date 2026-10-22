import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ffmpeg } from "./ffmpeg.js";

export const SUB_FONT = "Baloo 2";

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
export const assEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** Hindi subtitles; vertical videos keep text inside the Shorts safe area (clear of the bottom UI and right-hand buttons). */
export function buildSubtitlesAss(cues: Cue[], width: number, height: number): string {
  const vertical = height > width;
  const size = vertical ? 74 : 62;
  const marginV = vertical ? Math.round(height * 0.26) : 64;
  const marginL = vertical ? 80 : 160;
  const marginR = vertical ? 170 : 160;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${SUB_FONT},${size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,1,0,0,0,100,100,0,0,1,5,2,2,${marginL},${marginR},${marginV},1`,
    `Style: Narrator,${SUB_FONT},${size},&H0080F0FF,&H00FFFFFF,&H00101010,&H80000000,1,1,0,0,100,100,0,0,1,5,2,2,${marginL},${marginR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},${c.text.startsWith("~") ? "Narrator" : "Default"},,0,0,0,,${assEscape(c.text.replace(/^~/, ""))}`),
    "",
  ].join("\n");
}

/** A full-frame title card (used for generated intro/outro and thumbnails). */
export function buildCardAss(width: number, height: number, lines: { text: string; size: number; color?: string; y: number; box?: string; fade?: boolean }[]): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Card,${SUB_FONT},80,&H0000E6FF,&H00FFFFFF,&H00000000,&H90000000,1,0,0,0,100,100,0,0,1,9,4,5,40,40,40,1`,
    `Style: Box,${SUB_FONT},60,&H00FFFFFF,&H00FFFFFF,&H002020E0,&H002020E0,1,0,0,0,100,100,0,0,3,18,0,5,40,40,40,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lines.map(
      (l) =>
        `Dialogue: 0,0:00:00.00,9:00:00.00,${l.box ? "Box" : "Card"},,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${Math.round(l.y)})\\fs${l.size}${l.color ? `\\1c${l.color}` : ""}${l.fade ? "\\fad(300,300)" : ""}}${assEscape(l.text)}`,
    ),
    "",
  ].join("\n");
}

/** Split a Hindi title into at most two short punchy lines for thumbnails. */
export function thumbnailLines(title: string, maxWords = 6): string[] {
  const words = title.replace(/[|#].*$/, "").replace(/^एपिसोड\s*\d+\s*[:：-]\s*/, "").trim().split(/\s+/).filter(Boolean).slice(0, maxWords);
  if (words.length <= 3) return [words.join(" ")];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/** Bold close-up + big Hindi text overlay (added in code, never by the image model). */
export async function renderThumbnail(rawImage: string, title: string, outJpg: string, width: number, height: number): Promise<void> {
  const dir = path.dirname(outJpg);
  const lines = thumbnailLines(title);
  const vertical = height > width;
  const size = vertical ? 150 : 118;
  const ass = buildCardAss(
    width,
    height,
    lines.map((text, i) => ({
      text,
      size,
      color: i === 0 ? "&H0000E6FF&" : "&H00FFFFFF&",
      y: vertical ? height * 0.14 + i * size * 1.15 : height * 0.17 + i * size * 1.1,
    })),
  );
  const assName = `thumb-${path.basename(outJpg, ".jpg")}.ass`;
  await fs.writeFile(path.join(dir, assName), ass);
  await ffmpeg(
    [
      "-i",
      rawImage,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=saturation=1.25:contrast=1.08,ass=${assName}:fontsdir=${config.fontsDir}`,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      outJpg,
    ],
    { cwd: dir },
  );
}
