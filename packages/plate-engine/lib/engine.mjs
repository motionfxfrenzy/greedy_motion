// Plate engine: style manifest, scene source validation, and the bundler that turns one authored scene module into a
// self-contained HTML page. Pure build-time code: generated source is NEVER executed here, only parsed and bundled by
// esbuild. It runs later, inside the worker's network-blocked Chromium (capture.mjs).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC_DIR = join(ENGINE_DIR, "src");
export const CORE_DIR = join(SRC_DIR, "canvas-core");
export const FPS = 30;
export const ASPECTS = {
  "16:9": { w: 1920, h: 1080, label: "1920x1080 (16:9)" },
  "9:16": { w: 1080, h: 1920, label: "1080x1920 (9:16 portrait)" },
  "1:1": { w: 1080, h: 1080, label: "1080x1080 (1:1 square)" }
};
export const sizeForAspect = (aspect) => ASPECTS[aspect] ?? ASPECTS["16:9"];

const sha = (...parts) => { const h = createHash("sha256"); for (const p of parts) h.update(p).update("\0"); return h.digest("hex"); };

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

let engineDigestMemo;
/** Content digest of every vendored engine source file (names and bytes) plus the package version. */
export function engineDigest() {
  if (engineDigestMemo) return engineDigestMemo;
  const parts = [JSON.parse(readFileSync(join(ENGINE_DIR, "package.json"), "utf8")).version];
  for (const file of walk(SRC_DIR)) parts.push(relative(SRC_DIR, file).split(sep).join("/"), readFileSync(file));
  return (engineDigestMemo = sha(...parts).slice(0, 24));
}

export const engineVersion = () => JSON.parse(readFileSync(join(ENGINE_DIR, "package.json"), "utf8")).version;

/** illus-broken-colour -> brokenColour (the plate's module name). */
export const plateNameOf = (look) => (typeof look === "string" && look.startsWith("illus-") ? look.slice(6).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()) : null);

export const plateFile = (name) => join(CORE_DIR, `${name}.ts`);
export const coreFile = (name) => join(CORE_DIR, `${name}.ts`);
export const kitFile = (name) => join(CORE_DIR, `${name}Kit.ts`);
export const guideFile = (name) => join(ENGINE_DIR, "guides", `${name}.md`);

/** Style names that ship in this package (derived from the generated manifest, never from a developer path). */
export function loadManifest() {
  return JSON.parse(readFileSync(join(ENGINE_DIR, "manifest.json"), "utf8"));
}
export const isSupportedStyle = (look) => { const name = plateNameOf(look); return Boolean(name && loadManifest().styles[name]); };

/** Digest of the plate, its kit and everything they import: what a scene in this style can depend on. */
export function styleDigest(look) {
  const name = plateNameOf(look);
  const entry = name ? loadManifest().styles[name] : null;
  if (!entry) return "none";
  const h = createHash("sha256");
  for (const file of entry.files) h.update(file).update("\0").update(readFileSync(join(SRC_DIR, file))).update("\0");
  return h.digest("hex").slice(0, 16);
}

/** Relative specifiers a scene may import for a style: the core modules and whatever the plate itself imports. */
export function allowedImports(name) {
  const allowed = new Set(["./core", "./film", "./gallery"]);
  const src = readFileSync(plateFile(name), "utf8");
  for (const m of src.matchAll(/from\s+["'](\.\/[A-Za-z0-9_]+)["']/g)) allowed.add(m[1]);
  return allowed;
}

// Defence in depth only: the real boundary is the network-blocked browser and the bundler's resolver.
const FORBIDDEN = [
  [/\bimport\s*\(/, "dynamic import()"], [/\brequire\s*\(/, "require"], [/\bfetch\s*\(/, "fetch"], [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"], [/\bimportScripts\b/, "importScripts"], [/\beval\s*\(/, "eval"], [/\bnew\s+Function\b/, "Function constructor"],
  [/\bMath\.random\b/, "Math.random"], [/\bDate\.now\b|\bnew\s+Date\b|\bperformance\.now\b/, "clock"], [/\bctx\.filter\b/, "ctx.filter"],
  [/\bnavigator\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\b|\bwindow\b|\blocation\b/, "browser global"]
];

/** Any static import statement: single or multi-line, inline `type` names, trailing commas, side-effect form. Group 1/2 = specifier. */
const STATIC_IMPORT = /(?:^|\n)[ \t]*import\s*(?:type\s+)?(?:[^;"'()]*?\bfrom\s*)?["']([^"']+)["'][ \t]*;?/g;

/** A deterministic, human-readable failure for code the model can repair. Returns null when the source is acceptable. */
export function validateSceneSource(code, look) {
  const name = plateNameOf(look);
  if (!name || !loadManifest().styles[name]) return { code: "unsupported_style", message: `Style ${look} is not supported.` };
  if (typeof code !== "string" || !code.trim()) return { code: "invalid_source", message: "The scene module is empty." };
  if (code.length > 120_000) return { code: "invalid_source", message: "The scene module is longer than 120000 characters." };
  if (!/export\s+const\s+film\b/.test(code)) return { code: "invalid_source", message: "The module has no `film` export." };
  const allowed = allowedImports(name);
  for (const m of code.matchAll(STATIC_IMPORT)) {
    const spec = m[1];
    if (!allowed.has(spec)) return { code: "invalid_source", message: `Import "${spec}" is not allowed. Allowed: ${[...allowed].join(", ")}.` };
  }
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const [re, what] of FORBIDDEN) if (re.test(stripped)) return { code: "invalid_source", message: `The module uses ${what}, which scenes may not use.${what === "dynamic import()" ? ' Replace it with a static import at the top of the file, e.g. `import { name } from "./core";`; scenes cannot load modules at run time.' : ""}` };
  return null;
}

/** Retargets a module that was authored for another frame size and pins its duration (the previous withIsolatedScene step). */
export function prepareSceneSource(code, { frames, aspect }) {
  const size = sizeForAspect(aspect);
  const m = /const\s+W\s*=\s*(\d+)\s*,\s*H\s*=\s*(\d+)/.exec(code) || /W:\s*(\d+)\s*,\s*H:\s*(\d+)/.exec(code);
  const w0 = m ? Number(m[1]) : size.w, h0 = m ? Number(m[2]) : size.h;
  let patched = code
    .replace(/export\s+const\s+film\s*:\s*Film/, "export const sceneFilm: Film")
    .replace(/durationFrames:\s*[A-Za-z0-9_]+/, `durationFrames: ${frames}`)
    .replace(/W:\s*\d+\s*,\s*H:\s*\d+/, `W: ${size.w}, H: ${size.h}`);
  const lastImport = (src) => { let end = 0; for (const x of src.matchAll(STATIC_IMPORT)) end = x.index + x[0].length; const nl = src.indexOf("\n", end); return end && nl >= 0 ? nl + 1 : end; };
  const insertAfterImports = (src, text) => { const at = lastImport(src); return src.slice(0, at) + text + src.slice(at); };
  if (w0 !== size.w || h0 !== size.h) {
    const s = Math.min(size.w / w0, size.h / h0), tx = (size.w - w0 * s) / 2, ty = (size.h - h0 * s) / 2;
    const padX = Math.ceil(tx / s) + 80, padY = Math.ceil(ty / s) + 80;
    patched = insertAfterImports(patched, `\n(globalThis as any).__ANIDOODLE_ADAPT__ = { w0: ${w0}, h0: ${h0}, wt: ${size.w}, ht: ${size.h}, s: ${s.toFixed(6)}, tx: ${tx.toFixed(2)}, ty: ${ty.toFixed(2)}, padX: ${padX}, padY: ${padY} };\n`)
      .replace(/(\bmeta\s*:\s*\{[^}]*?)\bW\s*,\s*H\b/, `$1W: ${size.w}, H: ${size.h}`)
      .replace(/ctx\.setTransform\(\s*env\.scale\s*,\s*0\s*,\s*0\s*,\s*env\.scale\s*,\s*0\s*,\s*0\s*\)/g, `ctx.setTransform(env.scale * ${s.toFixed(6)}, 0, 0, env.scale * ${s.toFixed(6)}, env.scale * ${tx.toFixed(2)}, env.scale * ${ty.toFixed(2)})`)
      .replace(/ctx\.fillRect\(\s*0\s*,\s*0\s*,\s*W\s*,\s*H\s*\)/g, `ctx.fillRect(-${padX}, -${padY}, W + ${padX * 2}, H + ${padY * 2})`);
  } else {
    patched = insertAfterImports(patched, "\n(globalThis as any).__ANIDOODLE_ADAPT__ = undefined;\n");
  }
  return patched;
}

/**
 * Bundles one scene module into one self-contained HTML page. Resolution is closed: relative imports inside the engine's
 * src tree only; bare packages, absolute paths and anything outside src fail the build.
 * Returns the page plus the manifest fields a render job pins (digests, size, frames).
 */
export async function bundleScene({ look, code, frames, aspect }) {
  const invalid = validateSceneSource(code, look);
  if (invalid) throw Object.assign(new Error(invalid.message), { code: invalid.code, repairable: true });
  const size = sizeForAspect(aspect);
  const source = prepareSceneSource(code, { frames, aspect });
  const inside = (p) => p === SRC_DIR || p.startsWith(SRC_DIR + sep);
  const guard = {
    name: "plate-closed-resolver",
    setup(b) {
      b.onResolve({ filter: /^scene:film$/ }, () => ({ path: "scene:film", namespace: "scene" }));
      b.onLoad({ filter: /.*/, namespace: "scene" }, () => ({ contents: source, loader: "ts", resolveDir: CORE_DIR }));
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === "entry-point") return null;
        if (!a.path.startsWith(".")) return { errors: [{ text: `Import "${a.path}" is not allowed.` }] };
        const base = a.namespace === "scene" ? CORE_DIR : a.resolveDir;
        const want = resolve(base, a.path);
        if (!inside(want)) return { errors: [{ text: `Import "${a.path}" leaves the engine.` }] };
        return null;
      });
    }
  };
  let result;
  try {
    result = await build({
      stdin: { contents: `import { sceneFilm } from "scene:film";\nimport { mountFilm } from "./hosts/page";\nmountFilm(sceneFilm);\n`, resolveDir: SRC_DIR, loader: "ts", sourcefile: "entry.ts" },
      bundle: true, format: "iife", target: "es2020", minify: true, write: false, legalComments: "none", metafile: true, logLevel: "silent",
      absWorkingDir: ENGINE_DIR, plugins: [guard]
    });
  } catch (error) {
    const text = (error.errors ?? []).map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`).join("\n") || String(error.message);
    throw Object.assign(new Error(`Bundling failed:\n${text}`.slice(0, 2500)), { code: "bundle_failed", repairable: true });
  }
  const js = result.outputFiles[0].text.replace(
    /\.clearRect\(([A-Za-z0-9_$]+)\[0\],\1\[1\],\1\[2\]-\1\[0\],\1\[3\]-\1\[1\]\)/g,
    ".clearRect(0,0,this.DW,this.DH)"
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>scene</title><style>html,body{margin:0;background:#fff}canvas{display:block}</style></head><body><canvas id="film"></canvas><script>window.__ASSETS__={};window.__BAKE_SRC__={};</script><script>${js.replace(/<\/script/g, "<\\/script")}</script></body></html>`;
  const imports = Object.keys(result.metafile.inputs).filter((i) => !i.startsWith("scene:")).sort();
  return {
    html,
    manifest: {
      schema: 1, kind: "anidoodle", engineVersion: engineVersion(), engineDigest: engineDigest(), styleDigest: styleDigest(look),
      width: size.w, height: size.h, fps: FPS, frames, aspect, sourceSha: sha(code).slice(0, 24), bundleSha: sha(html).slice(0, 24), imports
    }
  };
}

export { existsSync, statSync };
