# Kahani Studio — automated Hindi story video factory

Kahani Studio generates **Hindi 2D-cartoon story videos for multiple YouTube channels every day**:
one 8–15 minute story episode (16:9, 1920×1080) and two 30–58 second Shorts (9:16, 1080×1920)
per channel, written to continue a running series.

```
Channel → Theme → (Characters + voices, Locations, Storyline bible) → Episodes / Shorts
```

Each video goes through these stages:

```
script (Claude) ─▶ safety check ─▶ images (Nano Banana) ─▶ voices (Sarvam Bulbul) ─▶ motion (Ken Burns / lip-sync)
   ─▶ assembly (FFmpeg: crossfades, ducked music, SFX, Hindi subtitles, intro/outro) ─▶ review ─▶ YouTube upload ─▶ story memory
```

To start a new channel, the **Launch Kit** takes a one-line idea, researches the niche on the live web, and designs the channel:
name options, branding, series bible, cast with voices, locations and background music. You review it and create the channel with one click.

You can re-run any stage, and every stage can resume where it stopped. Each shot asset (image, voice line, clip) is keyed by a hash of
its inputs. Retrying a stage only regenerates the shots that are missing or whose inputs changed. If
Sarvam fails on shot 87, the retry only re-voices shot 87.

---

## Repository layout

```
apps/
  web/        Next.js 15 (App Router) + Tailwind + shadcn-style UI
  worker/     BullMQ workers, per-timezone daily scheduler, `npm run demo`
packages/
  core/       Domain model, Prisma schema + migrations, provider adapters, prompts,
              FFmpeg media toolkit, pipeline stages, queue helpers, tests
assets/
  fonts/      Baloo 2 + Noto Sans Devanagari (OFL) for subtitles/thumbnails
  music/      background music packs (one folder per pack)
  sfx/        tagged SFX library (library.json)
scripts/
  generate-assets.ts   regenerates the placeholder music/SFX with FFmpeg
docker-compose.yml     Postgres + Redis + MinIO + migrate/seed + web + worker
```

### Key modules (`packages/core/src`)

| Area | Files |
|---|---|
| Domain | `domain/script.ts` (Zod script schema + validation), `domain/status.ts` (status machine), `domain/duration.ts` |
| Providers (swappable adapters) | `providers/types.ts` → `LLMProvider`, `ImageProvider`, `VisionJudge`, `TTSProvider`, `MotionProvider`, `Publisher` |
| Real providers | `anthropic.ts` (Claude, streaming + refusal fallbacks), `gemini.ts` (Nano Banana + vision judge), `sarvam.ts` (Bulbul), `motion.ts` (Ken Burns, fal.ai lip-sync), `youtube.ts` (resumable upload) |
| Offline mocks | `providers/mock/*`: free, deterministic stand-ins so the whole pipeline runs without keys |
| Pipeline | `pipeline/script.ts`, `images.ts`, `voices.ts`, `motion.ts`, `assemble.ts`, `publish.ts`, `memory.ts`, `runner.ts`, `daily.ts`, `actions.ts` |
| Media | `media/assemble.ts` (scene grouping, crossfades, mixing), `subtitles.ts` (ASS), `cards.ts` (intro/outro), `ffmpeg.ts`, `wav.ts`, `library.ts` |
| Infra | `queue.ts` (BullMQ), `storage/` (local or S3/R2/MinIO), `cost.ts` (INR cost log + budget), `settings.ts` (encrypted keys) |

---

## Quick start (local, no API keys needed)

Requirements: Node 20+, FFmpeg (with libass, i.e. any distro build), PostgreSQL 14+, Redis 6+.

```bash
cp .env.example .env            # defaults work for a local Postgres/Redis
npm install
npm run db:deploy               # apply migrations (use db:migrate while developing)
npm run db:seed                 # demo channel "Gaon Ki Kahaniyan"
npm run demo                    # full pipeline in-process → data/demo/*.mp4
```

Without API keys, `PROVIDER_MODE=auto` uses the offline mocks. These are a template script writer,
flat cartoon placeholder frames, a synthetic "babble" voice, and a local publisher that writes to `data/published/`.
The demo still runs the real FFmpeg path end to end (Ken Burns, crossfades, ducking, SFX, subtitles, intro/outro, thumbnails)
and finishes in about 2 minutes. Add keys and the same command produces the real thing.

```bash
npm run demo -- --full          # real targets: 8–15 min story with 120–200 shots
npm run demo -- --no-publish    # stop in the review queue
npm run demo -- --only=story    # skip the two shorts
```

Then run the app:

```bash
npm run worker                  # terminal 1: pipeline + studio workers, registers daily schedules
npm run dev:web                 # terminal 2: http://localhost:3000
```

### With Docker

```bash
cp .env.example .env            # add keys (optional)
docker compose up --build       # web on :3000, MinIO console on :9001
```

The `migrate` service applies migrations and seeds the demo channel. Assets are stored in MinIO (`STORAGE_DRIVER=s3`).

---

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for BullMQ queues/schedulers |
| `ENCRYPTION_KEY` | ≥16-char secret. AES-256-GCM encryption of OAuth tokens and API keys stored in the DB |
| `APP_URL` | Public URL of the web app (YouTube OAuth redirect is `${APP_URL}/api/youtube/callback`) |
| `STORAGE_DRIVER` | `local` (default, `./data/storage`) or `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Any S3-compatible store (AWS S3, Cloudflare R2, MinIO) |
| `PROVIDER_MODE` | `auto` (real provider when a key exists, else mock), `mock`, or `live` (fail if a key is missing) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude for scripts/safety/memory. Default `claude-sonnet-5-5` (also changeable in Settings). `ANTHROPIC_FALLBACKS=off` disables server-side refusal fallbacks |
| `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`, `GEMINI_VISION_MODEL` | Nano Banana (`gemini-2.5-flash-image`) and the consistency judge (`gemini-2.5-flash`) |
| `SARVAM_API_KEY`, `SARVAM_TTS_MODEL` | Sarvam Bulbul TTS. `bulbul:v2` (default) has 7 voices with pitch/pace/loudness; `bulbul:v3` has about 37 voices (pace only). Voice pickers and the launch-kit caster follow this setting |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MUSIC_MODEL` | Background music generation with ElevenLabs Eleven Music (default model `music_v1`). Without a key, music is a synthesised placeholder |
| `FAL_KEY`, `FAL_LIPSYNC_MODEL` | fal.ai: Seedream 4.5, FLUX.2 [pro] and Qwen Image Edit image models, plus optional lip-sync for close-up dialogue shots (default `veed/fabric-1.0`) |
| `IMAGE_BATCH_POLL_SEC`, `IMAGE_BATCH_MAX_HOURS` | Gemini batch mode: how often the worker checks a batch (default 120s), and after how many hours to cancel it and use standard calls (default 20) |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Google OAuth client (YouTube Data API v3) |
| `IMAGE_CONCURRENCY`, `TTS_CONCURRENCY`, `MOTION_CONCURRENCY` | Defaults for the per-stage limits (editable in Settings) |
| `PIPELINE_CONCURRENCY` | How many items the worker processes in parallel (default 3) |
| `FFMPEG_PRESET` | x264 preset (`veryfast` default; `medium` for smaller files) |
| `USD_TO_INR` | FX rate used by cost estimates (default 88) |
| `KAHANI_QUICK` | `1` shrinks targets for fast demos (set automatically by `npm run demo`) |

You can also enter API keys in **Settings**. They are stored encrypted, and DB values take precedence over env vars.

---

## The daily job

- When the worker starts, it calls `syncSchedules()`. This creates one BullMQ job scheduler per active channel
  (`cron "mm HH * * *"` in the **channel's timezone**, from its *daily generation time*). Saving a channel in the UI re-syncs the schedulers.
  `npm run scheduler` re-syncs manually, and `npm run scheduler -- --now` triggers today's run for every channel.
- `createDailyRun(channel)` is idempotent per `(channel, local date)` through the `DailyRun` table. It creates:
  - one **STORY** item (next episode number, scheduled for the channel's story publish time),
  - two **SHORT** items, each either a **TEASER** of today's story or a self-contained **MINI_STORY** (per channel).
    Teaser scripts are written right after the story script is ready.
- The **Run now** button on the dashboard forces an extra run.
- When the month-to-date spend reaches the **monthly budget cap**, the scheduler skips new runs and paid stages fail with
  "budget exceeded". Raise the cap and press **Retry stage**.

### Status machine

`QUEUED → SCRIPTING → SCRIPT_READY → IMAGING → IMAGES_READY → VOICING → ANIMATING → ASSEMBLING → REVIEW → PUBLISHING → PUBLISHED`,
plus `FAILED` (with `failedStage` + `error`) and `REJECTED`.
BullMQ retries a stage 3 times with exponential backoff. Provider calls also retry inside the stage with jittered backoff.
If a channel has `auto_publish` on, items go from assembly straight to publishing. Otherwise they wait in the **Review Queue**.

---

## Pipeline details

**1. Script (Claude).**
The prompt includes the theme, series bible, rolling `story_memory`, open threads, producer directives ("next episode should…"),
characters with personality and speech style, locations, and the target length. The output must be strict JSON, which is validated with Zod
(`domain/script.ts`). Validation checks:
- framing, Devanagari dialogue, and ~20-word lines,
- speaker/dialogue consistency, and that every character and location key exists in the theme,
- shot count, and estimated runtime.

When validation fails, the errors go back to the model and it retries, up to 3 attempts.
A separate **content-safety pass** checks the script against the theme's `content_rules`, with a strict profile for kid themes.
If the check fails, the script is regenerated once with the issues; if it fails again, the item fails before any images are paid for.

**2. Images (Nano Banana).**
Each shot sends the approved character-sheet images of everyone in frame plus the location plate, with this prompt:
`art_style_prompt + framing + location + characters' visual_description + action + emotion + time_of_day`.
The aspect ratio is 16:9 for stories and 9:16 for Shorts.
- Requests are concurrency-limited and retried.
- Results are cached by prompt hash in `AssetCache`.
- An optional vision-LLM **consistency check** scores each frame 1–10 and regenerates below the threshold (max 2 retries).

The **thumbnail** is a bold close-up of the main character. The big Hindi title is rendered by code with libass (Baloo 2), never by the model.
A character with no sheet yet gets one generated and auto-approved, so a new theme can still run; review it in Character Studio.

**Image models and batch mode.** Each channel picks an image model per shot type in its **Image models** section: a default plus optional overrides
for wide, medium, close-up and over-the-shoulder shots and for thumbnails. The available models are:

| Model id | Est. $/image | Notes |
|---|---|---|
| `gemini:gemini-2.5-flash-image` (Nano Banana, default) | 0.039 (0.0195 batch) | strong consistency from character sheets |
| `gemini:gemini-3-pro-image-preview` (Nano Banana Pro) | 0.134 (0.067 batch) | premium; good for thumbnails |
| `fal:seedream-4.5` | 0.04 | up to ~10 reference images |
| `fal:flux-2-pro` | ~0.06 (priced per megapixel) | FLUX.2 [pro] edit |
| `fal:qwen-image-edit-2511` | ~0.03 | open model (Apache-2.0), ~3 references |
| `fal:flux-3-image` | ~0.048 (1 MP tier) | newest FLUX; 1–10 references; `resolution` + `aspect_ratio` inputs |
| `fal:flux-3-klein` | ~0.008–0.036 (fal lists these as planned prices) | small and cheap; test it on wides and backgrounds |
| `fal:flux-2-klein-4b` | ~0.005 + 0.005 per reference (per MP) | very cheap open model; check characters stay on-model |
| `fal:z-image-turbo` | ~0.005 | **text only, no reference sheets**: allowed only for *shots with no characters* |
| `byteplus:seedream-4.0` | 0.03 | Seedream via BytePlus ModelArk (`BYTEPLUS_ARK_API_KEY`), multi-reference |
| `byteplus:seedream-5.0-lite` | 0.035 | newer Seedream, up to ~14 references |

The catalog lives in `packages/core/src/providers/image-models.ts`. The fal endpoints are `fal-ai/bytedance/seedream/v4.5/edit`, `fal-ai/flux-2-pro/edit`,
`fal-ai/qwen-image-edit-2511`, `blackforestlabs/flux-3/edit-image` and `blackforestlabs/flux-3/klein/edit-image`, with matching text-to-image endpoints when a shot has no reference images.
Reference images are sent as data URIs. Check fal's live API schema if a request is rejected.
The asset cache key includes the model, so switching a model regenerates only the shots that use it.
A channel can also set a model for **shots with no characters** (establishing and background shots). That is the only slot where text-only
models such as Z-Image are used: a model that can't take reference sheets is never used for a shot with characters, even if it's configured.

With **Gemini batch mode** on, Gemini shots are uploaded as one JSONL job to Google's Batch API, which costs about half the standard price.
The references are uploaded once through the Files API. The image stage then *defers* itself without failing:
the worker checks every `IMAGE_BATCH_POLL_SEC`, collects the images when the job finishes, and continues the pipeline.
Non-Gemini shots run straight away. Shots the batch didn't return, or that failed the consistency check, are redone with standard calls.
If a batch passes `IMAGE_BATCH_MAX_HOURS`, it is cancelled and the remaining shots are generated normally.
Try it with `npm run demo -- --batch`.

**3. Voices (Sarvam Bulbul, hi-IN).**
There is one call per line, using the character's speaker, pitch, pace and loudness (the narrator voice is set on the theme).
- Each line gets two-pass `loudnorm` to −16 LUFS.
- The duration is measured, and shot duration = `max(audio + 0.4s, 2.5s)`, frame-aligned.
- If a Short would come out under 30s, its final shot is held longer.

**4. Motion (`MotionProvider`).**
`KenBurnsProvider` (free) uses FFmpeg `zoompan`: a slow pan for wide shots, a push-in for close-ups, a gentle drift for medium shots, and a subtle
"breathing" scale. Frames are rendered at 2× and downscaled to avoid jitter.
`FalLipSyncProvider` (per-channel toggle) is used **only for close-up dialogue shots** and falls back to Ken Burns on error.

**Image-to-video models.** These are the available models, each with its own API key. Prices are $ per output second, with audio off:

| Model id | API | $/s | Notes |
|---|---|---|---|
| `i2v:seedance-1.5-pro-720p` | BytePlus ModelArk (`BYTEPLUS_ARK_API_KEY`) | 0.026 | best value at 720p (official: $0.13 per silent 5 s clip) |
| `i2v:seedance-1.5-pro-480p` | BytePlus ModelArk | 0.012 | cheapest credible option |
| `i2v:wan-2.6-flash-720p` | Alibaba Model Studio / DashScope (`DASHSCOPE_API_KEY`) | ~0.025 | price estimate from resellers |
| `i2v:wan-2.2-flash-480p` | DashScope | 0.015 | fixed 5 s clips |
| `i2v:flux-3-max` | fal (`FAL_KEY`) | 0.0425 promo until 2026-11-07, then 0.17 | |

The same rules apply to all of them: the motion scope, clip trimming, dropped model audio, the Ken Burns fallback, and cost logging with the 5 s minimum.
Seedance runs as a ModelArk async task (`/contents/generations/tasks`, first-frame image, `--resolution/--duration/--camerafixed` prompt flags, `generate_audio: false`).
Wan runs as a DashScope async `video-synthesis` task, polled through `/tasks/{id}`. If a provider rejects a request, the error is logged and that shot uses Ken Burns.

**API gateways (APIMart, EvoLink).** These resellers serve many models behind one key, often below list price. Both use the same task API:
`POST /v1/{images,videos}/generations`, then poll `GET /v1/tasks/{id}`. The models available through them are:
- `apimart:nano-banana` (~$0.0125/image) and `evolink:nano-banana` (estimated price);
- `i2v:evolink-seedance-2.0-mini` (from $0.012/s, 480p) and `i2v:apimart-seedance-2.0` (estimated price).

Set `APIMART_API_KEY` / `EVOLINK_API_KEY` to use them.
- **Fallback:** if a gateway image call fails, the shot is regenerated with the direct default model (Google), and a failed gateway video falls back to Ken Burns.
  The daily run never depends on a gateway being up.
- **Official routes only:** the app doesn't use APIMart's unofficial "-ext" routes.
- **Model IDs:** the image model IDs (`APIMART_NANO_BANANA_MODEL`, `EVOLINK_NANO_BANANA_MODEL`) and APIMart's Seedance ID (`APIMART_SEEDANCE_MODEL`)
  weren't confirmed in public docs. Check them in each gateway's dashboard, and override them if the first call is rejected.

**Comparing animation.** The **Animation** tab on the comparison page animates the same 1–5 shot images (dialogue close-ups by default) with 2–4 video models.
It shows the clips side by side with their cost, time and per-story projections. Buttons apply a model to the channel for close-ups, Shorts or all shots.

**Image-to-video (FLUX 3 Max).** Set a channel's **Motion** to *FLUX 3 Max image-to-video*. The model turns each still into a short animated clip,
with blinks, lip movement, gestures and ambient motion, using a prompt built from the shot's action and emotion.
- The clip is trimmed to the shot's exact length, and the model's own audio is dropped (dialogue still comes from Sarvam).
- **Scope** decides which shots are animated: close-up dialogue only (default), every speaking shot, every shot in Shorts, or every shot.
  Everything outside the scope, and any failed call, uses free Ken Burns.
- **Cost:** endpoint `blackforestlabs/flux-3-max/image-to-video`, 720p, billed per output second with a minimum of 5 s per shot.
  The promo price of $0.0425/s runs until 2026-11-07, then $0.17/s; set `FLUX_3_MAX_USD_PER_SEC` to override.
  At ~4 s per shot, close-ups only (~40 shots) cost about ₹750 per story at promo and ₹3,000 at list price;
  every shot (~140) costs about ₹2,600 at promo and ₹10,500 at list price.

**5. Assembly (FFmpeg).**
- Consecutive shots in the same location are joined with hard cuts. Location changes get 0.5s crossfades, and the timeline is padded so audio stays in sync.
- The audio mix puts dialogue on top, adds music from the channel's pack under a sidechain compressor keyed on dialogue, and adds SFX
  matched from `assets/sfx/library.json` by tag overlap with each shot's `sfx` field. Dialogue and SFX are placed sample-accurately.
- Hindi ASS subtitles are burned in. For Shorts they sit inside the Shorts safe area.
- The channel intro is prepended and the outro + subscribe card appended. Uploaded clips are used if present; otherwise title cards are generated.
  Shorts skip the intro so the hook lands in the first 2 seconds.
- Output is H.264 High / AAC 384k at YouTube-recommended bitrates (8 Mbps for 1080p30), with faststart, and a final loudness pass.

**6. Review & publish.**
Uploads use the YouTube Data API v3 resumable protocol. The upload session URI is persisted, so a crashed upload resumes.
- Each upload sets title/description/tags, the scheduled `publishAt`, `selfDeclaredMadeForKids`, and **`containsSyntheticMedia: true`**, and adds an AI note to the description.
- Shorts always get `#Shorts`.
- After publish, `memory_update` is appended to the storyline's `story_memory`. Once memory exceeds about 3k tokens, the LLM compresses it.
  Teaser Shorts don't add to memory.

---

## Web app

| Page | What you can do |
|---|---|
| **Dashboard** `/` | Today's story + 2 shorts per channel with per-stage chips, cost today/month vs. budget, failures with **Retry stage**, **Run now** |
| **Channels** `/channels` | Profiles, schedule (channel timezone), theme assignment (one per channel), auto-publish, kids flag, shorts mode, motion provider, music pack, subtitles, intro/outro upload, **Connect YouTube** (OAuth) |
| **Themes** `/themes/[id]` | Art style + negative style + content rules editor, **Test style** (4 samples), characters, locations (generate/approve reference plates), storyline bible, narrator voice |
| **Character Studio** `/themes/[id]/characters/[cid]` | Edit the description → generate the sheet → approve/regenerate. Pick a Sarvam voice and pitch/pace/loudness → type a Hindi line → **Preview voice** |
| **Story Memory** `/themes/[id]/memory` | View/edit the rolling memory and open threads; add "next episode should…" directives |
| **Content detail** `/content/[id]` | Video player, thumbnail, YouTube metadata + schedule editor, cost breakdown, safety report, shot grid (image + audio + regenerate image/voice), inline **script editor**: editing a line re-runs only the affected shots |
| **Review Queue** `/review` | Watch and **Approve & publish** or **Reject** |
| **Launch Kit** `/launch` | One-line idea → researched, editable channel package → **Create channel** (see below) |
| **Music** `/music` | Music packs: generate instrumental tracks (Eleven Music), upload tracks you've licensed (with a required licence note), preview, delete |
| **Image Models** `/compare` | Generate the same 10 shots with 2–4 image models (same prompts and character sheets), compare them side by side with cost and speed, and apply a model to a channel's shot type with one click |
| **Settings** `/settings` | Encrypted API keys, script model, concurrency limits, consistency check, max shots, monthly budget cap |

The image/voice/sheet/style-test jobs run in the worker, so keep `npm run worker` running while you use the UI.

---

## Cost estimates (per channel per day)

These are list-price estimates in INR at ₹88/USD. Every call is logged in `ApiCallLog` with tokens/characters/images and its estimated cost,
and is visible per item in the UI. Pricing constants are in `packages/core/src/cost.ts`; check the providers' current pricing pages.

| Item | Story (≈150 shots) | Each Short (≈12 shots) |
|---|---|---|
| Claude Sonnet 5.5 script + safety ($2/$10 per 1M tok, ~20k in / ~35k out) | ≈ ₹35 | ≈ ₹5 |
| Nano Banana images ($0.039 each, shots + thumbnail) | ≈ ₹520 | ≈ ₹45 |
| Sarvam Bulbul (≈₹15 / 10k chars) | ≈ ₹15 | ≈ ₹2 |
| Ken Burns motion, FFmpeg, YouTube upload | ₹0 | ₹0 |
| **Total** | **≈ ₹570** | **≈ ₹52** |

That is roughly **₹675 per channel per day, about ₹20,000 per month**.
- Gemini batch mode halves the image line: a story comes to ≈ ₹300 and a short ≈ ₹30, so a channel costs ≈ ₹360/day, about ₹11,000/month.
- Other image models change the image line too. Use the **Image Models** page to measure cost and quality on your own shots.
- The optional consistency check adds roughly 10–30% to image cost, depending on regenerations.
- fal.ai lip-sync on close-up dialogue shots costs about $0.08 per output second, roughly ₹800+ extra per story for ~30 close-ups. Enable it per channel only if it's worth it.
- Re-running unchanged shots costs nothing, because of the asset cache.

---

## Launch Kit: researching and generating a new channel

Open **Launch Kit**, describe the channel in one line (for example "Panchatantra animal fables for kids 4–8"), and optionally add the audience, constraints and a kids flag.
The worker then runs these steps. Each step saves its output, so a failed step can be retried from where it stopped.

1. **Research (Claude + live web search).** Looks up existing channels in the niche and what works for them, the audience, authentic cultural details,
   visual, music and voice-acting conventions, title and thumbnail patterns, YouTube policy risks (made-for-kids, AI and reused content), and names to avoid.
   The result is a brief with linked sources, shown in the UI.
2. **Write the kit (Claude).** Using the brief, it produces:
   - 5 channel name options (Roman + Devanagari + handle), a tagline, Hindi and English descriptions, keywords, and publish times;
   - the art style prompt, negative style and content rules;
   - the series bible: premise, world rules, character arcs, running gags, forbidden topics, open threads, and first-episode ideas;
   - 4–6 characters with personality, speech style, catchphrases, very detailed fixed visual descriptions, and a cast voice;
   - the narrator voice, 4–6 locations, 3 music briefs, and logo and banner art direction.

   The output is validated with Zod and repaired automatically if invalid. The voice caster then checks the cast against the Sarvam catalog:
   it fixes unknown voices and voices that don't match a character's gender or age, and gives main characters distinct voices.
3. **Review (Claude + web search).** A second pass checks each name option for existing YouTube channels or brands, and checks the kit for originality,
   cultural authenticity, audience fit, policy risk and production readiness. It fixes what it finds, and names with conflicts are moved to the end of the list.
4. **Art (Nano Banana).** Three logo candidates (800×800, no text) and banner art. The channel name is added to the banner by code inside YouTube's
   all-device safe area (2560×1440).
5. **Music.** One instrumental track per brief: Eleven Music when `ELEVENLABS_API_KEY` is set, otherwise a placeholder. Tracks go into a music pack for the channel.

On the kit page you can edit every field, preview each character's voice, pick the name and logo, and regenerate the logos, banner, music, or the whole kit from any step.
**Create channel** then creates the theme, characters, locations, storyline bible, music pack and channel in one go. The first episode idea becomes a directive for episode 1.
It also queues the character sheets and location plates for approval.
The channel starts **paused**. Approve the cast in the theme, connect YouTube, use **Push to YouTube** on the channel page
(description, keywords, banner, and "Full Episodes" / "Shorts" playlists; new uploads are added to them), upload the logo as the profile picture in
YouTube Studio (the API can't set it), then set the channel to **Active**.

You can also run a kit from the command line: `npm run launch -- "Bhoot-wala gaon spooky comedy" [--kids] [--apply]`.

**Music licensing.** The bundled tracks and the offline synth are placeholders. For production, either generate with Eleven Music
(paid ElevenLabs plans allow broad commercial use; check the Eleven Music terms for your plan), or upload tracks you've licensed on the Music page.
A licence note is required for uploads and is stored with each track.

**Cost of one kit** (estimate): research and review use about 20 web searches ($0.01 each) plus about 60k tokens on Sonnet 5.5 (≈ ₹70–110),
4 images (≈ ₹14), and about 4.5 minutes of Eleven Music (plan-dependent; estimated at $0.8/min ≈ ₹320). Every kit's spend is logged and shown on its page.

## Adding a new channel

The quickest way is the **Launch Kit** above. To set one up by hand:


1. **Themes → New theme.** Set the genre, a detailed `art_style_prompt`, negative style, tone, audience and content rules
   (toggle the strict kids profile for children's content). Pick the narrator voice.
2. **Add characters.** For each one, write a precise visual description (face, hair, outfit colours, accessories) and a speech style.
   In Character Studio, **Generate sheet**, then approve or regenerate until it's on-model. Pick a Sarvam voice and preview a Hindi line.
3. **Add locations** and generate/approve their reference plates. **Test style** shows 4 samples of the look.
4. **Fill the storyline bible.** Add premise, world rules, arcs, running gags, forbidden topics, and optionally seed open threads or directives on the Story Memory page.
5. **Channels → New channel.** Pick the theme, timezone, generation/publish times, shorts mode, music pack, subtitles, kids flag, and auto-publish.
6. **Connect YouTube.** Create an OAuth client (type *Web application*) in Google Cloud with the YouTube Data API v3 enabled,
   add `${APP_URL}/api/youtube/callback` as an authorised redirect URI, save the client ID/secret in Settings, and click **Connect YouTube**.
   Custom thumbnails require a verified YouTube channel. Until a channel is connected, publishing writes to `data/published/`.
7. Press **Run now** to test, or wait for the scheduler. With auto-publish off, approve videos in the **Review Queue**.

To add music packs, drop `.m4a/.mp3/.wav` files into `assets/music/<pack>/`. To add SFX, put the files in `assets/sfx/` and add
`{ "file": "...", "tags": ["..."] }` entries to `library.json`. The bundled music and SFX are royalty-free placeholders synthesised by
`npm run assets`; replace them with licensed assets for production.

---

## Tests

```bash
npm test
```

- `test/script-schema.test.ts`: script JSON validation (fences/prose, normalisation, Devanagari, line length, unknown keys, shot bounds)
- `test/duration.test.ts`: the shot duration rule, frame alignment, the status machine, timezone scheduling
- `test/kit.test.ts`: launch-kit schema validation and repair parsing, kid-safety enforcement, voice casting (gender/age fit, distinct voices, clamping, v2/v3 catalogs), music moods
- `test/gateway.test.ts`: APIMart/EvoLink response parsing, gateway image requests and the fallback to the direct provider, and gateway video requests with clip fitting
- `test/cheap-models.test.ts`: the no-characters routing rule (text-only models never used with characters), per-reference pricing, the Seedream (BytePlus) request,
  Seedance and Wan task submission and polling against fake servers with exact clip fitting, and the video-comparison shot picker
- `test/fal-models.test.ts`: FLUX 3 Max promo/list pricing and scope rules, fal request shapes (FLUX 3 `resolution`/`aspect_ratio` vs `image_size`),
  and FalImage / image-to-video against a fake fal server, including trimming a 6 s clip with audio to an exact silent 3.4 s shot and the Ken Burns fallback
- `test/image-models.test.ts`: per-shot-type model selection, catalog validation, comparison shot picking, and the batch submit/poll contract
- `test/assembly.test.ts`: renders a **3-shot fixture** (two locations → one crossfade, two dialogue lines + one silent shot)
  through Ken Burns + loudness normalisation + full assembly with music, SFX, subtitles, intro and outro. It checks codecs, size,
  duration, and the Shorts length cap.

---

## Notes & limits

- Web research quality depends on what search returns. Read the sources and the review notes, and check a name on YouTube yourself before you commit to it.
- Voice genders for some Bulbul v3 speakers (marked * in the picker) come from third-party docs. Confirm them with **Preview voice**.

- Nano Banana and Sarvam produce no motion. Ken Burns is the default; lip-sync/I2V is an optional add-on behind `MotionProvider`.
- YouTube API quota: uploads are among the most expensive Data API calls, and the default project quota is 10,000 units per day. Check the current per-call cost in Google's quota calculator; 3 uploads × N channels may need a quota increase.
- The vision consistency check and the safety check are model judgements. The Review Queue (auto-publish off) is the recommended
  default until a channel's output is trusted.
