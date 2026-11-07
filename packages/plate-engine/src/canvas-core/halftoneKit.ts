// HALFTONE KIT. What a newspaper press needs that the core does not have: a continuous-tone
// ORIGINAL held as two float separations (black and spot), an AM screen that turns one of them
// into irregular, ink-spread dots, the newsprint sheet with its fibres, and the ink-starve mottle
// of a press still coming up to colour. Everything is geometry, seeded tiles or image data built
// once and cached under a key that names what its pixels depend on. No filters, no assets.
import { fractal, getRenderQuality, recordKitMaterialReduction, recordOtherPathStats, rng, type Ctx, type Env, type Layer, type P } from "./core";

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the original: two separations
// k = black density 0..1, s = spot density 0..1, both at w x h over the logical frame W x H.
export type Tone = { w: number; h: number; W: number; H: number; k: Float32Array; s: Float32Array };
export const newTone = (w: number, h: number, W: number, H: number): Tone => ({ w, h, W, H, k: new Float32Array(w * h), s: new Float32Array(w * h) });
// bilinear read of one separation at a LOGICAL point
export const toneAt = (t: Tone, ch: Float32Array, x: number, y: number) => {
  const fx = clamp((x / t.W) * t.w - 0.5, 0, t.w - 1.001), fy = clamp((y / t.H) * t.h - 0.5, 0, t.h - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, a = j * t.w + i;
  return (ch[a] * (1 - u) + ch[a + 1] * u) * (1 - v) + (ch[a + t.w] * (1 - u) + ch[a + t.w + 1] * u) * v;
};
// Composite a painted RGBA surface over the separations: R = black, G = spot, A = coverage.
// `tex(i, j, bChannel, k, s)` may alter the painted values per pixel (stone courses, weathering)
// and returns [k, s]. The B channel is a material id, read only where coverage is full.
export const over = (t: Tone, L: Layer, tex?: (x: number, y: number, mat: number, k: number, s: number) => [number, number]) => {
  const d = L.ctx.getImageData(0, 0, t.w, t.h).data, sx = t.W / t.w, sy = t.H / t.h;
  for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) {
    const p = (j * t.w + i) * 4, a = d[p + 3] / 255; if (a <= 0) continue;
    let k = d[p] / 255, s = d[p + 1] / 255; if (tex) [k, s] = tex((i + 0.5) * sx, (j + 0.5) * sy, d[p + 2], k, s);
    const q = j * t.w + i; t.k[q] = t.k[q] * (1 - a) + k * a; t.s[q] = t.s[q] * (1 - a) + s * a;
  }
};
// a colour for painting a separation surface: black density k, spot density s, material m
export const ks = (k: number, s: number, m = 0, a = 1) => `rgba(${Math.round(clamp(k) * 255)},${Math.round(clamp(s) * 255)},${m},${a})`;

// ---------------------------------------------------------------- the screen
// A newspaper AM screen: dots on a rotated grid, area proportional to tone. On newsprint the
// finest highlight dots do not hold (they drop out below ~4%), and every dot GAINS as the ink
// soaks sideways into the fibres, so the shadows plug toward solid. `fan` is the paper's
// fan-out: the sheet stretches across its width between units, so the spot lands a little wider.
export type Dot = [number, number, number];
export const screenDots = (b: { x0: number; y0: number; x1: number; y1: number }, pitch: number, ang: number, tone: (x: number, y: number) => number, gain: number, fan = 0): Dot[] => {
  const a = (ang * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + pitch, out: Dot[] = [];
  for (let u = -R; u <= R; u += pitch) for (let v = -R; v <= R; v += pitch) {
    const x = cx + u * c - v * sn, y = cy + u * sn + v * c; if (x < b.x0 - pitch || x > b.x1 + pitch || y < b.y0 - pitch || y > b.y1 + pitch) continue;
    const t = clamp(tone(x, y)); if (t < 0.045) continue;
    // area-true: a dot's area is the tone (sqrt(t / pi)), swelling past 70% so the dots join into a
    // solid with pinholes; then the gain, strongest in the midtones where the dot's edge is longest
    const r = pitch * (Math.sqrt(t / Math.PI) + 0.17 * t * t * t) + gain * (0.5 + 2 * t * (1 - t));
    out.push([x + (x - b.x0) * fan, y, r]);
  }
  return out;
};
// Ink the dots: each an irregular heptagon, its radius bitten by a fixed per-dot hash, so no two
// dots are the same shape and the pattern never looks like a vector grid.
export const inkDots = (c: Ctx, dots: Dot[], seed: number) => {
  const q = getRenderQuality();
  const isDraft = q.mode === "draft";
  const sides = isDraft ? 5 : 7;
  c.beginPath();
  let drawn = 0;
  for (const [x, y, r] of dots) {
    if (r < 0.35) continue;
    drawn++;
    const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453), a0 = (h % 1) * 6.283;
    for (let k = 0; k <= sides; k++) { const a = a0 + (k / sides) * 6.283, w = 1 + 0.14 * Math.sin(a * 2 + h) + 0.08 * Math.sin(a * 3 + h * 1.7), px = x + Math.cos(a) * r * w, py = y + Math.sin(a) * r * w; k ? c.lineTo(px, py) : c.moveTo(px, py); }
  }
  c.fill();
  recordOtherPathStats(drawn, drawn * sides, false);
  if (isDraft && drawn > 0) recordKitMaterialReduction(drawn * 2);
};

// ---------------------------------------------------------------- the ink on the paper
export const plateLayer = (env: Env, key: string, dots: Dot[], color: string, spread: number, seed: number): Layer => {
  let L = env.cache.get(key) as Layer | undefined; if (L) return L;
  const DW = Math.round(env.W * env.scale), DH = Math.round(env.H * env.scale), k = env.scale;
  L = env.canvas(DW, DH); const c = L.ctx; c.setTransform(k, 0, 0, k, 0, 0); c.fillStyle = color; inkDots(c, dots, seed);
  const q = Math.max(1, Math.round(DW / (spread * k * 2.2))), qh = Math.max(1, Math.round((q * DH) / DW)), S = env.canvas(q, qh);
  S.ctx.imageSmoothingEnabled = true; S.ctx.drawImage(L.canvas, 0, 0, q, qh);
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "destination-over"; c.globalAlpha = 0.5; c.imageSmoothingEnabled = true; c.drawImage(S.canvas, 0, 0, DW, DH); c.globalAlpha = 1; c.globalCompositeOperation = "source-over";
  env.cache.set(key, L); return L;
};

// ---------------------------------------------------------------- the sheet
export const NEWSPRINT = "#e6dfcc";
export const newsprint = (env: Env, key: string): Layer => {
  const q = getRenderQuality();
  const isDraft = q.mode === "draft";
  const cKey = isDraft ? `${key}:draft:${q.materialDetailScale}` : key;
  let L = env.cache.get(cKey) as Layer | undefined;
  if (L) {
    if (isDraft) recordKitMaterialReduction(1);
    return L;
  }
  const W = env.W, H = env.H, k = env.scale; L = env.canvas(Math.round(W * k), Math.round(H * k)); const c = L.ctx;
  c.setTransform(k, 0, 0, k, 0, 0); c.fillStyle = NEWSPRINT; c.fillRect(0, 0, W, H);
  const img = c.getImageData(0, 0, L.canvas.width, L.canvas.height), d = img.data, n = L.canvas.width, h = L.canvas.height;
  const step = isDraft ? Math.max(2, q.surfaceSampleFactor * 2) : 1;
  if (step <= 1) {
    for (let y = 0; y < h; y += 1) for (let x = 0; x < n; x += 1) { const v = fractal(301, x / k, y / k, 0.006, 0.006, 3) - 0.5, g = fractal(302, x / k, y / k, 0.35, 0.35, 1) - 0.5, p = (y * n + x) * 4, o = v * 16 + g * 7; d[p] += o; d[p + 1] += o; d[p + 2] += o * 1.2; }
  } else {
    for (let y = 0; y < h; y += step) for (let x = 0; x < n; x += step) {
      const v = fractal(301, x / k, y / k, 0.006, 0.006, 2) - 0.5, g = fractal(302, x / k, y / k, 0.35, 0.35, 1) - 0.5, o = v * 16 + g * 7;
      for (let dy = 0; dy < step && y + dy < h; dy++) for (let dx = 0; dx < step && x + dx < n; dx++) {
        const p = ((y + dy) * n + (x + dx)) * 4; d[p] += o; d[p + 1] += o; d[p + 2] += o * 1.2;
      }
    }
  }
  c.putImageData(img, 0, 0); c.setTransform(k, 0, 0, k, 0, 0);
  const r = rng(303), area = W * H;
  const totalFibres = area / 900;
  const keepMod = isDraft ? Math.max(2, Math.round(1 / q.materialDetailScale)) : 1;
  for (let i = 0; i < totalFibres; i++) {
    const x = r() * W, y = r() * H, len = 1.5 + Math.pow(r(), 3) * 12, a = r() * 6.283, bend = (r() - 0.5) * 0.9, dark = r() < 0.8;
    const al = dark ? 0.1 + r() * 0.22 : 0.3 + r() * 0.4, lw = 0.35 + r() * 0.5;
    if (isDraft && i % keepMod !== 0) continue;
    c.strokeStyle = dark ? `rgba(92,78,58,${al})` : `rgba(250,246,236,${al})`; c.lineWidth = lw;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + bend) * len * 0.5, y + Math.sin(a + bend) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke();
  }
  for (let i = 0; i < area / 60000; i++) { const x = r() * W, y = r() * H, s = 0.6 + r() * 1.1; c.fillStyle = `rgba(70,55,40,${0.25 + r() * 0.3})`; c.beginPath(); c.ellipse(x, y, s, s * (0.4 + r() * 0.5), r() * 3, 0, 6.283); c.fill(); }
  if (isDraft) recordKitMaterialReduction(1);
  env.cache.set(cKey, L); return L;
};

// ---------------------------------------------------------------- starve mottle
export const mottleTile = (env: Env): Layer => {
  const q = getRenderQuality();
  const step = q.mode === "draft" ? Math.max(2, q.surfaceSampleFactor) : 1;
  const key = step > 1 ? `halftone:mottle:${env.scale}:s${step}` : `halftone:mottle:${env.scale}`;
  let L = env.cache.get(key) as Layer | undefined;
  if (L) {
    if (step > 1) recordKitMaterialReduction(1);
    return L;
  }
  const n = 256; L = env.canvas(n, n); const img = L.ctx.createImageData(n, n), d = img.data;
  if (step <= 1) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = fractal(311, x, y, 0.09, 0.012, 3, n) * 0.7 + fractal(312, x, y, 0.5, 0.5, 1, n) * 0.3, p = (y * n + x) * 4; d[p] = d[p + 1] = d[p + 2] = 0; d[p + 3] = 255 * clamp((v - 0.38) * 3.5); }
  } else {
    for (let y = 0; y < n; y += step) for (let x = 0; x < n; x += step) {
      const v = fractal(311, x, y, 0.09, 0.012, 2, n) * 0.7 + fractal(312, x, y, 0.5, 0.5, 1, n) * 0.3, a0 = 255 * clamp((v - 0.38) * 3.5);
      for (let dy = 0; dy < step && y + dy < n; dy++) for (let dx = 0; dx < step && x + dx < n; dx++) {
        const p = ((y + dy) * n + (x + dx)) * 4; d[p] = d[p + 1] = d[p + 2] = 0; d[p + 3] = a0;
      }
    }
    recordKitMaterialReduction(1);
  }
  L.ctx.putImageData(img, 0, 0); env.cache.set(key, L); return L;
};
export const starve = (c: Ctx, env: Env, rect: [number, number, number, number], amount: number, shift: P) => {
  if (amount <= 0.001) return; const t = mottleTile(env), k = env.scale;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.beginPath(); c.rect(rect[0] * k, rect[1] * k, (rect[2] - rect[0]) * k, (rect[3] - rect[1]) * k); c.clip();
  c.setTransform(k * 1.6, 0, 0, k * 1.6, shift[0] * k, shift[1] * k); c.globalCompositeOperation = "destination-out"; c.globalAlpha = clamp(amount);
  c.fillStyle = c.createPattern(t.canvas, "repeat")!; c.fillRect(-shift[0] / 1.6 - 10, -shift[1] / 1.6 - 10, env.W / 1.6 + 20, env.H / 1.6 + 20); c.restore();
};
