// Writes worker/themes/<id>.css for every theme in packages/contracts/src/themes.ts.
// Run: npm run themes:build
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { themeToCss, themes } from "../packages/contracts/src/themes.ts";

const dir = join(import.meta.dirname, "..", "worker", "themes");
const wanted = new Set(themes.map((theme) => `${theme.id}.css`));

for (const file of await readdir(dir)) {
  if (file.endsWith(".css") && !wanted.has(file)) await rm(join(dir, file));
}
for (const theme of themes) {
  await writeFile(join(dir, `${theme.id}.css`), themeToCss(theme));
}
console.log(`Wrote ${themes.length} themes to ${dir}`);
