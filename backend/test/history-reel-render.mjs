// History-reel pack, local proof (offline, no network, no database): one hand-written scene built on the pack's kit is bundled by
// the plate engine (bundleScene) and drawn frame by frame in headless Chromium (openScene, the render worker's path), with the
// Niagara set and depth images from the experiment injected as the scene's assets. It is drawn three ways:
//   gl    - the default WebGL set renderer (depth parallax in a shader);
//   nogl  - WebGL switched off, so the 2D fallback (two parallax layers) draws the set;
//   flat  - no depth map at all (a flat zoom; the set must still draw).
// Frames are saved as PNGs to OUT (default: <tmp>/history-reel-proof). GEN_REFS=1 also rewrites the pack's reference pictures
// (pose-sheet.png, kit-shot.png under backend/src/plan/packs/history-reel/).
// Needs a browser: PLATE_BROWSER_PATH, or playwright's cached headless shell. Run: node backend/test/history-reel-render.mjs
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
const packDir = resolve(here, "../src/plan/packs/history-reel");
const imgDir = process.env.NIAGARA_IMG ?? resolve(here, "../../../VideoSaaS/experiments/history-reels/template/films/niagara/img");
const OUT = process.env.OUT ?? join(tmpdir(), "history-reel-proof");
mkdirSync(OUT, { recursive: true });

function findBrowser() {
  if (process.env.PLATE_BROWSER_PATH) return process.env.PLATE_BROWSER_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return null;
  for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort().reverse()) {
    for (const sub of readdirSync(join(cache, dir))) { const bin = join(cache, dir, sub, "chrome-headless-shell"); if (existsSync(bin)) return bin; }
  }
  return null;
}
const browser = findBrowser();
if (!existsSync(imgDir) || !browser) { console.log(`history-reel render: skipped (${!browser ? "no browser" : `no images at ${imgDir}`})`); process.exit(0); }
process.env.PLATE_BROWSER_PATH = browser;

const { templatePack, withPackKit } = await import("../src/plan/template-packs.ts");
const { bundleScene } = await import("@videosaas/plate-engine");
const { openScene } = await import("@videosaas/plate-engine/capture");
const { wireSceneAssets } = await import("../src/plates/pack-assets.ts");
const { withAssetData } = await import("../../worker/src/pack-assets.mjs");
const pack = templatePack("history-reel");
assert.ok(pack?.scenes, "the history-reel pack is registered and has scenes()");

// ---- the scene: the Niagara opening shot, as the scene-writing model would write it (plate coords of the "gorge" set)
const SCENE = `import type { Ctx, Env } from "./core";
import type { Film } from "./film";
const durationFrames = 90;
const blondin = K.makeCast({ skin: "#e9b892", skinShade: "#cc9673", shirt: "#8e2b3c", shirtShade: "#6c1f2d", dots: "#f3c64f", collar: false, buttons: false, pants: "#efe3c6", pantsShade: "#cdbf9d", boot: "#4a2b20", hair: "#2b1a12", moustache: "#2b1a12", width: 112, torso: 146, leg: 92 });
const harry = K.makeCast({ skin: "#f3cfae", skinShade: "#d7aa88", shirt: "#4a4a58", shirtShade: "#363642", pants: "#3c3c48", pantsShade: "#2c2c36", boot: "#1f1a18", hat: "bowler", hatColor: "#2a2420", hatShade: "#1b1714", band: "#6b2a22", moustache: "#5a3a22", vest: "#7a2f2f", vestShade: "#5c2323", width: 124, torso: 140, leg: 80 });
const crowd = K.crowdCast(10, 7);
const rope = K.ropeCurve({ x: 150, y: 1095, d: 0.62 }, { x: 960, y: 770, d: 0.12 }, 70);
// "across" lands on frame 44: hold wide on the gorge, then snap in to the walker
const KEYS = [[0, { x: 540, y: 1250, z: 1.05 }], [40, { x: 540, y: 1240, z: 1.1 }, "lin"], [52, { x: 470, y: 980, z: 2.2, px: -20, dof: 14 }, "snap"], [89, { x: 480, y: 975, z: 2.35, dof: 14 }, "lin"]];
function draw(ctx: Ctx, frame: number, env: Env) {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  const t = frame / 30;
  const cam = K.camera(frame, KEYS);
  K.set(ctx, env, cam, "gorge");
  K.actors(ctx, env, cam, (g) => {
    K.mist(g, cam, t, 650, 1000, 820, 0.12);
    K.drawRope(g, cam, rope, 9);
    const u = 0.42 + t * 0.012, p = rope(u), walk = K.pose.walk(blondin, t, "side", 1.6);
    const balance = { face: 1, ...walk, ...K.pose.holdPole(blondin, "side"), stepF: walk.stepF, stepB: walk.stepB, fFy: walk.fFy, fBy: walk.fBy, bob: walk.bob, hipY: undefined, lean: 2 + Math.sin(t * 2.3) * 3, face2: K.FACE.focus };
    K.puppet(g, cam, blondin, p.x, p.y, 150 - u * 120, balance, { shadow: false, d: p.d + 0.02, front: (c: Ctx, R: any) => K.pole(c, R, Math.sin(t * 2.3) * 4) });
    K.crowd(g, cam, crowd, [[1500, 230, 4], [1650, 290, 4]], frame, "watch", 560, 1040);
    K.puppet(g, cam, harry, 300, 1640, 480, { face: 1, ...K.pose.fidget(harry, t), head: -6, look: 0.9, face2: { ...K.FACE.scared, blink: K.blink(frame, [20, 70]) } }, { sun: "left" });
    K.motes(g, cam, t);
  });
}
export const film: Film = { meta: { title: "gorge", W: 1080, H: 1920, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };
export const sounds: { kind: string; frame: number }[] = [{ kind: "whoosh", frame: 40 }, { kind: "step", frame: 60 }];
`;

// ---- the pose sheet: the same rig in its pose library, on three different builds (no set: a plain card)
const POSES = `import type { Ctx, Env } from "./core";
import type { Film } from "./film";
const durationFrames = 2;
const cast = [
  K.makeCast({ shirt: "#a83f3f", shirtShade: "#822f2f", hat: "wide", moustache: "#3b2618" }),
  K.makeCast({ shirt: "#3f6fa8", shirtShade: "#2f5482", hat: "top", hatColor: "#2a2420", hatShade: "#1b1714", width: 80, torso: 170, leg: 98, glasses: true }),
  K.makeCast({ shirt: "#c79a3a", shirtShade: "#a07a26", hat: "bowler", hatColor: "#2a2420", hatShade: "#1b1714", width: 140, torso: 128, leg: 70, beard: "#6b4a2b" }),
];
const POSE = [
  (c: any) => ({ ...K.pose.stand(c, "side"), face2: K.FACE.calm }),
  (c: any) => ({ ...K.pose.stand(c, "three"), face2: K.FACE.happy }),
  (c: any) => ({ ...K.pose.stand(c, "front"), face2: K.FACE.wow }),
  (c: any) => ({ ...K.pose.walk(c, 0.3, "side"), face2: K.FACE.focus }),
  (c: any) => ({ ...K.pose.run(c, 0.2, "side"), face2: K.FACE.shout }),
  (c: any) => ({ ...K.pose.holdPole(c, "side"), face2: K.FACE.focus }),
  (c: any) => ({ ...K.pose.push(c, "side"), face2: K.FACE.grin }),
  (c: any) => ({ ...K.pose.holdOut(c, "three"), face2: K.FACE.smug }),
  (c: any) => ({ ...K.pose.handsOnHips(c), face2: K.FACE.angry }),
  (c: any) => ({ ...K.pose.armsOut(c), face2: K.FACE.terror }),
  (c: any) => ({ ...K.pose.pointUp(c), face2: K.FACE.wow }),
  (c: any) => ({ ...K.pose.point(c, "three"), face2: K.FACE.doubt }),
  (c: any) => ({ ...K.pose.armsUp(c), face2: K.FACE.grin }),
  (c: any) => ({ ...K.pose.sit(c, 0, "side"), face2: K.FACE.happy }),
  (c: any) => ({ ...K.pose.fidget(c, 0.4), face2: K.FACE.scared }),
  (c: any) => ({ ...K.pose.swing(c, 0.15, "side"), face2: K.FACE.shout }),
];
function draw(ctx: Ctx, frame: number, env: Env) {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = "#efe6d2"; ctx.fillRect(0, 0, 1920, 1080);
  POSE.forEach((p, i) => {
    const c = cast[i % 3], col = i % 8, row = Math.floor(i / 8), x = 130 + col * 236, y = 470 + row * 500, s = 0.62;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (i === 13) { K.crate(ctx, 30, 0, 200, 150); ctx.translate(0, -150); }
    K.drawPuppet(ctx, c, { face: 1, ...p(c) }, i === 15 ? { front: (g: Ctx, R: any) => K.tool(g, R, "pick") } : i === 7 ? { front: (g: Ctx, R: any) => K.pan(g, R, 1, 0.5) } : i === 5 ? { front: (g: Ctx, R: any) => K.pole(g, R, 0, 380) } : i === 6 ? { front: (g: Ctx, R: any) => K.wheelbarrow(g, R) } : {});
    ctx.restore();
  });
}
export const film: Film = { meta: { title: "poses", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };
`;

const dataUrl = (file) => `data:${file.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${readFileSync(file).toString("base64")}`;
const ASSETS = { "set-gorge": dataUrl(join(imgDir, "set-gorge.jpg")), "depth-gorge": dataUrl(join(imgDir, "depth-gorge.png")) };

/**
 * Bundle a scene the way author.ts does (the pack kit inlined after the imports, then wireSceneAssets), and inline its pictures the
 * way the render worker does (withAssetData: name -> data: URL in window.__ASSETS__; a missing depth map is simply left out).
 */
async function page(name, code, { aspect = "9:16", frames, images = {}, noGl = false }) {
  const names = Object.keys(images), allowed = names.length ? ["set-gorge", "depth-gorge"] : [];
  const wired = wireSceneAssets(withPackKit(code, pack), allowed, allowed);
  const refs = Object.fromEntries(allowed.map((n) => [n, `u:plates/00000000-0000-0000-0000-000000000000/assets/${n}.png`]));
  const bundle = await bundleScene({ look: "illus-flat-vector", code: wired, frames, aspect, ...(allowed.length ? { assets: refs } : {}) });
  let html = withAssetData(bundle.html, images);
  if (noGl) html = html.replace("window.__BAKE_SRC__={};", "window.__BAKE_SRC__={};globalThis.__HR_NO_GL__=1;");
  const file = join(OUT, `${name}.html`); writeFileSync(file, html); return file;
}

async function draw(file, frames, prefix) {
  const session = await openScene(file, { pages: 1 });
  try {
    const out = { ms: [] };
    for (const f of frames) { const t = Date.now(); const png = await session.frame(f, 0); out.ms.push(Date.now() - t); writeFileSync(join(OUT, `${prefix}-${String(f).padStart(3, "0")}.png`), png); out[f] = png; }
    return out;
  } finally { await session.close(); }
}

const FRAMES = [0, 30, 44, 48, 60, 89];
const glFile = await page("gl", SCENE, { frames: 90, images: ASSETS });
const noGlFile = await page("nogl", SCENE, { frames: 90, images: ASSETS, noGl: true });
const flatFile = await page("flat", SCENE, { frames: 90, images: { "set-gorge": ASSETS["set-gorge"] } });
const gl = await draw(glFile, FRAMES, "gl");
const steady = (r) => r.ms.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, r.ms.length - 1); // the first frame pays the start-up
const msPerFrame = steady(gl);
const nogl = await draw(noGlFile, FRAMES, "nogl");
const flat = await draw(flatFile, [0, 60], "flat");

const same = (a, b) => a.length === b.length && a.equals(b);
for (const f of FRAMES) assert.ok(gl[f].length > 200_000, `frame ${f} is a full picture (${gl[f].length} bytes)`);
assert.ok(!same(gl[0], gl[89]), "the camera moves: first and last frames differ");
assert.ok(!same(gl[0], gl[30]), "no dead frame: the creeping push and idle motion change frame 0 -> 30");
const glUsed = !same(gl[60], nogl[60]);
assert.ok(flat[0].length > 200_000, "a set without a depth map still draws (flat zoom)");
// software GL (the ECS worker has no GPU): the same page with Chromium's SwiftShader
let swift = "not run";
try {
  process.env.PLATE_CHROME_ARGS = "--use-angle=swiftshader --enable-unsafe-swiftshader";
  const sw = await draw(glFile, [0, 46, 48, 50, 51, 70], "swgl"); swift = `${steady(sw).toFixed(0)} ms/frame (frames 0/46/48/50/51/70: ${sw.ms.join("/")}), ${same(sw[48], nogl[48]) ? "fell back to 2D" : "WebGL"}`;
} catch (error) { swift = `failed: ${error.message.slice(0, 200)}`; } finally { delete process.env.PLATE_CHROME_ARGS; }

if (process.env.GEN_REFS) {
  const poseFile = await page("poses", POSES, { aspect: "16:9", frames: 2 });
  const poses = await draw(poseFile, [0], "poses");
  writeFileSync(join(packDir, "pose-sheet.png"), poses[0]);
  // the kit drawn on a set: four frames of the proof scene side by side, scaled to a third
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...[0, 44, 48, 89].flatMap((f) => ["-i", join(OUT, `gl-${String(f).padStart(3, "0")}.png`)]), "-filter_complex", "[0][1][2][3]hstack=inputs=4,scale=1440:-1", "-frames:v", "1", join(packDir, "kit-shot.png")]);
  console.log("reference pictures written to", packDir);
}
console.log(`history-reel render: ok. set renderer ${glUsed ? "WebGL" : "2D fallback (WebGL unavailable)"}, ${msPerFrame.toFixed(0)} ms/frame (2D fallback ${steady(nogl).toFixed(0)}); software GL: ${swift}. PNGs in ${OUT}`);
