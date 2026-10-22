import Link from "next/link";
import { Rocket } from "lucide-react";
import { prisma, providerSummary } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Switch, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { createKitAction } from "@/app/actions";
import { assetUrl, inr, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

const IDEAS = ["Panchatantra animal fables for kids 4–8", "Bhoot-wala gaon: spooky comedy mysteries for teens", "Saas-bahu village comedy in a Rajasthani haveli", "Mythology-inspired moral stories for kids", "Small-town school friends' adventures in Bihar"];

export default async function LaunchKits() {
  const [kits, providers] = await Promise.all([prisma.launchKit.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { channel: { select: { id: true, name: true } } } }), providerSummary()]);
  const live = !providers.llm.startsWith("mock");
  return (
    <div className="space-y-6">
      <PageHeader title="Channel launch kit" description="Describe a channel in one line. Kahani Studio researches the niche on the web, then designs the series, cast, voices, locations, branding and music for you to review." />
      {!live && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          No Anthropic key configured — kits use an offline template instead of live web research. Add <code>ANTHROPIC_API_KEY</code> in Settings for real research and writing.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" /> New channel
          </CardTitle>
          <CardDescription>Takes a few minutes (research with web search → writing → web-checked review → logo/banner → music). Keep the worker running.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createKitAction} className="grid gap-4 md:grid-cols-2">
            <Field label="Channel idea" className="md:col-span-2" hint={`e.g. ${IDEAS.join(" · ")}`}>
              <Textarea name="idea" required rows={2} placeholder="What is the channel about?" />
            </Field>
            <Field label="Target audience" hint="optional — the research will refine it">
              <Input name="audience" placeholder="e.g. kids 4–8 and parents in Hindi-speaking states" />
            </Field>
            <Field label="Language">
              <Input name="language" defaultValue="hi-IN" />
            </Field>
            <Field label="Notes / constraints" className="md:col-span-2" hint="anything the kit must respect: region, dialect, tone, things to avoid, reference channels you like">
              <Textarea name="notes" rows={2} />
            </Field>
            <Switch name="kidSafe" label="Kids channel" hint="made-for-kids + strict kid-safe content rules" />
            <div className="md:text-right">
              <SubmitButton pendingText="Starting…">
                <Rocket /> Research &amp; generate
              </SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {kits.map((k) => {
          const kit = k.kit as { channel?: { nameOptions?: { name: string }[] } } | null;
          return (
            <Link key={k.id} href={`/launch/${k.id}`} className="flex gap-3 rounded-lg border bg-card p-3 transition-shadow hover:shadow-md">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
                {k.logoKey && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(k.logoKey)!} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <p className="truncate font-semibold">{kit?.channel?.nameOptions?.[k.chosenName]?.name ?? k.idea}</p>
                <p className="truncate text-xs text-muted-foreground">{k.idea}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant={k.status === "READY" ? "warning" : k.status === "APPLIED" ? "success" : k.status === "FAILED" ? "destructive" : "running"}>{k.status.toLowerCase()}</Badge>
                  <span className="text-muted-foreground">{inr(k.costInr)}</span>
                  <span className="text-muted-foreground">{timeAgo(k.createdAt)}</span>
                  {k.channel && <span className="text-success">→ {k.channel.name}</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
