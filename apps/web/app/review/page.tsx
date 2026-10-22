import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { prisma } from "@kahani/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "@/components/client";
import { Empty, PageHeader } from "@/components/page-header";
import { approveAction, rejectAction } from "@/app/actions";
import { assetUrl, duration, inr } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ReviewQueue() {
  const items = await prisma.contentItem.findMany({ where: { status: "REVIEW" }, orderBy: { createdAt: "asc" }, include: { channel: { select: { name: true, madeForKids: true } } } });
  return (
    <div>
      <PageHeader title="Review queue" description="Finished videos from channels with auto-publish off. Approving uploads to YouTube at the scheduled time." />
      {items.length === 0 && <Empty>Nothing waiting for review 🎉</Empty>}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {items.map((i) => {
          const vertical = i.type === "SHORT";
          return (
            <Card key={i.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="deva text-base">
                  <Link href={`/content/${i.id}`} className="hover:underline">
                    {i.title}
                  </Link>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {i.channel.name} · {i.type === "STORY" ? `Episode ${i.episodeNumber}` : `Short ${i.slot}`} · {duration(i.durationSec)} · {inr(i.costInr)} ·{" "}
                  {i.scheduledPublishAt ? `publishes ${new Date(i.scheduledPublishAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : "publishes immediately"}
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                {i.videoKey && (
                  <video controls preload="none" poster={assetUrl(i.thumbnailKey) ?? undefined} src={assetUrl(i.videoKey)!} className={`rounded-md bg-black ${vertical ? "mx-auto h-80" : "w-full"}`} />
                )}
                <div className="mt-auto flex gap-2">
                  <ActionButton variant="success" action={approveAction.bind(null, i.id)}>
                    <CheckCircle2 /> Approve &amp; publish
                  </ActionButton>
                  <ActionButton variant="outline" action={rejectAction.bind(null, i.id, undefined)} confirm="Reject this video?">
                    <XCircle /> Reject
                  </ActionButton>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
