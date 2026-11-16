// Picture film pack, rendered: two beats' scene modules (written by sceneCode, no model) bundled by the plate engine, the test
// build's real stills injected as the page's assets, drawn in Chromium to MP4 through the engine's local capture path. Checks the
// hard cuts land on the word times (2 frames before each still's first word) and saves frames around each cut to look at.
// Needs: the stills from experiments/tarantula-reference/test/img (PICTURE_FILM_IMG to override), a Chromium for playwright-core
// (PLATE_BROWSER_PATH, else playwright's own), ffmpeg. Skips when the stills or the browser are missing. No network.
// Run: node backend/test/picture-film-render.mjs   (frames go to PICTURE_FILM_OUT, default <tmp>/picture-film-render)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const here = fileURLToPath(new URL(".", import.meta.url));
const IMG = process.env.PICTURE_FILM_IMG ?? resolve(here, "../../../VideoSaaS/experiments/tarantula-reference/test/img");
const OUT = process.env.PICTURE_FILM_OUT ?? join(tmpdir(), "picture-film-render");
if (!existsSync(join(IMG, "shot-01.jpg"))) { console.log(`picture-film render: skipped (no stills in ${IMG})`); process.exit(0); }
mkdirSync(OUT, { recursive: true });
// playwright's headless shell when PLATE_BROWSER_PATH is not set (macOS and Linux cache folders)
if (!process.env.PLATE_BROWSER_PATH) for (const cache of [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")]) {
  const dir = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort().pop() : null;
  const bin = dir && readdirSync(join(cache, dir)).map((sub) => join(cache, dir, sub, "chrome-headless-shell")).find((b) => existsSync(b));
  if (bin) { process.env.PLATE_BROWSER_PATH = bin; break; }
}

const { pictureFilm: pack, pictureSceneModule } = await import("../src/plan/packs/picture-film/index.ts");
const { bundleScene } = await import("@videosaas/plate-engine");
const { openScene, renderScene } = await import("@videosaas/plate-engine/capture");
const dataUrl = (file) => `data:image/jpeg;base64,${readFileSync(join(IMG, file)).toString("base64")}`;

// The test build's voice (whisper word starts, audio/words.json), each beat's words made relative to its scene start.
const beats = [
  { keyword: "Walking with gum", visual: "wide street: you walk / close street: you chew [MINT GUM]", onScreen: null, line: "You are walking down the street, chewing a fresh piece of mint gum." },
  { keyword: "The gulp", visual: null, onScreen: null, line: "You take a sudden breath and accidentally gulp the whole wad down." },
  { keyword: "Three outcomes", visual: null, onScreen: null, line: "Does it dissolve in stomach acid, stick for seven years, or block your gut?" }
];
const rel = (list, t0) => list.map(([text, start, end]) => ({ text, start: +(start - t0).toFixed(3), end: +(end - t0).toFixed(3) }));
const words0 = rel([["You", 0.21, 0.27], ["are", 0.27, 0.42], ["walking", 0.42, 0.97], ["down", 0.97, 1.2], ["the", 1.2, 1.41], ["street,", 1.41, 1.98], ["chewing", 1.98, 2.33], ["a", 2.33, 2.38], ["fresh", 2.38, 2.63], ["piece", 2.63, 2.88], ["of", 2.88, 2.98], ["mint", 2.98, 3.18], ["gum.", 3.18, 3.52]], 0);
const words2 = rel([["Does", 7.04, 7.31], ["it", 7.31, 7.41], ["dissolve", 7.41, 7.91], ["in", 7.91, 8.04], ["stomach", 8.04, 8.47], ["acid,", 8.47, 8.93], ["stick", 8.93, 9.2], ["for", 9.2, 9.39], ["seven", 9.39, 9.71], ["years,", 9.71, 10.15], ["or", 10.15, 10.29], ["block", 10.29, 10.74], ["your", 10.74, 10.93], ["gut?", 10.93, 11.36]], 6.94);

const scenes = [
  // beat 1 through the pack's own sceneCode (2 stills from sceneAssets); the test's shot-01/02 stand in for them
  { id: "beat1", frames: 109, code: pack.sceneCode({ beatIndex: 0, frames: 109, fps: 30, beatWords: words0, assetNames: pack.sceneAssets(0, beats), aspect: "9:16", beats }),
    files: { "shot-01-1": "shot-01.jpg", "shot-01-2": "shot-02.jpg" }, words: words0, firstWords: ["You", "chewing"] },
  // beat 3 with three stills (the test's shots 5, 6, 7 on the line's two commas)
  { id: "beat3", frames: 136, code: pictureSceneModule({ index: 2, frames: 136, words: words2, assets: ["shot-03-1", "shot-03-2", "shot-03-3"], aspect: "9:16", line: beats[2].line }),
    files: { "shot-03-1": "shot-05.jpg", "shot-03-2": "shot-06.jpg", "shot-03-3": "shot-07.jpg" }, words: words2, firstWords: ["Does", "stick", "or"] }
];

let browserMissing = false;
for (const scene of scenes) {
  const { html } = await bundleScene({ look: "illus-flat-vector", code: scene.code, frames: scene.frames, aspect: "9:16" });
  const assets = Object.fromEntries(Object.entries(scene.files).map(([name, file]) => [name, dataUrl(file)]));
  assert.ok(html.includes("window.__ASSETS__={}"), "the page has the asset slot the engine fills");
  const page = join(OUT, `${scene.id}.html`);
  writeFileSync(page, html.replace("window.__ASSETS__={}", `window.__ASSETS__=${JSON.stringify(assets)}`));

  const expected = scene.firstWords.map((w, k) => (k === 0 ? 0 : Math.round(scene.words.find((x) => x.text.startsWith(w)).start * 30) - 2));
  assert.deepEqual([...scene.code.matchAll(/\["shot-[^"]+", (\d+)\]/g)].map((m) => Number(m[1])), expected, `${scene.id}: the module's cuts are 2 frames before ${scene.firstWords.join(", ")}`);

  const mp4 = join(OUT, `${scene.id}.mp4`);
  try { await renderScene(page, mp4, { frames: scene.frames, workers: 1 }); }
  catch (error) { if (/Browser could not start|Executable doesn't exist/i.test(error.message)) { browserMissing = true; break; } throw error; }

  // where the picture changes: ffmpeg's scene score per frame; a cut scores ~1, the push-in ~0
  const { stderr, status } = spawnSync("ffmpeg", ["-hide_banner", "-i", mp4, "-vf", "select='gt(scene,0.2)',showinfo", "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(status, 0, "ffmpeg reads the clip");
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 30));
  assert.deepEqual([...new Set(cuts)], expected.slice(1), `${scene.id}: the rendered picture changes exactly on frames ${expected.slice(1).join(", ")}`);

  // frames to look at: before and on each cut, and the last frame (push-in)
  const session = await openScene(page, { pages: 1 });
  try {
    for (const f of [...expected.slice(1).flatMap((c) => [c - 1, c]), 0, scene.frames - 1]) writeFileSync(join(OUT, `${scene.id}-f${String(f).padStart(3, "0")}.png`), await session.frame(f, 0));
  } finally { await session.close(); }
  console.log(`${scene.id}: cuts at ${expected.slice(1).join(", ")} rendered as expected; frames in ${OUT}`);
}
if (browserMissing) console.log("picture-film render: skipped (no browser; set PLATE_BROWSER_PATH)");
else console.log("picture-film render: ok");
