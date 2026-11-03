import { Gfx, rng, type Ctx, type Env, type Medium, type P } from "./core";
import type { Film } from "./film";
import { blob, bounds, fillShape as fillShape0, hatchRuns, inside, mix, smooth } from "./gallery";

// WHICH WAY'S HOME? · crayon. Scene 1 of the lighthouse film, in the balloon plate's medium: wax on toothy
// paper, back-and-forth scribble fills, a darker crayon on the shade side, a fat wobbly contour gone over twice.
// A small red boat with a lone fisherman (yellow oilskin, sou'wester) rocks on a wide dark scribbled sea under a
// black sky. One light: a thin moon low at the upper left. Waves drift, stars twinkle, the boat rocks.

const W = 1920, H = 1080, FPS = 30, FRAMES = 105;
const CRAYON_M: Medium = { nib: 2.9, taper: 0.3, pressure: 0.8, retrace: true, wobble: 2.2, rough: 1.3 };
const K = { red: "#e5392d", yellow: "#ffd21f", orange: "#f68b1f", brown: "#8b5a3c", white: "#fffdf4", black: "#1b1a2a", night: "#24223f", sea: "#1d2f5e", deep: "#121c3a", foam: "#8fb0e0", skin: "#f6c8a0" };
const PAPER = "#fdf8ea";

const scribble = (g: Gfx, region: P[], color: string, o: { angle: number; gap: number; w: number; alpha: number; seed: number; keep?: (x: number, y: number) => boolean; over?: number; cache?: boolean }) => {
  const { angle, gap, w, alpha, seed, keep = () => true, over = 1.035 } = o, r = rng(seed), b = bounds(region);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, grown = region.map(([x, y]) => [cx + (x - cx) * over, cy + (y - cy) * over] as P);
  const rk = `night:runs:${seed}:${angle}:${gap}:${color}:${region.length}`;
  let runs = o.cache ? (g.env.cache.get(rk) as P[][] | undefined) : undefined;
  if (!runs) { runs = hatchRuns({ x0: b.x0 - 8, y0: b.y0 - 8, x1: b.x1 + 8, y1: b.y1 + 8 }, angle, gap, (x, y) => inside(grown, x, y) && keep(x, y), 5, seed); if (o.cache) g.env.cache.set(rk, runs); }
  const c = g.cur; g.touch(b.x0 - 14, b.y0 - 14, b.x1 + 14, b.y1 + 14);
  c.save(); c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = color; c.lineWidth = w;
  let prev: P | null = null;
  runs.forEach((run, i) => {
    const pts = (i % 2 ? [...run].reverse() : run).filter((_, k, a) => k % 3 === 0 || k === a.length - 1).map(([x, y]) => [x + (r() - 0.5) * 1.6, y + (r() - 0.5) * 1.6] as P);
    const jump = prev ? Math.hypot(pts[0][0] - prev[0], pts[0][1] - prev[1]) : 0;
    c.globalAlpha = alpha * (0.72 + r() * 0.4);
    c.beginPath();
    if (prev && jump < gap * 3.2) { c.moveTo(prev[0], prev[1]); pts.forEach(([x, y]) => c.lineTo(x, y)); }
    else pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke(); prev = pts[pts.length - 1];
  });
  c.restore();
};
const line = (g: Gfx, pts: P[], color: string, w: number, seed: number, op = 0.92, wob = 1) => g.pen(pts, { w, color, seed, wobble: wob, boil: 0, opacity: op, retrace: true, taper: 1 });
const fillShape = (g: Gfx, pts: P[], color: string, alpha?: number) => fillShape0(g, pts, color, alpha);
const wax = (g: Gfx, fn: () => void) => g.group("plain", fn, { textures: ["pencilTooth"] });
const solid = (g: Gfx, pts: P[], color: string, seed: number, o: { shade?: string; shadeFrom?: (x: number, y: number) => boolean; ink?: string; ink_w?: number; angle?: number } = {}) => {
  fillShape(g, pts, PAPER);
  scribble(g, pts, color, { angle: o.angle ?? 0.9, gap: 4.5, w: 5, alpha: 0.92, seed });
  if (o.shade) scribble(g, pts, o.shade, { angle: -0.6, gap: 7, w: 4, alpha: 0.6, seed: seed + 1, keep: o.shadeFrom });
  line(g, [...pts, pts[0]].filter((_, i) => i % 2 === 0), o.ink ?? mix(color, "#2a1d3a", 0.55), o.ink_w ?? 2, seed + 2, 0.9, 0.9);
};

const HOR = 560, MX = 270, MY = 170;
const sky = (g: Gfx, frame: number) => wax(g, () => {
  const top: P[] = [[0, 0], [W, 0], [W, HOR + 10], [0, HOR + 10]];
  scribble(g, top, K.black, { angle: 0.38, gap: 7, w: 6.5, alpha: 0.85, seed: 10, over: 1, cache: true });
  scribble(g, top, K.night, { angle: -0.5, gap: 11, w: 5, alpha: 0.55, seed: 11, over: 1, cache: true, keep: (x, y) => y > 260 || Math.hypot(x - MX, y - MY) < 260 });
  // the moon: a thin crescent, burnished, the only light
  const moon = blob(MX, MY, 56, 56, 20, 0.04, 16), inner = (x: number, y: number) => Math.hypot(x - MX - 24, y - MY + 14) < 50;
  fillShape(g, moon, PAPER);
  scribble(g, moon, K.yellow, { angle: 0.9, gap: 4.5, w: 5, alpha: 0.9, seed: 21, cache: true, keep: (x, y) => !inner(x, y) });
  scribble(g, moon, K.white, { angle: 1.2, gap: 5, w: 4, alpha: 0.7, seed: 22, cache: true, over: 1, keep: (x, y) => !inner(x, y) && x < MX - 20 });
  scribble(g, moon, K.black, { angle: 0.38, gap: 4, w: 6, alpha: 0.95, seed: 23, cache: true, keep: inner });
  // stars, twinkling
  const r = rng(5);
  for (let i = 0; i < 46; i++) {
    const x = r() * W, y = 30 + r() * (HOR - 90), s = 4 + r() * 5, ph = r() * 6.28;
    if (Math.hypot(x - MX, y - MY) < 110) continue;
    const op = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(frame * 0.22 + ph));
    line(g, [[x - s, y], [x + s, y]], i % 3 ? K.white : K.yellow, 1.8, 30 + i, op, 0.3);
    line(g, [[x, y - s], [x, y + s]], i % 3 ? K.white : K.yellow, 1.8, 90 + i, op, 0.3);
  }
});

const sea = (g: Gfx, frame: number) => wax(g, () => {
  const s: P[] = [[0, HOR], [W, HOR], [W, H], [0, H]];
  fillShape(g, s, K.deep, 0.4);
  scribble(g, s, K.sea, { angle: 0.12, gap: 6, w: 6.5, alpha: 0.9, seed: 300, over: 1, cache: true });
  scribble(g, s, K.deep, { angle: -0.35, gap: 9, w: 5, alpha: 0.6, seed: 301, over: 1, cache: true, keep: (x, y) => y > 640 + Math.sin(x * 0.008) * 30 });
  line(g, [[0, HOR], [640, HOR - 2], [1280, HOR + 2], [W, HOR]], "#0d1430", 2.4, 302, 0.9, 1);
  // moon glint on the water, flickering
  for (let i = 0; i < 14; i++) {
    const y = HOR + 14 + i * 14, w = 34 - i * 1.4, op = 0.5 + 0.45 * Math.sin(frame * 0.3 + i * 1.7);
    if (op > 0.25) line(g, [[MX - w + Math.sin(frame * 0.1 + i) * 8, y], [MX + w + Math.sin(frame * 0.1 + i) * 8, y + 1]], i % 2 ? K.yellow : K.white, 2.6, 310 + i, op, 0.6);
  }
  // rows of crests drifting, bigger toward us
  for (let row = 0; row < 10; row++) {
    const t = row / 9, y0 = HOR + 20 + Math.pow(t, 1.5) * 470, sz = 14 + row * 7, sp = sz * 4.2, drift = frame * (0.5 + row * 0.18) + row * 97;
    for (let i = 0; i * sp < W + 2 * sp; i++) {
      const x = ((i * sp + drift) % (W + 2 * sp)) - sp, y = y0 + Math.sin(frame * 0.12 + i * 1.3 + row) * (2 + t * 4);
      line(g, [[x - sz, y + 2], [x - sz / 2, y - sz * 0.25], [x, y - sz * 0.32], [x + sz / 2, y - sz * 0.2], [x + sz, y + 3]], row % 2 ? "#4a6aa8" : K.foam, 1.4 + t * 2, 400 + row * 40 + i, 0.55 + t * 0.35, 0.8);
    }
  }
});

// ---------------------------------------------------------------- the boat and the fisherman, rocking
const boat = (g: Gfx, frame: number) => {
  const ph = (frame / 70) * Math.PI * 2, a = 0.07 * Math.sin(ph), bob = 7 * Math.sin(ph + 1.2), PX = 960, PY = 790 + bob;
  const m = (pts: P[]): P[] => pts.map(([x, y]) => [PX + x * Math.cos(a) - y * Math.sin(a), PY + x * Math.sin(a) + y * Math.cos(a)] as P);
  wax(g, () => {
    // oars resting out over the water
    line(g, m([[-40, -40], [-150, 0], [-250, 36]]), "#c98f4e", 6, 500, 0.95, 0.5);
    line(g, m([[50, -40], [160, 0], [260, 38]]), "#c98f4e", 6, 501, 0.95, 0.5);
    // the fisherman: yellow oilskin, round face, sou'wester, worried eyes looking about
    solid(g, m(smooth([[-46, 0], [-40, -78], [0, -96], [40, -78], [46, 0]], true, 8)), K.yellow, 510, { shade: K.orange, shadeFrom: (x) => x > PX + 8 * Math.cos(a), ink: "#8a5a10" });
    const hx = 0, hy = -128, look = Math.sin(frame * 0.09) * 5;
    solid(g, m(blob(hx, hy, 30, 32, 520, 0.06, 14)), K.skin, 521, { shade: "#e8a37c", shadeFrom: (x) => x > PX + 6, ink: "#6b3e2e", ink_w: 1.7, angle: 0.4 });
    line(g, m([[hx - 12 + look, hy - 4], [hx - 11 + look, hy + 4]]), "#3a2216", 2.6, 525, 0.95, 0.2);
    line(g, m([[hx + 10 + look, hy - 4], [hx + 11 + look, hy + 4]]), "#3a2216", 2.6, 526, 0.95, 0.2);
    line(g, m([[hx - 7, hy + 16], [hx, hy + 13], [hx + 7, hy + 16]]), "#a04a3a", 2, 527, 0.9, 0.3);
    solid(g, m(smooth([[-46, hy - 12], [-26, hy - 40], [8, hy - 48], [32, hy - 36], [48, hy - 10], [10, hy - 22], [-24, hy - 20]], true, 8)), K.yellow, 530, { shade: K.orange, shadeFrom: (x) => x > PX + 10, ink: "#8a5a10", angle: 0.5 });
    // hands on the oars
    solid(g, m(blob(-42, -42, 11, 10, 535, 0.1, 10)), K.skin, 536, { ink: "#6b3e2e", ink_w: 1.4 });
    solid(g, m(blob(50, -42, 11, 10, 537, 0.1, 10)), K.skin, 538, { ink: "#6b3e2e", ink_w: 1.4 });
    // the hull: red, shaded below, a white gunwale stripe
    const hull = m(smooth([[-190, -34], [-60, -22], [80, -24], [196, -42], [150, 34], [0, 46], [-140, 32]], true, 8));
    solid(g, hull, K.red, 540, { shade: "#8e1f1a", shadeFrom: (x, y) => y > PY + 10 || x > PX + 110, ink: "#4a1410", ink_w: 2.6, angle: 1.3 });
    line(g, m([[-182, -24], [-60, -12], [80, -14], [188, -32]]), K.white, 3.4, 545, 0.9, 0.6);
    // the water lapping over the bottom of the hull, moving
    const lap: P[] = [];
    for (let q = 0; q <= 20; q++) { const x = PX - 240 + q * 24; lap.push([x, PY + 22 + Math.sin(q * 0.9 + frame * 0.2) * 6]); }
    const band: P[] = [...lap, [PX + 240, PY + 80], [PX - 240, PY + 80]];
    scribble(g, band, K.sea, { angle: 0.1, gap: 5, w: 6, alpha: 0.95, seed: 550, over: 1 });
    line(g, lap.filter((_, i) => i % 2 === 0), K.foam, 2.4, 551, 0.85, 0.8);
  });
};

export const drawScene = (ctx: Ctx, frame: number, env: Env) => {
  const g = new Gfx(ctx, env, 0, CRAYON_M);
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  sky(g, frame); sea(g, frame); boat(g, frame);
  g.paper("paper", 0.08);
};

export const film: Film = { meta: { title: "Which way's home? · crayon", W: 1920, H: 1080, fps: FPS, bpm: 120, durationFrames: FRAMES }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: FRAMES, draw: drawScene }] };