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

const source = await readFile(join(here, "engine.js"), "utf8");
const { code } = await transform(source, { minify: true, target: "es2018", legalComments: "none" });
const script = `<script id="bp-engine">/* built from engine.js by build.mjs — edit engine.js, then rebuild */\n${code.trim().replace(/<\/script/gi, "<\\/script")}\n</script>`;
// Rough.js (MIT, pinned in backend/package.json) for the Sketch look, inlined for the same reason as the engine.
const roughSource = await readFile(require.resolve("roughjs/bundled/rough.js"), "utf8");
const rough = (await transform(roughSource, { minify: true, target: "es2018", legalComments: "none" })).code.trim();
const roughVersion = require("roughjs/package.json").version;
const roughScript = `<script id="bp-rough">/* rough.js ${roughVersion} (MIT, Preet Shihn) — inlined by build.mjs */\n${rough.replace(/<\/script/gi, "<\\/script")}\n</script>`;
const htmlPath = join(here, "index.html");
const html = await readFile(htmlPath, "utf8");
const block = /<script id="bp-engine">[\s\S]*?<\/script>/;
if (!block.test(html)) throw new Error('index.html has no <script id="bp-engine"> block.');
const roughBlock = /<script id="bp-rough">[\s\S]*?<\/script>\n?/;
const withRough = roughBlock.test(html) ? html.replace(roughBlock, () => roughScript + "\n") : html.replace(block, (m) => roughScript + "\n  " + m);
const next = withRough.replace(block, () => script);
if (process.argv.includes("--check")) {
  if (next !== html) { console.error("index.html is stale: run node worker/templates/beat-plan/build.mjs"); process.exit(1); }
  console.log("index.html is in sync with engine.js");
} else {
  await writeFile(htmlPath, next);
  console.log(`index.html: engine inlined (${code.length} bytes minified from ${source.length})`);
}
