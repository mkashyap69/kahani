import fs from "node:fs";
import fsp from "node:fs/promises";
import { google } from "googleapis";
import { prisma } from "../db.js";
import { decrypt, encrypt } from "../util/crypto.js";
import { getSecret } from "../settings.js";
import { config } from "../config.js";
import { logApiCall } from "../cost.js";
import { NonRetryableError, withRetry } from "../util/retry.js";
import type { CallContext, PublishRequest, Publisher } from "./types.js";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  // channel branding (description, keywords, banner) and playlists
  "https://www.googleapis.com/auth/youtube",
];

export async function oauthClient() {
  const clientId = await getSecret("YOUTUBE_CLIENT_ID");
  const clientSecret = await getSecret("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new NonRetryableError("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not configured");
  return new google.auth.OAuth2(clientId, clientSecret, `${config.appUrl}/api/youtube/callback`);
}

export async function youtubeAuthUrl(channelId: string): Promise<string> {
  const client = await oauthClient();
  return client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: YOUTUBE_SCOPES, state: channelId });
}

/** Exchange the OAuth code, store encrypted tokens and the YouTube channel id. */
export async function completeYoutubeAuth(channelId: string, code: string) {
  const client = await oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const yt = google.youtube({ version: "v3", auth: client });
  const me = await yt.channels.list({ part: ["id", "snippet"], mine: true });
  const ytChannel = me.data.items?.[0];
  await prisma.channel.update({
    where: { id: channelId },
    data: { oauthTokensEnc: encrypt(JSON.stringify(tokens)), youtubeChannelId: ytChannel?.id ?? null },
  });
  return { youtubeChannelId: ytChannel?.id, title: ytChannel?.snippet?.title };
}

async function authedClient(channelId: string) {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  if (!channel.oauthTokensEnc) throw new NonRetryableError(`Channel "${channel.name}" is not connected to YouTube`);
  const client = await oauthClient();
  client.setCredentials(JSON.parse(decrypt(channel.oauthTokensEnc)));
  client.on("tokens", async (t) => {
    const merged = { ...JSON.parse(decrypt(channel.oauthTokensEnc!)), ...t };
    await prisma.channel.update({ where: { id: channelId }, data: { oauthTokensEnc: encrypt(JSON.stringify(merged)) } });
  });
  return client;
}

const CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB

/** YouTube Data API v3 publisher using the resumable upload protocol. */
export class YouTubePublisher implements Publisher {
  readonly name = "youtube";

  async publish(channelId: string, req: PublishRequest, ctx: CallContext) {
    const auth = await authedClient(channelId);
    const token = async () => (await auth.getAccessToken()).token!;
    const size = (await fsp.stat(req.videoPath)).size;

    let session = req.resumeSession ?? null;
    let offset = 0;
    if (session) {
      offset = await this.queryOffset(session, size, await token()).catch(() => {
        session = null;
        return 0;
      });
    }
    if (!session) {
      const metadata = {
        snippet: {
          title: req.title.slice(0, 100),
          description: req.description.slice(0, 5000),
          tags: req.tags,
          categoryId: "1", // Film & Animation
          defaultLanguage: req.language.split("-")[0],
          defaultAudioLanguage: req.language.split("-")[0],
        },
        status: {
          privacyStatus: req.publishAt && req.publishAt > new Date() ? "private" : "public",
          publishAt: req.publishAt && req.publishAt > new Date() ? req.publishAt.toISOString() : undefined,
          selfDeclaredMadeForKids: req.madeForKids,
          containsSyntheticMedia: req.containsSyntheticMedia,
          embeddable: true,
        },
      };
      const res = await withRetry(async () => {
        const r = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await token()}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(size),
            "X-Upload-Content-Type": "video/mp4",
          },
          body: JSON.stringify(metadata),
        });
        if (!r.ok) throw Object.assign(new Error(`YouTube init ${r.status}: ${await r.text()}`), { status: r.status });
        return r;
      });
      session = res.headers.get("location");
      if (!session) throw new Error("YouTube did not return an upload session");
      await req.onSession?.(session);
    }

    let video: { id: string } | null = null;
    while (!video) {
      const end = Math.min(offset + CHUNK, size) - 1;
      const chunk = await readRange(req.videoPath, offset, end);
      const r = await withRetry(
        async () => {
          const res = await fetch(session!, {
            method: "PUT",
            headers: { Authorization: `Bearer ${await token()}`, "Content-Length": String(chunk.length), "Content-Range": `bytes ${offset}-${end}/${size}` },
            body: new Uint8Array(chunk),
          });
          if (res.status >= 500) throw Object.assign(new Error(`YouTube upload ${res.status}`), { status: res.status });
          return res;
        },
        { retries: 6, baseMs: 2000 },
      );
      if (r.status === 200 || r.status === 201) {
        video = (await r.json()) as { id: string };
      } else if (r.status === 308) {
        const range = r.headers.get("range");
        offset = range ? Number(range.split("-")[1]) + 1 : 0;
      } else {
        throw Object.assign(new Error(`YouTube upload failed ${r.status}: ${await r.text()}`), { status: r.status });
      }
    }

    if (req.thumbnailPath) {
      try {
        const yt = google.youtube({ version: "v3", auth });
        await yt.thumbnails.set({ videoId: video.id, media: { mimeType: "image/jpeg", body: fs.createReadStream(req.thumbnailPath) } });
      } catch (err) {
        // custom thumbnails need a verified channel; don't fail the publish for it
        console.warn(`[youtube] thumbnail upload failed: ${err}`);
      }
    }
    if (req.playlistId) {
      try {
        const yt = google.youtube({ version: "v3", auth });
        await yt.playlistItems.insert({ part: ["snippet"], requestBody: { snippet: { playlistId: req.playlistId, resourceId: { kind: "youtube#video", videoId: video.id } } } });
      } catch (err) {
        console.warn(`[youtube] adding to playlist failed: ${err}`);
      }
    }
    await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: "youtube", model: "data-api-v3", operation: "upload", costInr: 0 });
    return { videoId: video.id, url: `https://youtu.be/${video.id}` };
  }

  private async queryOffset(session: string, size: number, token: string): Promise<number> {
    const r = await fetch(session, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Range": `bytes */${size}`, "Content-Length": "0" } });
    if (r.status === 308) {
      const range = r.headers.get("range");
      return range ? Number(range.split("-")[1]) + 1 : 0;
    }
    throw new Error(`cannot resume session (${r.status})`);
  }
}

async function readRange(file: string, start: number, end: number): Promise<Buffer> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(end - start + 1);
    await fh.read(buf, 0, buf.length, start);
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * Push launch-kit branding to the connected YouTube channel: description, keywords, banner image,
 * and "Full episodes" / "Shorts" playlists. (The profile picture cannot be set through the API — upload the logo in YouTube Studio.)
 */
export async function pushYoutubeBranding(channelId: string, opts: { bannerPath?: string | null }): Promise<{ updated: string[] }> {
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  const auth = await authedClient(channelId);
  const yt = google.youtube({ version: "v3", auth });
  const updated: string[] = [];
  const me = await yt.channels.list({ part: ["brandingSettings", "id"], mine: true });
  const current = me.data.items?.[0];
  if (!current?.id) throw new NonRetryableError("no YouTube channel found for this account");

  let bannerUrl: string | undefined;
  if (opts.bannerPath) {
    const res = await yt.channelBanners.insert({ media: { mimeType: "image/jpeg", body: fs.createReadStream(opts.bannerPath) } });
    bannerUrl = res.data.url ?? undefined;
  }
  const keywords = channel.keywords.map((k) => (k.includes(" ") ? `"${k}"` : k)).join(" ").slice(0, 500);
  const branding = current.brandingSettings ?? {};
  await yt.channels.update({
    part: ["brandingSettings"],
    requestBody: {
      id: current.id,
      brandingSettings: {
        ...branding,
        channel: { ...branding.channel, description: channel.description || branding.channel?.description, keywords: keywords || branding.channel?.keywords, defaultLanguage: channel.language.split("-")[0] },
        ...(bannerUrl ? { image: { ...branding.image, bannerExternalUrl: bannerUrl } } : {}),
      },
    },
  });
  updated.push("description", "keywords");
  if (bannerUrl) updated.push("banner");

  const ensurePlaylist = async (existing: string | null, title: string, description: string) => {
    if (existing) return existing;
    const res = await yt.playlists.insert({ part: ["snippet", "status"], requestBody: { snippet: { title, description }, status: { privacyStatus: "public" } } });
    updated.push(`playlist "${title}"`);
    return res.data.id ?? null;
  };
  const storyPlaylistId = await ensurePlaylist(channel.storyPlaylistId, "पूरी कहानियाँ | Full Episodes", `${channel.name} — full story episodes`);
  const shortsPlaylistId = await ensurePlaylist(channel.shortsPlaylistId, "Shorts", `${channel.name} — Shorts`);
  await prisma.channel.update({ where: { id: channelId }, data: { storyPlaylistId, shortsPlaylistId } });
  return { updated };
}
