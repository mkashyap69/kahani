import type { Script } from "../domain/script.js";
import type { ThemeBundle } from "../domain/types.js";

export function buildSafetyPrompt(script: Script, theme: ThemeBundle): { system: string; user: string } {
  const strict = theme.kidSafe;
  const system = [
    "You are a strict content-safety reviewer for a YouTube animation studio.",
    "Check the script against the channel's content rules and YouTube's community guidelines.",
    strict
      ? "STRICT KIDS PROFILE: flag ANY violence (even slapstick hitting), fear-inducing content, insults/name-calling, romance, dangerous imitable acts, consumerism, or adult themes."
      : "Flag graphic violence, hate, sexual content, harassment, dangerous acts, misinformation, and anything humiliating a real community, caste, religion or region.",
    'Reply with ONLY JSON: {"safe": boolean, "severity": "none|low|medium|high", "issues": [{"shot_id": number|null, "problem": string, "fix": string}]}',
    "Mark safe=false only for medium/high issues; list low issues but keep safe=true.",
  ].join("\n");
  const user = [
    `Content rules: ${theme.contentRules || "(none beyond defaults)"}`,
    `Forbidden topics: ${theme.storyline?.forbiddenTopics || "(none)"}`,
    `Title: ${script.title_hi} / ${script.title_en}`,
    `Moral: ${script.moral}`,
    "Shots:",
    ...script.shots.map((s) => `[${s.id}] (${s.location}, ${s.emotion}) ${s.action} | ${s.speaker ?? "-"}: ${s.dialogue_hi}`),
  ].join("\n");
  return { system, user };
}

export interface SafetyReport {
  safe: boolean;
  severity: "none" | "low" | "medium" | "high";
  issues: { shot_id: number | null; problem: string; fix: string }[];
}
