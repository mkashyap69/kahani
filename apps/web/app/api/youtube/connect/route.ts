import { NextResponse } from "next/server";
import { youtubeAuthUrl } from "@kahani/core";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const channelId = new URL(req.url).searchParams.get("channelId");
  if (!channelId) return new Response("channelId required", { status: 400 });
  try {
    return NextResponse.redirect(await youtubeAuthUrl(channelId));
  } catch (err) {
    return new Response(`Cannot start YouTube OAuth: ${(err as Error).message}. Set YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in Settings.`, { status: 400 });
  }
}
