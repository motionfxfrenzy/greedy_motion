import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CHARACTER_RULE, getLook, type ScriptBeat } from "@videosaas/contracts";
import { ENGINE_DIR, guideFile, kitFile, plateFile } from "@videosaas/plate-engine";
import { existsSync } from "node:fs";
import { FPS, sizeForAspect } from "./model.ts";
import {
  CUT_POLICY_VERSION,
  DEFAULT_MAX_LINES,
  EXCERPT_PLAN_VERSION,
  KIT_BUDGET_CHARS,
  KIT_REPAIR_MAX,
  LETTER_HELPERS,
  MIN_KIT_HELPERS,
  POLICY_REPAIR_MAX,
  SCENE_EXCERPT_BUDGET_CHARS,
  SOURCE_BUDGET_CHARS,
  TIER_LINES,
  approxTokens,
  checkKitUse,
  checkNoText,
  checkScene,
  consumeLastKitModulesPlateName,
  kitForPrompt,
  kitHelperNamesFor,
  kitModulesFor,
  kitModulesForPrompt,
  letterHelpersFor,
  parseGuide,
  plateExcerpt,
  plateSceneExcerpt,
  storyWorldBlockFor,
  type KitModule,
  type KitUseCheckResult,
  type NoTextCheckResult,
  type NoTextIssue,
  type ScenePolicyCheckResult,
  type ScenePolicyIssue,
  type StyleGuide
} from "./prompt-context.ts";

export {
  CUT_POLICY_VERSION,
  KIT_BUDGET_CHARS,
  KIT_REPAIR_MAX,
  LETTER_HELPERS,
  MIN_KIT_HELPERS,
  POLICY_REPAIR_MAX,
  TIER_LINES,
  approxTokens,
  checkKitUse,
  checkNoText,
  checkScene,
  kitHelperNamesFor,
  kitModulesFor,
  kitModulesForPrompt,
  letterHelpersFor,
  type KitModule,
  type KitUseCheckResult,
  type NoTextCheckResult,
  type NoTextIssue,
  type ScenePolicyCheckResult,
  type ScenePolicyIssue
};

/**
 * The authoring prompt for one scene. The plate source, its kit and the worked example come from the versioned engine package
 * (never from a developer path), and the digest of the template + example enters every scene signature, so editing this
 * prompt redraws what it would draw differently.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
export const LEGACY_PROMPT_VERSION = 3;
export const PROMPT_VERSION = 5;
const exampleFile = join(ENGINE_DIR, "worked-example.txt");

export const lookForPlateName = (plateName: string): string =>
  `illus-${plateName.replace(/([A-Z0-9])/g, "-$1").toLowerCase()}`;

/** True unless `PLATE_STYLE_GUIDES=off` (default on). When off, `buildAuthorMessages` and `promptDigest` behave identically to the pre-guide v3 pipeline. */
export const styleGuidesEnabled = (): boolean =>
  (process.env.PLATE_STYLE_GUIDES ?? "on").trim().toLowerCase() !== "off";

export type CharacterRuleMode = "guided" | "all" | "off";

/** Rollout switch for the scene character rule block (`"guided" | "all"`, overrideable via `PLATE_CHARACTER_RULE=guided|all|off`). */
export const CHARACTER_RULE_STYLES: "guided" | "all" = "all";

export const CHARACTER_RULE_LEAD_IN =
  "Draw the characters and props exactly as the beat's VISUAL says, consistent with the CAST note:";

export const CHARACTER_RULE_BLOCK = `${CHARACTER_RULE_LEAD_IN} ${CHARACTER_RULE}`;

/** Resolves the active character-rule mode from `PLATE_STYLE_GUIDES`, `PLATE_CHARACTER_RULE`, and `CHARACTER_RULE_STYLES`. */
export const characterRuleMode = (): CharacterRuleMode => {
  if (!styleGuidesEnabled()) return "off";
  const raw = (process.env.PLATE_CHARACTER_RULE ?? CHARACTER_RULE_STYLES).trim().toLowerCase();
  if (raw === "off" || raw === "all" || raw === "guided") return raw;
  return CHARACTER_RULE_STYLES;
};

/** Returns the character rule block when enabled for the style, or `null` when suppressed. */
export const characterRuleForStyle = (hasGuide: boolean, overrideBlock = CHARACTER_RULE_BLOCK): string | null => {
  const mode = characterRuleMode();
  if (mode === "off") return null;
  if (mode === "all") return overrideBlock;
  return hasGuide ? overrideBlock : null;
};

/** Allow-list of styles that load a per-style guide. Every other style gets no guide even if a file exists. */
export const GUIDED_STYLES: readonly string[] = ["paintedOil"];

/** Loads the per-style guide from the engine package, or returns null when the style is not in `GUIDED_STYLES`, has no guide file, or when `PLATE_STYLE_GUIDES=off`. */
export async function loadGuide(
  plateName: string | null | undefined,
  guidesDir?: string
): Promise<StyleGuide | null> {
  if (!plateName || !styleGuidesEnabled() || !GUIDED_STYLES.includes(plateName)) return null;
  const path = guidesDir ? join(guidesDir, `${plateName}.md`) : guideFile(plateName);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return parseGuide(raw);
}

const legacyContractFor = (size: { w: number; h: number; label: string }, maxLines = DEFAULT_MAX_LINES) => [
  "You write ONE scene of a film as a single TypeScript module for the anidoodle engine: pictures drawn entirely in code, in a named hand-made medium.",
  "THE CONTRACT (absolute): the module is a pure function of (ctx, frame, env). Randomness only through rng(seed) or the helpers' seeds; no Date, no Math.random, no clock, no ctx.filter, no fetch, no images, no fonts, no external assets.",
  "Draw every mark in the SAME MEDIUM AND ORDER OF MARKS as the style's plate (the plate source below is the recipe: its marks, its textures, its palette habits, its contour). A different palette is not a different style.",
  `The scene is ${size.w}x${size.h} (${size.label}), 30 fps. All coordinates are in that ${size.w}x${size.h} space. Start with ctx.setTransform(env.scale,0,0,env.scale,0,0), fill the full ${size.w}x${size.h} paper, draw, then finish with the plate's paper pass.`,
  "Draw what the beat's VISUAL line says, as a finished picture with one focal subject and one light. Something visibly changes every second (a swing, a drift, a flame, drawing-on marks): no dead frames. Keep recurring characters and objects consistent with the film's other scenes, as described in the CAST note.",
  "People are friendly and simple; faces are a few marks (eye strokes, a mouth line). No text in the picture: the words are laid on by the editor.",
  `Export exactly (the typed form, on one line start): \`export const film: Film = { meta: { title, W: ${size.w}, H: ${size.h}, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] }\` where draw has the signature (ctx: Ctx, frame: number, env: Env) => void and durationFrames is given in the request.`,
  "Import only from \"./core\", \"./film\", \"./gallery\" and the plate's own kit modules that the plate itself imports. Copy the plate's small local helpers (scribble, line, wax, etc.) into your module instead of importing them: they are not exported.",
  `Keep the module COMPACT, under about ${maxLines} lines: one focal subject, a simple setting, and reuse small helpers and loops. A complete short module is worth far more than a long unfinished one.`,
  "Reply with the complete module inside one ```ts fence and nothing else."
].join("\n");

export const contractFor = (
  size: { w: number; h: number; label: string },
  maxLines = DEFAULT_MAX_LINES,
  plateOrHelpers?: string | readonly string[]
) => {
  let letterHelpers: readonly string[] = [];
  if (Array.isArray(plateOrHelpers)) {
    letterHelpers = plateOrHelpers;
  } else if (typeof plateOrHelpers === "string") {
    letterHelpers = letterHelpersFor(plateOrHelpers);
  } else if (size.w === 0 && size.h === 0 && size.label === "") {
    const inferredPlate = consumeLastKitModulesPlateName();
    if (inferredPlate) letterHelpers = letterHelpersFor(inferredPlate);
  }
  return [
    "You write ONE scene of a film as a single TypeScript module for the anidoodle engine: pictures drawn entirely in code, in a named hand-made medium.",
    "THE CONTRACT (absolute): the module is a pure function of (ctx, frame, env). Randomness only through rng(seed) or the helpers' seeds; no Date, no Math.random, no clock, no ctx.filter, no fetch, no images, no fonts, no external assets.",
    "Draw every mark in the SAME MEDIUM AND ORDER OF MARKS as the style's plate (the plate source below is the recipe: its marks, its textures, its palette habits, its contour). A different palette is not a different style.",
    `The scene is ${size.w}x${size.h} (${size.label}), 30 fps. All coordinates are in that ${size.w}x${size.h} space. Start with ctx.setTransform(env.scale,0,0,env.scale,0,0), fill the full ${size.w}x${size.h} paper, draw, then finish with the plate's paper pass.`,
    "Draw what the beat's VISUAL line says, as a finished picture with one focal subject and one light. Something visibly changes every second (a swing, a drift, a flame, drawing-on marks): no dead frames. Keep recurring characters and objects consistent with the film's other scenes, as described in the CAST note.",
    "People are friendly and simple; faces are a few marks (eye strokes, a mouth line). No text in the picture: the words are laid on by the editor.",
    ...(letterHelpers.length > 0 ? [`Do not call ${letterHelpers.join(", ")}: they print words.`] : []),
    `Export exactly (the typed form, on one line start): \`export const film: Film = { meta: { title, W: ${size.w}, H: ${size.h}, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] }\` where draw has the signature (ctx: Ctx, frame: number, env: Env) => void and durationFrames is given in the request.`,
    "Import only from \"./core\", \"./film\", \"./gallery\" and the plate's own kit modules that the plate itself imports. Copy the plate's small local helpers (scribble, line, wax, etc.) into your module instead of importing them: they are not exported.",
    "THE STYLE'S KIT MODULES: build the scene FROM these helpers (the characters, ground, marks and the final paper pass); do not redraw them from scratch; for a style with no separate kit, build from the plate's own helpers.",
    `Keep the module COMPACT, under about ${maxLines} lines: one focal subject, a simple setting, and reuse small helpers and loops. A complete short module is worth far more than a long unfinished one.`,
    "Reply with the complete module inside one ```ts fence and nothing else."
  ].join("\n");
};

const legacyReadText = async (path: string, cap: number) => {
  const text = await readFile(path, "utf8");
  return text.length > cap ? `${text.slice(0, cap)}\n/* ...truncated... */` : text;
};

async function resolveExampleForStyle(plateName: string, guide: StyleGuide | null, plateSource?: string): Promise<{ text: string; block: string }> {
  if (!guide) {
    const example = styleGuidesEnabled() ? await readFile(exampleFile, "utf8") : await legacyReadText(exampleFile, 12_000);
    return {
      text: example,
      block: `A WORKED EXAMPLE of a new subject authored in the crayon plate's medium (a scene of another film). Study the structure, not the subject:\n<example>\n${example}\n</example>`
    };
  }
  if (guide.example && guide.example !== "plate-excerpt") {
    const candidate = join(ENGINE_DIR, "examples", guide.example);
    if (existsSync(candidate)) {
      const text = await readFile(candidate, "utf8");
      return {
        text,
        block: `A WORKED EXAMPLE of a new subject authored in this style's family (study the structure and motion, not the subject):\n<example name="${guide.example}">\n${text}\n</example>`
      };
    }
  }
  const src = plateSource ?? await readFile(plateFile(plateName), "utf8");
  const excerpt = plateSceneExcerpt(src, SCENE_EXCERPT_BUDGET_CHARS);
  return {
    text: excerpt,
    block: `THE TEMPLATE FILM'S OWN SCENE (study how it moves):\n<example name="${plateName}">\n${excerpt}\n</example>`
  };
}

/**
 * Digest of everything in the prompt that is not the beat:
 * - When `PLATE_STYLE_GUIDES=off` (or when no plateName is passed), returns the legacy v3 digest `4126e4d502bb1f23`.
 * - Otherwise hashes `PROMPT_VERSION` (5), the contract text, `CHARACTER_RULE`, the example, and the stable list of kit module names + cut-policy version.
 */
export async function promptDigest(
  plateName?: string | null,
  characterRuleOverride?: string | { characterRuleBlock?: string; guidesDir?: string },
  guidesDir?: string
): Promise<string> {
  if (!plateName || !styleGuidesEnabled()) {
    const example = await readFile(exampleFile, "utf8");
    return createHash("sha256")
      .update(`${LEGACY_PROMPT_VERSION}\0${legacyContractFor({ w: 0, h: 0, label: "" }, DEFAULT_MAX_LINES)}\0${example}`)
      .digest("hex")
      .slice(0, 16);
  }
  const effectiveGuidesDir =
    guidesDir ?? (typeof characterRuleOverride === "object" ? characterRuleOverride?.guidesDir : undefined);
  const guide = await loadGuide(plateName, effectiveGuidesDir);
  const overrideText =
    typeof characterRuleOverride === "string"
      ? characterRuleOverride
      : characterRuleOverride?.characterRuleBlock;
  const ruleText = characterRuleMode() === "off" ? "" : (overrideText ?? CHARACTER_RULE);
  const ex = await resolveExampleForStyle(plateName, guide);
  const kitNames = kitModulesFor(plateName).map((k) => k.name).join(",");
  return createHash("sha256")
    .update(
      [
        PROMPT_VERSION,
        contractFor({ w: 0, h: 0, label: "" }, guide ? guide.lines : DEFAULT_MAX_LINES, plateName),
        ruleText,
        ex.text,
        kitNames,
        CUT_POLICY_VERSION,
        ...(guide ? [guide.raw] : [])
      ].join("\0")
    )
    .digest("hex")
    .slice(0, 16);
}

export type AuthorRequest = {
  look: string; plateName: string; film: string; beats: ScriptBeat[]; aspect: string; index: number; frames: number;
  styleExample?: string | null; storyWorld?: string; guidesDir?: string; kitModules?: readonly KitModule[];
  error?: string; previous?: string; revise?: { notes: string; code: string }; reference?: string;
};

export const cacheKeyFor = (sharedText: string): string =>
  createHash("sha256").update(sharedText).digest("hex").slice(0, 16);

/** The model request (system + messages) for one scene; the large shared context is cached across scenes. */
export async function buildAuthorMessages(args: AuthorRequest) {
  const guidesOn = styleGuidesEnabled();
  const beat = args.beats[args.index]!;
  const size = sizeForAspect(args.aspect);
  const cast = args.beats.map((b, i) => `${i + 1}. ${b.keyword}: ${b.visual ?? ""}`).join("\n");

  if (!guidesOn) {
    const plate = await legacyReadText(plateFile(args.plateName), 30_000);
    const kitPath = kitFile(args.plateName);
    const kitCode = existsSync(kitPath) ? await legacyReadText(kitPath, 15_000) : null;
    const ex = await resolveExampleForStyle(args.plateName, null);
    const shared = [
      `STYLE: ${getLook(args.look as never).name}. THE STYLE'S PLATE (the recipe; study its medium, do not copy its subject):\n<plate name="${args.plateName}">\n${plate}\n</plate>`,
      ...(kitCode ? [`THE PLATE'S KIT MODULE (imported as "./${args.plateName}Kit"; use these exact exported helpers and types):\n<kit name="${args.plateName}Kit">\n${kitCode}\n</kit>`] : []),
      ex.block,
      `THE FILM: ${args.film}\nFRAME SIZE: W=${size.w}, H=${size.h} (${size.label}), 30 fps. Use W: ${size.w}, H: ${size.h} in meta and compose all coordinates within ${size.w}x${size.h}.\nCAST AND STORY (all scenes, for consistency of recurring characters and objects):\n${cast}`
    ].join("\n\n");
    const scene = [
      `WRITE SCENE ${args.index + 1} OF ${args.beats.length}: "${beat.keyword}".\nVISUAL: ${beat.visual ?? beat.keyword}\nVOICEOVER (for pacing only, not drawn): ${beat.line ?? ""}\nLength: ${args.frames} frames (${args.frames / FPS} s).Frame dimensions: W=${size.w}, H=${size.h}.`,
      ...(args.reference ? [`THE SAME SCENE WAS ALREADY AUTHORED FOR ANOTHER FRAME SHAPE. Keep its characters, objects, palette, light and story beats exactly; recompose them natively for ${size.w}x${size.h} (do not letterbox or crop).\nREFERENCE MODULE:\n${args.reference.slice(0, 14_000)}`] : []),
      ...(args.revise ? [`THIS SCENE WAS ALREADY DRAWN. The person watched it and left notes with the time in the scene (seconds from the scene start). REVISE the module below to answer the notes; keep everything the notes do not mention exactly as it is (same composition, characters and palette), and return the whole revised module.\nNOTES:\n${args.revise.notes}\nCURRENT MODULE:\n${args.revise.code.slice(0, 16_000)}`] : []),
      ...(args.error ? [`YOUR PREVIOUS MODULE FAILED. Fix it and return the whole corrected module.\nERROR:\n${args.error.slice(0, 2500)}\nPREVIOUS MODULE:\n${args.previous?.slice(0, 14_000) ?? ""}`] : [])
    ].join("\n\n");
    const legacyOut = {
      system: legacyContractFor(size, DEFAULT_MAX_LINES),
      messages: [{ role: "user", content: [{ type: "text", text: shared, cache_control: { type: "ephemeral" } }, { type: "text", text: scene }] }]
    };
    Object.defineProperty(legacyOut, "cacheKey", { value: cacheKeyFor(shared), enumerable: false });
    return legacyOut as typeof legacyOut & { cacheKey: string };
  }

  const guide = await loadGuide(args.plateName, args.guidesDir);
  const charBlock = characterRuleForStyle(Boolean(guide));
  const rawPlate = await readFile(plateFile(args.plateName), "utf8");
  const plate = plateExcerpt(rawPlate, SOURCE_BUDGET_CHARS);
  const resolvedKits = args.kitModules ?? kitModulesFor(args.plateName);
  const kitEntries = kitModulesForPrompt(resolvedKits, rawPlate, KIT_BUDGET_CHARS);
  const kitBlock = kitEntries.length > 0
    ? `THE STYLE'S KIT MODULES (imported as ${kitEntries.map((k) => `"${k.specifier}"`).join(", ")}): build the scene FROM these helpers (the characters, ground, marks and the final paper pass); do not redraw them from scratch; for a style with no separate kit, build from the plate's own helpers.\n${kitEntries.map((k) => `<kit name="${k.name}">\n${k.text}\n</kit>`).join("\n\n")}`
    : "THE STYLE'S KIT MODULES (the plate itself is the kit): build the scene FROM these helpers (the characters, ground, marks and the final paper pass); do not redraw them from scratch; for a style with no separate kit, build from the plate's own helpers.";
  const ex = await resolveExampleForStyle(args.plateName, guide, rawPlate);
  const maxLines = guide ? guide.lines : DEFAULT_MAX_LINES;
  const storyWorld = guide || args.storyWorld !== undefined
    ? storyWorldBlockFor({ look: args.look, styleExample: args.styleExample }, args.storyWorld)
    : null;
  const shared = [
    `STYLE: ${getLook(args.look as never).name}. THE STYLE'S PLATE (the recipe; study its medium, do not copy its subject):\n<plate name="${args.plateName}">\n${plate}\n</plate>`,
    kitBlock,
    ...(guide ? [`STYLE GUIDE (advisory: a helper, not a hard rule; the plate source is the recipe):\n<guide name="${args.plateName}">\n${guide.body}\n</guide>`] : []),
    ...(charBlock ? [charBlock] : []),
    ex.block,
    ...(storyWorld ? [storyWorld] : []),
    `THE FILM: ${args.film}\nFRAME SIZE: W=${size.w}, H=${size.h} (${size.label}), 30 fps. Use W: ${size.w}, H: ${size.h} in meta and compose all coordinates within ${size.w}x${size.h}.\nCAST AND STORY (all scenes, for consistency of recurring characters and objects):\n${cast}`
  ].join("\n\n");
  const scene = [
    `WRITE SCENE ${args.index + 1} OF ${args.beats.length}: "${beat.keyword}".\nVISUAL: ${beat.visual ?? beat.keyword}\nVOICEOVER (for pacing only, not drawn): ${beat.line ?? ""}\nLength: ${args.frames} frames (${args.frames / FPS} s).Frame dimensions: W=${size.w}, H=${size.h}.`,
    ...(args.reference ? [`THE SAME SCENE WAS ALREADY AUTHORED FOR ANOTHER FRAME SHAPE. Keep its characters, objects, palette, light and story beats exactly; recompose them natively for ${size.w}x${size.h} (do not letterbox or crop).\nREFERENCE MODULE:\n${args.reference.slice(0, 14_000)}`] : []),
    ...(args.revise ? [`THIS SCENE WAS ALREADY DRAWN. The person watched it and left notes with the time in the scene (seconds from the scene start). REVISE the module below to answer the notes; keep everything the notes do not mention exactly as it is (same composition, characters and palette), and return the whole revised module.\nNOTES:\n${args.revise.notes}\nCURRENT MODULE:\n${args.revise.code.slice(0, 16_000)}`] : []),
    ...(args.error ? [`YOUR PREVIOUS MODULE FAILED. Fix it and return the whole corrected module.\nERROR:\n${args.error.slice(0, 2500)}\nPREVIOUS MODULE:\n${args.previous?.slice(0, 14_000) ?? ""}`] : [])
  ].join("\n\n");
  return {
    system: contractFor(size, maxLines, args.plateName),
    messages: [{ role: "user", content: [{ type: "text", text: shared, cache_control: { type: "ephemeral" } }, { type: "text", text: scene }] }],
    cacheKey: cacheKeyFor(shared)
  };
}

/** Pulls the module out of the model's reply. Throws a repairable error when there is none. */
export function moduleFrom(text: string): string {
  const fenced = /```(?:ts|typescript)?\n([\s\S]*?)```/.exec(text);
  const code = (fenced?.[1] ?? text).trim();
  if (!/export const film/.test(code)) throw Object.assign(new Error("The model's module has no `film` export."), { repairable: true });
  return code;
}
void here; void EXCERPT_PLAN_VERSION; void kitForPrompt;
