// Freeze portable recipes and reference assets into the backend/frontend deployment trees.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { looks } from "../packages/contracts/src/looks.ts";
const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const references = {
  "paper-animation-styles.webp": "third_party/creative-packs/Creative_Formats_Claude/.claude/skills/paper-animation/reference/paper-animation-styles.webp",
  "claymation-styles.webp": "third_party/creative-packs/Creative_Formats_Claude/.claude/skills/claymation/reference/claymation-styles.webp",
  "paper-cut-style.jpg": "third_party/creative-packs/motion-design-prompts/style-reference/paper-cut-style.jpg"
};
// Reference frames for the illustration styles (third_party/anidoodle, Apache-2.0): one rendered frame per style.
for (const file of (await readdir(join(root, "third_party/anidoodle/references"))).sort()) references[file] = `third_party/anidoodle/references/${file}`;
async function emit(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (check) {
    const actual = await readFile(join(root, path)).catch(() => Buffer.alloc(0));
    if (!actual.equals(bytes)) throw new Error(`${path} is stale. Run npm run styles:build.`);
  } else {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
}
const assets = {};
for (const [name, source] of Object.entries(references)) {
  const bytes = await readFile(join(root, source));
  assets[name] = { source, sha256: sha(bytes), bytes: bytes.length };
  await emit(`backend/style-library/references/${name}`, bytes);
  await emit(`frontend/public/previews/looks/references/${name}`, bytes);
}
const manifest = [];
for (const look of looks) {
  const source = await readFile(join(root, look.source));
  const recipe = { ...look, sourceSha256: sha(source), referenceAssets: look.referenceAssets.map((name) => ({ path: `references/${name}`, ...assets[name] })) };
  await emit(`backend/style-library/${look.id}.json`, JSON.stringify(recipe, null, 2) + "\n");
  manifest.push({ id: look.id, version: look.version, recipe: `${look.id}.json`, sourceSha256: recipe.sourceSha256 });
}
await emit("backend/style-library/manifest.json", JSON.stringify({ schemaVersion: 1, styles: manifest, assets }, null, 2) + "\n");
console.log(`${check ? "Verified" : "Built"} ${looks.length} portable style recipes and ${Object.keys(assets).length} reference images.`);
