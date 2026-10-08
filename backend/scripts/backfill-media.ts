// One-off copy of the backend's media directories (projects, brands, audio) into the R2 media bucket
// (MEDIA-03), under the same keys media.ts uses. Safe to re-run: a file already in R2 with the same MD5 is
// skipped. Exits non-zero unless every local file ends up in R2 byte-identical.
//
//   node --env-file=.env scripts/backfill-media.ts [--dry-run]
//
// On Railway: railway ssh -e staging -s backend -- node backend/scripts/backfill-media.ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../src/config.ts";
import { mediaKey } from "../src/media.ts";

const dryRun = process.argv.includes("--dry-run");
const r2 = config.r2;
if (!r2) throw new Error("STORAGE_DRIVER=r2 and the R2_* variables are required.");
const client = new S3Client({ region: "auto", endpoint: r2.endpoint, credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey } });

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && !entry.name.endsWith(".part")) yield path;
  }
}

const remoteMd5 = (key: string) =>
  client.send(new HeadObjectCommand({ Bucket: r2.mediaBucket, Key: key })).then((head) => head.ETag?.replaceAll('"', "") ?? null, () => null);

const files: string[] = [];
for (const root of [config.projectsDir, config.brandsDir, config.audioDir]) for await (const file of walk(root)) files.push(file);
console.log(`${files.length} files under ${[config.projectsDir, config.brandsDir, config.audioDir].join(", ")} -> ${r2.mediaBucket}`);

const counts = { copied: 0, present: 0, failed: 0 };
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let i = next++; i < files.length; i = next++) {
    const file = files[i]!;
    const key = mediaKey(file);
    try {
      const bytes = await readFile(file);
      const md5 = createHash("md5").update(bytes).digest("hex");
      if ((await remoteMd5(key)) === md5) { counts.present++; continue; }
      if (dryRun) { console.log(`would copy ${key}`); counts.copied++; continue; }
      await client.send(new PutObjectCommand({ Bucket: r2.mediaBucket, Key: key, Body: createReadStream(file), ContentLength: bytes.length }));
      if ((await remoteMd5(key)) !== md5) throw new Error("checksum differs after upload");
      counts.copied++;
    } catch (error) {
      counts.failed++;
      console.error(`FAILED ${key}: ${error instanceof Error ? error.message : error}`);
    }
  }
}));
console.log(JSON.stringify({ dryRun, total: files.length, ...counts }));
if (counts.failed) process.exit(1);
