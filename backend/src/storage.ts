// Cloudflare R2 (S3 API) access for the render hand-off: the backend uploads the prepared project folder
// and hands the browser a short-lived presigned URL for the finished MP4. Used only when STORAGE_DRIVER=r2.
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.ts";

// R2_FORCE_PATH_STYLE=1 and R2_PUBLIC_ENDPOINT exist for the Compose MinIO: path-style addressing, and links for the browser
// that name the host's port instead of the container network's name. R2 itself needs neither.
const pathStyle = process.env.R2_FORCE_PATH_STYLE === "1";
const clientFor = (endpoint: string) => new S3Client({ region: "auto", endpoint, forcePathStyle: pathStyle, credentials: { accessKeyId: config.r2!.accessKeyId, secretAccessKey: config.r2!.secretAccessKey } });
const client = config.r2 ? clientFor(config.r2.endpoint) : null;
const signer = config.r2 ? (process.env.R2_PUBLIC_ENDPOINT ? clientFor(process.env.R2_PUBLIC_ENDPOINT) : client) : null;

const contentTypes: Record<string, string> = { ".html": "text/html", ".json": "application/json", ".css": "text/css", ".js": "text/javascript", ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp" };
const typeOf = (name: string) => contentTypes[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** Uploads every file under `dir` to the uploads bucket as `<prefix>/<relative path>`; returns the file count. */
export async function uploadDirectory(dir: string, prefix: string): Promise<number> {
  if (!client || !config.r2) throw new Error("Object storage is not configured.");
  const files: string[] = [];
  for await (const file of walk(dir)) files.push(file);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < files.length; i = next++) {
      const file = files[i]!;
      const key = `${prefix}/${relative(dir, file).split(sep).join("/")}`;
      const { size } = await stat(file);
      await client.send(new PutObjectCommand({ Bucket: config.r2!.uploadsBucket, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: typeOf(file) }));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return files.length;
}

/** Short-lived download URL for a finished render; the browser's player streams it with range requests. */
export async function presignOutput(key: string, seconds = 3600): Promise<string> {
  if (!client || !config.r2) throw new Error("Object storage is not configured.");
  return getSignedUrl(signer!, new GetObjectCommand({ Bucket: config.r2.outputsBucket, Key: key }), { expiresIn: seconds });
}

export async function outputExists(key: string): Promise<boolean> {
  if (!client || !config.r2) return false;
  return client.send(new HeadObjectCommand({ Bucket: config.r2.outputsBucket, Key: key })).then(() => true, () => false);
}

/** Uploads a single archive/file to the outputs bucket (or copies it to renderOutputDir in filesystem mode) so workers can read `painted/<id>/work.tgz`. */
export async function putOutputFile(key: string, filePath: string, contentType = "application/gzip"): Promise<void> {
  if (client && config.r2) {
    const { size } = await stat(filePath);
    await client.send(new PutObjectCommand({ Bucket: config.r2.outputsBucket, Key: key, Body: createReadStream(filePath), ContentLength: size, ContentType: contentType }));
    return;
  }
  const { copyFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const target = join(config.renderOutputDir, key);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(filePath, target);
}

/** Downloads a single archive/file from the outputs bucket (or renderOutputDir in filesystem mode); returns false if missing. */
export async function getOutputFile(key: string, destPath: string): Promise<boolean> {
  const { mkdir, writeFile, copyFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  if (client && config.r2) {
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: config.r2.outputsBucket, Key: key }));
      const bytes = Buffer.from(await object.Body!.transformToByteArray());
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, bytes);
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return false;
      throw error;
    }
  }
  const source = join(config.renderOutputDir, key);
  if (!(await stat(source).then(() => true, () => false))) return false;
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(source, destPath);
  return true;
}

// ---------- Plate artifacts (plates/): small objects addressed by immutable keys ----------
// Inputs the worker reads (authored source, bundle, manifests, audio) go to the uploads bucket; what the worker produces
// (stills, clips, exports) lands in the outputs bucket. The two sides never share a path, only keys.
export type Bucket = "uploads" | "outputs";
const bucketName = (bucket: Bucket) => {
  if (!config.r2) throw new Error("Object storage is not configured.");
  return bucket === "uploads" ? config.r2.uploadsBucket : config.r2.outputsBucket;
};

export async function putObject(bucket: Bucket, key: string, body: Buffer | string, contentType = typeOf(key)) {
  if (!client) throw new Error("Object storage is not configured.");
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  await client.send(new PutObjectCommand({ Bucket: bucketName(bucket), Key: key, Body: bytes, ContentLength: bytes.length, ContentType: contentType }));
}

export async function getObject(bucket: Bucket, key: string): Promise<Buffer | null> {
  if (!client) throw new Error("Object storage is not configured.");
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucketName(bucket), Key: key }));
    return Buffer.from(await object.Body!.transformToByteArray());
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey" || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

export async function objectSize(bucket: Bucket, key: string): Promise<number | null> {
  if (!client) return null;
  return client.send(new HeadObjectCommand({ Bucket: bucketName(bucket), Key: key })).then((head) => head.ContentLength ?? 0, () => null);
}

/** Short-lived download link; `filename` makes a browser save it instead of playing it. */
export async function presignKey(bucket: Bucket, key: string, options: { seconds?: number; filename?: string; contentType?: string } = {}): Promise<string> {
  if (!client) throw new Error("Object storage is not configured.");
  return getSignedUrl(signer!, new GetObjectCommand({
    Bucket: bucketName(bucket), Key: key,
    ...(options.filename ? { ResponseContentDisposition: `attachment; filename="${options.filename.replace(/[^\w.\- ]/g, "_")}"` } : {}),
    ...(options.contentType ? { ResponseContentType: options.contentType } : {})
  }), { expiresIn: options.seconds ?? 3600 });
}

/** Deletes every object under `prefix` (a plate artifact folder); returns how many were removed. */
export async function deletePrefix(bucket: Bucket, prefix: string): Promise<number> {
  if (!client) throw new Error("Object storage is not configured.");
  if (!/^plates\/[0-9a-f-]{36}\//i.test(prefix)) throw new Error("Refusing to delete outside a plate folder.");
  let removed = 0, token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucketName(bucket), Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((item) => ({ Key: item.Key! }));
    if (keys.length) { await client.send(new DeleteObjectsCommand({ Bucket: bucketName(bucket), Delete: { Objects: keys } })); removed += keys.length; }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return removed;
}
