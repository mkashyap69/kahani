import { musicPacks, prisma } from "@kahani/core";
import { ChannelForm } from "@/components/channel-form";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function NewChannel() {
  const themes = await prisma.theme.findMany({ include: { channel: { select: { id: true } } } });
  return (
    <div className="max-w-4xl">
      <PageHeader title="New channel" description="Create a theme first if you need a new art style / cast." />
      <ChannelForm themes={themes.map((t) => ({ id: t.id, name: t.name, usedBy: t.channel?.id }))} musicPacks={await musicPacks()} />
    </div>
  );
}
