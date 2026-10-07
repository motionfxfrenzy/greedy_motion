// Cloudflare R2 (S3 API) for the render hand-off. The worker reads the prepared project folder from the uploads
// bucket and writes the finished MP4 to the outputs bucket; it shares no disk with the backend.
// Enabled when R2_ENDPOINT is set (STORAGE_DRIVER=r2); otherwise the worker keeps using the shared /renders folder.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const storageEnabled = process.env.STORAGE_DRIVER === "r2";
const need = (name) => process.env[name] || (() => { throw new Error(`${name} is required when STORAGE_DRIVER=r2.`); })();
const cfg = storageEnabled
  ? { endpoint: need("R2_ENDPOINT"), accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY"), uploads: need("R2_UPLOADS_BUCKET"), outputs: need("R2_OUTPUTS_BUCKET") }
  : null;
const client = cfg ? new S3Client({ region: "auto", endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } }) : null;

async function list(bucket, prefix) {
  const keys = [];
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const item of page.Contents ?? []) keys.push({ key: item.Key, size: item.Size });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Downloads every object under `prefix` (uploads bucket) into `dir`, refusing any key that would escape it. */
export async function downloadProject(prefix, dir) {
  if (!/^jobs\/[a-f0-9-]{36}\/project$/i.test(prefix)) throw new Error("Invalid project prefix.");
  const objects = await list(cfg.uploads, `${prefix}/`);
  if (!objects.length) throw new Error("The prepared storyboard folder is missing in storage.");
  const root = resolve(dir);
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < objects.length; i = next++) {
      const target = resolve(root, objects[i].key.slice(prefix.length + 1));
      if (!target.startsWith(root + sep)) throw new Error("Unsafe object key.");
      await mkdir(dirname(target), { recursive: true });
      const response = await client.send(new GetObjectCommand({ Bucket: cfg.uploads, Key: objects[i].key }));
      await pipeline(response.Body, createWriteStream(target));
    }
  };
  await Promise.all(Array.from({ length: 6 }, lane));
  return objects.length;
}

/** Uploads the finished MP4 and verifies the stored size before the caller commits the key. */
export async function uploadOutput(file, key) {
  const { size } = await stat(file);
  await client.send(new PutObjectCommand({ Bucket: cfg.outputs, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: "video/mp4" }));
  const head = await client.send(new HeadObjectCommand({ Bucket: cfg.outputs, Key: key }));
  if (head.ContentLength !== size) throw new Error("Uploaded video size does not match the rendered file.");
  return size;
}

export async function deleteOutputs(keys) {
  if (!keys.length) return;
  await client.send(new DeleteObjectsCommand({ Bucket: cfg.outputs, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
}

/** Attempt keys under renders/<jobId>/ other than `keep`, so losing or crashed attempts can be deleted. */
export async function otherAttempts(jobId, keep) {
  const found = await list(cfg.outputs, `renders/${jobId}/`);
  return found.map((item) => item.key).filter((key) => key !== keep);
}
