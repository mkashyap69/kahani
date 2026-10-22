import type { ContentStatus } from "@prisma/client";

/** Pipeline order. FAILED/REJECTED are terminal side-states. */
export const PIPELINE: ContentStatus[] = [
  "QUEUED",
  "SCRIPTING",
  "SCRIPT_READY",
  "IMAGING",
  "IMAGES_READY",
  "VOICING",
  "ANIMATING",
  "ASSEMBLING",
  "REVIEW",
  "PUBLISHING",
  "PUBLISHED",
];

const RUNNING: ContentStatus[] = ["SCRIPTING", "IMAGING", "VOICING", "ANIMATING", "ASSEMBLING", "PUBLISHING"];
/** Resting states from which an earlier stage may be re-run (script edits, regenerate, retry). */
const RESTING: ContentStatus[] = ["QUEUED", "SCRIPT_READY", "IMAGES_READY", "REVIEW", "REJECTED", "FAILED"];

const forward: Partial<Record<ContentStatus, ContentStatus[]>> = {
  QUEUED: ["SCRIPTING"],
  SCRIPTING: ["SCRIPT_READY"],
  SCRIPT_READY: ["IMAGING"],
  IMAGING: ["IMAGES_READY"],
  IMAGES_READY: ["VOICING"],
  VOICING: ["ANIMATING"],
  ANIMATING: ["ASSEMBLING"],
  ASSEMBLING: ["REVIEW", "PUBLISHING"],
  REVIEW: ["PUBLISHING", "REJECTED"],
  PUBLISHING: ["PUBLISHED"],
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  if (from === "PUBLISHED") return false;
  if (to === "FAILED") return true;
  if (forward[from]?.includes(to)) return true;
  if (RESTING.includes(from) && RUNNING.includes(to)) {
    // publishing only after an approved/assembled video exists
    return to !== "PUBLISHING" || from === "REVIEW" || from === "FAILED";
  }
  return false;
}

/** The pipeline stage names a worker job can run. */
export type Stage = "script" | "images" | "voices" | "motion" | "assemble" | "publish";
export const STAGES: Stage[] = ["script", "images", "voices", "motion", "assemble", "publish"];

/** Status while a stage is running. */
export const STAGE_RUNNING: Record<Stage, ContentStatus> = {
  script: "SCRIPTING",
  images: "IMAGING",
  voices: "VOICING",
  motion: "ANIMATING",
  assemble: "ASSEMBLING",
  publish: "PUBLISHING",
};

export function stageForStatus(status: ContentStatus): Stage | null {
  const entry = Object.entries(STAGE_RUNNING).find(([, s]) => s === status);
  return (entry?.[0] as Stage) ?? null;
}

export function nextStage(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export function progressOf(status: ContentStatus, failedStage?: ContentStatus | null): number {
  const s = status === "FAILED" && failedStage ? failedStage : status;
  const i = PIPELINE.indexOf(s);
  return i < 0 ? 0 : Math.round((i / (PIPELINE.length - 1)) * 100);
}
