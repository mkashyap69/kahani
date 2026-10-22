import Link from "next/link";
import { notFound } from "next/navigation";
import { config, imageModelInfo, prisma, type ComparisonResult } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton, AutoRefresh } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { applyImageModelAction } from "@/app/actions";
import { assetUrl, inr } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KINDS = [
  ["default", "all shots"],
  ["closeup", "close-ups"],
  ["wide", "wides"],
  ["thumbnail", "thumbnails"],
] as const;

export default async function ComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cmp = await prisma.imageComparison.findUnique({ where: { id } });
  if (!cmp) notFound();
  const item = await prisma.contentItem.findUnique({
    where: { id: cmp.contentItemId },
    include: { channel: true, shots: { where: { idx: { in: cmp.shotIdxs } }, orderBy: { idx: "asc" } } },
  });
  if (!item) notFound();
  const results = cmp.results as unknown as ComparisonResult[];
  const running = cmp.status === "queued" || cmp.status === "running";
  const vertical = item.type === "SHORT";
  const channelModels = (item.channel.imageModels ?? {}) as Record<string, string>;
  const storyShots = item.type === "STORY" ? 141 : 13;

  const summary = cmp.models.map((m) => {
    const rs = results.filter((r) => r.model === m);
    const ok = rs.filter((r) => !r.error);
    const info = imageModelInfo(m);
    return {
      model: m,
      info,
      done: rs.length,
      ok: ok.length,
      cost: rs.reduce((a, r) => a + r.costInr, 0),
      avgMs: ok.length ? ok.reduce((a, r) => a + r.ms, 0) / ok.length : 0,
      perVideo: info.usd * storyShots * config.usdToInr,
      perVideoBatch: info.batchUsd ? info.batchUsd * storyShots * config.usdToInr : null,
    };
  });

  return (
    <div className="space-y-6">
      <AutoRefresh enabled={running} ms={3000} />
      <PageHeader
        title="Model comparison"
        description={
          <span>
            <Link href="/compare" className="hover:underline">← Image models</Link> · {item.channel.name} ·{" "}
            <Link href={`/content/${item.id}`} className="deva hover:underline">{item.title}</Link> · {cmp.shotIdxs.length} shots
          </span>
        }
      >
        <Badge variant={cmp.status === "done" ? "success" : cmp.status === "failed" ? "destructive" : "running"}>{cmp.status}</Badge>
      </PageHeader>
      {cmp.error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{cmp.error}</p>}

      <div className={`grid gap-3 ${cmp.models.length > 3 ? "lg:grid-cols-4" : cmp.models.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {summary.map((s) => (
          <Card key={s.model}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{s.info.label}</CardTitle>
              <CardDescription>{s.info.notes}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {s.ok}/{cmp.shotIdxs.length} images · avg {(s.avgMs / 1000).toFixed(1)}s · this test {inr(s.cost)}
              </p>
              <p className="text-muted-foreground">
                ≈ {inr(s.perVideo)} per {item.type === "STORY" ? "10-min story" : "short"} (~{storyShots} images)
                {s.perVideoBatch != null && <> · {inr(s.perVideoBatch)} with batch</>}
              </p>
              <div className="flex flex-wrap gap-1">
                {KINDS.map(([kind, label]) =>
                  channelModels[kind] === s.model ? (
                    <Badge key={kind} variant="success">
                      used for {label}
                    </Badge>
                  ) : (
                    <ActionButton key={kind} size="sm" variant="outline" action={applyImageModelAction.bind(null, item.channelId, kind, s.model, cmp.id)}>
                      Use for {label}
                    </ActionButton>
                  ),
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shots</CardTitle>
          <CardDescription>Same prompt and reference sheets for every model. Costs are list-price estimates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {item.shots.map((shot) => (
            <div key={shot.idx} className="space-y-2">
              <p className="text-sm">
                <b>#{shot.idx}</b> <Badge variant="outline">{shot.framing}</Badge> <Badge variant="outline">{shot.location}</Badge>{" "}
                <span className="text-muted-foreground">{shot.charactersInFrame.join(", ")} — {shot.action}</span>
              </p>
              <div className={`grid gap-2 ${vertical ? "grid-cols-2 md:grid-cols-4" : cmp.models.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                {cmp.models.map((m) => {
                  const r = results.find((x) => x.model === m && x.idx === shot.idx);
                  return (
                    <figure key={m} className="space-y-1">
                      <div className={`overflow-hidden rounded-md border bg-muted ${vertical ? "aspect-[9/16]" : "aspect-video"}`}>
                        {r?.key ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a href={assetUrl(r.key)!} target="_blank"><img src={assetUrl(r.key)!} alt="" className="h-full w-full object-cover" /></a>
                        ) : (
                          <span className="grid h-full place-items-center p-2 text-center text-xs text-muted-foreground">{r?.error ?? (running ? "generating…" : "—")}</span>
                        )}
                      </div>
                      <figcaption className="text-[11px] text-muted-foreground">
                        {imageModelInfo(m).label}
                        {r && !r.error && ` · ${(r.ms / 1000).toFixed(1)}s · ${inr(r.costInr)}`}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
