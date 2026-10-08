// Durable user media (MEDIA-03). With STORAGE_DRIVER=r2, R2 is the home of every file a user uploads or
// pays to generate: screenshots, brand logos/fonts/CSS, voice and music takes, site snapshots. The local
// directories (config.projectsDir, brandsDir, audioDir) are then only a cache: every write is mirrored to
// R2, every read fetches a missing file back, so the backend can lose its disk or run as several replicas.
// With STORAGE_DRIVER=filesystem (local dev, CI) these helpers only touch the local disk.
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.ts";

const r2 = config.r2;
const client = r2 ? new S3Client({ region: "auto", endpoint: r2.endpoint, credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey } }) : null;
export const mediaInR2 = Boolean(client);

const roots = [
  { dir: config.projectsDir, name: "projects" },
  { dir: config.brandsDir, name: "brands" },
  { dir: config.audioDir, name: "audio" }
];

/** media/<projects|brands|audio>/<path below that root>; throws for a path outside the media roots. */
export function mediaKey(path: string) {
  for (const root of roots) {
    const rel = relative(root.dir, path);
    if (rel === "") return `media/${root.name}`;
    if (!rel.startsWith("..") && !isAbsolute(rel)) return `media/${root.name}/${rel.split(sep).join("/")}`;
  }
  throw new Error(`Not a media path: ${path}`);
}

const localPath = (key: string) => {
  const [, rootName, ...rest] = key.split("/");
  const root = roots.find((entry) => entry.name === rootName)!;
  return join(root.dir, ...rest);
};

const exists = (path: string) => stat(path).then((info) => info.isFile(), () => false);

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

async function upload(path: string) {
  const { size } = await stat(path);
  await client!.send(new PutObjectCommand({ Bucket: r2!.mediaBucket, Key: mediaKey(path), Body: createReadStream(path), ContentLength: size }));
}

async function download(key: string, path: string): Promise<boolean> {
  try {
    const object = await client!.send(new GetObjectCommand({ Bucket: r2!.mediaBucket, Key: key }));
    const bytes = Buffer.from(await object.Body!.transformToByteArray());
    await mkdir(dirname(path), { recursive: true });
    // Write beside and rename, so a concurrent reader never sees half a file.
    const temp = `${path}.${process.pid}.${Date.now()}.part`;
    await writeFile(temp, bytes);
    await rename(temp, path);
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") return false;
    throw error;
  }
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client!.send(new ListObjectsV2Command({ Bucket: r2!.mediaBucket, Prefix: `${prefix}/`, ContinuationToken: token }));
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function forEachLimited<T>(items: T[], run: (item: T) => Promise<unknown>, width = 6) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await run(items[i]!);
  }));
}

/** Writes a media file locally and stores it durably. */
export async function saveMedia(path: string, data: Buffer | string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  if (client) await upload(path);
}

/** Stores files already written under a media directory (or one file). */
export async function persistMedia(path: string) {
  if (!client) return;
  if (await exists(path)) return upload(path);
  const files: string[] = [];
  for await (const file of walk(path)) if (!file.endsWith(".part")) files.push(file);
  await forEachLimited(files, upload);
}

/** True when the file is on local disk, fetching it from R2 first when the cache lacks it. */
export async function ensureMedia(path: string): Promise<boolean> {
  if (await exists(path)) return true;
  return client ? download(mediaKey(path), path) : false;
}

/** The file's bytes, or null when it exists nowhere. */
export async function readMedia(path: string): Promise<Buffer | null> {
  return (await ensureMedia(path)) ? readFile(path).catch(() => null) : null;
}

// A directory listed in the last minute is not listed again; single files are still fetched on demand.
const hydrated = new Map<string, number>();

/** Fetches every file under a media directory that the local cache lacks. */
export async function ensureMediaDir(dir: string) {
  if (!client) return;
  const prefix = mediaKey(dir);
  if ((hydrated.get(prefix) ?? 0) > Date.now() - 60_000) return;
  const keys = await listKeys(prefix);
  await forEachLimited(keys, async (key) => {
    const path = localPath(key);
    if (!(await exists(path))) await download(key, path);
  });
  hydrated.set(prefix, Date.now());
}

/** Deletes a media file or directory locally and in R2. */
export async function removeMedia(path: string) {
  await rm(path, { recursive: true, force: true });
  if (!client) return;
  const key = mediaKey(path);
  hydrated.delete(key);
  const keys = [key, ...(await listKeys(key))];
  for (let i = 0; i < keys.length; i += 1000) {
    await client.send(new DeleteObjectsCommand({ Bucket: r2!.mediaBucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
  }
}
