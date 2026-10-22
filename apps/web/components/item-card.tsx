import Link from "next/link";
import { Film, Smartphone, RotateCcw } from "lucide-react";
import type { ContentItem } from "@kahani/core";
import { StageChips, StatusBadge } from "@/components/status";
import { ActionButton } from "@/components/client";
import { retryAction } from "@/app/actions";
import { assetUrl, duration, inr } from "@/lib/utils";

export function ItemCard({ item, compact }: { item: ContentItem; compact?: boolean }) {
  const thumb = assetUrl(item.thumbnailKey);
  const vertical = item.type === "SHORT";
  return (
    <div className="flex gap-3 rounded-lg border bg-card p-3">
      <Link href={`/content/${item.id}`} className={`relative shrink-0 overflow-hidden rounded-md bg-muted ${vertical ? "h-24 w-[54px]" : "h-[54px] w-24"} ${compact ? "" : ""}`}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-muted-foreground">{vertical ? <Smartphone className="h-5 w-5" /> : <Film className="h-5 w-5" />}</span>
        )}
      </Link>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {item.type === "STORY" ? `Story${item.episodeNumber ? ` · Ep ${item.episodeNumber}` : ""}` : `Short ${item.slot || ""}`}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <Link href={`/content/${item.id}`} className="deva block truncate text-sm font-semibold hover:underline">
          {item.title ?? <span className="text-muted-foreground">Untitled (scripting…)</span>}
        </Link>
        <StageChips status={item.status} failedStage={item.failedStage} />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{duration(item.durationSec)}</span>
          <span>{inr(item.costInr)}</span>
          {item.scheduledPublishAt && <span>⏰ {new Date(item.scheduledPublishAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span>}
        </div>
        {item.status === "FAILED" && (
          <div className="flex items-start justify-between gap-2 rounded-md bg-destructive/5 p-2">
            <p className="line-clamp-2 text-xs text-destructive">
              <b>{item.failedStage}</b>: {item.error}
            </p>
            <ActionButton size="sm" variant="outline" action={retryAction.bind(null, item.id)}>
              <RotateCcw /> Retry stage
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
