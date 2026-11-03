// Generates manifest.json: the styles this package can draw and the files each depends on.
// `--check` fails when the committed manifest is stale (a source changed without regenerating it).
import { build } from "esbuild";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const core = join(src, "canvas-core");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const skip = new Set(["core", "film", "gallery", "camera", "continuity", "director", "input"]);
// A "style" is a plate module that has a matching gallery entry in the shared style list.
const styleNames = JSON.parse(readFileSync(join(root, "styles.json"), "utf8"));

const styles = {};
for (const name of styleNames) {
  if (!existsSync(join(core, `${name}.ts`))) throw new Error(`styles.json lists ${name} but src/canvas-core/${name}.ts is missing.`);
  const r = await build({ entryPoints: [join(core, `${name}.ts`)], bundle: true, write: false, metafile: true, format: "esm", platform: "neutral", logLevel: "silent", absWorkingDir: root });
  const files = Object.keys(r.metafile.inputs).map((f) => relative(src, resolve(root, f)).split(sep).join("/")).filter((f) => !f.startsWith("..")).sort();
  styles[name] = { file: `canvas-core/${name}.ts`, kit: existsSync(join(core, `${name}Kit.ts`)) ? `canvas-core/${name}Kit.ts` : null, files };
}
void skip;
const manifest = { schema: 1, engine: "anidoodle", engineVersion: pkg.version, license: "Apache-2.0", styles };
const text = `${JSON.stringify(manifest, null, 1)}\n`;
const target = join(root, "manifest.json");
if (process.argv.includes("--check")) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== text) { console.error("manifest.json is stale: run npm run manifest -w @videosaas/plate-engine"); process.exit(1); }
  console.log(`manifest ok: ${Object.keys(styles).length} styles`);
} else {
  writeFileSync(target, text);
  console.log(`manifest written: ${Object.keys(styles).length} styles`);
}
void readdirSync;
