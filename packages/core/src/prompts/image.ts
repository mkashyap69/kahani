import type { CharacterRow, LocationRow, ThemeBundle } from "../domain/types.js";

const FRAMING_TEXT: Record<string, string> = {
  wide: "wide establishing shot, full bodies visible, environment prominent",
  medium: "medium shot from the waist up",
  closeup: "close-up on the face, expressive eyes, shallow background",
  over_shoulder: "over-the-shoulder shot, foreground character's shoulder blurred",
};
const TIME_TEXT: Record<string, string> = {
  dawn: "soft pink dawn light",
  day: "bright warm daylight",
  evening: "golden-hour evening light, long shadows",
  night: "night scene, moonlight and warm lantern glow",
};

export interface ShotImageInput {
  framing: string;
  timeOfDay: string;
  action: string;
  emotion: string;
  imagePromptEn: string;
  location: LocationRow | undefined;
  characters: CharacterRow[];
}

/** art_style_prompt + framing + location + characters + action + emotion + time_of_day */
export function composeShotPrompt(theme: ThemeBundle, s: ShotImageInput, aspect: "16:9" | "9:16"): string {
  const parts = [
    theme.artStylePrompt,
    FRAMING_TEXT[s.framing] ?? s.framing,
    s.location ? `Setting: ${s.location.name} — ${s.location.description}` : "",
    s.characters.length
      ? `Characters (must match their reference sheets exactly — same face, hair, outfit and colours):\n${s.characters
          .map((c) => `• ${c.name}: ${c.visualDescription}`)
          .join("\n")}`
      : "No characters in frame.",
    `Action: ${s.action}`,
    `Emotion: ${s.emotion}`,
    `Frame details: ${s.imagePromptEn}`,
    TIME_TEXT[s.timeOfDay] ?? s.timeOfDay,
    aspect === "9:16" ? "Vertical 9:16 composition, subject centred in the middle third." : "Horizontal 16:9 cinematic composition.",
    "No text, letters, captions, speech bubbles, watermarks or logos in the image.",
    theme.negativeStyle ? `Avoid: ${theme.negativeStyle}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

export function characterSheetPrompt(theme: ThemeBundle, c: CharacterRow): string {
  return [
    theme.artStylePrompt,
    `Character model sheet / turnaround for an animated series, plain light background.`,
    `Character: ${c.name}, ${c.role}${c.age ? `, ${c.age} years old` : ""}. ${c.visualDescription}`,
    `Layout: front view, three-quarter view and full-body view side by side in the top row; three facial expressions (happy, angry, surprised) in the bottom row.`,
    `Same outfit, colours and proportions in every view. Clean lines, no text labels.`,
    theme.negativeStyle ? `Avoid: ${theme.negativeStyle}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function locationPrompt(theme: ThemeBundle, l: LocationRow): string {
  return [theme.artStylePrompt, `Background plate with no characters: ${l.name}. ${l.description}`, "Horizontal 16:9, no text.", theme.negativeStyle ? `Avoid: ${theme.negativeStyle}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function thumbnailPrompt(theme: ThemeBundle, main: CharacterRow | undefined, base: string, aspect: "16:9" | "9:16"): string {
  return [
    theme.artStylePrompt,
    `YouTube thumbnail: ${base}`,
    main ? `Main character: ${main.name} — ${main.visualDescription}` : "",
    "Bold, big close-up face with an exaggerated emotional expression, high contrast, saturated colours, simple background, leave empty space at the top/bottom for a title.",
    aspect === "9:16" ? "Vertical composition." : "Horizontal 16:9 composition.",
    "Absolutely no text or letters in the image.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const STYLE_TEST_SUBJECTS = [
  "a lively village chai stall in the morning with steam rising from kettles",
  "an old grandmother laughing on a charpai in a courtyard with a tulsi plant",
  "a young boy with a camera running through mustard fields",
  "a banyan tree at night with fireflies and a lantern",
];
