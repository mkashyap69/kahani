import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { IMAGE_MODELS, VIDEO_MODELS, prisma, secretStatus, videoUsdPerSec } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createComparisonAction } from "@/app/actions";
import { inr, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const video = (await searchParams).kind === "video";
  const [items, comparisons, secrets] = await Promise.all([
    prisma.contentItem.findMany({
      where: { shots: { some: video ? { imageKey: { not: null } } : {} } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, title: true, type: true, episodeNumber: true, slot: true, channel: { select: { name: true } }, _count: { select: { shots: true } } },
    }),
    prisma.imageComparison.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    secretStatus(),
  ]);
  const titles = new Map(items.map((i) => [i.id, i.title]));
  return (
    <div className="space-y-6">
      <PageHeader title="Model comparison" description="Run the same shots through different models and compare quality, consistency, cost and speed side by side.">
        <div className="flex rounded-md border p-0.5 text-sm">
          <Link href="/compare" className={`rounded px-3 py-1 ${video ? "text-muted-foreground" : "bg-primary text-primary-foreground"}`}>Images</Link>
          <Link href="/compare?kind=video" className={`rounded px-3 py-1 ${video ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Animation</Link>
        </div>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" /> New comparison
          </CardTitle>
          <CardDescription className="space-x-1">
            {(video
              ? ([["FAL_KEY", "FLUX 3 Max"], ["BYTEPLUS_ARK_API_KEY", "Seedance"], ["DASHSCOPE_API_KEY", "Wan"], ["EVOLINK_API_KEY", "EvoLink"], ["APIMART_API_KEY", "APIMart"]] as const)
              : ([["GEMINI_API_KEY", "Nano Banana"], ["FAL_KEY", "fal models"], ["BYTEPLUS_ARK_API_KEY", "Seedream (BytePlus)"], ["APIMART_API_KEY", "APIMart"], ["EVOLINK_API_KEY", "EvoLink"]] as const)
            ).map(([k, label]) => (
              <span key={k}>
                {label}: <code>{k}</code> {secrets[k] ? <Badge variant="success">set</Badge> : <Badge variant="muted">missing</Badge>}
              </span>
            ))}
            <span className="block pt-1">{video ? "Without a key, that model's column shows a free Ken Burns placeholder, marked as such." : "Missing keys use tinted offline placeholders, so you can try the page for free."}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createComparisonAction} className="space-y-4">
            <input type="hidden" name="kind" value={video ? "video" : "image"} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Episode / short to sample shots from">
                <Select name="itemId" required>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.channel.name} — {i.type === "STORY" ? `Ep ${i.episodeNumber ?? ""}` : `Short ${i.slot}`} — {i.title ?? "untitled"} ({i._count.shots} shots)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Shot numbers (optional)" hint={video ? "up to 5 — blank picks dialogue close-ups that already have images" : "up to 10, e.g. 1, 4, 9 — blank picks 10 varied shots automatically"}>
                <Input name="shots" placeholder="auto" />
              </Field>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Models (2–4)</legend>
              <div className="grid gap-2 md:grid-cols-2">
                {video
                  ? VIDEO_MODELS.map((m) => (
                      <label key={m.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                        <input type="checkbox" name="models" value={m.id} defaultChecked={["i2v:seedance-1.5-pro-720p", "i2v:wan-2.6-flash-720p", "i2v:flux-3-max"].includes(m.id)} className="mt-1" />
                        <span>
                          <b>{m.label}</b> <span className="text-muted-foreground">· ${videoUsdPerSec(m).toFixed(4)}/s, min {m.minSec}s billed</span>
                          <span className="block text-xs text-muted-foreground">{m.notes}</span>
                        </span>
                      </label>
                    ))
                  : IMAGE_MODELS.map((m, i) => (
                      <label key={m.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                        <input type="checkbox" name="models" value={m.id} defaultChecked={i === 0 || m.id === "fal:seedream-4.5" || m.id === "fal:flux-2-klein-4b"} className="mt-1" />
                        <span>
                          <b>{m.label}</b>{" "}
                          <span className="text-muted-foreground">
                            · ${m.usd}/image{m.usdPerRef ? ` + $${m.usdPerRef}/reference` : ""}
                            {m.batchUsd ? ` ($${m.batchUsd} batch)` : ""}
                          </span>
                          <span className="block text-xs text-muted-foreground">{m.notes}</span>
                        </span>
                      </label>
                    ))}
              </div>
            </fieldset>
            <SubmitButton pendingText="Starting…">Run comparison</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {comparisons.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Source</TH>
                  <TH>Models</TH>
                  <TH>Shots</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Est. cost</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {comparisons.map((c) => {
                  const res = c.results as { costInr: number }[];
                  return (
                    <TR key={c.id}>
                      <TD>{c.kind === "video" ? "Animation" : "Images"}</TD>
                      <TD>
                        <Link href={`/compare/${c.id}`} className="deva font-medium hover:underline">
                          {titles.get(c.contentItemId) ?? c.contentItemId}
                        </Link>
                      </TD>
                      <TD className="text-xs">{c.models.join(" · ")}</TD>
                      <TD>{c.shotIdxs.length}</TD>
                      <TD>
                        <Badge variant={c.status === "done" ? "success" : c.status === "failed" ? "destructive" : "running"}>{c.status}</Badge>
                      </TD>
                      <TD className="text-right">{inr(res.reduce((a, r) => a + r.costInr, 0))}</TD>
                      <TD className="text-xs text-muted-foreground">{timeAgo(c.createdAt)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
