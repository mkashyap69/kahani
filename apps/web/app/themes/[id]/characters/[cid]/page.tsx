import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { prisma, voiceCatalog } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ActionButton, AutoRefresh, SubmitButton, VoicePreview } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { approveSheetAction, deleteCharacterAction, generateSheetAction, rejectSheetAction, saveCharacterAction } from "@/app/actions";
import { assetUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CharacterStudio({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id: themeId, cid } = await params;
  const theme = await prisma.theme.findUnique({ where: { id: themeId } });
  if (!theme) notFound();
  const c = cid === "new" ? null : await prisma.character.findUnique({ where: { id: cid } });
  if (cid !== "new" && !c) notFound();

  return (
    <div className="space-y-6">
      <AutoRefresh enabled={c?.sheetStatus === "GENERATING"} ms={3000} />
      <PageHeader
        title={c ? `Character Studio — ${c.name}` : "New character"}
        description={
          <Link href={`/themes/${themeId}`} className="hover:underline">
            ← {theme.name}
          </Link>
        }
      >
        {c && (
          <ActionButton variant="ghost" action={deleteCharacterAction.bind(null, themeId, c.id)} confirm={`Delete ${c.name}? Scripts that use "${c.key}" will fail validation.`}>
            <Trash2 /> Delete
          </ActionButton>
        )}
      </PageHeader>

      <form action={saveCharacterAction} className="grid gap-6 xl:grid-cols-2">
        <input type="hidden" name="themeId" value={themeId} />
        {c && <input type="hidden" name="id" value={c.id} />}
        <Card>
          <CardHeader>
            <CardTitle>Who they are</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Name" className="md:col-span-2">
                <Input name="name" required defaultValue={c?.name} />
              </Field>
              <Field label="Age">
                <Input type="number" name="age" defaultValue={c?.age ?? ""} />
              </Field>
            </div>
            {!c && (
              <Field label="Script key" hint="slug used in scripts, e.g. priya (defaults to the name)">
                <Input name="key" />
              </Field>
            )}
            <Field label="Role">
              <Input name="role" required defaultValue={c?.role} placeholder="city bahu who moved to the village" />
            </Field>
            <Field label="Personality">
              <Textarea name="personality" rows={2} required defaultValue={c?.personality} />
            </Field>
            <Field label="Speech style" hint={`e.g. "speaks Bhojpuri-tinged Hindi, says 'arre baap re' often"`}>
              <Textarea name="speechStyle" rows={2} required defaultValue={c?.speechStyle} />
            </Field>
            <Field label="Visual description" hint="fixed and very detailed: face, hair, outfit, colours, accessories — re-generate the sheet after changing it">
              <Textarea name="visualDescription" rows={5} required defaultValue={c?.visualDescription} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voice (Sarvam Bulbul)</CardTitle>
            <CardDescription>Preview uses the values in this form, even before saving.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Speaker">
              <Select name="voiceSpeaker" defaultValue={c?.voiceSpeaker ?? "anushka"}>
                {voiceCatalog().map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pitch" hint="−0.75 … 0.75">
                <Input type="number" step="0.05" min={-0.75} max={0.75} name="voicePitch" defaultValue={c?.voicePitch ?? 0} />
              </Field>
              <Field label="Pace" hint="0.3 … 3">
                <Input type="number" step="0.05" min={0.3} max={3} name="voicePace" defaultValue={c?.voicePace ?? 1} />
              </Field>
              <Field label="Loudness" hint="0.3 … 3">
                <Input type="number" step="0.1" min={0.3} max={3} name="voiceLoudness" defaultValue={c?.voiceLoudness ?? 1} />
              </Field>
            </div>
            <VoicePreview
              speaker={c?.voiceSpeaker ?? "anushka"}
              pitch={c?.voicePitch ?? 0}
              pace={c?.voicePace ?? 1}
              loudness={c?.voiceLoudness ?? 1}
              defaultText={c ? `नमस्ते! मैं ${c.name} हूँ। आज गाँव में कुछ नया होने वाला है।` : "नमस्ते! आज गाँव में कुछ नया होने वाला है।"}
            />
            <SubmitButton pendingText="Saving…">{c ? "Save character" : "Create character"}</SubmitButton>
          </CardContent>
        </Card>
      </form>

      {c && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                Character sheet
                <Badge variant={c.sheetStatus === "APPROVED" ? "success" : c.sheetStatus === "PENDING_APPROVAL" ? "warning" : c.sheetStatus === "GENERATING" ? "running" : "muted"}>
                  {c.sheetStatus.replace("_", " ").toLowerCase()}
                </Badge>
              </CardTitle>
              <CardDescription>Turnaround (front, ¾, full body) + 3 expressions, generated with Nano Banana. Approve to use as reference for every shot.</CardDescription>
            </div>
            <ActionButton action={generateSheetAction.bind(null, c.id)} disabled={c.sheetStatus === "GENERATING"}>
              {c.referenceImages.length ? <RefreshCw /> : <Sparkles />} {c.referenceImages.length ? "Regenerate" : "Generate sheet"}
            </ActionButton>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Approved (in use)</p>
              {c.referenceImages.length ? (
                c.referenceImages.map((k) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={k} src={assetUrl(k)!} alt="" className="w-full rounded-md border" />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">None yet — the pipeline will auto-generate one if needed.</p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Candidate</p>
              {c.sheetStatus === "GENERATING" && <p className="text-sm text-muted-foreground">Generating… (needs the worker running)</p>}
              {c.pendingImages.map((k) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={k} src={assetUrl(k)!} alt="" className="w-full rounded-md border-2 border-warning" />
              ))}
              {c.pendingImages.length > 0 && (
                <div className="flex gap-2">
                  <ActionButton variant="success" action={approveSheetAction.bind(null, c.id)}>
                    <Check /> Approve
                  </ActionButton>
                  <ActionButton variant="outline" action={rejectSheetAction.bind(null, c.id)}>
                    <X /> Discard
                  </ActionButton>
                </div>
              )}
              {!c.pendingImages.length && c.sheetStatus !== "GENERATING" && <p className="text-sm text-muted-foreground">No candidate waiting.</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
