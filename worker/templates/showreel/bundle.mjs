// Joins the engine from its parts: core/runtime.js, the scene and transition modules a film actually uses, core/layers.js, core/build.js.
// A film only carries the modules it uses; the output is one plain script that runs inside the HyperFrames page.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(join(HERE, p), "utf8");
export async function bundleEngine({ scenes, transitions }) {
  const parts = [await read("core/runtime.js")];
  for (const s of [...new Set(scenes)]) parts.push(await read(`scenes/${s}.js`));
  for (const t of [...new Set(transitions)]) parts.push(await read(`transitions/${t}.js`));
  parts.push(await read("core/layers.js"), await read("core/build.js"));
  return parts.join("\n");
}
