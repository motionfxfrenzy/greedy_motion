// Style scene prompts: GUIDED_STYLES allow-list of ["paintedOil"], parked guides, no-blind-cut kitModulesFor & plateExcerpt
// across all 31 styles, per-style v5 promptDigest with v3 legacy preservation under PLATE_STYLE_GUIDES=off, CHARACTER_RULE, and checkKitUse.
// DB-free, network-free.
// Run: node test/style-prompts.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHARACTER_RULE } from "@videosaas/contracts";
import { ENGINE_DIR, kitFile, loadManifest, plateFile, SRC_DIR } from "@videosaas/plate-engine";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");
const oldFixture = JSON.parse(readFileSync(join(testDir, "fixtures", "old-prompt-assembly.json"), "utf8"));

const {
  approxTokens,
  buildAuthorMessages,
  CHARACTER_RULE_BLOCK,
  CHARACTER_RULE_LEAD_IN,
  CHARACTER_RULE_STYLES,
  characterRuleMode,
  checkKitUse,
  contractFor,
  CUT_POLICY_VERSION,
  GUIDED_STYLES,
  KIT_BUDGET_CHARS,
  KIT_REPAIR_MAX,
  kitModulesFor,
  kitModulesForPrompt,
  LEGACY_PROMPT_VERSION,
  loadGuide,
  lookForPlateName,
  MIN_KIT_HELPERS,
  PROMPT_VERSION,
  promptDigest,
  styleGuidesEnabled,
  TIER_LINES
} = await import("../src/plates/prompt.ts");
const {
  DEFAULT_MAX_LINES,
  exportedNamesOf,
  guideHelperRefs,
  hasBalancedDelimiters,
  kitApi,
  kitForPrompt,
  parseGuide,
  plateExcerpt,
  SOURCE_BUDGET_CHARS
} = await import("../src/plates/prompt-context.ts");
const { computePromptSizes } = await import("../scripts/prompt-sizes.mjs");
const { runAbScene } = await import("../scripts/ab-scene.mjs");

// Recorded from the pre-change code (`PROMPT_VERSION = 3`, 220-line contract, crayon worked-example.txt):
const OLD_GLOBAL_PROMPT_DIGEST = "4126e4d502bb1f23";
assert.equal(oldFixture.digest, OLD_GLOBAL_PROMPT_DIGEST);

const manifest = loadManifest();
const styleNames = Object.keys(manifest.styles).sort();
assert.equal(styleNames.length, 31, "manifest has 31 styles");

const EXPECTED_PARKED_GUIDES = [
  "blueprint",
  "brokenColour",
  "charcoalErasure",
  "colouredPencil",
  "embroidery",
  "folkTale",
  "isometric",
  "lighthouse",
  "paintedOil",
  "paperCraft",
  "scrapbook",
  "scratchboard",
  "wren"
];

// 1. Allow-list of one (`GUIDED_STYLES = ["paintedOil"]`): engine `guides/` dir contains exactly `paintedOil.md`;
// parked guides in `docs/handoff/style-prompts/guides-parked/` are validated but never loaded for any other style.
assert.deepEqual(GUIDED_STYLES, ["paintedOil"], "GUIDED_STYLES allow-list contains only paintedOil");

const activeGuidesDir = join(ENGINE_DIR, "guides");
assert.equal(existsSync(activeGuidesDir), true, "packages/plate-engine/guides exists");
const activeGuideFiles = readdirSync(activeGuidesDir).filter((f) => f.endsWith(".md")).sort();
assert.deepEqual(activeGuideFiles, ["paintedOil.md"], "engine guides/ dir contains exactly paintedOil.md");

const activePaintedOilGuide = await loadGuide("paintedOil");
assert.ok(activePaintedOilGuide, "loadGuide('paintedOil') returns the paintedOil guide");
assert.equal(activePaintedOilGuide.tier, "heavy");
assert.equal(activePaintedOilGuide.lines, 320);
assert.equal(activePaintedOilGuide.example, "plate-excerpt");

for (const name of styleNames) {
  if (name === "paintedOil") continue;
  assert.equal(GUIDED_STYLES.includes(name), false, `${name} is not in GUIDED_STYLES`);
  assert.equal(await loadGuide(name), null, `loadGuide(${name}) is null`);
}

const parkedGuidesDir = join(repoRoot, "docs", "handoff", "style-prompts", "guides-parked");
assert.ok(existsSync(parkedGuidesDir), "docs/handoff/style-prompts/guides-parked directory exists");
const guideFiles = readdirSync(parkedGuidesDir).filter((f) => f.endsWith(".md")).sort();
assert.deepEqual(
  guideFiles.map((f) => f.replace(/\.md$/, "")),
  EXPECTED_PARKED_GUIDES,
  "all 13 parked style guides are present"
);

for (const file of guideFiles) {
  const plateName = file.replace(/\.md$/, "");
  assert.ok(manifest.styles[plateName], `parked guide ${file} matches a known style in manifest.json`);
  const raw = readFileSync(join(parkedGuidesDir, file), "utf8");
  const guide = parseGuide(raw);
  assert.ok(["light", "medium", "heavy"].includes(guide.tier), `${file}: valid tier`);
  assert.equal(guide.lines, TIER_LINES[guide.tier]);
  const exported = new Set();
  for (const rel of manifest.styles[plateName].files) {
    const src = readFileSync(join(SRC_DIR, rel), "utf8");
    for (const name of exportedNamesOf(src)) exported.add(name);
  }
  for (const ref of guideHelperRefs(guide.body)) {
    assert.ok(exported.has(ref), `${file}: quoted helper \`${ref}\` exists in ${plateName}'s kit/plate files`);
  }
}

// Testable seam + GUIDED_STYLES gating: putting a copy of another guide into a temp dir path via loadGuide's guidesDir seam
// must still return null and have NO influence on prompt or digest for styles other than paintedOil.
const tmpGuidesSeamDir = mkdtempSync(join(tmpdir(), "guides-seam-test-"));
try {
  for (const file of guideFiles) {
    copyFileSync(join(parkedGuidesDir, file), join(tmpGuidesSeamDir, file));
  }
  const seamPaintedOil = await loadGuide("paintedOil", tmpGuidesSeamDir);
  assert.ok(seamPaintedOil, "loadGuide('paintedOil', tmpGuidesSeamDir) loads paintedOil");
  for (const name of styleNames) {
    if (name === "paintedOil") continue;
    assert.equal(
      await loadGuide(name, tmpGuidesSeamDir),
      null,
      `loadGuide(${name}, tmpGuidesSeamDir) is null even when ${name}.md exists on disk`
    );
    assert.equal(
      await promptDigest(name, undefined, tmpGuidesSeamDir),
      await promptDigest(name),
      `promptDigest(${name}) has zero guide influence even when guide file exists in guidesDir`
    );
  }
} finally {
  rmSync(tmpGuidesSeamDir, { recursive: true, force: true });
}

// 2. kitApi keeps every exported name for all 17 *Kit.ts files, and kitModulesFor resolves all transitive kit imports
let checkedKits = 0;
for (const name of styleNames) {
  const kPath = kitFile(name);
  if (!existsSync(kPath)) continue;
  checkedKits++;
  const src = readFileSync(kPath, "utf8");
  const api = kitApi(src);
  const bal = hasBalancedDelimiters(api);
  assert.ok(bal.ok, `kitApi(${name}) has balanced delimiters: ${bal.reason ?? ""}`);
  assert.ok(api.length < src.length, `kitApi(${name}) is smaller than raw kit source`);
  assert.ok(api.includes("{ /* ... */ }"), `kitApi(${name}) elides function bodies with { /* ... */ }`);
  const names = exportedNamesOf(src);
  assert.ok(names.length > 0, `${name}Kit has exports`);
  for (const sym of names) {
    assert.match(api, new RegExp(`\\b${sym}\\b`), `kitApi(${name}) retains exported symbol "${sym}"`);
  }
  const forPrompt = kitForPrompt(src, SOURCE_BUDGET_CHARS);
  assert.ok(!forPrompt.includes("/* ...truncated... */"), `kitForPrompt(${name}) never uses blind truncation`);
}
assert.equal(checkedKits, 17, "all 17 style-named *Kit.ts files checked");

// 3. plateExcerpt structural checks across all 31 plates (at default 60k budget and forced 20k & 12k excerpt budgets)
for (const name of styleNames) {
  const src = readFileSync(plateFile(name), "utf8");
  for (const budget of [SOURCE_BUDGET_CHARS, 20_000, 12_000]) {
    const out = plateExcerpt(src, budget);
    assert.ok(out.length <= budget, `plateExcerpt(${name}, ${budget}) length ${out.length} <= ${budget}`);
    assert.ok(!out.includes("/* ...truncated... */"), `plateExcerpt(${name}, ${budget}) never cuts blindly`);
    const bal = hasBalancedDelimiters(out);
    assert.ok(bal.ok, `plateExcerpt(${name}, ${budget}) has balanced braces/parens: ${bal.reason ?? ""}`);
    assert.match(
      out,
      /export\s+const\s+(?:[A-Za-z0-9_]+\s*:\s*Film|draw[A-Z][A-Za-z0-9_]*)/,
      `plateExcerpt(${name}, ${budget}) retains the film/draw export`
    );
    if (src.length > budget) {
      assert.ok(
        out.includes("/* helper body omitted:"),
        `plateExcerpt(${name}, ${budget}) marks omitted helper bodies explicitly`
      );
    }
  }
}

// 4. Digest behaviour: PROMPT_VERSION = 5; every style has a new v5 digest differing from OLD_GLOBAL_PROMPT_DIGEST;
// paintedOil's digest includes its guide; styles other than paintedOil have NO guide influence in digest.
assert.equal(LEGACY_PROMPT_VERSION, 3);
assert.equal(PROMPT_VERSION, 5);
assert.equal(await promptDigest(), OLD_GLOBAL_PROMPT_DIGEST, "promptDigest() with no argument matches legacy fixture");

const workedExampleText = readFileSync(join(ENGINE_DIR, "worked-example.txt"), "utf8");
const unguidedFormulaFor = (name) => {
  const kitNames = kitModulesFor(name).map((k) => k.name).join(",");
  return createHash("sha256")
    .update(
      [
        PROMPT_VERSION,
        contractFor({ w: 0, h: 0, label: "" }, DEFAULT_MAX_LINES),
        CHARACTER_RULE,
        workedExampleText,
        kitNames,
        CUT_POLICY_VERSION
      ].join("\0")
    )
    .digest("hex")
    .slice(0, 16);
};

for (const name of styleNames) {
  const d = await promptDigest(name);
  assert.notEqual(d, OLD_GLOBAL_PROMPT_DIGEST, `${name} has new v5 digest (${d} != ${OLD_GLOBAL_PROMPT_DIGEST})`);
  const tweaked = await promptDigest(name, `${CHARACTER_RULE} extra`);
  assert.notEqual(tweaked, d, `${name} digest changes when CHARACTER_RULE changes`);
  if (name === "paintedOil") {
    assert.notEqual(d, unguidedFormulaFor(name), "paintedOil digest includes its guide (differs from unguided v5 formula)");
  } else {
    assert.equal(d, unguidedFormulaFor(name), `${name} digest matches unguided v5 formula (no guide influence)`);
  }
}
assert.notEqual(await promptDigest("koi"), await promptDigest("folkTale"), "styles with different kit modules have different digests");
assert.notEqual(await promptDigest("lighthouse"), await promptDigest("wren"), "lighthouse and wren have different digests");
assert.notEqual(await promptDigest("paintedOil"), await promptDigest("folkTale"), "paintedOil and folkTale have different digests");

// 5. Prompt assembly across all 31 styles:
// - paintedOil prompt contains the guide, the character rule, and all its kit modules, with 320-line heavy tier contract.
// - folkTale/wren/scrapbook (and all other 30 styles) contain NO guide block, still contain the character rule and every imported kit module, and use the OLD 220-line contract wording.
const sampleBeats = [
  { keyword: "Barter", visual: "A boy trades a rooster for a sack of grain by the wattle fence.", onScreen: null, line: "Before coins, people traded what they raised." },
  { keyword: "Coins", visual: "Stamped golden coins rest on an open palm beside the cottage.", onScreen: null, line: "Then metal carried value from village to village." }
];

assert.equal(approxTokens(220), "6,200");
assert.equal(CHARACTER_RULE_STYLES, "all");
assert.equal(characterRuleMode(), "all");
assert.equal(CHARACTER_RULE_BLOCK, `${CHARACTER_RULE_LEAD_IN} ${CHARACTER_RULE}`);

const OLD_220_LINE_CONTRACT_SENTENCE =
  "Keep the module COMPACT, under about 220 lines: one focal subject, a simple setting, and reuse small helpers and loops. A complete short module is worth far more than a long unfinished one.";

for (const name of styleNames) {
  const msg = await buildAuthorMessages({
    look: lookForPlateName(name),
    plateName: name,
    film: "How money evolves from village barter to modern exchange.",
    beats: sampleBeats,
    aspect: "16:9",
    index: 0,
    frames: 120
  });
  const shared = msg.messages[0].content[0].text;
  assert.ok(!shared.includes("truncated"), `${name}: no truncated marker in shared prompt`);
  assert.ok(!msg.system.includes("truncated"), `${name}: no truncated marker in system prompt`);
  assert.ok(
    shared.includes("THE STYLE'S KIT MODULES") &&
      shared.includes("build the scene FROM these helpers (the characters, ground, marks and the final paper pass); do not redraw them from scratch; for a style with no separate kit, build from the plate's own helpers"),
    `${name}: shared prompt includes the kit modules wording`
  );
  assert.ok(!shared.includes("use these exact exported helpers and types"), `${name}: old kit sentence is gone`);
  assert.ok(shared.includes(CHARACTER_RULE_BLOCK), `${name}: shared prompt includes CHARACTER_RULE_BLOCK`);

  const exampleIdx = shared.indexOf("<example");
  assert.ok(exampleIdx > 0, `${name}: shared prompt includes <example...> block`);
  assert.ok(
    shared.indexOf("</plate>") < shared.indexOf(CHARACTER_RULE_BLOCK) &&
      shared.indexOf(CHARACTER_RULE_BLOCK) < exampleIdx,
    `${name}: CHARACTER_RULE_BLOCK sits after plate/kit and before <example>`
  );

  if (name === "paintedOil") {
    assert.ok(
      shared.includes(`STYLE GUIDE (advisory: a helper, not a hard rule; the plate source is the recipe):\n<guide name="paintedOil">\n${activePaintedOilGuide.body}\n</guide>`),
      "paintedOil prompt contains the paintedOil guide block"
    );
    assert.ok(msg.system.includes("Keep the module COMPACT, under about 320 lines:"), "paintedOil uses 320-line heavy tier in contract");
    assert.ok(shared.includes('<example name="paintedOil">'), "paintedOil uses its template scene excerpt");
  } else {
    assert.ok(!shared.includes("STYLE GUIDE"), `${name}: prompt contains NO STYLE GUIDE heading`);
    assert.ok(!shared.includes("<guide"), `${name}: prompt contains NO <guide> tag`);
    assert.ok(msg.system.includes(OLD_220_LINE_CONTRACT_SENTENCE), `${name}: prompt uses the OLD 220-line contract wording`);
    assert.ok(shared.includes("<example>\n"), `${name}: prompt uses crayon worked-example.txt`);
  }

  const kits = kitModulesFor(name);
  const totalKitChars = kits.reduce((acc, k) => acc + k.source.length, 0);
  assert.ok(totalKitChars <= KIT_BUDGET_CHARS, `${name}: total kit chars ${totalKitChars} <= ${KIT_BUDGET_CHARS}`);
  for (const k of kits) {
    assert.ok(shared.includes(`<kit name="${k.name}">\n${k.source}\n</kit>`), `${name}: prompt includes full kit module ${k.name}`);
  }
}

// Explicit check for folkTale, wren, scrapbook as required by brief:
for (const unguidedStyle of ["folkTale", "wren", "scrapbook"]) {
  const msg = await buildAuthorMessages({
    look: lookForPlateName(unguidedStyle),
    plateName: unguidedStyle,
    film: "How money evolves from village barter to modern exchange.",
    beats: sampleBeats,
    aspect: "16:9",
    index: 0,
    frames: 120
  });
  const shared = msg.messages[0].content[0].text;
  assert.ok(!shared.includes("<guide") && !shared.includes("STYLE GUIDE"), `${unguidedStyle}: NO guide block`);
  assert.ok(shared.includes(CHARACTER_RULE_BLOCK), `${unguidedStyle}: contains character rule`);
  assert.ok(msg.system.includes(OLD_220_LINE_CONTRACT_SENTENCE), `${unguidedStyle}: uses OLD 220-line contract wording`);
  for (const k of kitModulesFor(unguidedStyle)) {
    assert.ok(shared.includes(`<kit name="${k.name}">\n${k.source}\n</kit>`), `${unguidedStyle}: contains kit module ${k.name}`);
  }
}

// 6. Over-budget kitModulesForPrompt test (> 150,000 chars fallback): complete API + referenced helper bodies + /* body omitted: name */
const ftKits = kitModulesFor("folkTale");
const rawFtPlate = readFileSync(plateFile("folkTale"), "utf8");
const shrunkFtKits = kitModulesForPrompt(ftKits, rawFtPlate, 25_000);
assert.equal(shrunkFtKits.length, 2);
for (const entry of shrunkFtKits) {
  assert.ok(!entry.text.includes("truncated"), `shrunk kit ${entry.name} has no truncated marker`);
  const bal = hasBalancedDelimiters(entry.text);
  assert.ok(bal.ok, `shrunk kit ${entry.name} has balanced delimiters: ${bal.reason ?? ""}`);
  const orig = ftKits.find((k) => k.name === entry.name);
  for (const sym of orig.exportedNames) {
    assert.match(entry.text, new RegExp(`\\b${sym}\\b`), `shrunk kit ${entry.name} retains exported signature "${sym}"`);
  }
}
assert.ok(
  shrunkFtKits.some((e) => e.text.includes("/* body omitted:")),
  "over-budget kitModulesForPrompt marks omitted bodies with /* body omitted: name */"
);

// 7. A/B switch: PLATE_STYLE_GUIDES=off makes buildAuthorMessages and promptDigest behave identically to pre-guide v3 for every style (incl. folkTale and balloon)
assert.equal(styleGuidesEnabled(), true, "styleGuidesEnabled() defaults to true");
const prevSwitch = process.env.PLATE_STYLE_GUIDES;
try {
  process.env.PLATE_STYLE_GUIDES = "off";
  assert.equal(styleGuidesEnabled(), false, "styleGuidesEnabled() is false when PLATE_STYLE_GUIDES=off");
  for (const name of styleNames) {
    assert.equal(await loadGuide(name), null, `loadGuide(${name}) is null when PLATE_STYLE_GUIDES=off`);
    assert.equal(
      await promptDigest(name),
      OLD_GLOBAL_PROMPT_DIGEST,
      `promptDigest(${name}) returns v3 digest ${OLD_GLOBAL_PROMPT_DIGEST} when PLATE_STYLE_GUIDES=off`
    );
  }
  const switchedOffCrayonMsg = await buildAuthorMessages(oldFixture.crayonReq);
  assert.deepEqual(switchedOffCrayonMsg, oldFixture.crayon, "crayon buildAuthorMessages with PLATE_STYLE_GUIDES=off is deeply identical to old fixture");

  const switchedOffFtMsg = await buildAuthorMessages(oldFixture.folkTaleReq);
  assert.deepEqual(switchedOffFtMsg, oldFixture.folkTale, "folkTale buildAuthorMessages with PLATE_STYLE_GUIDES=off is deeply identical to old fixture");
} finally {
  if (prevSwitch === undefined) delete process.env.PLATE_STYLE_GUIDES;
  else process.env.PLATE_STYLE_GUIDES = prevSwitch;
}
assert.equal(styleGuidesEnabled(), true, "styleGuidesEnabled() restored to true");

// 8. Dry-run harness (ab-scene.mjs without --live): writes prompt-<mode>.txt and returns size/digest summary
const tmpAbDir = mkdtempSync(join(tmpdir(), "ab-scene-test-"));
try {
  const dryOld = await runAbScene({
    look: "illus-folk-tale",
    beat: "Barter|A boy trades a rooster for a sack of grain.",
    frames: 150,
    aspect: "16:9",
    mode: "old",
    out: tmpAbDir,
    live: false
  });
  const dryNew = await runAbScene({
    look: "illus-folk-tale",
    beat: "Barter|A boy trades a rooster for a sack of grain.",
    frames: 150,
    aspect: "16:9",
    mode: "new",
    out: tmpAbDir,
    live: false
  });
  assert.equal(dryOld.mode, "old");
  assert.equal(dryOld.digest, OLD_GLOBAL_PROMPT_DIGEST);
  assert.ok(existsSync(join(tmpAbDir, "prompt-old.txt")), "prompt-old.txt written");
  assert.equal(dryNew.mode, "new");
  assert.notEqual(dryNew.digest, OLD_GLOBAL_PROMPT_DIGEST);
  assert.ok(existsSync(join(tmpAbDir, "prompt-new.txt")), "prompt-new.txt written");
  assert.ok(dryNew.promptChars > dryOld.promptChars, "new folk-tale prompt (full kits + plate + rule) is larger than truncated old prompt");
  const promptNewText = readFileSync(join(tmpAbDir, "prompt-new.txt"), "utf8");
  assert.ok(promptNewText.includes("<kit name=\"folkTaleKit\">") && promptNewText.includes("<kit name=\"sumiEKit\">"), "prompt-new.txt contains both folkTaleKit and sumiEKit");
  assert.ok(!promptNewText.includes("/* ...truncated... */"), "prompt-new.txt has no truncations");
  const promptOldText = readFileSync(join(tmpAbDir, "prompt-old.txt"), "utf8");
  assert.ok(promptOldText.includes("/* ...truncated... */"), "prompt-old.txt has old 30k/15k truncations");
} finally {
  rmSync(tmpAbDir, { recursive: true, force: true });
}

// 9. Size report helper covers all 31 styles and checkKitUse constants
const sizeRows = await computePromptSizes();
assert.equal(sizeRows.length, 31, "size report has 31 rows");
assert.equal(MIN_KIT_HELPERS, 3);
assert.equal(KIT_REPAIR_MAX, 1);
assert.equal(checkKitUse("folkTale", "export const film = {};").ok, false);

console.log(`style prompts: ok (${guideFiles.length} parked guide(s), ${checkedKits} kits, ${styleNames.length} plates verified)`);
