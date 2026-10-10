#!/usr/bin/env node
// seek_safety.mjs — proves a composition renders the SAME frame no matter how the playhead got there.
// Rule: gm-skill-authoring/references/shared-craft.md → Determinism. A render seeks frames in any order
// (parallel workers, retries), so state that depends on the path the playhead took produces wrong frames.
//
//   node seek_safety.mjs --project <dir> [--n 12] [--at 0.5,2,3.1] [--fresh 3] [--json out.json]
//
// Screenshots the page at N times (evenly spaced, always including the first and last frame), then again in
// REVERSE order and a fixed SHUFFLED order inside the same page, then for --fresh times in a brand-new page
// that jumps straight to that time. Every repeat must be byte-identical to the forward pass.
// Exit 1 on any mismatch. Zero npm dependencies (Node >= 22).

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { withComposition } from "./lib/hf_page.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const project = flag("project", null), url = flag("url", null);
if (!project && !url) { console.error("usage: seek_safety.mjs (--project <dir> | --url <comp url>) [--n 12] [--at t1,t2] [--fresh 3] [--json out.json]"); process.exit(2); }
const open = (extra = {}) => ({ ...(url ? { url } : { project: resolve(project) }), ...extra });
const sha = (buf) => createHash("sha1").update(buf).digest("hex").slice(0, 12);
const forward = new Map(), mismatches = [];

(async () => {
  let times, duration;
  await withComposition(open(), async (page) => {
    duration = page.dims.d;
    const n = Number(flag("n", 12));
    times = argv.includes("--frames") ? Array.from({ length: Math.round(duration * 30) }, (_, i) => i / 30) : flag("at", null) ? flag("at").split(",").map(Number)
      : Array.from({ length: n }, (_, i) => Math.round((i / (n - 1)) * Math.max(0, duration - 1 / 30) * 1000) / 1000);
    for (const t of times) { await page.seek(t); forward.set(t, sha(await page.screenshot())); }
    // reverse, then a fixed shuffle (LCG) — same page, so any leaked state shows up
    const order = [["reverse", [...times].reverse()], ["shuffled", (() => { const a = [...times]; let s = 12345; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; })()]];
    for (const [name, seq] of order) {
      for (const t of seq) { await page.seek(t); const h = sha(await page.screenshot()); if (h !== forward.get(t)) mismatches.push({ pass: name, t, forward: forward.get(t), got: h }); }
    }
  });
  const frozen = argv.includes("--require-motion") && new Set(forward.values()).size < 2;
  if (frozen) console.error("FAIL: the motion fixture produced only one distinct frame; a frozen or blank render cannot prove seek safety.");
  const fresh = Math.min(Number(flag("fresh", 3)), times.length);
  const picks = [times[times.length - 1], times[Math.floor(times.length / 2)], times[Math.min(1, times.length - 1)]].slice(0, fresh);
  for (const t of picks) {
    await withComposition(open(), async (page) => {
      await page.seek(t);
      const h = sha(await page.screenshot());
      if (h !== forward.get(t)) mismatches.push({ pass: "fresh-page", t, forward: forward.get(t), got: h });
    });
  }
  console.log(`SEEK SAFETY  ${times.length} times over ${duration}s: forward, reverse, shuffled, plus ${picks.length} fresh page(s) jumping straight to ${picks.join(", ")}s`);
  if (!mismatches.length && !frozen) console.log("PASS  every repeat is byte-identical to the forward pass");
  for (const m of mismatches) console.log(`  FAIL  ${m.pass.padEnd(10)} t=${m.t}s  forward ${m.forward}  got ${m.got}`);
  if (mismatches.length) console.log(`GATE: FAIL  ${mismatches.length} frame(s) depend on how the playhead arrived. Typical causes: relative (+=) tweens, from() without immediateRender control, onUpdate/onComplete side effects, Math.random, CSS transitions.`);
  const jsonOut = flag("json", null);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ project, duration, times, mismatches, frozen }, null, 2));
  process.exit(mismatches.length || frozen ? 1 : 0);
})().catch((e) => { console.error("seek_safety: " + e.message); process.exit(2); });
