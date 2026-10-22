import { Readable } from "node:stream";
import { guessType, storage } from "@kahani/core";

export const dynamic = "force-dynamic";

/** Streams stored assets (images, audio, video) with HTTP Range support for seeking. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
  if (key.includes("..")) return new Response("bad key", { status: 400 });
  const store = storage();
  let size: number;
  try {
    size = await store.size(key);
  } catch {
    return new Response("not found", { status: 404 });
  }
  const type = guessType(key);
  const headers: Record<string, string> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(await store.stream(key, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(await store.stream(key)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "content-length": String(size) } });
}
