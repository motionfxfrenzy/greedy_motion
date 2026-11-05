import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CANVAS,
  ENGINE_TEMPLATE,
  engineVariables,
  fillTextBlock,
  hfBlockValues,
  scriptJson,
  stampCanvas
} from "./composition.ts";
import {
  COMMENT_TO_PATCH_SYSTEM_PROMPT,
  checkSceneHintLayout,
  classifyEditPatch,
  describeEditAction,
  deterministicCommentTranslator,
  hasEditPatchOperations,
  isValidPlanElementId,
  mergeWindowElements,
  plainText,
  resolveBeatWindowTimes as resolveBeatWindowTimesContract,
  validateBeatLayoutHint,
  validateCanvasDimensions,
  validateEditPatch,
  validateFrameElementsSnapshots,
  type ActiveElementInfo,
  type Beat,
  type BeatLayoutHint,
  type BeatPlan,
  type BeatWindowTimingInput,
  type ClassifierDecision,
  type CommentPatchTranslator,
  type EditPatch,
  type FrameElementsSnapshot,
  type VideoProject
} from "@videosaas/contracts";
import { anthropicMessage, responseText } from "../anthropic.ts";
import { config } from "../config.ts";
import { brandNameFor, projectLook, projectTiming } from "./preview.ts";

/** 1x1 transparent PNG data URI used when building standalone composition HTML for offline browser tests. */
const PLACEHOLDER_SHOT_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Builds a self-contained HTML string for the project's beat-plan composition.
 * Pure HTML builder: never imports or launches Chrome.
 */
export async function buildStandaloneCompositionHtml(
  project: VideoProject,
  planOverride?: BeatPlan
): Promise<{ html: string; canvas: { width: number; height: number } }> {
  const plan = planOverride ?? project.beatPlan;
  if (!plan) throw new Error("Generate the plan first.");
  const projectWithPlan: VideoProject = { ...project, beatPlan: plan };
  const timing = projectTiming(projectWithPlan);
  if (!timing) throw new Error("Could not compute plan timing.");

  const [templateHtml, bundledFonts, look] = await Promise.all([
    readFile(join(config.templatesDir, ENGINE_TEMPLATE, "index.html"), "utf8"),
    readFile(join(config.fontsDir, "fonts.css"), "utf8"),
    projectLook(projectWithPlan)
  ]);

  const screens = new Map(project.screenshots.map((shot) => [shot.id, shot]));
  const used = [...new Set(plan.beats.flatMap((beat) => (beat.ui ? [beat.ui.screen] : [])))];
  const shots = Object.fromEntries(used.map((id) => [id, PLACEHOLDER_SHOT_URI]));
  const screenSizes = Object.fromEntries(
    used.map((id) => {
      const s = screens.get(id);
      return [id, { width: s?.width || 1600, height: s?.height || 1000 }];
    })
  );

  const variables = engineVariables({
    plan,
    timing,
    shots,
    screenSizes,
    brandName: brandNameFor(projectWithPlan, look.brand),
    logo: look.logo ? PLACEHOLDER_SHOT_URI : null,
    logoWordmark: Boolean(look.logo?.spellsName),
    logoBug: look.logoBug ? PLACEHOLDER_SHOT_URI : null,
    look: project.brief?.look,
    family: project.brief?.styleFamily
  });

  const bootstrap = [
    `<script>window.__hfVariables = ${scriptJson(variables)};</script>`,
    `<script src="/runtime.js"></script>`,
    `<script src="/gsap.js"></script>`
  ].join("\n  ");
  const merge = `<script>(function () { try { var block = document.getElementById("hf-variables"); var edits = JSON.parse(block && block.textContent || "{}"); if (edits && typeof edits === "object" && !Array.isArray(edits)) window.__hfVariables = Object.assign({}, window.__hfVariables || {}, edits); } catch (error) {} })();</script>`;

  let html = stampCanvas(templateHtml, plan.canvas);
  html = html.replace('<script src="vendor/gsap.min.js"></script>', () => bootstrap);
  html = fillTextBlock(html, hfBlockValues(plan.beats, plan.overrides));
  html = html.replace(/(<script id="hf-variables" type="application\/json">[\s\S]*?<\/script>)/, (b) => `${b}\n  ${merge}`);
  html = html.replace(
    "</head>",
    () =>
      `  <style id="fonts">\n${bundledFonts}\n  </style>\n  <style id="theme" data-theme="${look.brand ? "brand" : look.theme}">\n${look.themeCss}\n  </style>\n</head>`
  );

  return { html, canvas: CANVAS[plan.canvas] };
}

/**
 * Computes a deterministic version token for a project's current `beatPlan`, so `commit` can
 * detect if the plan changed since `propose` and refuse stale commits with HTTP 409.
 */
export function computePlanVersion(project: Pick<VideoProject, "beatPlan" | "brief">): string {
  const payload = JSON.stringify({
    beatPlan: project.beatPlan ?? null,
    look: project.brief?.look ?? "clean",
    styleFamily: project.brief?.styleFamily ?? null
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Resolves the beat and sample timestamps covering the active window of a beat around `atSeconds`.
 * Uses `@videosaas/contracts`'s `resolveBeatWindowTimes` with the project's computed beat timing.
 */
export function resolveBeatWindowTimes(
  project: VideoProject,
  sceneRef: string | number | undefined,
  atSeconds: number,
  beatTimesOverride?: BeatWindowTimingInput
): { beat: Beat; beatIndex: number; start: number; end: number; sampleTimes: number[] } {
  const timing = beatTimesOverride ?? (project.beatPlan ? projectTiming(project)?.beats : undefined);
  return resolveBeatWindowTimesContract(project, sceneRef, atSeconds, timing);
}

export class EditRefusedError extends Error {
  readonly code = "edit_refused";
  readonly details: unknown;
  readonly commentId?: string;
  constructor(message: string, details?: unknown, commentId?: string) {
    super(message);
    this.name = "EditRefusedError";
    this.details = details;
    this.commentId = commentId;
  }
}

export class InvalidSnapshotsError extends Error {
  readonly code = "invalid_snapshots";
  constructor(message: string) {
    super(message);
    this.name = "InvalidSnapshotsError";
  }
}

export class StalePlanVersionError extends Error {
  readonly code = "stale_plan_version";
  readonly currentPlanVersion: string;
  constructor(currentPlanVersion: string) {
    super("The storyboard changed since this edit was proposed. Please apply your comment again.");
    this.name = "StalePlanVersionError";
    this.currentPlanVersion = currentPlanVersion;
  }
}

export type ModelTranslatorOptions = {
  request?: typeof fetch;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
  model?: string;
};

/**
 * Model-backed `CommentPatchTranslator` using `COMMENT_TO_PATCH_SYSTEM_PROMPT` and the backend's
 * shared `anthropicMessage` client (timeouts, retries, and `anthropic_usage` cost logging).
 *
 * Output is strictly validated with `validateEditPatch` and checked against `activeElements`.
 * Anything invalid becomes `"scene"` with an empty `set` (triggering the existing storyboard rewrite), never a guess.
 */
export function createModelCommentTranslator(options: ModelTranslatorOptions = {}): CommentPatchTranslator {
  return {
    async translate({ comment, atSeconds, scene, beat, activeElements, canvas }) {
      const beatId = typeof scene === "string" ? scene : beat?.id ?? `b${Number(scene) + 1}`;
      const fallbackScenePatch: EditPatch = {
        scope: "scene",
        scene: beatId,
        atSeconds,
        set: {}
      };

      const elementSummary = activeElements.map((el) => ({
        id: el.id,
        role: el.role,
        text: el.text,
        box: el.box
      }));

      const userPrompt = [
        `comment: ${JSON.stringify(comment)}`,
        `atSeconds: ${atSeconds}`,
        `scene: ${beatId} (kind: ${beat?.kind ?? "kinetic"}${beat?.keyword ? `, keyword: ${JSON.stringify(beat.keyword)}` : ""}${beat?.on_screen ? `, on_screen: ${JSON.stringify(beat.on_screen)}` : ""})`,
        ...(canvas ? [`canvas: ${canvas.width}x${canvas.height}`] : []),
        `activeElements: ${JSON.stringify(elementSummary)}`,
        "Return ONLY the JSON object matching the schema."
      ].join("\n");

      const payload = await anthropicMessage(
        {
          model: options.model ?? config.anthropicModel,
          max_tokens: 450,
          system: COMMENT_TO_PATCH_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        },
        {
          ...(options.request ? { request: options.request } : {}),
          ...(options.log ? { log: options.log } : {}),
          ...(options.sleep ? { sleep: options.sleep } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          timeoutMs: options.timeoutMs ?? 30_000,
          errorPrefix: "Comment patch translation failed",
          includeErrorDetail: true
        }
      );

      const text = responseText(payload).trim();
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace < 0 || lastBrace <= firstBrace) {
        return fallbackScenePatch;
      }

      let rawObj: Record<string, unknown>;
      try {
        const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return fallbackScenePatch;
        }
        rawObj = parsed as Record<string, unknown>;
      } catch {
        return fallbackScenePatch;
      }

      // If the model explicitly refuses an impossible visual request (e.g., 3D spin / particle effects), surface the refusal
      if (typeof rawObj.refused === "string" && rawObj.refused.trim()) {
        throw new EditRefusedError(rawObj.refused.trim());
      }

      // Check if the model returned an out-of-range scale/factor before general validation
      const rawSet =
        rawObj.set && typeof rawObj.set === "object" && !Array.isArray(rawObj.set)
          ? (rawObj.set as Record<string, unknown>)
          : {};
      const rawFactor = rawSet.factor ?? rawSet.scale;
      if (typeof rawFactor === "number" && Number.isFinite(rawFactor)) {
        const hintCheck = validateBeatLayoutHint({
          emphasize: typeof rawSet.emphasize === "string" ? rawSet.emphasize : typeof rawObj.el === "string" ? rawObj.el : "kw",
          factor: rawFactor
        });
        if ("error" in hintCheck) {
          throw new EditRefusedError(hintCheck.error);
        }
      }

      const candidateInput = {
        ...rawObj,
        scene: typeof rawObj.scene === "string" && rawObj.scene.trim() ? rawObj.scene : beatId,
        atSeconds: typeof rawObj.atSeconds === "number" && Number.isFinite(rawObj.atSeconds) ? rawObj.atSeconds : atSeconds
      };

      const validated = validateEditPatch(candidateInput);
      if ("error" in validated) {
        return fallbackScenePatch;
      }

      const patch = validated.patch;

      // Never guess an element id: if `el` is provided, it must exist in `activeElements`
      if (patch.el !== undefined) {
        const existsInActive = activeElements.some((el) => el.id === patch.el);
        if (!existsInActive) {
          return fallbackScenePatch;
        }
      }

      // If the patch has no concrete operations, treat it as a scene-level storyboard rewrite
      if (!hasEditPatchOperations(patch)) {
        return fallbackScenePatch;
      }

      return {
        ...patch,
        scene: beatId,
        atSeconds
      };
    }
  };
}

let defaultModelTranslatorOptions: ModelTranslatorOptions | null = null;
export function setDefaultModelTranslatorOptions(options: ModelTranslatorOptions | null): void {
  defaultModelTranslatorOptions = options;
}

export const modelCommentTranslator: CommentPatchTranslator = createModelCommentTranslator();

/**
 * Translates a comment using `deterministicCommentTranslator` first, then falls back to `modelTranslator`
 * when the deterministic rules find no patch.
 */
export async function translateCommentWithRulesThenModel(
  input: {
    comment: string;
    atSeconds: number;
    scene: string;
    beat: Beat;
    activeElements: ActiveElementInfo[];
    canvas: { width: number; height: number };
  },
  options?: {
    translator?: CommentPatchTranslator;
    modelTranslator?: CommentPatchTranslator;
    modelOptions?: ModelTranslatorOptions;
  }
): Promise<{
  patch: EditPatch;
  source: "deterministic" | "model" | "fallback-scene";
  fallbackRewrite: boolean;
}> {
  if (options?.translator) {
    const customPatch = await options.translator.translate(input);
    const rawFactor = customPatch?.set?.factor ?? customPatch?.set?.scale;
    if (typeof rawFactor === "number" && Number.isFinite(rawFactor)) {
      const hintCheck = validateBeatLayoutHint({
        emphasize: customPatch.set?.emphasize ?? customPatch.el ?? "kw",
        factor: rawFactor
      });
      if ("error" in hintCheck) throw new EditRefusedError(hintCheck.error);
    }
    const validated = validateEditPatch(customPatch);
    if ("error" in validated) {
      return {
        patch: { scope: "scene", scene: input.scene, atSeconds: input.atSeconds, set: {} },
        source: "fallback-scene",
        fallbackRewrite: true
      };
    }
    if (validated.patch.el && !input.activeElements.some((e) => e.id === validated.patch.el)) {
      return {
        patch: { scope: "scene", scene: input.scene, atSeconds: input.atSeconds, set: {} },
        source: "fallback-scene",
        fallbackRewrite: true
      };
    }
    const hasOps = hasEditPatchOperations(validated.patch);
    return {
      patch: hasOps
        ? { ...validated.patch, scene: input.scene, atSeconds: input.atSeconds }
        : { scope: "scene", scene: input.scene, atSeconds: input.atSeconds, set: {} },
      source: hasOps ? "model" : "fallback-scene",
      fallbackRewrite: !hasOps
    };
  }

  // Step 1: Run deterministicCommentTranslator first
  const detRaw = await deterministicCommentTranslator.translate(input);
  if (hasEditPatchOperations(detRaw)) {
    const rawFactor = detRaw.set?.factor ?? detRaw.set?.scale;
    if (typeof rawFactor === "number" && Number.isFinite(rawFactor)) {
      const hintCheck = validateBeatLayoutHint({
        emphasize: detRaw.set?.emphasize ?? detRaw.el ?? "kw",
        factor: rawFactor
      });
      if ("error" in hintCheck) {
        throw new EditRefusedError(hintCheck.error);
      }
    }
    const validatedDet = validateEditPatch(detRaw);
    if ("patch" in validatedDet) {
      return {
        patch: { ...validatedDet.patch, scene: input.scene, atSeconds: input.atSeconds },
        source: "deterministic",
        fallbackRewrite: false
      };
    }
  }

  // Step 2: Deterministic rules found no patch -> call model translator if configured or stubbed
  const effectiveModelOptions = options?.modelOptions ?? defaultModelTranslatorOptions ?? undefined;
  const hasModelStubOrKey =
    Boolean(options?.modelTranslator) ||
    Boolean(effectiveModelOptions?.request) ||
    (config.planner !== "deterministic" && Boolean(config.anthropicApiKey));

  if (!hasModelStubOrKey) {
    return {
      patch: { scope: "scene", scene: input.scene, atSeconds: input.atSeconds, set: {} },
      source: "fallback-scene",
      fallbackRewrite: true
    };
  }

  const modelTrans =
    options?.modelTranslator ??
    (effectiveModelOptions ? createModelCommentTranslator(effectiveModelOptions) : modelCommentTranslator);

  const modelPatch = await modelTrans.translate(input);
  const rawModelFactor = modelPatch?.set?.factor ?? modelPatch?.set?.scale;
  if (typeof rawModelFactor === "number" && Number.isFinite(rawModelFactor)) {
    const hintCheck = validateBeatLayoutHint({
      emphasize: modelPatch.set?.emphasize ?? modelPatch.el ?? "kw",
      factor: rawModelFactor
    });
    if ("error" in hintCheck) {
      throw new EditRefusedError(hintCheck.error);
    }
  }
  const validatedModel = validateEditPatch(modelPatch);
  if ("error" in validatedModel) {
    return {
      patch: { scope: "scene", scene: input.scene, atSeconds: input.atSeconds, set: {} },
      source: "fallback-scene",
      fallbackRewrite: true
    };
  }

  if (validatedModel.patch.el && !input.activeElements.some((e) => e.id === validatedModel.patch.el)) {
    return {
      patch: { scope: "scene", scene: input.scene, atSeconds: input.atSeconds, set: {} },
      source: "fallback-scene",
      fallbackRewrite: true
    };
  }

  const hasOps = hasEditPatchOperations(validatedModel.patch);
  if (!hasOps) {
    return {
      patch: { scope: "scene", scene: input.scene, atSeconds: input.atSeconds, set: {} },
      source: "fallback-scene",
      fallbackRewrite: true
    };
  }

  return {
    patch: { ...validatedModel.patch, scene: input.scene, atSeconds: input.atSeconds },
    source: "model",
    fallbackRewrite: false
  };
}

export type ProposeCommentItem = {
  id: string;
  at: number;
  scene?: string | number;
  body?: string;
  patch?: unknown;
};

export type ProposeCandidateItem = {
  id: string;
  patch?: EditPatch;
  refused?: string;
  fallbackRewrite?: boolean;
  source?: "explicit" | "deterministic" | "model" | "fallback-scene";
};

export type ProposeEditResult = {
  planVersion: string;
  candidates: ProposeCandidateItem[];
};

/**
 * Step 1 of the two-step edit protocol (`POST /v1/projects/:id/plan/edit/propose`):
 * Validates browser-measured snapshots across the active window of each commented beat,
 * translates each comment (rules first, then model), and returns candidate `EditPatch`es
 * (or `{ refused: reason }`) plus `planVersion`. Nothing is saved.
 */
export async function proposeHyperFramesCommentEdits(
  project: VideoProject,
  input: {
    comments: unknown;
    measured: unknown;
  },
  options?: {
    translator?: CommentPatchTranslator;
    modelTranslator?: CommentPatchTranslator;
    modelOptions?: ModelTranslatorOptions;
  }
): Promise<ProposeEditResult> {
  if (!project.beatPlan) throw new Error("Generate the plan first.");
  if (!Array.isArray(input.comments) || input.comments.length === 0) {
    throw new InvalidSnapshotsError("Provide at least one comment to propose.");
  }
  if (input.comments.length > 24) {
    throw new InvalidSnapshotsError("Too many comments in one request (at most 24).");
  }
  if (!input.measured || typeof input.measured !== "object" || Array.isArray(input.measured)) {
    throw new InvalidSnapshotsError("Measured payload with canvas and snapshots is required.");
  }
  const measuredObj = input.measured as Record<string, unknown>;
  const checkedCanvas = validateCanvasDimensions(measuredObj.canvas);
  if ("error" in checkedCanvas) {
    throw new InvalidSnapshotsError(checkedCanvas.error);
  }
  if (!measuredObj.snapshots || typeof measuredObj.snapshots !== "object" || Array.isArray(measuredObj.snapshots)) {
    throw new InvalidSnapshotsError("Measured snapshots must be an object keyed by comment id.");
  }
  const snapshotsMap = measuredObj.snapshots as Record<string, unknown>;
  const validBeatIds = new Set(project.beatPlan.beats.map((b) => b.id));

  const candidates: ProposeCandidateItem[] = [];

  for (let i = 0; i < input.comments.length; i++) {
    const rawComment = input.comments[i];
    if (!rawComment || typeof rawComment !== "object" || Array.isArray(rawComment)) {
      throw new InvalidSnapshotsError(`Comment at index ${i} must be an object.`);
    }
    const c = rawComment as Record<string, unknown>;
    const id = typeof c.id === "string" && c.id.trim() ? c.id.trim() : "";
    if (!id || id.length > 128) {
      throw new InvalidSnapshotsError(`Comment at index ${i} must have a valid id string.`);
    }
    const atSeconds =
      typeof c.at === "number" && Number.isFinite(c.at) && c.at >= 0 && c.at <= 3600 ? c.at : NaN;
    if (Number.isNaN(atSeconds)) {
      throw new InvalidSnapshotsError(`Comment "${id}" must have a finite "at" timestamp between 0 and 3600.`);
    }
    let sceneRef: string | number | undefined;
    if (c.scene !== undefined && c.scene !== null) {
      if (typeof c.scene === "string") {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(c.scene)) {
          throw new InvalidSnapshotsError(`Comment "${id}" has an invalid scene id.`);
        }
        sceneRef = c.scene;
      } else if (typeof c.scene === "number" && Number.isInteger(c.scene) && c.scene >= 0 && c.scene <= 512) {
        sceneRef = c.scene;
      } else {
        throw new InvalidSnapshotsError(`Comment "${id}" has an invalid scene reference.`);
      }
    }

    const rawSnaps = snapshotsMap[id];
    const checkedSnaps = validateFrameElementsSnapshots(rawSnaps, validBeatIds);
    if ("error" in checkedSnaps) {
      throw new InvalidSnapshotsError(`Invalid snapshots for comment "${id}": ${checkedSnaps.error}`);
    }

    const { beat } = resolveBeatWindowTimes(project, sceneRef, atSeconds);
    const activeElements = mergeWindowElements(checkedSnaps.snapshots);

    if (c.patch !== undefined && c.patch !== null) {
      const rawPatchObj =
        typeof c.patch === "object" && !Array.isArray(c.patch) ? (c.patch as Record<string, unknown>) : {};
      const rawSet =
        rawPatchObj.set && typeof rawPatchObj.set === "object" && !Array.isArray(rawPatchObj.set)
          ? (rawPatchObj.set as Record<string, unknown>)
          : {};
      const rawFactor = rawSet.factor ?? rawSet.scale;
      if (typeof rawFactor === "number" && Number.isFinite(rawFactor)) {
        const hintCheck = validateBeatLayoutHint({
          emphasize:
            typeof rawSet.emphasize === "string"
              ? rawSet.emphasize
              : typeof rawPatchObj.el === "string"
              ? rawPatchObj.el
              : "kw",
          factor: rawFactor
        });
        if ("error" in hintCheck) {
          candidates.push({ id, refused: hintCheck.error, source: "explicit" });
          continue;
        }
      }
      const validated = validateEditPatch(c.patch);
      if ("error" in validated) {
        candidates.push({ id, refused: validated.error, source: "explicit" });
        continue;
      }
      if (validated.patch.el && !isValidPlanElementId(validated.patch.el, validBeatIds)) {
        candidates.push({
          id,
          refused: `Element "${validated.patch.el}" does not exist in this plan.`,
          source: "explicit"
        });
        continue;
      }
      candidates.push({
        id,
        patch: { ...validated.patch, scene: beat.id, atSeconds },
        source: "explicit"
      });
      continue;
    }

    const bodyText = typeof c.body === "string" ? c.body.trim() : "";
    if (!bodyText) {
      candidates.push({ id, refused: "Provide a comment or a patch." });
      continue;
    }

    try {
      const translated = await translateCommentWithRulesThenModel(
        {
          comment: bodyText,
          atSeconds,
          scene: beat.id,
          beat,
          activeElements,
          canvas: checkedCanvas.canvas
        },
        options
      );
      candidates.push({
        id,
        patch: translated.patch,
        ...(translated.fallbackRewrite ? { fallbackRewrite: true } : {}),
        source: translated.source
      });
    } catch (err) {
      if (err instanceof EditRefusedError) {
        candidates.push({ id, refused: err.message });
      } else {
        throw err;
      }
    }
  }

  return {
    planVersion: computePlanVersion(project),
    candidates
  };
}

export type CommitCommentEditItemResult = {
  id: string;
  scope: "element" | "scene";
  uiLabel: string;
  el?: string;
  fallbackRewrite?: boolean;
  patch: EditPatch;
  decision: ClassifierDecision;
  elementsBefore: ActiveElementInfo[];
  elementsAfter: ActiveElementInfo[];
};

export type CommitEditResult = {
  plan: BeatPlan;
  results: CommitCommentEditItemResult[];
};

/**
 * Step 2 of the two-step edit protocol (`POST /v1/projects/:id/plan/edit/commit`):
 * Verifies `planVersion` (409 on mismatch), validates `before` and `after` snapshots from the browser,
 * re-runs the pure `classifyEditPatch` and `checkSceneHintLayout` classifiers on the server,
 * and returns the updated `BeatPlan` plus per-comment `{ id, scope, uiLabel, el, patch, decision }`.
 */
export function commitHyperFramesCommentEdits(
  project: VideoProject,
  input: {
    planVersion: unknown;
    items: unknown;
  }
): CommitEditResult {
  if (!project.beatPlan) throw new Error("Generate the plan first.");
  const currentVersion = computePlanVersion(project);
  if (typeof input.planVersion !== "string" || input.planVersion !== currentVersion) {
    throw new StalePlanVersionError(currentVersion);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new InvalidSnapshotsError("Provide at least one edit item to commit.");
  }
  if (input.items.length > 24) {
    throw new InvalidSnapshotsError("Too many edit items in one commit (at most 24).");
  }

  // The plan's own canvas decides the safe-area and overlap checks; a browser-sent size is never trusted.
  const canvas = CANVAS[project.beatPlan.canvas];

  const validBeatIds = new Set(project.beatPlan.beats.map((b) => b.id));
  const workingPlan: BeatPlan = structuredClone(project.beatPlan);
  const results: CommitCommentEditItemResult[] = [];

  for (let i = 0; i < input.items.length; i++) {
    const rawItem = input.items[i];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new InvalidSnapshotsError(`Commit item at index ${i} must be an object.`);
    }
    const item = rawItem as Record<string, unknown>;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `item-${i}`;

    // Check out-of-range hint factor before general patch validation so factor=3.5 returns 422 edit_refused
    if (item.patch && typeof item.patch === "object" && !Array.isArray(item.patch)) {
      const pObj = item.patch as Record<string, unknown>;
      const sObj =
        pObj.set && typeof pObj.set === "object" && !Array.isArray(pObj.set)
          ? (pObj.set as Record<string, unknown>)
          : {};
      const rawFactor = sObj.factor ?? sObj.scale;
      if (typeof rawFactor === "number" && Number.isFinite(rawFactor)) {
        const hintCheck = validateBeatLayoutHint({
          emphasize:
            typeof sObj.emphasize === "string"
              ? sObj.emphasize
              : typeof pObj.el === "string"
              ? pObj.el
              : "kw",
          factor: rawFactor
        });
        if ("error" in hintCheck) {
          throw new EditRefusedError(hintCheck.error, null, id);
        }
      }
    }

    const validatedPatch = validateEditPatch(item.patch);
    if ("error" in validatedPatch) {
      throw new InvalidSnapshotsError(`Invalid patch on item "${id}": ${validatedPatch.error}`);
    }
    const candidatePatch = validatedPatch.patch;
    if (candidatePatch.el && !isValidPlanElementId(candidatePatch.el, validBeatIds)) {
      throw new InvalidSnapshotsError(
        `Element "${candidatePatch.el}" on item "${id}" is not valid for this plan's data-el scheme.`
      );
    }

    const checkedBefore = validateFrameElementsSnapshots(item.before, validBeatIds);
    if ("error" in checkedBefore) {
      throw new InvalidSnapshotsError(`Invalid "before" snapshots on item "${id}": ${checkedBefore.error}`);
    }
    const checkedAfter = validateFrameElementsSnapshots(item.after, validBeatIds);
    if ("error" in checkedAfter) {
      throw new InvalidSnapshotsError(`Invalid "after" snapshots on item "${id}": ${checkedAfter.error}`);
    }

    const beforeSnaps: FrameElementsSnapshot[] = checkedBefore.snapshots;
    const afterSnaps: FrameElementsSnapshot[] = checkedAfter.snapshots;
    if (beforeSnaps.length !== afterSnaps.length) {
      throw new InvalidSnapshotsError(
        `Item "${id}" has unequal before (${beforeSnaps.length}) and after (${afterSnaps.length}) snapshot counts.`
      );
    }
    const elementsBefore = mergeWindowElements(beforeSnaps);
    const elementsAfter = mergeWindowElements(afterSnaps);

    const { beat, beatIndex } = resolveBeatWindowTimes(
      { ...project, beatPlan: workingPlan },
      candidatePatch.scene,
      candidatePatch.atSeconds
    );
    const normalizedPatch: EditPatch = { ...candidatePatch, scene: beat.id };

    const decision = classifyEditPatch({
      patch: normalizedPatch,
      canvas,
      beforeWindow: beforeSnaps,
      afterWindow: afterSnaps
    });

    const isFallbackRewrite =
      item.fallbackRewrite === true || (!normalizedPatch.el && !hasEditPatchOperations(normalizedPatch));

    if (decision.scope === "element" && normalizedPatch.el && !isFallbackRewrite) {
      workingPlan.overrides = { ...(workingPlan.overrides ?? {}) };
      const prevOv = workingPlan.overrides[normalizedPatch.el] ?? {};
      workingPlan.overrides[normalizedPatch.el] = {
        ...prevOv,
        ...(normalizedPatch.set.color !== undefined ? { color: normalizedPatch.set.color } : {}),
        ...(normalizedPatch.set.opacity !== undefined ? { opacity: normalizedPatch.set.opacity } : {}),
        ...(normalizedPatch.set.dx !== undefined ? { dx: Math.max(-4000, Math.min(4000, (prevOv.dx ?? 0) + normalizedPatch.set.dx)) } : {}),
        ...(normalizedPatch.set.dy !== undefined ? { dy: Math.max(-4000, Math.min(4000, (prevOv.dy ?? 0) + normalizedPatch.set.dy)) } : {}),
        ...(normalizedPatch.text !== undefined ? { text: normalizedPatch.text } : {})
      };
      const finalPatch: EditPatch = { ...normalizedPatch, scope: "element" };
      results.push({
        id,
        scope: "element",
        uiLabel: decision.uiLabel,
        el: normalizedPatch.el,
        patch: finalPatch,
        decision,
        elementsBefore,
        elementsAfter
      });
      continue;
    }

    // Scene-level execution:
    if (decision.reason === "overlap-detected") {
      throw new EditRefusedError(
        `That move would overlap with another element on screen (${decision.measurements.collidingElements.join(", ")}). Try a smaller nudge or rewording the scene.`,
        decision,
        id
      );
    }
    if (decision.reason === "left-safe-area") {
      const v = decision.measurements.safeAreaViolations[0];
      throw new EditRefusedError(
        `That position leaves the ${v?.kind ?? "safe"} area of the frame. Keep elements inside the safe margins so nothing is clipped.`,
        decision,
        id
      );
    }

    if (isFallbackRewrite) {
      const finalPatch: EditPatch = { ...normalizedPatch, scope: "scene" };
      const finalDecision: ClassifierDecision = {
        ...decision,
        scope: "scene",
        uiLabel: "re-laid out the scene"
      };
      results.push({
        id,
        scope: "scene",
        uiLabel: "re-laid out the scene",
        fallbackRewrite: true,
        patch: finalPatch,
        decision: finalDecision,
        elementsBefore,
        elementsAfter
      });
      continue;
    }

    const targetBeat = workingPlan.beats[beatIndex]!;

    if (normalizedPatch.el && (normalizedPatch.set.color !== undefined || normalizedPatch.set.opacity !== undefined)) {
      workingPlan.overrides = { ...(workingPlan.overrides ?? {}) };
      const prevOv = workingPlan.overrides[normalizedPatch.el] ?? {};
      workingPlan.overrides[normalizedPatch.el] = {
        ...prevOv,
        ...(normalizedPatch.set.color !== undefined ? { color: normalizedPatch.set.color } : {}),
        ...(normalizedPatch.set.opacity !== undefined ? { opacity: normalizedPatch.set.opacity } : {})
      };
    }

    if (normalizedPatch.text !== undefined) {
      const newText = plainText(normalizedPatch.text);
      const targetEl = elementsBefore.find((e) => e.id === normalizedPatch.el);
      if (targetEl?.role === "subtitle") {
        targetBeat.on_screen = newText;
      } else if (targetEl?.role === "pill") {
        targetBeat.on_screen = newText;
      } else if (targetEl && (targetEl.role === "word" || targetEl.role === "accent-word")) {
        const kwWords = targetBeat.keyword.split(/\s+/).filter(Boolean);
        const wordMatch = /^b\d+:w:(\d+)$/.exec(targetEl.id);
        if (wordMatch && newText.split(/\s+/).length === 1) {
          const wIdx = Number(wordMatch[1]);
          if (wIdx >= 0 && wIdx < kwWords.length) {
            kwWords[wIdx] = newText;
            targetBeat.keyword = kwWords.join(" ");
          } else {
            targetBeat.keyword = newText;
          }
        } else {
          targetBeat.keyword = newText;
        }
        if (workingPlan.overrides) {
          for (const k of Object.keys(workingPlan.overrides)) {
            if (k.startsWith(`${targetBeat.id}:w:`) && workingPlan.overrides[k]?.text) {
              delete workingPlan.overrides[k]!.text;
              if (Object.keys(workingPlan.overrides[k]!).length === 0) delete workingPlan.overrides[k];
            }
          }
        }
      } else {
        targetBeat.keyword = newText;
      }
    }

    const rawFactor = normalizedPatch.set.factor ?? normalizedPatch.set.scale;
    if (rawFactor !== undefined) {
      const hintCandidate: BeatLayoutHint = {
        emphasize: normalizedPatch.set.emphasize ?? normalizedPatch.el ?? "kw",
        factor: rawFactor
      };
      const validatedHint = validateBeatLayoutHint(hintCandidate);
      if ("error" in validatedHint) {
        throw new EditRefusedError(validatedHint.error, decision, id);
      }
      targetBeat.hints = validatedHint.hints;
    }

    // Verify the scene-level layout against the measured after-snapshots: a hint or scene re-layout may NEVER produce overlaps or leave the safe area.
    const layoutCheck = checkSceneHintLayout(afterSnaps, canvas, targetBeat.id, beforeSnaps);
    if (!layoutCheck.ok) {
      const reasonMsg =
        layoutCheck.overlaps.length > 0
          ? `Cannot satisfy that layout change without overlapping "${layoutCheck.overlaps[0]!.a}" and "${layoutCheck.overlaps[0]!.b}".`
          : `Cannot satisfy that layout change while keeping "${layoutCheck.safeAreaViolations[0]!.id}" inside the ${layoutCheck.safeAreaViolations[0]!.kind} area.`;
      throw new EditRefusedError(reasonMsg, { decision, layoutCheck }, id);
    }

    const finalPatch: EditPatch = {
      ...normalizedPatch,
      scope: "scene",
      set: {
        ...normalizedPatch.set,
        ...(targetBeat.hints?.factor ? { factor: targetBeat.hints.factor } : {}),
        ...(targetBeat.hints?.emphasize ? { emphasize: targetBeat.hints.emphasize } : {})
      }
    };

    const finalDecision: ClassifierDecision = {
      ...decision,
      scope: "scene",
      uiLabel: describeEditAction(finalPatch)
    };

    results.push({
      id,
      scope: "scene",
      uiLabel: finalDecision.uiLabel,
      ...(normalizedPatch.el ? { el: normalizedPatch.el } : {}),
      patch: finalPatch,
      decision: finalDecision,
      elementsBefore,
      elementsAfter
    });
  }

  return {
    plan: workingPlan,
    results
  };
}
