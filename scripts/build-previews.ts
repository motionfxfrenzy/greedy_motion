// Renders theme and template gallery previews with the worker image into frontend/public/, and fails if any
// template × theme combination fails `hyperframes check`.
// Run after `npm run themes:build` and `docker compose build worker`: npm run previews [template-id ...]
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { templates } from "../packages/contracts/src/templates.ts";

const out = join(import.meta.dirname, "..", "frontend", "public");
mkdirSync(out, { recursive: true });
const config = {
  templates: templates.map((template) => ({
    id: template.id,
    defaultTheme: template.defaultTheme,
    previewAt: template.previewAt,
    // One frame near the end of each scene, when its entrance animation has settled.
    sceneTimes: template.scenes.map((scene) => Math.round((scene.start + scene.duration * 0.75) * 100) / 100)
  }))
};
const result = spawnSync("docker", [
  "run", "--rm", "--network", "none",
  "-e", `PREVIEW_CONFIG=${JSON.stringify(config)}`,
  "-v", `${out}:/out`,
  "videosaas-worker:local",
  "node", "src/previews.mjs", ...process.argv.slice(2)
], { stdio: "inherit" });
process.exit(result.status ?? 1);
