import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@kahani/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, PageHeader } from "@/components/page-header";
import { assetUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Themes() {
  const themes = await prisma.theme.findMany({ orderBy: { createdAt: "asc" }, include: { channel: true, characters: true, locations: true, storyline: { select: { episodeCount: true } } } });
  return (
    <div>
      <PageHeader title="Themes" description="Art style, cast, locations and the series bible.">
        <Button asChild>
          <Link href="/themes/new">
            <Plus /> New theme
          </Link>
        </Button>
      </PageHeader>
      {themes.length === 0 && <Empty>No themes yet.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {themes.map((t) => (
          <Link key={t.id} href={`/themes/${t.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription>{t.genre}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex -space-x-3">
                  {t.characters.map((c) =>
                    c.referenceImages[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={c.id} src={assetUrl(c.referenceImages[0])!} alt={c.name} title={c.name} className="h-12 w-12 rounded-full border-2 border-card object-cover" />
                    ) : (
                      <span key={c.id} title={c.name} className="grid h-12 w-12 place-items-center rounded-full border-2 border-card bg-secondary text-sm font-bold">
                        {c.name[0]}
                      </span>
                    ),
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{t.characters.length} characters</Badge>
                  <Badge variant="secondary">{t.locations.length} locations</Badge>
                  <Badge variant="secondary">{t.storyline?.episodeCount ?? 0} episodes</Badge>
                  {t.kidSafe && <Badge variant="success">kid-safe</Badge>}
                  {t.channel ? <Badge variant="outline">{t.channel.name}</Badge> : <Badge variant="muted">no channel</Badge>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
