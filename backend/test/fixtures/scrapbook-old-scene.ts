import { Gfx, fractal, rng, type Ctx, type Env, type Medium, type P } from "./core";
import type { Film } from "./film";
import { bounds, mix, smooth } from "./gallery";
import { bee, rose, type Engraving } from "./scrapbookEngraving";
import { clamp01, easeOut, engrave, fibres, measure, path, rect, shadowOf, staged, tear, typed, type Step } from "./scrapbookKit";

// SPECIMEN CARD · archival scrapbook. Scene 1 of the honeybee-and-wild-rose film.
// Parchment album page; a torn cream card drops and is taped at its corners; the copperplate
// engravings are cut line by line (bee first, focal and largest, then the wild rose), hand-tinted,
// a typed slip is laid under them, and the red hand draws its note: the bee's line to the rose.
// Lamp upper left: shadows fall down-right.

const INK = "#2a2019", REDPEN = "#c23a2a", PARCH = "#e8d6b2";
const PEN: Medium = { nib: 1, taper: 0.35, pressure: 0.35, retrace: false, wobble: 0.5, rough: 0.35 };
const N = 150;

type Card = { cx: number; cy: number; w: number; h: number; rot: number; color: string; seed: number; from: P; torn: number };
const CARD: Card = { cx: 960, cy: 530, w: 1060, h: 720, rot: -0.022, color: "#f2eadb", seed: 11, from: [-50, 90], torn: 2.6 };
const BEE = { x: -230, y: -30, s: 1.1 }, ROSE = { x: 280, y: -10, s: 1.5 };
const toPage = (cd: Card, [x, y]: P, dx = 0, dy = 0): P => { const c = Math.cos(cd.rot), s = Math.sin(cd.rot); return [cd.cx + dx + x * c - y * s, cd.cy + dy + x * s + y * c]; };
const cardXf = (c: Ctx, env: Env, cd: Card) => { c.setTransform(env.scale, 0, 0, env.scale, 0, 0); c.translate(cd.cx, cd.cy); c.rotate(cd.rot); };
const drawCard = (ctx: Ctx, env: Env, cd: Card, p: number) => {
  const e = easeOut(p), dx = cd.from[0] * (1 - e), dy = cd.from[1] * (1 - e), lift = 1 + 6 * (1 - e) * (1 - e);
  const g = new Gfx(ctx, env, 0, PEN), sh = tear(rect(cd.w, cd.h), cd.torn, cd.seed).map((q) => toPage(cd, q, dx, dy));
  shadowOf(g, [sh], [2.5 * lift, 4 * lift], 3 + 2.5 * lift, 0.34 / Math.sqrt(lift));
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = cd.color; path(ctx, sh); ctx.fill();
  fibres(ctx, sh, cd.color, cd.seed + 5, 0.8, 0.28);
  ctx.strokeStyle = mix(cd.color, "#7a5a30", 0.35); ctx.globalAlpha = 0.35; ctx.lineWidth = 1.2; path(ctx, sh); ctx.stroke(); ctx.globalAlpha = 1;
};
const tape = (ctx: Ctx, env: Env, at: P, ang: number, len: number, p: number, seed: number) => {
  if (p <= 0) return; const r = rng(seed), L = len * easeOut(p), h = 30, c = Math.cos(ang), s = Math.sin(ang), T = ([x, y]: P): P => [at[0] + x * c - y * s, at[1] + x * s + y * c];
  const top: P[] = [], bot: P[] = []; for (let k = 0; k <= 5; k++) top.push([-len / 2 + (r() - 0.5) * 3, -h / 2 + (k * h) / 5]);
  const endX = -len / 2 + L; for (let k = 5; k >= 0; k--) bot.push([endX + (k % 2 ? 3 : -2) * (p >= 1 ? 1 : 0), -h / 2 + (k * h) / 5]);
  const sh = [...top, ...bot].map(T); const g = new Gfx(ctx, env, 0, PEN); shadowOf(g, [sh], [1, 1.5], 1.5, 0.12);
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.globalAlpha = 0.5; ctx.fillStyle = "#efe0a8"; path(ctx, sh); ctx.fill();
  ctx.globalAlpha = 0.28; ctx.fillStyle = "#fffbe8"; path(ctx, ([[-len / 2 + 4, -h / 2 + 4], [endX - 4, -h / 2 + 4], [endX - 4, -h / 2 + 8], [-len / 2 + 4, -h / 2 + 9]] as P[]).map(T)); ctx.fill();
  ctx.globalAlpha = 0.18; ctx.strokeStyle = "#8a6a2a"; ctx.lineWidth = 0.7;
  for (let k = 0; k < 3; k++) { const x = -len / 2 + 12 + r() * (L - 20); if (x < endX - 6) { ctx.beginPath(); const a = T([x, -h / 2 + 2]), b = T([x + (r() - 0.5) * 10, h / 2 - 2]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
  ctx.globalAlpha = 1;
};

// ---------------------------------------------------------------- the page
const page = (ctx: Ctx, env: Env) => {
  const W = 1920, H = 1080, r = rng(301); ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = PARCH; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 16; i++) { const x = r() * W, y = r() * H, R = 140 + r() * 300, gr = ctx.createRadialGradient(x, y, 0, x, y, R), col = r() < 0.55 ? "#f4e7c9" : "#caa874"; gr.addColorStop(0, col); gr.addColorStop(1, col + "00"); ctx.globalAlpha = 0.28; ctx.fillStyle = gr; ctx.fillRect(x - R, y - R, R * 2, R * 2); }
  const eg = (x0: number, y0: number, x1: number, y1: number) => { const gr = ctx.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, "rgba(120,78,30,0.34)"); gr.addColorStop(1, "rgba(120,78,30,0)"); ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); };
  eg(0, 0, 70, 0); eg(W, 0, W - 80, 0); eg(0, 0, 0, 60); eg(0, H, 0, H - 80);
  ctx.globalAlpha = 0.16; ctx.strokeStyle = "#9a6a30"; ctx.lineWidth = 2.2;
  path(ctx, smooth(Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * 6.28, k = 1 + (fractal(9, Math.cos(a) * 2, Math.sin(a) * 2, 0.8, 0.8, 2) - 0.5) * 0.25; return [1700 + Math.cos(a) * 140 * k, 930 + Math.sin(a) * 110 * k] as P; }), true, 6)); ctx.stroke();
  ctx.globalAlpha = 0.22; ctx.strokeStyle = "#fff6df"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 984); ctx.bezierCurveTo(600, 980, 1200, 989, W, 983); ctx.stroke();
  ctx.globalAlpha = 0.16; ctx.strokeStyle = "#7a5424"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, 986.5); ctx.bezierCurveTo(600, 982.5, 1200, 991.5, W, 985.5); ctx.stroke();
  const drift = (cx: number, cy: number, sx: number, sy: number, n: number, big: number) => { for (let i = 0; i < n; i++) { const x = cx + (r() + r() - 1) * sx, y = cy + (r() + r() - 1) * sy, s = (0.6 + r() * r() * big) * 2.2; ctx.globalAlpha = 0.18 + r() * 0.25; ctx.fillStyle = "#a4652a"; path(ctx, smooth(Array.from({ length: 7 }, (_, k) => { const a = (k / 7) * 6.28; return [x + Math.cos(a) * s * (0.8 + r() * 0.4), y + Math.sin(a) * s * (0.8 + r() * 0.4)] as P; }), true, 4)); ctx.fill(); if (s > 3) { ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.arc(x, y, s * 2.2, 0, 6.28); ctx.fill(); } } };
  drift(1820, 380, 40, 240, 40, 3); drift(70, 1000, 70, 60, 34, 4); drift(300, 90, 120, 30, 14, 2);
  ctx.globalAlpha = 1;
};
const post = (ctx: Ctx, env: Env) => { const g = new Gfx(ctx, env, 0, PEN); g.paper("paper", 0.1); g.vignette("rgba(96,62,24,0.30)"); };

// ---------------------------------------------------------------- the engravings
const eng = (env: Env, id: "bee" | "rose"): Engraving => { const k = `specimen:eng:${id}`; let e = env.cache.get(k) as Engraving | undefined; if (!e) { e = id === "bee" ? bee(-8, -34, 28, 0.9) : rose(-4, -58, 84); env.cache.set(k, e); } return e; };
const engXf = (ctx: Ctx, env: Env, id: "bee" | "rose") => { const o = id === "bee" ? BEE : ROSE; cardXf(ctx, env, CARD); ctx.translate(o.x, o.y); ctx.scale(o.s, o.s); };
const cut = (id: "bee" | "rose", start: number, end: number, n: number): Step[] => Array.from({ length: n }, (_, i) => ({
  id: `${id}${i}`, start: start + ((end - start) * i) / n, end: start + ((end - start) * (i + 1)) / n,
  draw: (ctx: Ctx, env: Env, p: number) => { const ps = eng(env, id).passes; if (!ps[i]) return; engXf(ctx, env, id); engrave(ctx, ps[i], p, INK); },
}));
const tint = (ctx: Ctx, env: Env, id: "bee" | "rose", p: number) => {
  eng(env, id).tint.forEach((w, i) => {
    const q = clamp01(p * 1.6 - i * 0.08); if (q <= 0) return; const b = bounds(w.shape), R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * easeOut(q);
    engXf(ctx, env, id); ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.beginPath(); ctx.arc(b.x0 + (b.x1 - b.x0) * 0.3, b.y0 + (b.y1 - b.y0) * 0.35, R, 0, 6.28); ctx.clip();
    ctx.globalAlpha = w.alpha; ctx.fillStyle = w.color; path(ctx, w.shape); ctx.fill(); ctx.globalAlpha = w.alpha * 0.5; ctx.strokeStyle = w.color; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  });
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
};

// ---------------------------------------------------------------- the typed slip and the red hand
const SLIP = { text: "§1  0614  07.30", x: 0, y: 285, cap: 18, rot: 0.015, seed: 72 };
const MONO = { weight: 0.1, mono: 4.2, track: 0.9 };
const slip = (ctx: Ctx, env: Env, p: number, n: number) => {
  const e = easeOut(p), lift = 1 + 4 * (1 - e) * (1 - e), dy = -16 * (1 - e), w = measure(SLIP.text, SLIP.cap, MONO) + SLIP.cap * 1.6;
  const local = tear(rect(w, SLIP.cap * 2.3), 1.2, SLIP.seed), sh = local.map((q) => toPage({ ...CARD, rot: CARD.rot + SLIP.rot }, [q[0] + SLIP.x, q[1] + SLIP.y], 0, dy));
  const g = new Gfx(ctx, env, 0, PEN); shadowOf(g, [sh], [1.5 * lift, 2.5 * lift], 1.5 + lift, 0.36 / Math.sqrt(lift));
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0); ctx.fillStyle = "#f7f2e8"; path(ctx, sh); ctx.fill(); fibres(ctx, sh, "#f7f2e8", SLIP.seed, 0.6, 0.15);
  if (n > 0) { cardXf(ctx, env, CARD); ctx.translate(SLIP.x, SLIP.y + dy); ctx.rotate(SLIP.rot); typed(ctx, SLIP.text, -(w - SLIP.cap * 1.6) / 2, -SLIP.cap / 2, SLIP.cap, "#221d1a", SLIP.seed, n); }
};
const redNote = (ctx: Ctx, env: Env, p: number) => {
  const g = new Gfx(ctx, env, 0, PEN), P2 = (v: P) => toPage(CARD, v), q1 = clamp01(p * 2), q2 = clamp01(p * 2 - 1);
  const arc = smooth(([[-90, -150], [10, -215], [120, -190], [175, -120]] as P[]).map(P2), false, 10);
  g.pen(arc, { w: 2, color: REDPEN, seed: 97, wobble: 0.6, boil: 0, taper: 0.5, retrace: false, progress: q1 });
  if (q1 >= 1) { const t = P2([175, -120]); g.pen([P2([152, -128]), t, P2([168, -146])], { w: 2, color: REDPEN, seed: 98, wobble: 0.4, boil: 0, taper: 0.4, retrace: false }); }
  const lp: P[] = []; for (let k = 0; k <= 26; k++) { const u = -0.5 + (k / 26) * 6.9, rr = 150 + k * 1.2; lp.push(P2([ROSE.x + Math.cos(u) * rr * 0.9, ROSE.y - 60 + Math.sin(u) * rr * 0.75])); }
  g.pen(lp, { w: 1.8, color: REDPEN, seed: 99, wobble: 0.7, boil: 0, taper: 0.6, retrace: false, progress: q2 });
};

// ---------------------------------------------------------------- the order of marks
const corners: [P, number][] = [[[-530, -360], -0.7], [[530, -360], 0.7], [[530, 360], -0.7], [[-530, 360], 0.7]];
const steps: Step[] = [
  { id: "page", start: -1, end: 0, draw: (c, e) => page(c, e) },
  { id: "card", start: 0, end: 16, draw: (c, e, p) => drawCard(c, e, CARD, p) },
  ...corners.map(([v, a], i): Step => ({ id: `tape${i}`, start: 14 + i * 3, end: 18 + i * 3, draw: (c, e, p) => tape(c, e, toPage(CARD, v), a + CARD.rot, 120, p, 40 + i) })),
  ...cut("bee", 26, 82, 7),
  ...cut("rose", 82, 110, 5),
  { id: "tint", start: 108, end: 124, draw: (c, e, p) => { tint(c, e, "bee", p); tint(c, e, "rose", clamp01(p * 1.2 - 0.2)); } },
  { id: "slip", start: 118, end: 140, draw: (c, e, p) => slip(c, e, clamp01(p * 3), Math.floor(clamp01(p * 1.5 - 0.4) * SLIP.text.length * 1.01)) },
  { id: "note", start: 128, end: 148, draw: (c, e, p) => redNote(c, e, p) },
];
const run = staged("specimen", steps, post);
const draw = (ctx: Ctx, frame: number, env: Env) => { ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0); ctx.fillStyle = PARCH; ctx.fillRect(0, 0, 1920, 1080); run(ctx, frame, env); };

export const film: Film = { meta: { title: "Specimen Card · archival scrapbook", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: N }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: N, draw }] };