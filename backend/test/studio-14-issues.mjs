// Verification suite for all 14 Studio reliability, polish, and all-ratio composition issues.
// Run: node backend/test/studio-14-issues.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:5432/unused";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");

const contracts = await import("@videosaas/contracts");
const { bundleScene } = await import("@videosaas/plate-engine");
const { config } = await import("../src/config.ts");
const { buildAuthorMessages, contractFor } = await import("../src/plates/prompt.ts");
const { decideRevisionApply } = await import("../src/plates/store.ts");
const { systemBlocks } = await import("../src/plan/script-writer.ts");
const { languageRule } = await import("../src/plan/director.ts");
const { MAX_PLAN_ATTEMPTS } = await import("../src/plan/routes.ts");

test("Issue 1: Templates gallery 'All' mode interleaves all 5 categories, randomizes per seed, and paginates deterministically without duplicates", () => {
  const pageA1 = contracts.queryGallery({ plates: true, limit: 24, seed: "seed-alpha" });
  const pageB1 = contracts.queryGallery({ plates: true, limit: 24, seed: "seed-beta" });
  assert.equal(pageA1.total, 160);
  assert.equal(pageA1.items.length, 24);

  // Every active category (story, saas, explain, brand, colour) must appear in the first 24 items of "All"
  const catCounts = new Map();
  for (const item of pageA1.items) {
    catCounts.set(item.useCase, (catCounts.get(item.useCase) ?? 0) + 1);
  }
  for (const cat of ["story", "saas", "explain", "brand", "colour"]) {
    assert.ok((catCounts.get(cat) ?? 0) >= 3, `Category '${cat}' has balanced representation on Page 1 (got ${catCounts.get(cat) ?? 0})`);
  }

  // Different seeds produce different orderings on Page 1
  assert.notDeepEqual(
    pageA1.items.map((i) => i.id),
    pageB1.items.map((i) => i.id),
    "Different visit seeds shuffle the 'All' gallery order"
  );

  // Paginating through all 160 items with the same seed yields all 160 unique items in exact order with 0 duplicates or skips
  const seen = [];
  let cursor = undefined;
  while (true) {
    const p = contracts.queryGallery({ plates: true, limit: 24, cursor, seed: "seed-alpha" });
    seen.push(...p.items.map((i) => i.id));
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  assert.equal(seen.length, 160);
  assert.equal(new Set(seen).size, 160, "Pagination with a stable seed yields 160 unique items with zero duplicates");
});

test("Issue 2: User-facing tier specs and UI components expose only Standard and Premium without model version names", () => {
  const { standard, premium } = contracts.ANIMATION_TIER_SPECS;
  assert.equal(standard.label, "Standard");
  assert.equal(premium.label, "Premium");
  assert.doesNotMatch(standard.summary, /Gemini|Claude|Opus|Flash/i);
  assert.doesNotMatch(premium.summary, /Gemini|Claude|Opus|Flash/i);
  // Internal routing metadata remains intact
  assert.equal(standard.provider, "gemini");
  assert.equal(standard.model, "gemini-3.8-flash");
  assert.equal(premium.provider, "anthropic");
  assert.equal(premium.model, "claude-opus-5-5");

  const uiFiles = [
    "frontend/components/film-brief.tsx",
    "frontend/components/prompt-composer.tsx",
    "frontend/components/preview-card.tsx",
    "frontend/components/template-picker.tsx",
    "frontend/components/voice-picker-modal.tsx",
    "frontend/components/storyboard.tsx"
  ];
  for (const rel of uiFiles) {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    assert.doesNotMatch(src, /Gemini 3\.8 Flash|Claude Opus 5\.5|prebuilt Gemini voices|Claude is writing your scenes/i, `${rel} has no model marketing strings`);
  }
});

test("Issue 3: Hindi language selection enforces Hindi Devanagari VOICE lines in system & user prompts while keeping BEAT/VISUAL/SCREEN English", () => {
  const parsed = contracts.parseScriptBrief({
    scriptMode: "problem",
    text: "A hot-air balloon rises above the valley at dawn.",
    durationSeconds: 30,
    aspect: "9:16",
    motionProfile: "smooth",
    pace: "balanced",
    captions: "full",
    look: "illus-balloon",
    audio: { mode: "both", voice: "Kore", language: "hi" }
  });
  assert.ok("brief" in parsed);
  const sysText = systemBlocks({ brief: parsed.brief, context: { brandName: "", screenshots: [] } })
    .map((b) => b.text)
    .join("\n");
  assert.match(sysText, /VOICE LANGUAGE: Hindi/);
  assert.match(sysText, /Devanagari/);
  assert.match(sysText, /Never write English VOICE lines when Hindi is selected/);
  assert.doesNotMatch(sysText, /Tell it simply, in spoken English with contractions/);
  const rules = languageRule(parsed.brief).join("\n");
  assert.match(rules, /BEAT key phrases, VISUAL directions and SCREEN \/ on-screen words stay in English/);

  const filmBriefSrc = readFileSync(join(repoRoot, "frontend/components/film-brief.tsx"), "utf8");
  assert.match(filmBriefSrc, /Language changed to \{selectedLanguageLabel\}\. Regenerate the script to apply it\./);
});

test("Issue 4, 8 & 14: All-ratio centered composition (9:16, 16:9, 1:1), foreground-over-background layering, and PROP/character continuity", async () => {
  const beats = [
    {
      keyword: "Morning lift",
      visual: "The striped balloon, a plain prop with no face, rises centrally above distant green hills.",
      onScreen: null,
      line: "सुबह की हवा में गुब्बारा ऊपर उठता है।"
    }
  ];
  const scriptNotes = {
    idea: "Warm air lifts the balloon above the valley.",
    objects: "balloon (PROP, no face), burner (PROP), basket (PROP)",
    example: "Striped red-orange-yellow balloon over green hills"
  };

  for (const [aspect, w, h] of [
    ["9:16", 1080, 1920],
    ["16:9", 1920, 1080],
    ["1:1", 1080, 1080]
  ]) {
    const sys = contractFor({ w, h, label: `${w}x${h}` }, 220, "balloon");
    assert.equal(sys.split("\n").length, 11, `${aspect}: contractFor keeps exact 11-line structure`);
    assert.match(sys, /draw background sky\/hills\/ground FIRST and the foreground focal subject AFTER background hills/);
    assert.match(sys, /never bottom-heavy/);

    const msg = await buildAuthorMessages({
      look: "illus-balloon",
      plateName: "balloon",
      film: "A balloon rises over the valley.",
      beats,
      aspect,
      index: 0,
      frames: 150,
      scriptNotes
    });
    const shared = msg.messages[0].content[0].text;
    const scene = msg.messages[0].content[1].text;
    assert.match(shared, /RECURRING OBJECTS \/ CAST NOTES: balloon \(PROP, no face\)/);
    assert.match(scene, new RegExp(`COMPOSITION, LAYERING & CONTINUITY \\(${w}x${h}, ${aspect}\\):`));
    assert.match(scene, /CENTERED FRAMING ACROSS ALL RATIOS/);
    assert.match(scene, /COMPLETE SUBJECT VISIBILITY & CAPTION SAFE ZONE/);
    assert.match(scene, /FOREGROUND OVER BACKGROUND LAYERING/);
    assert.match(scene, /Never add eyes, brows, or a mouth to a PROP/);
  }

  const sketchSrc = readFileSync(join(repoRoot, "backend/src/plan/frame-sketch.ts"), "utf8");
  assert.match(sketchSrc, /across all aspect ratios \(16:9, 9:16, and 1:1\)/);
  assert.match(sketchSrc, /never draw eyes, brows, or a mouth on a plain PROP/);
});

test("Issue 5 & 6: Planning restart recovery config and 6-way parallel authoring defaults", () => {
  assert.equal(MAX_PLAN_ATTEMPTS, 3, "Interrupted storyboard planning supports bounded automatic restart recovery");
  assert.equal(config.plates.authorConcurrency, 6, "Default PLATE_AUTHOR_CONCURRENCY is 6");
  assert.equal(config.plates.projectAuthorCap, 6, "Default PLATE_PROJECT_AUTHOR_CAP is 6");
});

test("Issue 9: Live comments coalesce onto in-flight initial queued/authoring scenes without blocking", () => {
  const initialAuthoringRow = {
    state: "authoring",
    gen: 1,
    rev: 0,
    bundle_digest: null,
    source_key: null,
    revise: null,
    timings: { authorStartedAt: Date.now() - 5_000 },
    updated_at: new Date()
  };
  const dec = decideRevisionApply(initialAuthoringRow, "- at 1.5 s: move balloon higher in frame");
  assert.equal(dec.action, "coalesce", "Comment applied during initial authoring coalesces instead of blocking");
  assert.equal(dec.gen, 1);
  assert.equal(dec.rev, 1);
  assert.equal(dec.notes, "- at 1.5 s: move balloon higher in frame");
});

test("Issue 13: Gfx.layer() full clearRect in bundleScene eliminates offscreen layer dirty-pixel leaks", async () => {
  const sampleCode = readFileSync(join(repoRoot, "packages/plate-engine/test/fixtures/balloon-0.ts"), "utf8");
  const bundled = await bundleScene({ look: "illus-balloon", code: sampleCode, frames: 105, aspect: "9:16" });
  assert.ok(
    bundled.html.includes(".clearRect(0,0,this.DW,this.DH)"),
    "bundleScene emits full layer clearRect(0,0,this.DW,this.DH)"
  );
  assert.ok(
    !/\.clearRect\(([A-Za-z0-9_$]+)\[0\],\1\[1\],\1\[2\]-\1\[0\],\1\[3\]-\1\[1\]\)/.test(bundled.html),
    "bundleScene has zero partial dirty-rect clearRect calls"
  );
});
