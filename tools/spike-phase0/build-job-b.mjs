// Phase 0 Job B: build test scenes for text (engine lettering + named font via fillText) and image assets (__ASSETS__).
// Usage: node build-job-b.mjs <out-dir> <chrome-path>
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const [out, chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] = process.argv.slice(2);
process.env.PLATE_BROWSER_PATH = chrome;
const root = resolve(import.meta.dirname, "../../packages/plate-engine");
const { bundleScene } = await import(join(root, "lib/engine.mjs"));
const { openScene } = await import(join(root, "lib/capture.mjs"));
mkdirSync(out, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");

// 1a. Text scene using engine stroke lettering (drafting.ts letter() + blueprintKit.ts k.text / k.callout / k.dim)
const textStrokeCode = `
import { Gfx, type Ctx, type Env, type P } from "./core";
import type { Film } from "./film";
import { CYAN, DRAFT, WHITE, border, cut, kit, sheet, stagger, tooth } from "./blueprintKit";

const W = 1920, H = 1080, FRAMES = 90;

const draw = (ctx: Ctx, frame: number, env: Env) => {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  const g = new Gfx(ctx, env, frame, DRAFT), k = kit(g);
  const q = (a: number, b: number) => cut(frame / FRAMES, a, b);
  sheet(k);
  border(k, q(0, 0.25));
  k.ink(() => {
    k.text("PHASE 0 · ENGINE STROKE LETTERING", 960, 180, { cap: 28, align: "center", seed: 10, w: 2.6, progress: q(0.05, 0.45) });
    k.text("SINGLE-STROKE INCLINED GOTHIC CAPITALS (DRAFTING.TS)", 960, 240, { cap: 14, align: "center", seed: 11, color: CYAN, w: 1.4, progress: q(0.15, 0.55) });
    const rows = [
      ["01", "ESCAPEMENT WHEEL", "15T", "0.45 MM"],
      ["02", "PALLET FORK", "STEEL", "2.10 MM"],
      ["03", "BALANCE SPRING", "BRASS", "8.50 MM"]
    ];
    const st = stagger(q(0.25, 0.8), rows.length, 0.5);
    rows.forEach((r, i) => {
      const y = 380 + i * 76, p = st(i);
      k.ln([320, y + 36], [1600, y + 36], 1.1, { seed: 20 + i, color: CYAN, progress: p });
      k.text(r[0], 360, y, { cap: 16, seed: 30 + i * 4, color: CYAN, w: 1.5, progress: p });
      k.text(r[1], 460, y, { cap: 16, seed: 31 + i * 4, color: WHITE, w: 1.6, progress: p });
      k.text(r[2], 1120, y, { cap: 16, seed: 32 + i * 4, color: CYAN, w: 1.5, progress: p });
      k.text(r[3], 1380, y, { cap: 16, seed: 33 + i * 4, color: WHITE, w: 1.6, progress: p });
    });
    k.callout("CHRONOMETER CAL. 30", [540, 740], [720, 820], 80, "left", q(0.4, 0.9), 14);
    k.dim([760, 820], [1360, 820], -36, "60.0 MM", 90, q(0.45, 0.95), { cap: 13 });
  });
  tooth(g);
};

export const film: Film = {
  meta: { title: "Text stroke lettering · blueprint", W, H, fps: 30, bpm: 120, durationFrames: FRAMES },
  assets: { images: {} },
  shots: [{ id: "scene", start: 0, end: FRAMES, draw }]
};
`;

// 1b. Text scene using named fonts via canvas fillText (plus stroke lettering for comparison)
const textFontCode = `
import { Gfx, PENCIL, type Ctx, type Env } from "./core";
import type { Film } from "./film";
import { fillShape, smooth } from "./gallery";

const W = 1920, H = 1080, FRAMES = 90;

const draw = (ctx: Ctx, frame: number, env: Env) => {
  const g = new Gfx(ctx, env, frame, PENCIL);
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = "#faf5e8";
  ctx.fillRect(0, 0, W, H);
  g.group("plain", () => fillShape(g, smooth([[120, 120], [1800, 120], [1800, 960], [120, 960]], true, 6), "#efe4cc", 1));

  const p = Math.min(1, (frame + 15) / 60);
  g.group("plain", () => {
    const c = g.cur;
    c.save();
    c.setTransform(env.scale, 0, 0, env.scale, 0, 0);
    c.textBaseline = "alphabetic";
    c.fillStyle = "#231f1b";
    c.font = "700 54px 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";
    c.fillText("Named Font Stack: Plus Jakarta Sans / Helvetica Neue / Arial", 200, 260);

    c.fillStyle = "#1e3a5f";
    c.font = "600 44px 'Georgia', 'Times New Roman', serif";
    c.fillText("Serif Stack: Georgia / Times New Roman / Liberation Serif", 200, 380);

    c.fillStyle = "#0c4a6e";
    c.font = "700 40px 'SF Mono', 'Menlo', 'Courier New', monospace";
    c.fillText("Monospace Stack: SF Mono / Menlo / Courier New (0123456789)", 200, 500);

    c.fillStyle = "#7c2d12";
    c.font = "700 44px 'Liberation Sans', 'DejaVu Sans', sans-serif";
    c.fillText("Linux Worker Installed: Liberation Sans / DejaVu Sans", 200, 620);

    c.fillStyle = "#3b2c55";
    c.font = "400 36px sans-serif";
    c.fillText("Generic sans-serif progress=" + p.toFixed(2) + " frame=" + frame, 200, 740);
    c.restore();
    g.touch(180, 180, 1780, 820);
  });
  g.paper("paper", 0.1);
};

export const film: Film = {
  meta: { title: "Named font fillText · fox", W, H, fps: 30, bpm: 120, durationFrames: FRAMES },
  assets: { images: {} },
  shots: [{ id: "scene", start: 0, end: FRAMES, draw }]
};
`;

// 2. Image asset scene using film.assets.images and env.image(name) + window.__ASSETS__
const imageAssetCode = `
import { Gfx, PENCIL, type Ctx, type Env } from "./core";
import type { Film } from "./film";
import { fillShape, smooth } from "./gallery";

const W = 1920, H = 1080, FRAMES = 90;

const draw = (ctx: Ctx, frame: number, env: Env) => {
  const g = new Gfx(ctx, env, frame, PENCIL);
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = "#2b2230";
  ctx.fillRect(0, 0, W, H);
  g.group("plain", () => fillShape(g, smooth([[140, 120], [1780, 120], [1780, 960], [140, 960]], true, 6), "#f4ead5", 1));

  const badge = env.image?.("badge");
  const stamp = env.image?.("stamp");
  g.group("plain", () => {
    const c = g.cur;
    c.save();
    c.setTransform(env.scale, 0, 0, env.scale, 0, 0);
    c.imageSmoothingEnabled = false;
    if (badge) {
      const x = 320 + Math.round(frame * 3.5);
      const y = 280 + Math.round(Math.sin(frame * 0.1) * 40);
      c.drawImage(badge, x, y, 320, 320);
    }
    if (stamp) {
      const x = 1120 - Math.round(frame * 2.0);
      const y = 360;
      c.drawImage(stamp, x, y, 256, 256);
    }
    c.restore();
    g.touch(200, 200, 1600, 750);
  });
  // also draw with bilinear smoothing at a subpixel offset to test both nearest and bilinear image blits
  g.group("plain", () => {
    const c = g.cur;
    c.save();
    c.setTransform(env.scale, 0, 0, env.scale, 0, 0);
    c.imageSmoothingEnabled = true;
    if (badge) c.drawImage(badge, 320.35, 680.65, 180, 180);
    if (stamp) c.drawImage(stamp, 620.35, 680.65, 180, 180);
    c.restore();
    g.touch(300, 660, 840, 880);
  });
  g.paper("paper", 0.1);
};

export const film: Film = {
  meta: { title: "Image assets · fox", W, H, fps: 30, bpm: 120, durationFrames: FRAMES },
  assets: { images: { badge: "asset:badge", stamp: "asset:stamp" } },
  shots: [{ id: "scene", start: 0, end: FRAMES, draw }]
};
`;

// Generate deterministic data-URL PNGs via headless Chrome / Playwright or pure zlib PNG
import { deflateSync } from "node:zlib";
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function makePngDataUrl(w, h, pixelFn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixelFn(x, y, w, h);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const badgeUrl = makePngDataUrl(64, 64, (x, y, w, h) => {
  const dx = x - w / 2, dy = y - h / 2, r = Math.hypot(dx, dy);
  if (r > 28) return [218, 78, 52, 255];
  if (r > 20) return [250, 224, 150, 255];
  return ((x >> 3) + (y >> 3)) % 2 === 0 ? [38, 84, 124, 255] : [245, 240, 230, 255];
});
const stampUrl = makePngDataUrl(64, 64, (x, y) => {
  const border = x < 6 || x >= 58 || y < 6 || y >= 58;
  if (border) return [184, 50, 42, 255];
  const diag = Math.abs(x - y) < 5 || Math.abs(x + y - 63) < 5;
  return diag ? [184, 50, 42, 255] : [247, 236, 210, 255];
});

const specs = [
  { name: "text-stroke", look: "illus-blueprint", code: textStrokeCode, frames: 90, assets: null },
  { name: "text-font", look: "illus-fox", code: textFontCode, frames: 90, assets: null },
  { name: "image-asset", look: "illus-fox", code: imageAssetCode, frames: 90, assets: { badge: badgeUrl, stamp: stampUrl } }
];

const results = [];
for (const sp of specs) {
  let { html } = await bundleScene({ look: sp.look, code: sp.code, frames: sp.frames, aspect: "16:9" });
  if (sp.assets) {
    html = html.replace("window.__ASSETS__={};", `window.__ASSETS__=${JSON.stringify(sp.assets)};`);
  }
  const htmlPath = join(out, `${sp.name}.html`);
  writeFileSync(htmlPath, html);
  const session = await openScene(htmlPath, { pages: 1 });
  const meta = await session.meta(), refs = {};
  for (const n of [0, 45, 89]) {
    const png = await session.frame(n, 0);
    writeFileSync(join(out, `${sp.name}-ref-${n}.png`), png);
    refs[n] = sha(png);
  }
  await session.close();
  results.push({ name: sp.name, look: sp.look, frames: sp.frames, bytes: html.length, htmlSha: sha(html), meta, refs });
  console.log("built", sp.name, Math.round(html.length / 1024), "KB");
}
writeFileSync(join(out, "job-b.json"), JSON.stringify(results, null, 1));
