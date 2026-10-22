import Link from "next/link";
import { Play, Plus } from "lucide-react";
import { getSettings, localDate, prisma, providerSummary, spendThisMonth, spendToday } from "@kahani/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ActionButton, AutoRefresh } from "@/components/client";
import { ItemCard } from "@/components/item-card";
import { Empty, PageHeader, Stat } from "@/components/page-header";
import { runChannelNow } from "@/app/actions";
import { inr } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [channels, today, month, settings, providers, failures, reviewCount] = await Promise.all([
    prisma.channel.findMany({
      orderBy: { createdAt: "asc" },
      include: { theme: { select: { name: true } }, dailyRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { items: { orderBy: [{ type: "asc" }, { slot: "asc" }] } } } },
    }),
    spendToday(),
    spendThisMonth(),
    getSettings(),
    providerSummary(),
    prisma.contentItem.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 10 }),
    prisma.contentItem.count({ where: { status: "REVIEW" } }),
  ]);
  const inFlight = channels.some((c) => c.dailyRuns[0]?.items.some((i) => !["PUBLISHED", "FAILED", "REJECTED", "REVIEW"].includes(i.status)));
  const budgetPct = settings.monthlyBudgetInr > 0 ? Math.min(100, (month / settings.monthlyBudgetInr) * 100) : 0;

  return (
    <div className="space-y-6">
      <AutoRefresh enabled={inFlight} ms={4000} />
      <PageHeader title="Dashboard" description="Today's story + 2 shorts for every channel">
        <Badge variant="outline">LLM {providers.llm}</Badge>
        <Badge variant="outline">Image {providers.image}</Badge>
        <Badge variant="outline">TTS {providers.tts}</Badge>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Spend today" value={inr(today)} hint="estimated, all providers" />
        <Stat
          label="Spend this month"
          value={inr(month)}
          hint={
            settings.monthlyBudgetInr > 0 ? (
              <span className={budgetPct >= 100 ? "font-semibold text-destructive" : ""}>
                {budgetPct.toFixed(0)}% of {inr(settings.monthlyBudgetInr)} cap{budgetPct >= 100 ? " — generation paused" : ""}
              </span>
            ) : (
              "no budget cap set"
            )
          }
        />
        <Stat label="Waiting for review" value={<Link href="/review" className="hover:underline">{reviewCount}</Link>} />
        <Stat label="Failures" value={failures.length} hint={failures.length ? "retry from the cards below" : "all good"} />
      </div>

      {channels.length === 0 && (
        <Empty>
          No channels yet. <Link className="text-primary underline" href="/channels/new">Create one</Link> or run <code>npm run db:seed</code>.
        </Empty>
      )}

      {channels.map((c) => {
        const run = c.dailyRuns[0];
        const isToday = run?.runDate.slice(0, 10) === localDate(c.timezone);
        return (
          <Card key={c.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Link href={`/channels/${c.id}`} className="hover:underline">{c.name}</Link>
                  {!c.active && <Badge variant="muted">paused</Badge>}
                  {c.autoPublish ? <Badge variant="success">auto-publish</Badge> : <Badge variant="warning">review first</Badge>}
                  {!c.oauthTokensEnc && <Badge variant="muted">YouTube not connected</Badge>}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.theme.name} · generates daily at {c.generationTime} ({c.timezone}) · {run ? `${isToday ? "today's" : "last"} run: ${run.runDate.slice(0, 10)}` : "never run"}
                </p>
              </div>
              <ActionButton size="sm" action={runChannelNow.bind(null, c.id)} confirm={`Generate a new story + 2 shorts for ${c.name} now?`}>
                <Play /> Run now
              </ActionButton>
            </CardHeader>
            <CardContent>
              {run?.items.length ? (
                <div className="grid gap-3 lg:grid-cols-3">
                  {run.items.map((i) => (
                    <ItemCard key={i.id} item={i} />
                  ))}
                </div>
              ) : (
                <Empty>Nothing generated yet — the scheduler will run at {c.generationTime}, or press “Run now”.</Empty>
              )}
            </CardContent>
          </Card>
        );
      })}

      {failures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent failures</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-2">
            {failures.map((i) => (
              <ItemCard key={i.id} item={i} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/channels/new">
            <Plus /> New channel
          </Link>
        </Button>
      </div>
    </div>
  );
}
