import { IMAGE_MODELS, type Channel } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { SubmitButton } from "@/components/client";
import { saveChannelAction } from "@/app/actions";

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Kathmandu", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles", "UTC"];

export function ChannelForm({ channel, themes, musicPacks }: { channel?: Channel | null; themes: { id: string; name: string; usedBy?: string | null }[]; musicPacks: string[] }) {
  const c = channel;
  return (
    <form action={saveChannelAction} className="space-y-6">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Channel name">
            <Input name="name" required defaultValue={c?.name} placeholder="Gaon Ki Kahaniyan" />
          </Field>
          <Field label="Theme" hint="exactly one theme per channel">
            <Select name="themeId" required defaultValue={c?.themeId}>
              <option value="">Choose…</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id} disabled={!!t.usedBy && t.usedBy !== c?.id}>
                  {t.name}
                  {t.usedBy && t.usedBy !== c?.id ? " (in use)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language">
            <Input name="language" defaultValue={c?.language ?? "hi-IN"} />
          </Field>
          <Field label="Timezone">
            <Select name="timezone" defaultValue={c?.timezone ?? "Asia/Kolkata"}>
              {TIMEZONES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Switch name="active" defaultChecked={c?.active ?? true} label="Active" hint="paused channels are skipped by the daily scheduler" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>Times are in the channel&apos;s timezone. Videos are uploaded as scheduled (private → public at the time).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <Field label="Daily generation">
            <Input type="time" name="generationTime" defaultValue={c?.generationTime ?? "02:00"} />
          </Field>
          <Field label="Story publish">
            <Input type="time" name="storyPublishTime" defaultValue={c?.storyPublishTime ?? "18:00"} />
          </Field>
          <Field label="Short #1 publish">
            <Input type="time" name="short1Time" defaultValue={c?.shortPublishTimes[0] ?? "12:00"} />
          </Field>
          <Field label="Short #2 publish">
            <Input type="time" name="short2Time" defaultValue={c?.shortPublishTimes[1] ?? "20:30"} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Story length (minutes)" hint="8–15">
            <Input type="number" min={8} max={15} name="storyTargetMinutes" defaultValue={c?.storyTargetMinutes ?? 10} />
          </Field>
          <Field label="Shorts" hint="teaser cut from today's story, or a self-contained mini-story">
            <Select name="shortsMode" defaultValue={c?.shortsMode ?? "TEASER"}>
              <option value="TEASER">Cliffhanger teaser of today&apos;s story</option>
              <option value="MINI_STORY">Self-contained mini-story</option>
            </Select>
          </Field>
          <Field label="Background music pack" hint="folders in assets/music/">
            <Select name="musicPack" defaultValue={c?.musicPack ?? "village-warm"}>
              {musicPacks.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Motion" hint="lip-sync uses fal.ai for close-up dialogue shots only (extra cost)">
            <Select name="motionProvider" defaultValue={c?.motionProvider ?? "kenburns"}>
              <option value="kenburns">Ken Burns pan/zoom (free)</option>
              <option value="lipsync">Ken Burns + lip-sync close-ups (fal.ai)</option>
            </Select>
          </Field>
          <Field label="Thumbnail style">
            <Select name="thumbnailStyle" defaultValue={c?.thumbnailStyle ?? "bold-closeup"}>
              <option value="bold-closeup">Bold close-up + big Hindi text</option>
            </Select>
          </Field>
          <div />
          <Field label="Intro clip (MP4)" hint={c?.introClipKey ? "custom intro uploaded" : "default: generated title card"}>
            <Input type="file" name="introClip" accept="video/mp4" />
            {c?.introClipKey && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="clearintro" /> use generated intro
              </label>
            )}
          </Field>
          <Field label="Outro clip (MP4)" hint={c?.outroClipKey ? "custom outro uploaded" : "default: thanks + subscribe card"}>
            <Input type="file" name="outroClip" accept="video/mp4" />
            {c?.outroClipKey && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="clearoutro" /> use generated outro
              </label>
            )}
          </Field>
          <Switch name="subtitlesEnabled" defaultChecked={c?.subtitlesEnabled ?? true} label="Burn in Hindi subtitles" />
          <Switch name="autoPublish" defaultChecked={c?.autoPublish ?? false} label="Auto-publish" hint="off = finished videos wait in the Review Queue" />
          <Switch name="madeForKids" defaultChecked={c?.madeForKids ?? false} label="Made for kids" hint="sets selfDeclaredMadeForKids on upload" />
          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">AI-content (synthetic media) disclosure is always on for every upload.</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Image models</CardTitle>
          <CardDescription>
            Pick a model per shot type (blank = use the default). Compare models on real shots on the <a className="text-primary underline" href="/compare">Image models</a> page.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {(["default", "wide", "medium", "closeup", "over_shoulder", "thumbnail"] as const).map((kind) => {
            const current = ((c?.imageModels ?? {}) as Record<string, string>)[kind] ?? "";
            return (
              <Field key={kind} label={kind === "default" ? "Default (all shots)" : kind === "over_shoulder" ? "Over-the-shoulder shots" : kind === "thumbnail" ? "Thumbnails" : `${kind[0].toUpperCase()}${kind.slice(1)} shots`}>
                <Select name={`imageModel_${kind}`} defaultValue={current}>
                  <option value="">{kind === "default" ? "Nano Banana (env default)" : "— same as default —"}</option>
                  {IMAGE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · ${m.usd}/img
                    </option>
                  ))}
                </Select>
              </Field>
            );
          })}
          <div className="md:col-span-3">
            <Switch
              name="imageBatch"
              defaultChecked={c?.imageBatch ?? false}
              label="Gemini batch mode (≈50% cheaper)"
              hint="Gemini shots go through Google's Batch API — results usually within a few hours (max 24h), so it suits the overnight daily run. Anything late or failed falls back to standard calls."
            />
          </div>
        </CardContent>
      </Card>
      <SubmitButton pendingText="Saving…">{c ? "Save channel" : "Create channel"}</SubmitButton>
    </form>
  );
}
