#!/usr/bin/env node
// verify_example.mjs — builds one recipe example into a throwaway HyperFrames project and runs every gate on it:
//   1. `hyperframes check`            (lint, runtime, layout, motion, contrast; zero errors required)
//   2. seek_safety.mjs                (same frame whatever order the playhead arrives in)
//   3. text_size_gate.mjs             (legibility floors)
//   4. screenshots at --at times      (PNG per time, for a contact sheet)
//
//   node verify_example.mjs <example name | path.html> [--at 0.5,2,4] [--out <dir>] [--keep] [--skip-seek]
//
// The project is created in a temp dir with the repo's pinned GSAP in ./vendor. --keep prints its path.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, "..", "..");
const GATES = join(SKILLS, "gm-skill-authoring", "scripts");
const { repoRoot, withComposition } = await import(join(GATES, "lib", "hf_page.mjs"));

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes("--" + n);
const target = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--at" && argv[argv.indexOf(a) - 1] !== "--out");
if (!target) { console.error("usage: verify_example.mjs <example name | path.html> [--at t1,t2] [--out dir] [--keep] [--skip-seek]"); process.exit(2); }

const file = existsSync(target) ? resolve(target) : join(HERE, "..", "examples", target.replace(/\.html$/, "") + ".html");
if (!existsSync(file)) { console.error("example not found: " + file); process.exit(2); }
const name = basename(file, ".html");

const dir = mkdtempSync(join(tmpdir(), `recipe-${name}-`));
mkdirSync(join(dir, "vendor"));
const gsap = [join(repoRoot ?? "", "worker/node_modules/gsap/dist/gsap.min.js"), join(SKILLS, "gm-feature-explainer/template/vendor/gsap.min.js")].find(existsSync);
if (!gsap) { console.error("no GSAP file found"); process.exit(2); }
cpSync(gsap, join(dir, "vendor", "gsap.min.js"));
cpSync(file, join(dir, "index.html"));
writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }));
writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: name, name }));

const cli = join(repoRoot, "worker", "node_modules", ".bin", "hyperframes");
const run = (label, cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: dir, ...opts });
  const out = (r.stdout || "") + (r.stderr || "");
  console.log(`\n=== ${label}  (exit ${r.status})`);
  console.log(out.trim().split("\n").slice(-14).join("\n"));
  return r.status === 0;
};

let ok = true;
// check: errors fail; the sub-composition lint warning is a style note for single-file examples
const checkRes = spawnSync(cli, ["check"], { encoding: "utf8", cwd: dir });
const checkOut = (checkRes.stdout || "") + (checkRes.stderr || "");
console.log("\n=== hyperframes check  (exit " + checkRes.status + ")");
console.log(checkOut.trim().split("\n").filter((l) => /error|warning|✗|⚠|◇|passed|failed/i.test(l)).join("\n"));
ok = checkRes.status === 0 && ok;

if (!has("skip-seek")) ok = run("seek_safety", "node", [join(GATES, "seek_safety.mjs"), "--project", dir, "--n", "10"]) && ok;
ok = run("text_size_gate", "node", [join(GATES, "text_size_gate.mjs"), "--project", dir, "--step", "0.25"]) && ok;

const outDir = resolve(flag("out", join(tmpdir(), `recipe-${name}-frames`)));
mkdirSync(outDir, { recursive: true });
const at = flag("at", null);
await withComposition({ project: dir }, async (page) => {
  const times = at ? at.split(",").map(Number) : [0.25, 0.5, 0.75].map((f) => Math.round(f * page.dims.d * 1000) / 1000);
  for (const t of times) { await page.seek(t); writeFileSync(join(outDir, `${name}-${String(t).replace(".", "_")}s.png`), await page.screenshot()); }
  console.log(`\n=== screenshots: ${times.length} frame(s) in ${outDir}`);
});

if (has("keep")) console.log("\nproject kept at " + dir);
console.log(ok ? `\nVERIFY ${name}: PASS` : `\nVERIFY ${name}: FAIL`);
process.exit(ok ? 0 : 1);
