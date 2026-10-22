import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { prisma } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ActionButton, SubmitButton } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { addDirectiveAction, deleteDirectiveAction, saveMemoryAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function MemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const theme = await prisma.theme.findUnique({
    where: { id },
    include: { storyline: { include: { directives: { orderBy: { createdAt: "desc" }, take: 30 } } } },
  });
  if (!theme?.storyline) notFound();
  const sl = theme.storyline;
  const tokens = Math.ceil(sl.storyMemory.length / 4);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Story memory"
        description={
          <Link href={`/themes/${id}`} className="hover:underline">
            ← {theme.name}
          </Link>
        }
      >
        <Badge variant="secondary">{sl.episodeCount} episodes published</Badge>
        <Badge variant={tokens > 3000 ? "warning" : "secondary"}>~{tokens} tokens {tokens > 3000 ? "(will compress)" : ""}</Badge>
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Rolling memory</CardTitle>
            <CardDescription>Appended automatically after every publish and compressed with the LLM above ~3k tokens. Fed into every script so the series never contradicts itself or repeats a plot.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveMemoryAction} className="space-y-4">
              <input type="hidden" name="themeId" value={id} />
              <Textarea name="storyMemory" rows={18} defaultValue={sl.storyMemory} className="font-mono text-xs" placeholder="(empty — first episode)" />
              <Field label="Open threads" hint="one per line">
                <Textarea name="openThreads" rows={6} defaultValue={sl.openThreads.join("\n")} />
              </Field>
              <Field label="Episode count">
                <Input type="number" name="episodeCount" defaultValue={sl.episodeCount} className="w-32" />
              </Field>
              <SubmitButton pendingText="Saving…">Save memory</SubmitButton>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>“Next episode should…”</CardTitle>
            <CardDescription>Producer directives. Pending ones are injected into the next story script, then marked used.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={addDirectiveAction} className="space-y-2">
              <input type="hidden" name="themeId" value={id} />
              <Textarea name="text" rows={3} placeholder="e.g. Reveal that Dadi was a kabaddi champion in her youth" required />
              <SubmitButton size="sm">Add directive</SubmitButton>
            </form>
            <ul className="space-y-2">
              {sl.directives.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
                  <span className={d.consumedAt ? "text-muted-foreground line-through" : ""}>
                    {d.text}
                    {d.consumedById && (
                      <Link href={`/content/${d.consumedById}`} className="ml-2 text-xs text-primary no-underline hover:underline">
                        used →
                      </Link>
                    )}
                  </span>
                  {!d.consumedAt && (
                    <ActionButton size="icon" variant="ghost" action={deleteDirectiveAction.bind(null, id, d.id)}>
                      <Trash2 />
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
