// Uploads the gallery preview files the catalog names but the bucket lacks (never overwrites; names are content-addressed).
//   R2_ENDPOINT=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_MEDIA_BUCKET=… node scripts/upload-missing-gallery.mjs
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const root = resolve(import.meta.dirname, "..");
const { R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_MEDIA_BUCKET: bucket } = process.env;
if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new Error("Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_MEDIA_BUCKET.");
const client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
const types = { mp4: "video/mp4", webp: "image/webp", jpg: "image/jpeg", html: "text/html" };
const manifest = JSON.parse(await readFile(join(root, "packages/contracts/src/gallery-previews.json"), "utf8"));
const names = [...new Set(Object.values(manifest).flatMap((entry) => Object.values(entry)).filter((value) => typeof value === "string"))];
let uploaded = 0, present = 0;
for (const name of names) {
  const Key = `gallery/${name}`;
  const exists = await client.send(new HeadObjectCommand({ Bucket: bucket, Key })).then(() => true, () => false);
  if (exists) { present += 1; continue; }
  const body = await readFile(join(root, "var/gallery", name));
  await client.send(new PutObjectCommand({ Bucket: bucket, Key, Body: body, ContentType: types[name.split(".").pop()] ?? "application/octet-stream", CacheControl: "public, max-age=31536000, immutable" }));
  uploaded += 1;
  console.log("uploaded", name);
}
console.log(`${names.length} files in the catalog: ${present} already there, ${uploaded} uploaded to ${bucket}.`);
