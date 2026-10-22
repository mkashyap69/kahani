import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Youtube } from "lucide-react";
import { musicPacks, prisma } from "@kahani/core";
import { ChannelForm } from "@/components/channel-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "@/components/client";
import { disconnectYoutubeAction, pushBrandingAction, runChannelNow, setChannelLogoAction } from "@/app/actions";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/client";
import { assetUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ChannelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ connected?: string; launched?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const channel = await prisma.channel.findUnique({ where: { id } });
  if (!channel) notFound();
  const themes = await prisma.theme.findMany({ include: { channel: { select: { id: true } } } });
  const cast = await prisma.character.findMany({ where: { themeId: channel.themeId }, select: { sheetStatus: true } });
  const pendingSheets = cast.filter((c) => c.sheetStatus !== "APPROVED").length;
  return (
    <div className="max-w-4xl space-y-6">
      {(sp.launched || (!channel.active && pendingSheets > 0)) && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle>Next steps to go live</CardTitle>
            <CardDescription>The channel was created paused so you can check the cast first.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>
                Approve the character sheets and location plates in{" "}
                <Link className="text-primary underline" href={`/themes/${channel.themeId}`}>
                  the theme
                </Link>{" "}
                ({pendingSheets} of {cast.length} characters still waiting — sheets are generated in the background).
              </li>
              <li>Connect YouTube below, then push the branding (description, keywords, banner, playlists). Upload the logo as the profile picture in YouTube Studio.</li>
              <li>Tick “Active” in the profile below and save — the daily schedule starts. Or press “Run now” for a first test episode.</li>
            </ol>
          </CardContent>
        </Card>
      )}
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
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Branding</CardTitle>
            <CardDescription>The logo also appears on the generated intro/outro cards.</CardDescription>
          </div>
          {channel.oauthTokensEnc && (
            <ActionButton variant="outline" action={pushBrandingAction.bind(null, channel.id)} confirm="Update the YouTube channel's description, keywords and banner, and create playlists?">
              <Youtube /> Push to YouTube
            </ActionButton>
          )}
        </CardHeader>
        <CardContent>
          <form action={setChannelLogoAction} className="space-y-4">
            <input type="hidden" name="channelId" value={channel.id} />
            <div className="grid gap-4 md:grid-cols-[160px_1fr]">
              <div className="space-y-2">
                <div className="h-36 w-36 overflow-hidden rounded-full border bg-muted">
                  {channel.logoKey && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(channel.logoKey)!} alt="logo" className="h-full w-full object-cover" />
                  )}
                </div>
                {channel.logoKey && (
                  <a href={assetUrl(channel.logoKey)!} download className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="h-3 w-3" /> logo (for YouTube Studio)
                  </a>
                )}
                <Input type="file" name="logo" accept="image/png,image/jpeg" />
              </div>
              <div className="space-y-2">
                {channel.bannerKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(channel.bannerKey)!} alt="banner" className="w-full rounded-md border" />
                ) : (
                  <div className="grid aspect-[16/9] place-items-center rounded-md bg-muted text-xs text-muted-foreground">no banner (2560×1440)</div>
                )}
                <Input type="file" name="banner" accept="image/jpeg,image/png" />
              </div>
            </div>
            <Field label="Channel description">
              <Textarea name="description" defaultValue={channel.description} rows={4} className="deva" />
            </Field>
            <Field label="Keywords" hint="comma separated">
              <Input name="keywords" defaultValue={channel.keywords.join(", ")} />
            </Field>
            <SubmitButton size="sm" variant="outline">
              Save branding
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
      <ChannelForm channel={channel} themes={themes.map((t) => ({ id: t.id, name: t.name, usedBy: t.channel?.id }))} musicPacks={await musicPacks()} />
    </div>
  );
}
