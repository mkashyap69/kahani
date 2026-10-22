import { ImageIcon, Mic, RefreshCw, Pencil } from "lucide-react";
import type { Shot } from "@kahani/core";
import { ActionButton, SubmitButton } from "@/components/client";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { regenerateAction, saveShotAction } from "@/app/actions";
import { assetUrl } from "@/lib/utils";

const FRAMINGS = ["wide", "medium", "closeup", "over_shoulder"];

export function ShotCard({ shot, itemId, vertical, characters, locations, editable }: { shot: Shot; itemId: string; vertical: boolean; characters: string[]; locations: string[]; editable: boolean }) {
  const img = assetUrl(shot.imageKey);
  const audio = assetUrl(shot.audioKey);
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className={`relative bg-muted ${vertical ? "aspect-[9/16]" : "aspect-video"}`}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={shot.action} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full place-items-center text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
          </span>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          #{shot.idx} · {shot.framing} · {shot.durationSec ? `${shot.durationSec.toFixed(1)}s` : `~${shot.estSeconds}s`}
        </span>
        {shot.consistencyScore != null && <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">match {shot.consistencyScore}/10</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <Badge variant="outline">{shot.location}</Badge>
          <Badge variant="outline">{shot.emotion}</Badge>
          {shot.sfx && <Badge variant="muted">🔊 {shot.sfx}</Badge>}
        </div>
        {shot.dialogueHi ? (
          <p className="deva text-sm">
            <b className="font-sans text-xs text-primary">{shot.speaker}: </b>
            {shot.dialogueHi}
          </p>
        ) : (
          <p className="text-xs italic text-muted-foreground">(no dialogue) {shot.action}</p>
        )}
        {audio && <audio controls preload="none" src={audio} className="h-8 w-full" />}
        {shot.error && <p className="text-xs text-destructive">{shot.error}</p>}
        {editable && (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            <ActionButton size="sm" variant="outline" action={regenerateAction.bind(null, itemId, shot.idx, "image")} title="New image take for this shot">
              <RefreshCw /> <ImageIcon />
            </ActionButton>
            {shot.dialogueHi && (
              <ActionButton size="sm" variant="outline" action={regenerateAction.bind(null, itemId, shot.idx, "voice")} title="New voice take">
                <RefreshCw /> <Mic />
              </ActionButton>
            )}
          </div>
        )}
        {editable && (
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium text-primary">
              <Pencil className="h-3 w-3" /> Edit line
            </summary>
            <form action={saveShotAction} className="mt-2 space-y-1.5">
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="idx" value={shot.idx} />
              <div className="grid grid-cols-2 gap-1.5">
                <Select name="speaker" defaultValue={shot.speaker ?? "-"}>
                  <option value="-">— silent —</option>
                  <option value="narrator">narrator</option>
                  {characters.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                <Select name="framing" defaultValue={shot.framing}>
                  {FRAMINGS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </Select>
              </div>
              <Textarea name="dialogueHi" defaultValue={shot.dialogueHi ?? ""} rows={2} className="deva" placeholder="Hindi line (Devanagari)" />
              <Select name="location" defaultValue={shot.location}>
                {locations.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </Select>
              <Input name="charactersInFrame" defaultValue={shot.charactersInFrame.join(", ")} placeholder="characters in frame (comma separated)" />
              <Input name="emotion" defaultValue={shot.emotion} placeholder="emotion" />
              <Textarea name="action" defaultValue={shot.action} rows={2} placeholder="action" />
              <Textarea name="imagePromptEn" defaultValue={shot.imagePromptEn} rows={3} placeholder="image prompt" />
              <Input name="sfx" defaultValue={shot.sfx ?? ""} placeholder="sfx tag" />
              <SubmitButton size="sm" className="w-full" pendingText="Saving…">
                Save &amp; re-render this shot
              </SubmitButton>
              <p className="text-[10px] text-muted-foreground">Only changed shots are regenerated; the video is then re-assembled.</p>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}
