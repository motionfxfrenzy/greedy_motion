// Run after building engine fixtures: node scripts/verify-hairline.mjs
// Exercises the saved brief contract and renders each scene in all supported aspects.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { parseScriptBrief } from "../packages/contracts/src/beat-plan.ts";
import { engineVariables } from "../backend/src/plan/composition.ts";

const brief = parseScriptBrief({ scriptMode: "problem", text: "Make product releases easier to share.", durationSeconds: 30, aspect: "16:9", motionProfile: "smooth", pace: "balanced", audio: { mode: "none" }, captions: "none", template: null, theme: "neutral", look: "hairline" });
assert.ok("brief" in brief, JSON.stringify(brief));
assert.equal(brief.brief.look, "hairline");
assert.equal(engineVariables({ plan: { beats: [], canvas: "16:9", brand: { motion_profile: "smooth" }, audio: { captions: "none" } }, timing: { beats: [] }, shots: {}, brandName: "Test", look: brief.brief.look }).look, "hairline");

const root = resolve(import.meta.dirname, "..");
const output = await mkdtemp(join(tmpdir(), "hairline-verify-"));
const run = promisify(execFile);
for (const [width, height] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
  const dir = join(output, `${width}x${height}`);
  await cp(join(root, "validation/creative-libraries/engine-hairline"), dir, { recursive: true });
  await mkdir(join(dir, "vendor"), { recursive: true });
  await cp(join(root, "node_modules/gsap/dist/gsap.min.js"), join(dir, "vendor/gsap.min.js"));
  await cp(join(root, "worker/themes/blue-professional.css"), join(dir, "theme.css"));
  let html = await readFile(join(dir, "index.html"), "utf8");
  html = html.replace(/data-width="\d+"/, `data-width="${width}"`).replace(/data-height="\d+"/, `data-height="${height}"`);
  html = html.replace("</head>", `<style>#root{width:${width}px;height:${height}px}</style></head>`);
  await writeFile(join(dir, "index.html"), html);
  await run("npx", ["--no-install", "hyperframes", "snapshot", dir, "--at", "1.6,4.6,8.6,11.5", "--no-end", "--no-browser-gpu", "--describe", "false", "-o", join(dir, "snapshots")], { cwd: root, timeout: 90000, maxBuffer: 1 << 24 });
  console.log(`ok ${width}x${height}: four scene snapshots`);
}
console.log(`Snapshots: ${output}`);
