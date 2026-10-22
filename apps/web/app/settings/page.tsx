import { getSettings, PRICING, providerSummary, secretStatus, SECRET_KEYS, spendThisMonth } from "@kahani/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/client";
import { PageHeader } from "@/components/page-header";
import { saveSettingsAction } from "@/app/actions";
import { inr } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  ANTHROPIC_API_KEY: "Anthropic (Claude — scripts, safety, memory)",
  GEMINI_API_KEY: "Google Gemini (Nano Banana images + vision check)",
  SARVAM_API_KEY: "Sarvam AI (Bulbul TTS)",
  FAL_KEY: "fal.ai (optional lip-sync)",
  ELEVENLABS_API_KEY: "ElevenLabs (Eleven Music — background music generation)",
  YOUTUBE_CLIENT_ID: "YouTube OAuth client ID",
  YOUTUBE_CLIENT_SECRET: "YouTube OAuth client secret",
};
const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-5-5"];

export default async function SettingsPage() {
  const [s, secrets, providers, month] = await Promise.all([getSettings(), secretStatus(), providerSummary(), spendThisMonth()]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" description={`Provider mode: ${providers.mode}. Missing keys fall back to free offline mocks (PROVIDER_MODE=auto).`} />
      <form action={saveSettingsAction} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>API keys</CardTitle>
            <CardDescription>Stored AES-256-GCM encrypted in the database (ENCRYPTION_KEY). Values are never shown again; leave blank to keep the current one.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {SECRET_KEYS.map((k) => (
              <div key={k} className="grid items-end gap-2 md:grid-cols-[1fr_auto]">
                <Field label={LABELS[k] ?? k}>
                  <Input type="password" name={`secret_${k}`} autoComplete="off" placeholder={secrets[k] ? "•••••••• (configured)" : "not set"} />
                </Field>
                <div className="flex items-center gap-3 pb-2">
                  {secrets[k] ? <Badge variant="success">{secrets[k] === "db" ? "stored" : "from env"}</Badge> : <Badge variant="muted">missing</Badge>}
                  {secrets[k] === "db" && (
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name={`clear_${k}`} /> remove
                    </label>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Generation</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="Script model">
              <Select name="anthropicModel" defaultValue={s.anthropicModel}>
                {[...new Set([s.anthropicModel, ...MODELS])].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Image concurrency">
              <Input type="number" min={1} name="imageConcurrency" defaultValue={s.imageConcurrency} />
            </Field>
            <Field label="TTS concurrency">
              <Input type="number" min={1} name="ttsConcurrency" defaultValue={s.ttsConcurrency} />
            </Field>
            <Field label="Motion (FFmpeg) concurrency">
              <Input type="number" min={1} name="motionConcurrency" defaultValue={s.motionConcurrency} />
            </Field>
            <Field label="Max shots per story" hint="cost guard (≤200)">
              <Input type="number" min={20} max={200} name="maxStoryShots" defaultValue={s.maxStoryShots} />
            </Field>
            <div />
            <div className="md:col-span-2">
              <Switch name="consistencyCheck" defaultChecked={s.consistencyCheck} label="Automatic consistency check" hint="a vision model scores each frame against the character sheets and regenerates below the threshold (max 2 retries)" />
            </div>
            <Field label="Consistency threshold (1–10)">
              <Input type="number" min={1} max={10} name="consistencyThreshold" defaultValue={s.consistencyThreshold} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Budget</CardTitle>
            <CardDescription>
              Month to date: {inr(month)}. When the cap is reached, the scheduler skips new runs and paid stages fail with “budget exceeded” (retry once you raise the cap).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Monthly budget cap (₹, 0 = no cap)">
              <Input type="number" min={0} step={100} name="monthlyBudgetInr" defaultValue={s.monthlyBudgetInr} className="w-48" />
            </Field>
            <p className="text-xs text-muted-foreground">
              Estimates used: Claude Sonnet 5.5 ${PRICING.anthropic["claude-sonnet-5-5"].join("/")} per 1M in/out tokens · Nano Banana ${PRICING.gemini.imageUsd}/image · Sarvam ₹
              {PRICING.sarvamInrPer10kChars}/10k chars · fal.ai lip-sync ${PRICING.falLipsyncUsdPerSec}/s (edit packages/core/src/cost.ts).
            </p>
          </CardContent>
        </Card>
        <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
      </form>
    </div>
  );
}
