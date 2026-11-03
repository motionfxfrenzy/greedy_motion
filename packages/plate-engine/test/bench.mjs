// Throughput of the new capture path against the legacy renderer on the same fixture and the same Chromium (manual run).
//   LEGACY_ENGINE_DIR=experiments/anidoodle-try node packages/plate-engine/test/bench.mjs [fixture] [workers]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleScene } from "../lib/engine.mjs";
import { renderScene, probeVideo } from "../lib/capture.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const legacy = resolve(process.env.LEGACY_ENGINE_DIR ?? join(here, "../../../experiments/anidoodle-try"));
const name = process.argv[2] ?? "balloon-0", workers = Number(process.argv[3] ?? 2);
const fx = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8")).find((f) => f.name === name);
const code = readFileSync(join(here, "fixtures", `${name}.ts`), "utf8");
const dir = mkdtempSync(join(tmpdir(), "bench-"));
const cache = join(legacy, "pw-cache"); const shell = spawnSync("sh", ["-c", `ls -d ${cache}/chromium_headless_shell*/*/chrome-headless-shell`], { encoding: "utf8" }).stdout.trim();
process.env.PLATE_BROWSER_PATH = shell;
const { html } = await bundleScene({ look: fx.look, code, frames: fx.frames, aspect: fx.aspect });
const page = join(dir, "p.html"); writeFileSync(page, html);
let t = Date.now();
await renderScene(page, join(dir, "new.mp4"), { frames: fx.frames, workers });
const newMs = Date.now() - t; const facts = await probeVideo(join(dir, "new.mp4"));
// legacy: the same module through tools/render.mjs
const id = "bench_" + name.replace(/\W/g, ""); const mod = join(legacy, "src/canvas-core", `${id}.ts`), host = join(legacy, "src/hosts", `page-${id}.ts`);
writeFileSync(mod, code.replace(/export\s+const\s+film\s*:\s*Film/, `export const ${id}: Film`)); writeFileSync(host, `import { ${id} } from "../canvas-core/${id}";\nimport { mountFilm } from "./page";\nmountFilm(${id});\n`);
t = Date.now();
const r = spawnSync("node", ["tools/render.mjs", id, "--workers", String(workers), "--out", join(dir, "old.mp4")], { cwd: legacy, encoding: "utf8", env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache, ANIDOODLE_BAKE_CACHE: "0" } });
const oldMs = Date.now() - t; rmSync(mod, { force: true }); rmSync(host, { force: true }); rmSync(join(legacy, "dist", `${id}.html`), { force: true });
const oldFacts = await probeVideo(join(dir, "old.mp4"));
const md5 = (f) => spawnSync("ffmpeg", ["-v", "error", "-i", f, "-map", "0:v:0", "-f", "md5", "-"], { encoding: "utf8" }).stdout.trim();
const identical = md5(join(dir, "new.mp4")) === md5(join(dir, "old.mp4"));
console.log(JSON.stringify({ fixture: name, frames: fx.frames, workers, newMs, oldMs, newFps: +(fx.frames / (newMs / 1000)).toFixed(1), oldFps: +(fx.frames / (oldMs / 1000)).toFixed(1), newFacts: facts, oldFacts, legacyExit: r.status, decodedFramesIdentical: identical }));
rmSync(dir, { recursive: true, force: true });
