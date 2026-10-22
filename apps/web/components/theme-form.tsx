import type { Theme } from "@kahani/core";
import { voiceCatalog } from "@kahani/core";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/client";
import { saveThemeAction } from "@/app/actions";

export function ThemeForm({ theme }: { theme?: Theme | null }) {
  const t = theme;
  return (
    <form action={saveThemeAction} className="space-y-4">
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <Input name="name" required defaultValue={t?.name} />
        </Field>
        <Field label="Genre" hint='e.g. "Panchatantra animal fables", "Bhoot-wala gaon"'>
          <Input name="genre" required defaultValue={t?.genre} />
        </Field>
      </div>
      <Field label="Art style prompt" hint="appended to EVERY image prompt">
        <Textarea name="artStylePrompt" required rows={3} defaultValue={t?.artStylePrompt ?? "2D Indian cartoon illustration, flat vibrant colours, bold clean outlines, soft cel shading, warm daylight, 16:9"} />
      </Field>
      <Field label="Negative style" hint="things the image model should avoid">
        <Textarea name="negativeStyle" rows={2} defaultValue={t?.negativeStyle} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tone">
          <Input name="tone" defaultValue={t?.tone} />
        </Field>
        <Field label="Target audience">
          <Input name="targetAudience" defaultValue={t?.targetAudience ?? "family"} />
        </Field>
      </div>
      <Field label="Content rules" hint="the safety check validates every script against these before images are generated">
        <Textarea name="contentRules" rows={3} defaultValue={t?.contentRules} />
      </Field>
      <Switch name="kidSafe" defaultChecked={t?.kidSafe} label="Strict kids profile" hint="enforces a strict kid-safe writing + review profile" />
      <fieldset className="grid gap-3 rounded-md border p-3 md:grid-cols-4">
        <legend className="px-1 text-sm font-medium">Narrator voice</legend>
        <Field label="Speaker">
          <Select name="narratorSpeaker" defaultValue={t?.narratorSpeaker ?? "vidya"}>
            {voiceCatalog().map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pitch">
          <Input type="number" step="0.05" min={-0.75} max={0.75} name="narratorPitch" defaultValue={t?.narratorPitch ?? 0} />
        </Field>
        <Field label="Pace">
          <Input type="number" step="0.05" min={0.3} max={3} name="narratorPace" defaultValue={t?.narratorPace ?? 1} />
        </Field>
        <Field label="Loudness">
          <Input type="number" step="0.1" min={0.3} max={3} name="narratorLoudness" defaultValue={t?.narratorLoudness ?? 1} />
        </Field>
      </fieldset>
      <SubmitButton pendingText="Saving…">{t ? "Save theme" : "Create theme"}</SubmitButton>
    </form>
  );
}
