import { Gfx, type Ctx, type Env, type P } from "./core";
import type { Film } from "./film";
import { CYAN, DIM, DRAFT, GROUND, WHITE, cut, kit, sheet, stagger, tooth, type Kit } from "./blueprintKit";

// WHERE DOES IT GO? · cyanotype drafting sheet (blueprint plate's medium).
// White ink from a ruling pen and a compass on Prussian blue stock. Order of marks: bare sheet,
// the border ruled, construction (centre chain line, the canopy's compass arc swung), the canopy
// ribs and scalloped hem in heavy white, alternate gores section-lined in cyan, the shaft and
// the J-handle, then a dotted path-line that starts running out of the handle. Rain falls as
// thin cyan ruled strokes all the while. No light: tone is section lining only.

const W = 1920, H = 1080, FRAMES = 90;
const C: P = [900, 560], R = 270;
const pol = (c: P, r: number, a: number): P => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
const lerp2 = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const quad = (a: P, c: P, b: P, n = 16): P[] => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return lerp2(lerp2(a, c, t), lerp2(c, b, t), t); });
const arcPts = (c: P, r: number, a0: number, a1: number, n = 40): P[] => Array.from({ length: n + 1 }, (_, i) => pol(c, r, a0 + ((a1 - a0) * i) / n));

// ---------------------------------------------------------------- the umbrella (design)
const A0 = -Math.PI + 0.55, A1 = -0.55, GORES = 6;
const APEX = pol(C, R, -Math.PI / 2);
const HEM: P[] = Array.from({ length: GORES + 1 }, (_, i) => pol(C, R, A0 + ((A1 - A0) * i) / GORES));
const RIBS: P[][] = HEM.map((h, i) => { const a = A0 + ((A1 - A0) * i) / GORES, am = (a - Math.PI / 2) / 2; return quad(APEX, pol(C, R * 1.04, am), h, 18); });
const SCAL: P[][] = HEM.slice(0, -1).map((h, i) => { const m = lerp2(h, HEM[i + 1], 0.5), toC = lerp2(m, C, 0.13); return quad(h, toC, HEM[i + 1], 12); });
const GORE = (i: number): P[] => [...RIBS[i], ...SCAL[i].slice(1), ...[...RIBS[i + 1]].reverse().slice(1)];
const SHAFT_B: P = [900, 700], HC: P = [870, 700], HR = 30;
const HANDLE = arcPts(HC, HR, 0, Math.PI, 20);
const TIP = HANDLE[HANDLE.length - 1];

// ---------------------------------------------------------------- the path-line, resampled into dots
const PATH_RAW: P[] = [...quad(TIP, [826, 780], [960, 812], 20), ...quad([960, 812], [1180, 860], [1380, 790], 24).slice(1), ...quad([1380, 790], [1560, 730], [1700, 840], 20).slice(1), ...quad([1700, 840], [1790, 910], [1860, 920], 12).slice(1)];
const DOTS: P[] = (() => { const out: P[] = [PATH_RAW[0]]; let acc = 0; for (let i = 1; i < PATH_RAW.length; i++) { const a = PATH_RAW[i - 1], b = PATH_RAW[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += d; if (acc >= 15) { out.push(b); acc = 0; } } return out; })();

// ---------------------------------------------------------------- parts
const frameRule = (k: Kit, q: number) => k.ink(() => {
  const s = stagger(q, 8, 0.42);
  [[22, 2.6], [34, 1.2]].forEach(([m, w], j) => ([[[m, m], [W - m, m]], [[W - m, m], [W - m, H - m]], [[W - m, H - m], [m, H - m]], [[m, H - m], [m, m]]] as P[][]).forEach(([a, b], i) => k.ln(a, b, w, { seed: 900 + j * 4 + i, taper: 0.15, progress: s(i * 2 + j) })));
});

const rain = (k: Kit, frame: number) => k.ink(() => {
  const r = k.rng(31);
  for (let i = 0; i < 90; i++) {
    const x0 = 50 + r() * (W - 100), y0 = r() * H, sp = 26 + r() * 14, len = 26 + r() * 22, seed = 300 + i;
    const y = ((y0 + frame * sp) % (H - 60)) + 30, x = x0 - (y - 30) * 0.12;
    const dx = -len * 0.12;
    // the canopy takes the rain: no strokes under it
    if (x > C[0] - R * 0.92 && x < C[0] + R * 0.92 && y > APEX[1] - 6 && y < 780) continue;
    if (y + len > H - 36 || x < 40 || x > W - 40) continue;
    k.ln([x, y], [x + dx, y + len], 0.9, { seed, color: CYAN, opacity: 0.55 + (i % 4) * 0.08 });
  }
  // drips off each rib tip, falling and starting again
  HEM.forEach((h, i) => { const t = ((frame * 2.4 + i * 17) % 60) / 60, y = h[1] + 10 + t * 150; k.ln([h[0], y], [h[0], y + 12], 1.1, { seed: 400 + i, color: CYAN, opacity: 0.85 * (1 - t) }); });
});

const construct = (k: Kit, q: number) => k.ink(() => {
  const s = stagger(q, 3, 0.5), o = { color: DIM, opacity: 0.7 };
  k.chain([C[0], APEX[1] - 60], [C[0], 790], 0.75, { ...o, seed: 1000, progress: s(0) });
  k.chain([C[0] - R - 40, C[1]], [C[0] + R + 40, C[1]], 0.75, { ...o, seed: 1004, progress: s(1) });
  k.chainRing(C[0], C[1], R, 0.75, { color: CYAN, opacity: 0.45, seed: 1010, progress: s(2), a0: -2.6 });
  [-1, 1].forEach((d, i) => k.ln(C, pol(C, R, d < 0 ? A0 : A1), 0.6, { ...o, opacity: 0.45, seed: 1020 + i, progress: s(2) }));
});

const umbrella = (k: Kit, q: number) => k.ink(() => {
  const s = stagger(q, 4, 0.4);
  // the outer ribs first (the silhouette), then the inner ribs, outside-in
  const order = [0, GORES, 1, GORES - 1, 2, GORES - 2, 3], rs = stagger(s(0), order.length, 0.35);
  order.forEach((i, j) => k.pen(RIBS[i], i === 0 || i === GORES ? 2.3 : 1.4, { seed: 1100 + i, taper: 0.15, wobble: 0.15, progress: rs(j) }));
  const hs = stagger(s(1), GORES, 0.4);
  SCAL.forEach((pts, i) => k.pen(pts, 2.1, { seed: 1120 + i, taper: 0.12, wobble: 0.08, progress: hs(i) }));
  // section lining in alternate gores, the only tone the sheet allows
  const ls = stagger(s(2), 3, 0.6);
  [0, 2, 4].forEach((i, j) => k.hatch(GORE(i), 0.785, 7, 0.7, 1140 + i * 7, { opacity: 0.55, progress: ls(j) }));
  // ferrule, shaft, handle
  const sh = s(3);
  k.ln([APEX[0], APEX[1] - 24], [APEX[0], APEX[1]], 2, { seed: 1160, progress: cut(sh, 0, 0.15) });
  k.ln([C[0] - 3, APEX[1] + 4], [SHAFT_B[0] - 3, SHAFT_B[1]], 1.6, { seed: 1161, progress: cut(sh, 0.1, 0.55) });
  k.ln([C[0] + 3, APEX[1] + 4], [SHAFT_B[0] + 3, SHAFT_B[1]], 1.6, { seed: 1162, progress: cut(sh, 0.15, 0.6) });
  k.pen(HANDLE, 2.6, { seed: 1163, taper: 0.2, wobble: 0.06, progress: cut(sh, 0.55, 0.9) });
  if (sh >= 0.95) k.circle(TIP[0], TIP[1], 4, 1.2, { seed: 1164 });
  // the runner and the hem tips, tiny compass rings
  const tq = cut(sh, 0.8, 1);
  k.circle(C[0], 360, 7, 1.1, { seed: 1165, progress: tq });
  HEM.forEach((h, i) => k.circle(h[0], h[1], 3.2, 1, { seed: 1170 + i, progress: tq }));
});

const path = (k: Kit, q: number) => { if (q <= 0) return; k.ink(() => {
  const n = Math.floor(q * (DOTS.length - 1)) + 1;
  for (let i = 0; i < n; i++) { const [x, y] = DOTS[i], rr = i === n - 1 ? 3.4 : 2.5; k.fill(k.oval(x, y, rr, rr, 8), WHITE, 0.95); }
  if (n > 1 && n < DOTS.length) { const a = DOTS[n - 2], b = DOTS[n - 1]; k.arrow([b[0] + (b[0] - a[0]) * 0.9, b[1] + (b[1] - a[1]) * 0.9], Math.atan2(b[1] - a[1], b[0] - a[0]), 12, WHITE); }
}); };

const draw = (ctx: Ctx, frame: number, env: Env) => {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = GROUND; ctx.fillRect(0, 0, W, H);
  const g = new Gfx(ctx, env, 0, DRAFT), k = kit(g);
  sheet(k);
  frameRule(k, cut(frame, 0, 14));
  construct(k, cut(frame, 6, 26));
  rain(k, frame);
  umbrella(k, cut(frame, 18, 56));
  path(k, cut(frame, 54, 89));
  tooth(g);
};

export const film: Film = { meta: { title: "Where does it go? · cyanotype", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: FRAMES }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: FRAMES, draw }] };