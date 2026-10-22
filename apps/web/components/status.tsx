import type { ContentStatus } from "@kahani/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STEPS: { key: string; label: string; statuses: ContentStatus[] }[] = [
  { key: "script", label: "Script", statuses: ["SCRIPTING", "SCRIPT_READY"] },
  { key: "images", label: "Images", statuses: ["IMAGING", "IMAGES_READY"] },
  { key: "voices", label: "Voices", statuses: ["VOICING"] },
  { key: "motion", label: "Motion", statuses: ["ANIMATING"] },
  { key: "assemble", label: "Assembly", statuses: ["ASSEMBLING"] },
  { key: "review", label: "Review", statuses: ["REVIEW"] },
  { key: "publish", label: "Publish", statuses: ["PUBLISHING", "PUBLISHED"] },
];
const ORDER: ContentStatus[] = ["QUEUED", "SCRIPTING", "SCRIPT_READY", "IMAGING", "IMAGES_READY", "VOICING", "ANIMATING", "ASSEMBLING", "REVIEW", "PUBLISHING", "PUBLISHED"];
const RUNNING: ContentStatus[] = ["SCRIPTING", "IMAGING", "VOICING", "ANIMATING", "ASSEMBLING", "PUBLISHING"];

export function StatusBadge({ status }: { status: ContentStatus }) {
  const variant =
    status === "PUBLISHED" ? "success" : status === "FAILED" ? "destructive" : status === "REJECTED" ? "muted" : status === "REVIEW" ? "warning" : RUNNING.includes(status) ? "running" : "secondary";
  return (
    <Badge variant={variant}>
      {RUNNING.includes(status) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {status.replace("_", " ")}
    </Badge>
  );
}

/** One chip per stage: done / running / failed / pending. */
export function StageChips({ status, failedStage }: { status: ContentStatus; failedStage?: ContentStatus | null }) {
  const effective = status === "FAILED" && failedStage ? failedStage : status;
  const pos = ORDER.indexOf(effective);
  return (
    <div className="flex flex-wrap gap-1">
      {STEPS.map((step) => {
        const first = ORDER.indexOf(step.statuses[0]);
        const last = ORDER.indexOf(step.statuses[step.statuses.length - 1]);
        const inStep = step.statuses.includes(effective);
        const done = pos > last || (inStep && !RUNNING.includes(effective) && effective !== "REVIEW") || (status === "PUBLISHED");
        const failed = status === "FAILED" && inStep;
        const running = inStep && RUNNING.includes(effective) && status !== "FAILED";
        const review = step.key === "review" && effective === "REVIEW";
        return (
          <span
            key={step.key}
            title={step.label}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              failed
                ? "bg-destructive text-white"
                : running
                  ? "animate-pulse bg-blue-500 text-white"
                  : review
                    ? "bg-warning text-white"
                    : done || pos > first
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground",
            )}
          >
            {step.label}
          </span>
        );
      })}
    </div>
  );
}
