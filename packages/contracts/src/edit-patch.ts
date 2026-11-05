import { plainText, type Aspect, type Beat, type BeatPlan } from "./beat-plan.ts";

/**
 * Shared element-level and scene-level comment edit patch contract and classifier
 * (used by both HyperFrames and code-drawn plates).
 *
 * The classifier — never the model — decides whether a candidate change stays at
 * `"element"` scope or escalates to `"scene"` scope based on measured bounding boxes,
 * overlaps, and safe-area margins (`hyperframes-studio`: action-safe 90%, title-safe 80%
 * for text and captions).
 */

export const editScopes = ["element", "scene"] as const;
export type EditScope = (typeof editScopes)[number];

export type EditElementProperties = {
  /** CSS hex or token color override for the target element. */
  color?: string;
  /** Opacity override in [0, 1]. */
  opacity?: number;
  /** Horizontal position offset in composition pixels (CSS `translate`). */
  dx?: number;
  /** Vertical position offset in composition pixels (CSS `translate`). */
  dy?: number;
  /** Scale factor (> 0). Note: scaling an element always escalates to scene scope so the whole frame is re-laid-out. */
  scale?: number;
  /** Scene-level layout emphasis factor (> 0). */
  factor?: number;
  /** Scene-level layout emphasis target element id. */
  emphasize?: string;
  /** Optional text replacement when carried inside `set`. */
  text?: string;
};

export type EditPatch = {
  /** Decided by the classifier (`"element"` or `"scene"`), never trusted blindly from a model. */
  scope: EditScope;
  /** Scene index (0-based) or beat id (e.g. `"b1"`). */
  scene: number | string;
  /** Timestamp in seconds on the film clock where the comment was pinned. */
  atSeconds: number;
  /** Stable element id (e.g. `"b1:w:2"`) when targeting a specific element. */
  el?: string;
  /** Typed property overrides or scene layout parameters. */
  set: EditElementProperties;
  /** Replacement text for the target element or scene beat. */
  text?: string;
};

/** Stored per-element override in the `hf-variables` block (`overrides[id]`). */
export type HyperFramesElementOverride = {
  color?: string;
  opacity?: number;
  dx?: number;
  dy?: number;
  text?: string;
};

export type HyperFramesOverridesMap = Record<string, HyperFramesElementOverride>;

/** Stored scene-level layout hint on a beat (`beat.hints`). */
export type BeatLayoutHint = {
  /** Target element id (e.g. `"b2:w:2"`) or `"keyword"` / `"on_screen"` / `"pill"` / `"name"`. */
  emphasize?: string;
  /** Multiplicative size factor for the emphasized target or scene text (e.g. `1.3` for bigger, `0.8` for smaller). */
  factor?: number;
};

/** Bounding box in composition canvas pixels `[x, y, width, height]`. */
export type ElementBoxTuple = [number, number, number, number];

/** An active element published by the composition at a given timestamp `t`. */
export type ActiveElementInfo = {
  /** Stable element id stamped by the engine (`data-el`), e.g. `"b1:w:0"`. */
  id: string;
  /** Element role (`"word"`, `"accent-word"`, `"subtitle"`, `"name"`, `"pill"`, `"stat"`, `"type-text"`, `"caption"`, `"card"`, `"cursor"`, `"badge"`, `"decor"`). */
  role: string;
  /** Visible text content of the element (empty string for non-text elements). */
  text: string;
  /** Bounding box `[x, y, width, height]` in composition coordinates (`0..W`, `0..H`). */
  box: ElementBoxTuple;
  /** Beat id that owns this element (e.g. `"b1"`), or `"captions"` / `"wipes"`. */
  beat?: string;
  /** Effective opacity `[0..1]` at the sampled time. */
  opacity?: number;
};

/** Snapshot of all active elements at a single sampled timestamp. */
export type FrameElementsSnapshot = {
  time: number;
  elements: ActiveElementInfo[];
};

/** Safe-area inset shares from `hyperframes-studio` §4. */
export const SAFE_AREA_RULES = {
  /** Action-safe: 90% of the frame (5% inset on every edge). */
  actionSafeShare: 0.9,
  actionSafeInset: 0.05,
  /** Title-safe: 80% of the frame (10% inset on every edge) for text and captions. */
  titleSafeShare: 0.8,
  titleSafeInset: 0.1
} as const;

const TEXT_ROLES = new Set([
  "word",
  "accent-word",
  "char",
  "subtitle",
  "name",
  "pill",
  "stat",
  "type-text",
  "caption",
  "slate",
  "text"
]);

/** Roles that are background/carrier/decorative and intentionally sit behind foreground elements. */
const BACKGROUND_ROLES = new Set(["decor", "field", "halo", "wipe", "paper", "bg"]);

export function isTextRole(role: string): boolean {
  return TEXT_ROLES.has(role);
}

export function isBackgroundRole(role: string): boolean {
  return BACKGROUND_ROLES.has(role);
}

/**
 * Length class of a text string: equal-length-class text means the character count stays within
 * ±1 character (and within 10% for longer strings) and the word count is identical, so a character-count
 * layout engine does not need to reflow neighbouring lines unless measured boxes say otherwise.
 */
export function isSameTextLengthClass(beforeText: string, afterText: string): boolean {
  const a = plainText(beforeText);
  const b = plainText(afterText);
  if (!a || !b) return false;
  const aWords = a.split(/\s+/).filter(Boolean);
  const bWords = b.split(/\s+/).filter(Boolean);
  if (aWords.length !== bWords.length) return false;
  const diff = Math.abs(a.length - b.length);
  const tolerance = Math.max(1, Math.floor(a.length * 0.1));
  return diff <= tolerance;
}

/** Computes the safe-area rectangle `[minX, minY, maxX, maxY]` for a canvas and element role. */
export function safeAreaBounds(
  canvasWidth: number,
  canvasHeight: number,
  role: string
): { minX: number; minY: number; maxX: number; maxY: number; kind: "title-safe" | "action-safe" } {
  const titleSafe = isTextRole(role);
  const inset = titleSafe ? SAFE_AREA_RULES.titleSafeInset : SAFE_AREA_RULES.actionSafeInset;
  const padX = canvasWidth * inset;
  const padY = canvasHeight * inset;
  return {
    minX: padX,
    minY: padY,
    maxX: canvasWidth - padX,
    maxY: canvasHeight - padY,
    kind: titleSafe ? "title-safe" : "action-safe"
  };
}

/** Checks whether a bounding box `[x, y, w, h]` stays inside the given safe-area bounds (with 1.5px rounding tolerance). */
export function isBoxInsideSafeArea(
  box: ElementBoxTuple,
  canvasWidth: number,
  canvasHeight: number,
  role: string,
  tolerancePx = 1.5
): { ok: boolean; kind: "title-safe" | "action-safe"; bounds: { minX: number; minY: number; maxX: number; maxY: number } } {
  const bounds = safeAreaBounds(canvasWidth, canvasHeight, role);
  const [x, y, w, h] = box;
  if (w <= 0 || h <= 0) return { ok: true, kind: bounds.kind, bounds };
  const ok =
    x >= bounds.minX - tolerancePx &&
    y >= bounds.minY - tolerancePx &&
    x + w <= bounds.maxX + tolerancePx &&
    y + h <= bounds.maxY + tolerancePx;
  return { ok, kind: bounds.kind, bounds };
}

/** Returns the intersection area in square pixels between two `[x, y, w, h]` boxes (shrunk by `padPx` to ignore 1px kerning touch). */
export function boxesOverlapArea(a: ElementBoxTuple, b: ElementBoxTuple, padPx = 2): number {
  const ax0 = a[0] + padPx;
  const ay0 = a[1] + padPx;
  const ax1 = a[0] + a[2] - padPx;
  const ay1 = a[1] + a[3] - padPx;
  const bx0 = b[0] + padPx;
  const by0 = b[1] + padPx;
  const bx1 = b[0] + b[2] - padPx;
  const by1 = b[1] + b[3] - padPx;
  if (ax1 <= ax0 || ay1 <= ay0 || bx1 <= bx0 || by1 <= by0) return 0;
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  return ix * iy;
}

/** Maximum coordinate delta across `[x, y, w, h]` between two boxes. */
export function boxMaxDelta(a: ElementBoxTuple, b: ElementBoxTuple): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
    Math.abs(a[3] - b[3])
  );
}

export type ClassifierMeasurementInput = {
  /** Candidate patch before scope classification. */
  patch: EditPatch;
  /** Canvas dimensions in composition pixels. */
  canvas: { width: number; height: number };
  /** Target element's original text (if known). */
  originalText?: string;
  /** Snapshots across the target element's active window BEFORE applying the candidate override. */
  beforeWindow: FrameElementsSnapshot[];
  /** Snapshots at the exact same timestamps AFTER applying the candidate override. */
  afterWindow: FrameElementsSnapshot[];
};

export type ClassifierDecision = {
  /** Final authoritative scope (`"element"` or `"scene"`). */
  scope: EditScope;
  /** Whether the candidate was escalated from `"element"` to `"scene"`. */
  escalated: boolean;
  /** Reason code for the decision. */
  reason:
    | "pure-visual-override"
    | "equal-length-text"
    | "position-nudge-clean"
    | "scale-requires-scene-layout"
    | "longer-or-different-length-text"
    | "missing-target-element"
    | "neighbour-box-changed"
    | "overlap-detected"
    | "left-safe-area"
    | "explicit-scene-patch";
  /** Human-readable explanation of why the classifier chose this scope and what changed. */
  summary: string;
  /** UI label for the comment list: e.g. `"changed colour"` or `"re-laid out the scene"`. */
  uiLabel: string;
  /** Detailed measurements across the window. */
  measurements: {
    targetId: string | null;
    maxNeighbourDeltaPx: number;
    shiftedNeighbours: string[];
    collidingElements: string[];
    safeAreaViolations: { time: number; box: ElementBoxTuple; kind: "title-safe" | "action-safe" }[];
    targetBoxBefore: ElementBoxTuple | null;
    targetBoxAfter: ElementBoxTuple | null;
  };
};

/**
 * Describes an applied edit in plain user-facing words for the workspace comment list
 * ("changed colour", "changed opacity", "changed text", "moved element", or "re-laid out the scene").
 */
export function describeEditAction(patch: Pick<EditPatch, "scope" | "set" | "text">): string {
  if (patch.scope === "scene") {
    return "re-laid out the scene";
  }
  const parts: string[] = [];
  if (patch.set?.color) parts.push("changed colour");
  if (typeof patch.set?.opacity === "number") parts.push("changed opacity");
  if (patch.text !== undefined || patch.set?.text !== undefined) parts.push("changed text");
  if ((typeof patch.set?.dx === "number" && patch.set.dx !== 0) || (typeof patch.set?.dy === "number" && patch.set.dy !== 0)) {
    parts.push("nudged position");
  }
  return parts.length > 0 ? parts.join(" & ") : "updated element";
}

/**
 * Authoritative classifier: decides whether a candidate patch can be applied at `"element"` scope
 * or must escalate to `"scene"` scope.
 *
 * Rules from the product owner:
 * 1. Scaling (`set.scale != null && set.scale !== 1` or `set.factor != null`) is NEVER a blind per-element transform:
 *    growing or shrinking a word must make the scene reconsider the whole frame -> always `"scene"`.
 * 2. If no target element (`el`) is specified, or the target element does not exist in the active window -> `"scene"`.
 * 3. Text replacement whose length class differs from the original text -> `"scene"`.
 * 4. Across the entire active window of the target element:
 *    (a) every other element's bounding box must not change (tolerance 1.5 px),
 *    (b) no new overlap may appear between the target and any other foreground element,
 *    (c) the target must stay inside the safe area (title-safe 80% for text/captions, action-safe 90% for other elements).
 *    If any of (a), (b), or (c) fails, the patch escalates to `"scene"` scope.
 * 5. Colour, opacity, and equal-length-class text never escalate unless they change layout (a/b/c).
 */
export function classifyEditPatch(input: ClassifierMeasurementInput): ClassifierDecision {
  const { patch, canvas, beforeWindow, afterWindow } = input;
  if (
    !Array.isArray(beforeWindow) ||
    !Array.isArray(afterWindow) ||
    beforeWindow.length === 0 ||
    beforeWindow.length !== afterWindow.length
  ) {
    throw new Error("beforeWindow and afterWindow must be non-empty snapshot arrays of equal length.");
  }
  const targetId = patch.el ?? null;
  const newText = patch.text ?? patch.set?.text;
  const hasScale =
    (typeof patch.set?.scale === "number" && Math.abs(patch.set.scale - 1) > 1e-3) ||
    (typeof patch.set?.factor === "number" && Math.abs(patch.set.factor - 1) > 1e-3);
  const hasMove =
    (typeof patch.set?.dx === "number" && Math.abs(patch.set.dx) > 0) ||
    (typeof patch.set?.dy === "number" && Math.abs(patch.set.dy) > 0);

  const emptyMeasurements = {
    targetId,
    maxNeighbourDeltaPx: 0,
    shiftedNeighbours: [] as string[],
    collidingElements: [] as string[],
    safeAreaViolations: [] as { time: number; box: ElementBoxTuple; kind: "title-safe" | "action-safe" }[],
    targetBoxBefore: null as ElementBoxTuple | null,
    targetBoxAfter: null as ElementBoxTuple | null
  };

  if (hasScale) {
    return {
      scope: "scene",
      escalated: patch.scope === "element",
      reason: "scale-requires-scene-layout",
      summary: "Scaling an element requires re-laying out the scene so the whole frame is considered.",
      uiLabel: "re-laid out the scene",
      measurements: emptyMeasurements
    };
  }

  if (patch.scope === "scene" && !targetId) {
    return {
      scope: "scene",
      escalated: false,
      reason: "explicit-scene-patch",
      summary: "Scene-scoped edit re-lays out the scene.",
      uiLabel: "re-laid out the scene",
      measurements: emptyMeasurements
    };
  }

  if (!targetId) {
    return {
      scope: "scene",
      escalated: true,
      reason: "missing-target-element",
      summary: "No target element id was resolved at this timestamp; escalated to scene scope.",
      uiLabel: "re-laid out the scene",
      measurements: emptyMeasurements
    };
  }

  // Locate target element in beforeWindow
  let targetBefore: ActiveElementInfo | null = null;
  let targetAfter: ActiveElementInfo | null = null;
  for (const snap of beforeWindow) {
    const found = snap.elements.find((e) => e.id === targetId);
    if (found) {
      targetBefore = found;
      break;
    }
  }
  for (const snap of afterWindow) {
    const found = snap.elements.find((e) => e.id === targetId);
    if (found) {
      targetAfter = found;
      break;
    }
  }

  if (!targetBefore || !targetAfter) {
    if (patch.scope === "scene") {
      return {
        scope: "scene",
        escalated: false,
        reason: "explicit-scene-patch",
        summary: `Scene-scoped edit on "${targetId}" re-lays out the scene.`,
        uiLabel: "re-laid out the scene",
        measurements: emptyMeasurements
      };
    }
    return {
      scope: "scene",
      escalated: true,
      reason: "missing-target-element",
      summary: `Element "${targetId}" is not active during the sampled window; escalated to scene scope.`,
      uiLabel: "re-laid out the scene",
      measurements: emptyMeasurements
    };
  }

  const origText = input.originalText ?? targetBefore.text;
  if (newText !== undefined && !isSameTextLengthClass(origText, newText)) {
    return {
      scope: "scene",
      escalated: true,
      reason: "longer-or-different-length-text",
      summary: `Text change from "${origText}" to "${newText}" changes length class; escalated to scene scope.`,
      uiLabel: "re-laid out the scene",
      measurements: {
        ...emptyMeasurements,
        targetBoxBefore: targetBefore.box,
        targetBoxAfter: targetAfter.box
      }
    };
  }

  let maxNeighbourDeltaPx = 0;
  const shiftedSet = new Set<string>();
  const collidingSet = new Set<string>();
  const safeAreaViolations: { time: number; box: ElementBoxTuple; kind: "title-safe" | "action-safe" }[] = [];

  const isPureColorOrOpacity =
    newText === undefined &&
    !hasMove &&
    !hasScale &&
    (patch.set?.color !== undefined || patch.set?.opacity !== undefined);

  const count = Math.min(beforeWindow.length, afterWindow.length);
  for (let i = 0; i < count; i++) {
    const bSnap = beforeWindow[i]!;
    const aSnap = afterWindow[i]!;
    const bById = new Map(bSnap.elements.map((el) => [el.id, el]));
    const aTarget = aSnap.elements.find((el) => el.id === targetId);
    const bTarget = bById.get(targetId);

    // (a) Check every other element's bounding box
    for (const aEl of aSnap.elements) {
      if (aEl.id === targetId) continue;
      const bEl = bById.get(aEl.id);
      if (!bEl) continue;
      const delta = boxMaxDelta(bEl.box, aEl.box);
      if (delta > maxNeighbourDeltaPx) maxNeighbourDeltaPx = delta;
      if (delta > 1.5) {
        shiftedSet.add(aEl.id);
      }
    }

    if (!aTarget) continue;

    // (b) Check overlaps between target and any other foreground element
    if (!isPureColorOrOpacity) {
      for (const aEl of aSnap.elements) {
        if (aEl.id === targetId) continue;
        if (isBackgroundRole(aEl.role) || isBackgroundRole(aTarget.role)) continue;
        const afterOverlap = boxesOverlapArea(aTarget.box, aEl.box, 2);
        if (afterOverlap <= 0) continue;
        const bEl = bById.get(aEl.id);
        const beforeOverlap = bTarget && bEl ? boxesOverlapArea(bTarget.box, bEl.box, 2) : 0;
        // Escalate if an overlap appeared (or grew)
        if (afterOverlap > beforeOverlap + 4) {
          collidingSet.add(aEl.id);
        }
      }

      // (c) Check safe area on target when moved or when its box changed
      const boxChanged = !bTarget || boxMaxDelta(bTarget.box, aTarget.box) > 1.5;
      if (hasMove || boxChanged) {
        const safe = isBoxInsideSafeArea(aTarget.box, canvas.width, canvas.height, aTarget.role);
        if (!safe.ok) {
          safeAreaViolations.push({ time: aSnap.time, box: aTarget.box, kind: safe.kind });
        }
      }
    }
  }

  const measurements = {
    targetId,
    maxNeighbourDeltaPx: Math.round(maxNeighbourDeltaPx * 100) / 100,
    shiftedNeighbours: [...shiftedSet],
    collidingElements: [...collidingSet],
    safeAreaViolations,
    targetBoxBefore: targetBefore.box,
    targetBoxAfter: targetAfter.box
  };

  if (measurements.shiftedNeighbours.length > 0) {
    return {
      scope: "scene",
      escalated: true,
      reason: "neighbour-box-changed",
      summary: `Change to "${targetId}" shifted neighbour element(s) (${measurements.shiftedNeighbours.join(", ")}) by ${measurements.maxNeighbourDeltaPx}px; escalated to scene scope.`,
      uiLabel: "re-laid out the scene",
      measurements
    };
  }

  if (measurements.collidingElements.length > 0) {
    return {
      scope: "scene",
      escalated: true,
      reason: "overlap-detected",
      summary: `Change to "${targetId}" overlaps with ${measurements.collidingElements.join(", ")}; escalated to scene scope.`,
      uiLabel: "re-laid out the scene",
      measurements
    };
  }

  if (measurements.safeAreaViolations.length > 0) {
    const first = measurements.safeAreaViolations[0]!;
    return {
      scope: "scene",
      escalated: true,
      reason: "left-safe-area",
      summary: `Change to "${targetId}" leaves the ${first.kind} area at t=${first.time}s; escalated to scene scope.`,
      uiLabel: "re-laid out the scene",
      measurements
    };
  }

  if (patch.scope === "scene") {
    return {
      scope: "scene",
      escalated: false,
      reason: "explicit-scene-patch",
      summary: `Scene-scoped edit on "${targetId}" re-lays out the scene.`,
      uiLabel: "re-laid out the scene",
      measurements
    };
  }

  const finalPatch: EditPatch = { ...patch, scope: "element" };
  const reason = hasMove
    ? "position-nudge-clean"
    : newText !== undefined
    ? "equal-length-text"
    : "pure-visual-override";

  return {
    scope: "element",
    escalated: false,
    reason,
    summary: `Applied element-level override on "${targetId}" (${describeEditAction(finalPatch)}).`,
    uiLabel: describeEditAction(finalPatch),
    measurements
  };
}

/**
 * Checks whether a scene after applying a scene-level layout hint (`beat.hints`) has any
 * foreground text overlaps or safe-area violations across sampled timestamps.
 * For scene-level layouts, all elements must stay inside action-safe (90%) and the emphasized/changed
 * element must stay inside title-safe (80%) unless the engine's camera pan already moved it into the
 * action-safe margin in `beforeWindow`.
 */
export function checkSceneHintLayout(
  snapshots: FrameElementsSnapshot[],
  canvas: { width: number; height: number },
  beatId: string,
  beforeSnapshots?: FrameElementsSnapshot[]
): {
  ok: boolean;
  overlaps: { time: number; a: string; b: string; area: number }[];
  safeAreaViolations: { time: number; id: string; role: string; box: ElementBoxTuple; kind: "title-safe" | "action-safe" }[];
} {
  if (beforeSnapshots && beforeSnapshots.length !== snapshots.length) {
    throw new Error("beforeSnapshots and snapshots must have equal length.");
  }
  const overlaps: { time: number; a: string; b: string; area: number }[] = [];
  const safeAreaViolations: { time: number; id: string; role: string; box: ElementBoxTuple; kind: "title-safe" | "action-safe" }[] = [];

  for (let sIdx = 0; sIdx < snapshots.length; sIdx++) {
    const snap = snapshots[sIdx]!;
    const bSnap = beforeSnapshots?.[sIdx];
    const bById = bSnap ? new Map(bSnap.elements.map((e) => [e.id, e])) : null;
    const fg = snap.elements.filter(
      (el) =>
        (el.beat === beatId || el.id.startsWith(`${beatId}:`)) &&
        !isBackgroundRole(el.role) &&
        isTextRole(el.role)
    );
    for (let i = 0; i < fg.length; i++) {
      const a = fg[i]!;
      // Every element must always stay inside action-safe (90%, 5% inset)
      const actionSafe = isBoxInsideSafeArea(a.box, canvas.width, canvas.height, "card");
      if (!actionSafe.ok) {
        safeAreaViolations.push({ time: snap.time, id: a.id, role: a.role, box: a.box, kind: "action-safe" });
      } else {
        // Also check title-safe (80%, 10% inset), unless the camera pan on this beat already placed part of the text column outside title-safe before the hint
        const titleSafe = isBoxInsideSafeArea(a.box, canvas.width, canvas.height, a.role);
        if (!titleSafe.ok) {
          const prevEl = bById?.get(a.id);
          const beatFgBefore = bSnap
            ? bSnap.elements.filter(
                (el) =>
                  (el.beat === beatId || el.id.startsWith(`${beatId}:`)) &&
                  !isBackgroundRole(el.role) &&
                  isTextRole(el.role)
              )
            : [];
          const anyOutsideTitleSafeBefore = beatFgBefore.some(
            (el) => !isBoxInsideSafeArea(el.box, canvas.width, canvas.height, el.role).ok
          );
          const wasTitleSafeBefore = prevEl
            ? isBoxInsideSafeArea(prevEl.box, canvas.width, canvas.height, prevEl.role).ok && !anyOutsideTitleSafeBefore
            : !anyOutsideTitleSafeBefore;
          if (wasTitleSafeBefore) {
            safeAreaViolations.push({ time: snap.time, id: a.id, role: a.role, box: a.box, kind: "title-safe" });
          }
        }
      }
      for (let j = i + 1; j < fg.length; j++) {
        const b = fg[j]!;
        const area = boxesOverlapArea(a.box, b.box, 2);
        if (area > 4) {
          overlaps.push({ time: snap.time, a: a.id, b: b.id, area });
        }
      }
    }
  }

  return {
    ok: overlaps.length === 0 && safeAreaViolations.length === 0,
    overlaps,
    safeAreaViolations
  };
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const NAMED_COLORS: Record<string, string> = {
  pink: "#ff3b6b",
  hotpink: "#ff3b6b",
  magenta: "#f43f5e",
  red: "#ef4444",
  crimson: "#dc2626",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  gold: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  white: "#ffffff",
  black: "#111827",
  grey: "#94a3b8",
  gray: "#94a3b8",
  silver: "#cbd5e1"
};

export function normalizeColorValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (HEX_COLOR_RE.test(trimmed)) return trimmed;
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, trimmed)) return NAMED_COLORS[trimmed]!;
  return null;
}

/** Validates an `EditPatch` structure and returns `{ patch }` or `{ error }`. */
export function validateEditPatch(value: unknown): { patch: EditPatch } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Patch must be an object." };
  }
  const obj = value as Record<string, unknown>;
  const scope: EditScope = obj.scope === "scene" ? "scene" : obj.scope === "element" ? "element" : "element";
  if (obj.scope !== undefined && obj.scope !== "element" && obj.scope !== "scene") {
    return { error: 'Patch scope must be "element" or "scene".' };
  }
  const scene = obj.scene;
  if (typeof scene === "string") {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(scene)) {
      return { error: "Patch scene id must be a valid beat identifier (1..64 alphanumeric, underscore, or hyphen characters)." };
    }
  } else if (typeof scene !== "number" || !Number.isInteger(scene) || scene < 0 || scene > 512) {
    return { error: "Patch scene must be a non-negative integer index (0..512) or a beat id string." };
  }
  const atSeconds =
    typeof obj.atSeconds === "number" && Number.isFinite(obj.atSeconds) && obj.atSeconds >= 0 && obj.atSeconds <= 3600
      ? obj.atSeconds
      : NaN;
  if (Number.isNaN(atSeconds)) {
    return { error: "Patch atSeconds must be a finite number between 0 and 3600." };
  }
  let el: string | undefined;
  if (obj.el !== undefined && obj.el !== null) {
    if (typeof obj.el !== "string" || !/^[a-zA-Z0-9_:-]{1,64}$/.test(obj.el)) {
      return { error: "Patch el must be a valid stable element id." };
    }
    el = obj.el;
  }

  const rawSet = obj.set && typeof obj.set === "object" && !Array.isArray(obj.set) ? (obj.set as Record<string, unknown>) : {};
  const set: EditElementProperties = {};

  if (rawSet.color !== undefined) {
    const c = normalizeColorValue(rawSet.color);
    if (!c) return { error: `Unsupported colour "${String(rawSet.color)}". Use a hex colour like #ff3b6b or a standard colour name.` };
    set.color = c;
  }
  if (rawSet.opacity !== undefined) {
    if (typeof rawSet.opacity !== "number" || !Number.isFinite(rawSet.opacity) || rawSet.opacity < 0.05 || rawSet.opacity > 1) {
      return { error: "Opacity must be a number between 0.05 and 1." };
    }
    set.opacity = Math.round(rawSet.opacity * 100) / 100;
  }
  if (rawSet.dx !== undefined) {
    if (typeof rawSet.dx !== "number" || !Number.isFinite(rawSet.dx) || Math.abs(rawSet.dx) > 4000) {
      return { error: "Horizontal offset dx must be a finite number within ±4000." };
    }
    set.dx = Math.round(rawSet.dx);
  }
  if (rawSet.dy !== undefined) {
    if (typeof rawSet.dy !== "number" || !Number.isFinite(rawSet.dy) || Math.abs(rawSet.dy) > 4000) {
      return { error: "Vertical offset dy must be a finite number within ±4000." };
    }
    set.dy = Math.round(rawSet.dy);
  }
  if (rawSet.scale !== undefined) {
    if (typeof rawSet.scale !== "number" || !Number.isFinite(rawSet.scale) || rawSet.scale <= 0.1 || rawSet.scale > 5) {
      return { error: "Scale must be a number between 0.1 and 5." };
    }
    set.scale = Math.round(rawSet.scale * 100) / 100;
  }
  if (rawSet.factor !== undefined) {
    if (typeof rawSet.factor !== "number" || !Number.isFinite(rawSet.factor) || rawSet.factor <= 0.2 || rawSet.factor > 4) {
      return { error: "Layout emphasis factor must be a number between 0.2 and 4." };
    }
    set.factor = Math.round(rawSet.factor * 100) / 100;
  }
  if (rawSet.emphasize !== undefined) {
    if (typeof rawSet.emphasize !== "string" || !/^[a-zA-Z0-9_:-]{1,64}$/.test(rawSet.emphasize)) {
      return { error: "Layout emphasize target must be a valid element id." };
    }
    set.emphasize = rawSet.emphasize;
  }

  let text: string | undefined;
  if (obj.text !== undefined) {
    if (typeof obj.text !== "string") return { error: "Patch text must be a string." };
    const cleaned = plainText(obj.text);
    if (!cleaned) return { error: "Patch text cannot be empty." };
    if (cleaned.length > 280) return { error: "Patch text is too long (at most 280 characters)." };
    text = cleaned;
  } else if (typeof rawSet.text === "string") {
    const cleaned = plainText(rawSet.text);
    if (!cleaned) return { error: "Patch text cannot be empty." };
    if (cleaned.length > 280) return { error: "Patch text is too long (at most 280 characters)." };
    text = cleaned;
  }

  return {
    patch: {
      scope,
      scene,
      atSeconds,
      ...(el ? { el } : {}),
      set,
      ...(text !== undefined ? { text } : {})
    }
  };
}

/** Validates a persisted `HyperFramesOverridesMap` dictionary. */
export function validateHyperFramesOverrides(value: unknown): { overrides: HyperFramesOverridesMap } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Overrides must be an object keyed by element id." };
  }
  const out: HyperFramesOverridesMap = {};
  for (const [elId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isValidPlanElementId(elId)) {
      return { error: `Invalid element id "${elId}" in overrides.` };
    }
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return { error: `Override for "${elId}" must be an object.` };
    }
    const r = raw as Record<string, unknown>;
    const entry: HyperFramesElementOverride = {};
    if (r.color !== undefined) {
      const c = normalizeColorValue(r.color);
      if (!c) return { error: `Invalid colour "${String(r.color)}" on "${elId}".` };
      entry.color = c;
    }
    if (r.opacity !== undefined) {
      if (typeof r.opacity !== "number" || !Number.isFinite(r.opacity) || r.opacity < 0.05 || r.opacity > 1) {
        return { error: `Invalid opacity on "${elId}".` };
      }
      entry.opacity = Math.round(r.opacity * 100) / 100;
    }
    if (r.dx !== undefined) {
      if (typeof r.dx !== "number" || !Number.isFinite(r.dx) || Math.abs(r.dx) > 4000) {
        return { error: `Invalid dx on "${elId}".` };
      }
      entry.dx = Math.round(r.dx);
    }
    if (r.dy !== undefined) {
      if (typeof r.dy !== "number" || !Number.isFinite(r.dy) || Math.abs(r.dy) > 4000) {
        return { error: `Invalid dy on "${elId}".` };
      }
      entry.dy = Math.round(r.dy);
    }
    if (r.text !== undefined) {
      if (typeof r.text !== "string") {
        return { error: `Invalid text on "${elId}".` };
      }
      const cleaned = plainText(r.text);
      if (!cleaned) {
        return { error: `Invalid text on "${elId}".` };
      }
      if (cleaned.length > 280) {
        return { error: `Override text on "${elId}" is too long (at most 280 characters).` };
      }
      entry.text = cleaned;
    }
    if (Object.keys(entry).length > 0) {
      out[elId] = entry;
    }
  }
  return { overrides: out };
}

/** Validates a beat's `hints` field (`BeatLayoutHint`). */
export function validateBeatLayoutHint(value: unknown): { hints: BeatLayoutHint | null } | { error: string } {
  if (value === null || value === undefined) return { hints: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "Beat hints must be an object or null." };
  }
  const obj = value as Record<string, unknown>;
  const hints: BeatLayoutHint = {};
  if (obj.emphasize !== undefined && obj.emphasize !== null) {
    if (typeof obj.emphasize !== "string" || !/^[a-zA-Z0-9_:-]{1,64}$/.test(obj.emphasize)) {
      return { error: "Hint emphasize target must be a valid element id." };
    }
    hints.emphasize = obj.emphasize;
  }
  if (obj.factor !== undefined && obj.factor !== null) {
    if (typeof obj.factor !== "number" || !Number.isFinite(obj.factor) || obj.factor < 0.5 || obj.factor > 2.2) {
      return { error: "Hint factor must be a number between 0.5 and 2.2 so the scene stays legible and within the safe area." };
    }
    hints.factor = Math.round(obj.factor * 100) / 100;
  }
  return { hints: Object.keys(hints).length > 0 ? hints : null };
}

export const MAX_ELEMENTS_PER_SNAPSHOT = 64;
export const MAX_SNAPSHOTS_PER_COMMENT = 24;

/**
 * Checks whether an element id matches the beat-plan engine's `data-el` scheme (`<beatId>:<token>:<index>`)
 * and, when `beatIds` is provided, belongs to a beat in this plan (or `"g"` / `<beatId>_wipe`).
 */
export function isValidPlanElementId(elId: unknown, beatIds?: ReadonlySet<string>): elId is string {
  if (typeof elId !== "string" || elId.length < 5 || elId.length > 64) return false;
  const match = /^([a-zA-Z0-9_-]+):([a-zA-Z][a-zA-Z0-9_-]{0,31}):(\d{1,4})$/.exec(elId);
  if (!match) return false;
  const [, prefix, , idxStr] = match;
  const idx = Number(idxStr);
  if (!Number.isInteger(idx) || idx < 0 || idx > 512) return false;
  if (beatIds && beatIds.size > 0) {
    const basePrefix = prefix!.endsWith("_wipe") ? prefix!.slice(0, -5) : prefix!;
    if (basePrefix !== "g" && !beatIds.has(basePrefix)) return false;
  }
  return true;
}

/** Validates canvas dimensions `{ width, height }`. */
export function validateCanvasDimensions(
  value: unknown
): { canvas: { width: number; height: number } } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Measured canvas must be an object with width and height." };
  }
  const obj = value as Record<string, unknown>;
  const width = obj.width;
  const height = obj.height;
  if (
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width < 100 ||
    width > 8192 ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height < 100 ||
    height > 8192
  ) {
    return { error: "Canvas width and height must be finite numbers between 100 and 8192." };
  }
  return { canvas: { width: Math.round(width), height: Math.round(height) } };
}

/**
 * Strictly validates an array of `FrameElementsSnapshot`s measured in the browser:
 * - At least 1 and at most `MAX_SNAPSHOTS_PER_COMMENT` (24) snapshots per comment
 * - At most `MAX_ELEMENTS_PER_SNAPSHOT` (64) elements per snapshot
 * - Every element id matches this plan's `data-el` scheme (`isValidPlanElementId`)
 * - Every bounding box is a finite 4-tuple `[x, y, w, h]` within valid canvas bounds
 * - Plain data only (never executed).
 */
export function validateFrameElementsSnapshots(
  value: unknown,
  beatIds?: ReadonlySet<string>
): { snapshots: FrameElementsSnapshot[] } | { error: string } {
  if (!Array.isArray(value)) {
    return { error: "Snapshots for a comment must be an array." };
  }
  if (value.length === 0) {
    return { error: "Snapshots array cannot be empty." };
  }
  if (value.length > MAX_SNAPSHOTS_PER_COMMENT) {
    return { error: `Too many snapshots for one comment (at most ${MAX_SNAPSHOTS_PER_COMMENT}).` };
  }

  const out: FrameElementsSnapshot[] = [];
  for (let sIdx = 0; sIdx < value.length; sIdx++) {
    const rawSnap = value[sIdx];
    if (!rawSnap || typeof rawSnap !== "object" || Array.isArray(rawSnap)) {
      return { error: `Snapshot at index ${sIdx} must be an object.` };
    }
    const snapObj = rawSnap as Record<string, unknown>;
    if (typeof snapObj.time !== "number" || !Number.isFinite(snapObj.time) || snapObj.time < 0 || snapObj.time > 3600) {
      return { error: `Snapshot time at index ${sIdx} must be a finite number between 0 and 3600.` };
    }
    if (!Array.isArray(snapObj.elements)) {
      return { error: `Snapshot elements at index ${sIdx} must be an array.` };
    }
    if (snapObj.elements.length > MAX_ELEMENTS_PER_SNAPSHOT) {
      return { error: `Snapshot at index ${sIdx} has too many elements (at most ${MAX_ELEMENTS_PER_SNAPSHOT}).` };
    }

    const elements: ActiveElementInfo[] = [];
    const seenIds = new Set<string>();
    for (let eIdx = 0; eIdx < snapObj.elements.length; eIdx++) {
      const rawEl = snapObj.elements[eIdx];
      if (!rawEl || typeof rawEl !== "object" || Array.isArray(rawEl)) {
        return { error: `Element ${eIdx} in snapshot ${sIdx} must be an object.` };
      }
      const elObj = rawEl as Record<string, unknown>;
      if (!isValidPlanElementId(elObj.id, beatIds)) {
        return { error: `Element id "${String(elObj.id)}" in snapshot ${sIdx} is not valid for this plan's data-el scheme.` };
      }
      if (seenIds.has(elObj.id)) {
        return { error: `Duplicate element id "${elObj.id}" in snapshot ${sIdx}.` };
      }
      seenIds.add(elObj.id);
      if (typeof elObj.role !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(elObj.role)) {
        return { error: `Element "${elObj.id}" has an invalid role "${String(elObj.role)}".` };
      }
      if (typeof elObj.text !== "string" || elObj.text.length > 500) {
        return { error: `Element "${elObj.id}" text must be a string of at most 500 characters.` };
      }
      if (!Array.isArray(elObj.box) || elObj.box.length !== 4) {
        return { error: `Element "${elObj.id}" box must be a 4-number tuple [x, y, width, height].` };
      }
      const [bx, by, bw, bh] = elObj.box as unknown[];
      if (
        typeof bx !== "number" ||
        !Number.isFinite(bx) ||
        Math.abs(bx) > 16384 ||
        typeof by !== "number" ||
        !Number.isFinite(by) ||
        Math.abs(by) > 16384 ||
        typeof bw !== "number" ||
        !Number.isFinite(bw) ||
        bw < 0 ||
        bw > 16384 ||
        typeof bh !== "number" ||
        !Number.isFinite(bh) ||
        bh < 0 ||
        bh > 16384
      ) {
        return { error: `Element "${elObj.id}" box coordinates must be finite numbers within bounds.` };
      }
      let beat: string | undefined;
      if (elObj.beat !== undefined && elObj.beat !== null) {
        if (typeof elObj.beat !== "string" || !/^[a-zA-Z0-9_-]{0,32}$/.test(elObj.beat)) {
          return { error: `Element "${elObj.id}" has an invalid beat identifier.` };
        }
        if (elObj.beat) beat = elObj.beat;
      }
      let opacity: number | undefined;
      if (elObj.opacity !== undefined && elObj.opacity !== null) {
        if (typeof elObj.opacity !== "number" || !Number.isFinite(elObj.opacity) || elObj.opacity < 0 || elObj.opacity > 1) {
          return { error: `Element "${elObj.id}" opacity must be a finite number between 0 and 1.` };
        }
        opacity = Math.round(elObj.opacity * 100) / 100;
      }
      elements.push({
        id: elObj.id,
        role: elObj.role,
        text: plainText(elObj.text),
        box: [Math.round(bx * 100) / 100, Math.round(by * 100) / 100, Math.round(bw * 100) / 100, Math.round(bh * 100) / 100],
        ...(beat ? { beat } : {}),
        ...(opacity !== undefined ? { opacity } : {})
      });
    }

    out.push({
      time: Math.round(snapObj.time * 1000) / 1000,
      elements
    });
  }

  return { snapshots: out };
}

/** Returns true when a patch contains at least one concrete property change or text replacement. */
export function hasEditPatchOperations(patch: EditPatch | null | undefined): boolean {
  if (!patch) return false;
  const s = patch.set ?? {};
  return (
    s.color !== undefined ||
    s.opacity !== undefined ||
    (typeof s.dx === "number" && s.dx !== 0) ||
    (typeof s.dy === "number" && s.dy !== 0) ||
    s.scale !== undefined ||
    s.factor !== undefined ||
    patch.text !== undefined ||
    s.text !== undefined
  );
}

/** Merges active elements across multiple snapshots in a window, keeping the first occurrence of each element id. */
export function mergeWindowElements(snapshots: readonly FrameElementsSnapshot[]): ActiveElementInfo[] {
  const out: ActiveElementInfo[] = [];
  const seen = new Set<string>();
  for (const snap of snapshots) {
    for (const el of snap.elements) {
      if (!seen.has(el.id)) {
        seen.add(el.id);
        out.push(el);
      }
    }
  }
  return out;
}

export type BeatWindowTimingSlot = { id?: string; start: number; end: number };
export type BeatWindowTimingInput =
  | Readonly<Record<string, { start: number; end: number }>>
  | readonly BeatWindowTimingSlot[];

/**
 * Resolves the beat and sample timestamps covering the active settled window of a beat around `atSeconds`.
 * Shared by the browser preview and the backend so both sides sample the exact same timestamps.
 */
export function resolveBeatWindowTimes(
  planOrProject:
    | { beats: readonly Beat[]; target_duration_s?: number }
    | { beatPlan?: BeatPlan | null },
  sceneRef: string | number | undefined,
  atSeconds: number,
  beatTimes?: BeatWindowTimingInput
): { beat: Beat; beatIndex: number; start: number; end: number; sampleTimes: number[] } {
  const plan =
    "beatPlan" in planOrProject
      ? planOrProject.beatPlan
      : (planOrProject as { beats: readonly Beat[]; target_duration_s?: number });
  const beats = plan?.beats ?? [];
  if (!beats.length) throw new Error("Generate the plan first.");

  const targetDur =
    ("target_duration_s" in (plan ?? {}) && typeof (plan as { target_duration_s?: number }).target_duration_s === "number"
      ? (plan as { target_duration_s: number }).target_duration_s
      : 0) || beats.length * 3;
  const defaultSlice = Math.max(0.5, targetDur / beats.length);

  const timedBeats: { id: string; start: number; end: number }[] = beats.map((b, i) => {
    if (Array.isArray(beatTimes)) {
      const byIdx = beatTimes.find((slot) => slot.id === b.id) ?? beatTimes[i];
      if (byIdx && Number.isFinite(byIdx.start) && Number.isFinite(byIdx.end)) {
        return { id: b.id, start: byIdx.start, end: byIdx.end };
      }
    } else if (beatTimes && typeof beatTimes === "object") {
      const entry = (beatTimes as Readonly<Record<string, { start: number; end: number }>>)[b.id];
      if (entry && Number.isFinite(entry.start) && Number.isFinite(entry.end)) {
        return { id: b.id, start: entry.start, end: entry.end };
      }
    }
    const start = Math.round(i * defaultSlice * 1000) / 1000;
    const end = Math.round((i + 1) * defaultSlice * 1000) / 1000;
    return { id: b.id, start, end };
  });

  let beatIndex = -1;
  if (typeof sceneRef === "number" && sceneRef >= 0 && sceneRef < beats.length) {
    beatIndex = sceneRef;
  } else if (typeof sceneRef === "string") {
    beatIndex = beats.findIndex((b) => b.id === sceneRef);
  }
  // Find by timestamp (with 1-frame rounding tolerance at seam cuts)
  if (beatIndex < 0) {
    for (let i = 0; i < timedBeats.length; i++) {
      const tb = timedBeats[i]!;
      if (atSeconds >= tb.start - 0.02 && atSeconds < tb.end - 0.02) {
        beatIndex = i;
        break;
      }
    }
    if (beatIndex < 0) beatIndex = beats.length - 1;
  }

  const beat = beats[beatIndex]!;
  const tb = timedBeats[beatIndex];
  const start = tb?.start ?? beatIndex * 2.5;
  const end = tb?.end ?? start + 2.5;
  const dur = Math.max(0.5, end - start);

  // Sample across the settled window of the beat (after entry settle and before exit seam, plus the pinned time when inside the settled range)
  const settleStart = start + Math.min(0.45, dur * 0.18);
  const settleEnd = Math.max(settleStart, end - Math.min(0.35, dur * 0.15));
  const clampedAt = Math.min(Math.max(settleStart, atSeconds), settleEnd);
  const rawTimes = [
    clampedAt,
    start + Math.min(0.65, dur * 0.32),
    start + dur * 0.55,
    start + dur * 0.78
  ];
  const unique = [...new Set(rawTimes.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b);
  return { beat, beatIndex, start, end, sampleTimes: unique };
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Pure helper that applies one or more candidate `EditPatch`es locally to a composition HTML string
 * through its `<script id="hf-variables" type="application/json">` block (both element `overrides`
 * and scene-level `beat.hints` / beat text), without a server render.
 *
 * When `mode` is `"element"`, candidate patches with `el` and no `scale`/`factor` are applied as
 * element overrides (`overrides[el]`). When `mode` is `"scene"` (or when a patch has `scale`/`factor`
 * or longer text), the change is applied to the beat's `hints` or `keyword`/`on_screen` inside `hf-variables`.
 */
export function applyCandidatePatchToPreviewHtml(
  previewHtml: string,
  patches: readonly EditPatch[],
  options?: {
    activeElements?: readonly ActiveElementInfo[];
    forceScene?: boolean;
  }
): string {
  const hfBlockRe = /<script id="hf-variables" type="application\/json">([\s\S]*?)<\/script>/;
  const match = hfBlockRe.exec(previewHtml);
  if (!match) return previewHtml;

  let edits: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(match[1] || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      edits = parsed as Record<string, unknown>;
    }
  } catch {
    edits = {};
  }

  // Extract base engine plan from edits.plan or window.__hfVariables
  let enginePlanObj: { beats?: Record<string, unknown>[]; [k: string]: unknown } | null = null;
  if (typeof edits.plan === "string") {
    try {
      enginePlanObj = JSON.parse(edits.plan);
    } catch {
      enginePlanObj = null;
    }
  } else if (edits.plan && typeof edits.plan === "object") {
    enginePlanObj = structuredClone(edits.plan) as { beats?: Record<string, unknown>[] };
  }
  if (!enginePlanObj) {
    const hfVarsMatch = /window\.__hfVariables\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(previewHtml);
    if (hfVarsMatch) {
      try {
        const hfVars = JSON.parse(hfVarsMatch[1]!);
        if (typeof hfVars?.plan === "string") {
          enginePlanObj = JSON.parse(hfVars.plan);
        } else if (hfVars?.plan && typeof hfVars.plan === "object") {
          enginePlanObj = structuredClone(hfVars.plan);
        }
      } catch {
        enginePlanObj = null;
      }
    }
  }

  const overrides: HyperFramesOverridesMap =
    edits.overrides && typeof edits.overrides === "object" && !Array.isArray(edits.overrides)
      ? structuredClone(edits.overrides as HyperFramesOverridesMap)
      : {};
  let planChanged = false;
  const activeEls = options?.activeElements ?? [];

  for (const patch of patches) {
    const hasScale =
      (typeof patch.set?.scale === "number" && Math.abs(patch.set.scale - 1) > 1e-3) ||
      (typeof patch.set?.factor === "number" && Math.abs(patch.set.factor - 1) > 1e-3);
    const targetEl = patch.el ? activeEls.find((e) => e.id === patch.el) : undefined;
    const isDifferentLenText =
      patch.text !== undefined &&
      targetEl !== undefined &&
      !isSameTextLengthClass(targetEl.text, patch.text);

    const applyAsScene = Boolean(options?.forceScene || hasScale || isDifferentLenText || !patch.el);

    if (!applyAsScene && patch.el && isValidPlanElementId(patch.el)) {
      const prevOv = overrides[patch.el] ?? {};
      const nextColor = patch.set.color !== undefined ? normalizeColorValue(patch.set.color) : undefined;
      const nextOpacity =
        typeof patch.set.opacity === "number" && Number.isFinite(patch.set.opacity)
          ? Math.min(1, Math.max(0.05, Math.round(patch.set.opacity * 100) / 100))
          : undefined;
      const nextDx =
        typeof patch.set.dx === "number" && Number.isFinite(patch.set.dx)
          ? Math.max(-4000, Math.min(4000, Math.round((prevOv.dx ?? 0) + patch.set.dx)))
          : undefined;
      const nextDy =
        typeof patch.set.dy === "number" && Number.isFinite(patch.set.dy)
          ? Math.max(-4000, Math.min(4000, Math.round((prevOv.dy ?? 0) + patch.set.dy)))
          : undefined;
      const nextText = patch.text !== undefined ? plainText(patch.text).slice(0, 280) : undefined;
      overrides[patch.el] = {
        ...prevOv,
        ...(nextColor ? { color: nextColor } : {}),
        ...(nextOpacity !== undefined ? { opacity: nextOpacity } : {}),
        ...(nextDx !== undefined ? { dx: nextDx } : {}),
        ...(nextDy !== undefined ? { dy: nextDy } : {}),
        ...(nextText ? { text: nextText } : {})
      };
      continue;
    }

    // Scene-level candidate application
    if (patch.el && isValidPlanElementId(patch.el) && (patch.set.color !== undefined || patch.set.opacity !== undefined)) {
      const prevOv = overrides[patch.el] ?? {};
      const nextColor = patch.set.color !== undefined ? normalizeColorValue(patch.set.color) : undefined;
      const nextOpacity =
        typeof patch.set.opacity === "number" && Number.isFinite(patch.set.opacity)
          ? Math.min(1, Math.max(0.05, Math.round(patch.set.opacity * 100) / 100))
          : undefined;
      overrides[patch.el] = {
        ...prevOv,
        ...(nextColor ? { color: nextColor } : {}),
        ...(nextOpacity !== undefined ? { opacity: nextOpacity } : {})
      };
    }

    if (enginePlanObj && Array.isArray(enginePlanObj.beats)) {
      const beatId =
        typeof patch.scene === "string"
          ? patch.scene
          : typeof patch.scene === "number"
          ? String(enginePlanObj.beats[patch.scene]?.id ?? `b${patch.scene + 1}`)
          : patch.el?.split(":")[0] ?? "b1";
      const targetBeat = enginePlanObj.beats.find((b) => b.id === beatId);
      if (targetBeat) {
        if (patch.text !== undefined) {
          const newText = plainText(patch.text).slice(0, 280);
          if (targetEl?.role === "subtitle" || targetEl?.role === "pill") {
            targetBeat.on_screen = newText;
            edits[`${beatId}.on_screen`] = newText;
          } else if (targetEl && (targetEl.role === "word" || targetEl.role === "accent-word")) {
            const currentKw = String(edits[`${beatId}.keyword`] ?? targetBeat.keyword ?? "");
            const kwWords = currentKw.split(/\s+/).filter(Boolean);
            const wordMatch = /^b\d+:w:(\d+)$/.exec(targetEl.id);
            let nextKw = newText;
            if (wordMatch && newText.split(/\s+/).length === 1) {
              const wIdx = Number(wordMatch[1]);
              if (wIdx >= 0 && wIdx < kwWords.length) {
                kwWords[wIdx] = newText;
                nextKw = kwWords.join(" ");
              }
            }
            targetBeat.keyword = nextKw;
            edits[`${beatId}.keyword`] = nextKw;
          } else {
            targetBeat.keyword = newText;
            edits[`${beatId}.keyword`] = newText;
          }
          planChanged = true;
        }
        const rawFactor = patch.set.factor ?? patch.set.scale;
        if (rawFactor !== undefined) {
          const checkedHint = validateBeatLayoutHint({
            emphasize: patch.set.emphasize ?? patch.el ?? "kw",
            factor: rawFactor
          });
          if ("hints" in checkedHint && checkedHint.hints) {
            targetBeat.hints = checkedHint.hints;
            planChanged = true;
          }
        }
      }
    }
  }

  if (Object.keys(overrides).length > 0) {
    edits.overrides = overrides;
  } else {
    delete edits.overrides;
  }

  if (planChanged && enginePlanObj) {
    edits.plan = JSON.stringify(enginePlanObj);
  }

  return previewHtml.replace(
    hfBlockRe,
    () => `<script id="hf-variables" type="application/json">${escapeScriptJson(edits)}</script>`
  );
}

/**
 * Prompt specification for turning a natural-language timed comment and the active element list
 * into a candidate `EditPatch` (used by the real model adapter in production; the deterministic
 * translator below implements the same contract for offline/test runs).
 */
export const COMMENT_TO_PATCH_SYSTEM_PROMPT = `You translate a viewer's timed comment on an animated video into a structured JSON EditPatch.
Input:
- comment: the user's comment text
- atSeconds: timestamp in seconds where the comment was pinned
- scene: beat id (e.g. "b1") and scene kind ("kinetic" | "ui" | "title")
- activeElements: list of elements visible at atSeconds: [{ id, role, text, box: [x, y, width, height] }]

Output JSON schema:
{
  "scope": "element" | "scene",
  "scene": "<beat id>",
  "atSeconds": <number>,
  "el": "<id from activeElements when targeting one element>",
  "set": {
    "color"?: "<#rrggbb>",
    "opacity"?: <0.05..1>,
    "dx"?: <pixels>,
    "dy"?: <pixels>,
    "scale"?: <factor, e.g. 1.3 for bigger or 0.75 for smaller>
  },
  "text"?: "<new text>"
}
Note: The downstream geometry classifier will verify bounding boxes, overlaps, and safe-area margins and will decide the final scope.`;

export interface CommentPatchTranslator {
  translate(input: {
    comment: string;
    atSeconds: number;
    scene: string | number;
    beat?: Pick<Beat, "id" | "kind" | "keyword" | "on_screen" | "line">;
    activeElements: ActiveElementInfo[];
    canvas?: { width: number; height: number };
  }): Promise<EditPatch> | EditPatch;
}

function normWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findTargetElement(
  comment: string,
  activeElements: ActiveElementInfo[],
  beatId?: string
): ActiveElementInfo | undefined {
  const scoped = beatId
    ? activeElements.filter((el) => el.beat === beatId || el.id.startsWith(`${beatId}:`))
    : activeElements;
  const pool = scoped.length > 0 ? scoped : activeElements;
  const textEls = pool.filter((el) => isTextRole(el.role) && el.text.trim().length > 0);
  const words = pool.filter((el) => el.role === "word" || el.role === "accent-word");

  // 1. Check for role mentions first ("subtitle", "subtext", "pill", "button", "cta", "brand name", "stat", "card")
  const lower = comment.toLowerCase();
  if (/\b(subtitle|subtext|sub-headline|on[- ]screen|secondary)\b/.test(lower)) {
    const sub = pool.find((el) => el.role === "subtitle");
    if (sub) return sub;
  }
  if (/\b(pill|button|cta)\b/.test(lower)) {
    const pill = pool.find((el) => el.role === "pill");
    if (pill) return pill;
  }
  if (/\b(brand\s*name|logo\s*name|product\s*name)\b/.test(lower)) {
    const nameEl = pool.find((el) => el.role === "name");
    if (nameEl) return nameEl;
  }
  if (/\b(stat|counter|metric|number)\b/.test(lower)) {
    const statEl = pool.find((el) => el.role === "stat" || el.role === "type-text");
    if (statEl) return statEl;
  }
  if (/\b(card|screenshot|window)\b/.test(lower)) {
    const cardEl = pool.find((el) => el.role === "card");
    if (cardEl) return cardEl;
  }
  if (/\b(first\s+word)\b/.test(lower) && words.length > 0) {
    return words[0];
  }
  if (/\b(last\s+word|accent\s+word)\b/.test(lower) && words.length > 0) {
    return words[words.length - 1];
  }

  // 2. Check for quoted or asterisk-wrapped target word/phrase: e.g. "make 'share.' pink" or "make *share.* pink"
  const quotedMatch = /["'*“”‘’]([^"'*“”‘’]+)["'*“”‘’]/.exec(comment);
  if (quotedMatch) {
    const targetRaw = quotedMatch[1]!.trim();
    const targetNorm = normWord(targetRaw);
    const exact = textEls.find((el) => el.text.trim().toLowerCase() === targetRaw.toLowerCase() || normWord(el.text) === targetNorm);
    if (exact) return exact;
    const partial = textEls.find((el) => normWord(el.text).includes(targetNorm));
    if (partial) return partial;
  }

  // 3. Direct token match against visible words on screen
  // Avoid matching common command words unless they are the only match
  const commandStopWords = new Set([
    "make",
    "change",
    "set",
    "turn",
    "move",
    "nudge",
    "shift",
    "push",
    "pull",
    "scale",
    "grow",
    "shrink",
    "bigger",
    "larger",
    "smaller",
    "huge",
    "tiny",
    "color",
    "colour",
    "opacity",
    "transparent",
    "replace",
    "with",
    "into",
    "from",
    "word",
    "text",
    "headline",
    "title",
    "scene",
    "left",
    "right",
    "down",
    "onto",
    "over",
    "off",
    "screen",
    "slightly",
    "little",
    "bit",
    ...Object.keys(NAMED_COLORS)
  ]);

  const commentTokens = comment
    .split(/\s+/)
    .map((tok) => ({ raw: tok, norm: normWord(tok) }))
    .filter((tok) => tok.norm.length >= 2);

  for (const tok of commentTokens) {
    if (commandStopWords.has(tok.norm)) continue;
    const match = textEls.find((el) => normWord(el.text) === tok.norm);
    if (match) return match;
  }

  for (const tok of commentTokens) {
    const match = words.find((el) => normWord(el.text) === tok.norm);
    if (match) return match;
  }

  // 4. Default to the accent word (last word of the key phrase), or first text element
  return words[words.length - 1] ?? textEls[0] ?? pool[0];
}

/**
 * Deterministic rule-based implementation of `CommentPatchTranslator` for offline/test runs.
 */
export const deterministicCommentTranslator: CommentPatchTranslator = {
  translate({ comment, atSeconds, scene, beat, activeElements }) {
    const cleanComment = comment.trim();
    const lower = cleanComment.toLowerCase();
    const beatId = typeof scene === "string" ? scene : beat?.id;
    const target = findTargetElement(cleanComment, activeElements, beatId);

    const set: EditElementProperties = {};
    let replacementText: string | undefined;

    // 1. Parse colour
    const hexMatch = /#[0-9a-fA-F]{3,8}\b/.exec(cleanComment);
    if (hexMatch) {
      const c = normalizeColorValue(hexMatch[0]);
      if (c) set.color = c;
    } else {
      for (const [name, hex] of Object.entries(NAMED_COLORS)) {
        if (new RegExp(`\\b${name}\\b`, "i").test(lower)) {
          set.color = hex;
          break;
        }
      }
    }

    // 2. Parse opacity
    const opacityPctMatch = /\bopacity\s*(?:to\s*)?(\d{1,3})\s*%|\b(\d{1,2})\s*%\s*opacity\b/i.exec(cleanComment);
    const opacityDecMatch = /\bopacity\s*(?:to\s*)?(0(?:\.\d+)?|1(?:\.0+)?)\b/i.exec(cleanComment);
    if (opacityPctMatch) {
      const pct = Number(opacityPctMatch[1] ?? opacityPctMatch[2]);
      set.opacity = Math.min(1, Math.max(0.05, Math.round(pct) / 100));
    } else if (opacityDecMatch) {
      set.opacity = Math.min(1, Math.max(0.05, Number(opacityDecMatch[1])));
    } else if (/\b(semi[- ]?transparent|dimmer|softer|fainter)\b/i.test(lower)) {
      set.opacity = 0.6;
    }

    // 3. Parse size / scale ("bigger", "smaller", "scale 1.4", "2x", etc.)
    const scaleMatch = /\b(?:scale|factor|size)\s*(?:by|to)?\s*(\d+(?:\.\d+)?)x?\b/i.exec(cleanComment);
    const pctScaleMatch = /\b(\d{2,3})\s*%\s*(?:bigger|larger|smaller)\b/i.exec(cleanComment);
    if (scaleMatch) {
      set.scale = Number(scaleMatch[1]);
    } else if (pctScaleMatch) {
      const pct = Number(pctScaleMatch[1]) / 100;
      set.scale = /smaller/i.test(lower) ? Math.max(0.4, 1 - pct) : 1 + pct;
    } else if (/\b(way\s+bigger|much\s+bigger|huge|giant|enormous|3x)\b/i.test(lower)) {
      set.scale = 3.0;
    } else if (/\b(bigger|larger|emphasize|stand\s+out|prominent|bolder\s+and\s+bigger)\b/i.test(lower)) {
      set.scale = 1.3;
    } else if (/\b(smaller|shrink|tinier|compact|reduce\s+size)\b/i.test(lower)) {
      set.scale = 0.78;
    }

    // 4. Parse position nudge / move ("nudge up 20px", "move left 40", "move onto <other>", "push off screen")
    const dxMatch = /\b(?:dx)\s*[:=]?\s*(-?\d+)/i.exec(cleanComment);
    const dyMatch = /\b(?:dy)\s*[:=]?\s*(-?\d+)/i.exec(cleanComment);
    if (dxMatch) set.dx = Number(dxMatch[1]);
    if (dyMatch) set.dy = Number(dyMatch[1]);

    const dirMoveMatch = /\b(?:move|nudge|shift|push|slide)\b.*?\b(left|right|up|down)\b(?:\s*(?:by\s*)?(\d+)\s*(?:px|pixels)?)?/i.exec(cleanComment);
    if (dirMoveMatch && set.dx === undefined && set.dy === undefined) {
      const dir = dirMoveMatch[1]!.toLowerCase();
      const amount = dirMoveMatch[2] ? Number(dirMoveMatch[2]) : /\b(off[- ]?screen|way|far|edge)\b/i.test(lower) ? 900 : /\b(slightly|little|bit|nudge)\b/i.test(lower) ? 18 : 30;
      if (dir === "left") set.dx = -amount;
      else if (dir === "right") set.dx = amount;
      else if (dir === "up") set.dy = -amount;
      else if (dir === "down") set.dy = amount;
    } else if (/\b(off[- ]?screen|outside\s+the\s+frame|out\s+of\s+bounds)\b/i.test(lower) && set.dx === undefined && set.dy === undefined) {
      set.dx = 950;
      set.dy = -600;
    }

    // Check "move onto / over <other element>"
    const ontoMatch = /\b(?:move|place|put|overlap|drag)\b.*?\b(?:onto|over|into)\s+["'*“”‘’]?([^"'*“”‘’]+)["'*“”‘’]?/i.exec(cleanComment);
    if (ontoMatch && target) {
      const otherQuery = ontoMatch[1]!.trim().toLowerCase();
      const scoped = beatId
        ? activeElements.filter((el) => (el.beat === beatId || el.id.startsWith(`${beatId}:`)) && el.id !== target.id && !isBackgroundRole(el.role))
        : activeElements.filter((el) => el.id !== target.id && !isBackgroundRole(el.role));
      const other =
        scoped.find((el) => normWord(el.text) === normWord(otherQuery)) ??
        scoped.find((el) => otherQuery.includes(el.role) || (el.role === "subtitle" && /subtitle|subtext/.test(otherQuery))) ??
        scoped.find((el) => isTextRole(el.role));
      if (other) {
        const targetCx = target.box[0] + target.box[2] / 2;
        const targetCy = target.box[1] + target.box[3] / 2;
        const otherCx = other.box[0] + other.box[2] / 2;
        const otherCy = other.box[1] + other.box[3] / 2;
        set.dx = Math.round(otherCx - targetCx);
        set.dy = Math.round(otherCy - targetCy);
      }
      return {
        scope: "element",
        scene,
        atSeconds,
        el: target.id,
        set
      };
    }

    // 5. Parse text replacement:
    // Patterns:
    // - change "old" to "new" / replace "old" with "new"
    // - change text to "new" / say "new" instead
    const replaceQuoted = /\b(?:change|replace|set|update|swap)\b[^"']*?["'*“”‘’]([^"'*“”‘’]+)["'*“”‘’]\s+(?:to|with|into|for)\s+["'*“”‘’]([^"'*“”‘’]+)["'*“”‘’]/i.exec(cleanComment);
    const toQuoted = /\b(?:text\s+to|headline\s+to|word\s+to|subtitle\s+to|pill\s+to|say|read)\s+["'*“”‘’]([^"'*“”‘’]+)["'*“”‘’]/i.exec(cleanComment);
    const unquotedReplace = /\b(?:change|replace)\s+([a-zA-Z0-9._-]+)\s+(?:to|with)\s+([a-zA-Z0-9._-]+)\s*$/i.exec(cleanComment);

    if (replaceQuoted) {
      const fromStr = replaceQuoted[1]!.trim();
      const toStr = replaceQuoted[2]!.trim();
      const matchedFrom = activeElements.find(
        (el) => ( !beatId || el.beat === beatId || el.id.startsWith(`${beatId}:`) ) && normWord(el.text) === normWord(fromStr)
      );
      replacementText = plainText(toStr);
      if (matchedFrom) {
        return {
          scope: set.scale !== undefined ? "scene" : "element",
          scene,
          atSeconds,
          el: matchedFrom.id,
          set,
          text: replacementText
        };
      }
    } else if (toQuoted) {
      replacementText = plainText(toQuoted[1]!);
    } else if (unquotedReplace && !set.color) {
      const fromStr = unquotedReplace[1]!.trim();
      const toStr = unquotedReplace[2]!.trim();
      const matchedFrom = activeElements.find(
        (el) => (!beatId || el.beat === beatId || el.id.startsWith(`${beatId}:`)) && normWord(el.text) === normWord(fromStr)
      );
      replacementText = plainText(toStr);
      if (matchedFrom) {
        return {
          scope: set.scale !== undefined ? "scene" : "element",
          scene,
          atSeconds,
          el: matchedFrom.id,
          set,
          text: replacementText
        };
      }
    }

    return {
      scope: set.scale !== undefined ? "scene" : "element",
      scene,
      atSeconds,
      ...(target ? { el: target.id } : {}),
      set,
      ...(replacementText !== undefined ? { text: replacementText } : {})
    };
  }
};
