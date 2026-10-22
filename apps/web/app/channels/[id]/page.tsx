import Link from "next/link";
import { notFound } from "next/navigation";
import { Youtube } from "lucide-react";
import { musicPacks, prisma } from "@kahani/core";
import { ChannelForm } from "@/components/channel-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "@/components/client";
import { disconnectYoutubeAction, runChannelNow } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ChannelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ connected?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const channel = await prisma.channel.findUnique({ where: { id } });
  if (!channel) notFound();
  const themes = await prisma.theme.findMany({ include: { channel: { select: { id: true } } } });
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={channel.name} description={<Link className="hover:underline" href={`/themes/${channel.themeId}`}>Edit theme, characters &amp; storyline →</Link>}>
        <ActionButton variant="outline" action={runChannelNow.bind(null, channel.id)} confirm="Generate a new story + 2 shorts now?">
          Run now
        </ActionButton>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-600" /> YouTube
          </CardTitle>
          <CardDescription>
            {channel.oauthTokensEnc
              ? `Connected${channel.youtubeChannelId ? ` to channel ${channel.youtubeChannelId}` : ""}. Tokens are stored encrypted.`
              : "Not connected — published videos go to data/published/ (mock publisher)."}
            {sp.connected && " ✓ Connected successfully."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild variant={channel.oauthTokensEnc ? "outline" : "default"}>
            <a href={`/api/youtube/connect?channelId=${channel.id}`}>{channel.oauthTokensEnc ? "Reconnect" : "Connect YouTube"}</a>
          </Button>
          {channel.oauthTokensEnc && (
            <ActionButton variant="ghost" action={disconnectYoutubeAction.bind(null, channel.id)} confirm="Disconnect YouTube?">
              Disconnect
            </ActionButton>
          )}
        </CardContent>
      </Card>
      <ChannelForm channel={channel} themes={themes.map((t) => ({ id: t.id, name: t.name, usedBy: t.channel?.id }))} musicPacks={await musicPacks()} />
    </div>
  );
}
