// No-words-in-the-picture check: LETTER_HELPERS coverage across all canvas-core modules,
// checkNoText & checkScene on scrapbook A/B scenes and synthetic fixtures, comment/string immunity,
// per-style contract line, and v5 digests.
// DB-free, network-free.
// Run: node test/no-text.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, SRC_DIR } from "@videosaas/plate-engine";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");

const {
  buildAuthorMessages,
  checkKitUse,
  checkNoText,
  checkScene,
  contractFor,
  KIT_REPAIR_MAX,
  LEGACY_PROMPT_VERSION,
  LETTER_HELPERS,
  letterHelpersFor,
  lookForPlateName,
  POLICY_REPAIR_MAX,
  PROMPT_VERSION,
  promptDigest
} = await import("../src/plates/prompt.ts");

const manifest = loadManifest();
const styleNames = Object.keys(manifest.styles).sort();
assert.equal(styleNames.length, 31);

// 1. Every top-level .ts module under packages/plate-engine/src/canvas-core/*.ts has a reviewed entry in LETTER_HELPERS
const canvasCoreDir = join(SRC_DIR, "canvas-core");
const canvasCoreModules = readdirSync(canvasCoreDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".ts"))
  .map((e) => e.name.replace(/\.ts$/, ""))
  .sort();

assert.ok(canvasCoreModules.length >= 56, `expected at least 56 canvas-core/*.ts modules, found ${canvasCoreModules.length}`);
assert.deepEqual(
  Object.keys(LETTER_HELPERS).sort(),
  canvasCoreModules,
  "LETTER_HELPERS has an explicit entry for every top-level module in packages/plate-engine/src/canvas-core/*.ts"
);

// Verify every helper name listed in LETTER_HELPERS[mod] is defined in that module's source
for (const [mod, helpers] of Object.entries(LETTER_HELPERS)) {
  assert.ok(Array.isArray(helpers), `LETTER_HELPERS.${mod} is an array`);
  const src = readFileSync(join(canvasCoreDir, `${mod}.ts`), "utf8");
  for (const h of helpers) {
    assert.match(
      src,
      new RegExp(`\\b(?:const|let|function)\\s+${h}\\b`),
      `${mod}.ts defines letter helper "${h}"`
    );
  }
}

// Expected non-empty modules in LETTER_HELPERS:
const nonEmptyModules = Object.entries(LETTER_HELPERS)
  .filter(([, list]) => list.length > 0)
  .map(([mod]) => mod)
  .sort();
assert.deepEqual(
  nonEmptyModules,
  ["blueprint", "blueprintKit", "drafting", "pocketWatch", "scrapbook", "scrapbookKit"],
  "expected modules with letter helpers"
);

// 2. Both scrapbook scenes from experiments/style-ab copied into backend/test/fixtures/ fail with the right helper names
const oldSceneFixturePath = join(testDir, "fixtures", "scrapbook-old-scene.ts");
const newSceneFixturePath = join(testDir, "fixtures", "scrapbook-new-scene.ts");
const cleanSceneFixturePath = join(testDir, "fixtures", "scrapbook-clean-scene.ts");

const oldSceneCode = readFileSync(oldSceneFixturePath, "utf8");
const newSceneCode = readFileSync(newSceneFixturePath, "utf8");
const cleanSceneCode = readFileSync(cleanSceneFixturePath, "utf8");

const expOldPath = join(repoRoot, "experiments", "style-ab", "scrapbook-old-scene.ts");
const expNewPath = join(repoRoot, "experiments", "style-ab", "scrapbook-new-scene.ts");
if (existsSync(expOldPath)) {
  assert.equal(oldSceneCode.trim(), readFileSync(expOldPath, "utf8").trim(), "scrapbook-old-scene.ts fixture matches experiments/style-ab");
}
if (existsSync(expNewPath)) {
  assert.equal(newSceneCode.trim(), readFileSync(expNewPath, "utf8").trim(), "scrapbook-new-scene.ts fixture matches experiments/style-ab");
}

const oldNoText = checkNoText("scrapbook", oldSceneCode);
assert.equal(oldNoText.ok, false, "scrapbook-old-scene.ts fails checkNoText");
assert.deepEqual(
  oldNoText.issues,
  [{ kind: "letter-helper", name: "typed", line: 85 }],
  "scrapbook-old-scene.ts fails on typed at line 85"
);
assert.equal(
  oldNoText.message,
  "No words in the picture: remove the calls to typed; the editor lays on all text. Draw shapes and marks instead."
);

const newNoText = checkNoText("scrapbook", newSceneCode);
assert.equal(newNoText.ok, false, "scrapbook-new-scene.ts fails checkNoText");
assert.deepEqual(
  newNoText.issues,
  [
    { kind: "letter-helper", name: "handWrite", line: 77 },
    { kind: "letter-helper", name: "typed", line: 90 }
  ],
  "scrapbook-new-scene.ts fails on handWrite (line 77) and typed (line 90)"
);
assert.equal(
  newNoText.message,
  "No words in the picture: remove the calls to handWrite/typed; the editor lays on all text. Draw shapes and marks instead."
);

// Combined checkScene on both scrapbook A/B scenes:
const oldPolicy = checkScene("scrapbook", oldSceneCode);
assert.equal(oldPolicy.ok, false, "scrapbook-old-scene.ts fails checkScene");
assert.equal(oldPolicy.kitUse.ok, true, "scrapbook-old-scene.ts passes checkKitUse");
assert.equal(oldPolicy.noText.ok, false, "scrapbook-old-scene.ts fails noText in checkScene");
assert.ok(oldPolicy.message?.includes("remove the calls to typed"), "oldPolicy message names typed");
assert.ok(oldPolicy.message?.includes("Fix all issues in one go."), "oldPolicy message instructs fixing all issues in one go");

const newPolicy = checkScene("scrapbook", newSceneCode);
assert.equal(newPolicy.ok, false, "scrapbook-new-scene.ts fails checkScene");
assert.equal(newPolicy.kitUse.ok, true, "scrapbook-new-scene.ts passes checkKitUse");
assert.equal(newPolicy.noText.ok, false, "scrapbook-new-scene.ts fails noText in checkScene");
assert.ok(newPolicy.message?.includes("remove the calls to handWrite/typed"), "newPolicy message names handWrite/typed");

// 3. Clean scene fixture passes both checkNoText and checkScene
const cleanNoText = checkNoText("scrapbook", cleanSceneCode);
assert.equal(cleanNoText.ok, true, "clean scrapbook scene passes checkNoText");
assert.deepEqual(cleanNoText.issues, []);
assert.equal(cleanNoText.message, undefined);

const cleanPolicy = checkScene("scrapbook", cleanSceneCode);
assert.equal(cleanPolicy.ok, true, "clean scrapbook scene passes checkScene");
assert.deepEqual(cleanPolicy.issues, []);
assert.equal(cleanPolicy.message, undefined);

// 4. Canvas text API calls/references (fillText, strokeText, measureText, ctx.font / .font =) fail
const fillTextScene = `${cleanSceneCode}\nctx.fillText("HELLO", 100, 100);\n`;
const fillTextRes = checkNoText("scrapbook", fillTextScene);
assert.equal(fillTextRes.ok, false, "scene calling fillText fails checkNoText");
assert.deepEqual(fillTextRes.issues.map((i) => ({ kind: i.kind, name: i.name })), [
  { kind: "canvas-text", name: "fillText" }
]);
assert.equal(
  fillTextRes.message,
  "No words in the picture: remove the calls to fillText; the editor lays on all text. Draw shapes and marks instead."
);
assert.equal(checkScene("scrapbook", fillTextScene).ok, false, "scene calling fillText fails checkScene");

const strokeAndFontScene = `${cleanSceneCode}\nctx.font = "20px serif";\nctx.strokeText("HI", 10, 20);\nconst m = ctx.measureText("HI"); void m;\n`;
const strokeFontRes = checkNoText("scrapbook", strokeAndFontScene);
assert.equal(strokeFontRes.ok, false);
assert.deepEqual(
  strokeFontRes.issues.map((i) => ({ kind: i.kind, name: i.name })),
  [
    { kind: "canvas-text", name: "ctx.font" },
    { kind: "canvas-text", name: "strokeText" },
    { kind: "canvas-text", name: "measureText" }
  ]
);

// Combined helper + fillText message format matches brief example:
const bothHelperAndFillText = `${newSceneCode}\nctx.fillText("EXTRA", 10, 10);\n`;
const bothRes = checkNoText("scrapbook", bothHelperAndFillText);
assert.equal(
  bothRes.message,
  "No words in the picture: remove the calls to handWrite/typed (and fillText); the editor lays on all text. Draw shapes and marks instead."
);

// Combined kit-use failure + no-text failure in checkScene:
assert.equal(POLICY_REPAIR_MAX, 1);
assert.equal(KIT_REPAIR_MAX, POLICY_REPAIR_MAX);
const bareWithText = `
  import type { Ctx, Env } from "./core";
  import type { Film } from "./film";
  const draw = (ctx: Ctx, _f: number, env: Env) => {
    ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
    ctx.fillText("Bad", 50, 50);
  };
  export const film: Film = { meta: { title: "t", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: 90 }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: 90, draw }] };
`;
const barePolicy = checkScene("scrapbook", bareWithText);
assert.equal(barePolicy.ok, false);
assert.equal(barePolicy.kitUse.ok, false);
assert.equal(barePolicy.noText.ok, false);
assert.equal(barePolicy.issues.length, 2);
assert.equal(barePolicy.issues[0].kind, "kit-use");
assert.equal(barePolicy.issues[1].kind, "canvas-text");
assert.ok(barePolicy.message?.includes("Build the scene from the style's kit helpers"));
assert.ok(barePolicy.message?.includes("No words in the picture: remove the calls to fillText"));
assert.ok(barePolicy.message?.includes("Fix all issues in one go."));

// 5. Strings or comments mentioning handWrite, typed, or fillText do NOT fail
const commentAndStringScene = `${cleanSceneCode}
// Do not call handWrite(g, "NO. 1", 0, 0, 20, "#000", 1) or typed(ctx, "CAP", 0, 0, 16, "#000", 1) or ctx.fillText("x", 0, 0)
/* Multi-line comment:
   handWrite(g, "test", 0, 0, 12, "#000", 1);
   typed(ctx, "test", 0, 0, 12, "#000", 1);
   ctx.font = "12px sans-serif";
   ctx.strokeText("test", 0, 0);
*/
const noteLabel = "handWrite(g, 'NO. 1') and typed(c, 'FIG. 1') and fillText('hi') and ctx.font = '10px'";
const singleQuoted = 'handWrite(g) typed(c) measureText("a")';
const templateStr = \`never call handWrite(g) or typed(c) or fillText(x) in scene \${1 + 1}\`;
void noteLabel; void singleQuoted; void templateStr;
`;
const commentStringRes = checkNoText("scrapbook", commentAndStringScene);
assert.equal(commentStringRes.ok, true, "mentions of handWrite/typed/fillText inside strings or comments do not fail");
assert.deepEqual(commentStringRes.issues, []);
assert.equal(checkScene("scrapbook", commentAndStringScene).ok, true);

// Other styles with letter helpers (blueprint, moonPhases, pocketWatch):
assert.equal(checkNoText("blueprint", "k.callout('A', [0,0], [1,1], 1); k.dim([0,0], [1,1], 10, '5', 1);").ok, false);
assert.deepEqual(
  checkNoText("blueprint", "k.callout('A', [0,0], [1,1], 1); k.dim([0,0], [1,1], 10, '5', 1);").issues.map((i) => i.name),
  ["callout", "dim"]
);
assert.equal(checkNoText("moonPhases", "letter(g, 'FULL', 100, 100);").ok, false);
assert.equal(checkNoText("pocketWatch", "numeral(g, 'XII', 0, 30, 1);").ok, false);

// 6. Prompt contract: scrapbook names its letter helpers; styles with none have no extra line
const sampleBeats = [
  { keyword: "Opening", visual: "A honeybee lands on a wild dog rose.", onScreen: null, line: "In the morning garden." }
];

const scrapbookMsg = await buildAuthorMessages({
  look: lookForPlateName("scrapbook"),
  plateName: "scrapbook",
  film: "How a honeybee finds flowers.",
  beats: sampleBeats,
  aspect: "16:9",
  index: 0,
  frames: 90
});

const expectedScrapbookHelpers = letterHelpersFor("scrapbook");
assert.deepEqual(
  expectedScrapbookHelpers,
  ["handWrite", "typed", "glyph", "ransom", "drawTile", "drawStrip", "drawStamp"]
);
assert.ok(
  scrapbookMsg.system.includes(`Do not call ${expectedScrapbookHelpers.join(", ")}: they print words.`),
  "scrapbook system contract names its letter helpers"
);

for (const name of styleNames) {
  const helpers = letterHelpersFor(name);
  const sys = contractFor({ w: 1920, h: 1080, label: "16:9" }, 220, name);
  if (helpers.length > 0) {
    assert.ok(
      sys.includes(`Do not call ${helpers.join(", ")}: they print words.`),
      `${name}: contract names letter helpers (${helpers.join(", ")})`
    );
  } else {
    assert.ok(!sys.includes("Do not call "), `${name}: style with no letter helpers has no extra line`);
    assert.ok(!sys.includes("they print words"), `${name}: style with no letter helpers has no print-words line`);
    assert.equal(sys.split("\n").length, 11, `${name}: contract has 11 lines when letter-helper list is empty`);
  }
}

// 7. Digests: still one version (5), and differ for styles whose letter-helper list differs
assert.equal(LEGACY_PROMPT_VERSION, 3);
assert.equal(PROMPT_VERSION, 5);

const digests = new Map();
for (const name of styleNames) {
  digests.set(name, await promptDigest(name));
}

for (const a of styleNames) {
  for (const b of styleNames) {
    const lhA = letterHelpersFor(a).join(",");
    const lhB = letterHelpersFor(b).join(",");
    if (lhA !== lhB) {
      assert.notEqual(
        digests.get(a),
        digests.get(b),
        `digest(${a}) [letterHelpers=${lhA}] != digest(${b}) [letterHelpers=${lhB}]`
      );
    }
  }
}

// Specifically verify pocketWatch (["numeral"]) vs wren ([]) which both have kitModulesFor = []:
assert.notEqual(
  digests.get("pocketWatch"),
  digests.get("wren"),
  "pocketWatch and wren have different digests because pocketWatch has letter helper 'numeral'"
);
// And scrapbook vs paperCraft (both use scrapbookKit, but scrapbook also has its own plate letter helpers):
assert.notEqual(
  digests.get("scrapbook"),
  digests.get("paperCraft"),
  "scrapbook and paperCraft have different digests"
);

console.log(`no-text: ok (${canvasCoreModules.length} canvas-core modules reviewed, scrapbook old/new/clean fixtures, fillText, comment/string immunity, prompts & v5 digests verified)`);
