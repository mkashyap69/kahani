import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config.js";

/** Object storage abstraction. Keys look like "items/<id>/shots/0001.png". */
export interface Storage {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  putFile(key: string, filePath: string, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Download to a local path (for FFmpeg). Returns the local path. */
  download(key: string, filePath: string): Promise<string>;
  /** byte range is inclusive, like HTTP Range */
  stream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  size(key: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error("invalid storage key");
    return full;
  }
  async put(key: string, body: Buffer) {
    await fs.mkdir(path.dirname(this.p(key)), { recursive: true });
    await fs.writeFile(this.p(key), body);
  }
  async putFile(key: string, filePath: string) {
    await fs.mkdir(path.dirname(this.p(key)), { recursive: true });
    await fs.copyFile(filePath, this.p(key));
  }
  get(key: string) {
    return fs.readFile(this.p(key));
  }
  async download(key: string, filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.copyFile(this.p(key), filePath);
    return filePath;
  }
  async stream(key: string, range?: { start: number; end: number }) {
    await fs.access(this.p(key));
    return createReadStream(this.p(key), range);
  }
  async size(key: string) {
    return (await fs.stat(this.p(key))).size;
  }
  async exists(key: string) {
    return fs.access(this.p(key)).then(
      () => true,
      () => false,
    );
  }
  async delete(key: string) {
    await fs.rm(this.p(key), { force: true });
  }
}

class S3Storage implements Storage {
  private client: S3Client;
  constructor(private bucket: string) {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
      credentials: process.env.S3_ACCESS_KEY_ID
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" }
        : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType?: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType ?? guessType(key) }));
  }
  async putFile(key: string, filePath: string, contentType?: string) {
    const stat = await fs.stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: stat.size,
        ContentType: contentType ?? guessType(key),
      }),
    );
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async download(key: string, filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, await this.get(key));
    return filePath;
  }
  async stream(key: string, range?: { start: number; end: number }) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
    );
    return res.Body as Readable;
  }
  async size(key: string) {
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return head.ContentLength ?? 0;
  }
  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function guessType(key: string): string {
  const ext = path.extname(key).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".mp4": "video/mp4",
      ".json": "application/json",
      ".ass": "text/plain; charset=utf-8",
    }[ext] ?? "application/octet-stream"
  );
}

let instance: Storage | undefined;
export function storage(): Storage {
  if (!instance) {
    instance =
      (process.env.STORAGE_DRIVER ?? "local") === "s3"
        ? new S3Storage(process.env.S3_BUCKET ?? "kahani")
        : new LocalStorage(path.resolve(config.repoRoot, process.env.LOCAL_STORAGE_DIR ?? "data/storage"));
  }
  return instance;
}
