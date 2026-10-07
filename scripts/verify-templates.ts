// Fails when packages/contracts/src/templates.ts and the HyperFrames variable declarations in
// worker/templates/<id>/index.html disagree (ids, types, defaults, maxLength, min/max).
// Run: npm run templates:verify
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { templates } from "../packages/contracts/src/templates.ts";

const root = join(import.meta.dirname, "..", "worker", "templates");
type Declared = { id: string; type: string; default: unknown; maxLength?: number; min?: number; max?: number };
const problems: string[] = [];

// `beat-plan` is the storyboard engine (one composition driven by the beat plan), not a gallery template.
const ENGINES = new Set(["beat-plan"]);
const folders = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !ENGINES.has(entry.name)).map((entry) => entry.name);
for (const folder of folders) if (!templates.some((template) => template.id === folder)) problems.push(`${folder}: folder has no catalog entry`);

for (const template of templates) {
  const html = await readFile(join(root, template.id, "index.html"), "utf8").catch(() => null);
  if (!html) { problems.push(`${template.id}: missing index.html`); continue; }
  const match = /data-composition-variables='([^']*)'/.exec(html);
  if (!match) { problems.push(`${template.id}: no data-composition-variables`); continue; }
  const declared = JSON.parse(match[1]) as Declared[];
  const byId = new Map(declared.map((variable) => [variable.id, variable]));
  for (const variable of template.variables) {
    const html = byId.get(variable.id);
    if (!html) { problems.push(`${template.id}.${variable.id}: in catalog, not declared in HTML`); continue; }
    for (const key of ["type", "default", "maxLength", "min", "max"] as const) {
      if (html[key] !== variable[key]) problems.push(`${template.id}.${variable.id}: ${key} catalog=${JSON.stringify(variable[key])} html=${JSON.stringify(html[key])}`);
    }
    byId.delete(variable.id);
  }
  for (const id of byId.keys()) problems.push(`${template.id}.${id}: declared in HTML, missing from catalog`);
  for (const scene of template.scenes) for (const id of scene.variables) {
    if (!template.variables.some((variable) => variable.id === id)) problems.push(`${template.id}/${scene.id}: unknown variable ${id}`);
  }
  for (const variable of template.variables) if (!html.includes(`"${variable.id}"`)) problems.push(`${template.id}.${variable.id}: never referenced`);
}

if (problems.length) {
  console.error(`Template catalog and HTML disagree:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`${templates.length} templates match their HyperFrames variable declarations.`);
