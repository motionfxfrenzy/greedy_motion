// Consistency gate for library-driven compositions (docs/CREATIVE_LIBRARY_PLAN.md):
//   1. determinism  — the same composition and brand, captured twice, gives byte-identical frames;
//   2. brand binding — the same composition under two different brand themes gives different frames
//                      (a composition that ignores the brand tokens fails).
// Uses `hyperframes snapshot` with the software GPU (--no-browser-gpu) so frames do not depend on hardware.
//   node scripts/check-creative.mjs [name ...]      (default: every folder in validation/creative-libraries)
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { VENDOR, vendorPath } from "./creative-vendor.mjs";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const specRoot = join(root, "validation/creative-libraries");
const THEMES = ["blue-professional", "biennale-yellow"]; // two brands with different palettes and fonts
// Spikes run 4 s; engine fixtures 12.5 s (hook underline, click ring, success underline, closing title).
const AT_FOR = (name) => (name.startsWith("engine-") ? "1.6,4.6,8.6,11.5" : "0.5,1.5,2.5,3.5");

async function stage(name, theme) {
  const dir = await mkdtemp(join(tmpdir(), `creative-${name}-`));
  await cp(join(specRoot, name), dir, { recursive: true });
  const html = await readFile(join(dir, "index.html"), "utf8");
  await cp(join(root, "worker/themes", `${theme}.css`), join(dir, "theme.css"));
  for (const file of Object.keys(VENDOR)) if (html.includes(`vendor/${file}`)) await cp(vendorPath(root, file), join(dir, "vendor", file));
  return dir;
}

async function frames(dir, label) {
  const out = join(dir, `snap-${label.split("|")[1]}`);
  await run("npx", ["--no-install", "hyperframes", "snapshot", dir, "--at", AT_FOR(label.split("|")[0]), "--no-end", "--no-browser-gpu", "--describe", "false", "-o", out], { cwd: root, maxBuffer: 1 << 24, timeout: 180_000 });
  const files = (await readdir(out)).filter((f) => f.endsWith(".png")).sort();
  return Promise.all(files.map(async (f) => createHash("sha256").update(await readFile(join(out, f))).digest("hex")));
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : (await readdir(specRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
let failed = 0;
const report = [];
for (const name of names) {
  const dirs = [];
  try {
    const a = await stage(name, THEMES[0]); dirs.push(a);
    const b = await stage(name, THEMES[1]); dirs.push(b);
    const first = await frames(a, `${name}|1`), second = await frames(a, `${name}|2`), other = await frames(b, `${name}|1`);
    const deterministic = first.length > 0 && first.length === second.length && first.every((h, i) => h === second[i]);
    const brandBound = first.length === other.length && first.some((h, i) => h !== other[i]);
    const ok = deterministic && brandBound;
    if (!ok) failed++;
    const differing = first.flatMap((h, i) => (h === second[i] ? [] : [AT_FOR(name).split(",")[i]]));
    report.push({ name, frames: first.length, deterministic, brandBound, ok, ...(differing.length ? { differingAt: differing } : {}) });
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${first.length} frames, deterministic=${deterministic}${differing.length ? ` (differs at ${differing.join(", ")} s)` : ""}, brand-bound=${brandBound}`);
    if (!deterministic) {
      // Keep both captures for inspection; they are removed on the next passing run.
      const keep = join(specRoot, "last-failure", name);
      await rm(keep, { recursive: true, force: true });
      await cp(join(a, "snap-1"), join(keep, "run-1"), { recursive: true });
      await cp(join(a, "snap-2"), join(keep, "run-2"), { recursive: true });
      console.log(`     captures kept in ${keep}`);
    }
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}: ${(error.stderr || error.message || String(error)).toString().split("\n").slice(-6).join(" | ")}`);
  } finally {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  }
}
await writeFile(join(specRoot, "last-check.json"), JSON.stringify({ checkedAt: new Date().toISOString(), themes: THEMES, report }, null, 2) + "\n");
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
