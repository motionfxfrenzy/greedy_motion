// Publishes the gallery's media and writes the catalog manifest.
//   node scripts/publish-gallery.mjs
// Reads var/gallery-src/<id>.mp4 and <id>.jpg (scripts/build-gallery-previews.mjs), makes each poster a WebP, and names
// every file <id>.<first 8 hex of its sha256>.<ext>: a name that never changes meaning, so it can be cached for a year.
// With R2_ENDPOINT, the access keys and GALLERY_BUCKETS (or R2_MEDIA_BUCKET) set, files go to `gallery/<name>` in each
// bucket (skipping any already there). Without them they are copied to var/gallery, which the local backend serves.
// Writes packages/contracts/src/gallery-previews.json: { "<id>": { "video"?: name, "poster": name, "reference"?: name } }.
// `reference` is the clip's source (index.html) for hand-built scenes; the backend serves it as plain text.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "var/gallery-src");
const local = join(root, "var/gallery");
// GALLERY_BUCKETS is a comma list (the same files go to each environment's media bucket); default: R2_MEDIA_BUCKET.
const buckets = (process.env.GALLERY_BUCKETS || process.env.R2_MEDIA_BUCKET || process.env.R2_UPLOADS_BUCKET || "").split(",").map((name) => name.trim()).filter(Boolean);
const remote = process.env.R2_ENDPOINT && buckets.length && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY;
const client = remote ? new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } }) : null;
const types = { mp4: "video/mp4", webp: "image/webp", html: "text/html" };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 8);
await mkdir(local, { recursive: true });

/** At most this many uploads in flight (each file goes to every bucket). */
const LIMIT = 8;
let active = 0;
const waiting = [];
const slot = async (work) => {
  if (active >= LIMIT) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try { return await work(); } finally { active--; waiting.shift()?.(); }
};
const manifest = {};
let uploaded = 0, kept = 0, bytes = 0;
async function put(id, kind, ext, data) {
  const name = `${id}.${sha(data)}.${ext}`;
  bytes += data.length;
  if (client) {
    const key = `gallery/${name}`;
    await Promise.all(buckets.map((Bucket) => slot(async () => {
      const there = await client.send(new HeadObjectCommand({ Bucket, Key: key })).then(() => true, () => false);
      if (there) kept++;
      else { await client.send(new PutObjectCommand({ Bucket, Key: key, Body: data, ContentType: types[ext], CacheControl: "public, max-age=31536000, immutable" })); uploaded++; }
    })));
  } else { await writeFile(join(local, name), data); uploaded++; }
  (manifest[id] ??= {})[kind] = name;
}

/** Delivery clip: 480 px wide, 24 fps, no audio, tuned for flat graphics and text. The card shows it at 250-300 px. */
async function small(file) {
  const dir = await mkdtemp(join(tmpdir(), "gallery-"));
  try {
    const out = join(dir, "clip.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(src, file), "-an", "-t", "16", "-vf", "scale=480:-2,fps=24", "-c:v", "libx264", "-preset", "veryslow", "-tune", "animation", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const files = await readdir(src);
// Encode a few files at a time (ffmpeg and sharp are CPU work), uploading as each finishes.
const jobs = files.sort().map((file) => async () => {
  const [id, ext] = [file.slice(0, file.lastIndexOf(".")), file.slice(file.lastIndexOf(".") + 1)];
  if (ext === "mp4") await put(id, "video", "mp4", await small(file));
  else if (ext === "jpg" || ext === "png") await put(id, "poster", "webp", await sharp(join(src, file)).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 70, effort: 6 }).toBuffer());
});
// The hand-built clips keep their source: scripts/gallery-scenes/<id>/index.html is published next to the clip as the
// reference code for that look, so "Use this" can hand it to the author instead of starting from nothing.
const scenes = join(root, "scripts/gallery-scenes");
for (const id of await readdir(scenes).catch(() => [])) {
  const html = await readFile(join(scenes, id, "index.html")).catch(() => null);
  if (html && files.includes(`${id}.mp4`)) jobs.push(async () => { await put(id, "reference", "html", html); });
}
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => { for (let i = cursor++; i < jobs.length; i = cursor++) await jobs[i](); }));
// A card needs a poster; an entry that has only a video is a mistake.
for (const [id, entry] of Object.entries(manifest)) if (!entry.poster) { console.error(`${id} has no poster`); process.exitCode = 1; }
await writeFile(join(root, "packages/contracts/src/gallery-previews.json"), JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))), null, 1) + "\n");
console.log(`${Object.keys(manifest).length} templates, ${(bytes / 1024 / 1024).toFixed(1)} MB; ${client ? `R2 ${buckets.join(" + ")}: ${uploaded} uploaded, ${kept} already there` : `copied to var/gallery (${uploaded} files)`}`);
