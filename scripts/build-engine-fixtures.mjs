// Builds the beat-plan engine fixtures that `npm run check:creative` renders: the real engine page
// (worker/templates/beat-plan/index.html) with a fixed synthetic plan and a placeholder screen, one folder
// per look. No customer data, no database. The brand theme is added by check-creative (theme.css), so the
// same fixture is rendered under two brands to prove the look follows the brand tokens.
//   node scripts/build-engine-fixtures.mjs          rebuild the fixtures
//   node scripts/build-engine-fixtures.mjs --check  exit 1 if a fixture is stale (engine or plan changed)
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { declareVariables } from "../backend/src/plan/composition.ts";
import { lookIds } from "../packages/contracts/src/looks.ts";

const root = resolve(import.meta.dirname, "..");
const template = await readFile(join(root, "worker/templates/beat-plan/index.html"), "utf8");

const v = (axis, dir) => ({ axis, dir });
const plan = {
  canvas: "16:9",
  motion_profile: "smooth",
  captions: "none",
  beats: [
    { id: "b1", role: "hook", kind: "kinetic", keyword: "Launches take weeks", on_screen: "Every release, a production", line: null, verb: null, success: false, energy: "high", ui: null, motion: { entry: v("x", -1), exit: v("y", -1) }, transition_out: { type: "j-cut" }, start: 0, end: 3 },
    { id: "b2", role: "reveal", kind: "ui", keyword: "One click to publish", on_screen: "Publish the video", line: null, verb: "publish", success: false, energy: "medium", ui: { screen: "s1", action: "click", target: "Publish button", aspect: 1.6 }, motion: { entry: v("y", -1), exit: v("x", -1) }, transition_out: { type: "j-cut" }, start: 3, end: 7, act_at: 4.2 },
    { id: "b3", role: "success", kind: "kinetic", keyword: "Shipped today", on_screen: null, line: null, verb: null, success: true, energy: "high", ui: null, motion: { entry: v("x", -1), exit: v("x", -1) }, transition_out: { type: "j-cut" }, start: 7, end: 10, success_at: 8 },
    { id: "b4", role: "cta", kind: "title", keyword: "Make it move", on_screen: "Get started", line: null, verb: null, success: false, energy: "medium", ui: null, motion: { entry: v("x", -1), exit: v("z", 1) }, transition_out: { type: "end" }, start: 10, end: 12.5 }
  ]
};

for (const look of lookIds) {
  const dir = join(root, "validation/creative-libraries", `engine-${look}`);
  await mkdir(join(dir, "shots"), { recursive: true });
  await cp(join(root, "worker/templates/product-launch/assets/screenshot.svg"), join(dir, "shots/s1.svg"));
  const values = { plan: JSON.stringify(plan), "shot.s1": "shots/s1.svg", brandName: "Fixture", logo: "", logoWordmark: false, look };
  let html = declareVariables(template, values, { asDefaults: true });
  html = html.replace("</head>", () => '  <link rel="stylesheet" href="theme.css" />\n</head>');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>Engine fixture: ${look} look</title>`);
  if (process.argv.includes("--check")) {
    const current = await readFile(join(dir, "index.html"), "utf8").catch(() => "");
    if (current !== html) { console.error(`engine-${look} is stale: run node scripts/build-engine-fixtures.mjs`); process.exitCode = 1; }
    continue;
  }
  await writeFile(join(dir, "index.html"), html);
  console.log(`wrote validation/creative-libraries/engine-${look}`);
}
