import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { IMAGE_MODELS, prisma, secretStatus } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createComparisonAction } from "@/app/actions";
import { inr, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const [items, comparisons, secrets] = await Promise.all([
    prisma.contentItem.findMany({
      where: { shots: { some: {} } },
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
      <PageHeader title="Image models" description="Generate the same shots with different models (same prompts and character sheets) and compare quality, consistency, cost and speed side by side." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" /> New comparison
          </CardTitle>
          <CardDescription>
            Gemini models need <code>GEMINI_API_KEY</code> {secrets.GEMINI_API_KEY ? <Badge variant="success">set</Badge> : <Badge variant="muted">missing</Badge>}; Seedream / FLUX.2 / Qwen need <code>FAL_KEY</code>{" "}
            {secrets.FAL_KEY ? <Badge variant="success">set</Badge> : <Badge variant="muted">missing</Badge>}. Missing keys use tinted offline placeholders, so you can try the page for free.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createComparisonAction} className="space-y-4">
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
              <Field label="Shot numbers (optional)" hint="up to 10, e.g. 1, 4, 9 — blank picks 10 varied shots automatically">
                <Input name="shots" placeholder="auto" />
              </Field>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Models (2–4)</legend>
              <div className="grid gap-2 md:grid-cols-2">
                {IMAGE_MODELS.map((m, i) => (
                  <label key={m.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                    <input type="checkbox" name="models" value={m.id} defaultChecked={i === 0 || m.id === "fal:seedream-4.5" || m.id === "fal:qwen-image-edit-2511"} className="mt-1" />
                    <span>
                      <b>{m.label}</b> <span className="text-muted-foreground">· ${m.usd}/image{m.batchUsd ? ` ($${m.batchUsd} batch)` : ""}</span>
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
