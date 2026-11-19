// Inlines kit.js + engine.js into index.html as one minified <script id="ct-engine">.
// Why inline: the HyperFrames bundler drops local <script src>, and `hyperframes check` caps structural lines.
//   node worker/templates/cutout-tales/build.mjs          rebuild index.html
//   node worker/templates/cutout-tales/build.mjs --check  exit 1 if index.html is stale
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../package.json"));
const { transform } = require("esbuild");
const source = (await readFile(join(here, "kit.js"), "utf8")) + "\n" + (await readFile(join(here, "engine.js"), "utf8"));
const { code } = await transform(source, { minify: true, target: "es2018", legalComments: "none" });
const license = await readFile(join(here, "../../../third_party/cutout-tales/LICENSE.txt"), "utf8");
const script = `<script id="ct-engine">/* built from kit.js + engine.js by build.mjs — edit those, then rebuild */\n${code.trim().replace(/<\/script/gi, "<\\/script")}\n</script><!-- Cutout Tales drawing kit: derived from growkaz-cutout-tales (MIT)\n${license.replace(/--+>/g, "-- >")}\n-->`;
const htmlPath = join(here, "index.html");
const html = await readFile(htmlPath, "utf8");
const re = /<script id="ct-engine">[\s\S]*?<\/script>(<!-- Cutout Tales drawing kit[\s\S]*?-->)?/;
if (!re.test(html)) throw new Error('index.html has no <script id="ct-engine"> block.');
const next = html.replace(re, () => script);
if (process.argv.includes("--check")) {
  if (next !== html) { console.error("cutout-tales/index.html is stale: run node worker/templates/cutout-tales/build.mjs"); process.exit(1); }
  console.log("cutout-tales/index.html is in sync");
} else { await writeFile(htmlPath, next); console.log(`index.html: engine inlined (${code.length} bytes minified from ${source.length})`); }
