import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, Image as ImageIcon, Music, RefreshCw, Rocket, Trash2 } from "lucide-react";
import { KitSchema, kitPack, prisma, stepForStatus, voiceCatalog, type Research } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ActionButton, AutoRefresh, SubmitButton, VoicePreview } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { applyKitAction, chooseLogoAction, deleteKitAction, kitArtAction, kitMusicAction, rerunKitAction, saveKitAction } from "@/app/actions";
import { assetUrl, cn, inr } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STEPS = [
  { s: "RESEARCHING", label: "Research (web)" },
  { s: "WRITING", label: "Write kit" },
  { s: "REVIEWING", label: "Review + name check" },
  { s: "ART", label: "Logo & banner" },
  { s: "MUSIC", label: "Music" },
  { s: "READY", label: "Ready" },
];
const BUSY = ["QUEUED", "RESEARCHING", "WRITING", "REVIEWING", "ART", "MUSIC"];

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-sm">
        {items.map((i, k) => (
          <li key={k}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const k = await prisma.launchKit.findUnique({ where: { id }, include: { channel: true } });
  if (!k) notFound();
  const tracks = await prisma.musicTrack.findMany({ where: { pack: kitPack(id) }, orderBy: { createdAt: "asc" } });
  const parsed = k.kit ? KitSchema.safeParse(k.kit) : null;
  const kit = parsed?.success ? parsed.data : null;
  const research = k.research as unknown as Research | null;
  const review = k.review as { issues: { area: string; problem: string; fix: string }[]; nameChecks: { name: string; conflict: boolean; note: string }[]; sources?: { url: string; title: string }[] } | null;
  const busy = BUSY.includes(k.status);
  const pos = STEPS.findIndex((s) => s.s === (k.status === "FAILED" ? k.failedStep : k.status));
  const voices = voiceCatalog();
  const applied = !!k.channelId;
  const failedStep = stepForStatus(k.failedStep);

  return (
    <div className="space-y-6">
      <AutoRefresh enabled={busy} ms={3000} />
      <PageHeader
        title={kit ? kit.channel.nameOptions[k.chosenName]?.name ?? "Launch kit" : "Launch kit"}
        description={
          <span>
            <Link href="/launch" className="hover:underline">← Launch kits</Link> · “{k.idea}” · {inr(k.costInr)}
          </span>
        }
      >
        {kit && !applied && k.status === "READY" && (
          <ActionButton variant="success" action={applyKitAction.bind(null, k.id)} confirm="Create the theme, cast, locations, storyline, music pack and channel from this kit?">
            <Rocket /> Create channel
          </ActionButton>
        )}
        {applied && k.channel && (
          <Link href={`/channels/${k.channel.id}`} className="text-sm font-medium text-success hover:underline">
            ✓ Created “{k.channel.name}” →
          </Link>
        )}
        <ActionButton variant="ghost" action={deleteKitAction.bind(null, k.id)} confirm="Delete this kit? (A channel created from it is kept.)">
          <Trash2 />
        </ActionButton>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s.s}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium",
              k.status === "FAILED" && i === pos ? "bg-destructive text-white" : i < pos || k.status === "APPLIED" ? "bg-success/15 text-success" : i === pos && busy ? "animate-pulse bg-blue-500 text-white" : i === pos ? "bg-warning text-white" : "bg-muted text-muted-foreground",
            )}
          >
            {s.label}
          </span>
        ))}
      </div>
      {k.error && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span>{k.error}</span>
          {failedStep && (
            <ActionButton size="sm" variant="outline" action={rerunKitAction.bind(null, k.id, failedStep, false)}>
              <RefreshCw /> Retry from {failedStep}
            </ActionButton>
          )}
        </div>
      )}
      {busy && !kit && <p className="text-sm text-muted-foreground">Working… research with live web search can take a few minutes.</p>}

      {research && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Research brief</CardTitle>
              <CardDescription>{research.summary}</CardDescription>
            </div>
            {!busy && !applied && (
              <ActionButton size="sm" variant="outline" action={rerunKitAction.bind(null, k.id, "research", false)} confirm="Re-run research and regenerate everything after it?">
                <RefreshCw /> Re-research
              </ActionButton>
            )}
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {research.audience && (
              <div className="md:col-span-2 xl:col-span-3 text-sm">
                <b>Audience:</b> {research.audience}
              </div>
            )}
            {research.competitors.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Existing channels</p>
                <ul className="space-y-1 text-sm">
                  {research.competitors.map((c, i) => (
                    <li key={i}>
                      {c.url ? (
                        <a href={c.url} target="_blank" className="font-medium text-primary hover:underline">{c.name}</a>
                      ) : (
                        <b>{c.name}</b>
                      )}{" "}
                      — {c.whatWorks}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <List title="Formats that work" items={research.formatsThatWork} />
            <List title="Gaps to own" items={research.gaps} />
            <List title="Cultural details" items={research.culturalDetails} />
            <List title="Visual style" items={research.visualStyle} />
            <List title="Music style" items={research.musicStyle} />
            <List title="Voice acting" items={research.voiceActing} />
            <List title="Titles & thumbnails" items={research.titleThumbnailPatterns} />
            <List title="Risks" items={research.risks} />
            {research.sources.length > 0 && (
              <details className="md:col-span-2 xl:col-span-3">
                <summary className="cursor-pointer text-sm font-medium">{research.sources.length} sources</summary>
                <ul className="mt-2 grid gap-1 text-xs md:grid-cols-2">
                  {research.sources.map((s) => (
                    <li key={s.url} className="truncate">
                      <a href={s.url} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" /> {s.title || s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {review && (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
            <CardDescription>A second pass checked names on the web and fixed problems it found.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              {review.nameChecks.map((n) => (
                <p key={n.name} className="flex items-start gap-2 text-sm">
                  {n.conflict ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
                  <span>
                    <b>{n.name}</b> <span className="text-muted-foreground">{n.note}</span>
                  </span>
                </p>
              ))}
            </div>
            <ul className="space-y-1 text-sm">
              {review.issues.map((i, n) => (
                <li key={n}>
                  <Badge variant="outline">{i.area}</Badge> {i.problem} {i.fix && <span className="text-muted-foreground">→ {i.fix}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {kit && (
        <>
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Branding</CardTitle>
                <CardDescription>Logo (800×800 profile picture) and banner (2560×1440, title in the all-device safe area). Text is added by code, never by the image model.</CardDescription>
              </div>
              {!busy && (
                <div className="flex gap-2">
                  <ActionButton size="sm" variant="outline" action={kitArtAction.bind(null, k.id, "logo")}>
                    <ImageIcon /> New logos
                  </ActionButton>
                  <ActionButton size="sm" variant="outline" action={kitArtAction.bind(null, k.id, "banner")}>
                    <ImageIcon /> New banner
                  </ActionButton>
                </div>
              )}
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[auto_1fr]">
              <div className="flex gap-3">
                {k.logoCandidates.map((key) => (
                  <form key={key} action={chooseLogoAction.bind(null, k.id, key)}>
                    <button type="submit" title="Use this logo" className={cn("block overflow-hidden rounded-full border-4", key === k.logoKey ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={assetUrl(key)!} alt="logo" className="h-28 w-28 object-cover" />
                    </button>
                  </form>
                ))}
              </div>
              {k.bannerKey && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl(k.bannerKey)!} alt="banner" className="w-full rounded-md border" />
              )}
            </CardContent>
          </Card>

          <form action={saveKitAction} className="space-y-6">
            <input type="hidden" name="kitId" value={k.id} />
            <Card>
              <CardHeader>
                <CardTitle>Channel identity</CardTitle>
                <CardDescription>Pick the name to use; all options are editable.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {kit.channel.nameOptions.map((n, i) => {
                    const conflict = review?.nameChecks.find((c) => c.name.toLowerCase() === n.name.toLowerCase())?.conflict;
                    return (
                      <label key={i} className={cn("space-y-1.5 rounded-lg border p-3", i === k.chosenName && "border-primary ring-1 ring-primary")}>
                        <span className="flex items-center gap-2 text-xs font-medium">
                          <input type="radio" name="$chosenName" value={i} defaultChecked={i === k.chosenName} /> Use this name {conflict && <Badge variant="warning">possible conflict</Badge>}
                        </span>
                        <Input name={`channel.nameOptions.${i}.name`} defaultValue={n.name} />
                        <Input name={`channel.nameOptions.${i}.nameHi`} defaultValue={n.nameHi} className="deva" />
                        <Input name={`channel.nameOptions.${i}.handle`} defaultValue={n.handle} />
                        <p className="text-xs text-muted-foreground">{n.rationale}</p>
                      </label>
                    );
                  })}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Tagline">
                    <Input name="channel.tagline" defaultValue={kit.channel.tagline} className="deva" />
                  </Field>
                  <Field label="Audience">
                    <Input name="channel.targetAudience" defaultValue={kit.channel.targetAudience} />
                  </Field>
                  <Field label="Description (Hindi)">
                    <Textarea name="channel.descriptionHi" defaultValue={kit.channel.descriptionHi} rows={4} className="deva" />
                  </Field>
                  <Field label="Description (English)">
                    <Textarea name="channel.descriptionEn" defaultValue={kit.channel.descriptionEn} rows={4} />
                  </Field>
                  <Field label="Keywords" hint="comma separated">
                    <Input name="channel.keywords" defaultValue={kit.channel.keywords.join(", ")} />
                  </Field>
                  <div className="grid grid-cols-4 gap-2">
                    <Field label="Story min">
                      <Input type="number" min={8} max={15} name="channel.storyTargetMinutes" defaultValue={kit.channel.storyTargetMinutes} />
                    </Field>
                    <Field label="Story at">
                      <Input type="time" name="channel.publishTimes.story" defaultValue={kit.channel.publishTimes.story} />
                    </Field>
                    <Field label="Short 1">
                      <Input type="time" name="channel.publishTimes.short1" defaultValue={kit.channel.publishTimes.short1} />
                    </Field>
                    <Field label="Short 2">
                      <Input type="time" name="channel.publishTimes.short2" defaultValue={kit.channel.publishTimes.short2} />
                    </Field>
                  </div>
                  <Field label="Shorts">
                    <Select name="channel.shortsMode" defaultValue={kit.channel.shortsMode}>
                      <option value="TEASER">Teaser of today&apos;s story</option>
                      <option value="MINI_STORY">Self-contained mini-story</option>
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 pt-6 text-sm">
                    <input type="hidden" name="bool:channel.madeForKids" />
                    <input type="checkbox" name="channel.madeForKids" defaultChecked={kit.channel.madeForKids} /> Made for kids
                  </label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Art style &amp; rules</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Theme name">
                  <Input name="theme.name" defaultValue={kit.theme.name} />
                </Field>
                <Field label="Genre">
                  <Input name="theme.genre" defaultValue={kit.theme.genre} />
                </Field>
                <Field label="Art style prompt" className="md:col-span-2" hint="appended to every image prompt">
                  <Textarea name="theme.artStylePrompt" defaultValue={kit.theme.artStylePrompt} rows={3} />
                </Field>
                <Field label="Negative style">
                  <Textarea name="theme.negativeStyle" defaultValue={kit.theme.negativeStyle} rows={2} />
                </Field>
                <Field label="Content rules">
                  <Textarea name="theme.contentRules" defaultValue={kit.theme.contentRules} rows={2} />
                </Field>
                <Field label="Tone">
                  <Input name="theme.tone" defaultValue={kit.theme.tone} />
                </Field>
                <label className="flex items-center gap-2 pt-6 text-sm">
                  <input type="hidden" name="bool:theme.kidSafe" />
                  <input type="checkbox" name="theme.kidSafe" defaultChecked={kit.theme.kidSafe} /> Strict kids profile
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Series bible</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Premise" className="md:col-span-2">
                  <Textarea name="storyline.premise" defaultValue={kit.storyline.premise} rows={4} />
                </Field>
                <Field label="World rules">
                  <Textarea name="storyline.worldRules" defaultValue={kit.storyline.worldRules} rows={3} />
                </Field>
                <Field label="Character arcs">
                  <Textarea name="storyline.characterArcs" defaultValue={kit.storyline.characterArcs} rows={3} />
                </Field>
                <Field label="Running gags">
                  <Textarea name="storyline.runningGags" defaultValue={kit.storyline.runningGags} rows={3} />
                </Field>
                <Field label="Forbidden topics">
                  <Textarea name="storyline.forbiddenTopics" defaultValue={kit.storyline.forbiddenTopics} rows={3} />
                </Field>
                <Field label="Open threads" hint="one per line">
                  <Textarea name="storyline.openThreads" defaultValue={kit.storyline.openThreads.join("\n")} rows={4} />
                </Field>
                <Field label="First episode ideas" hint="one per line — the first becomes a directive for episode 1">
                  <Textarea name="storyline.firstEpisodeIdeas" defaultValue={kit.storyline.firstEpisodeIdeas.join("\n")} rows={4} />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cast &amp; voices</CardTitle>
                <CardDescription>Voices come from the Sarvam catalog for the configured model; preview uses the unsaved values.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                {kit.characters.map((c, i) => (
                  <div key={i} className="space-y-2 rounded-lg border p-3">
                    <div className="grid grid-cols-[1fr_90px_110px] gap-2">
                      <Input name={`characters.${i}.name`} defaultValue={c.name} className="font-semibold" />
                      <Input type="number" name={`characters.${i}.age`} defaultValue={c.age ?? ""} placeholder="age" />
                      <Select name={`characters.${i}.gender`} defaultValue={c.gender}>
                        <option value="female">female</option>
                        <option value="male">male</option>
                        <option value="other">other</option>
                      </Select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      key <code>{c.key}</code>
                    </p>
                    <Input name={`characters.${i}.role`} defaultValue={c.role} />
                    <Textarea name={`characters.${i}.personality`} defaultValue={c.personality} rows={2} />
                    <Textarea name={`characters.${i}.speechStyle`} defaultValue={c.speechStyle} rows={2} />
                    <Input name={`characters.${i}.catchphrases`} defaultValue={c.catchphrases.join(", ")} className="deva" placeholder="catchphrases (comma separated)" />
                    <Textarea name={`characters.${i}.visualDescription`} defaultValue={c.visualDescription} rows={4} />
                    <div className="grid grid-cols-4 gap-2">
                      <Select name={`characters.${i}.voice.speaker`} defaultValue={c.voice.speaker} className="col-span-4 sm:col-span-1">
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </Select>
                      <Input type="number" step="0.05" name={`characters.${i}.voice.pitch`} defaultValue={c.voice.pitch} title="pitch" />
                      <Input type="number" step="0.05" name={`characters.${i}.voice.pace`} defaultValue={c.voice.pace} title="pace" />
                      <Input type="number" step="0.1" name={`characters.${i}.voice.loudness`} defaultValue={c.voice.loudness} title="loudness" />
                    </div>
                    {c.voice.rationale && <p className="text-xs text-muted-foreground">🎙 {c.voice.rationale}</p>}
                    <VoicePreview
                      speaker={c.voice.speaker}
                      pitch={c.voice.pitch}
                      pace={c.voice.pace}
                      loudness={c.voice.loudness}
                      defaultText={c.catchphrases[0] ? `${c.catchphrases[0]} मैं ${c.name} हूँ।` : `नमस्ते, मैं ${c.name} हूँ।`}
                      fields={{ speaker: `characters.${i}.voice.speaker`, pitch: `characters.${i}.voice.pitch`, pace: `characters.${i}.voice.pace`, loudness: `characters.${i}.voice.loudness` }}
                    />
                  </div>
                ))}
                <div className="space-y-2 rounded-lg border border-dashed p-3">
                  <p className="font-semibold">Narrator</p>
                  <div className="grid grid-cols-4 gap-2">
                    <Select name="narrator.speaker" defaultValue={kit.narrator.speaker}>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </Select>
                    <Input type="number" step="0.05" name="narrator.pitch" defaultValue={kit.narrator.pitch} />
                    <Input type="number" step="0.05" name="narrator.pace" defaultValue={kit.narrator.pace} />
                    <Input type="number" step="0.1" name="narrator.loudness" defaultValue={kit.narrator.loudness} />
                  </div>
                  <VoicePreview
                    speaker={kit.narrator.speaker}
                    pitch={kit.narrator.pitch}
                    pace={kit.narrator.pace}
                    loudness={kit.narrator.loudness}
                    defaultText="एक छोटे से गाँव में, एक नई कहानी शुरू होती है।"
                    fields={{ speaker: "narrator.speaker", pitch: "narrator.pitch", pace: "narrator.pace", loudness: "narrator.loudness" }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Locations</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {kit.locations.map((l, i) => (
                  <div key={i} className="space-y-1.5 rounded-lg border p-3">
                    <Input name={`locations.${i}.name`} defaultValue={l.name} className="font-semibold" />
                    <Textarea name={`locations.${i}.description`} defaultValue={l.description} rows={3} />
                    <p className="text-[11px] text-muted-foreground">
                      key <code>{l.key}</code>
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Music className="h-5 w-5" /> Background music
                  </CardTitle>
                  <CardDescription>{kit.music.direction}</CardDescription>
                </div>
                {!busy && (
                  <ActionButton size="sm" variant="outline" action={kitMusicAction.bind(null, k.id)} confirm="Regenerate all tracks from the (saved) prompts?">
                    <RefreshCw /> Regenerate music
                  </ActionButton>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {kit.music.tracks.map((t, i) => {
                  const track = tracks.find((x) => x.title === t.title);
                  return (
                    <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[200px_1fr_280px]">
                      <div className="space-y-1">
                        <Input name={`music.tracks.${i}.title`} defaultValue={t.title} className="font-semibold" />
                        <Input name={`music.tracks.${i}.mood`} defaultValue={t.mood} />
                      </div>
                      <Textarea name={`music.tracks.${i}.prompt`} defaultValue={t.prompt} rows={3} />
                      <div className="space-y-1">
                        {track ? <audio controls preload="none" src={assetUrl(track.key)!} className="w-full" /> : <p className="text-xs text-muted-foreground">not generated yet</p>}
                        {track && <p className="text-[11px] text-muted-foreground">{track.source} · {track.durationSec.toFixed(0)}s · {track.license}</p>}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {!applied && (
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
                <span className="text-xs text-muted-foreground">Save before creating the channel. Changing the cast doesn&apos;t regenerate art — use “New logos / New banner”.</span>
              </div>
            )}
          </form>
        </>
      )}
    </div>
  );
}
