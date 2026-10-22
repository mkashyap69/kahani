import Link from "next/link";
import { prisma, type ContentStatus } from "@kahani/core";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/status";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { duration, inr, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUSES: ContentStatus[] = ["QUEUED", "SCRIPTING", "SCRIPT_READY", "IMAGING", "IMAGES_READY", "VOICING", "ANIMATING", "ASSEMBLING", "REVIEW", "PUBLISHING", "PUBLISHED", "FAILED", "REJECTED"];

export default async function ContentList({ searchParams }: { searchParams: Promise<{ status?: string; channel?: string; type?: string }> }) {
  const sp = await searchParams;
  const where = {
    ...(sp.status ? { status: sp.status as ContentStatus } : {}),
    ...(sp.channel ? { channelId: sp.channel } : {}),
    ...(sp.type === "STORY" || sp.type === "SHORT" ? { type: sp.type as "STORY" | "SHORT" } : {}),
  };
  const [items, channels] = await Promise.all([
    prisma.contentItem.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { channel: { select: { name: true } } } }),
    prisma.channel.findMany({ select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <PageHeader title="All content" description={`${items.length} item(s)`}>
        <form className="flex gap-2">
          <Select name="channel" defaultValue={sp.channel ?? ""} className="w-44">
            <option value="">All channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select name="type" defaultValue={sp.type ?? ""} className="w-28">
            <option value="">All types</option>
            <option>STORY</option>
            <option>SHORT</option>
          </Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="w-36">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Button type="submit" variant="outline">Filter</Button>
        </form>
      </PageHeader>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Channel</TH>
                <TH>Type</TH>
                <TH>Status</TH>
                <TH className="text-right">Length</TH>
                <TH className="text-right">Cost</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="max-w-xs">
                    <Link href={`/content/${i.id}`} className="deva block truncate font-medium hover:underline">
                      {i.title ?? "Untitled"}
                    </Link>
                  </TD>
                  <TD>{i.channel.name}</TD>
                  <TD>{i.type === "STORY" ? `Story${i.episodeNumber ? ` #${i.episodeNumber}` : ""}` : `Short ${i.slot}`}</TD>
                  <TD>
                    <StatusBadge status={i.status} />
                  </TD>
                  <TD className="text-right">{duration(i.durationSec)}</TD>
                  <TD className="text-right">{inr(i.costInr)}</TD>
                  <TD className="text-xs text-muted-foreground">{timeAgo(i.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
