import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Check, ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { prisma } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ActionButton, AutoRefresh, SubmitButton } from "@/components/client";
import { ThemeForm } from "@/components/theme-form";
import { PageHeader } from "@/components/page-header";
import { approveLocationAction, deleteLocationAction, generateLocationAction, saveLocationAction, saveStorylineAction, testStyleAction } from "@/app/actions";
import { assetUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ThemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const theme = await prisma.theme.findUnique({ where: { id }, include: { characters: { orderBy: { createdAt: "asc" } }, locations: { orderBy: { createdAt: "asc" } }, storyline: true, channel: true } });
  if (!theme) notFound();
  const sl = theme.storyline;
  const busy = ["queued", "running"].includes(theme.styleTestStatus) || theme.characters.some((c) => c.sheetStatus === "GENERATING");

  return (
    <div className="space-y-6">
      <AutoRefresh enabled={busy} ms={3000} />
      <PageHeader title={theme.name} description={`${theme.genre}${theme.channel ? ` · used by ${theme.channel.name}` : ""}`}>
        <Button asChild variant="outline">
          <Link href={`/themes/${theme.id}/memory`}>
            <BookOpen /> Story memory
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Art style &amp; rules</CardTitle>
          </CardHeader>
          <CardContent>
            <ThemeForm theme={theme} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Test style</CardTitle>
              <CardDescription>Generates 4 sample images with the saved art style prompt.</CardDescription>
            </div>
            <ActionButton action={testStyleAction.bind(null, theme.id)} disabled={busy}>
              <Sparkles /> Test style
            </ActionButton>
          </CardHeader>
          <CardContent>
            {theme.styleTestStatus.startsWith("error") && <p className="mb-2 text-sm text-destructive">{theme.styleTestStatus}</p>}
            {["queued", "running"].includes(theme.styleTestStatus) && <p className="mb-2 text-sm text-muted-foreground">Generating… (needs the worker running)</p>}
            <div className="grid grid-cols-2 gap-2">
              {theme.styleTestImages.map((k) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={k} src={assetUrl(k)!} alt="" className="aspect-video w-full rounded-md border object-cover" />
              ))}
              {!theme.styleTestImages.length && <p className="col-span-2 text-sm text-muted-foreground">No samples yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Characters</CardTitle>
            <CardDescription>Approved character sheets are sent as reference images with every shot — the key to consistency.</CardDescription>
          </div>
          <Button asChild size="sm">
            <Link href={`/themes/${theme.id}/characters/new`}>
              <Plus /> Add character
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {theme.characters.map((c) => (
            <Link key={c.id} href={`/themes/${theme.id}/characters/${c.id}`} className="overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
              <div className="aspect-video bg-muted">
                {(c.referenceImages[0] ?? c.pendingImages[0]) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(c.referenceImages[0] ?? c.pendingImages[0])!} alt={c.name} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="space-y-1 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{c.name}</span>
                  <Badge variant={c.sheetStatus === "APPROVED" ? "success" : c.sheetStatus === "PENDING_APPROVAL" ? "warning" : c.sheetStatus === "GENERATING" ? "running" : "muted"}>
                    {c.sheetStatus.replace("_", " ").toLowerCase()}
                  </Badge>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{c.role}</p>
                <p className="text-[11px] text-muted-foreground">
                  key <code>{c.key}</code> · voice {c.voiceSpeaker}
                </p>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
          <CardDescription>The reference plate is sent with every shot in that location.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {theme.locations.map((l) => (
            <div key={l.id} className="space-y-2 rounded-lg border p-3">
              <div className="grid grid-cols-2 gap-1">
                <div className="aspect-video overflow-hidden rounded bg-muted">
                  {l.referenceImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(l.referenceImage)!} alt={l.name} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="relative aspect-video overflow-hidden rounded bg-muted">
                  {l.pendingImage ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={assetUrl(l.pendingImage)!} alt="candidate" className="h-full w-full object-cover" />
                      <span className="absolute left-1 top-1 rounded bg-warning px-1 text-[9px] font-bold text-white">candidate</span>
                    </>
                  ) : (
                    <span className="grid h-full place-items-center text-[10px] text-muted-foreground">no candidate</span>
                  )}
                </div>
              </div>
              <form action={saveLocationAction} className="space-y-1.5">
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="themeId" value={theme.id} />
                <Input name="name" defaultValue={l.name} />
                <Textarea name="description" defaultValue={l.description} rows={3} className="text-xs" />
                <p className="text-[11px] text-muted-foreground">
                  key <code>{l.key}</code>
                </p>
                <div className="flex flex-wrap gap-1">
                  <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                  <ActionButton size="sm" variant="outline" action={generateLocationAction.bind(null, l.id)}>
                    <ImagePlus /> Generate
                  </ActionButton>
                  {l.pendingImage && (
                    <ActionButton size="sm" variant="success" action={approveLocationAction.bind(null, l.id)}>
                      <Check /> Approve
                    </ActionButton>
                  )}
                  <ActionButton size="sm" variant="ghost" action={deleteLocationAction.bind(null, theme.id, l.id)} confirm={`Delete ${l.name}?`}>
                    <Trash2 />
                  </ActionButton>
                </div>
              </form>
            </div>
          ))}
          <form action={saveLocationAction} className="space-y-1.5 rounded-lg border border-dashed p-3">
            <input type="hidden" name="themeId" value={theme.id} />
            <p className="text-sm font-medium">New location</p>
            <Input name="name" placeholder="Name (e.g. Village well)" required />
            <Input name="key" placeholder="key (optional, e.g. village_well)" />
            <Textarea name="description" placeholder="Visual description" rows={3} required />
            <SubmitButton size="sm">
              <Plus /> Add
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storyline bible</CardTitle>
          <CardDescription>
            Fed into every script. The rolling story memory is maintained automatically — <Link className="text-primary hover:underline" href={`/themes/${theme.id}/memory`}>view/edit it</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveStorylineAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="themeId" value={theme.id} />
            <Field label="Premise" className="md:col-span-2">
              <Textarea name="premise" rows={4} defaultValue={sl?.premise} />
            </Field>
            <Field label="World rules">
              <Textarea name="worldRules" rows={4} defaultValue={sl?.worldRules} />
            </Field>
            <Field label="Character arcs">
              <Textarea name="characterArcs" rows={4} defaultValue={sl?.characterArcs} />
            </Field>
            <Field label="Running gags">
              <Textarea name="runningGags" rows={3} defaultValue={sl?.runningGags} />
            </Field>
            <Field label="Forbidden topics">
              <Textarea name="forbiddenTopics" rows={3} defaultValue={sl?.forbiddenTopics} />
            </Field>
            <div>
              <SubmitButton pendingText="Saving…">Save storyline</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
