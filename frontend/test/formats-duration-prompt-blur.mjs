import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import {
  aspects,
  beatCountRange,
  beatPlanProblems,
  briefAspects,
  defaultScriptBrief as defaultBrief,
  DURATION_MIN,
  durationPresets,
  effectiveBriefDurationSeconds,
  findGalleryTemplate,
  formatDurationSeconds,
  galleryBrief,
  galleryTemplates,
  isScriptLedDuration,
  motionBlurProblem,
  normalizeAspects,
  parseScriptBeats,
  parseScriptBrief,
  parseScriptStream,
  renderCostMillitokens,
  resolveDurationMode,
  resolvePrimaryAspect,
  scriptSeconds,
  toggleBriefAspect,
  tokensFromMilli
} from "@videosaas/contracts";
import { buildPlateFinalRatios } from "../components/animation-workspace/logic.ts";

process.env.APP_ENV = "local";
process.env.PLANNER = "deterministic";
process.env.DATABASE_URL ??= "postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit";

const { lengthRule, insertSceneMessages } = await import("../../backend/src/plan/script-writer.ts");
const { DeterministicDirector, toPlan, userMessage } = await import("../../backend/src/plan/director.ts");
const { scriptMessage } = await import("../../backend/src/plan/script-draft.ts");
const { planTiming } = await import("../../backend/src/plan/timing.ts");
const { planReadiness } = await import("../../backend/src/plan/readiness.ts");
const { soundTracks } = await import("../../backend/src/plan/sound.ts");
const { quoteFrom } = await import("../../backend/src/render/quote.ts");
const { defaultSubtitlesFor } = await import("../../backend/src/plates/model.ts");
const { wantedAspects } = await import("../../backend/src/plates/inputs.ts");
const { reconcileProjectAfterSceneInsert, reconcileProjectAfterSceneRemove } = await import("../../backend/src/plan/routes.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCREENSHOT_DIR = join(REPO_ROOT, "docs/handoff/screenshots/formats-duration-prompt-blur");

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8")
].join("\n");

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#121824"/><circle cx="320" cy="180" r="88" fill="#168bff" opacity="0.35"/><text x="320" y="190" text-anchor="middle" fill="#eef2f8" font-family="sans-serif" font-size="26" font-weight="700">Scene frame</text></svg>`;

const EIGHT_BEATS = [
  { id: "sb-1", keyword: "Barter cows", visual: "A cartoon farmer trading a cow for grain sacks.", onScreen: "Trade what you have", line: "Long before coins or cards existed, you traded whatever you carried in your hands." },
  { id: "sb-2", keyword: "Shells and salt", visual: "Hands swapping cowrie shells and salt bars across a counter.", onScreen: "Lighter tokens", line: "Soon communities agreed on portable tokens like cowrie shells and carved bars of salt." },
  { id: "sb-3", keyword: "Stamped coins", visual: "An anvil stamping a roaring lion onto an electrum coin.", onScreen: "Trusted weight", line: "In Lydia, kings stamped royal lions onto metal so every coin weighed the same." },
  { id: "sb-4", keyword: "Paper receipts", visual: "A merchant locking heavy chests of gold in a vault for a paper note.", onScreen: "Vault receipts", line: "Carrying heavy gold grew risky, so merchants locked gold away and traded paper receipts." },
  { id: "sb-5", keyword: "Central reserves", visual: "A central bank vault stamping official seals onto banknotes.", onScreen: "Backed by law", line: "Governments backed those paper promises by law, creating national currencies trusted across borders." },
  { id: "sb-6", keyword: "Telegraph wire", visual: "Glowing numbers racing through an undersea telegraph cable.", onScreen: "Wire transfer", line: "By the nineteenth century, telegraph cables flashed balances across oceans without a coin moving." },
  { id: "sb-7", keyword: "Plastic ledgers", visual: "A card swiping through a terminal as digital ledger numbers update.", onScreen: "Invisible numbers", line: "Plastic cards and bank computers turned money into pure information moving at light speed." },
  { id: "sb-8", keyword: "Shared trust", visual: "Two characters tapping phones together with a warm chime of light.", onScreen: "Human trust", line: "From cows to code, money remains the same invention: a shared story of human trust." }
];

test("Part 2: Multi-format selection, normalization, primary continuity, legacy hydration, and per-ratio outputs", () => {
  const baseBrief = {
    scriptMode: "problem",
    text: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
    durationSeconds: 30,
    pace: "balanced",
    aspect: "16:9",
    motionProfile: "smooth",
    captions: "key-phrases",
    audio: { mode: "both", voice: "Kore" }
  };

  // 1. Legacy hydration: absent aspects treated as [brief.aspect]
  const legacyParsed = parseScriptBrief({ ...baseBrief, aspect: "9:16" });
  assert.ok("brief" in legacyParsed);
  assert.equal(legacyParsed.brief.aspect, "9:16");
  assert.equal(legacyParsed.brief.aspects, undefined, "omitted input aspects stays omitted on raw brief");
  assert.deepEqual(briefAspects(legacyParsed.brief), ["9:16"], "briefAspects hydrates legacy absent aspects as [aspect]");

  // 2. Selecting multiple formats: 16:9 -> +9:16 -> +1:1 (all 3)
  let state = { aspect: "16:9", aspects: undefined };
  state = toggleBriefAspect(state, "9:16");
  assert.deepEqual(state, { aspect: "16:9", aspects: ["16:9", "9:16"] }, "adding 9:16 keeps 16:9 as primary");
  state = toggleBriefAspect(state, "1:1");
  assert.deepEqual(state, { aspect: "16:9", aspects: ["16:9", "9:16", "1:1"] }, "adding 1:1 selects all 3 in canonical order");

  // 3. Deselecting non-primary keeps current primary
  state = toggleBriefAspect(state, "9:16");
  assert.deepEqual(state, { aspect: "16:9", aspects: ["16:9", "1:1"] }, "deselecting 9:16 preserves 16:9 primary");

  // 4. Deselecting current primary picks deterministic remaining primary
  state = toggleBriefAspect(state, "16:9");
  assert.deepEqual(state, { aspect: "1:1", aspects: ["1:1"] }, "deselecting primary 16:9 promotes remaining 1:1 to primary");

  // 5. Cannot deselect last remaining format
  const afterLastClick = toggleBriefAspect(state, "1:1");
  assert.deepEqual(afterLastClick, { aspect: "1:1", aspects: ["1:1"] }, "clicking last remaining format does not deselect it");

  // 6. Adding 16:9 and 9:16 when 1:1 is primary preserves 1:1 as primary!
  state = toggleBriefAspect(state, "9:16");
  assert.deepEqual(state, { aspect: "1:1", aspects: ["9:16", "1:1"] }, "primary stays 1:1 when 9:16 is added");
  state = toggleBriefAspect(state, "16:9");
  assert.deepEqual(state, { aspect: "1:1", aspects: ["16:9", "9:16", "1:1"] }, "primary stays 1:1 when 16:9 is added");

  // 7. parseScriptBrief normalizes duplicates/order, preserves valid primary, and rejects empty aspects
  const normalized = parseScriptBrief({
    ...baseBrief,
    aspect: "9:16",
    aspects: ["1:1", "9:16", "1:1", "16:9"]
  });
  assert.ok("brief" in normalized);
  assert.equal(normalized.brief.aspect, "9:16", "parseScriptBrief preserves 9:16 as primary when included in aspects");
  assert.deepEqual(normalized.brief.aspects, ["16:9", "9:16", "1:1"], "parseScriptBrief deduplicates and orders aspects canonically");

  const fallbackPrimary = parseScriptBrief({
    ...baseBrief,
    aspect: "16:9",
    aspects: ["9:16", "1:1"]
  });
  assert.ok("brief" in fallbackPrimary);
  assert.equal(fallbackPrimary.brief.aspect, "9:16", "when aspect is not in aspects, deterministic first selected aspect wins");

  const emptyAspects = parseScriptBrief({ ...baseBrief, aspects: [] });
  assert.ok("error" in emptyAspects, "empty aspects array is rejected");

  // 8. Plate pipeline wiring: defaultSubtitlesFor, wantedAspects, and buildPlateFinalRatios
  const mockProject = {
    id: "316f1cbd-b5b9-49af-ae3b-2add10a18ed5",
    name: "Multi-format film",
    state: "Ready for review",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    request: { prompt: baseBrief.text, format: "portrait", style: "clean", theme: "neutral", template: "product-pulse" },
    brief: { ...normalized.brief, look: "illus-rubber-hose" },
    screenshots: [],
    comments: []
  };
  const subs = defaultSubtitlesFor(mockProject);
  assert.deepEqual(subs.aspects, ["9:16", "16:9", "1:1"], "defaultSubtitlesFor places primary first followed by other selected formats");
  assert.deepEqual(wantedAspects(mockProject, mockProject.brief.aspects), ["9:16", "16:9", "1:1"]);

  // Verify buildPlateFinalRatios never fakes an unready format with the primary URL
  const finalRatios = buildPlateFinalRatios(
    mockProject.id,
    "9:16",
    ["9:16", "16:9", "1:1"],
    "/v1/renders/job-primary.mp4",
    {
      "16:9": { state: "ready", progress: 100 },
      "1:1": { state: "assembling", progress: 64 }
    },
    (ratio) => `/v1/projects/${mockProject.id}/plates/export/${ratio.replace(":", "-")}`
  );
  assert.equal(finalRatios.length, 3);
  assert.equal(finalRatios[0].id, "9:16");
  assert.equal(finalRatios[0].status, "ready");
  assert.equal(finalRatios[0].url, "/v1/renders/job-primary.mp4");
  assert.equal(finalRatios[1].id, "16:9");
  assert.equal(finalRatios[1].status, "ready");
  assert.equal(finalRatios[1].url, `/v1/projects/${mockProject.id}/plates/export/16-9`, "ready companion format uses its own dedicated export URL");
  assert.notEqual(finalRatios[1].url, finalRatios[0].url, "companion format never reuses primary URL");
  assert.equal(finalRatios[2].id, "1:1");
  assert.equal(finalRatios[2].status, "preparing");
  assert.equal(finalRatios[2].url, null, "preparing format has null URL until its own export is ready");
});

test("Part 3: Script-led default, legacy mode handling, uncapped >120s (180s, 240s, 600s) durations, writer/director/timing/readiness/quotes/sound", async () => {
  const baseBrief = {
    scriptMode: "problem",
    text: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
    durationSeconds: 30,
    pace: "balanced",
    aspect: "16:9",
    motionProfile: "smooth",
    captions: "key-phrases",
    audio: { mode: "both", voice: "Kore" }
  };

  // 1. Default mode: defaultBrief, galleryBrief template starts, and un-locked legacy preset briefs default to "script" ("Let script decide")
  assert.equal(defaultBrief.durationMode, "script", "defaultBrief defaults to durationMode: 'script'");
  assert.equal(resolveDurationMode(defaultBrief), "script");
  assert.equal(isScriptLedDuration(defaultBrief), true);

  for (const tplId of ["story-illus-rubber-hose", "product-launch", "feature-walkthrough", "sketch-explainer"]) {
    const tpl = findGalleryTemplate(tplId);
    assert.ok(tpl, `template ${tplId} exists`);
    const gBrief = galleryBrief(tpl);
    assert.equal(gBrief.durationMode, "script", `template ${tplId} start defaults to durationMode: 'script'`);
    assert.equal(resolveDurationMode(gBrief), "script");
    assert.equal(isScriptLedDuration(gBrief), true);
    assert.equal(gBrief.durationSeconds, tpl.durationSeconds, "template durationSeconds is kept as numeric fallback");
  }

  // Legacy briefs without durationMode:
  // - Default preset durationSeconds (30, 45) without lockDuration/keepOverLength -> defaults to "script"
  assert.equal(resolveDurationMode({ durationSeconds: 30 }), "script");
  assert.equal(resolveDurationMode({ durationSeconds: 45 }), "script");
  assert.equal(isScriptLedDuration({ durationSeconds: 30 }), true);
  // - Legacy brief with lockDuration: true or keepOverLength: true on preset -> preserves "preset"
  assert.equal(resolveDurationMode({ durationSeconds: 30, lockDuration: true }), "preset");
  assert.equal(resolveDurationMode({ durationSeconds: 30, keepOverLength: true }), "preset");
  assert.equal(isScriptLedDuration({ durationSeconds: 30, lockDuration: true }), false);
  // - Legacy brief with non-preset durationSeconds (25, 180, 240) -> preserves "custom"
  assert.equal(resolveDurationMode({ durationSeconds: 25 }), "custom");
  assert.equal(resolveDurationMode({ durationSeconds: 240 }), "custom");
  assert.equal(isScriptLedDuration({ durationSeconds: 25 }), false);
  // - Explicit saved durationMode ("preset", "custom", "script") is always preserved
  assert.equal(resolveDurationMode({ durationSeconds: 30, durationMode: "preset" }), "preset");
  assert.equal(resolveDurationMode({ durationSeconds: 30, durationMode: "custom" }), "custom");
  assert.equal(resolveDurationMode({ durationSeconds: 30, durationMode: "script" }), "script");
  assert.equal(isScriptLedDuration({ durationSeconds: 30, durationMode: "preset" }), false);
  assert.equal(isScriptLedDuration({ durationSeconds: 30, durationMode: "custom" }), false);

  // Readable duration formatting helper
  assert.equal(formatDurationSeconds(45), "45s");
  assert.equal(formatDurationSeconds(120), "2m (120s)");
  assert.equal(formatDurationSeconds(150), "2m 30s (150s)");
  assert.equal(formatDurationSeconds(240), "4m (240s)");
  assert.equal(formatDurationSeconds(600), "10m (600s)");

  // 2. Uncapped custom & script-led duration validation: 25s, 180s, 240s, 600s accepted; <5s, 0, negative, NaN, Infinity rejected
  for (const validSec of [5, 25, 150, 180, 240, 600, 1200]) {
    const parsedCustom = parseScriptBrief({ ...baseBrief, durationMode: "custom", durationSeconds: validSec });
    assert.ok("brief" in parsedCustom, `custom duration ${validSec}s is accepted`);
    assert.equal(parsedCustom.brief.durationMode, "custom");
    assert.equal(parsedCustom.brief.durationSeconds, validSec, `durationSeconds=${validSec} preserved without clamping`);
    assert.equal(effectiveBriefDurationSeconds(parsedCustom.brief), validSec);
  }

  for (const badSec of [3, 0, -10, NaN, Infinity, -Infinity, "240"]) {
    const rejected = parseScriptBrief({ ...baseBrief, durationMode: "custom", durationSeconds: badSec });
    assert.ok("error" in rejected, `invalid duration ${String(badSec)} is rejected`);
  }

  // 3. Script-led mode validation: preserves last target (including >120s like 240s), clears lockDuration, never uses 0/NaN/Infinity
  const scriptLed = parseScriptBrief({
    ...baseBrief,
    durationSeconds: 45,
    durationMode: "script",
    lockDuration: true
  });
  assert.ok("brief" in scriptLed);
  assert.equal(scriptLed.brief.durationMode, "script");
  assert.equal(scriptLed.brief.durationSeconds, 45, "preserves last numeric target choice for mode switching");
  assert.equal(scriptLed.brief.lockDuration, undefined, "script-led mode never sets lockDuration: true");
  assert.ok(isScriptLedDuration(scriptLed.brief));

  const scriptLedWith240Fallback = parseScriptBrief({
    ...baseBrief,
    durationSeconds: 240,
    durationMode: "script"
  });
  assert.ok("brief" in scriptLedWith240Fallback);
  assert.equal(scriptLedWith240Fallback.brief.durationSeconds, 240, "script-led mode preserves 240s numeric fallback without clamping to 30 or 120");

  // 4. Writer & Director instructions in script-led mode and >120s custom mode have NO 120s ceiling or 16-beat cap
  const context = { brandName: "", screenshots: [], productNamed: false };
  const rule = lengthRule(scriptLed.brief);
  assert.match(rule, /LENGTH IS SCRIPT-LED/i);
  assert.doesNotMatch(rule, /120s/i, "lengthRule has no 120s cap");
  assert.doesNotMatch(rule, /16 beats/i, "lengthRule has no 16-beat cap");
  assert.doesNotMatch(rule, /45s is a target/i);

  const uMsg = userMessage(scriptLed.brief, context);
  assert.match(uMsg, /Duration: script-led/i);
  assert.doesNotMatch(uMsg, /120s/i, "director userMessage has no 120s cap");
  assert.doesNotMatch(uMsg, /Duration: 45s/i);

  const sMsg = scriptMessage(scriptLed.brief, context);
  assert.match(sMsg, /Length: script-led/i);
  assert.doesNotMatch(sMsg, /120s/i, "script-draft scriptMessage has no 120s cap");

  // beatCountRange scales properly for 240s and 600s without min > max inversion
  const range240 = beatCountRange(240, "balanced");
  assert.ok(range240.min >= 35 && range240.max >= range240.min, `240s beatCountRange is valid (${range240.min}..${range240.max})`);
  const range600 = beatCountRange(600, "balanced");
  assert.ok(range600.min >= 80 && range600.max >= range600.min, `600s beatCountRange is valid (${range600.min}..${range600.max})`);

  const insertMsgs = insertSceneMessages({
    brief: scriptLed.brief,
    context,
    previous: EIGHT_BEATS.slice(0, 3),
    position: 1,
    prompt: "Show merchants weighing gold dust on a brass scale"
  });
  assert.match(insertMsgs[0].content, /script-led/i);
  assert.doesNotMatch(insertMsgs[0].content, /beyond 45s/i);

  // 5. Once script beats exist, effective duration, BeatPlan, timing, readiness, and quote use actual script/measured duration
  const actualRuns = scriptSeconds(EIGHT_BEATS, "balanced"); // ~43s
  assert.ok(actualRuns > 35 && actualRuns !== 30, `8 beats run ~${actualRuns}s`);
  assert.equal(
    effectiveBriefDurationSeconds({ ...scriptLed.brief, durationSeconds: 15 }, EIGHT_BEATS),
    actualRuns,
    "effectiveBriefDurationSeconds uses actual script beats instead of stale 15s preset"
  );

  const detDirector = new DeterministicDirector();
  const directed = await detDirector.plan({ ...scriptLed.brief, durationSeconds: 15, scriptBeats: EIGHT_BEATS }, context);
  assert.equal(directed.plan.duration_mode, "script");
  assert.equal(directed.plan.target_duration_s, actualRuns, "BeatPlan target_duration_s reflects script's actual runtime");
  assert.equal(directed.plan.beats.length, EIGHT_BEATS.length);

  // Timing in script-led mode does not stretch/flex beats to an artificial preset target (e.g. 90s)
  const naturalTiming = planTiming(
    { ...directed.plan, target_duration_s: 90, duration_mode: "script" },
    { ...scriptLed.brief, durationSeconds: 90 }
  );
  const forced90Timing = planTiming(
    { ...directed.plan, target_duration_s: 90, duration_mode: undefined },
    { ...baseBrief, durationSeconds: 90, durationMode: "preset" }
  );
  assert.ok(
    forced90Timing.total > naturalTiming.total + 15,
    `script-led timing (${naturalTiming.total}s) runs at natural beat length instead of stretching toward 90s (${forced90Timing.total}s)`
  );

  // Readiness in script-led mode does NOT warn about off-target duration, and quotes from actual duration
  const projectWithScriptLed = {
    id: "316f1cbd-b5b9-49af-ae3b-2add10a18ed5",
    name: "Script-led project",
    state: "Ready for review",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    request: { prompt: baseBrief.text, format: "landscape", style: "clean", theme: "neutral", template: "product-pulse" },
    brief: { ...scriptLed.brief, durationSeconds: 15, audio: { mode: "none" }, scriptBeats: EIGHT_BEATS },
    beatPlan: { ...directed.plan, audio: { voice: null, music: null, captions: "key-phrases" }, target_duration_s: 15, duration_mode: "script" },
    screenshots: [],
    comments: []
  };
  const readiness = planReadiness(projectWithScriptLed);
  assert.equal(readiness.ok, true);
  assert.equal(
    readiness.warnings.some((w) => /chose .* as a target/i.test(w.message)),
    false,
    "script-led mode never emits off-target duration warning"
  );
  const quote = quoteFrom(readiness, { required: false, owedTokens: 0 }, 100);
  assert.equal(quote.seconds, Math.ceil(naturalTiming.total));
  assert.equal(quote.tokens, tokensFromMilli(renderCostMillitokens(Math.ceil(naturalTiming.total))));

  // 6. Scene insertion and removal in script-led mode updates target_duration_s from the updated beats
  const afterInsert = reconcileProjectAfterSceneInsert(projectWithScriptLed, {
    brief: projectWithScriptLed.brief,
    previousBeats: EIGHT_BEATS,
    position: 2,
    insertedBeat: {
      id: "sb-new",
      keyword: "Gold scales",
      visual: "A merchant weighing gold dust on a balance scale.",
      onScreen: "Weighing gold",
      line: "Before coins were stamped, merchants had to weigh gold dust on a delicate brass scale at every trade."
    }
  });
  assert.equal(afterInsert.beatPlan.beats.length, 9);
  assert.equal(afterInsert.beatPlan.duration_mode, "script");
  assert.equal(
    afterInsert.beatPlan.target_duration_s,
    scriptSeconds(afterInsert.brief.scriptBeats, projectWithScriptLed.brief.pace),
    "scene insertion in script-led mode updates target_duration_s to match the 9-beat script"
  );

  const afterRemove = reconcileProjectAfterSceneRemove(
    { ...projectWithScriptLed, brief: afterInsert.brief, beatPlan: afterInsert.beatPlan },
    { index: 2, brief: afterInsert.brief, beats: afterInsert.brief.scriptBeats }
  );
  assert.equal(afterRemove.patch.beatPlan.beats.length, 8);
  assert.equal(
    afterRemove.patch.beatPlan.target_duration_s,
    scriptSeconds(EIGHT_BEATS, projectWithScriptLed.brief.pace),
    "scene removal in script-led mode updates target_duration_s back to 8-beat runtime"
  );

  // 7. Longer >120s films (180s, 240s, 600s) pass stream/beat parsing, director, timing, readiness, quote, credit check, and sound looping without truncation!
  for (const targetLongSec of [240, 600]) {
    // Build a multi-minute script (~7.4s per beat at balanced pace: 32 beats ≈ 238s, 81 beats ≈ 600s)
    const beatCount = targetLongSec === 240 ? 32 : 81;
    const rawLongStream = Array.from({ length: beatCount }, (_, i) => [
      `BEAT: Chapter ${i + 1}`,
      `VISUAL: A cartoon scene illustrating step ${i + 1} of the monetary history.`,
      `SCREEN: Step ${i + 1}`,
      `VOICE: In chapter ${i + 1}, communities discovered a clearer way to record and settle every exchange across the marketplace.`
    ].join("\n")).join("\n\n");

    const streamed = parseScriptStream(rawLongStream);
    assert.equal(streamed.beats.length, beatCount, `parseScriptStream keeps all ${beatCount} beats for ~${targetLongSec}s script without 16-beat truncation`);
    const validatedBeats = parseScriptBeats(streamed.beats);
    assert.ok(validatedBeats && validatedBeats.length === beatCount, `parseScriptBeats accepts ${beatCount} beats`);

    const estSec = scriptSeconds(validatedBeats, "balanced");
    assert.ok(estSec > 120 && Math.abs(estSec - targetLongSec) < 25, `estimated scriptSeconds (${estSec}s) is >120s (~${targetLongSec}s)`);

    const longBriefParsed = parseScriptBrief({
      ...baseBrief,
      durationMode: "script",
      durationSeconds: targetLongSec,
      scriptBeats: validatedBeats
    });
    assert.ok("brief" in longBriefParsed, `parseScriptBrief accepts ${beatCount}-beat ~${targetLongSec}s brief`);
    assert.equal(effectiveBriefDurationSeconds(longBriefParsed.brief), estSec, `effectiveBriefDurationSeconds returns ${estSec}s without 120s clamp`);

    const longDirected = await detDirector.plan(longBriefParsed.brief, context);
    assert.deepEqual(beatPlanProblems(longDirected.plan, longBriefParsed.brief), [], `beatPlanProblems has 0 errors for ${beatCount}-beat plan`);
    assert.equal(longDirected.plan.beats.length, beatCount);
    assert.equal(longDirected.plan.target_duration_s, estSec);

    // Measured VO lines totaling exactly targetLongSec (240s or 600s)
    const perBeatVoSec = Number((targetLongSec / beatCount).toFixed(2));
    const longVoLines = longDirected.plan.beats.map((b, i) => ({
      beat: b.id,
      text: b.line || `Line ${i + 1}`,
      file: `vo/mock-${i + 1}.wav`,
      seconds: perBeatVoSec,
      words: [],
      aligned: "estimate"
    }));
    const longProject = {
      ...projectWithScriptLed,
      brief: longBriefParsed.brief,
      beatPlan: longDirected.plan,
      planAudio: {
        voice: { engine: "gemini-tts", model: "tts", voice: "Kore", direction: "warm", pace: "balanced", lines: longVoLines },
        music: { source: "lyria", model: "lyria-3-pro-preview", prompt: "warm", file: "music/bed.mp3", seconds: 90 },
        cost_usd: 0.25,
        updatedAt: "2026-11-08T00:00:00.000Z"
      }
    };
    const longReadiness = planReadiness(longProject);
    assert.equal(longReadiness.ok, true, `>${targetLongSec}s film (${longReadiness.durationSeconds}s) passes planReadiness without 120s rejection`);
    assert.ok((longReadiness.durationSeconds ?? 0) > targetLongSec * 0.9, `durationSeconds is ~${longReadiness.durationSeconds}s`);

    // Quote & real token credit checks for 240s and 600s
    const ceilSec = Math.ceil(longReadiness.durationSeconds);
    const expectedTokens = tokensFromMilli(renderCostMillitokens(ceilSec));
    const quoteShort = quoteFrom(longReadiness, { required: false, owedTokens: 0 }, 20);
    assert.equal(quoteShort.seconds, ceilSec);
    assert.equal(quoteShort.tokens, expectedTokens);
    assert.equal(quoteShort.enough, false, `20 tokens is insufficient for ${ceilSec}s film (${expectedTokens} tokens)`);

    const quoteEnough = quoteFrom(longReadiness, { required: false, owedTokens: 0 }, 500);
    assert.equal(quoteEnough.enough, true, `500 tokens covers ${ceilSec}s film (${expectedTokens} tokens)`);

    // Soundtrack loops 90s music bed across the full 240s / 600s timeline
    const longTiming = planTiming(longDirected.plan, longBriefParsed.brief, {
      lineSeconds: Object.fromEntries(longVoLines.map((l) => [l.beat, l.seconds]))
    });
    const { tracks } = soundTracks({
      plan: longDirected.plan,
      timing: longTiming,
      audio: longProject.planAudio,
      fileUrl: (f) => `audio/${f}`,
      sfxUrl: (n) => `sfx/${n}.mp3`,
      hasShot: () => false,
      mode: "both"
    });
    const musicTracks = tracks.filter((t) => t.id.startsWith("music-bed"));
    assert.ok(musicTracks.length >= Math.ceil(longTiming.total / 90), `music bed loops ${musicTracks.length} times to cover ${longTiming.total}s`);
    const lastMusicTrack = musicTracks.at(-1);
    assert.ok(
      Math.abs(lastMusicTrack.start + lastMusicTrack.duration - longTiming.total) < 0.05,
      `music bed reaches the end of the ${longTiming.total}s film`
    );

    // Genuine 20s motion-blur supersampling limit remains enforced when motionBlur is requested
    assert.match(motionBlurProblem(longReadiness.durationSeconds) ?? "", /up to 20 seconds/);
  }
});

test("Postgres projects/store.ts round-trip persistence for multi-format aspects and custom/script-led durationMode", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const script = `
    import assert from "node:assert/strict";
    import { randomUUID } from "node:crypto";
    process.env.APP_ENV = "local";
    process.env.PLANNER = "deterministic";
    process.env.DATABASE_URL = "postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit";
    const { defaultTemplateId, defaultThemeId, scriptSeconds } = await import("@videosaas/contracts");
    const { migrate, pool } = await import("./backend/src/db/database.ts");
    const { createProject, deleteProject, getProject, updateProject, updateProjectPlan } = await import("./backend/src/projects/store.ts");
    const { DeterministicDirector } = await import("./backend/src/plan/director.ts");

    await migrate();
    const ownerId = randomUUID();
    const beats = ${JSON.stringify(EIGHT_BEATS)};
    const request = {
      prompt: "Explain how money evolves from barter and shells to coins and digital ledgers.",
      format: "landscape",
      style: "clean",
      theme: defaultThemeId,
      template: defaultTemplateId,
      audio: { music: true, voiceover: true, voice: "Kore" }
    };
    const initialBrief = {
      scriptMode: "problem",
      text: "Explain how money evolves from barter and shells to coins and digital ledgers.",
      durationSeconds: 30,
      pace: "calm",
      aspect: "16:9",
      motionProfile: "smooth",
      captions: "key-phrases",
      audio: { mode: "both", voice: "Kore" },
      scriptBeats: beats
    };

    try {
      const p = await createProject({ name: "Formats & Duration Store Test", request }, ownerId);
      const dir = new DeterministicDirector();
      const directed = await dir.plan(initialBrief, { brandName: "", screenshots: [], productNamed: false });
      await updateProjectPlan(p.id, () => ({
        brief: initialBrief,
        beatPlan: directed.plan
      }));

      // Update brief with multi-format (9:16 primary + 16:9 + 1:1) and script-led duration
      const updated = await updateProject(p.id, {
        brief: {
          ...initialBrief,
          aspect: "9:16",
          aspects: ["16:9", "9:16", "1:1"],
          durationMode: "script",
          durationSeconds: 45
        }
      });
      assert.equal(updated.brief.aspect, "9:16", "primary aspect updated to 9:16");
      assert.deepEqual(updated.brief.aspects, ["16:9", "9:16", "1:1"], "all 3 aspects persisted");
      assert.equal(updated.brief.durationMode, "script", "script-led durationMode persisted");
      assert.equal(updated.brief.scriptBeats.length, 8, "existing scriptBeats preserved without rewriting");
      assert.equal(updated.request.format, "portrait", "request.format synced with 9:16 primary aspect");
      assert.equal(updated.beatPlan.canvas, "9:16", "beatPlan.canvas synced with 9:16 primary aspect");
      assert.equal(updated.beatPlan.duration_mode, "script", "beatPlan.duration_mode synced to script");
      assert.equal(updated.beatPlan.target_duration_s, scriptSeconds(beats, "calm"), "beatPlan.target_duration_s updated to actual script runtime");

      // Reload from DB
      const reloaded = await getProject(p.id);
      assert.equal(reloaded.brief.aspect, "9:16");
      assert.deepEqual(reloaded.brief.aspects, ["16:9", "9:16", "1:1"]);
      assert.equal(reloaded.brief.durationMode, "script");
      assert.equal(reloaded.beatPlan.duration_mode, "script");

      // Explicitly save custom 240s and 600s and preset 60s and verify persistence across reloads
      for (const [mode, sec] of [["custom", 240], ["custom", 600], ["preset", 60]]) {
        await updateProject(p.id, {
          brief: {
            ...reloaded.brief,
            durationMode: mode,
            durationSeconds: sec
          }
        });
        const r = await getProject(p.id);
        assert.equal(r.brief.durationMode, mode, \`persisted durationMode=\${mode}\`);
        assert.equal(r.brief.durationSeconds, sec, \`persisted durationSeconds=\${sec}\`);
        assert.equal(r.beatPlan.target_duration_s, sec, \`beatPlan.target_duration_s synced to \${sec}\`);
        assert.equal(r.beatPlan.duration_mode, undefined, \`beatPlan.duration_mode cleared when mode=\${mode}\`);
      }

      await deleteProject(p.id);
    } finally {
      await pool.query("delete from app.projects where owner_id = $1", [ownerId]);
      await pool.end();
    }
  `;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  if (res.status !== 0 && /ECONNREFUSED/.test(res.stderr)) {
    t.skip("Local throwaway Postgres not running on 55432");
    return;
  }
  assert.equal(res.status, 0, `Postgres round-trip failed:\\n${res.stderr}\\n${res.stdout}`);
});

async function startCombinedFixtureServer() {
  const entrySource = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { isFilmBrief, isScriptLedDuration, scriptSeconds } from "@videosaas/contracts";
    import { FilmBrief } from "./components/film-brief.tsx";
    import { ScriptCanvas } from "./components/script-canvas.tsx";

    const INITIAL_BEATS = ${JSON.stringify(EIGHT_BEATS)};
    const SAMPLE_SVG = ${JSON.stringify(SAMPLE_SVG)};

    function App() {
      const [step, setStep] = useState(0); // 0 = Brief, 1 = Storyboard
      const [brief, setBrief] = useState({
        scriptMode: "problem",
        text: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
        look: "illus-rubber-hose",
        styleExample: "story-illus-rubber-hose",
        durationSeconds: 30,
        aspect: "16:9",
        motionProfile: "smooth",
        pace: "calm",
        captions: "key-phrases",
        audio: { mode: "both", voice: "Kore", musicMood: "Playful, vintage swing, warm" }
      });
      const [beats, setBeats] = useState(INITIAL_BEATS);
      const [calls, setCalls] = useState({
        writeDraft: [],
        fit: 0,
        ask: [],
        insert: [],
        remove: []
      });

      const updateBrief = (patch) => {
        setBrief((curr) => ({ ...curr, ...patch }));
      };

      window.__combinedFixture = {
        INITIAL_BEATS,
        getState: () => ({ step, brief, beats, calls, runs: scriptSeconds(beats, brief.pace) }),
        setStep: async (s) => {
          setStep(s);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        setBrief: async (updater) => {
          setBrief((curr) => (typeof updater === "function" ? updater(curr) : updater));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        setBeats: async (nextBeats) => {
          setBeats(nextBeats);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
      };

      const isFilmBriefView = step === 0 && isFilmBrief(brief);
      const isStoryboardView = step === 1;

      return (
        <main
          className={
            isFilmBriefView
              ? "relay-shell relay-shell--film-brief"
              : isStoryboardView
                ? "relay-shell relay-shell--storyboard"
                : "relay-shell"
          }
        >
          <div className="ambient ambient-blue" /><div className="ambient ambient-peach" />
          <header className="creation-header">
            <div className="creation-project">
              <button type="button">← Projects</button><i />
              <strong>how money evolves</strong>
              <span>Ready for review</span>
            </div>
            <ol className="flow-steps">
              <li><button type="button" className={step === 0 ? "current" : "complete"} onClick={() => setStep(0)}><b>{step === 0 ? 1 : "✓"}</b>Brief</button><i /></li>
              <li><button type="button" className={step === 1 ? "current" : "complete"} onClick={() => setStep(1)}><b>2</b>Storyboard</button><i /></li>
              <li><button type="button" disabled><b>3</b>Animation</button><i /></li>
              <li><button type="button" disabled><b>4</b>Render</button></li>
            </ol>
          </header>

          {step === 0 && (
            <FilmBrief
              brief={brief}
              update={updateBrief}
              draft={{ beats, streaming: false, writing: null, flags: [], error: null }}
              writeDraft={(instruction) => setCalls((c) => ({ ...c, writeDraft: [...c.writeDraft, instruction ?? null] }))}
              editDraft={(idx, patch) => setBeats((curr) => curr.map((b, i) => (i === idx ? { ...b, ...patch } : b)))}
              stopDraft={() => {}}
              continueDraft={() => setStep(1)}
              continueToStoryboard={() => setStep(1)}
              hasStoryboard={true}
              error={null}
            />
          )}

          {step === 1 && (
            <ScriptCanvas
              projectId="316f1cbd-b5b9-49af-ae3b-2add10a18ed5"
              keepOverLength={Boolean(brief.keepOverLength)}
              onKeepOverLength={() => updateBrief({ keepOverLength: true })}
              beats={beats}
              open={null}
              writing={null}
              scoped={false}
              versions={beats.map(() => null)}
              onReimagine={() => {}}
              onVersion={() => {}}
              streaming={false}
              startedAt={Date.now() - 10000}
              flags={[]}
              error={null}
              voiced={true}
              length={{
                seconds: brief.durationSeconds,
                pace: brief.pace,
                locked: Boolean(brief.lockDuration),
                scriptLed: isScriptLedDuration(brief),
                keepOverLength: Boolean(brief.keepOverLength)
              }}
              onFit={() => {
                setCalls((c) => ({ ...c, fit: c.fit + 1 }));
                updateBrief({ lockDuration: true });
              }}
              onEdit={(idx, patch) => setBeats((curr) => curr.map((b, i) => (i === idx ? { ...b, ...patch } : b)))}
              onAsk={(instruction, only) => setCalls((c) => ({ ...c, ask: [...c.ask, { instruction, only }] }))}
              onCancel={() => {}}
              frames={beats.map(() => ({ state: "ready", svg: SAMPLE_SVG }))}
              aspect={brief.aspect}
              styleName="Rubber hose story"
              onRedraw={() => {}}
              voice={{ state: "ready", takes: beats.map((_, i) => "/mock-voice-" + (i + 1) + ".wav") }}
              onConfirm={() => {}}
              onRetryVoice={() => {}}
              music={true}
              onRender={() => {}}
              rendering={false}
              storyboard={{ state: "ready" }}
              onContinue={() => {}}
              continuing={false}
              onInsertScene={async (pos, prompt) => {
                setCalls((c) => ({ ...c, insert: [...c.insert, { pos, prompt }] }));
                const newBeat = { id: "sb-inserted-" + Date.now(), keyword: "New scene", visual: prompt, onScreen: "New scene", line: prompt };
                setBeats((curr) => [...curr.slice(0, pos), newBeat, ...curr.slice(pos)]);
              }}
              onRemoveScene={async (idx) => {
                setCalls((c) => ({ ...c, remove: [...c.remove, idx] }));
                setBeats((curr) => curr.filter((_, i) => i !== idx));
              }}
            />
          )}
        </main>
      );
    }

    createRoot(document.getElementById("root")).render(<App />);
  `;

  const bundled = await build({
    stdin: {
      contents: entrySource,
      resolveDir: FRONTEND_DIR,
      sourcefile: "combined-fixture-entry.tsx",
      loader: "tsx"
    },
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_API_URL": '""',
      "process.env": "{}"
    }
  });
  const bundleJs = bundled.outputFiles[0].text;
  const { findGalleryTemplate, galleryStyles } = await import("@videosaas/contracts");
  const rubberHoseTemplate = findGalleryTemplate("story-illus-rubber-hose");
  const allStyles = galleryStyles();

  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundleJs);
      return;
    }
    if (url.pathname === "/v1/gallery/styles") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(allStyles));
      return;
    }
    if (url.pathname === "/v1/gallery/templates") {
      const items = rubberHoseTemplate ? [rubberHoseTemplate] : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items, total: items.length, nextCursor: null, counts: { all: items.length } }));
      return;
    }
    if (url.pathname.startsWith("/previews/") || url.pathname.startsWith("/gallery/")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(TINY_PNG);
      return;
    }
    if (url.pathname.startsWith("/mock-voice-")) {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(Buffer.alloc(44));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Formats, Duration & Storyboard Blur Fixture</title>
  <style>${COMBINED_CSS}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/bundle.js"></script>
</body>
</html>`);
  });

  await new Promise((resolveListen) => srv.listen(0, "127.0.0.1", resolveListen));
  const address = srv.address();
  return { srv, baseUrl: `http://127.0.0.1:${address.port}` };
}

test("Browser verification at 1135x775 and mobile 390x844: Brief multi-format, Custom & Script-led duration, and Storyboard bottom blur", async () => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const { srv, baseUrl } = await startCombinedFixtureServer();
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1135, height: 775 } });
    page.on("pageerror", (err) => console.error("PAGEERROR:", err));
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // --- A. Brief Step 0: Multi-format selection UI ---
    const chip169 = page.locator('[aria-label="Aspect ratio"] button', { hasText: "16:9" });
    const chip916 = page.locator('[aria-label="Aspect ratio"] button', { hasText: "9:16" });
    const chip11 = page.locator('[aria-label="Aspect ratio"] button', { hasText: "1:1" });

    assert.equal(await chip169.getAttribute("aria-pressed"), "true");
    assert.equal(await chip916.getAttribute("aria-pressed"), "false");
    assert.equal(await chip11.getAttribute("aria-pressed"), "false");

    // Cannot deselect the only selected format
    await chip169.click();
    assert.equal(await chip169.getAttribute("aria-pressed"), "true", "cannot deselect last remaining format");

    // Select all 3 formats
    await chip916.click();
    await chip11.click();
    assert.equal(await chip169.getAttribute("aria-pressed"), "true");
    assert.equal(await chip916.getAttribute("aria-pressed"), "true");
    assert.equal(await chip11.getAttribute("aria-pressed"), "true");

    let state = await page.evaluate(() => window.__combinedFixture.getState().brief);
    assert.equal(state.aspect, "16:9", "primary remains 16:9 when adding 9:16 and 1:1");
    assert.deepEqual(state.aspects, ["16:9", "9:16", "1:1"]);

    // Deselect primary 16:9 -> primary deterministically becomes 9:16
    await chip169.click();
    state = await page.evaluate(() => window.__combinedFixture.getState().brief);
    assert.equal(state.aspect, "9:16", "deselecting 16:9 promotes 9:16 to primary");
    assert.deepEqual(state.aspects, ["9:16", "1:1"]);

    // Re-select 16:9 -> 9:16 stays primary!
    await chip169.click();
    state = await page.evaluate(() => window.__combinedFixture.getState().brief);
    assert.equal(state.aspect, "9:16", "re-adding 16:9 preserves current primary 9:16");
    assert.deepEqual(state.aspects, ["16:9", "9:16", "1:1"]);

    // --- B. Brief Step 0: Default "Let script decide", Custom >120s (240s, 600s), and right-panel spacing ---
    const scriptDecideBtn = page.getByRole("button", { name: "Let script decide" });
    assert.equal(await scriptDecideBtn.getAttribute("aria-pressed"), "true", "Let script decide is selected by default on load");
    assert.match((await scriptDecideBtn.getAttribute("class")) ?? "", /\bselected\b/);
    const initialHintText = await page.locator(".fb-shape-hint").textContent();
    assert.match(initialHintText ?? "", /from script/, "shows estimated script length by default");
    assert.doesNotMatch(initialHintText ?? "", /120s|max/i, "no 120s max cap text in hint");

    // Verify "Length follows your script" when no script beats exist yet
    await page.evaluate(() => window.__combinedFixture.setBeats([]));
    assert.equal(
      await page.locator(".fb-shape-hint").textContent(),
      "Length follows your script",
      "before content exists, says 'Length follows your script'"
    );
    await page.evaluate(() => window.__combinedFixture.setBeats(window.__combinedFixture.INITIAL_BEATS));

    const customInput = page.locator('input[aria-label="Custom duration in seconds"]');
    await customInput.click();
    await customInput.fill("");
    assert.equal(await customInput.inputValue(), "", "empty draft is retained while typing in Custom input");
    await page.locator(".fb-shape-hint.is-error").waitFor({ state: "visible" });
    assert.equal(
      await page.getByRole("button", { name: "Build storyboard again" }).isDisabled(),
      true,
      "empty custom duration disables Build storyboard button"
    );

    // Below-minimum value (3s < 5s) shows minimum error and disables submit
    await customInput.fill("3");
    const errText = await page.locator(".fb-shape-hint.is-error").textContent();
    assert.match(errText ?? "", /at least 5 seconds/i, "below-minimum custom duration shows >=5s feedback");
    assert.equal(await page.getByRole("button", { name: "Build storyboard again" }).isDisabled(), true);

    // Custom durations > 120s (240s and 600s) are accepted without cap!
    await customInput.fill("240");
    await customInput.press("Enter");
    state = await page.evaluate(() => window.__combinedFixture.getState().brief);
    assert.equal(state.durationMode, "custom");
    assert.equal(state.durationSeconds, 240, "240s custom duration commits cleanly");
    assert.equal(await page.getByRole("button", { name: "Build storyboard again" }).isDisabled(), false);
    assert.equal(await page.locator(".fb-shape-hint").textContent(), "Target 4m (240s)");

    await customInput.fill("600");
    await customInput.press("Enter");
    state = await page.evaluate(() => window.__combinedFixture.getState().brief);
    assert.equal(state.durationMode, "custom");
    assert.equal(state.durationSeconds, 600, "600s custom duration commits cleanly");
    assert.equal(await page.locator(".fb-shape-hint").textContent(), "Target 10m (600s)");

    // Valid custom duration (52s) also commits cleanly
    await customInput.fill("52");
    await customInput.press("Enter");
    state = await page.evaluate(() => window.__combinedFixture.getState().brief);
    assert.equal(state.durationMode, "custom");
    assert.equal(state.durationSeconds, 52);
    assert.equal(await page.getByRole("button", { name: "Build storyboard again" }).isDisabled(), false);

    // Switch back to "Let script decide"
    await scriptDecideBtn.click();
    assert.equal(await scriptDecideBtn.getAttribute("aria-pressed"), "true");
    assert.match((await scriptDecideBtn.getAttribute("class")) ?? "", /\bselected\b/);
    assert.doesNotMatch((await page.locator(".fb-custom").getAttribute("class")) ?? "", /\bselected\b/);
    await new Promise((r) => setTimeout(r, 220));
    state = await page.evaluate(() => window.__combinedFixture.getState().brief);
    assert.equal(state.durationMode, "script");
    assert.equal(state.durationSeconds, 52, "last custom target 52s is preserved in brief.durationSeconds");
    const hintText = await page.locator(".fb-shape-hint").textContent();
    assert.match(hintText ?? "", /from script/, "shows live estimated script length when script-led");
    assert.doesNotMatch(hintText ?? "", /120s|max/i, "no 120s cap text");

    // Verify right Film settings panel does not scroll at 1135x775 AND has balanced spacing (no huge >140px dead gap above CTA)
    const briefPanelMetrics = await page.evaluate(() => {
      const panel = document.querySelector(".fb-panel");
      const shape = document.querySelector(".fb-shape");
      const cta = document.querySelector(".fb-cta");
      const gapBeforeCta = Math.round(cta.getBoundingClientRect().top - shape.getBoundingClientRect().bottom);
      return {
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        gapBeforeCta
      };
    });
    assert.equal(
      briefPanelMetrics.scrollHeight,
      briefPanelMetrics.clientHeight,
      "FilmBrief .fb-panel remains non-scrolling at 1135x775 with all 3 formats and Let script decide active"
    );
    assert.ok(
      briefPanelMetrics.gapBeforeCta <= 95,
      `Right panel spacing is balanced without a huge dead gap above CTA (gapBeforeCta=${briefPanelMetrics.gapBeforeCta}px)`
    );
    await page.screenshot({ path: join(SCREENSHOT_DIR, "brief-1135x775-multiformat-script-led.png") });

    // Clicking Custom label restores last custom choice (52s), then enter 240s with long style name and screenshot
    await page.locator(".fb-custom").click();
    state = await page.evaluate(() => window.__combinedFixture.getState().brief);
    assert.equal(state.durationMode, "custom");
    assert.equal(state.durationSeconds, 52, "clicking Custom restores remembered 52s custom target");

    await customInput.fill("240");
    await customInput.press("Enter");
    await page.evaluate(() =>
      window.__combinedFixture.setBrief((b) => ({
        ...b,
        look: "illus-scrapbook",
        styleExample: "story-illus-scrapbook"
      }))
    );
    await new Promise((r) => setTimeout(r, 120));
    await page.screenshot({ path: join(SCREENSHOT_DIR, "brief-1135x775-custom-240s-long-style.png") });

    // Verify short-height desktop fallback (1135x580 < 640px height threshold) unlocks vertical page scroll so all controls remain accessible
    await page.setViewportSize({ width: 1135, height: 580 });
    await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const shortViewportMetrics = await page.evaluate(() => {
      const shell = document.querySelector(".relay-shell");
      const doc = document.scrollingElement || document.documentElement;
      const ctaRect = document.querySelector(".fb-cta")?.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(shell).overflowY,
        scrollTop: doc.scrollTop,
        ctaInViewportAfterScroll: Boolean(ctaRect && ctaRect.bottom <= window.innerHeight + 2 && ctaRect.top >= 0)
      };
    });
    assert.notEqual(shortViewportMetrics.overflowY, "hidden", "short desktop viewport (1135x580) unlocks vertical scroll");
    assert.ok(shortViewportMetrics.scrollTop > 0, "short desktop viewport scrolls down to reach lower controls");
    assert.equal(shortViewportMetrics.ctaInViewportAfterScroll, true, "CTA buttons are fully reachable by scrolling on short viewport");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "brief-1135x580-short-viewport-fallback.png") });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1135, height: 775 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // Switch back to "Let script decide" and open Storyboard
    await page.evaluate(() =>
      window.__combinedFixture.setBrief((b) => ({
        ...b,
        look: "illus-rubber-hose",
        styleExample: "story-illus-rubber-hose"
      }))
    );
    await scriptDecideBtn.click();
    // Set primary back to 16:9 with all 3 formats selected
    await page.evaluate(() =>
      window.__combinedFixture.setBrief((b) => ({ ...b, aspect: "16:9", aspects: ["16:9", "9:16", "1:1"] }))
    );
    await page.getByRole("button", { name: "Open storyboard" }).click();

    // --- C. Storyboard Step 1: Script-led mode & Bottom Blur behind prompt ---
    // In script-led mode, 8 calm beats (~48s) must NOT show the "longer than the Ns you chose" banner!
    assert.equal(
      await page.locator(".sc-length").count(),
      0,
      "script-led mode does NOT show the over-length warning on Storyboard"
    );

    // Scroll mid-way so scene content is directly behind the bottom prompt dock and blur overlay
    await page.evaluate(() => {
      const scScroll = document.querySelector(".sc-scroll");
      scScroll.scrollTop = 220;
    });
    await new Promise((r) => setTimeout(r, 80));

    const blurMetrics = await page.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x * 100) / 100,
          y: Math.round(r.y * 100) / 100,
          right: Math.round(r.right * 100) / 100,
          bottom: Math.round(r.bottom * 100) / 100,
          width: Math.round(r.width * 100) / 100,
          height: Math.round(r.height * 100) / 100
        };
      };
      const scScroll = document.querySelector(".sc-scroll");
      const scDock = document.querySelector(".sc-dock");
      const scBlur = document.querySelector(".sc-bottom-blur");
      const scAsk = document.querySelector(".sc-ask");
      const askInput = scAsk.querySelector("input");
      const sendBtn = scAsk.querySelector("button.sc-send");
      const blurStyle = getComputedStyle(scBlur);
      const askStyle = getComputedStyle(scAsk);
      const dockStyle = getComputedStyle(scDock);

      // Find beats that intersect vertically with the blur band
      const blurRect = rect(scBlur);
      const overlappingBeats = Array.from(document.querySelectorAll(".sc-beat"))
        .map((el) => rect(el))
        .filter((r) => r && r.bottom > blurRect.y + 8 && r.y < blurRect.bottom - 8);

      // Hit-test prompt controls to verify they are clickable on top of the blur layer
      const askInputRect = askInput.getBoundingClientRect();
      const hitAtInput = document.elementFromPoint(
        askInputRect.left + askInputRect.width / 2,
        askInputRect.top + askInputRect.height / 2
      );

      return {
        scScrollRect: rect(scScroll),
        scDockRect: rect(scDock),
        scBlurRect: blurRect,
        scAskRect: rect(scAsk),
        overlappingBeatCount: overlappingBeats.length,
        backdropFilter: blurStyle.backdropFilter || blurStyle.webkitBackdropFilter || "",
        blurPointerEvents: blurStyle.pointerEvents,
        dockPointerEvents: dockStyle.pointerEvents,
        askPointerEvents: askStyle.pointerEvents,
        askFilter: askStyle.filter,
        inputHitSelf: hitAtInput === askInput || scAsk.contains(hitAtInput),
        sendDisabled: sendBtn.disabled
      };
    });

    assert.ok(
      blurMetrics.scScrollRect.bottom >= blurMetrics.scDockRect.bottom - 2,
      `sc-scroll (${blurMetrics.scScrollRect.bottom}) extends behind sc-dock (${blurMetrics.scDockRect.bottom}) so scenes pass behind the blur region`
    );
    assert.ok(
      blurMetrics.overlappingBeatCount >= 1,
      "at mid-scroll, scene content physically overlaps behind the bottom blur region"
    );
    assert.match(blurMetrics.backdropFilter, /blur\(/, "sc-bottom-blur applies real CSS backdrop-filter blur");
    assert.equal(blurMetrics.blurPointerEvents, "none", "decorative blur layer has pointer-events: none");
    assert.equal(blurMetrics.dockPointerEvents, "none", "dock container has pointer-events: none");
    assert.equal(blurMetrics.askPointerEvents, "auto", "prompt form has pointer-events: auto");
    assert.equal(blurMetrics.askFilter, "none", "prompt box itself is not blurred");
    assert.equal(blurMetrics.inputHitSelf, true, "prompt input is directly clickable above blur overlay");
    assert.ok(
      blurMetrics.scBlurRect.height >= blurMetrics.scAskRect.height,
      `blur overlay height (${blurMetrics.scBlurRect.height}px) covers prompt height (${blurMetrics.scAskRect.height}px)`
    );

    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-1135x775-dark-midscroll-blur.png") });

    // Light theme screenshot at mid-scroll
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-1135x775-light-midscroll-blur.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

    // --- D. Multi-line / wrapped chips in prompt dynamically adapts dock & blur height ---
    const dockHeightBeforeChips = blurMetrics.scDockRect.height;
    // Pick 6 beats so chips wrap onto multiple rows in .sc-ask
    for (let i = 0; i < 6; i++) {
      await page.locator("button.sc-num").nth(i).click();
    }
    await new Promise((r) => setTimeout(r, 80));
    const grownDockMetrics = await page.evaluate(() => {
      const root = document.querySelector(".script-canvas");
      const scDock = document.querySelector(".sc-dock");
      const scBlur = document.querySelector(".sc-bottom-blur");
      const scAsk = document.querySelector(".sc-ask");
      return {
        cssVarDockHeight: root.style.getPropertyValue("--sc-dock-height"),
        dockHeight: Math.round(scDock.getBoundingClientRect().height),
        blurHeight: Math.round(scBlur.getBoundingClientRect().height),
        askHeight: Math.round(scAsk.getBoundingClientRect().height)
      };
    });
    assert.ok(
      grownDockMetrics.dockHeight > dockHeightBeforeChips,
      `picking 6 beat chips grows dock height (${dockHeightBeforeChips}px -> ${grownDockMetrics.dockHeight}px)`
    );
    assert.ok(
      grownDockMetrics.blurHeight >= grownDockMetrics.askHeight,
      `blur height (${grownDockMetrics.blurHeight}px) automatically adapts to taller wrapped prompt (${grownDockMetrics.askHeight}px)`
    );
    assert.equal(
      grownDockMetrics.cssVarDockHeight,
      `${grownDockMetrics.dockHeight}px`,
      "--sc-dock-height CSS variable tracks actual dock height via ResizeObserver"
    );

    // Scroll to the very bottom with wrapped chips -> verify final scene & final Add scene button scroll clear above prompt!
    const bottomClearMetrics = await page.evaluate(() => {
      const scScroll = document.querySelector(".sc-scroll");
      scScroll.scrollTop = scScroll.scrollHeight;
      const lastBeat = Array.from(document.querySelectorAll(".sc-doc > li.sc-beat")).at(-1);
      const lastAddBtn = Array.from(document.querySelectorAll(".sc-add-scene-btn")).at(-1);
      const scAsk = document.querySelector(".sc-ask");
      return {
        lastBeatBottom: Math.round(lastBeat.getBoundingClientRect().bottom),
        lastAddBtnBottom: lastAddBtn ? Math.round(lastAddBtn.getBoundingClientRect().bottom) : null,
        scAskTop: Math.round(scAsk.getBoundingClientRect().top)
      };
    });
    assert.ok(
      bottomClearMetrics.lastBeatBottom <= bottomClearMetrics.scAskTop + 2,
      `final scene (${bottomClearMetrics.lastBeatBottom}px) scrolls clear above taller prompt (${bottomClearMetrics.scAskTop}px)`
    );
    assert.ok(
      bottomClearMetrics.lastAddBtnBottom !== null && bottomClearMetrics.lastAddBtnBottom <= bottomClearMetrics.scAskTop + 4,
      `final + Add scene boundary (${bottomClearMetrics.lastAddBtnBottom}px) scrolls clear above taller prompt (${bottomClearMetrics.scAskTop}px)`
    );
    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-1135x775-bottom-scroll-clear.png") });

    // Submit a prompt in .sc-ask to verify prompt interaction works and clears picked chips
    const askField = page.locator('.sc-ask input[aria-label="Ask the AI to change the script"]');
    await askField.fill("Make these scenes more playful");
    await page.locator(".sc-ask button.sc-send").click();
    const afterAskSubmit = await page.evaluate(() => window.__combinedFixture.getState().calls.ask.at(-1));
    assert.deepEqual(afterAskSubmit, {
      instruction: "Make these scenes more playful",
      only: [0, 1, 2, 3, 4, 5]
    });

    // --- E. Mobile viewport (390x844) verification ---
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.querySelector(".sc-scroll").scrollTop = 180;
    });
    await new Promise((r) => setTimeout(r, 80));
    const mobileMetrics = await page.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      const scBlur = document.querySelector(".sc-bottom-blur");
      const scAsk = document.querySelector(".sc-ask");
      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        blurHeight: Math.round(scBlur.getBoundingClientRect().height),
        askHeight: Math.round(scAsk.getBoundingClientRect().height),
        askBottom: Math.round(scAsk.getBoundingClientRect().bottom),
        innerHeight: window.innerHeight
      };
    });
    assert.ok(
      mobileMetrics.docScrollWidth <= mobileMetrics.docClientWidth,
      `390x844 mobile: no horizontal overflow (${mobileMetrics.docScrollWidth} <= ${mobileMetrics.docClientWidth})`
    );
    assert.ok(mobileMetrics.blurHeight >= mobileMetrics.askHeight, "390x844 mobile: blur covers prompt height");
    assert.ok(mobileMetrics.askBottom <= mobileMetrics.innerHeight, "390x844 mobile: prompt sits inside viewport");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-390x844-mobile-blur.png") });
  } finally {
    await browser.close();
    srv.close();
  }
});
