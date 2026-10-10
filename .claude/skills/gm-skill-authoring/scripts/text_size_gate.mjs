#!/usr/bin/env node
// text_size_gate.mjs — the legibility gate: no text meant to be read is smaller than the floor.
// Rule: gm-skill-authoring/references/shared-craft.md → Legibility.  Zero npm dependencies (Node >= 22).
//
// Drives chrome-headless-shell over raw CDP against `hyperframes preview`, seeks the composition
// timeline every --step seconds, and measures every visible text node's EFFECTIVE on-screen font size
// (the size the viewer sees after every ancestor scale, zoom and 2D/3D transform).
//
//   floors (fractions of the SHORTER canvas edge, so 16:9 and 9:16 are held to one standard)
//     caption     5.2%  = 56 px on a 1080 edge   narrative subtitles / verbatim captions
//     supporting  3.0%  = 32 px on a 1080 edge   everything else that is meant to be read (default role)
//     decorative  exempt                          declared texture, e.g. faux-UI copy that is not meant to be read
//   A violation counts only when the same text stays under its floor for >= --min-seconds (0.4 s):
//   entrance scale-ups and deliberate flashes are not read, so they are not gated.
//
//   role comes from the nearest `data-text-role="caption|supporting|decorative"` (alias: mock) on the text or an
//   ancestor; with none, an ancestor whose id/class matches caption|subtitle is a caption, else supporting.
//
//   node text_size_gate.mjs --project <dir> [--step 0.2] [--at 1.5,4] [--json out.json] [--no-gate]
//   node text_size_gate.mjs --url <preview comp url>          reuse a running preview server
//   node text_size_gate.mjs --self-test                       builds a fixture, proves the gate can fail AND pass
//
// Exit 1 when any text breaks a floor (unless --no-gate). Not measured: text baked into <video>/<canvas>/images.
// Text under perspective (3D tilt) is measured from the transform matrix and marked `approx`.

import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, withComposition } from "./lib/hf_page.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes("--" + n);
const HERE = dirname(fileURLToPath(import.meta.url));

const CAPTION_FRAC = Number(flag("caption-min", 0.052));
const SUPPORT_FRAC = Number(flag("text-min", 0.03));
const STEP = Number(flag("step", 0.2));
const MIN_SECONDS = Number(flag("min-seconds", 0.4));
const TOL_PX = 0.6; // rect rounding slack

// ---------- in-page measurer ----------
// Returns every visible text node's effective font size at the current seek time.
const MEASURER = `(() => {
  const root = document.querySelector("[data-composition-id]") || document.body;
  const W = Number(root.getAttribute("data-width")) || innerWidth, H = Number(root.getAttribute("data-height")) || innerHeight;
  const probeCache = new Map();
  const rho = (cs) => { // content-area height of one em of THIS font, measured untransformed
    const key = [cs.fontFamily, cs.fontWeight, cs.fontStyle, cs.fontStretch, cs.fontVariationSettings].join("|");
    if (probeCache.has(key)) return probeCache.get(key);
    const s = document.createElement("span");
    s.textContent = "Hxg";
    s.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;white-space:nowrap;line-height:normal;letter-spacing:normal;text-transform:none;font-size:100px;font-family:" + cs.fontFamily + ";font-weight:" + cs.fontWeight + ";font-style:" + cs.fontStyle + ";font-stretch:" + cs.fontStretch + ";font-variation-settings:" + cs.fontVariationSettings;
    document.body.appendChild(s);
    const r = document.createRange(); r.selectNodeContents(s);
    const h = r.getBoundingClientRect().height / 100;
    s.remove();
    probeCache.set(key, h || 1.2);
    return h || 1.2;
  };
  const pathOf = (el) => {
    const parts = []; let n = el, d = 0;
    while (n && n.nodeType === 1 && d < 4) {
      let p = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(p + "#" + n.id); break; }
      const c = (n.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean)[0];
      if (c) p += "." + c;
      parts.unshift(p); n = n.parentElement; d++;
    }
    return parts.join(" > ");
  };
  const out = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = tw.nextNode())) {
    const text = node.nodeValue.replace(/\\s+/g, " ").trim();
    if (text.length < 1) continue;
    const el = node.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TITLE|OPTION)$/.test(el.tagName)) continue;
    // ancestors: opacity, visibility, transforms, role, clipping
    let op = 1, hidden = false, roleAttr = null, roleHint = false, axisAligned = true, matrixScale = 1, approx = false;
    const clips = [];
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden") { hidden = true; break; }
      op *= parseFloat(cs.opacity || "1");
      if (roleAttr === null && a.hasAttribute && a.hasAttribute("data-text-role")) roleAttr = a.getAttribute("data-text-role").trim().toLowerCase();
      if (/caption|subtitle/i.test((a.id || "") + " " + (a.getAttribute("class") || ""))) roleHint = true;
      if (cs.transform && cs.transform !== "none") {
        const m = new DOMMatrix(cs.transform);
        const threeD = !m.is2D;
        if (threeD && (Math.abs(m.m31) > 1e-6 || Math.abs(m.m32) > 1e-6 || Math.abs(m.m13) > 1e-6 || Math.abs(m.m23) > 1e-6 || Math.abs(m.m14) > 1e-6 || Math.abs(m.m24) > 1e-6 || Math.abs(m.m34) > 1e-6)) { axisAligned = false; approx = true; }
        if (Math.abs(m.m12) > 1e-3 || Math.abs(m.m21) > 1e-3) axisAligned = false;
        matrixScale *= Math.hypot(m.m21, m.m22);
      }
      if (cs.perspective && cs.perspective !== "none") { axisAligned = false; approx = true; }
      if (cs.scale && cs.scale !== "none") { const p = cs.scale.split(" ").map(Number); matrixScale *= (p[1] ?? p[0]) || 1; }
      if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible") clips.push(a);
    }
    if (hidden) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    const r0 = rects[0];
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize);
    // A = font-size x every ancestor's vertical scale (exact for transforms and the scale property).
    // B = the rendered line rect over this font's untransformed em height (catches CSS zoom, SVG viewBox
    // scaling and anything A does not model, but the browser rounds font metrics: +-3% at small sizes).
    // Use A when B agrees within 6%, else B; with rotation or 3D only A is valid.
    const estA = fontSize * matrixScale, estB = r0.height / rho(cs);
    const px = !axisAligned ? estA : Math.abs(estA - estB) / Math.max(estA, 1) <= 0.06 ? estA : estB;
    // on screen and not clipped away (use the union of line rects)
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const r of rects) { L = Math.min(L, r.left); T = Math.min(T, r.top); R = Math.max(R, r.right); B = Math.max(B, r.bottom); }
    const area = (R - L) * (B - T);
    const inter = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
    let vis = (inter(L, R, 0, W) * inter(T, B, 0, H)) / (area || 1);
    for (const c of clips) { const cr = c.getBoundingClientRect(); vis = Math.min(vis, (inter(L, R, cr.left, cr.right) * inter(T, B, cr.top, cr.bottom)) / (area || 1)); }
    const role = roleAttr === "mock" ? "decorative" : roleAttr || (roleHint ? "caption" : "supporting");
    out.push({ key: pathOf(el) + " | " + text.slice(0, 48), sel: pathOf(el), text: text.slice(0, 60), role, px: Math.round(px * 10) / 10, fontSize, op: Math.round(op * 100) / 100, vis: Math.round(vis * 100) / 100, approx });
  }
  return { W, H, texts: out };
})()`;

// ---------- run ----------
async function measureProject(opts) {
  return withComposition({ ...opts, width: Number(flag("width", 1920)), height: Number(flag("height", 1080)), duration: flag("duration", 0), serverCmd: flag("server-cmd", undefined) }, async (page) => {
    const duration = page.dims.d;
    if (!duration) throw new Error("composition duration unknown: set data-duration on the root or pass --duration");
    const times = flag("at", null) ? flag("at").split(",").map(Number) : Array.from({ length: Math.floor((duration - 1e-6) / STEP) + 1 }, (_, i) => Math.round(i * STEP * 1000) / 1000);
    const samples = [];
    for (const t of times) { await page.seek(t); samples.push({ t, ...(await page.ev(MEASURER)) }); }
    return { duration, samples, dims: page.dims };
  });
}

// ---------- evaluate ----------
function evaluate({ samples, duration }) {
  const W = samples[0].W, H = samples[0].H, S = Math.min(W, H);
  const floors = { caption: Math.round(CAPTION_FRAC * S), supporting: Math.round(SUPPORT_FRAC * S) };
  const runs = new Map(); // key -> {role, text, sel, approx, current:{start,end,min,n}, done:[]}
  const stats = { caption: { min: Infinity, texts: new Set() }, supporting: { min: Infinity, texts: new Set() }, exempt: new Set() };
  for (const s of samples) {
    const seen = new Set();
    for (const x of s.texts) {
      if (x.op < 0.6 || x.vis < 0.6) continue; // not readable at this instant (fading, clipped, off screen)
      if (x.role === "decorative") { stats.exempt.add(x.key); continue; }
      const role = x.role === "caption" ? "caption" : "supporting";
      stats[role].min = Math.min(stats[role].min, x.px); stats[role].texts.add(x.key);
      const bad = x.px < floors[role] - TOL_PX;
      let r = runs.get(x.key);
      if (!r) { r = { role, text: x.text, sel: x.sel, approx: x.approx, cur: null, done: [] }; runs.set(x.key, r); }
      seen.add(x.key);
      if (bad) {
        if (!r.cur) r.cur = { start: s.t, end: s.t, min: x.px, n: 0 };
        r.cur.end = s.t; r.cur.min = Math.min(r.cur.min, x.px); r.cur.n++;
      } else if (r.cur) { r.done.push(r.cur); r.cur = null; }
    }
    for (const [k, r] of runs) if (!seen.has(k) && r.cur) { r.done.push(r.cur); r.cur = null; }
  }
  const findings = [];
  const stepSeen = samples.length > 1 ? samples[1].t - samples[0].t : STEP;
  for (const r of runs.values()) {
    if (r.cur) { r.done.push(r.cur); r.cur = null; }
    for (const c of r.done) {
      const span = c.end - c.start + stepSeen; // each sample stands for one step
      if (span + 1e-6 >= MIN_SECONDS) findings.push({ role: r.role, from: c.start, to: Math.round((c.end + stepSeen) * 100) / 100, px: c.min, floor: floors[r.role], text: r.text, sel: r.sel, approx: r.approx });
    }
  }
  findings.sort((a, b) => a.from - b.from);
  return { W, H, S, floors, findings, stats };
}

function report(res, duration, nSamples) {
  const { W, H, S, floors, findings, stats } = res;
  const fmt = (v) => (v === Infinity ? "n/a" : v.toFixed(1) + " px");
  console.log(`TEXT SIZE GATE  ${W}x${H}  shorter edge ${S}px  floors: caption ${floors.caption}px (${(CAPTION_FRAC * 100).toFixed(1)}%)  supporting ${floors.supporting}px (${(SUPPORT_FRAC * 100).toFixed(1)}%)`);
  console.log(`  ${nSamples} samples over ${duration}s, a violation must last >= ${MIN_SECONDS}s`);
  console.log(`  smallest read caption    ${fmt(stats.caption.min)}   (${stats.caption.texts.size} strings)`);
  console.log(`  smallest read supporting ${fmt(stats.supporting.min)}   (${stats.supporting.texts.size} strings)`);
  console.log(`  declared decorative (exempt): ${stats.exempt.size} strings`);
  if (!findings.length) { console.log("  PASS  no text under its floor"); return; }
  for (const f of findings) console.log(`  FAIL  ${f.role.padEnd(10)} ${f.from.toFixed(2)}-${f.to.toFixed(2)}s  ${f.px}px < ${f.floor}px  "${f.text}"  ${f.sel}${f.approx ? "  (approx: 3D)" : ""}`);
  console.log(`GATE: FAIL  ${findings.length} text run(s) under the floor. Enlarge the type, or declare data-text-role="decorative" only if it is truly not meant to be read.`);
}

// ---------- self-test ----------
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080">
<script src="vendor/gsap.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1920px;height:1080px;overflow:hidden;background:#101218}
#root{position:relative;width:1920px;height:1080px;background:#101218;color:#fff;font-family:Helvetica,Arial,sans-serif}
.t{position:absolute;left:80px;white-space:nowrap}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1920" data-height="1080">
 <div id="scene" class="clip" data-start="0" data-duration="4" data-track-index="0">
  <div id="cap-ok"    class="t" data-text-role="caption"    style="top:20px;font-size:64px">CAPTION OK 64</div>
  <div id="cap-floor" class="t" data-text-role="caption"    style="top:110px;font-size:56px">CAPTION AT FLOOR 56</div>
  <div id="cap-54"    class="t" data-text-role="caption"    style="top:190px;font-size:54px">CAPTION 54 BAD</div>
  <div id="cap-bad"   class="t" data-text-role="caption"    style="top:270px;font-size:44px">CAPTION BAD 44</div>
  <div id="sup-ok"    class="t"                              style="top:345px;font-size:36px">SUPPORT OK 36</div>
  <div id="sup-floor" class="t"                              style="top:405px;font-size:32px">SUPPORT AT FLOOR 32</div>
  <div id="sup-30"    class="t"                              style="top:460px;font-size:30px">SUPPORT 30 BAD</div>
  <div id="sup-bad"   class="t"                              style="top:515px;font-size:24px">SUPPORT BAD 24</div>
  <div id="sup-scaled-ok"  class="t" style="top:565px;font-size:20px;transform:scale(1.8);transform-origin:0 0">SCALED UP 20x1.8=36 OK</div>
  <div id="sup-scaled-bad" class="t" style="top:640px;font-size:40px;transform:scale(0.6);transform-origin:0 0">SCALED DOWN 40x0.6=24 BAD</div>
  <div style="position:absolute;left:0;top:700px;zoom:1.5"><div id="sup-zoom-ok" class="t" style="top:0;font-size:24px">ZOOMED 24x1.5=36 OK</div></div>
  <div id="sup-rot-bad" class="t" style="top:790px;font-size:40px;transform:rotate(-8deg) scale(0.7);transform-origin:0 0">ROTATED 40x0.7=28 BAD</div>
  <div id="mock"      class="t" data-text-role="decorative" style="top:860px;font-size:14px">decorative mock text, exempt</div>
  <div id="flash"     class="t" style="top:900px;font-size:18px;opacity:0">FLASH 18 only 0.2s</div>
  <div id="hidden"    class="t" style="top:940px;font-size:12px;opacity:0">invisible 12</div>
  <div id="caption-by-id" class="t" style="top:980px;font-size:40px"><span id="subtitle-line">HINT BY ID 40 (subtitle)</span></div>
 </div>
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.set("#flash", { opacity: 1 }, 1.0).set("#flash", { opacity: 0 }, 1.2);
tl.to({}, { duration: 4 }, 0);
window.__timelines["main"] = tl; tl.seek(0);
</script></body></html>`;

async function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "text-gate-selftest-"));
  mkdirSync(join(dir, "vendor"));
  const gsapSrc = [join(repoRoot ?? "", "worker/node_modules/gsap/dist/gsap.min.js"), join(HERE, "../../gm-feature-explainer/template/vendor/gsap.min.js")].find(existsSync);
  if (!gsapSrc) throw new Error("self-test needs a GSAP file (worker/node_modules/gsap or the gm-feature-explainer vendor copy)");
  cpSync(gsapSrc, join(dir, "vendor", "gsap.min.js"));
  writeFileSync(join(dir, "index.html"), FIXTURE);
  writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: "text-gate-selftest", name: "text-gate-selftest" }));
  const m = await measureProject({ project: dir });
  const res = evaluate(m);
  report(res, m.duration, m.samples.length);
  const failed = new Set(res.findings.map((f) => f.sel.split(" > ").pop()));
  const expectFail = ["div#cap-bad", "div#cap-54", "div#sup-bad", "div#sup-30", "div#sup-scaled-bad", "div#sup-rot-bad"];
  const expectPass = ["div#cap-ok", "div#cap-floor", "div#sup-ok", "div#sup-floor", "div#sup-scaled-ok", "div#sup-zoom-ok", "div#mock", "div#flash", "div#hidden"];
  const missing = expectFail.filter((s) => !failed.has(s));
  const wrong = expectPass.filter((s) => failed.has(s));
  // the id-hinted subtitle is a caption at 40px < 56 -> must fail too
  const hint = res.findings.some((f) => f.sel.includes("subtitle-line") && f.role === "caption");
  console.log("\nSELF-TEST");
  console.log(`  must fail   ${expectFail.concat(["span#subtitle-line (caption by id)"]).join(", ")}`);
  console.log(`  must pass   ${expectPass.join(", ")}`);
  const ok = !missing.length && !wrong.length && hint;
  console.log(ok ? "SELF-TEST: PASS  the gate fails what it should and passes what it should" : `SELF-TEST: FAIL  missed ${JSON.stringify(missing)} wrongly flagged ${JSON.stringify(wrong)} idHint=${hint}`);
  process.exit(ok ? 0 : 1);
}

// ---------- main ----------
(async () => {
  if (has("self-test")) return selfTest();
  const project = flag("project", null), url = flag("url", null);
  if (!project && !url) { console.error("usage: text_size_gate.mjs (--project <dir> | --url <comp url>) [--step 0.2] [--at t1,t2] [--json out.json] [--no-gate]  |  --self-test"); process.exit(2); }
  const m = await measureProject(url ? { url } : { project: resolve(project) });
  const res = evaluate(m);
  report(res, m.duration, m.samples.length);
  const jsonOut = flag("json", null);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ project, duration: m.duration, samples: m.samples.length, floors: res.floors, findings: res.findings, smallestCaption: res.stats.caption.min, smallestSupporting: res.stats.supporting.min, exempt: [...res.stats.exempt] }, null, 2));
  process.exit(res.findings.length && !has("no-gate") ? 1 : 0);
})().catch((e) => { console.error("text_size_gate: " + e.message); process.exit(2); });
