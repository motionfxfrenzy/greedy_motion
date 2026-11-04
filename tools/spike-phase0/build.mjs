// Phase 0 spike: bundle real model-authored scenes and render CPU-export reference frames with the SAME code the worker uses
// (packages/plate-engine/lib/capture.mjs openScene). Usage: node build.mjs <plates-dir> <out-dir> <chrome-path>
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const [plates, out, chrome] = process.argv.slice(2);
const root = resolve(import.meta.dirname, "../../packages/plate-engine");
process.env.PLATE_BROWSER_PATH = chrome;
const { bundleScene } = await import(join(root, "lib/engine.mjs"));
const { openScene } = await import(join(root, "lib/capture.mjs"));
mkdirSync(out, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const projectDir = (prefix) => join(plates, readdirSync(plates).find((d) => d.startsWith(prefix)));
// [project prefix, scene index, look, seconds (from the project's state.json)]
const scenes = [
  ["2ee0ac2f", 0, "illus-balloon", 3.5], ["2ee0ac2f", 3, "illus-balloon", 6.5], ["a55da10d", 2, "illus-balloon", 7.5],
  ["397b0ec8", 0, "illus-fox", 3], ["397b0ec8", 2, "illus-fox", 7], ["397b0ec8", 5, "illus-fox", 4.5],
  ["dcd88501", 0, "illus-blueprint", 3], ["dcd88501", 2, "illus-blueprint", 7.5], ["dcd88501", 4, "illus-blueprint", 4]
];
const index = [];
for (const [prefix, i, look, seconds] of scenes) {
  const name = `${look.slice(6)}-${prefix}-${i}`, frames = Math.round(seconds * 30);
  const code = readFileSync(join(projectDir(prefix), `scene-${i}.ts`), "utf8");
  try {
    const { html } = await bundleScene({ look, code, frames, aspect: "16:9" });
    writeFileSync(join(out, `${name}.html`), html);
    const session = await openScene(join(out, `${name}.html`), { pages: 1 });
    const meta = await session.meta(), refs = {};
    for (const n of [0, Math.floor(frames / 2), frames - 1]) { const png = await session.frame(n, 0); writeFileSync(join(out, `${name}-ref-${n}.png`), png); refs[n] = sha(png); }
    await session.close();
    index.push({ name, look, frames, seconds, bytes: html.length, htmlSha: sha(html), meta, refs });
    console.log("ok  ", name, frames, "frames", Math.round(html.length / 1024), "KB");
  } catch (e) { console.log("FAIL", name, String(e.message ?? e).slice(0, 200)); index.push({ name, look, error: String(e.message ?? e).slice(0, 300) }); }
}
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 1));
