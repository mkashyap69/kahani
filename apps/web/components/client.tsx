"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Loader2, Play, Square } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Re-fetches server components on an interval while work is in flight. */
export function AutoRefresh({ ms = 5000, enabled = true }: { ms?: number; enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms, enabled]);
  return null;
}

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/** Calls a server action outside a form (with confirmation and inline error). */
export function ActionButton({ action, confirm, children, ...props }: ButtonProps & { action: () => Promise<unknown>; confirm?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col">
      <Button
        {...props}
        disabled={pending || props.disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          start(async () => {
            try {
              await action();
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          });
        }}
      >
        {pending && <Loader2 className="animate-spin" />}
        {children}
      </Button>
      {error && <span className="mt-1 max-w-xs text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** Inline audio preview for a voice configuration. */
export function VoicePreview({
  speaker,
  pitch,
  pace,
  loudness,
  defaultText,
  fields = { speaker: "voiceSpeaker", pitch: "voicePitch", pace: "voicePace", loudness: "voiceLoudness" },
}: {
  speaker: string;
  pitch: number;
  pace: number;
  loudness: number;
  defaultText: string;
  /** form field names to read live (unsaved) values from */
  fields?: { speaker: string; pitch: string; pace: string; loudness: string };
}) {
  const [text, setText] = useState(defaultText);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [err, setErr] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  async function play() {
    // read live values from the surrounding voice form so unsaved tweaks are previewed
    const root = formRef.current?.closest("form");
    const get = (n: string, d: number | string) => (root?.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value ?? d;
    setState("loading");
    try {
      const res = await fetch("/api/voice-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, speaker: get(fields.speaker, speaker), pitch: Number(get(fields.pitch, pitch)), pace: Number(get(fields.pace, pace)), loudness: Number(get(fields.loudness, loudness)) }),
      });
      if (!res.ok) throw new Error(await res.text());
      const url = URL.createObjectURL(await res.blob());
      audio.current?.pause();
      audio.current = new Audio(url);
      audio.current.onended = () => setState("idle");
      await audio.current.play();
      setState("playing");
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
    }
  }

  return (
    <div ref={formRef} className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="deva w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
      <div className="flex items-center gap-2">
        {state === "playing" ? (
          <Button type="button" size="sm" variant="outline" onClick={() => (audio.current?.pause(), setState("idle"))}>
            <Square /> Stop
          </Button>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={play} disabled={state === "loading" || !text.trim()}>
            {state === "loading" ? <Loader2 className="animate-spin" /> : <Play />} Preview voice
          </Button>
        )}
        {state === "error" && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
