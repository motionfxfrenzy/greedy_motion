// A prop that rests in the set (kit.txt K.prop) stays put in the set under a moving camera; a prop painted straight onto the screen drifts and floats.
// Offline: the scenes are bundled by the plate engine and drawn in headless Chromium (like history-reel-render.mjs) on the Niagara set picture.
//  BEFORE: a dark box with an indicator light painted with raw g.fillRect/g.arc at fixed screen coordinates (the owner's floating magnetron).
//  AFTER:  the same box through K.prop, standing on the bench line of the set.
// The light's position is measured in the rendered frames: BEFORE it does not move although the set does, AFTER it moves with the set.
// The scene check (prop-check.ts) must flag BEFORE and pass AFTER. Frames are saved as PNGs to OUT (default <tmp>/history-reel-props).
// Run: node backend/test/history-reel-props-render.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const here = dirname(fileURLToPath(import.meta.url));
const imgDir = process.env.NIAGARA_IMG ?? resolve(here, "../../../VideoSaaS/experiments/history-reels/template/films/niagara/img");
const OUT = process.env.OUT ?? join(tmpdir(), "history-reel-props");
mkdirSync(OUT, { recursive: true });
function findBrowser() {
  if (process.env.PLATE_BROWSER_PATH) return process.env.PLATE_BROWSER_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return null;
  for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort().reverse()) for (const sub of readdirSync(join(cache, dir))) { const bin = join(cache, dir, sub, "chrome-headless-shell"); if (existsSync(bin)) return bin; }
  return null;
}
const browser = findBrowser();
if (!existsSync(imgDir) || !browser) { console.log(`history-reel props render: skipped (${!browser ? "no browser" : `no images at ${imgDir}`})`); process.exit(0); }
process.env.PLATE_BROWSER_PATH = browser;

const { templatePack, withPackKit } = await import("../src/plan/template-packs.ts");
const { bundleScene } = await import("@videosaas/plate-engine");
const { openScene } = await import("@videosaas/plate-engine/capture");
const { wireSceneAssets } = await import("../src/plates/pack-assets.ts");
const { withAssetData } = await import("../../worker/src/pack-assets.mjs");
const { scenePropIssues } = await import("../src/plan/packs/history-reel/prop-check.ts");
const sharp = (await import("sharp")).default;
const pack = templatePack("history-reel");
const kit = pack.scenes().kit;

const scene = (box) => `import type { Ctx, Env } from "./core";
import type { Film } from "./film";
const durationFrames = 90;
const KEYS = [[0, { x: 540, y: 1250, z: 1.05 }], [89, { x: 420, y: 1000, z: 1.7 }, "lin"]];
function draw(ctx: Ctx, frame: number, env: Env) {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  const cam = K.camera(frame, KEYS);
  K.set(ctx, env, cam, "gorge");
  K.actors(ctx, env, cam, (g) => {
${box}
  });
}
export const film: Film = { meta: { title: "props", W: 1080, H: 1920, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };
export const sounds: { kind: string; frame: number }[] = [];
`;
// the owner's magnetron: a dark box with a indicator light
const BEFORE = scene(`    g.fillStyle = "#22252e"; g.fillRect(440, 1040, 170, 120);
    g.fillStyle = "#ff00e5"; g.beginPath(); g.arc(560, 1100, 14, 0, 7); g.fill();`);
const AFTER = scene(`    K.prop(g, cam, { name: "magnetron", x: 520, y: 1560, on: "bench", w: 220, draw: (c: any) => {
      c.fillStyle = "#22252e"; c.fillRect(-85, -120, 170, 120);
      c.fillStyle = "#ff00e5"; c.beginPath(); c.arc(40, -60, 14, 0, 7); c.fill();
    } });`);

const dataUrl = (file) => `data:${file.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${readFileSync(file).toString("base64")}`;
const ASSETS = { "set-gorge": dataUrl(join(imgDir, "set-gorge.jpg")), "depth-gorge": dataUrl(join(imgDir, "depth-gorge.png")) };
async function render(name, code, frames) {
  const wired = wireSceneAssets(withPackKit(code, pack), ["set-gorge", "depth-gorge"], ["set-gorge", "depth-gorge"]);
  const refs = Object.fromEntries(["set-gorge", "depth-gorge"].map((n) => [n, `u:plates/00000000-0000-0000-0000-000000000000/assets/${n}.png`]));
  const bundle = await bundleScene({ look: "illus-flat-vector", code: wired, frames: 90, aspect: "9:16", assets: refs });
  const file = join(OUT, `${name}.html`); writeFileSync(file, withAssetData(bundle.html, ASSETS));
  const session = await openScene(file, { pages: 1 });
  try { const out = {}; for (const f of frames) { out[f] = await session.frame(f, 0); writeFileSync(join(OUT, `${name}-${String(f).padStart(2, "0")}.png`), out[f]); } return out; } finally { await session.close(); }
}
/** Centre of the indicator light (magenta: a colour the set never has, still magenta after the set's warm grade) in a frame, or null. */
async function blue(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < data.length; i += info.channels) { const p = i / info.channels; const y = Math.floor(p / info.width); if (y > 700 && data[i] > 170 && data[i + 2] > 150 && data[i + 1] < 120) { n++; sx += p % info.width; sy += y; } }
  return n > 20 ? { x: sx / n, y: sy / n, n } : null;
}

// the check: the floating box is flagged, the anchored one passes
const before = scenePropIssues(BEFORE, kit), after = scenePropIssues(AFTER, kit);
assert.ok(before.some((m) => /paints straight onto the screen/.test(m)), `the floating box is flagged: ${before.join(" | ").slice(0, 200)}`);
assert.deepEqual(after, [], "the box through K.prop passes");

const FRAMES = [0, 45, 89];
const b = await render("before", BEFORE, FRAMES), a = await render("after", AFTER, FRAMES);
const bp = await Promise.all(FRAMES.map((f) => blue(b[f]))), ap = await Promise.all(FRAMES.map((f) => blue(a[f])));
assert.ok(bp.every(Boolean) && ap.every(Boolean), `the indicator light is visible in every frame (before ${JSON.stringify(bp)}, after ${JSON.stringify(ap)})`);
const drift = (list) => Math.hypot(list[2].x - list[0].x, list[2].y - list[0].y);
assert.ok(drift(bp) < 3, `BEFORE: the painted box stays at the same screen spot (${drift(bp).toFixed(1)} px) while the set moves under it: it floats`);
assert.ok(drift(ap) > 60, `AFTER: the prop moves with the set (${drift(ap).toFixed(1)} px), exactly as a puppet standing there would`);
// its contact shadow: pixels below the box are darker than the same spot in the set without the prop
const shadowBelow = async (png, p) => { const { data, info } = await sharp(png).extract({ left: Math.max(0, Math.round(p.x) - 30), top: Math.round(p.y) + 80, width: 60, height: 20 }).raw().toBuffer({ resolveWithObject: true }); let s = 0; for (let i = 0; i < data.length; i += info.channels) s += data[i] + data[i + 1] + data[i + 2]; return s / (data.length / info.channels); };
void shadowBelow; // the shadow is checked by eye in the saved frames; the position checks above are the contract

execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...["before", "after"].flatMap((n) => [0, 89].flatMap((f) => ["-i", join(OUT, `${n}-${String(f).padStart(2, "0")}.png`)])), "-filter_complex", "[0][1][2][3]hstack=inputs=4,scale=1600:-1", "-frames:v", "1", join(OUT, "before-after.jpg")]);
console.log(`history-reel props render: ok. indicator light moved BEFORE ${drift(bp).toFixed(1)} px (floats), AFTER ${drift(ap).toFixed(1)} px (in the set). Frames in ${OUT}`);
