// Inlines engine.js (the readable source) into index.html as one minified <script id="bp-engine">.
// Why inline: the HyperFrames bundler drops local <script src>, so a render would never register the
// timeline; and `hyperframes check` caps a composition at 300 structural lines.
//   node worker/templates/beat-plan/build.mjs          rebuild index.html
//   node worker/templates/beat-plan/build.mjs --check  exit 1 if index.html is stale
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../package.json"));
const { transform } = require("esbuild");

const plates = JSON.parse(await readFile(join(here, "assets/hairline-plates.json"), "utf8"));
if (!Array.isArray(plates) || plates.length !== 4 || plates.some((p) => typeof p !== "string")) throw new Error("Invalid Hairline geometry.");
const styles = JSON.parse(await readFile(join(here, "../../../packages/contracts/src/style-library/catalog.json"), "utf8"));
const treatmentCss = await readFile(join(here, "style-treatments.css"), "utf8");
const canvasSource = await readFile(join(here, "canvas-layer.js"), "utf8");
const source = (await readFile(join(here, "engine.js"), "utf8")).replace("/* HAIRLINE_GEOMETRY */ []", () => JSON.stringify(plates))
  .replace("/* CANVAS_LAYER */", () => canvasSource)
  .replace("/* STYLE_CATALOG */ []", () => JSON.stringify(styles.map(({ id, version, renderer, renderMode, fillStyle }) => ({ id, version, renderer, renderMode, fillStyle }))));
const { code } = await transform(source, { minify: true, target: "es2018", legalComments: "none" });
const script = `<script id="bp-engine">/* built from engine.js by build.mjs — edit engine.js, then rebuild */\n${code.trim().replace(/<\/script/gi, "<\\/script")}\n</script>`;
// Rough.js (MIT, pinned in backend/package.json) for the Sketch look, inlined for the same reason as the engine.
const upstreamRough = await readFile(require.resolve("roughjs/bundled/rough.js"), "utf8");
// Fail closed on unseeded calls. Keep Rough's per-shape seeded PRNG unchanged; do not mask lint
// or replace global randomness. This adaptation is version/count guarded and covered by seek tests.
if (roughVersionForGuard() !== "4.6.6" || (upstreamRough.match(/Math\.random\(\)/g) || []).length !== 5) throw new Error("Review the Rough.js seed-only adapter for this upstream version.");
function roughVersionForGuard() { return require("roughjs/package.json").version; }
const roughSource = upstreamRough.replaceAll("Math.random()", '(()=>{throw new Error("Rough.js requires an explicit nonzero seed")})()');
const rough = (await transform(roughSource, { minify: true, target: "es2018", legalComments: "none" })).code.trim();
const roughVersion = require("roughjs/package.json").version;
const roughLicense = await readFile(join(dirname(require.resolve("roughjs/package.json")), "LICENSE"), "utf8");
const roughScript = `<script id="bp-rough">/* rough.js ${roughVersion} (MIT, Preet Shihn) — seed-only adapter; unseeded calls throw; inlined by build.mjs\n${roughLicense} */\n${rough.replace(/<\/script/gi, "<\\/script")}\n</script>`;
const hairlineLicense = await readFile(join(here, "assets/HAIRLINE-LICENSE"), "utf8");
const htmlPath = join(here, "index.html");
const html = await readFile(htmlPath, "utf8");
const block = /<script id="bp-engine">[\s\S]*?<\/script>/;
if (!block.test(html)) throw new Error('index.html has no <script id="bp-engine"> block.');
const roughBlock = /<script id="bp-rough">[\s\S]*?<\/script>\n?/;
const withRough = roughBlock.test(html) ? html.replace(roughBlock, () => roughScript + "\n") : html.replace(block, (m) => roughScript + "\n  " + m);
const licensed = withRough.replace(/<!-- Hairline license[\s\S]*?-->/g, "");
const styled = licensed.replace(/<style id="bp-styles">[\s\S]*?<\/style>/g, "").replace("</head>", () => `<style id="bp-styles">${treatmentCss.trim()}</style></head>`);
const next = styled.replace(block, () => script + "<!-- Hairline license\n" + hairlineLicense + "-->");
if (process.argv.includes("--check")) {
  if (next !== html) { console.error("index.html is stale: run node worker/templates/beat-plan/build.mjs"); process.exit(1); }
  console.log("index.html is in sync with engine.js");
} else {
  await writeFile(htmlPath, next);
  console.log(`index.html: engine inlined (${code.length} bytes minified from ${source.length})`);
}
