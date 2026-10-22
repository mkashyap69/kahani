import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@kahani/core";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Empty, PageHeader } from "@/components/page-header";
import { inr } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Channels() {
  const channels = await prisma.channel.findMany({ orderBy: { createdAt: "asc" }, include: { theme: { select: { name: true, id: true } }, _count: { select: { content: true } } } });
  const costs = await prisma.contentItem.groupBy({ by: ["channelId"], _sum: { costInr: true } });
  return (
    <div>
      <PageHeader title="Channels" description="Each channel has exactly one theme and its own schedule.">
        <Button asChild>
          <Link href="/channels/new">
            <Plus /> New channel
          </Link>
        </Button>
      </PageHeader>
      {channels.length === 0 ? (
        <Empty>No channels yet.</Empty>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Theme</TH>
                  <TH>Schedule</TH>
                  <TH>YouTube</TH>
                  <TH>Publishing</TH>
                  <TH className="text-right">Items</TH>
                  <TH className="text-right">Spend</TH>
                </TR>
              </THead>
              <TBody>
                {channels.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/channels/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {!c.active && <Badge variant="muted" className="ml-2">paused</Badge>}
                    </TD>
                    <TD>
                      <Link href={`/themes/${c.theme.id}`} className="hover:underline">
                        {c.theme.name}
                      </Link>
                    </TD>
                    <TD className="text-xs">
                      gen {c.generationTime} · story {c.storyPublishTime} · shorts {c.shortPublishTimes.join(", ")} <span className="text-muted-foreground">({c.timezone})</span>
                    </TD>
                    <TD>{c.oauthTokensEnc ? <Badge variant="success">connected</Badge> : <Badge variant="muted">not connected</Badge>}</TD>
                    <TD>{c.autoPublish ? <Badge variant="success">auto</Badge> : <Badge variant="warning">review</Badge>}</TD>
                    <TD className="text-right">{c._count.content}</TD>
                    <TD className="text-right">{inr(costs.find((x) => x.channelId === c.id)?._sum.costInr ?? 0)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
