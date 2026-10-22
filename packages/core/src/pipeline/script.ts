import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { buildRepairPrompt, buildScriptPrompt } from "../prompts/script.js";
import { buildSafetyPrompt, type SafetyReport } from "../prompts/safety.js";
import { extractJson, validateScript, type Script } from "../domain/script.js";
import { estimateShotSeconds } from "../domain/duration.js";
import { llmProvider } from "../providers/registry.js";
import type { LLMMessage, LLMProvider } from "../providers/types.js";
import { NonRetryableError } from "../util/retry.js";
import { logger } from "../util/log.js";
import { loadItem, targetsFor, type LoadedItem } from "./common.js";

const log = logger("script");
const MAX_ATTEMPTS = 3;

/** Stage 1 — write, validate (schema + continuity keys + duration) and safety-check the script. */
export async function runScriptStage(itemId: string): Promise<void> {
  const item = await loadItem(itemId);
  const theme = item.channel.theme;
  const targets = await targetsFor(item.type, item.channel.storyTargetMinutes);

  let teaserOf: Script | null = null;
  if (item.type === "SHORT" && item.channel.shortsMode === "TEASER") {
    if (!item.parent?.scriptJson) throw new Error("teaser short is waiting for today's story script");
    teaserOf = item.parent.scriptJson as unknown as Script;
  }

  const recent = await prisma.contentItem.findMany({
    where: { channelId: item.channelId, id: { not: item.id }, title: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { title: true },
  });
  const directives = item.type === "STORY" ? (theme.storyline?.directives ?? []).map((d) => d.text) : [];
  const episodeNumber = item.episodeNumber ?? (theme.storyline?.episodeCount ?? 0) + 1;

  const prompt = buildScriptPrompt({
    theme,
    type: item.type,
    episodeNumber,
    targetSeconds: targets.seconds,
    shotRange: targets.shots,
    directives,
    teaserOf,
    slot: item.slot,
    recentTitles: recent.map((r) => r.title!).filter(Boolean),
  });

  const llm = await llmProvider();
  let script = await writeValidated(llm, item, prompt.system, [{ role: "user", content: prompt.user }], targets);

  // Content safety gate (before any images are paid for)
  let report = await safetyCheck(llm, item, script);
  if (!report.safe) {
    log.warn("script failed safety check, regenerating once", { itemId, issues: report.issues.length });
    script = await writeValidated(
      llm,
      item,
      prompt.system,
      [
        { role: "user", content: prompt.user },
        { role: "assistant", content: JSON.stringify(script) },
        {
          role: "user",
          content: `A safety review rejected this script:\n${report.issues.map((i) => `- shot ${i.shot_id ?? "?"}: ${i.problem} → ${i.fix}`).join("\n")}\nRewrite the full JSON so it fully complies with the content rules.`,
        },
      ],
      targets,
    );
    report = await safetyCheck(llm, item, script);
    if (!report.safe) {
      await prisma.contentItem.update({ where: { id: itemId }, data: { safetyReport: report as unknown as Prisma.InputJsonValue } });
      throw new NonRetryableError(`script failed the content-safety check: ${report.issues.map((i) => i.problem).join("; ")}`);
    }
  }

  await saveScript(item, script, episodeNumber, report);
  if (item.type === "STORY" && directives.length) {
    await prisma.storyDirective.updateMany({
      where: { id: { in: theme.storyline!.directives.map((d) => d.id) } },
      data: { consumedAt: new Date(), consumedById: itemId },
    });
  }
}

async function writeValidated(
  llm: LLMProvider,
  item: LoadedItem,
  system: string,
  messages: LLMMessage[],
  targets: Awaited<ReturnType<typeof targetsFor>>,
): Promise<Script> {
  const theme = item.channel.theme;
  const ctx = {
    characterKeys: theme.characters.map((c) => c.key),
    locationKeys: theme.locations.map((l) => l.key),
    minShots: targets.shots[0],
    maxShots: targets.shots[1] + 5,
  };
  const convo = [...messages];
  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await llm.complete(
      { system, messages: convo, maxTokens: item.type === "STORY" ? 64000 : 16000, effort: "high" },
      { contentItemId: item.id, operation: `script-attempt-${attempt}` },
    );
    const result = validateScript(res.text, ctx);
    let errors = result.ok ? [] : result.errors;
    if (result.ok) {
      const est = result.script.shots.reduce((a, s) => a + estimateShotSeconds(s), 0);
      const [lo, hi] = targets.seconds;
      if (est < lo * 0.8) errors = [`estimated runtime ${Math.round(est)}s is too short (target ${lo}–${hi}s): add shots/dialogue`];
      else if (est > hi * 1.1) errors = [`estimated runtime ${Math.round(est)}s is too long (target ${lo}–${hi}s): shorten lines or remove shots`];
      if (!errors.length) {
        if (item.type === "SHORT") enforceShortsTags(result.script);
        return result.script;
      }
    }
    lastErrors = errors;
    log.warn(`invalid script (attempt ${attempt})`, { itemId: item.id, errors: errors.slice(0, 5) });
    convo.push({ role: "assistant", content: extractJson(res.text) ?? res.text.slice(0, 20000) });
    convo.push({ role: "user", content: buildRepairPrompt(errors) });
  }
  throw new Error(`script invalid after ${MAX_ATTEMPTS} attempts: ${lastErrors.slice(0, 5).join("; ")}`);
}

function enforceShortsTags(script: Script) {
  if (!/#shorts/i.test(script.youtube.title)) {
    const t = `${script.youtube.title} #Shorts`;
    script.youtube.title = t.length <= 100 ? t : `${script.youtube.title.slice(0, 91)} #Shorts`;
  }
  if (!/#shorts/i.test(script.youtube.description)) script.youtube.description += "\n#Shorts";
}

async function safetyCheck(llm: LLMProvider, item: LoadedItem, script: Script): Promise<SafetyReport> {
  const p = buildSafetyPrompt(script, item.channel.theme);
  const res = await llm.complete(
    { system: p.system, messages: [{ role: "user", content: p.user }], maxTokens: 4000, effort: "low" },
    { contentItemId: item.id, operation: "safety-check" },
  );
  try {
    const parsed = JSON.parse(extractJson(res.text) ?? "{}") as Partial<SafetyReport>;
    return { safe: parsed.safe !== false, severity: parsed.severity ?? "none", issues: parsed.issues ?? [] };
  } catch {
    // fail closed for kid themes, open otherwise
    return item.channel.theme.kidSafe
      ? { safe: false, severity: "medium", issues: [{ shot_id: null, problem: "safety reviewer returned invalid JSON", fix: "retry" }] }
      : { safe: true, severity: "none", issues: [] };
  }
}

export async function saveScript(item: LoadedItem, script: Script, episodeNumber: number | null, report?: SafetyReport) {
  await prisma.$transaction([
    prisma.shot.deleteMany({ where: { contentItemId: item.id } }),
    prisma.shot.createMany({
      data: script.shots.map((s) => ({
        contentItemId: item.id,
        idx: s.id,
        location: s.location,
        timeOfDay: s.time_of_day,
        framing: s.framing,
        charactersInFrame: s.characters_in_frame,
        speaker: s.speaker,
        dialogueHi: s.dialogue_hi || null,
        emotion: s.emotion,
        action: s.action,
        imagePromptEn: s.image_prompt_en,
        sfx: s.sfx ?? null,
        estSeconds: s.est_seconds,
      })),
    }),
    prisma.contentItem.update({
      where: { id: item.id },
      data: {
        scriptJson: script as unknown as Prisma.InputJsonValue,
        title: script.title_hi,
        youtubeMeta: script.youtube as unknown as Prisma.InputJsonValue,
        episodeNumber: item.type === "STORY" ? episodeNumber : item.parent?.episodeNumber ?? null,
        safetyReport: (report ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        videoKey: null,
        thumbnailKey: null,
      },
    }),
  ]);
}
