import { ttsProvider } from "@kahani/core";

export const dynamic = "force-dynamic";

/** "Preview voice": synthesise one Hindi line with the given Sarvam speaker settings. */
export async function POST(req: Request) {
  const body = (await req.json()) as { text?: string; speaker?: string; pitch?: number; pace?: number; loudness?: number };
  const text = (body.text ?? "").trim().slice(0, 500);
  if (!text) return new Response("text required", { status: 400 });
  try {
    const tts = await ttsProvider();
    const wav = await tts.synthesize(
      { text, speaker: body.speaker ?? "anushka", pitch: Number(body.pitch ?? 0), pace: Number(body.pace ?? 1), loudness: Number(body.loudness ?? 1), language: "hi-IN" },
      { operation: "voice-preview" },
    );
    return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "x-provider": tts.name } });
  } catch (err) {
    return new Response(String((err as Error).message ?? err), { status: 502 });
  }
}
