// Phase 0: one real parameter edit through both hosts. The scene reads globalThis.__PARAMS__ (a stand-in for the phase 4 params object).
// Usage: node build-params.mjs <plates-dir> <out-dir> <chrome>
import { readFileSync, writeFileSync } from "node:fs"; import { createHash } from "node:crypto"; import { join, resolve, dirname } from "node:path"; import { readdirSync } from "node:fs";
const [plates, out, chrome] = process.argv.slice(2); process.env.PLATE_BROWSER_PATH = chrome;
const root = resolve(import.meta.dirname, "../../packages/plate-engine");
const { bundleScene } = await import(join(root, "lib/engine.mjs")), { openScene } = await import(join(root, "lib/capture.mjs"));
const dir = join(plates, readdirSync(plates).find((d) => d.startsWith("397b0ec8")));
let code = readFileSync(join(dir, "scene-0.ts"), "utf8");
const lit = 'color: "#3b2c55", seed: 1, fibre: 0.5';
if (!code.includes(lit)) throw new Error("sky literal not found");
code = code.replace(lit, 'color: ((globalThis as unknown as { __PARAMS__?: { sky?: string } }).__PARAMS__?.sky ?? "#3b2c55"), seed: 1, fibre: 0.5');
const { html } = await bundleScene({ look: "illus-fox", code, frames: 90, aspect: "16:9" });
writeFileSync(join(out, "foxparams.html"), html);
const canonical = (v) => (v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k]))}}` : JSON.stringify(v));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sets = { A: { sky: "#3b2c55" }, B: { sky: "#2a6b3a" } }, idx = { htmlSha: sha(html), sets: {} };
for (const [k, params] of Object.entries(sets)) {
  const baked = html.replace("<script>", `<script>window.__PARAMS__=${canonical(params)};</script><script>`);
  writeFileSync(join(out, `foxparams${k}.html`), baked);
  const s = await openScene(join(out, `foxparams${k}.html`), { pages: 1 });
  for (const n of [0, 45]) writeFileSync(join(out, `foxparams${k}-ref-${n}.png`), await s.frame(n, 0));
  await s.close();
  idx.sets[k] = { params, canonical: canonical(params), paramsDigest: sha(canonical(params)), bakedHtmlSha: sha(baked) };
}
writeFileSync(join(out, "foxparams.json"), JSON.stringify(idx, null, 1)); console.log(JSON.stringify(idx));
