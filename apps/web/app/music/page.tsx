import { Music, Trash2, Upload, Wand2 } from "lucide-react";
import { musicPacks, prisma, providerSummary } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ActionButton, SubmitButton } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { deleteMusicAction, generateMusicAction, uploadMusicAction } from "@/app/actions";
import { assetUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MusicPage() {
  const [tracks, packs, providers, channels] = await Promise.all([
    prisma.musicTrack.findMany({ orderBy: [{ pack: "asc" }, { createdAt: "asc" }] }),
    musicPacks(),
    providerSummary(),
    prisma.channel.findMany({ select: { name: true, musicPack: true } }),
  ]);
  const byPack = new Map<string, typeof tracks>();
  for (const t of tracks) byPack.set(t.pack, [...(byPack.get(t.pack) ?? []), t]);
  const realMusic = !providers.music.startsWith("mock");

  return (
    <div className="space-y-6">
      <PageHeader title="Music library" description="Background music packs. A channel uses one pack; tracks are picked per video and ducked under dialogue." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" /> Generate a track
            </CardTitle>
            <CardDescription>
              {realMusic
                ? "Uses ElevenLabs Eleven Music (instrumental). Generated tracks can be used commercially on paid ElevenLabs plans — check your plan's Eleven Music terms."
                : "No ELEVENLABS_API_KEY — tracks are synthesised placeholders. Add the key in Settings for real AI-generated, commercially-licensable music."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={generateMusicAction} className="grid gap-3 md:grid-cols-2">
              <Field label="Pack">
                <Input name="pack" list="packs" placeholder="e.g. jungle-tales" required />
              </Field>
              <Field label="Title">
                <Input name="title" placeholder="Morning in the forest" />
              </Field>
              <Field label="Prompt" className="md:col-span-2" hint="instruments, tempo, mood — no artist names or copyrighted songs">
                <Textarea name="prompt" rows={3} placeholder="cheerful Indian folk instrumental, bansuri melody, light tabla, 110 BPM, no vocals, loopable, sits under dialogue" required />
              </Field>
              <Field label="Mood">
                <Select name="mood" defaultValue="warm">
                  {["warm", "playful", "suspense", "emotional", "festive", "calm"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Length (seconds)">
                <Input type="number" name="lengthSec" min={20} max={240} defaultValue={90} />
              </Field>
              <SubmitButton pendingText="Queued…">
                <Music /> Generate
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" /> Upload a licensed track
            </CardTitle>
            <CardDescription>For tracks you&apos;ve licensed elsewhere (stock-music subscription, a composer). The licence note is stored with the track for your records.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={uploadMusicAction} className="grid gap-3 md:grid-cols-2">
              <Field label="Pack">
                <Input name="pack" list="packs" required />
              </Field>
              <Field label="Title">
                <Input name="title" />
              </Field>
              <Field label="Audio file" className="md:col-span-2">
                <Input type="file" name="file" accept="audio/*" required />
              </Field>
              <Field label="Licence" className="md:col-span-2" hint="required — e.g. “Epidemic Sound Personal plan, track ES_1234, licensed for YouTube”">
                <Input name="license" required />
              </Field>
              <SubmitButton pendingText="Uploading…">
                <Upload /> Upload
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
      <datalist id="packs">
        {packs.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {[...byPack.entries()].map(([pack, list]) => (
        <Card key={pack}>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {pack}
              {channels
                .filter((c) => c.musicPack === pack)
                .map((c) => (
                  <Badge key={c.name} variant="outline">
                    {c.name}
                  </Badge>
                ))}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.map((t) => (
              <div key={t.id} className="grid items-center gap-2 rounded-md border p-2 md:grid-cols-[220px_1fr_auto]">
                <div>
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.source} · {t.durationSec.toFixed(0)}s {t.mood && `· ${t.mood}`}
                  </p>
                </div>
                <div className="space-y-1">
                  <audio controls preload="none" src={assetUrl(t.key)!} className="h-8 w-full" />
                  <p className="text-[11px] text-muted-foreground">{t.license}</p>
                </div>
                <ActionButton size="icon" variant="ghost" action={deleteMusicAction.bind(null, t.id)} confirm={`Delete “${t.title}”?`}>
                  <Trash2 />
                </ActionButton>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground">Folder packs under <code>assets/music/</code> ({packs.filter((p) => !byPack.has(p)).join(", ") || "none"}) are bundled placeholders.</p>
    </div>
  );
}
