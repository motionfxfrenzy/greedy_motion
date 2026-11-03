// Regenerates test/golden.json from the LEGACY in-process pipeline (backend plates.ts withIsolatedScene + anidoodle
// tools/still.mjs), so the migrated renderer is compared against what shipped, not against itself.
//   LEGACY_ENGINE_DIR=experiments/anidoodle-try node packages/plate-engine/test/golden-from-legacy.mjs
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const legacy = resolve(process.env.LEGACY_ENGINE_DIR ?? join(here, "../../../experiments/anidoodle-try"));
const size = (a) => a === "9:16" ? { w: 1080, h: 1920 } : a === "1:1" ? { w: 1080, h: 1080 } : { w: 1920, h: 1080 };
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const golden = {};
for (const f of fixtures) {
  const key = `${f.name}@${f.aspect}`;
  const code = readFileSync(join(here, "fixtures", `${f.name}.ts`), "utf8");
  const sz = size(f.aspect), name = `parity_${f.name.replace(/\W/g, "")}_${f.aspect.replace(":", "x")}`;
  const m = /const\s+W\s*=\s*(\d+)\s*,\s*H\s*=\s*(\d+)/.exec(code) || /W:\s*(\d+)\s*,\s*H:\s*(\d+)/.exec(code);
  const w0 = Number(m[1]), h0 = Number(m[2]);
  let patched = code.replace(/export\s+const\s+film\s*:\s*Film/, `export const ${name}: Film`).replace(/durationFrames:\s*[A-Za-z0-9_]+/, `durationFrames: ${f.frames}`).replace(/W:\s*\d+\s*,\s*H:\s*\d+/, `W: ${sz.w}, H: ${sz.h}`);
  if (w0 !== sz.w || h0 !== sz.h) {
    const s = Math.min(sz.w / w0, sz.h / h0), tx = (sz.w - w0 * s) / 2, ty = (sz.h - h0 * s) / 2, padX = Math.ceil(tx / s) + 80, padY = Math.ceil(ty / s) + 80;
    patched = patched.replace(/(import[^\n]+\n)+/, (i) => i + `\n(globalThis as any).__ANIDOODLE_ADAPT__ = { w0: ${w0}, h0: ${h0}, wt: ${sz.w}, ht: ${sz.h}, s: ${s.toFixed(6)}, tx: ${tx.toFixed(2)}, ty: ${ty.toFixed(2)}, padX: ${padX}, padY: ${padY} };\n`)
      .replace(/ctx\.setTransform\(\s*env\.scale\s*,\s*0\s*,\s*0\s*,\s*env\.scale\s*,\s*0\s*,\s*0\s*\)/g, `ctx.setTransform(env.scale * ${s.toFixed(6)}, 0, 0, env.scale * ${s.toFixed(6)}, env.scale * ${tx.toFixed(2)}, env.scale * ${ty.toFixed(2)})`)
      .replace(/ctx\.fillRect\(\s*0\s*,\s*0\s*,\s*W\s*,\s*H\s*\)/g, `ctx.fillRect(-${padX}, -${padY}, W + ${padX * 2}, H + ${padY * 2})`);
  } else patched = patched.replace(/(import[^\n]+\n)+/, (i) => i + "\n(globalThis as any).__ANIDOODLE_ADAPT__ = undefined;\n");
  const mod = join(legacy, "src/canvas-core", `${name}.ts`), host = join(legacy, "src/hosts", `page-${name}.ts`);
  writeFileSync(mod, patched);
  writeFileSync(host, `import { ${name} } from "../canvas-core/${name}";\nimport { mountFilm } from "./page";\n\nmountFilm(${name});\n`);
  const frames = [0, Math.max(1, Math.floor(f.frames / 2)), f.frames - 1];
  try {
    const r = spawnSync("node", ["tools/still.mjs", name, "--frames", frames.join(","), "--out", `out/${name}/`], { cwd: legacy, encoding: "utf8", env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(legacy, "pw-cache"), ANIDOODLE_BAKE_CACHE: "0" } });
    if (r.status) throw new Error(r.stdout + r.stderr);
    const hashes = {};
    for (const line of r.stdout.split("\n")) { const x = /frame (\d+)\s+draw.*md5 ([0-9a-f]{32})\s+(reproducible|NOT)/.exec(line); if (x) hashes[x[1]] = x[2]; }
    golden[key] = hashes;
    console.log(key, hashes);
  } finally { rmSync(mod, { force: true }); rmSync(host, { force: true }); rmSync(join(legacy, "out", name), { recursive: true, force: true }); rmSync(join(legacy, "dist", `${name}.html`), { force: true }); }
}
writeFileSync(join(here, "golden.json"), `${JSON.stringify(golden, null, 1)}\n`);
