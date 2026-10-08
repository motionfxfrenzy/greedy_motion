// Assembles a renderable folder for a gm-* format in fill mode: the skill's frozen template, the slot values, and
// the brand (a saved brand kit folder or a gallery theme). The same folder works for `hyperframes check`,
// `snapshot` and `render`; values are baked in as variable defaults (check and snapshot take no variables flag).
//
//   node scripts/build-format.mjs --skill gm-velocity-sting --values values.json --out dir
//        [--theme <gallery theme id>] [--brand <path to a brand kit folder, e.g. var/brands/<id>>]
//
// With --brand, the kit's theme.css, fonts and logo are used and the logo fills the `logo` slot.
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { declareVariables } from "../backend/src/plan/composition.ts";
import { VENDOR, vendorPath } from "./creative-vendor.mjs";

const root = resolve(import.meta.dirname, "..");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const skill = arg("skill"), valuesFile = arg("values"), out = arg("out"), theme = arg("theme"), brand = arg("brand");
if (!skill || !/^gm-[a-z0-9-]+$/.test(skill) || !out) throw new Error("usage: --skill gm-<name> --values file.json --out dir [--theme id | --brand dir]");
const exists = (p) => access(p).then(() => true, () => false);

const templateDir = join(root, ".claude/skills", skill, "template");
await rm(out, { recursive: true, force: true });
await cp(templateDir, out, { recursive: true });
let html = await readFile(join(out, "index.html"), "utf8");
// Inline the readable engine.js, minified, into its placeholder block.
if (await exists(join(out, "engine.js"))) {
  const { transform } = await import("esbuild");
  const { code } = await transform(await readFile(join(out, "engine.js"), "utf8"), { minify: true, target: "es2018", legalComments: "none" });
  html = html.replace(/<script id="format-engine">[\s\S]*?<\/script>/, () => `<script id="format-engine">\n${code.trim().replace(/<\/script/gi, "<\\/script")}\n</script>`);
  await rm(join(out, "engine.js"));
}
await mkdir(join(out, "vendor"), { recursive: true });
for (const file of Object.keys(VENDOR)) if (html.includes(`vendor/${file}`)) await cp(vendorPath(root, file), join(out, "vendor", file));

// Fonts: the bundled OFL set, plus the brand kit's own faces (brand-fonts/).
await cp(join(root, "worker/fonts"), join(out, "fonts"), { recursive: true });
let fontsCss = await readFile(join(root, "worker/fonts/fonts.css"), "utf8");
const values = valuesFile ? JSON.parse(await readFile(valuesFile, "utf8")) : {};
if (brand) {
  const dir = resolve(brand);
  await cp(join(dir, "theme.css"), join(out, "theme.css"));
  if (await exists(join(dir, "fonts"))) await cp(join(dir, "fonts"), join(out, "brand-fonts"), { recursive: true });
  if (await exists(join(dir, "fonts.css"))) fontsCss += "\n" + (await readFile(join(dir, "fonts.css"), "utf8"));
  if (await exists(join(dir, "logo.png"))) { await mkdir(join(out, "brand"), { recursive: true }); await cp(join(dir, "logo.png"), join(out, "brand/logo.png")); values.logo ??= "brand/logo.png"; }
} else {
  await cp(join(root, "worker/themes", `${theme ?? "neutral"}.css`), join(out, "theme.css"));
}
await writeFile(join(out, "fonts.css"), fontsCss);

const stringified = Object.fromEntries(Object.entries(values).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v)]));
await writeFile(join(out, "index.html"), declareVariables(html, stringified, { asDefaults: true }));
await writeFile(join(out, "variables.json"), JSON.stringify(stringified, null, 2) + "\n");
console.log(`built ${skill} → ${out} (${brand ? `brand ${brand}` : `theme ${theme ?? "neutral"}`}, ${Object.keys(values).length} values)`);
