import { Gfx, fractal, rng, type Ctx, type Env, type Medium, type P } from "./core";
import type { Film } from "./film";
import { bounds, mix, smooth } from "./gallery";
import { bee, rose, type Engraving } from "./scrapbookEngraving";
import { clamp01, easeOut, engrave, fibres, handWrite, path, rect, shadowOf, staged, tear, typed, type Step } from "./scrapbookKit";

// SCENE 1 · SPECIMEN CARD. A torn cream card is laid on the foxed album page and taped at its four
// corners; the bee and the wild rose are cut line by line in copperplate, hand-tinted, captioned on
// the typewriter, and annotated in the red hand. Lamp upper left: shadows fall down-right.

const INK = "#2a2019", REDPEN = "#c23a2a", PARCH = "#e8d6b2";
const PEN: Medium = { nib: 1, taper: 0.35, pressure: 0.35, retrace: false, wobble: 0.5, rough: 0.35 };
const N = 150;

type Card = { cx: number; cy: number; w: number; h: number; rot: number; color: string; seed: number; from: P; torn: number };
const CARD: Card = { cx: 960, cy: 560, w: 1120, h: 740, rot: -0.018, color: "#f2eadb", seed: 11, from: [-50, 80], torn: 2.6 };
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
  const sh = [...top, ...bot].map(T); ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  const g = new Gfx(ctx, env, 0, PEN); shadowOf(g, [sh], [1, 1.5], 1.5, 0.12); ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.globalAlpha = 0.5; ctx.fillStyle = "#efe0a8"; path(ctx, sh); ctx.fill();
  ctx.globalAlpha = 0.28; ctx.fillStyle = "#fffbe8"; path(ctx, ([[-len / 2 + 4, -h / 2 + 4], [endX - 4, -h / 2 + 4], [endX - 4, -h / 2 + 8], [-len / 2 + 4, -h / 2 + 9]] as P[]).map(T)); ctx.fill();
  ctx.globalAlpha = 0.18; ctx.strokeStyle = "#8a6a2a"; ctx.lineWidth = 0.7; for (let k = 0; k < 3; k++) { const x = -len / 2 + 12 + r() * (L - 20); if (x < endX - 6) { ctx.beginPath(); const a = T([x, -h / 2 + 2]), b = T([x + (r() - 0.5) * 10, h / 2 - 2]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }
  ctx.globalAlpha = 1;
};

// ---------------------------------------------------------------- the page
const page = (ctx: Ctx, env: Env) => {
  const W = 1920, H = 1080, r = rng(301); ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = PARCH; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 20; i++) { const x = r() * W, y = r() * H, R = 120 + r() * 280, gr = ctx.createRadialGradient(x, y, 0, x, y, R), col = r() < 0.55 ? "#f4e7c9" : "#caa874"; gr.addColorStop(0, col); gr.addColorStop(1, col + "00"); ctx.globalAlpha = 0.28; ctx.fillStyle = gr; ctx.fillRect(x - R, y - R, R * 2, R * 2); }
  const eg = (x0: number, y0: number, x1: number, y1: number) => { const gr = ctx.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, "rgba(120,78,30,0.34)"); gr.addColorStop(1, "rgba(120,78,30,0)"); ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); };
  eg(0, 0, 70, 0); eg(W, 0, W - 80, 0); eg(0, 0, 0, 55); eg(0, H, 0, H - 80);
  ctx.globalAlpha = 0.16; ctx.strokeStyle = "#9a6a30"; ctx.lineWidth = 2.2; path(ctx, smooth(Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * 6.28, k = 1 + (fractal(9, Math.cos(a) * 2, Math.sin(a) * 2, 0.8, 0.8, 2) - 0.5) * 0.25; return [1700 + Math.cos(a) * 130 * k, 930 + Math.sin(a) * 100 * k] as P; }), true, 6)); ctx.stroke();
  ctx.globalAlpha = 0.22; ctx.strokeStyle = "#fff6df"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 604); ctx.bezierCurveTo(500, 600, 1200, 609, W, 603); ctx.stroke();
  ctx.globalAlpha = 0.16; ctx.strokeStyle = "#7a5424"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, 606.5); ctx.bezierCurveTo(500, 602.5, 1200, 611.5, W, 605.5); ctx.stroke();
  const drift = (cx: number, cy: number, sx: number, sy: number, n: number, big: number) => { for (let i = 0; i < n; i++) { const x = cx + (r() + r() - 1) * sx, y = cy + (r() + r() - 1) * sy, s = (0.6 + r() * r() * big) * 2.2; ctx.globalAlpha = 0.18 + r() * 0.25; ctx.fillStyle = "#a4652a"; path(ctx, smooth(Array.from({ length: 7 }, (_, k) => { const a = (k / 7) * 6.28; return [x + Math.cos(a) * s * (0.8 + r() * 0.4), y + Math.sin(a) * s * (0.8 + r() * 0.4)] as P; }), true, 4)); ctx.fill(); if (s > 3) { ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.arc(x, y, s * 2.2, 0, 6.28); ctx.fill(); } } };
  drift(1860, 400, 35, 260, 40, 3); drift(70, 1000, 70, 60, 34, 4); drift(260, 610, 160, 12, 14, 1.5); drift(1700, 70, 80, 30, 12, 2);
  ctx.globalAlpha = 1;
};
const post = (ctx: Ctx, env: Env) => { const g = new Gfx(ctx, env, 0, PEN); g.paper("paper", 0.1); g.vignette("rgba(96,62,24,0.30)"); };

// ---------------------------------------------------------------- the engravings, placed on the card
type Place = { ox: number; oy: number; s: number };
const PLACE: Record<"bee" | "rose", Place> = { bee: { ox: -250, oy: -20, s: 1.35 }, rose: { ox: 290, oy: -10, s: 1.65 } };
const eng = (env: Env, id: "bee" | "rose"): Engraving => { const k = `specimen:eng:${id}`; let e = env.cache.get(k) as Engraving | undefined; if (!e) { e = id === "bee" ? bee(-8, -34, 28, 0.9) : rose(-4, -58, 84); env.cache.set(k, e); } return e; };
const local = (id: "bee" | "rose", [x, y]: P): P => { const pl = PLACE[id]; return [pl.ox + x * pl.s, pl.oy + y * pl.s]; };
const cutPass = (ctx: Ctx, env: Env, id: "bee" | "rose", pass: number, p: number) => {
  const cuts = eng(env, id).passes[pass]; if (!cuts) return; const pl = PLACE[id];
  cardXf(ctx, env, CARD); ctx.translate(pl.ox, pl.oy); ctx.scale(pl.s, pl.s); engrave(ctx, cuts, p, INK);
};
const tint = (ctx: Ctx, env: Env, id: "bee" | "rose", p: number) => {
  const g = new Gfx(ctx, env, 0, PEN), t = eng(env, id).tint;
  g.group("paint", () => { const c = g.cur; t.forEach((w, i) => { const q = clamp01(p * 1.6 - i * 0.08); if (q <= 0) return; const sh = w.shape.map((v) => toPage(CARD, local(id, v))), b = bounds(sh), R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * easeOut(q); c.save(); c.beginPath(); c.arc(b.x0 + (b.x1 - b.x0) * 0.3, b.y0 + (b.y1 - b.y0) * 0.35, R, 0, 6.28); c.clip(); c.globalAlpha = w.alpha; c.fillStyle = w.color; path(c, sh); c.fill(); c.globalAlpha = w.alpha * 0.5; c.strokeStyle = w.color; c.lineWidth = 2; c.stroke(); c.restore(); g.touch(b.x0 - 4, b.y0 - 4, b.x1 + 4, b.y1 + 4); }); c.globalAlpha = 1; }, { blend: "multiply" });
};

// ---------------------------------------------------------------- the red hand: a dashed flight from bee to rose, the note
const dashes = (pts: P[], on = 9, off = 6): P[][] => { const out: P[][] = []; let cur: P[] = [], acc = 0, draw = true; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t = 0; if (draw && !cur.length) cur.push(a); while (t < L) { const lim = draw ? on : off, step = Math.min(lim - acc, L - t); t += step; acc += step; const q: P = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]; if (draw) cur.push(q); if (acc >= lim - 1e-9) { acc = 0; if (draw) { if (cur.length > 1) out.push(cur); cur = []; } else cur = [q]; draw = !draw; } } } if (draw && cur.length > 1) out.push(cur); return out; };
const drawNote = (ctx: Ctx, env: Env, p: number) => {
  const g = new Gfx(ctx, env, 0, PEN), q1 = clamp01(p * 2), q2 = clamp01(p * 2 - 1);
  const arc = smooth(([[-60, -170], [20, -250], [120, -250], [190, -160]] as P[]).map((v) => toPage(CARD, v)), false, 8), parts = dashes(arc);
  parts.forEach((d, k) => { if (k < q1 * parts.length) g.pen(d, { w: 2, color: REDPEN, seed: 90 + k, wobble: 0.3, boil: 0, taper: 0.2, retrace: false }); });
  if (q1 >= 1) { const e = arc[arc.length - 1], b = arc[arc.length - 4], dx = e[0] - b[0], dy = e[1] - b[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l; g.pen([[e[0] - ux * 14 - uy * 8, e[1] - uy * 14 + ux * 8], e, [e[0] - ux * 14 + uy * 8, e[1] - uy * 14 - ux * 8]], { w: 2, color: REDPEN, seed: 120, wobble: 0.3, boil: 0, taper: 0.3, retrace: false }); }
  if (q2 > 0) { const a = toPage(CARD, [-120, -320]); handWrite(g, "NO. 1  MORNING VISIT", a[0], a[1], 20, REDPEN, 98, q2, 0.2, 2.2); }
};

// ---------------------------------------------------------------- the steps, in painter order
const TAPES: [P, number][] = [[[-540, -350], -0.72], [[540, -350], 0.7], [[-540, 350], 0.72], [[540, 350], -0.7]];
const CAP = "FIG. 1   APIS MELLIFERA  ·  ROSA CANINA";
const steps: Step[] = [
  { id: "page", start: -1, end: 0, draw: (c, e) => page(c, e) },
  { id: "card", start: 0, end: 15, draw: (c, e, p) => drawCard(c, e, CARD, p) },
  ...TAPES.map(([at, ang], i): Step => ({ id: `tape${i}`, start: 15 + i * 5, end: 20 + i * 5, draw: (c, e, p) => tape(c, e, toPage(CARD, at), ang + CARD.rot, 110, p, 40 + i) })),
  ...Array.from({ length: 7 }, (_, i): Step => ({ id: `bee${i}`, start: 35 + i * 8, end: 43 + i * 8, draw: (c, e, p) => cutPass(c, e, "bee", i, p) })),
  ...Array.from({ length: 5 }, (_, i): Step => ({ id: `rose${i}`, start: 91 + i * 6, end: 97 + i * 6, draw: (c, e, p) => cutPass(c, e, "rose", i, p) })),
  { id: "tint", start: 121, end: 131, draw: (c, e, p) => { tint(c, e, "bee", p); tint(c, e, "rose", clamp01(p * 1.2 - 0.2)); } },
  { id: "cap", start: 126, end: 138, draw: (c, e, p) => { cardXf(c, e, CARD); typed(c, CAP, -500, 300, 16, "#221d1a", 31, p >= 1 ? Infinity : Math.floor(p * CAP.length)); } },
  { id: "note", start: 134, end: 148, draw: (c, e, p) => drawNote(c, e, p) },
];

const drawScene = staged("specimen", steps, post);
export const film: Film = { meta: { title: "Specimen Card · archival scrapbook", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: N }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: N, draw: (ctx: Ctx, frame: number, env: Env) => { ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0); drawScene(ctx, frame, env); } }] };