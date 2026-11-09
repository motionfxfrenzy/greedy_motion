// Scene rule, kit module resolution, kit-use check, and v5 digests across all 31 styles.
// DB-free, network-free.
// Run: node test/scene-rule.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHARACTER_RULE, galleryTemplates, parseScriptBrief, useCaseOf } from "@videosaas/contracts";
import { coreFile, loadManifest, plateFile } from "@videosaas/plate-engine";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");

const { systemBlocks } = await import("../src/plan/script-writer.ts");
const { directorSystem, userMessage } = await import("../src/plan/director.ts");
const {
  buildAuthorMessages,
  CHARACTER_RULE_BLOCK,
  CHARACTER_RULE_LEAD_IN,
  checkKitUse,
  GUIDED_STYLES,
  KIT_BUDGET_CHARS,
  KIT_REPAIR_MAX,
  kitHelperNamesFor,
  kitModulesFor,
  kitModulesForPrompt,
  loadGuide,
  lookForPlateName,
  MIN_KIT_HELPERS,
  PROMPT_VERSION,
  promptDigest
} = await import("../src/plates/prompt.ts");
const { exportedNamesOf } = await import("../src/plates/prompt-context.ts");

const OLD_V3_DIGEST = "4126e4d502bb1f23";
const manifest = loadManifest();
const styleNames = Object.keys(manifest.styles).sort();
assert.equal(styleNames.length, 31);

// 1. Single source: CHARACTER_RULE's text occurs in exactly one source file (packages/contracts/src/character-rule.ts)
function walkSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSourceFiles(full, out);
    else if (/\.(ts|mts|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sourceFiles = [
  ...walkSourceFiles(join(repoRoot, "packages")),
  ...walkSourceFiles(join(repoRoot, "backend", "src"))
];
const needle = "CHARACTERS AND PROPS (decided per beat from what the thing DOES, not from what kind of thing it is).";
const filesContainingRuleLiteral = sourceFiles
  .filter((f) => readFileSync(f, "utf8").includes(needle))
  .map((f) => relative(repoRoot, f).replace(/\\/g, "/"));

assert.deepEqual(
  filesContainingRuleLiteral,
  ["packages/contracts/src/character-rule.ts"],
  "CHARACTER_RULE text literal appears in exactly one source file"
);

// 1b. CHARACTER_RULE verbatim in script-writer system blocks (story films only; absent for product/explainer)
const baseBriefInput = {
  scriptMode: "problem",
  text: "A sheet of paper learns how money works.",
  durationSeconds: 30,
  aspect: "16:9",
  motionProfile: "smooth",
  pace: "balanced",
  captions: "key-phrases",
  audio: { mode: "voiceover" }
};
const baseBrief = parseScriptBrief(baseBriefInput).brief;
const emptyContext = { brandName: "", screenshots: [] };

const storyStyleBrief = { ...baseBrief, look: "illus-folk-tale" };
const storyTemplateBrief = { ...baseBrief, styleExample: "story-illus-rubber-hose" };
const ownStoryBrief = { ...baseBrief, scriptMode: "own", look: "illus-wren" };
const explainerBrief = { ...baseBrief, styleFamily: "clean-data" };
const explainTemplate = galleryTemplates.find((item) => useCaseOf(item) === "explain");
const productBrief = { ...baseBrief, look: "clean" };
const productContext = { brandName: "Acme", screenshots: [] };

const scriptWriterLeadIn =
  "When you turn the topic into a story, decide who the characters are and at which level each one is (prop, living object or full cartoon character), name them in the cast, and write what they say and do:";

for (const sb of [storyStyleBrief, storyTemplateBrief, ownStoryBrief]) {
  const sysText = systemBlocks({ brief: sb, context: emptyContext }).map((b) => b.text).join("\n");
  assert.ok(
    sysText.includes(`${scriptWriterLeadIn} ${CHARACTER_RULE}`),
    "script-writer systemBlocks contains lead-in + CHARACTER_RULE verbatim for story films"
  );
}
assert.ok(
  !systemBlocks({ brief: explainerBrief, context: emptyContext }).map((b) => b.text).join("\n").includes(CHARACTER_RULE),
  "script-writer systemBlocks omits CHARACTER_RULE for explainer films"
);
if (explainTemplate) {
  const expTplBrief = { ...baseBrief, styleExample: explainTemplate.id, look: explainTemplate.look };
  assert.ok(
    !systemBlocks({ brief: expTplBrief, context: emptyContext }).map((b) => b.text).join("\n").includes(CHARACTER_RULE),
    "script-writer systemBlocks omits CHARACTER_RULE for educational gallery template"
  );
}
assert.ok(
  !systemBlocks({ brief: productBrief, context: productContext }).map((b) => b.text).join("\n").includes(CHARACTER_RULE),
  "script-writer systemBlocks omits CHARACTER_RULE for product films"
);

// 1c. CHARACTER_RULE verbatim in director/storyboard prompt (story films only; absent for product/explainer)
const directorLeadIn =
  "Each VISUAL must say plainly which level each thing is at (PROP, LIVING OBJECT or FULL CARTOON CHARACTER; for example 'the paper boat, a living object with a face and no arms, bobs' or 'the paper sheet, a full cartoon character with arms, waves'):";

for (const sb of [storyStyleBrief, storyTemplateBrief, ownStoryBrief]) {
  assert.ok(
    directorSystem(sb).includes(`${directorLeadIn} ${CHARACTER_RULE}`),
    "directorSystem includes lead-in + CHARACTER_RULE verbatim for story films"
  );
  assert.ok(
    userMessage(sb, emptyContext).includes(`${directorLeadIn} ${CHARACTER_RULE}`),
    "director userMessage includes lead-in + CHARACTER_RULE verbatim for story films"
  );
}
assert.ok(!directorSystem(explainerBrief).includes(CHARACTER_RULE), "directorSystem omits CHARACTER_RULE for explainer films");
assert.ok(!userMessage(explainerBrief, emptyContext).includes(CHARACTER_RULE), "director userMessage omits CHARACTER_RULE for explainer films");
assert.ok(!directorSystem(productBrief).includes(CHARACTER_RULE), "directorSystem omits CHARACTER_RULE for product films");
assert.ok(!userMessage(productBrief, productContext).includes(CHARACTER_RULE), "director userMessage omits CHARACTER_RULE for product films");

// 1d. CHARACTER_RULE verbatim in scene prompt for all 31 styles
const sceneLeadIn = "Draw the characters and props exactly as the beat's VISUAL says, consistent with the CAST note:";
assert.equal(CHARACTER_RULE_LEAD_IN, sceneLeadIn);
assert.equal(CHARACTER_RULE_BLOCK, `${sceneLeadIn} ${CHARACTER_RULE}`);

// 2. kitModulesFor: expected modules for all 31 styles
const EXPECTED_KITS = {
  balloon: [],
  blueprint: ["drafting", "riso", "blueprintKit"],
  brokenColour: ["brokenColourKit"],
  charcoalErasure: ["charcoalErasureKit"],
  colouredPencil: ["colouredPencilKit", "colouredPencilCrow"],
  embroidery: ["embroideryKit"],
  flatVector: ["koiDrawKit"],
  folkTale: ["sumiEKit", "folkTaleKit"],
  fox: [],
  halftone: ["halftoneKit", "halftoneScene"],
  isometric: ["isometricKit"],
  koi: ["koiDrawKit"],
  lighthouse: ["riso"],
  lowPoly: ["scrapbookKit"],
  mellan: [],
  midCentury: ["koiDrawKit"],
  moonPhases: ["drafting"],
  paintedOil: ["sumiEKit", "paintedOilKit"],
  paperCraft: ["scrapbookKit"],
  pixelArt: ["pixelArtKit"],
  pocketWatch: [],
  ranunculus: [],
  rubberHose: ["koiDrawKit", "rubberHoseKit"],
  scrapbook: ["scrapbookKit", "scrapbookEngraving"],
  scratchboard: ["scratchboardKit"],
  stipple: ["stippleKit"],
  storybook: [],
  sumiE: ["sumiEKit"],
  toyBrick: ["toyBrickKit"],
  woodcut: ["woodcutKit"],
  wren: []
};

assert.deepEqual(Object.keys(EXPECTED_KITS).sort(), styleNames, "all 31 styles covered in EXPECTED_KITS");

for (const name of styleNames) {
  const mods = kitModulesFor(name);
  assert.deepEqual(
    mods.map((m) => m.name),
    EXPECTED_KITS[name],
    `kitModulesFor(${name}) matches expected dependency-ordered list`
  );
  for (const m of mods) {
    assert.equal(m.specifier, `./${m.name}`);
    assert.equal(m.relPath, `canvas-core/${m.name}.ts`);
    assert.equal(m.path, coreFile(m.name));
    assert.ok(m.source.length > 0);
  }
}

// Explicit required assertions from the brief:
assert.deepEqual(kitModulesFor("koi").map((m) => m.name), ["koiDrawKit"]);
assert.deepEqual(kitModulesFor("folkTale").map((m) => m.name), ["sumiEKit", "folkTaleKit"]);
assert.deepEqual(kitModulesFor("lighthouse").map((m) => m.name), ["riso"]);
assert.deepEqual(kitModulesFor("moonPhases").map((m) => m.name), ["drafting"]);
assert.deepEqual(kitModulesFor("colouredPencil").map((m) => m.name), ["colouredPencilKit", "colouredPencilCrow"]);
assert.deepEqual(kitModulesFor("halftone").map((m) => m.name), ["halftoneKit", "halftoneScene"]);
assert.deepEqual(kitModulesFor("scrapbook").map((m) => m.name), ["scrapbookKit", "scrapbookEngraving"]);
assert.deepEqual(kitModulesFor("lowPoly").map((m) => m.name), ["scrapbookKit"]);
assert.deepEqual(kitModulesFor("paperCraft").map((m) => m.name), ["scrapbookKit"]);
assert.deepEqual(kitModulesFor("flatVector").map((m) => m.name), ["koiDrawKit"]);
assert.deepEqual(kitModulesFor("midCentury").map((m) => m.name), ["koiDrawKit"]);
assert.deepEqual(kitModulesFor("wren").map((m) => m.name), []);

// Every module in the prompt in full (or complete API when over budget) and no `truncated` marker in any style's prompt:
const sampleBeats = [
  { keyword: "Opening", visual: "The paper sheet, a cartoon character with arms, waves beside a plain glass bottle.", onScreen: null, line: "Hello from the desk." }
];
assert.deepEqual(GUIDED_STYLES, ["paintedOil"], "only paintedOil is in GUIDED_STYLES");
for (const name of styleNames) {
  const guide = await loadGuide(name);
  assert.equal(Boolean(guide), name === "paintedOil", `${name}: loadGuide matches GUIDED_STYLES`);
  const msg = await buildAuthorMessages({
    look: lookForPlateName(name),
    plateName: name,
    film: "A story about a sheet of paper.",
    beats: sampleBeats,
    aspect: "16:9",
    index: 0,
    frames: 90
  });
  const shared = msg.messages[0].content[0].text;
  const scene = msg.messages[0].content[1].text;
  assert.ok(!msg.system.includes("truncated") && !shared.includes("truncated") && !scene.includes("truncated"), `${name}: no truncated marker`);
  assert.ok(shared.includes(`${sceneLeadIn} ${CHARACTER_RULE}`), `${name}: scene prompt contains CHARACTER_RULE verbatim`);
  assert.equal(shared.includes(`<guide name="${name}">`), name === "paintedOil", `${name}: guide block present iff paintedOil`);
  const kits = kitModulesFor(name);
  const promptKits = kitModulesForPrompt(kits, readFileSync(plateFile(name), "utf8"), KIT_BUDGET_CHARS);
  for (const pk of promptKits) {
    assert.ok(shared.includes(`<kit name="${pk.name}">\n${pk.text}\n</kit>`), `${name}: prompt includes kit ${pk.name}`);
  }
}

// 3. checkKitUse: passes on plausible good scenes (fixtures for 3+ styles using real helper names), fails on kit-free scene, message names helpers that really exist
assert.equal(MIN_KIT_HELPERS, 3);
assert.equal(KIT_REPAIR_MAX, 1);

const GOOD_SCENE_FIXTURES = {
  folkTale: `
    import type { Ctx, Env } from "./core";
    import type { Film } from "./film";
    import { PAPER, far, gouache, pencil, reveal } from "./folkTaleKit";
    import { timeline } from "./sumiEKit";
    const draw = (ctx: Ctx, frame: number, env: Env) => {
      const p = timeline(frame, [[0, 90]]);
      void PAPER; void far; void gouache; void pencil; void reveal; void p; void env;
    };
    export const film: Film = { meta: { title: "t", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: 90 }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: 90, draw }] };
  `,
  koi: `
    import type { Ctx, Env } from "./core";
    import type { Film } from "./film";
    import { cut, part, stagger, streakClip, streaks } from "./koiDrawKit";
    const draw = (ctx: Ctx, frame: number, env: Env) => {
      void cut; void part; void stagger; void streakClip; void streaks; void frame; void env;
    };
    export const film: Film = { meta: { title: "t", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: 90 }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: 90, draw }] };
  `,
  wren: `
    import type { Ctx, Env } from "./core";
    import type { Film } from "./film";
    const pen = () => {};
    const wet = () => {};
    const inked = () => {};
    const twig = () => { pen(); wet(); inked(); };
    const draw = (ctx: Ctx, frame: number, env: Env) => { twig(); void frame; void env; };
    export const film: Film = { meta: { title: "t", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: 90 }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: 90, draw }] };
  `
};

for (const [style, goodCode] of Object.entries(GOOD_SCENE_FIXTURES)) {
  const res = checkKitUse(style, goodCode);
  assert.equal(res.ok, true, `checkKitUse(${style}) passes on plausible good scene`);
  assert.ok(res.used.length >= MIN_KIT_HELPERS, `checkKitUse(${style}) matched ${res.used.length} helpers`);
}

const KIT_FREE_SCENE = `
  import type { Ctx, Env } from "./core";
  import type { Film } from "./film";
  const draw = (ctx: Ctx, _frame: number, env: Env) => {
    ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1920, 1080);
  };
  export const film: Film = { meta: { title: "Bare", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames: 90 }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: 90, draw }] };
`;

for (const name of styleNames) {
  const badRes = checkKitUse(name, KIT_FREE_SCENE);
  assert.equal(badRes.ok, false, `checkKitUse(${name}) fails on kit-free scene`);
  assert.match(
    badRes.message ?? "",
    /^Build the scene from the style's kit helpers: use at least 3 of: /,
    `checkKitUse(${name}) failure message has required format`
  );
  const listed = (badRes.message ?? "")
    .replace(/^Build the scene from the style's kit helpers: use at least 3 of:\s*/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(listed.length >= 3 && listed.length <= 12, `${name}: message lists between 3 and 12 central helpers (got ${listed.length})`);

  const kits = kitModulesFor(name);
  const realNames = new Set();
  if (kits.length > 0) {
    for (const k of kits) for (const ex of exportedNamesOf(k.source)) realNames.add(ex);
  } else {
    const plateSrc = readFileSync(plateFile(name), "utf8");
    for (const m of plateSrc.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) realNames.add(m[1]);
  }
  for (const helperName of listed) {
    assert.ok(realNames.has(helperName), `${name}: helper "${helperName}" in message exists in kit/plate source`);
  }

  // Also verify constructing a scene with the first 3 helpers from kitHelperNamesFor(name) passes:
  const { top12 } = kitHelperNamesFor(name);
  const synthGood = `${KIT_FREE_SCENE}\nvoid (${top12.slice(0, 3).join(", ")});`;
  assert.equal(checkKitUse(name, synthGood).ok, true, `checkKitUse(${name}) passes when 3 top helpers are referenced`);
}

// 4. Digests: PROMPT_VERSION = 5, differ from old v3 value for every style, differ between styles with different kit modules, and change when CHARACTER_RULE changes
assert.equal(PROMPT_VERSION, 5);
const digestsByStyle = new Map();
for (const name of styleNames) {
  const d = await promptDigest(name);
  assert.notEqual(d, OLD_V3_DIGEST, `${name}: v5 digest differs from v3 digest`);
  const dModified = await promptDigest(name, `${CHARACTER_RULE}\nExtra clause.`);
  assert.notEqual(dModified, d, `${name}: digest changes when CHARACTER_RULE changes`);
  digestsByStyle.set(name, d);
}

for (const a of styleNames) {
  for (const b of styleNames) {
    const kitsA = kitModulesFor(a).map((k) => k.name).join(",");
    const kitsB = kitModulesFor(b).map((k) => k.name).join(",");
    if (kitsA !== kitsB) {
      assert.notEqual(
        digestsByStyle.get(a),
        digestsByStyle.get(b),
        `digest(${a}) [${kitsA}] != digest(${b}) [${kitsB}]`
      );
    }
  }
}

console.log(`scene-rule: ok (single source verified, 31 kitModulesFor checked, 31 checkKitUse & digests verified)`);

// 5. Three levels: the shared rule names all three, says living objects have no arms/hands, and guides script writing
for (const part of ["1) PROP", "2) LIVING OBJECT", "3) FULL CARTOON CHARACTER", "NO arms and NO hands", "same level", "only when the user's topic or brief is a story about that object", "human or animal guide"]) {
  assert.ok(CHARACTER_RULE.includes(part), `CHARACTER_RULE contains: ${part}`);
}
console.log("three-level character rule: ok");
