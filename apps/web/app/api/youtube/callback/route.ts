import { NextResponse } from "next/server";
import { completeYoutubeAuth, config } from "@kahani/core";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const channelId = url.searchParams.get("state");
  if (!code || !channelId) return new Response(url.searchParams.get("error") ?? "missing code/state", { status: 400 });
  try {
    await completeYoutubeAuth(channelId, code);
    return NextResponse.redirect(`${config.appUrl}/channels/${channelId}?connected=1`);
  } catch (err) {
    return new Response(`YouTube connection failed: ${(err as Error).message}`, { status: 500 });
  }
}
