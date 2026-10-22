import type { Kit, Research } from "../domain/kit.js";
import type { VoiceInfo } from "../providers/sarvam.js";

export interface KitBrief {
  idea: string;
  language: string;
  audience: string;
  kidSafe: boolean;
  notes: string;
}

const briefText = (b: KitBrief) =>
  [
    `Channel idea: ${b.idea}`,
    `Language: ${b.language} (dialogue in natural spoken Hindi, Devanagari)`,
    b.audience ? `Target audience: ${b.audience}` : "",
    b.kidSafe ? "This is a KIDS channel (made for kids, strict kid-safe content)." : "",
    b.notes ? `Producer notes / constraints: ${b.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

export const RESEARCH_SCHEMA = `{
  "summary": "3-5 sentence strategic summary",
  "audience": "who watches this niche, ages, regions, what they want",
  "competitors": [{"name": "existing channel", "whatWorks": "formats, length, cadence, hooks", "url": "https://..."}],
  "formatsThatWork": ["..."],
  "titleThumbnailPatterns": ["..."],
  "culturalDetails": ["specific, authentic regional details: dialect words, food, festivals, clothing, architecture, professions"],
  "visualStyle": ["art-direction observations: palettes, outline weight, proportions, settings"],
  "musicStyle": ["instruments, ragas/scales, tempo, mood per scene type"],
  "voiceActing": ["casting/performance notes: archetype voices, pacing, energy"],
  "gaps": ["underserved angles this channel can own"],
  "risks": ["YouTube policy (made-for-kids, reused/AI content), cultural sensitivities, copyright"],
  "namesToAvoid": ["existing channel names / trademarks / famous characters"],
  "sources": [{"title": "...", "url": "https://..."}]
}`;

export function buildResearchPrompt(b: KitBrief): { system: string; user: string } {
  return {
    system: [
      "You are a YouTube strategist and researcher specialising in Indian-language animated story channels.",
      "Use web search to research the niche properly before answering: look up existing channels and what performs, audience expectations, authentic cultural/regional details, visual and music conventions, and YouTube policies for animated, AI-assisted and kids content.",
      "Prefer recent, primary sources. Do not invent statistics, channel names or URLs — only cite what you actually found.",
      "Finish with ONLY a JSON object (no markdown) matching the schema.",
    ].join("\n"),
    user: `${briefText(b)}\n\nResearch this niche for launching a new channel. Return JSON:\n${RESEARCH_SCHEMA}`,
  };
}

const KIT_SCHEMA = `{
  "channel": {
    "nameOptions": [{"name": "Roman-script channel name (2-4 words)", "nameHi": "Devanagari", "handle": "@handle", "rationale": "why it works"}],   // 5 options
    "tagline": "short Hindi/Hinglish tagline",
    "descriptionHi": "YouTube channel description in Hindi (3-5 lines)",
    "descriptionEn": "same in English",
    "keywords": ["search keywords"],
    "targetAudience": "...",
    "madeForKids": false,
    "shortsMode": "TEASER" | "MINI_STORY",
    "storyTargetMinutes": 8-15,
    "publishTimes": {"story": "HH:mm", "short1": "HH:mm", "short2": "HH:mm"}   // IST, based on audience habits
  },
  "theme": {
    "name": "...", "genre": "...",
    "artStylePrompt": "master style string appended to EVERY image prompt (medium, palette, outline weight, shading, lighting, proportions, setting, 16:9)",
    "negativeStyle": "what the image model must avoid",
    "tone": "...", "targetAudience": "...",
    "contentRules": "explicit rules the safety reviewer enforces",
    "kidSafe": false
  },
  "storyline": {
    "premise": "series premise (5-8 sentences)", "worldRules": "...", "characterArcs": "...",
    "runningGags": "...", "forbiddenTopics": "...",
    "openThreads": ["hooks for the first episodes"], "firstEpisodeIdeas": ["5 one-line episode ideas"]
  },
  "characters": [{
    "key": "slug", "name": "...", "role": "...", "age": 30, "gender": "female|male|other",
    "personality": "...", "speechStyle": "how they talk (dialect, rhythm, tics)", "catchphrases": ["Devanagari"],
    "visualDescription": "VERY detailed and fixed: body type, face shape, skin tone, eyes, hair (style+colour), outfit with exact colours, accessories, one signature silhouette feature",
    "voice": {"speaker": "<id from the voice catalog>", "pitch": 0, "pace": 1, "loudness": 1, "rationale": "why this voice"}
  }],   // 4-6 characters
  "narrator": {"speaker": "<id>", "pitch": 0, "pace": 0.95, "loudness": 1, "rationale": "..."},
  "locations": [{"key": "slug", "name": "...", "description": "visual background plate description, no people"}],   // 4-6
  "music": {
    "direction": "overall score direction",
    "tracks": [{"title": "...", "mood": "warm|playful|suspense|emotional|festive|calm", "prompt": "instrumental background score prompt: genre, instruments, tempo BPM, mood, 'no vocals, loopable, sits under dialogue'", "lengthSec": 90}]   // 3 tracks
  },
  "branding": {
    "logoPrompt": "channel avatar: mascot/emblem, bold, readable at 98px, NO text",
    "bannerPrompt": "wide channel banner art with the cast; keep the central horizontal band calm/empty for the channel name (added by code); NO text",
    "colorPalette": ["#hex"], "thumbnailStyleNotes": "..."
  }
}`;

export function voiceCatalogText(voices: VoiceInfo[]): string {
  return voices.map((v) => `- ${v.id} (${v.gender}${v.tags?.length ? `; ${v.tags.join(", ")}` : ""})`).join("\n");
}

export function buildKitPrompt(b: KitBrief, research: Research | null, voices: VoiceInfo[], pitchSupported: boolean): { system: string; user: string } {
  return {
    system: [
      "You are the creator and showrunner of a new Hindi 2D animated YouTube series (Indian cartoon style).",
      "Design a complete, ORIGINAL channel: identity, series bible, cast, voices, locations, music direction and branding art direction.",
      "Ground every choice in the research brief. Be culturally specific and authentic — avoid generic or stereotyped portrayals of any community, caste, religion or region.",
      "Never reuse names, characters or catchphrases of existing channels, shows or brands.",
      "Characters must be instantly distinguishable: different silhouettes, ages, body types and signature colours. Visual descriptions are re-used verbatim for every image, so make them precise and stable.",
      "Cast each character from the provided voice catalog only, matching gender and age; give main characters different voices.",
      pitchSupported ? "Voice pitch range −0.75…0.75, pace 0.5…2, loudness 0.3…3." : "This TTS model ignores pitch and loudness — keep them 0 and 1, and use pace (0.5…2) to differentiate.",
      "Music prompts describe instrumental, loopable background score only (no vocals, no named artists or copyrighted songs).",
      "Output ONLY a JSON object matching the schema. No markdown.",
    ].join("\n"),
    user: [
      briefText(b),
      "## Research brief",
      research ? JSON.stringify({ ...research, sources: undefined }, null, 1) : "(no research available — rely on general knowledge, be conservative)",
      "## Voice catalog (Sarvam Bulbul)",
      voiceCatalogText(voices),
      "## Output schema",
      KIT_SCHEMA,
    ].join("\n\n"),
  };
}

export function buildKitReviewPrompt(b: KitBrief, research: Research | null, kit: Kit, voices: VoiceInfo[]): { system: string; user: string } {
  return {
    system: [
      "You are a demanding development executive reviewing a new animated channel package before launch.",
      "1) Use web search to check whether each proposed channel name (or a very similar one) is already used by a YouTube channel or a well-known brand.",
      "2) Check the package against the research: originality, cultural authenticity, audience fit, YouTube policy risks, kid-safety (if applicable).",
      "3) Check production readiness: visual descriptions precise and distinct enough for consistent image generation, art style prompt complete, voices fit (gender/age) and are distinct, locations varied, music prompts usable.",
      "Then FIX every problem yourself. Replace conflicting names with new original ones.",
      'Output ONLY JSON: {"issues": [{"area": "...", "problem": "...", "fix": "..."}], "nameChecks": [{"name": "...", "conflict": true|false, "note": "..."}], "kit": <the complete corrected kit, same schema>}',
    ].join("\n"),
    user: [briefText(b), "## Research summary", research?.summary ?? "(none)", research?.namesToAvoid?.length ? `Names to avoid: ${research.namesToAvoid.join(", ")}` : "", "## Voice catalog", voiceCatalogText(voices), "## Kit", JSON.stringify(kit, null, 1)]
      .filter(Boolean)
      .join("\n\n"),
  };
}
