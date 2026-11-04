// Phase 0 Job A: runs inside videosaas-worker:plates-e2e (--network none) to capture Linux reference frames
// using the image's /app/plate-engine/capture.mjs (openScene).
// Usage inside container: node /tools/linux-ref.mjs /p0 /out [extraNamesJson]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const [p0 = "/p0", out = "/out", extraArg = ""] = process.argv.slice(2);
const { openScene } = await import("/app/plate-engine/capture.mjs");
mkdirSync(out, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");

const index = JSON.parse(readFileSync(join(p0, "index.json"), "utf8")).filter((s) => !s.error);
const jobs = [];
for (const s of index) {
  jobs.push({ name: s.name, frames: Object.keys(s.refs).map(Number).sort((a, b) => a - b) });
}
for (const name of ["foxparamsA", "foxparamsB"]) {
  if (existsSync(join(p0, `${name}.html`))) jobs.push({ name, frames: [0, 45] });
}
if (existsSync(join(p0, "job-b.json"))) {
  for (const s of JSON.parse(readFileSync(join(p0, "job-b.json"), "utf8"))) {
    jobs.push({ name: s.name, frames: Object.keys(s.refs).map(Number).sort((a, b) => a - b) });
  }
}
if (extraArg) {
  for (const item of JSON.parse(extraArg)) jobs.push(item);
}

const manifest = [];
for (const job of jobs) {
  const htmlPath = join(p0, `${job.name}.html`);
  const session = await openScene(htmlPath, { pages: 1 });
  const meta = await session.meta();
  const refs = {};
  for (const n of job.frames) {
    const png = await session.frame(n, 0);
    writeFileSync(join(out, `${job.name}-ref-${n}.png`), png);
    refs[n] = sha(png);
  }
  await session.close();
  manifest.push({ name: job.name, frames: job.frames, meta, refs });
  console.log("linux-ref ok", job.name, job.frames.join(","));
}
writeFileSync(join(out, "linux-index.json"), JSON.stringify(manifest, null, 1));
