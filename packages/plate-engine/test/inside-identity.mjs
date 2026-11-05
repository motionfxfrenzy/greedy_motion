// Identity proof for the indexed point-in-polygon test (core.ts insideRing, used by gallery `inside` and the style copies).
//   node packages/plate-engine/test/inside-identity.mjs
// (a) randomized property test against a verbatim copy of the OLD loop; (b) mutation guard; (c) adaptPts path through gallery `inside`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const core = join(here, "../src/canvas-core");
const dir = mkdtempSync(join(tmpdir(), "inside-identity-"));
async function load(entry, name) {
  const r = await build({ entryPoints: [join(core, entry)], bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "silent" });
  const f = join(dir, name); writeFileSync(f, r.outputFiles[0].text); return import(pathToFileURL(f).href);
}
const { insideRing, ringNewFrame } = await load("core.ts", "core.mjs");
const gallery = await load("gallery.ts", "gallery.mjs");

// the OLD function, verbatim (gallery.ts at 23e1963, minus adaptPts which is the identity when no aspect adaptation is installed)
const oldInside = (pts, x, y) => { let k = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) k = !k; } return k; };

let s = 0x9e3779b9;
const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const nextUp = (v) => { const b = new Float64Array([v]), u = new BigInt64Array(b.buffer); u[0] += v >= 0 ? 1n : -1n; return b[0]; };
const nextDown = (v) => { const b = new Float64Array([v]), u = new BigInt64Array(b.buffer); u[0] += v > 0 ? -1n : 1n; return b[0]; };

const KINDS = ["convex", "concave", "spiky", "touching", "horizontal", "integer", "dups", "figure8", "tiny", "nan", "inf", "huge", "denormal", "offset"];
function outline(kind) {
  const n = kind === "tiny" ? ri(3, 15) : ri(16, 260), cx = rnd() * 800 - 100, cy = rnd() * 600 - 100, R = 20 + rnd() * 300;
  const P = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let r = R;
    if (kind === "concave" || kind === "tiny") r = R * (0.4 + rnd() * 0.6);
    if (kind === "spiky") r = i % 2 ? R : R * 0.1;
    if (kind === "figure8") P.push([cx + Math.sin(a) * R, cy + Math.sin(2 * a) * R * 0.5]);
    else P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * (0.5 + rnd() * 0.01 * (kind === "convex" ? 0 : 1))]);
  }
  if (kind === "horizontal") for (const p of P) p[1] = Math.round(p[1] / 25) * 25;
  if (kind === "integer") for (const p of P) { p[0] = Math.round(p[0]); p[1] = Math.round(p[1]); }
  if (kind === "dups") for (let i = 0; i < n; i++) if (rnd() < 0.3) P.splice(i, 0, [P[i][0], P[i][1]]);
  if (kind === "touching") { for (let i = 0; i < P.length; i++) if (rnd() < 0.15) P[i] = [P[ri(0, P.length - 1)][0], P[ri(0, P.length - 1)][1]]; }
  if (kind === "nan") P[ri(0, P.length - 1)][ri(0, 1)] = NaN;
  if (kind === "inf") P[ri(0, P.length - 1)][ri(0, 1)] = rnd() < 0.5 ? Infinity : -Infinity;
  if (kind === "huge") for (const p of P) { p[0] *= 1e120; p[1] *= 1e120; }
  if (kind === "denormal") for (const p of P) { p[0] *= 1e-310; p[1] *= 1e-310; }
  if (kind === "offset") for (const p of P) { p[0] += 1e7; p[1] -= 1e7; }
  return P;
}
function queries(P, count) {
  const fin = P.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of fin) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!fin.length) { x0 = y0 = 0; x1 = y1 = 1; }
  const w = x1 - x0 || 1, h = y1 - y0 || 1, out = [];
  const specials = [NaN, Infinity, -Infinity, 0, -0, x0, x1, y0, y1, nextUp(x1), nextDown(x0), nextUp(y1), nextDown(y0)];
  for (let i = 0; i < count; i++) {
    const m = rnd();
    let x, y;
    if (m < 0.45) { x = x0 - 0.1 * w + rnd() * 1.2 * w; y = y0 - 0.1 * h + rnd() * 1.2 * h; }
    else if (m < 0.55) { const v = P[ri(0, P.length - 1)]; x = v[0]; y = v[1]; }                        // exactly on a vertex
    else if (m < 0.65) { const v = P[ri(0, P.length - 1)]; x = x0 + rnd() * w; y = v[1]; }               // at a vertex height (horizontal edges, ties)
    else if (m < 0.75) { const a = P[ri(0, P.length - 1)], b = P[ri(0, P.length - 1)], t = rnd(); x = a[0] + (b[0] - a[0]) * t; y = a[1] + (b[1] - a[1]) * t; } // on / near an edge
    else if (m < 0.82) { const a = P[ri(0, P.length - 1)], b = P[ri(0, P.length - 1)]; x = (a[0] + b[0]) / 2; y = (a[1] + b[1]) / 2; }
    else if (m < 0.9) { x = specials[ri(0, specials.length - 1)]; y = specials[ri(0, specials.length - 1)]; }   // NaN, +-Infinity, box edges, 1 ulp outside
    else if (m < 0.95) { x = rnd() < 0.5 ? nextUp(x1) : nextDown(x0); y = y0 + rnd() * h; }                    // a hair outside the box in x
    else { x = x0 + Math.round(rnd() * w); y = y0 + Math.round(rnd() * h); }                                   // integer grid
    out.push([x, y]);
  }
  return out;
}

test("property: indexed insideRing == old loop (outlines x points)", () => {
  let outlines = 0, points = 0, inside = 0, kinds = {};
  for (let o = 0; o < 420; o++) {
    const kind = KINDS[o % KINDS.length], P = outline(kind);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    outlines++;
    for (const [x, y] of queries(P, 800)) {
      const want = oldInside(P, x, y), got = insideRing(P, x, y);
      if (want) inside++;
      points++;
      if (got !== want) assert.fail(`mismatch: kind=${kind} n=${P.length} x=${x} y=${y} old=${want} new=${got}`);
    }
  }
  console.log(JSON.stringify({ outlines, points, trueAnswers: inside, kinds }));
  assert.ok(outlines >= 300 && points >= 200_000 && inside > 20_000);
});

test("property: repeated queries on the same array stay identical (cache hit path)", () => {
  const P = outline("concave");
  for (const [x, y] of queries(P, 20000)) assert.equal(insideRing(P, x, y), oldInside(P, x, y));
  for (const [x, y] of queries(P, 20000)) assert.equal(insideRing(P, x, y), oldInside(P, x, y));
});

test("mutation guard: length or first/middle/last vertex changed in place -> correct answer after the change", () => {
  const base = outline("concave"), check = (P) => { for (const [x, y] of queries(P, 3000)) assert.equal(insideRing(P, x, y), oldInside(P, x, y)); };
  const P = base.map((p) => [...p]);
  check(P);
  P.push([P[0][0] + 5, P[0][1] + 400]); check(P);                                  // appended vertex (length changes)
  P.pop(); P.pop(); check(P);                                                        // truncated
  P[0][0] += 500; P[0][1] -= 300; check(P);                                          // first vertex edited in place
  P[P.length - 1][1] += 450; check(P);                                               // last vertex edited in place
  const mid = P.length >> 1; P[mid][0] -= 300; P[mid][1] += 200; check(P);           // middle vertex edited in place
});

test("mutation guard: any vertex edited in place between frames is seen at the next frame", () => {
  const P = outline("concave").map((p) => [...p]);
  const check = () => { for (const [x, y] of queries(P, 3000)) assert.equal(insideRing(P, x, y), oldInside(P, x, y)); };
  ringNewFrame(); check();
  for (let k = 0; k < 12; k++) {
    const i = 1 + ((k * 7) % (P.length - 2));
    if (i === P.length >> 1) continue;
    P[i][0] += 150 * (k % 2 ? 1 : -1); P[i][1] += 90;                              // neither first, middle nor last
    ringNewFrame(); check();
  }
});

test("mutation guard: Object.is semantics for NaN (no spurious rebuilds) and -0 vs +0 (harmless rebuild, exact result)", () => {
  const Pnan = outline("nan").map((p) => [...p]);
  for (let ep = 0; ep < 4; ep++) {
    ringNewFrame();
    for (const [x, y] of queries(Pnan, 500)) {
      assert.equal(insideRing(Pnan, x, y), oldInside(Pnan, x, y));
    }
  }
  const Pzero = outline("concave").map((p) => [...p]);
  Pzero[3][0] = +0; Pzero[3][1] = +0;
  ringNewFrame();
  for (const [x, y] of queries(Pzero, 500)) assert.equal(insideRing(Pzero, x, y), oldInside(Pzero, x, y));
  Pzero[3][0] = -0; Pzero[3][1] = -0;
  assert.equal(Object.is(Pzero[3][0], +0), false);
  ringNewFrame();
  for (const [x, y] of queries(Pzero, 500)) assert.equal(insideRing(Pzero, x, y), oldInside(Pzero, x, y));
});

test("documented behaviour: edit between frames is exact; edit within one frame (interior vertex) does not crash and updates at next frame", () => {
  // Build a deterministic 24-vertex circle around (100, 100) of radius 50 (bounding box [50..150, 50..150])
  const P = [];
  const N = 24;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    P.push([100 + Math.cos(a) * 50, 100 + Math.sin(a) * 50]);
  }
  const probe = [100, 220];
  ringNewFrame();
  assert.equal(insideRing(P, probe[0], probe[1]), false);
  assert.equal(oldInside(P, probe[0], probe[1]), false);

  // Within the SAME frame (no ringNewFrame call), mutate interior vertex 6 (bottom of circle, not 0, not N>>1 = 12, not N-1 = 23)
  // in place from y=150 to y=300 so probe (100, 220) lies inside the true geometry:
  // documented limitation — within-frame in-place mutation of an interior vertex is unsupported (caught by verifyScene's
  // double-draw determinism check), does not crash, and retains the current frame's cached box/buckets until the next frame epoch.
  P[6][1] = 300;
  assert.equal(oldInside(P, probe[0], probe[1]), true);
  const withinFrameAnswer = insideRing(P, probe[0], probe[1]);
  assert.equal(typeof withinFrameAnswer, "boolean");
  assert.equal(withinFrameAnswer, false);

  // At the start of the next frame (ringNewFrame), the full-content Object.is check detects the change and rebuilds:
  ringNewFrame();
  assert.equal(insideRing(P, probe[0], probe[1]), true);
  assert.equal(insideRing(P, probe[0], probe[1]), oldInside(P, probe[0], probe[1]));
});

test("bundled scene path: bundleScene -> mountFilm -> FILM.seek -> renderFrame -> ringNewFrame resets epoch and detects vertex edits between frames", async () => {
  const vm = await import("node:vm");
  const { bundleScene } = await import("../lib/engine.mjs");
  const sceneCode = [
    'import { type Ctx, type Env, type P } from "./core";',
    'import type { Film } from "./film";',
    'import { inside } from "./gallery";',
    "const N = 32;",
    "const RING: P[] = Array.from({ length: N }, (_, i) => {",
    "  const a = (i / N) * Math.PI * 2;",
    "  return [540 + Math.cos(a) * 120, 540 + Math.sin(a) * 120] as P;",
    "});",
    "const draw = (ctx: Ctx, frame: number, env: Env) => {",
    "  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);",
    "  // Edit an interior vertex (index 8, bottom of circle) and the middle vertex (N >> 1 = 16, left of circle) in place between frames",
    "  if (frame === 0) { RING[8][1] = 820; RING[16][0] = 260; }",
    "  else if (frame === 1) { RING[8][1] = 580; RING[16][0] = 500; }",
    "  else { RING[8][1] = 820; RING[16][0] = 260; }",
    "  const hitA = inside(RING, 540, 720);",
    "  const hitB = inside(RING, 340, 540);",
    "  ctx.fillStyle = hitA ? '#11aa22' : '#cc2211';",
    "  ctx.fillRect(0, 0, 10, 10);",
    "  ctx.fillStyle = hitB ? '#11aa22' : '#cc2211';",
    "  ctx.fillRect(10, 0, 10, 10);",
    "};",
    "export const film: Film = {",
    '  meta: { title: "mut", W: 1080, H: 1080, fps: 30, bpm: 120, durationFrames: 3 },',
    "  assets: { images: {} },",
    '  shots: [{ id: "s", start: 0, end: 3, draw }]',
    "};"
  ].join("\n");

  const { html } = await bundleScene({ look: "illus-balloon", code: sceneCode, frames: 3, aspect: "1:1" });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);

  const fills = [];
  const makeCtx = () => ({
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    lineDashOffset: 0,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    direction: "inherit",
    shadowBlur: 0,
    shadowColor: "rgba(0,0,0,0)",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    reset() { this.fillStyle = "#000"; },
    setTransform() {},
    clearRect() {},
    fillRect(x, y, w, h) { fills.push({ x, y, w, h, fillStyle: this.fillStyle }); },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    clip() {},
    rect() {},
    arc() {},
    setLineDash() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  });
  const mainCtx = makeCtx();
  const canvasEl = { width: 1080, height: 1080, getContext: () => mainCtx, addEventListener() {} };
  const sandbox = {
    window: null,
    globalThis: null,
    document: {
      getElementById: (id) => (id === "film" ? canvasEl : null),
      createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() })
    },
    location: { search: "?adapter=1" },
    URLSearchParams,
    performance: { now: () => 0 },
    addEventListener() {},
    Image: class { decode() { return Promise.resolve(); } },
    Math, Number, String, Boolean, Array, Object, Set, Map, WeakMap, Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint8ClampedArray, RegExp, Error, TypeError, JSON, Promise
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const s of scripts) vm.runInContext(s, sandbox);
  await sandbox.window.FILM.ready;

  fills.length = 0;
  sandbox.window.FILM.seek(0);
  assert.deepEqual(fills.map((f) => f.fillStyle), ["#11aa22", "#11aa22"]);

  fills.length = 0;
  sandbox.window.FILM.seek(1);
  assert.deepEqual(fills.map((f) => f.fillStyle), ["#cc2211", "#cc2211"]);

  fills.length = 0;
  sandbox.window.FILM.seek(2);
  assert.deepEqual(fills.map((f) => f.fillStyle), ["#11aa22", "#11aa22"]);
});

test("gallery inside() == old inside() with no aspect adaptation", () => {
  for (let o = 0; o < 40; o++) { const P = outline(KINDS[o % KINDS.length]); for (const [x, y] of queries(P, 500)) assert.equal(gallery.inside(P, x, y), oldInside(P, x, y)); }
});

test("cleanup", () => { rmSync(dir, { recursive: true, force: true }); });
