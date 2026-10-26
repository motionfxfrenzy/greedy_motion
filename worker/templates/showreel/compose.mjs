// SHOWREEL PLANNER. Turns (brand, product facts, personality, seed) into a HyperFrames project built from interchangeable modules.
// A pure function of its inputs (no clock, no random): same inputs, same film; another seed, another film.
//   const film = composeShowreel({ brand, product, personality?, hint?, purpose?, seed, seconds: 15 });
//   await writeShowreelProject(dir, film, { fontsDir, sfxDir, musicFile });
// Where things live: personalities.mjs (feel), catalogue.mjs (modules), copy.mjs (defaults), sound.mjs (sfx), palette.mjs (brand colours),
// scenes/ transitions/ core/ (the in-page engine, joined by bundle.mjs), engine.css. Docs: docs/SHOWREEL_MODULES.md.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPalette, cssVars } from "./palette.mjs";
import { FPS, mulberry, hashSeed, pickW, snap, frame } from "./lib.mjs";
import { PERSONALITIES, inferPersonality } from "./personalities.mjs";
import { MODULES, has } from "./catalogue.mjs";
import { fillCopy } from "./copy.mjs";
import { planSfx } from "./sound.mjs";
import { bundleEngine } from "./bundle.mjs";
export { PERSONALITIES, inferPersonality, hashSeed, fillCopy };

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ choosing and timing the scenes */
function chooseScenes(r, pers, product, T, beat) {
  const P = pers;
  const open = Object.fromEntries(Object.entries(P.open).filter(([m]) => has(product, MODULES[m].needs)));
  const mid = Object.fromEntries(Object.entries(P.mid).filter(([m]) => has(product, MODULES[m].needs)));
  const end = Object.fromEntries(Object.entries(P.end).filter(([m]) => has(product, MODULES[m].needs)));
  const FLOOR = { "chat-demo": 2.4, "step-path": 3, "app-fill": 2.4, "reskin-proof": 2.4, "hook-type": 2, "end-burst": 2.6, "end-sting": 2.6, "end-calm": 2.6, "end-cta": 2.6, "lines-climb": 2.2, "split-compare": 2 };
  const range = (m) => { let [a, b] = MODULES[m].sec.map((x) => Math.max(FLOOR[m] || 0, x * P.sceneScale)); b = Math.max(a + 0.4, b); if (m === "lines-stack") { a = Math.max(a, product.lines.length * 0.7); b = Math.max(b, product.lines.length * 1.05); } return [a, b]; };
  for (let attempt = 0; attempt < 400; attempt++) {
    const opener = pickW(r, open), ender = pickW(r, end), used = new Set([opener, ender]), k = P.scenes[0] - 2 + Math.floor(r() * (P.scenes[1] - P.scenes[0] + 1)), mids = [];
    for (let i = 0; i < k; i++) { const pool = Object.fromEntries(Object.entries(mid).filter(([m]) => !used.has(m))); if (!Object.keys(pool).length) break; const m = pickW(r, pool); used.add(m); mids.push(m); }
    if (mids.length < k) continue; const seq = [opener, ...mids, ender], rs = seq.map(range), lo = rs.reduce((a, x) => a + x[0], 0), hi = rs.reduce((a, x) => a + x[1], 0);
    if (lo > T || hi < T) continue;
    // start at the minimum, then hand out the slack in random order, up to each module's maximum
    const d = rs.map((x) => x[0]); let slack = T - lo; const order = seq.map((_, i) => i).sort(() => r() - 0.5);
    for (let pass = 0; pass < 6 && slack > 1e-6; pass++) for (const i of order) { const add = Math.min(rs[i][1] - d[i], slack, 0.4 + r() * 0.8); d[i] += add; slack -= add; }
    // quantise to whole beats, give the rounding error to the longest middle scene
    const q = d.map((x) => snap(x, beat)); let err = T - q.reduce((a, b) => a + b, 0), guard = 0;
    while (Math.abs(err) > 1e-6 && guard++ < 40) { const i = 1 + Math.floor(r() * Math.max(1, q.length - 2)); const step = err > 0 ? beat : -beat; if (q[i] + step >= rs[i][0] * 0.8 && q[i] + step <= rs[i][1] * 1.2) { q[i] += step; err -= step; } }
    if (Math.abs(err) > 1e-6) continue;
    return seq.map((m, i) => ({ module: m, d: q[i] }));
  }
  throw new Error("Could not fit a sequence of scenes in the length asked for.");
}

/** The words each module needs, chosen per scene (a headline pair, a line split with its accent word). */
function variantFor(r, module, P, product, pers) {
  const accentLast = (s) => { const w = s.split(" "); return w.map((x, i) => [x, i === w.length - 1]); };
  switch (module) {
    case "hook-type": return { glow: pers.P.bg === "glow-grid" || r() < 0.4, grow: null };
    case "hook-kinetic": return { kicker: r() < 0.6 };
    case "app-fill": return { fromPill: false };
    case "field-3d": return { dir: r() < 0.5 ? "r" : "l", textSide: r() < 0.5 ? "l" : "r", lines: [product.lines[0], product.lines[1] || product.features[0].title] };
    case "wall-zoom": return { line: product.wall || ["All of it,", "in one place."] };
    case "lines-stack": return { lines: product.lines.slice(0, 4).map(accentLast) };
    case "trio-cards": return { numbered: pers.key === "explainer" || r() < 0.3, style: pers.key === "bold" || pers.key === "playful" ? "pop" : "slide" };
    case "rapid-fire": return { flip: pers.key === "bold" ? r() < 0.6 : false, shift: Math.floor(r() * 4) };
    default: return {};
  }
}

/* ------------------------------------------------------------------ compose */
/**
 * input: { brand: { name, tagline, url, primary, accent?, mark? }, product: {...facts}, personality?, hint?, purpose?, seed, seconds=15, fonts? }
 * returns { plan, html, personality }
 */
export function composeShowreel(input) {
  const { brand, seed = 1, seconds = 15 } = input;
  const key = input.personality && PERSONALITIES[input.personality] ? input.personality : inferPersonality({ brand, hint: input.hint, purpose: input.purpose });
  const pers = { ...PERSONALITIES[key], key }, P = pers.P, r = mulberry(hashSeed(`${brand.name}|${seed}|${key}`));
  const beat = 60 / pers.bpm, beatF = Math.round(beat * FPS) / FPS, T = Math.round(seconds / beatF) * beatF;   // a whole number of beats, close to the length asked for
  const product = fillCopy(brand, input.product);
  const pal = buildPalette(brand, pers.mode, { deep: pers.deep, soft: pers.soft, endFlood: pers.endFlood });
  const fonts = { ...pers.fonts, ...(input.fonts || {}) };
  const seq = chooseScenes(r, pers, product, T, beatF);
  // transitions: from the personality's pool, never the same twice in a row; the end card has its own
  let t = 0, prev = null;
  const scenes = seq.map((s, i) => {
    const tr = i === 0 ? null : (i === seq.length - 1 ? pers.endTransition : (() => { let m, g = 0; do { m = pickW(r, pers.transitions); } while (m === prev && g++ < 8); return m; })());
    if (tr) prev = tr;
    const sc = { id: `sc${i}`, module: s.module, t: frame(t), d: s.d, variant: variantFor(r, s.module, P, product, pers), transition: tr ? { module: tr, d: tr === "cut" ? 0 : Math.min(frame(pers.transitionSec), s.d / 2) } : null };
    t += s.d; return sc;
  });
  const sfx = planSfx(scenes, pers.sfx, T);
  const plan = {
    version: 1, seed, duration: T, bpm: pers.bpm, beat: beatF, personality: key, W: 1920, H: 1080,
    pal, P: { ...P, drift: pers.drift }, fonts, brand: { name: brand.name, tagline: brand.tagline, url: brand.url, mark: brand.mark || brand.name.trim()[0].toUpperCase() },
    product, scenes, sfx, music: { ...pers.music, file: "assets/music.mp3" }
  };
  return { plan, personality: key };
}

/* ------------------------------------------------------------------ write a HyperFrames project */
const fontFaces = async (fontsDir, families) => {
  const css = await readFile(join(fontsDir, "fonts.css"), "utf8"), keep = css.split("\n").filter((l) => families.some((f) => l.includes(`font-family: "${f}"`)));
  const files = [...new Set(keep.flatMap((l) => [...l.matchAll(/fonts\/([a-z0-9-]+\.woff2)/g)].map((m) => m[1])))];
  return { css: keep.join("\n"), files };
};

export async function writeShowreelProject(dir, { plan }, { fontsDir, sfxDir, musicFile }) {
  await mkdir(join(dir, "assets"), { recursive: true }); await mkdir(join(dir, "fonts"), { recursive: true });
  const ff = await fontFaces(fontsDir, [plan.fonts.head, plan.fonts.body, plan.fonts.mono]);
  for (const f of ff.files) await copyFile(join(fontsDir, f), join(dir, "fonts", f));
  for (const f of new Set(plan.sfx.map((s) => s.file))) await copyFile(join(sfxDir, f), join(dir, "assets", f));
  if (musicFile) await copyFile(musicFile, join(dir, "assets/music.mp3"));
  await mkdir(join(dir, "vendor"), { recursive: true });
  await copyFile(join(HERE, "../../node_modules/gsap/dist/gsap.min.js"), join(dir, "vendor/gsap.min.js"));
  await writeFile(join(dir, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }));
  await writeFile(join(dir, "meta.json"), JSON.stringify({ id: `showreel-${plan.personality}`, name: plan.brand.name }));
  const css = await readFile(join(HERE, "engine.css"), "utf8"), js = await bundleEngine({ scenes: plan.scenes.map((x) => x.module), transitions: plan.scenes.map((x) => x.transition?.module).filter(Boolean) });
  const T = plan.duration, sc = plan.scenes;
  const wrappers = sc.map((s, i) => {
    const inD = s.transition?.d ?? 0, outD = sc[i + 1]?.transition?.d ?? 0, start = Math.max(0, +(s.t - inD / 2).toFixed(3)), end = i === sc.length - 1 ? T : +(s.t + s.d + outD / 2).toFixed(3);
    return `<div id="sc${i}" class="scene clip" data-start="${start}" data-duration="${+(end - start).toFixed(3)}" data-track-index="${2 + (i % 2)}" style="z-index:${i + 1}"></div>`;
  }).join("\n      ");
  // audio on lanes so no two overlap on one track
  const lanes = []; const audio = plan.sfx.slice().sort((a, b) => a.start - b.start).map((h, i) => { let lane = lanes.findIndex((e) => e <= h.start); if (lane < 0) { lanes.push(0); lane = lanes.length - 1; } lanes[lane] = h.start + h.dur; return `<audio id="sfx${i}" src="assets/${h.file}" data-start="${h.start}" data-duration="${Math.min(h.dur, +(T - h.start).toFixed(3))}" data-track-index="${12 + lane}" data-volume="${h.vol}"></audio>`; }).join("\n      ");
  const music = musicFile ? `<audio id="music" src="assets/music.mp3" data-start="0" data-duration="${T}" data-track-index="10" data-volume="0.9"></audio>` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" /><title>${plan.brand.name} showreel</title>
<style>${ff.css}</style><style>${cssVars(plan.pal, plan.fonts, plan.P)}</style><style>${css}</style>
<script src="vendor/gsap.min.js"></script></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="${T}" data-width="1920" data-height="1080">
      <div id="stage" class="clip" data-start="0" data-duration="${T}" data-track-index="0"></div>
      <div id="top" class="clip" data-start="0" data-duration="${T}" data-track-index="1"></div>
      ${wrappers}
      ${music}
      ${audio}
</div>
<script id="plan" type="application/json">${JSON.stringify(plan).replace(/</g, "\\u003c")}</script>
<script>${js}</script></body></html>`;
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "plan.json"), JSON.stringify(plan, null, 2));
  return { duration: T };
}

