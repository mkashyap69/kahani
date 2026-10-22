import type { ContentType } from "@prisma/client";
import type { ThemeBundle } from "../domain/types.js";
import type { Script } from "../domain/script.js";

export interface ScriptPromptInput {
  theme: ThemeBundle;
  type: ContentType;
  episodeNumber: number;
  targetSeconds: [number, number];
  shotRange: [number, number];
  directives: string[];
  /** TEASER shorts: today's story to cut a teaser from */
  teaserOf?: Script | null;
  /** 1 or 2 for shorts — used to make the two shorts different */
  slot?: number;
  recentTitles: string[];
}

const SCHEMA_EXAMPLE = `{
  "title_hi": "Devanagari title",
  "title_en": "English title",
  "logline": "one sentence",
  "moral": "one sentence moral in Hindi (Devanagari)",
  "shots": [{
    "id": 1,
    "location": "<location key>",
    "time_of_day": "dawn|day|evening|night",
    "framing": "wide|medium|closeup|over_shoulder",
    "characters_in_frame": ["<character key>"],
    "speaker": "<character key>" | "narrator" | null,
    "dialogue_hi": "Devanagari line, max ~20 words (empty string when speaker is null)",
    "emotion": "surprised",
    "action": "what the characters physically do",
    "image_prompt_en": "detailed visual description of this frame in English",
    "sfx": "birds chirping" | null,
    "est_seconds": 4
  }],
  "memory_update": "what happened in this episode + new open threads (English, 3-8 sentences)",
  "youtube": { "title": "max 100 chars, Hindi + English hook", "description": "", "tags": [""], "thumbnail_prompt": "bold close-up of the main character with a strong emotion, no text" }
}`;

export function buildScriptPrompt(input: ScriptPromptInput): { system: string; user: string } {
  const { theme, type } = input;
  const sl = theme.storyline;
  const isStory = type === "STORY";

  const system = [
    `You are the head writer of a Hindi animated YouTube series. Genre: ${theme.genre}. Tone: ${theme.tone || "warm, funny, emotional"}. Audience: ${theme.targetAudience}.`,
    `You write natural, spoken, everyday Hindi (Hindustani) the way people really talk in a North Indian village or small town — never textbook or shuddh Hindi. Dialogue is written in Devanagari. Common English words people actually use (phone, video, sorry) are fine.`,
    `Every shot is one illustrated frame of a 2D cartoon, so describe frames visually and keep each line short (max ~20 words). Keep every character in-voice, using their speech style.`,
    theme.contentRules ? `CONTENT RULES (mandatory): ${theme.contentRules}` : "",
    theme.kidSafe
      ? "STRICT KID-SAFE PROFILE: no violence, no scary imagery beyond mild suspense, no insults, no romance, no unsafe behaviour that children could imitate, gentle language only."
      : "",
    sl?.forbiddenTopics ? `Never touch these topics: ${sl.forbiddenTopics}.` : "",
    "Never contradict the story memory. Never repeat a plot that already happened.",
    "Output ONLY a single JSON object matching the schema. No prose, no markdown fences.",
  ]
    .filter(Boolean)
    .join("\n");

  const characters = theme.characters
    .map(
      (c) =>
        `- key "${c.key}": ${c.name}, ${c.role}${c.age ? `, age ${c.age}` : ""}. Personality: ${c.personality}. Speech style: ${c.speechStyle}. Looks: ${c.visualDescription}`,
    )
    .join("\n");
  const locations = theme.locations.map((l) => `- key "${l.key}": ${l.name} — ${l.description}`).join("\n");

  const [minSec, maxSec] = input.targetSeconds;
  const [minShots, maxShots] = input.shotRange;

  let task: string;
  if (isStory) {
    task = [
      `Write EPISODE ${input.episodeNumber}: a complete story episode of ${Math.round(minSec / 60)}–${Math.round(maxSec / 60)} minutes, ${minShots}–${maxShots} shots.`,
      "Structure: a strong hook in the first 15 seconds (first 3-4 shots), a clear conflict, rising comedy/drama, a satisfying turn, then end on a CLIFFHANGER that sets up the next episode, followed by a short narrator line with the moral.",
      "Continue the series: pick up at least one open thread from the story memory.",
    ].join("\n");
  } else if (input.teaserOf) {
    const t = input.teaserOf;
    task = [
      `Write YOUTUBE SHORT #${input.slot ?? 1}: a vertical 9:16 teaser for today's episode "${t.title_hi}" (${t.title_en}). ${minShots}–${maxShots} shots, ${minSec}–${maxSec} seconds total.`,
      "The first shot must be a HOOK that grabs attention in under 2 seconds (a shocking line, a question, or a funny reaction).",
      `Re-use the episode's situations and lines, but do not reveal the ending — end on a cliffhanger like "आगे क्या हुआ? पूरी कहानी चैनल पर देखिए!"`,
      input.slot === 2 ? "Short #2 must focus on a DIFFERENT moment/character than short #1 (pick from the second half of the episode)." : "Short #1 focuses on the opening conflict.",
      `Episode logline: ${t.logline}`,
      `Episode beats:\n${t.shots
        .filter((s) => s.dialogue_hi)
        .slice(0, 80)
        .map((s) => `  [${s.id}] ${s.speaker}: ${s.dialogue_hi}`)
        .join("\n")}`,
    ].join("\n");
  } else {
    task = [
      `Write YOUTUBE SHORT #${input.slot ?? 1}: a self-contained vertical 9:16 mini-story with the same characters. ${minShots}–${maxShots} shots, ${minSec}–${maxSec} seconds total.`,
      "The first shot must be a HOOK that grabs attention in under 2 seconds. Setup → twist → punchline/moral, all inside the short.",
      "It must not contradict the story memory, but should not move the main plot forward.",
      input.slot === 2 ? "Make it clearly different in situation and lead character from short #1." : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const user = [
    `## Series bible`,
    `Premise: ${sl?.premise ?? "(none)"}`,
    sl?.worldRules ? `World rules: ${sl.worldRules}` : "",
    sl?.characterArcs ? `Character arcs: ${sl.characterArcs}` : "",
    sl?.runningGags ? `Running gags: ${sl.runningGags}` : "",
    `## Characters (use ONLY these keys in characters_in_frame / speaker; "narrator" is also allowed as a speaker)`,
    characters,
    `## Locations (use ONLY these keys)`,
    locations,
    `## Story memory (everything that has happened so far)`,
    sl?.storyMemory?.trim() || "(this is the very first episode)",
    sl?.openThreads?.length ? `Open threads: ${sl.openThreads.map((t) => `\n- ${t}`).join("")}` : "",
    input.recentTitles.length ? `Recent titles (do not repeat): ${input.recentTitles.join(" | ")}` : "",
    input.directives.length ? `## Producer directives for this episode (must follow)\n${input.directives.map((d) => `- ${d}`).join("\n")}` : "",
    `## Task`,
    task,
    `## Shot rules`,
    `- framing: wide for establishing/location changes, medium for conversations, closeup for emotional lines and reactions, over_shoulder for confrontations.`,
    `- est_seconds ≈ time to speak the line + 0.5s (silent establishing shots 2.5–4s).`,
    `- image_prompt_en describes ONLY the visual frame (pose, expression, props, camera angle, background details) — no dialogue, no text/letters in the image.`,
    `- sfx: short English tag of an ambient or spot sound (e.g. "birds chirping", "door knock", "crowd murmur", "pressure cooker whistle") or null.`,
    `- youtube.description: 2-3 lines in Hindi + English summary + 5 hashtags.${type === "SHORT" ? " Include #Shorts." : ""}`,
    `## JSON schema`,
    SCHEMA_EXAMPLE,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

export function buildRepairPrompt(errors: string[]): string {
  return `Your previous JSON failed validation:\n${errors.map((e) => `- ${e}`).join("\n")}\nReturn the full corrected JSON object only.`;
}
