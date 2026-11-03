import { Gfx, PENCIL, fractal, rng, type Ctx, type Env, type P } from "./core";
import type { Film } from "./film";
import { blob, bounds, clipped, fillShape, mix, resample, smooth } from "./gallery";

// THE KEEPER CLIMBS · cut-paper collage (the fox plate's medium). Every form is a piece of paper:
// torn pieces show the white core along their edge, scissor-cut ones are crisp, each lifts and
// throws a soft shadow, each has its fibres and uneven dye. Low sun to the left, an orange dusk.
// The keeper, navy coat, yellow scarf, grey hair, a little unlit lantern, walks to the stone
// stair at the lighthouse foot and steps up onto the first one. Gulls drift, the sea swells.

const W = 1080, H = 1920, FRAMES = 90;
const PAPER_CORE = "#fbf5e6", SHADOW = "#3c2814";
type Piece = { shape: P[]; color: string; torn?: number; seed: number; fibre?: number; lift?: number; dx?: number; dy?: number };

const normals = (s: P[]): P[] => s.map((_, i) => { const a = s[(i - 1 + s.length) % s.length], b = s[(i + 1) % s.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; });
const ringLen = (s: P[]) => s.reduce((a, p, i) => a + Math.hypot(p[0] - s[(i + 1) % s.length][0], p[1] - s[(i + 1) % s.length][1]), 0);
const tear = (shape: P[], amp: number, seed: number, grow = 0): P[] => {
  const closed = [...shape, shape[0]], n = Math.max(24, Math.round(ringLen(shape) / 2.6)), s = resample(closed, n).slice(0, -1), nr = normals(s), r = rng(seed);
  return s.map(([x, y], i) => { const d = (fractal(seed, x, y, 0.09, 0.09, 3) - 0.5) * amp * 2.2 + (r() - 0.5) * amp * 0.6 + grow; return [x + nr[i][0] * d, y + nr[i][1] * d]; });
};
const cut = (shape: P[], seed: number): P[] => { const s = resample([...shape, shape[0]], Math.max(24, Math.round(ringLen(shape) / 4))).slice(0, -1), r = rng(seed); return s.map(([x, y]) => [x + (r() - 0.5) * 0.7, y + (r() - 0.5) * 0.7]); };
const fibres = (g: Gfx, shape: P[], color: string, seed: number, density: number) => {
  const b = bounds(shape), r = rng(seed), area = (b.x1 - b.x0) * (b.y1 - b.y0), c = g.cur;
  clipped(g, shape, () => {
    for (let i = 0; i < 5; i++) fillShape(g, blob(b.x0 + r() * (b.x1 - b.x0), b.y0 + r() * (b.y1 - b.y0), 30 + r() * 90, 20 + r() * 60, seed + i, 0.4, 12, r() * 3), r() < 0.5 ? mix(color, "#ffffff", 0.18) : mix(color, "#000000", 0.12), 0.25);
    c.lineCap = "round";
    const n = Math.min(900, Math.round((area / 900) * density));
    for (let i = 0; i < n; i++) { const x = b.x0 + r() * (b.x1 - b.x0), y = b.y0 + r() * (b.y1 - b.y0), a = r() * Math.PI, l = 3 + r() * 9; c.strokeStyle = r() < 0.55 ? mix(color, "#fff8e8", 0.45) : mix(color, "#1a0e06", 0.3); c.globalAlpha = 0.25 + r() * 0.3; c.lineWidth = 0.6 + r() * 0.7; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 3, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 3, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
    c.globalAlpha = 1;
  });
};
const mv = (s: P[], dx = 0, dy = 0): P[] => (dx || dy ? s.map(([x, y]) => [x + dx, y + dy] as P) : s);
const layer = (g: Gfx, pieces: Piece[]) => {
  const shapes = pieces.map((p) => mv(p.torn ? tear(p.shape, p.torn, p.seed) : cut(p.shape, p.seed), p.dx, p.dy));
  g.group("plain", () => pieces.forEach((p, i) => { const l = p.lift ?? 1; fillShape(g, shapes[i].map(([x, y]) => [x + 3 * l, y + 5 * l] as P), SHADOW, 0.5); }), { blur: 4, alpha: 0.55 });
  g.group("plain", () => pieces.forEach((p, i) => {
    if (p.torn) fillShape(g, mv(tear(p.shape, p.torn * 0.8, p.seed + 1, p.torn * 0.7), p.dx, p.dy), PAPER_CORE);
    fillShape(g, shapes[i], p.color);
    fibres(g, shapes[i], p.color, p.seed + 2, p.fibre ?? 1);
  }));
};
const P0 = (pts: P[], per = 6) => smooth(pts, true, per);
const band = (y: number, wob: number, seed: number): P[] => { const r = rng(seed), pts: P[] = []; for (let x = -40; x <= W + 40; x += 180) pts.push([x, y + (r() - 0.5) * wob]); return P0([...pts, [W + 40, H + 40], [-40, H + 40]]); };
const clamp = (v: number) => Math.max(0, Math.min(1, v)), ease = (v: number) => v * v * (3 - 2 * v);

// ---------------------------------------------------------------- dusk, sea, rocks
const sky = (g: Gfx, f: number) => {
  layer(g, [{ shape: [[-20, -20], [W + 20, -20], [W + 20, H + 20], [-20, H + 20]], color: "#3b2c55", seed: 1, fibre: 0.5 }]);
  [["#7a3a58", 260], ["#c2523e", 560], ["#e57d3c", 860], ["#f3a64e", 1080]].forEach(([c, y], i) => layer(g, [{ shape: band(y as number, 50, 10 + i), color: c as string, torn: 3.2, seed: 10 + i, fibre: 0.5 }]));
  // the low sun, scissor-cut, sinking, a paler disc laid on it
  const sy = 1180 + f * 0.25, disc = (r: number): P[] => Array.from({ length: 40 }, (_, i) => [230 + Math.cos((i / 40) * Math.PI * 2) * r, sy + Math.sin((i / 40) * Math.PI * 2) * r] as P);
  layer(g, [{ shape: disc(110), color: "#f7c35e", seed: 20, lift: 0.6 }]);
  layer(g, [{ shape: disc(74), color: "#fbdc8a", torn: 1.4, seed: 21, lift: 0.3 }]);
  // gulls drifting and flapping
  layer(g, [[520, 520], [760, 420], [880, 610]].map(([x, y], i) => { const fl = Math.sin(f * 0.35 + i * 2), gx = x + f * (0.9 + i * 0.3), gy = y + Math.sin(f * 0.05 + i) * 8, s = 1 - i * 0.15;
    return { shape: ([[-18, -7 * fl], [0, 2], [18, -7 * fl], [18, -7 * fl + 4], [0, 6], [-18, -7 * fl + 4]] as P[]).map(([a, b]) => [gx + a * s, gy + b * s] as P), color: "#3a2a3a", seed: 30 + i, lift: 0.3 }; }));
};
const sea = (g: Gfx, f: number, front: boolean) => {
  const L = front ? [["#1f3a58", 1660, 50], ["#2c4f75", 1780, 52]] : [["#3b5a7e", 1290, 40], ["#4f6f92", 1380, 41]];
  L.forEach(([c, y, s], i) => layer(g, [{ shape: band(y as number, 40, s as number), color: c as string, torn: 3.4, seed: s as number, fibre: 0.8, dx: Math.sin(f * 0.07 + i * 1.7) * 12, dy: Math.sin(f * 0.09 + i) * 5 }]));
};
const rocks = (g: Gfx) => {
  layer(g, [{ shape: P0([[60, 1720], [90, 1560], [180, 1520], [330, 1500], [600, 1495], [900, 1500], [1010, 1540], [1060, 1700]]), color: "#3a3232", torn: 3.2, seed: 60 }]);
  layer(g, [{ shape: P0([[100, 1520], [300, 1492], [640, 1488], [960, 1494], [1000, 1520], [640, 1530], [300, 1528]]), color: "#7b6c60", torn: 2.6, seed: 61, lift: 0.6 }]);
  layer(g, [{ shape: P0([[130, 1700], [160, 1600], [240, 1580], [270, 1680]]), color: "#2a2424", torn: 2.4, seed: 62 }, { shape: P0([[860, 1690], [900, 1580], [990, 1600], [1010, 1700]]), color: "#2a2424", torn: 2.4, seed: 63 }]);
};

// ---------------------------------------------------------------- the lighthouse and stair
const CX = 700, hw = (y: number) => 160 + (y - 1410) * (55 / 770);
const strip = (y0: number, y1: number, a = -1, b = 1): P[] => [[CX + a * hw(y0), y0], [CX + b * hw(y0), y0], [CX + b * hw(y1), y1], [CX + a * hw(y1), y1]];
const lighthouse = (g: Gfx, f: number) => {
  layer(g, [{ shape: strip(1415, 640), color: "#efe5d2", torn: 2.2, seed: 70, lift: 1.3 }]);
  layer(g, [{ shape: strip(1240, 1120), color: "#b8372a", torn: 2, seed: 71, lift: 0.5 }, { shape: strip(900, 780), color: "#b8372a", torn: 2, seed: 72, lift: 0.5 }]);
  layer(g, [{ shape: strip(1415, 640, 0.55, 1), color: "#a99c8a", torn: 2, seed: 73, lift: 0.3 }]);   // the shade side, away from the sun
  layer(g, [{ shape: [[CX - 16, 1010], [CX + 16, 1010], [CX + 16, 950], [CX - 16, 950]], color: "#2b2a38", seed: 74, lift: 0.3 }, { shape: [[CX - 14, 720], [CX + 14, 720], [CX + 14, 670], [CX - 14, 670]], color: "#2b2a38", seed: 75, lift: 0.3 },
    { shape: P0([[590, 1412], [590, 1330], [618, 1300], [646, 1330], [646, 1412]], 4), color: "#5a3a26", seed: 76, lift: 0.4 }]);
  // gallery deck, lamp room glowing, red cap
  const glow = mix("#f7d36a", "#fff0b0", 0.5 + 0.5 * Math.sin(f * 0.4));
  layer(g, [{ shape: [[CX - 140, 650], [CX + 140, 650], [CX + 130, 626], [CX - 130, 626]], color: "#2b2a38", seed: 77 }]);
  layer(g, [{ shape: [[CX - 72, 628], [CX + 72, 628], [CX + 72, 520], [CX - 72, 520]], color: glow, seed: 78, lift: 0.6 }]);
  layer(g, [{ shape: [[CX - 6, 628], [CX + 6, 628], [CX + 6, 520], [CX - 6, 520]], color: "#2b2a38", seed: 79, lift: 0.2 }, { shape: [[CX - 96, 524], [CX + 96, 524], [CX, 430]], color: "#9e2f24", torn: 1.6, seed: 80 }]);
  // three stone stairs to the door, each its own torn grey scrap
  layer(g, [0, 1, 2].map((i) => ({ shape: [[360 + i * 70, 1500 - i * 30], [590, 1500 - i * 30], [590, 1470 - i * 30], [362 + i * 70, 1470 - i * 30]] as P[], color: ["#9a8f86", "#8a7f77", "#a59a90"][i], torn: 1.6, seed: 90 + i, lift: 0.7 })));
};

// ---------------------------------------------------------------- the keeper
const limb = (a: P, b: P, w: number, fwd: number, L: number): P[] => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.sqrt(Math.max(0, L * L - d * d)) * 0.5, m: P = [(a[0] + b[0]) / 2 + k * fwd, (a[1] + b[1]) / 2];
  return [[a[0] - w, a[1]], [m[0] - w, m[1]], [b[0] - w, b[1]], [b[0] + w, b[1]], [m[0] + w, m[1]], [a[0] + w, a[1]]];
};
const keeper = (g: Gfx, f: number) => {
  const t = f / FRAMES, wk = ease(clamp(t / 0.5)), st = ease(clamp((t - 0.5) / 0.35)), walking = t < 0.5 ? 1 : 0;
  const kx = 290 + 80 * wk + 12 * st, hipY = 1446 - 14 * st + Math.abs(Math.sin(f * 0.45)) * -4 * walking, sw = Math.sin(f * 0.45) * 10 * walking;
  const backF: P = [kx - 10 - sw, 1500], frontF: P = [kx + 12 + sw + 10 * st, 1500 - 30 * st - Math.sin(st * Math.PI) * 16];
  const hand: P = [kx + 26, hipY - 14], a = 0.35 * Math.sin(f * 0.22), lx = hand[0] + Math.sin(a) * 22, ly = hand[1] + Math.cos(a) * 22;
  layer(g, [{ shape: limb([kx - 6, hipY], backF, 5, -1, 58), color: "#1f2233", seed: 100, lift: 0.6 }, { shape: limb([kx + 6, hipY], frontF, 5, 1, 58), color: "#262a3d", seed: 101, lift: 0.6 }]);
  layer(g, [{ shape: P0([[kx - 18, hipY - 66], [kx + 14, hipY - 66], [kx + 22, hipY + 10], [kx - 24, hipY + 10]], 4), color: "#2b3a5c", torn: 1.2, seed: 102, lift: 0.9 }]);
  layer(g, [{ shape: P0([[kx + 4, hipY - 60], [kx + 14, hipY - 64], [kx + 22, hipY + 10], [kx + 6, hipY + 10]], 4), color: "#1e2a45", torn: 1, seed: 103, lift: 0.3 },
    { shape: P0([[kx - 18, hipY - 70], [kx + 16, hipY - 70], [kx + 14, hipY - 60], [kx - 16, hipY - 60]], 4), color: "#f2c443", torn: 1, seed: 104, lift: 0.4 }]);
  layer(g, [{ shape: [[hand[0] - 1, hand[1]], [hand[0] + 1, hand[1]], [lx + 1, ly - 10], [lx - 1, ly - 10]], color: "#2a2424", seed: 105, lift: 0.2 },
    { shape: [[lx - 9, ly - 10], [lx + 9, ly - 10], [lx + 8, ly + 12], [lx - 8, ly + 12]], color: "#2f4a3a", seed: 106, lift: 0.5 }]);
  layer(g, [{ shape: [[lx - 5, ly - 6], [lx + 5, ly - 6], [lx + 5, ly + 8], [lx - 5, ly + 8]], color: "#e9d9a8", seed: 107, lift: 0.2 },
    { shape: limb([kx + 4, hipY - 58], hand, 5, 1, 50), color: "#2b3a5c", seed: 108, lift: 0.5 }]);
  const hy = hipY - 88;
  layer(g, [{ shape: blob(kx - 8, hy + 4, 13, 14, 109, 0.15, 10), color: "#c9c4c0", torn: 2, seed: 109, lift: 0.5 }, { shape: blob(kx + 2, hy, 15, 17, 110, 0.06, 12), color: "#f1c9a2", seed: 110, lift: 0.7 }]);
  layer(g, [{ shape: P0([[kx - 16, hy - 8], [kx - 10, hy - 22], [kx + 12, hy - 22], [kx + 18, hy - 10], [kx + 26, hy - 8], [kx + 26, hy - 4], [kx - 16, hy - 4]], 3), color: "#1e2a45", seed: 111, lift: 0.4 },
    { shape: [[kx + 6, hy - 1], [kx + 13, hy - 2], [kx + 13, hy + 1], [kx + 6, hy + 2]], color: "#231813", seed: 112, lift: 0.1 },
    { shape: [[kx + 4, hy + 9], [kx + 14, hy + 8], [kx + 14, hy + 10], [kx + 4, hy + 11]], color: "#9a4a3a", seed: 113, lift: 0.1 }]);
};

export const drawKeeper = (ctx: Ctx, frame: number, env: Env) => {
  const g = new Gfx(ctx, env, 0, PENCIL);
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = PAPER_CORE; ctx.fillRect(0, 0, W, H);
  sky(g, frame); sea(g, frame, false); lighthouse(g, frame); rocks(g); keeper(g, frame); sea(g, frame, true);
  g.paper("paper", 0.1);
};

export const film: Film = { meta: { title: "The keeper climbs · cut-paper collage", W: 1080, H: 1920, fps: 30, bpm: 120, durationFrames: 90 }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: 90, draw: drawKeeper }] };