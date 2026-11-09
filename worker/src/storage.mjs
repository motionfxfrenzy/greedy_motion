// Cloudflare R2 (S3 API) for the render hand-off. The worker reads the prepared project folder from the uploads
// bucket and writes the finished MP4 to the outputs bucket; it shares no disk with the backend.
// Enabled when R2_ENDPOINT is set (STORAGE_DRIVER=r2); otherwise the worker keeps using the shared /renders folder.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export const storageEnabled = process.env.STORAGE_DRIVER === "r2";
const need = (name) => process.env[name] || (() => { throw new Error(`${name} is required when STORAGE_DRIVER=r2.`); })();
const cfg = storageEnabled
  ? { endpoint: need("R2_ENDPOINT"), accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY"), uploads: need("R2_UPLOADS_BUCKET"), outputs: need("R2_OUTPUTS_BUCKET") }
  : null;

export const S3_MAX_ATTEMPTS = 5;
export const S3_CONNECTION_TIMEOUT_MS = 10_000;
export const S3_REQUEST_TIMEOUT_MS = 120_000;

export function createS3Client(config) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE === "1",
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: S3_MAX_ATTEMPTS,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
      requestTimeout: S3_REQUEST_TIMEOUT_MS
    })
  });
}

const client = cfg ? createS3Client(cfg) : null;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DISK_FULL_MESSAGE = "The render worker ran out of disk space.";
export const DISK_FULL_CODE = "worker_disk_full";

export class DiskFullError extends Error {
  constructor(message = DISK_FULL_MESSAGE) {
    super(message);
    this.code = DISK_FULL_CODE;
    this.permanent = true;
  }
}

export function isDiskFullError(error) {
  if (!error || typeof error !== "object") return false;
  if (error instanceof DiskFullError || error.code === DISK_FULL_CODE || error.code === "ENOSPC" || error.cause?.code === "ENOSPC") return true;
  const msg = `${error.message ?? ""} ${error.cause?.message ?? ""}`;
  return /\bENOSPC\b|no space left on device|ran out of disk space/i.test(msg);
}

export function wrapDiskFull(error) {
  return isDiskFullError(error) ? new DiskFullError() : error;
}

/**
 * Cleans stale worker scratch directories in `/tmp` (`plate-*`, `render-*`, `check-*`) when a worker
 * hits disk-full (`ENOSPC`) or recovers from a crash, skipping any active scratch path in `keep`.
 */
export async function cleanTempScratchDirs(tmpRoot = "/tmp", { keep = new Set() } = {}) {
  const removed = [];
  const entries = await readdir(tmpRoot).catch(() => []);
  const scratchPattern = /^(?:plate-|render-|check-|hf-|.+\.part\.[a-f0-9-]+$)/i;
  for (const name of entries) {
    if (!scratchPattern.test(name)) continue;
    const full = join(tmpRoot, name);
    if (keep.has(full) || keep.has(name)) continue;
    await rm(full, { recursive: true, force: true }).catch(() => undefined);
    removed.push(full);
  }
  return removed;
}

export function isTransientStorageError(error) {
  if (!error || typeof error !== "object") return false;
  if (isDiskFullError(error)) return false;
  if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404 || error.$metadata?.httpStatusCode === 403 || error.$metadata?.httpStatusCode === 400) {
    return false;
  }
  const status = error?.$metadata?.httpStatusCode ?? error?.statusCode ?? error?.status;
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600)) return true;
  const nameOrCode = `${error?.name ?? ""} ${error?.code ?? ""} ${error?.cause?.code ?? ""}`;
  if (/\b(SlowDown|RequestTimeout|RequestTimeoutException|RequestLimitExceeded|InternalError|ServiceUnavailable|BadGateway|GatewayTimeout|Throttling|ThrottlingException|NetworkingError|TimeoutError|AbortError|SocketError|EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNABORTED|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_[A-Z0-9_]+)\b/i.test(nameOrCode)) {
    return true;
  }
  const msg = `${error?.message ?? ""} ${error?.cause?.message ?? ""}`;
  return /\b(EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_[A-Z0-9_]+|socket hang up|premature close|other side closed|terminated|fetch failed|timeout|timed out|size does not match)\b/i.test(msg);
}

/** Retries transient S3/stream failures up to `tries` (default 4) with capped full-jitter backoff (0.5 s .. 15 s). */
export async function withStorageRetry(fn, { tries = 4, baseDelayMs = 500, maxDelayMs = 15_000, sleepImpl = defaultSleep, randomImpl = Math.random } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (isDiskFullError(error)) throw wrapDiskFull(error);
      if (attempt >= tries || !isTransientStorageError(error)) throw error;
      const cap = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const delay = Math.max(1, Math.floor(randomImpl() * cap));
      await sleepImpl(delay);
    }
  }
}

function guardStream(s) {
  if (s && typeof s.on === "function") {
    s.on("error", () => {});
  }
  return s;
}

/**
 * Pipes `readable` to `file` safely: attaches error guards to both streams so no unhandled stream error event can fire,
 * and on any failure destroys the source stream, deletes the partial local file at `file`, and converts ENOSPC to DiskFullError.
 */
export async function pipeToFile(readable, file) {
  guardStream(readable);
  try {
    await mkdir(dirname(file), { recursive: true });
    const out = guardStream(createWriteStream(file));
    await pipeline(readable, out);
    return file;
  } catch (error) {
    readable?.destroy?.();
    await rm(file, { force: true }).catch(() => undefined);
    throw wrapDiskFull(error);
  }
}

/**
 * Downloads an S3 object to `file`, deleting any partial local file if the stream fails or size mismatches,
 * and retrying transient failures up to 4 tries with capped jittered backoff.
 */
export async function downloadAtomic(s3Client, bucket, key, file, { retryOpts } = {}) {
  return withStorageRetry(async () => {
    let response;
    try {
      await mkdir(dirname(file), { recursive: true });
      response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      await pipeToFile(response.Body, file);
      if (typeof response.ContentLength === "number" && response.ContentLength >= 0) {
        const st = await stat(file);
        if (st.size !== response.ContentLength) {
          await rm(file, { force: true }).catch(() => undefined);
          throw Object.assign(new Error(`Downloaded file size (${st.size}) does not match ContentLength (${response.ContentLength}).`), { code: "ECONNRESET" });
        }
      }
      return file;
    } catch (error) {
      response?.Body?.destroy?.();
      await rm(file, { force: true }).catch(() => undefined);
      throw wrapDiskFull(error);
    }
  }, retryOpts);
}

/**
 * Uploads `file` to `bucket/key` and verifies `HeadObject` `ContentLength === size` before returning.
 * If a partial/corrupted upload lands (`head.ContentLength !== size`), deletes the partial object before throwing/retrying
 * so no half-written object is ever left in storage or treated as complete.
 */
export async function uploadWithVerify(s3Client, bucket, file, key, contentType, { errorMsg = "Uploaded file size does not match.", retryOpts } = {}) {
  const { size } = await stat(file);
  return withStorageRetry(async () => {
    const body = guardStream(createReadStream(file));
    try {
      await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: size, ContentType: contentType }));
    } finally {
      body.destroy?.();
    }
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (!head || head.ContentLength !== size) {
      await s3Client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: [{ Key: key }] } })).catch(() => undefined);
      throw new Error(errorMsg);
    }
    return { size };
  }, retryOpts);
}

async function list(bucket, prefix, s3Client = client, retryOpts) {
  const keys = [];
  let token;
  do {
    const page = await withStorageRetry(
      () => s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })),
      retryOpts
    );
    for (const item of page.Contents ?? []) keys.push({ key: item.Key, size: item.Size });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Downloads every object under `prefix` (uploads bucket) into `dir`, refusing any key that would escape it. */
export async function downloadProject(prefix, dir, { s3Client = client, buckets = cfg, retryOpts } = {}) {
  if (!/^jobs\/[a-f0-9-]{36}\/project$/i.test(prefix)) throw new Error("Invalid project prefix.");
  const objects = await list(buckets.uploads, `${prefix}/`, s3Client, retryOpts);
  if (!objects.length) throw new Error("The prepared storyboard folder is missing in storage.");
  const root = resolve(dir);
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < objects.length; i = next++) {
      const target = resolve(root, objects[i].key.slice(prefix.length + 1));
      if (!target.startsWith(root + sep)) throw new Error("Unsafe object key.");
      await downloadAtomic(s3Client, buckets.uploads, objects[i].key, target, { retryOpts });
    }
  };
  await Promise.all(Array.from({ length: 6 }, lane));
  return objects.length;
}

/** Uploads the finished MP4 and verifies the stored size before the caller commits the key. */
export async function uploadOutput(file, key, { s3Client = client, buckets = cfg, retryOpts } = {}) {
  const { size } = await uploadWithVerify(s3Client, buckets.outputs, file, key, "video/mp4", {
    errorMsg: "Uploaded video size does not match the rendered file.",
    retryOpts
  });
  return size;
}

export async function deleteOutputs(keys, { s3Client = client, buckets = cfg, retryOpts } = {}) {
  if (!keys.length) return;
  await withStorageRetry(
    () => s3Client.send(new DeleteObjectsCommand({ Bucket: buckets.outputs, Delete: { Objects: keys.map((Key) => ({ Key })) } })),
    retryOpts
  );
}

/** Attempt keys under renders/<jobId>/ other than `keep`, so losing or crashed attempts can be deleted. */
export async function otherAttempts(jobId, keep, { s3Client = client, buckets = cfg, retryOpts } = {}) {
  const found = await list(buckets.outputs, `renders/${jobId}/`, s3Client, retryOpts);
  return found.map((item) => item.key).filter((key) => key !== keep);
}

/** One small file in the outputs bucket (a story film's work folder, kept so a comment can repaint a single scene). */
export async function putFile(key, file, type = "application/gzip", { s3Client = client, buckets = cfg, retryOpts } = {}) {
  const { size } = await stat(file);
  if (!storageEnabled && !s3Client) {
    const outDir = process.env.RENDER_OUTPUT_DIR || "/renders";
    const target = resolve(outDir, key);
    const src = guardStream(createReadStream(file));
    try {
      await pipeToFile(src, target);
      const written = await stat(target);
      if (written.size !== size) {
        await rm(target, { force: true }).catch(() => undefined);
        throw new Error("Uploaded file size does not match.");
      }
      return size;
    } finally {
      src.destroy?.();
    }
  }
  await uploadWithVerify(s3Client, buckets.outputs, file, key, type, {
    errorMsg: "Uploaded file size does not match.",
    retryOpts
  });
  return size;
}

/** Downloads one outputs-bucket object to `file`; returns false when it does not exist. */
export async function getFile(key, file, { s3Client = client, buckets = cfg, retryOpts } = {}) {
  if (!storageEnabled && !s3Client) {
    const outDir = process.env.RENDER_OUTPUT_DIR || "/renders";
    const source = resolve(outDir, key);
    if (!(await stat(source).then(() => true, () => false))) return false;
    const src = guardStream(createReadStream(source));
    try {
      await pipeToFile(src, file);
      return true;
    } finally {
      src.destroy?.();
    }
  }
  try {
    await downloadAtomic(s3Client, buckets.outputs, key, file, { retryOpts });
    return true;
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

// ---------- Plate artifacts (worker/src/plates.mjs) ----------
// The backend writes authored sources, bundles, manifests and audio to the uploads bucket; the worker writes stills, scene
// clips and finished exports to the outputs bucket. Keys are checked against one shape, so a row can never point the worker
// at another project's objects or outside the plate folders.
const PLATE_KEY = /^plates\/([a-f0-9-]{36})\/[A-Za-z0-9_./-]+$/i;
export const plateKeyOk = (key, projectId) => typeof key === "string" && !key.includes("..") && PLATE_KEY.exec(key)?.[1] === projectId;

async function toFile(bucket, key, file, opts) {
  return downloadAtomic(opts?.s3Client ?? client, bucket, key, file, { retryOpts: opts?.retryOpts });
}
export const downloadPlateInput = (key, file, opts) => toFile((opts?.buckets ?? cfg).uploads, key, file, opts);
export const downloadPlateOutput = (key, file, opts) => toFile((opts?.buckets ?? cfg).outputs, key, file, opts);

/** Uploads to the outputs bucket and verifies the stored size before the caller publishes the key. */
export async function uploadPlateOutput(file, key, contentType, { s3Client = client, buckets = cfg, retryOpts } = {}) {
  const { size } = await uploadWithVerify(s3Client, buckets.outputs, file, key, contentType, {
    errorMsg: "Uploaded file size does not match.",
    retryOpts
  });
  return size;
}
