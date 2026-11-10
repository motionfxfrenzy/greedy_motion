import { voiceText, type VideoProject } from "@videosaas/contracts";
import type { PlateAspect, PlateScene, PlateStatus, PlateVariant } from "../../lib/api.ts";

/**
 * Per-project authoring concurrency cap in the backend (`PLATE_PROJECT_AUTHOR_CAP = 2`).
 * At most two scenes of the same film write in parallel; waiting scenes wait for the active slots ahead of them.
 */
export const WRITE_PARALLEL = 2;

export const DEFAULT_TYPICAL_WRITE_SECONDS = 180;
export const DEFAULT_CHECKING_SECONDS = 20;
export const CHECKING_TAKING_LONGER_SECONDS = 90;
export const DEFAULT_DRAWING_SECONDS = 40;
export const CLIP_RENDER_SECONDS_PER_FRAME = 1;
export const TAKING_LONGER_NOTE = "taking longer than usual";
export const USUAL_SCENE_NOTE = "usually 2-4 min per scene";

export type SceneProgressPhase = "waiting" | "writing" | "checking" | "drawing" | "ready" | "failed";

export interface EtaRange {
  low: number;
  high: number;
}

export interface SceneRetrying {
  attempt: number;
  reason: string;
}

export interface ProgressContext {
  /** Current client timestamp in ms (`Date.now()`). */
  nowClient?: number;
  /** Server ISO timestamp from the latest `/plates` response (`status.serverNow`). */
  serverNow?: string | null;
  /** Client timestamp in ms when `serverNow` was received (`clientNowAtFetch`). */
  clientNowAtFetch?: number;
  /** Explicit server clock offset in ms (`Date.parse(serverNow) - clientNowAtFetch`); overrides `serverNow` / `clientNowAtFetch` if set. */
  serverOffset?: number;
  /** Viewed aspect ratio (`"16:9"`, `"9:16"`, `"1:1"`). */
  viewAspect?: PlateAspect;
  /** Whether the film is in live preview mode (`status.mode === "live"` and live flag enabled). */
  isLiveMode?: boolean;
  /** All scenes of the film (used to measure typical writing time and queue positions). */
  scenes?: readonly PlateScene[];
  /** Browser-tracked fallback timestamps (ms, in server-aligned clock) when each `(sceneIndex, phase/state)` was first seen. */
  firstSeenAt?: Readonly<Record<string, number>>;
}

export interface SceneProgressResult {
  phase: SceneProgressPhase;
  label: string;
  /** Compact label for timeline chips (e.g. `"Waiting"`, `"Writing 40%"`, `"Checking"`, `"Drawing 42/120"`, `"Retrying"`, `"Ready"`, `"Failed"`). */
  chipLabel: string;
  meaning: string;
  fraction: number | null;
  /** True when `fraction` is an estimate rather than a determinate count (e.g. writing or clip preparation without `framesDone`). */
  fractionEstimated?: boolean;
  elapsedMs: number | null;
  etaSeconds: EtaRange | null;
  /** Plain-language note when `elapsed >= estimate` and no countdown is shown (`"taking longer than usual"`). */
  etaNote?: string | null;
  /** True when `elapsed` has reached or passed the estimate without determinate completion. */
  takingLongerThanUsual?: boolean;
  retrying?: SceneRetrying | null;
  /** True when the scene is being prepared as a worker clip for smooth playback (`playback: "clip"`). */
  preparingAsClip?: boolean;
  /** True when the scene is out of date with the current storyboard/style revision and awaiting rebuild. */
  stale?: boolean;
}

export interface FilmProgressResult {
  total: number;
  written: number;
  drawn: number;
  failed: number;
  fraction: number;
  etaSeconds: EtaRange | null;
  typicalSceneSeconds: EtaRange;
}

const clamp = (val: number, min: number, max: number): number => Math.min(max, Math.max(min, val));

const roundTo10 = (seconds: number): number => Math.max(10, Math.round(Math.round(seconds * 1e6) / 1e7) * 10);

export function toEtaRange(baseSeconds: number): EtaRange {
  const safe = Math.max(1, baseSeconds);
  const low = roundTo10(safe * 0.75);
  const high = Math.max(low, roundTo10(safe * 1.5));
  return { low, high };
}

export function computeServerOffset(serverNow?: string | null, clientNowAtFetch?: number): number {
  if (!serverNow || typeof clientNowAtFetch !== "number" || !Number.isFinite(clientNowAtFetch)) return 0;
  const parsed = Date.parse(serverNow);
  if (!Number.isFinite(parsed)) return 0;
  return parsed - clientNowAtFetch;
}

function effectiveNowMs(ctx?: ProgressContext): number {
  const nowClient = typeof ctx?.nowClient === "number" && Number.isFinite(ctx.nowClient) ? ctx.nowClient : Date.now();
  const offset =
    typeof ctx?.serverOffset === "number" && Number.isFinite(ctx.serverOffset)
      ? ctx.serverOffset
      : computeServerOffset(ctx?.serverNow, ctx?.clientNowAtFetch);
  return nowClient + offset;
}

function parseIsoMs(iso?: string | null): number | null {
  if (!iso || typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function pickVariant(scene: PlateScene, variantForView?: PlateVariant | null, ctx?: ProgressContext): PlateVariant | PlateScene {
  if (variantForView) return variantForView;
  if (ctx?.viewAspect && scene.variants?.[ctx.viewAspect]) {
    return scene.variants[ctx.viewAspect]!;
  }
  return scene;
}

export function isScenePlaybackClip(
  scene?: { playback?: unknown; stage?: string | null } | null,
  variant?: { playback?: unknown; stage?: string | null } | null
): boolean {
  const p = variant?.playback ?? scene?.playback;
  if (p === "clip") return true;
  if (typeof p === "object" && p !== null && (p as { mode?: unknown }).mode === "clip") return true;
  return false;
}

export function isSceneStale(
  scene?: { stale?: boolean; stage?: string | null } | null,
  variant?: { stale?: boolean; stage?: string | null } | null
): boolean {
  if (variant?.stale === true || variant?.stage === "stale") return true;
  if (variant?.stale === false) return false;
  return Boolean(scene?.stale === true || scene?.stage === "stale");
}

export function mapVariantPhase(
  scene: PlateScene,
  variant?: PlateVariant | PlateScene | null,
  isLiveMode?: boolean
): SceneProgressPhase {
  const v = variant ?? scene;
  if (isSceneStale(scene, v as { stale?: boolean; stage?: string | null })) return "waiting";
  const state = v.state ?? scene.state;
  const isClip = isScenePlaybackClip(scene as { playback?: unknown }, v as { playback?: unknown });
  const liveFlag = !isClip && Boolean((v as PlateVariant).live ?? scene.live ?? isLiveMode);
  if (state === "failed") return "failed";
  if (state === "drawn" || (state === "checked" && liveFlag)) return "ready";
  if (state === "rendering" || (isClip && (state === "bundled" || state === "checked"))) return "drawing";
  if (state === "bundled" || state === "checked") return "checking";
  if (state === "authoring") return "writing";
  return "waiting";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Typical writing duration in seconds for this film:
 * - Median of finished/authored scenes' `authorMs / 1000` when present
 * - Fallback to finished scenes' `(drawnAt - createdAt)` in seconds when `authorMs` is absent
 * - Before any finished scene, `DEFAULT_TYPICAL_WRITE_SECONDS` (180 s).
 */
export function measureTypicalWriteSeconds(scenes?: readonly PlateScene[], viewAspect?: PlateAspect): {
  seconds: number;
  measured: boolean;
} {
  if (!scenes?.length) return { seconds: DEFAULT_TYPICAL_WRITE_SECONDS, measured: false };
  const authorSeconds: number[] = [];
  const fallbackSpanSeconds: number[] = [];

  for (const s of scenes) {
    const v = (viewAspect && s.variants?.[viewAspect]) ? s.variants[viewAspect]! : s;
    const aMs = v.authorMs ?? s.authorMs;
    if (typeof aMs === "number" && Number.isFinite(aMs) && aMs > 1000) {
      authorSeconds.push(clamp(aMs / 1000, 15, 900));
      continue;
    }
    const createdMs = parseIsoMs(v.createdAt ?? s.createdAt);
    const drawnMs = parseIsoMs(v.drawnAt ?? s.drawnAt);
    if (createdMs !== null && drawnMs !== null && drawnMs > createdMs + 1000) {
      fallbackSpanSeconds.push(clamp((drawnMs - createdMs) / 1000, 15, 900));
    }
  }

  const samples = authorSeconds.length > 0 ? authorSeconds : fallbackSpanSeconds;
  if (samples.length === 0) {
    return { seconds: DEFAULT_TYPICAL_WRITE_SECONDS, measured: false };
  }
  return { seconds: median(samples), measured: true };
}

/**
 * Measured clip render duration in seconds across finished clip scenes in this film:
 * - Uses `(drawnAt - updatedAt)` when `drawnAt > updatedAt + 1s`, or `(drawnAt - createdAt - authorMs)` / `(drawnAt - createdAt)`
 *   for finished `drawn` scenes in `scenes`.
 * - Returns `{ seconds: null, measured: false }` when no finished clip scene in this film has render timestamps.
 */
export function measureTypicalClipRenderSeconds(
  scenes?: readonly PlateScene[],
  viewAspect?: PlateAspect
): { seconds: number | null; measured: boolean } {
  if (!scenes?.length) return { seconds: null, measured: false };
  const samples: number[] = [];

  for (const s of scenes) {
    const v = viewAspect && s.variants?.[viewAspect] ? s.variants[viewAspect]! : s;
    const st = v.state ?? s.state;
    if (st !== "drawn") continue;
    const drawnMs = parseIsoMs(v.drawnAt ?? s.drawnAt);
    if (drawnMs === null) continue;
    const updatedMs = parseIsoMs(v.updatedAt ?? s.updatedAt);
    const createdMs = parseIsoMs(v.createdAt ?? s.createdAt);
    if (updatedMs !== null && drawnMs > updatedMs + 1000) {
      samples.push(clamp((drawnMs - updatedMs) / 1000, 10, 900));
      continue;
    }
    if (createdMs !== null && drawnMs > createdMs + 1000) {
      const aMs = v.authorMs ?? s.authorMs;
      const spanMs = drawnMs - createdMs;
      const clipMs =
        typeof aMs === "number" && Number.isFinite(aMs) && aMs > 0 && spanMs > aMs + 1000
          ? spanMs - aMs
          : spanMs;
      samples.push(clamp(clipMs / 1000, 10, 900));
    }
  }

  if (samples.length === 0) {
    return { seconds: null, measured: false };
  }
  return { seconds: median(samples), measured: true };
}

export interface ClipPreparationEtaInput {
  framesDone?: number | null;
  frames?: number | null;
  seconds?: number | null;
  drawMsPerFrame?: number | null;
  elapsedSec: number;
  scenes?: readonly PlateScene[];
  viewAspect?: PlateAspect;
}

export interface ClipPreparationEtaResult {
  estimateSeconds: number;
  remainingSeconds: number | null;
  etaSeconds: EtaRange | null;
  etaNote: string | null;
  takingLongerThanUsual: boolean;
  fraction: number;
  fractionEstimated: boolean;
}

/**
 * Estimates total worker clip render time in seconds using sources of truth (b) and (c):
 * - (b) median clip render duration of finished clip scenes in this film, or `drawMsPerFrame * frames` as a lower bound
 * - (c) default `CLIP_RENDER_SECONDS_PER_FRAME = 1` second per frame (~2.5 min for 150 frames).
 */
export function estimateClipRenderSeconds(input: {
  frames?: number | null;
  seconds?: number | null;
  drawMsPerFrame?: number | null;
  scenes?: readonly PlateScene[];
  viewAspect?: PlateAspect;
}): number {
  const frames =
    typeof input.frames === "number" && input.frames > 0
      ? input.frames
      : Math.max(
          1,
          Math.round((typeof input.seconds === "number" && input.seconds > 0 ? input.seconds : 4) * 30)
        );
  const measured = measureTypicalClipRenderSeconds(input.scenes, input.viewAspect);
  const baseSec = measured.seconds !== null ? measured.seconds : frames * CLIP_RENDER_SECONDS_PER_FRAME;
  const drawMs =
    typeof input.drawMsPerFrame === "number" && Number.isFinite(input.drawMsPerFrame) && input.drawMsPerFrame > 0
      ? input.drawMsPerFrame
      : 0;
  const lowerBoundSec = (drawMs * frames) / 1000;
  return Math.max(baseSec, lowerBoundSec);
}

/**
 * Honest ETA and progress bar calculation for clip preparation:
 * - Source of truth in order:
 *   (a) real `framesDone / frames` from `/plates` (`remaining = elapsed * (1 - f) / f` once `f >= 0.1`)
 *   (b) measured clip render time in this film (or `drawMsPerFrame * frames` as a lower bound)
 *   (c) `CLIP_RENDER_SECONDS_PER_FRAME = 1` s per frame
 * - When `elapsed >= estimate` (and no determinate `f >= 0.1` rate applies), returns `etaSeconds: null` and
 *   `etaNote: "taking longer than usual"` (no countdown) instead of `"under a minute left"`.
 * - A shown ETA never shrinks below the real remaining work when progress says otherwise (`0 < f < 0.1` or `drawMsPerFrame` lower bound).
 * - Rounds `remainingSeconds` to 10 s; never claims exact.
 * - Returns a determinate `fraction` (`fractionEstimated: false`) when `framesDone > 0`, else an estimated bar (`fractionEstimated: true`).
 */
export function computeClipPreparationEta(input: ClipPreparationEtaInput): ClipPreparationEtaResult {
  const totalFrames =
    typeof input.frames === "number" && input.frames > 0
      ? input.frames
      : Math.max(
          1,
          Math.round((typeof input.seconds === "number" && input.seconds > 0 ? input.seconds : 4) * 30)
        );
  const estimateSec = estimateClipRenderSeconds({
    frames: totalFrames,
    seconds: input.seconds,
    drawMsPerFrame: input.drawMsPerFrame,
    scenes: input.scenes,
    viewAspect: input.viewAspect
  });
  const elapsed = Math.max(0, Number.isFinite(input.elapsedSec) ? input.elapsedSec : 0);
  const hasDone =
    typeof input.framesDone === "number" && Number.isFinite(input.framesDone) && input.framesDone > 0;
  const doneFrames = hasDone ? clamp(input.framesDone!, 0, totalFrames) : null;
  const f = doneFrames !== null && totalFrames > 0 ? clamp(doneFrames / totalFrames, 0, 1) : null;
  const drawMs =
    typeof input.drawMsPerFrame === "number" && Number.isFinite(input.drawMsPerFrame) && input.drawMsPerFrame > 0
      ? input.drawMsPerFrame
      : 0;

  // (a) Real progress from `framesDone / frames`
  if (f !== null) {
    const remainingFrames = Math.max(0, totalFrames - (doneFrames ?? 0));
    const lowerBoundRemaining = (drawMs * remainingFrames) / 1000;
    if (f >= 1) {
      const rem = roundTo10(10);
      return {
        estimateSeconds: estimateSec,
        remainingSeconds: rem,
        etaSeconds: toEtaRange(rem),
        etaNote: null,
        takingLongerThanUsual: false,
        fraction: 1,
        fractionEstimated: false
      };
    }
    if (f >= 0.1) {
      const byRate = elapsed > 0 ? (elapsed * (1 - f)) / f : estimateSec * (1 - f);
      const rawRem = Math.max(byRate, lowerBoundRemaining);
      const rem = roundTo10(rawRem);
      return {
        estimateSeconds: estimateSec,
        remainingSeconds: rem,
        etaSeconds: toEtaRange(rem),
        etaNote: null,
        takingLongerThanUsual: false,
        fraction: f,
        fractionEstimated: false
      };
    }
    // 0 < f < 0.1: progress is present but under 10%. If elapsed >= estimate, show "taking longer than usual";
    // otherwise never let the ETA shrink below the remaining work `(1 - f) * estimateSec`.
    if (elapsed >= estimateSec) {
      return {
        estimateSeconds: estimateSec,
        remainingSeconds: null,
        etaSeconds: null,
        etaNote: TAKING_LONGER_NOTE,
        takingLongerThanUsual: true,
        fraction: f,
        fractionEstimated: false
      };
    }
    const byCountdown = Math.max(estimateSec - elapsed, 0);
    const byRemainingWork = Math.max(estimateSec * (1 - f), lowerBoundRemaining);
    const rem = roundTo10(Math.max(byCountdown, byRemainingWork));
    return {
      estimateSeconds: estimateSec,
      remainingSeconds: rem,
      etaSeconds: toEtaRange(rem),
      etaNote: null,
      takingLongerThanUsual: false,
      fraction: f,
      fractionEstimated: false
    };
  }

  // (b) & (c) No real `framesDone / frames` progress yet -> estimated bar + countdown from `estimateSec`
  const estimatedFraction = clamp(elapsed / Math.max(1, estimateSec), 0.03, 0.95);
  if (elapsed >= estimateSec) {
    return {
      estimateSeconds: estimateSec,
      remainingSeconds: null,
      etaSeconds: null,
      etaNote: TAKING_LONGER_NOTE,
      takingLongerThanUsual: true,
      fraction: estimatedFraction,
      fractionEstimated: true
    };
  }

  const rawRem = Math.max(estimateSec - elapsed, 0);
  const rem = roundTo10(rawRem);
  return {
    estimateSeconds: estimateSec,
    remainingSeconds: rem,
    etaSeconds: toEtaRange(rem),
    etaNote: null,
    takingLongerThanUsual: false,
    fraction: estimatedFraction,
    fractionEstimated: true
  };
}

function resolveSinceMs(
  scene: PlateScene,
  v: PlateVariant | PlateScene,
  phase: SceneProgressPhase,
  ctx?: ProgressContext
): number | null {
  const firstSeenKeyState = `${scene.index}:${v.state}`;
  const firstSeenKeyPhase = `${scene.index}:${phase}`;
  const firstSeen =
    ctx?.firstSeenAt?.[firstSeenKeyPhase] ??
    ctx?.firstSeenAt?.[firstSeenKeyState] ??
    ctx?.firstSeenAt?.[String(scene.index)] ??
    null;
  const updatedMs = parseIsoMs(v.updatedAt ?? scene.updatedAt);
  const createdMs = parseIsoMs(v.createdAt ?? sCreatedAt(scene));

  if (updatedMs !== null) {
    // During authoring, renewAuthor bumps updated_at every 25s; if we saw this phase earlier, keep the earlier start.
    if (firstSeen !== null && firstSeen < updatedMs) return firstSeen;
    return updatedMs;
  }
  if (firstSeen !== null) return firstSeen;
  if (createdMs !== null) return createdMs;
  return null;
}

function sCreatedAt(scene: PlateScene): string | undefined {
  return scene.createdAt;
}

export function resolveElapsedMs(
  scene: PlateScene,
  variantForView?: PlateVariant | null,
  ctx?: ProgressContext
): number | null {
  const v = pickVariant(scene, variantForView, ctx);
  const phase = mapVariantPhase(scene, v, ctx?.isLiveMode);
  if (phase === "ready" || phase === "failed") return null;
  const since = resolveSinceMs(scene, v, phase, ctx);
  if (since === null) return 0;
  const now = effectiveNowMs(ctx);
  return Math.max(0, Math.round(now - since));
}

function rawRemainingForWriting(elapsedSec: number, typicalWriteSec: number): number {
  return Math.max(10, typicalWriteSec - elapsedSec);
}

function rawRemainingForDrawing(
  framesDone: number | null | undefined,
  frames: number | null | undefined,
  elapsedSec: number
): number {
  const total = typeof frames === "number" && frames > 0 ? frames : 0;
  const done = typeof framesDone === "number" && framesDone > 0 ? Math.min(total || framesDone, framesDone) : 0;
  if (total > 0 && done > 0) {
    const frac = clamp(done / total, 0.01, 1);
    if (frac >= 1) return 5;
    if (elapsedSec > 2) {
      const rate = done / elapsedSec;
      const byRate = (total - done) / rate;
      return clamp(byRate, 5, 180);
    }
    return Math.max(5, (1 - frac) * DEFAULT_DRAWING_SECONDS);
  }
  return Math.max(10, DEFAULT_DRAWING_SECONDS - Math.min(DEFAULT_DRAWING_SECONDS - 10, elapsedSec));
}

function resolveRetrying(
  scene: PlateScene,
  v: PlateVariant | PlateScene,
  phase: SceneProgressPhase
): SceneRetrying | null {
  if (phase === "ready" || phase === "failed") return null;
  const r = v.retrying ?? scene.retrying;
  if (!r || typeof r.reason !== "string" || !r.reason.trim()) return null;
  const attempt =
    typeof r.attempt === "number" && Number.isFinite(r.attempt) && r.attempt >= 1
      ? Math.floor(r.attempt)
      : 1;
  return { attempt, reason: r.reason.trim() };
}

/**
 * Capitalises the first character of a server retry reason while keeping the rest of the reason text as given
 * (e.g. `"the drawing worker restarted"` -> `"The drawing worker restarted"`).
 */
export function capitalizeReason(reason: string): string {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Formats the retry status string for a scene (`sceneIndex` is 0-based):
 * - When `attempt <= 1`: `"Retrying scene 3 (the drawing worker restarted)"`
 * - When `attempt > 1`: `"Retrying scene 3 · attempt 2 · the writing process restarted"`
 */
export function formatRetryingSceneText(sceneIndex: number, retrying: SceneRetrying): string {
  const sceneNumber = Math.max(1, Math.floor(sceneIndex) + 1);
  const reason = (retrying.reason ?? "").trim();
  const attempt =
    typeof retrying.attempt === "number" && Number.isFinite(retrying.attempt) && retrying.attempt >= 1
      ? Math.floor(retrying.attempt)
      : 1;
  if (attempt > 1) {
    return `Retrying scene ${sceneNumber} · attempt ${attempt} · ${reason}`;
  }
  return `Retrying scene ${sceneNumber} (${reason})`;
}

/**
 * Computes live progress for a single scene (and optional viewed-ratio variant).
 */
export function sceneProgress(
  scene: PlateScene,
  variantForView?: PlateVariant | null,
  ctx?: ProgressContext
): SceneProgressResult {
  const v = pickVariant(scene, variantForView, ctx);
  if (isSceneStale(scene, v as { stale?: boolean; stage?: string | null })) {
    return {
      phase: "waiting",
      label: "Needs update",
      chipLabel: "Needs update",
      meaning: "Storyboard or style changed — update animation to redraw this scene",
      fraction: null,
      elapsedMs: null,
      etaSeconds: null,
      retrying: null,
      stale: true
    };
  }
  const phase = mapVariantPhase(scene, v, ctx?.isLiveMode);
  const { seconds: typicalWriteSec } = measureTypicalWriteSeconds(ctx?.scenes, ctx?.viewAspect);
  const elapsedMs = resolveElapsedMs(scene, variantForView, ctx);
  const elapsedSec = (elapsedMs ?? 0) / 1000;
  const retrying = resolveRetrying(scene, v, phase);

  const applyRetryingOverride = (base: SceneProgressResult): SceneProgressResult => {
    if (!retrying) return { ...base, retrying: null };
    return {
      ...base,
      label: formatRetryingSceneText(scene.index, retrying),
      chipLabel: "Retrying",
      meaning: capitalizeReason(retrying.reason),
      retrying
    };
  };

  if (phase === "ready") {
    return {
      phase: "ready",
      label: "Ready",
      chipLabel: "Ready",
      meaning: "Ready to play",
      fraction: 1,
      elapsedMs: null,
      etaSeconds: null,
      retrying: null
    };
  }

  if (phase === "failed") {
    const errText = v.error ?? scene.error ?? "This scene could not be drawn.";
    return {
      phase: "failed",
      label: "Failed",
      chipLabel: "Failed",
      meaning: errText,
      fraction: null,
      elapsedMs: null,
      etaSeconds: null,
      retrying: null
    };
  }

  if (phase === "checking") {
    if (elapsedSec >= CHECKING_TAKING_LONGER_SECONDS) {
      return applyRetryingOverride({
        phase: "checking",
        label: "Checking",
        chipLabel: "Checking",
        meaning: "Checking it draws correctly",
        fraction: null,
        elapsedMs,
        etaSeconds: null,
        etaNote: TAKING_LONGER_NOTE,
        takingLongerThanUsual: true
      });
    }
    const rem = Math.max(5, DEFAULT_CHECKING_SECONDS - Math.min(15, elapsedSec));
    return applyRetryingOverride({
      phase: "checking",
      label: "Checking",
      chipLabel: "Checking",
      meaning: "Checking it draws correctly",
      fraction: null,
      elapsedMs,
      etaSeconds: toEtaRange(rem)
    });
  }

  if (phase === "drawing") {
    const totalFrames = typeof v.frames === "number" && v.frames > 0 ? v.frames : (typeof scene.frames === "number" && scene.frames > 0 ? scene.frames : null);
    const doneFrames =
      typeof v.framesDone === "number" && v.framesDone >= 0
        ? v.framesDone
        : typeof scene.framesDone === "number" && scene.framesDone >= 0
          ? scene.framesDone
          : null;
    const hasDeterminateCounts = totalFrames !== null && doneFrames !== null && doneFrames > 0;
    const clampedDone = hasDeterminateCounts ? clamp(doneFrames, 0, totalFrames) : 0;
    const isSlowClip = isScenePlaybackClip(scene as { playback?: unknown }, v as { playback?: unknown });
    const drawMsPerFrame =
      typeof v.drawMsPerFrame === "number" && v.drawMsPerFrame > 0
        ? v.drawMsPerFrame
        : typeof scene.drawMsPerFrame === "number" && scene.drawMsPerFrame > 0
          ? scene.drawMsPerFrame
          : null;
    const clipEta = computeClipPreparationEta({
      framesDone: doneFrames,
      frames: totalFrames,
      seconds: scene.seconds,
      drawMsPerFrame,
      elapsedSec,
      scenes: ctx?.scenes,
      viewAspect: ctx?.viewAspect
    });
    const sceneNumber = Math.max(1, Math.floor(scene.index) + 1);
    const label = isSlowClip
      ? `Scene ${sceneNumber} is being prepared as a video for smooth playback`
      : "Drawing the scene";
    const meaning = hasDeterminateCounts ? `Drawing frames ${clampedDone}/${totalFrames}` : "Drawing frames";
    const chipLabel = hasDeterminateCounts ? `Drawing ${clampedDone}/${totalFrames}` : "Drawing";
    const fraction = hasDeterminateCounts
      ? clipEta.fraction
      : isSlowClip
        ? clipEta.fraction
        : null;
    const fractionEstimated = !hasDeterminateCounts && isSlowClip;
    return applyRetryingOverride({
      phase: "drawing",
      label,
      chipLabel,
      meaning,
      fraction,
      ...(fractionEstimated ? { fractionEstimated: true } : {}),
      elapsedMs,
      etaSeconds: clipEta.etaSeconds,
      ...(clipEta.etaNote ? { etaNote: clipEta.etaNote } : {}),
      ...(clipEta.takingLongerThanUsual ? { takingLongerThanUsual: true } : {}),
      ...(isSlowClip ? { preparingAsClip: true } : {})
    });
  }

  if (phase === "writing") {
    const fraction = clamp(elapsedSec / typicalWriteSec, 0.03, 0.95);
    const pct = Math.round(fraction * 100);
    const rem = rawRemainingForWriting(elapsedSec, typicalWriteSec);
    return applyRetryingOverride({
      phase: "writing",
      label: "Writing the scene",
      chipLabel: `Writing ${pct}%`,
      meaning: "Writing the scene's drawing code",
      fraction,
      elapsedMs,
      etaSeconds: toEtaRange(rem)
    });
  }

  // phase === "waiting"
  // A waiting scene waits for the scenes ahead limited by concurrency WRITE_PARALLEL = 2, plus its own writing time.
  const allScenes = ctx?.scenes ?? [scene];
  const slots = Array.from({ length: WRITE_PARALLEL }, () => 0);

  for (const s of allScenes) {
    const sv = pickVariant(s, undefined, ctx);
    const sp = mapVariantPhase(s, sv, ctx?.isLiveMode);
    if (sp === "writing") {
      const sElapsed = (resolveElapsedMs(s, null, ctx) ?? 0) / 1000;
      const sRem = rawRemainingForWriting(sElapsed, typicalWriteSec);
      slots.sort((a, b) => a - b);
      slots[0]! += sRem;
    }
  }

  let waitBeforeStart = 0;
  const waitingScenes = allScenes.filter((s) => {
    const sv = pickVariant(s, undefined, ctx);
    return mapVariantPhase(s, sv, ctx?.isLiveMode) === "waiting";
  });

  let foundSelf = false;
  for (const ws of waitingScenes) {
    slots.sort((a, b) => a - b);
    const earliestFree = slots[0]!;
    if (ws.index === scene.index) {
      waitBeforeStart = earliestFree;
      slots[0] = earliestFree + typicalWriteSec;
      foundSelf = true;
      break;
    }
    slots[0] = earliestFree + typicalWriteSec;
  }

  if (!foundSelf) {
    slots.sort((a, b) => a - b);
    waitBeforeStart = slots[0]!;
  }

  const tailSec = ctx?.isLiveMode ? DEFAULT_CHECKING_SECONDS : 0;
  const totalSecForScene = waitBeforeStart + typicalWriteSec + tailSec;

  return applyRetryingOverride({
    phase: "waiting",
    label: "Waiting in queue",
    chipLabel: "Waiting",
    meaning: "Queued behind earlier scenes",
    fraction: 0,
    elapsedMs,
    etaSeconds: toEtaRange(totalSecForScene)
  });
}

/**
 * Computes overall film progress across all scenes.
 * "written" = scenes past the writing phase (`checking`, `drawing`, `ready`).
 * Failed scenes are excluded from the ETA queue and counted in `failed`.
 */
export function filmProgress(scenes: readonly PlateScene[], ctx?: ProgressContext): FilmProgressResult {
  const total = scenes.length;
  const { seconds: typicalWriteSec, measured } = measureTypicalWriteSeconds(scenes, ctx?.viewAspect);
  const typicalSceneSeconds: EtaRange = measured
    ? toEtaRange(typicalWriteSec)
    : { low: 2 * 60, high: 4 * 60 };

  if (total === 0) {
    return {
      total: 0,
      written: 0,
      drawn: 0,
      failed: 0,
      fraction: 0,
      etaSeconds: null,
      typicalSceneSeconds
    };
  }

  const enrichedCtx: ProgressContext = { ...ctx, scenes };
  let written = 0;
  let drawn = 0;
  let failed = 0;
  let progressSum = 0;

  const writingRemains: number[] = [];
  let waitingCount = 0;
  let maxPostWriteRemain = 0;

  for (const s of scenes) {
    const sp = sceneProgress(s, undefined, enrichedCtx);
    const elapsedSec = (sp.elapsedMs ?? 0) / 1000;

    if (sp.phase === "ready") {
      written += 1;
      drawn += 1;
      progressSum += 1;
    } else if (sp.phase === "failed") {
      failed += 1;
    } else if (sp.phase === "drawing") {
      written += 1;
      const drawFrac = sp.fraction ?? 0.25;
      progressSum += 0.7 + 0.3 * drawFrac;
      if (!sp.takingLongerThanUsual) {
        const v = pickVariant(s, undefined, enrichedCtx);
        const totalF = typeof v.frames === "number" && v.frames > 0 ? v.frames : s.frames;
        const doneF = typeof v.framesDone === "number" ? v.framesDone : s.framesDone;
        const drawMs = typeof v.drawMsPerFrame === "number" ? v.drawMsPerFrame : s.drawMsPerFrame;
        const clipEta = computeClipPreparationEta({
          framesDone: doneF,
          frames: totalF,
          seconds: s.seconds,
          drawMsPerFrame: drawMs,
          elapsedSec,
          scenes,
          viewAspect: ctx?.viewAspect
        });
        if (clipEta.remainingSeconds !== null) {
          maxPostWriteRemain = Math.max(maxPostWriteRemain, clipEta.remainingSeconds);
        }
      }
    } else if (sp.phase === "checking") {
      written += 1;
      progressSum += 0.65;
      if (!sp.takingLongerThanUsual) {
        const rem = Math.max(5, DEFAULT_CHECKING_SECONDS - Math.min(15, elapsedSec));
        maxPostWriteRemain = Math.max(maxPostWriteRemain, rem + (ctx?.isLiveMode ? 0 : DEFAULT_DRAWING_SECONDS));
      }
    } else if (sp.phase === "writing") {
      const writeFrac = sp.fraction ?? 0.05;
      progressSum += 0.6 * writeFrac;
      writingRemains.push(rawRemainingForWriting(elapsedSec, typicalWriteSec));
    } else {
      // waiting
      waitingCount += 1;
    }
  }

  const fraction = clamp(progressSum / total, 0, 1);

  const activeWorkCount = writingRemains.length + waitingCount + (maxPostWriteRemain > 0 ? 1 : 0);
  if (drawn === total || activeWorkCount === 0) {
    return {
      total,
      written,
      drawn,
      failed,
      fraction: drawn === total ? 1 : fraction,
      etaSeconds: null,
      typicalSceneSeconds
    };
  }

  // Simulate parallel writing slots (WRITE_PARALLEL = 2) for active + waiting scenes
  const slots = Array.from({ length: WRITE_PARALLEL }, () => 0);
  for (const rem of writingRemains) {
    slots.sort((a, b) => a - b);
    slots[0]! += rem;
  }
  for (let i = 0; i < waitingCount; i++) {
    slots.sort((a, b) => a - b);
    slots[0]! += typicalWriteSec;
  }

  const maxWriteFinish = Math.max(...slots);
  const postWriteTail =
    writingRemains.length > 0 || waitingCount > 0
      ? ctx?.isLiveMode
        ? DEFAULT_CHECKING_SECONDS
        : DEFAULT_DRAWING_SECONDS
      : 0;

  const totalRemainSec = Math.max(maxPostWriteRemain, maxWriteFinish + postWriteTail);

  return {
    total,
    written,
    drawn,
    failed,
    fraction,
    etaSeconds: toEtaRange(totalRemainSec),
    typicalSceneSeconds
  };
}

/**
 * Formats an `{ low, high }` ETA range in seconds without trailing `" left"`
 * (e.g. `"under a minute"` or `"about N min"`).
 */
export function formatEtaBrief(eta: EtaRange | null | undefined): string {
  if (!eta) return "";
  const mid = (eta.low + eta.high) / 2;
  if (!Number.isFinite(mid) || mid <= 0) return "";
  if (mid < 60) return "under a minute";
  const mins = Math.max(1, Math.round(mid / 60));
  return `about ${mins} min`;
}

/**
 * Formats an `{ low, high }` ETA range in seconds using honest wording:
 * - `null` -> `""`
 * - midpoint under 1 minute (< 60s) -> `"under a minute left"`
 * - otherwise midpoint rounded to the nearest minute -> `"about N min left"`
 */
export function formatEta(eta: EtaRange | null | undefined): string {
  const brief = formatEtaBrief(eta);
  return brief ? `${brief} left` : "";
}

/**
 * Compact ETA string for narrow toolbars (e.g. `"~3 min"` or `"<1 min"`).
 */
export function formatEtaCompact(eta: EtaRange | null | undefined): string {
  if (!eta) return "";
  const mid = (eta.low + eta.high) / 2;
  if (!Number.isFinite(mid) || mid <= 0) return "";
  if (mid < 60) return "<1 min";
  const mins = Math.max(1, Math.round(mid / 60));
  return `~${mins} min`;
}

export interface BufferingRateSample {
  /** Timestamp in milliseconds (`performance.now()` or `Date.now()`). */
  atMs: number;
  /** Ready or total drawn frames observed at `atMs`. */
  readyFrames: number;
}

export interface BufferingEstimateResult {
  /** Observed frame production rate in frames per second over the sample window (`null` when not yet measurable). */
  rateFps: number | null;
  /** Estimated seconds until `neededFrames` are ready (`null` when not yet measurable, `0` when already met). */
  secondsLeft: number | null;
  /** Plain-language estimate string (`"about 3 s"`, `"a moment"`, etc.). */
  text: string;
}

export const BUFFERING_WINDOW_MS = 2_000;
export const BUFFERING_SHOW_DELAY_MS = 400;

/**
 * Estimates when buffering will resume from a ring buffer of `{ atMs, readyFrames }` samples
 * over the last ~2 s:
 * - If `neededFrames <= readyFrames` or `neededFrames <= 0`, returns `secondsLeft: 0`, `text: "a moment"`.
 * - Prunes samples older than `windowMs` (default 2000 ms) from `nowMs`, keeping at least the earliest sample within the window.
 * - Computes `rateFps` from the earliest to latest sample when `dtMs >= 200` and `dFrames > 0`.
 * - Never returns an exact timestamp: clamps estimated seconds into `[1, 120]` and formats as `"about N s"` (or `"about N min"` if > 90s);
 *   when no positive rate is measurable yet, returns `"a moment"`.
 */
export function estimateBufferingResume(input: {
  readyFrames: number;
  neededFrames: number;
  samples?: readonly BufferingRateSample[];
  nowMs?: number;
  windowMs?: number;
}): BufferingEstimateResult {
  const ready = Number.isFinite(input.readyFrames) ? Math.max(0, Math.floor(input.readyFrames)) : 0;
  const needed = Number.isFinite(input.neededFrames) ? Math.max(0, Math.floor(input.neededFrames)) : 0;
  const remaining = Math.max(0, needed - ready);

  if (needed <= 0 || remaining === 0) {
    return { rateFps: null, secondsLeft: 0, text: "a moment" };
  }

  const rawSamples = input.samples ?? [];
  if (rawSamples.length < 2) {
    return { rateFps: null, secondsLeft: null, text: "a moment" };
  }

  const windowMs = typeof input.windowMs === "number" && input.windowMs > 0 ? input.windowMs : BUFFERING_WINDOW_MS;
  const latestMs =
    typeof input.nowMs === "number" && Number.isFinite(input.nowMs)
      ? input.nowMs
      : rawSamples[rawSamples.length - 1]!.atMs;
  const cutoff = latestMs - windowMs;

  const recent = rawSamples.filter((s) => Number.isFinite(s.atMs) && Number.isFinite(s.readyFrames) && s.atMs >= cutoff);
  if (recent.length < 2) {
    return { rateFps: null, secondsLeft: null, text: "a moment" };
  }

  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const dtMs = last.atMs - first.atMs;
  const dFrames = last.readyFrames - first.readyFrames;

  if (!(dtMs >= 200) || !(dFrames > 0)) {
    return { rateFps: null, secondsLeft: null, text: "a moment" };
  }

  const rateFps = (dFrames * 1000) / dtMs;
  if (!Number.isFinite(rateFps) || rateFps <= 0) {
    return { rateFps: null, secondsLeft: null, text: "a moment" };
  }

  const rawSec = remaining / rateFps;
  const clampedSec = clamp(Math.round(rawSec), 1, 120);
  const text =
    clampedSec >= 90
      ? `about ${Math.round(clampedSec / 60)} min`
      : `about ${clampedSec} s`;

  return {
    rateFps: Math.round(rateFps * 100) / 100,
    secondsLeft: clampedSec,
    text
  };
}

/**
 * Appends a `{ atMs, readyFrames }` observation to a ring buffer and drops samples older than `windowMs`.
 */
export function recordBufferingSample(
  samples: readonly BufferingRateSample[],
  sample: BufferingRateSample,
  windowMs: number = BUFFERING_WINDOW_MS,
  maxSamples = 24
): BufferingRateSample[] {
  const cutoff = sample.atMs - windowMs;
  const next = samples.filter((s) => s.atMs >= cutoff && s.atMs <= sample.atMs);
  // If readyFrames reset backwards (e.g. seeked or changed scene), start fresh from the new sample
  if (next.length > 0 && sample.readyFrames < next[next.length - 1]!.readyFrames) {
    return [sample];
  }
  next.push(sample);
  if (next.length > maxSamples) {
    return next.slice(next.length - maxSamples);
  }
  return next;
}

export type BufferingCauseKind = "writing" | "clip" | "opening" | "drawing";

export interface BufferingCauseInput {
  /** 0-based scene index (`0` -> Scene 1). */
  sceneIndex: number;
  /** Total scenes in the film. */
  sceneCount?: number;
  /** Server plate / variant state (`"queued"`, `"authoring"`, `"bundled"`, `"checked"`, `"rendering"`, `"drawn"`, `"failed"`). */
  serverState?: string | null;
  /** Whether the scene is playable on the server (`checked` with passed check, or `drawn`). When false for queued/authoring/bundled, cause is `"writing"`. */
  serverPlayable?: boolean;
  /** Optional playback mode / marker from `/plates` (`"clip"`). */
  playback?: unknown;
  /** Whether this scene plays as a worker clip (`scene.state === "rendering"` or `playback === "clip"`). */
  isClipScene?: boolean;
  /** Step-3 `SceneProgressResult` for this scene (used when cause is `"writing"` or `"clip"`). */
  sceneProgress?: SceneProgressResult | null;
  /** Whether the scene's Worker / player has produced or cached at least one frame (or measured). */
  hasAnyFrame?: boolean;
  /** Ready frames ahead of the playhead (from `player.readyAhead(currentFrame)`). */
  readyFrames?: number | null;
  /** Frames needed ahead to start or resume playback (`resumeBufferFrames` / `runNeeded`). */
  neededFrames?: number | null;
  /** Ring-buffer samples of `{ atMs, readyFrames }` over the last ~2 s. */
  samples?: readonly BufferingRateSample[];
  /** Current timestamp in ms for rate calculation. */
  nowMs?: number;
}

export interface BufferingCauseResult {
  cause: BufferingCauseKind;
  sceneNumber: number;
  sceneLabel: string;
  title: string;
  meaning: string;
  detail?: string;
  readyFrames: number | null;
  neededFrames: number | null;
  progressFraction: number | null;
  progressIndeterminate: boolean;
  progressEstimated: boolean;
  elapsedText: string | null;
  etaText: string | null;
}

/**
 * Decides WHICH wait is happening during live playback / stage wait, in strict priority order:
 *   retrying > writing > clip > opening > drawing
 * 1. `"writing"`: The scene is still being written or checked (`queued`, `authoring`, or `bundled` checking without clip fallback).
 *    Shows `"Scene N is still being written"` (or retrying text when `retrying` is set) with that scene's phase meaning, elapsed time, and ETA from `sceneProgress`. Never says `"Buffering"`.
 * 2. `"clip"`: The scene is being prepared as a worker clip (`state === "rendering"` or `playback === "clip"` / `preparingAsClip` while not playable yet).
 *    Shows `"Scene N is being prepared as a video for smooth playback"` (or retrying text when `retrying` is set) with progress/ETA.
 * 3. `"opening"`: The scene is ready on the server, but its Worker is starting / no frame has arrived yet (`!hasAnyFrame` and `readyFrames === 0`).
 *    Shows `"Opening scene N…"` with an indeterminate bar.
 * 4. `"drawing"`: Frames are being drawn live and the buffer is below the resume/start threshold.
 *    Shows `"Drawing the next frames of scene N"` with `"ready/needed ready · resumes in <estimate>"` and a determinate progress bar.
 */
export function bufferingCause(input: BufferingCauseInput): BufferingCauseResult {
  const sceneNumber = Math.max(1, Math.floor(input.sceneIndex) + 1);
  const totalCount =
    typeof input.sceneCount === "number" && input.sceneCount > 0 ? String(input.sceneCount) : "…";
  const sceneLabel = `Scene ${sceneNumber} of ${totalCount}`;

  const state = input.serverState ?? "queued";
  const sp = input.sceneProgress ?? null;
  const isClipPreparation =
    Boolean(input.isClipScene) ||
    isScenePlaybackClip({ playback: input.playback }, null) ||
    Boolean(sp?.preparingAsClip) ||
    (state === "rendering" && input.serverPlayable !== true);

  const isWritingOrCheckingUnready =
    state === "queued" ||
    state === "authoring" ||
    (state === "bundled" && !isClipPreparation && input.serverPlayable !== true) ||
    (input.serverPlayable === false &&
      !isClipPreparation &&
      state !== "checked" &&
      state !== "drawn" &&
      state !== "failed");

  // Priority 1: Scene is being written or checked on the server (queued / authoring / bundled-checking)
  if (isWritingOrCheckingUnready) {
    const elapsedText = sp && sp.elapsedMs !== null ? formatElapsed(sp.elapsedMs) : null;
    const rawEta = sp?.etaSeconds ? formatEta(sp.etaSeconds) : "";
    const etaText = rawEta
      ? `${rawEta} · ${USUAL_SCENE_NOTE}`
      : sp && sp.phase !== "ready" && sp.phase !== "failed"
        ? USUAL_SCENE_NOTE
        : null;
    const title = sp?.retrying
      ? formatRetryingSceneText(input.sceneIndex, sp.retrying)
      : `Scene ${sceneNumber} is still being written`;
    const meaning = sp
      ? sp.retrying
        ? sp.meaning
        : sp.phase === "writing" || sp.phase === "waiting" || sp.phase === "checking"
          ? `${sp.label} · ${sp.meaning}`
          : sp.meaning
      : state === "bundled"
        ? "Checking it draws correctly"
        : state === "queued"
          ? "Queued behind earlier scenes"
          : "Writing the scene's drawing code";
    const frac = sp?.fraction ?? null;
    const isIndeterminate = sp?.phase === "checking" || frac === null;
    return {
      cause: "writing",
      sceneNumber,
      sceneLabel,
      title,
      meaning,
      readyFrames: null,
      neededFrames: null,
      progressFraction: frac,
      progressIndeterminate: isIndeterminate,
      progressEstimated: sp?.phase === "writing",
      elapsedText,
      etaText
    };
  }

  // Priority 2: Scene is being prepared as a video clip on the worker (not yet ready)
  if (isClipPreparation && input.serverPlayable !== true && state !== "drawn" && state !== "failed") {
    const elapsedText = sp && sp.elapsedMs !== null ? formatElapsed(sp.elapsedMs) : null;
    const rawEta = sp?.etaSeconds ? formatEta(sp.etaSeconds) : (sp?.etaNote ?? "");
    const etaText = rawEta || null;
    const title = sp?.retrying
      ? formatRetryingSceneText(input.sceneIndex, sp.retrying)
      : `Scene ${sceneNumber} is being prepared as a video for smooth playback`;
    const meaning = sp?.retrying
      ? sp.meaning
      : sp?.meaning ?? "Drawing frames";
    const frac = sp?.fraction ?? null;
    const isEstimated = Boolean(sp?.fractionEstimated);
    return {
      cause: "clip",
      sceneNumber,
      sceneLabel,
      title,
      meaning,
      readyFrames: null,
      neededFrames: null,
      progressFraction: frac,
      progressIndeterminate: frac === null && !isEstimated,
      progressEstimated: isEstimated,
      elapsedText,
      etaText
    };
  }

  const hasValidReady = typeof input.readyFrames === "number" && Number.isFinite(input.readyFrames) && input.readyFrames >= 0;
  const hasValidNeeded = typeof input.neededFrames === "number" && Number.isFinite(input.neededFrames) && input.neededFrames > 0;
  const readyFrames = hasValidReady ? Math.floor(input.readyFrames!) : null;
  const neededFrames = hasValidNeeded ? Math.max(1, Math.floor(input.neededFrames!)) : null;

  const workerHasStartedDrawing =
    input.hasAnyFrame === true || (readyFrames !== null && readyFrames > 0);

  // Priority 2: Scene is ready on the server, but its Worker is starting / no frame has arrived yet
  if (!workerHasStartedDrawing) {
    return {
      cause: "opening",
      sceneNumber,
      sceneLabel,
      title: `Opening scene ${sceneNumber}…`,
      meaning: "Starting the scene's drawing worker",
      readyFrames: readyFrames ?? 0,
      neededFrames,
      progressFraction: null,
      progressIndeterminate: true,
      progressEstimated: false,
      elapsedText: null,
      etaText: null
    };
  }

  // Priority 3: Frames are being drawn live and buffer is below resume threshold
  const clampedReady =
    readyFrames !== null && neededFrames !== null
      ? clamp(readyFrames, 0, neededFrames)
      : readyFrames;
  const hasCounts = clampedReady !== null && neededFrames !== null && neededFrames > 0;
  const fraction = hasCounts ? clamp(clampedReady / neededFrames, 0, 1) : null;
  const est =
    hasCounts
      ? estimateBufferingResume({
          readyFrames: clampedReady,
          neededFrames,
          samples: input.samples,
          nowMs: input.nowMs
        })
      : { rateFps: null, secondsLeft: null, text: "a moment" };

  const meaning = hasCounts
    ? `${clampedReady} of ${neededFrames} frames ready (${clampedReady}/${neededFrames} ready) · resumes in ${est.text}`
    : `Resumes in ${est.text}`;

  return {
    cause: "drawing",
    sceneNumber,
    sceneLabel,
    title: `Drawing the next frames of scene ${sceneNumber}`,
    meaning,
    readyFrames: clampedReady,
    neededFrames,
    progressFraction: fraction,
    progressIndeterminate: !hasCounts,
    progressEstimated: false,
    elapsedText: null,
    etaText: `resumes in ${est.text}`
  };
}

export interface BuildStagePrepPropsInput {
  prep?: "sound" | "scenes" | "motion" | null;
  sceneIndex: number;
  sceneCount: number;
  sceneState?: string | null;
  sceneStale?: boolean;
  sceneError?: string | null;
  playback?: unknown;
  isClipScene?: boolean;
  viewAspect: PlateAspect;
  primaryAspect?: PlateAspect;
  isViewAspectDrawn: boolean;
  isViewAspectDrawing: boolean;
  isPlayable: boolean;
  sceneProgress?: SceneProgressResult | null;
  backgroundSketch?: string | null;
  /** Optional live-mode stageWait override (e.g. `"Preview video is queued…"`, `"Updating…"`). */
  liveStageWait?: { failed: boolean; title: string; detail?: string } | null;
  /** Optional live buffering / preparing state when the scene is playable or opening in live mode. */
  liveBuffering?: {
    active: boolean;
    visibleAfterDelay: boolean;
    hasAnyFrame: boolean;
    readyFrames: number | null;
    neededFrames: number | null;
    samples?: readonly BufferingRateSample[];
    nowMs?: number;
  } | null;
}

export interface StagePrepBuiltProps {
  failed: boolean;
  stale?: boolean;
  compact?: boolean;
  compactText?: string;
  title: string;
  detail?: string;
  meaning?: string;
  sceneLabel?: string;
  elapsedText?: string | null;
  progressFraction?: number | null;
  progressIndeterminate?: boolean;
  progressEstimated?: boolean;
  etaText?: string | null;
  backgroundSketch?: string | null;
  compactCard?: boolean;
  cause?: BufferingCauseKind;
  actionLabel?: string;
}

/**
 * Formats the one-line text for the compact bottom-centre stage status chip
 * (e.g. `"Writing the scene · 0:37 · about 2 min left"`).
 */
export function formatCompactStagePrepText(input: {
  phaseWord: string;
  elapsedText?: string | null;
  shortEtaText?: string | null;
}): string {
  const cleanPhase = input.phaseWord.replace(/…+$/, "").trim();
  return [cleanPhase, input.elapsedText ?? null, input.shortEtaText ?? null]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

/**
 * Shared helper that builds the `AnimationPrep` stage props for BOTH clip mode (`PlatePreview`)
 * and live mode (`PlateLiveStage`), so the two call sites cannot drift.
 */
export function buildStagePrepProps(input: BuildStagePrepPropsInput): StagePrepBuiltProps | null {
  const sceneNum = Math.max(1, Math.floor(input.sceneIndex) + 1);
  const totalLabel = input.sceneCount > 0 ? String(input.sceneCount) : "…";
  const sceneLabel = `Scene ${sceneNum} of ${totalLabel}`;
  const sp = input.sceneProgress ?? null;
  const sketch = input.backgroundSketch ?? null;
  const hasSketch = Boolean(sketch && sketch.trim());
  const elapsedText = sp && sp.elapsedMs !== null ? formatElapsed(sp.elapsedMs) : null;
  const shortEtaText = sp?.etaSeconds
    ? formatEta(sp.etaSeconds)
    : sp?.etaNote
      ? sp.etaNote
      : null;
  const spEtaText = sp?.etaSeconds
    ? `${formatEta(sp.etaSeconds)} · ${USUAL_SCENE_NOTE}`
    : sp?.etaNote
      ? sp.etaNote
      : sp && sp.phase !== "ready" && sp.phase !== "failed"
        ? USUAL_SCENE_NOTE
        : null;

  // 1. Failed scene
  if (input.sceneState === "failed" || input.liveStageWait?.failed) {
    return {
      failed: true,
      compact: false,
      title: "This scene didn't draw",
      detail: input.sceneError ?? input.liveStageWait?.detail ?? sp?.meaning,
      sceneLabel,
      backgroundSketch: sketch,
      actionLabel: "Retry scene"
    };
  }

  // 1b. Stale scene (storyboard or style updated after earlier draw; awaiting user-authorized rebuild)
  if (input.sceneStale || sp?.stale || input.sceneState === "stale") {
    return {
      failed: false,
      stale: true,
      compact: false,
      title: "Storyboard updated · scene needs redraw",
      meaning: "Your script or visual style changed since this scene was drawn.",
      detail: "Update the animation to draw the changed scenes. Unchanged scenes are kept.",
      sceneLabel,
      backgroundSketch: sketch,
      actionLabel: "Update animation"
    };
  }

  // 2. Top-level workspace prep phases ("sound" / "scenes")
  if (input.prep === "sound") {
    const compactText = formatCompactStagePrepText({
      phaseWord: "Making the voiceover and music",
      elapsedText
    });
    return {
      failed: false,
      compact: hasSketch,
      ...(hasSketch ? { compactCard: true, compactText } : {}),
      title: hasSketch ? compactText : "Making the voiceover and music…",
      meaning: "Recording the narration and building the music bed",
      sceneLabel,
      elapsedText,
      progressFraction: sp?.fraction ?? null,
      progressEstimated: sp?.phase === "writing",
      etaText: null,
      backgroundSketch: sketch
    };
  }
  if (input.prep === "scenes") {
    const compactText = formatCompactStagePrepText({
      phaseWord: "Planning the scenes",
      elapsedText
    });
    return {
      failed: false,
      compact: hasSketch,
      ...(hasSketch ? { compactCard: true, compactText } : {}),
      title: hasSketch ? compactText : "Planning the scenes…",
      meaning: "Preparing the storyboard timing",
      sceneLabel,
      elapsedText,
      progressFraction: sp?.fraction ?? null,
      progressEstimated: sp?.phase === "writing",
      etaText: null,
      backgroundSketch: sketch
    };
  }

  // 3. Secondary aspect ratio currently drawing
  const isSecondaryAspectWait =
    input.isViewAspectDrawing &&
    !input.isViewAspectDrawn &&
    !input.isPlayable &&
    (input.primaryAspect === undefined || input.viewAspect !== input.primaryAspect || input.sceneState === "drawn");
  if (isSecondaryAspectWait || (!input.isPlayable && input.sceneState === "drawn" && !input.isViewAspectDrawn)) {
    const compactText = formatCompactStagePrepText({
      phaseWord: `Drawing scenes in ${input.viewAspect}`,
      elapsedText,
      shortEtaText
    });
    return {
      failed: false,
      compact: hasSketch,
      ...(hasSketch ? { compactCard: true, compactText } : {}),
      title: hasSketch ? compactText : `Drawing scenes in ${input.viewAspect}…`,
      meaning: `Drawing every scene on a ${input.viewAspect} canvas so no character is cropped`,
      sceneLabel,
      elapsedText,
      progressFraction: sp?.fraction ?? null,
      progressEstimated: sp?.phase === "writing",
      etaText: hasSketch ? shortEtaText : spEtaText,
      backgroundSketch: sketch
    };
  }

  // 4. Live buffering / preparing while on a scene
  if (input.liveBuffering?.active) {
    if (!input.liveBuffering.visibleAfterDelay) {
      return null;
    }
    const causeRes = bufferingCause({
      sceneIndex: input.sceneIndex,
      sceneCount: input.sceneCount,
      serverState: input.sceneState,
      serverPlayable: input.isPlayable,
      playback: input.playback,
      isClipScene: input.isClipScene,
      sceneProgress: sp,
      hasAnyFrame: input.liveBuffering.hasAnyFrame,
      readyFrames: input.liveBuffering.readyFrames,
      neededFrames: input.liveBuffering.neededFrames,
      samples: input.liveBuffering.samples,
      nowMs: input.liveBuffering.nowMs
    });
    const compactText =
      causeRes.cause === "drawing"
        ? causeRes.readyFrames !== null && causeRes.neededFrames !== null
          ? `${causeRes.title} · ${causeRes.readyFrames} of ${causeRes.neededFrames} frames ready${causeRes.etaText ? ` · ${causeRes.etaText}` : ""}`
          : causeRes.etaText
            ? `${causeRes.title} · ${causeRes.etaText}`
            : causeRes.title
        : causeRes.cause === "opening"
          ? causeRes.title
          : formatCompactStagePrepText({
              phaseWord: sp?.retrying
                ? formatRetryingSceneText(input.sceneIndex, sp.retrying)
                : causeRes.cause === "clip"
                  ? `Scene ${sceneNum} is being prepared as a video for smooth playback`
                  : sp && sp.phase !== "ready"
                    ? sp.label
                    : causeRes.title,
              elapsedText: causeRes.elapsedText,
              shortEtaText
            });
    return {
      failed: false,
      compact: true,
      compactText,
      title: causeRes.title,
      meaning: causeRes.meaning,
      sceneLabel: causeRes.sceneLabel,
      elapsedText: causeRes.elapsedText,
      progressFraction: causeRes.progressFraction,
      progressIndeterminate: causeRes.progressIndeterminate,
      progressEstimated: causeRes.progressEstimated,
      etaText: causeRes.etaText,
      backgroundSketch: causeRes.cause === "writing" || causeRes.cause === "clip" ? sketch : null,
      compactCard: true,
      cause: causeRes.cause
    };
  }

  // 5. Scene is not playable yet (authoring / queued / bundled / checking / rendering)
  if (!input.isPlayable || input.liveStageWait) {
    // If liveStageWait has a specific non-generic status like "Preview video is queued…" or "Updating…", honour it when sp is ready
    const specificWaitTitle =
      input.liveStageWait?.title &&
      (input.liveStageWait.title.startsWith("Preview video") ||
        input.liveStageWait.title.startsWith("Updating") ||
        input.liveStageWait.title.includes("is being prepared as a video for smooth playback"))
        ? input.liveStageWait.title
        : null;

    const isSlowClipWait =
      Boolean(sp?.preparingAsClip) ||
      Boolean(input.isClipScene) ||
      isScenePlaybackClip({ playback: input.playback }, null) ||
      Boolean(specificWaitTitle && specificWaitTitle.includes("is being prepared as a video for smooth playback"));

    const phaseWord = sp?.retrying
      ? formatRetryingSceneText(input.sceneIndex, sp.retrying)
      : specificWaitTitle
        ? specificWaitTitle.replace(/…+$/, "")
        : isSlowClipWait
          ? `Scene ${sceneNum} is being prepared as a video for smooth playback`
          : sp && sp.phase !== "ready"
            ? sp.label
            : input.sceneState === "authoring"
              ? "Writing the scene"
              : input.sceneState === "bundled"
                ? "Checking"
                : input.sceneState === "rendering"
                  ? "Drawing the scene"
                  : input.sceneState === "queued"
                    ? "Waiting in queue"
                    : (input.liveStageWait?.title ?? "Preparing the scenes").replace(/…+$/, "");

    const cardTitle = sp?.retrying
      ? formatRetryingSceneText(input.sceneIndex, sp.retrying)
      : specificWaitTitle
        ? specificWaitTitle
        : isSlowClipWait
          ? `Scene ${sceneNum} is being prepared as a video for smooth playback`
          : sp && sp.phase !== "ready"
            ? `${sp.label}…`
            : input.liveStageWait?.title ?? "Preparing the scenes…";

    const compactText = formatCompactStagePrepText({
      phaseWord,
      elapsedText,
      shortEtaText
    });

    const meaning =
      isSlowClipWait && sp?.phase === "checking"
        ? "Drawing frames"
        : sp && sp.phase !== "ready"
          ? sp.meaning
          : input.sceneState === "authoring"
            ? "Writing the scene's drawing code"
            : input.sceneState === "bundled"
              ? "Checking it draws correctly"
              : input.sceneState === "rendering"
                ? "Drawing frames"
                : input.sceneState === "queued"
                  ? "Queued behind earlier scenes"
                  : undefined;
    const isEstimated = Boolean(
      sp?.phase === "writing" ||
        sp?.fractionEstimated ||
        (isSlowClipWait && (sp?.fraction ?? null) === null)
    );
    const effectiveFraction =
      sp?.fraction ?? (isSlowClipWait && isEstimated ? 0.05 : null);
    const isIndeterminate = !isEstimated && (sp?.phase === "checking" || effectiveFraction === null);

    return {
      failed: false,
      compact: hasSketch,
      ...(hasSketch ? { compactCard: true, compactText } : {}),
      title: hasSketch ? compactText : cardTitle,
      meaning,
      detail: input.liveStageWait?.detail,
      sceneLabel,
      elapsedText,
      progressFraction: effectiveFraction,
      progressIndeterminate: isIndeterminate,
      progressEstimated: isEstimated,
      etaText: hasSketch ? shortEtaText : spEtaText,
      backgroundSketch: sketch,
      ...(isSlowClipWait ? { cause: "clip" as const } : {})
    };
  }

  return null;
}

export interface ResolveStagePrepOverlayInput {
  currentSceneIndex: number;
  filmToast?: { active: boolean; sceneIndex: number | null } | null;
  stagePrep: StagePrepBuiltProps | null;
  prep?: "sound" | "scenes" | "motion" | null;
  isSecondaryAspectDrawing?: boolean;
}

export interface StagePrepOverlayResolution {
  /** When true, the top aggregate toast already shows this exact scene/work status, so suppress the second status card/chip (keep only backgroundSketch if any). */
  suppressDuplicateText: boolean;
  /** Where any visible non-failed/non-stale status chip should sit: "top" (when no filmToast is active and live buffering is shown), "bottom" (dedicated selected-scene slot when distinct from top toast), or "stage" (for interactive failed/stale cards). */
  placement: "top" | "bottom" | "stage";
  /** Compact one-line text for the bottom selected-scene slot (includes Scene label when distinct from top toast). */
  bottomText?: string;
}

/**
 * Resolves the status overlay hierarchy so there is at most ONE aggregate toast at the top and zero duplicate banners/cards:
 * - When `stagePrep` is `failed` or `stale`, keeps the interactive card on `"stage"` with `suppressDuplicateText: false`.
 * - When `filmToast.active` is true and already covers `currentSceneIndex` (`filmToast.sceneIndex === currentSceneIndex` while not live frame buffering, or during top-level `prep` / secondary aspect wait), sets `suppressDuplicateText: true`.
 * - When `filmToast.active` is true for a DIFFERENT scene (`filmToast.sceneIndex !== currentSceneIndex`), places ONLY the selected scene's status in the dedicated `"bottom"` slot outside `.aw-canvas` (`suppressDuplicateText: false, placement: "bottom"`).
 * - When `filmToast` is inactive (`!filmToast?.active`), live buffering (`cause === "drawing" | "opening"`) uses the `"top"` slot, while a selected unready scene status uses `"bottom"`.
 */
export function resolveStagePrepOverlay(input: ResolveStagePrepOverlayInput): StagePrepOverlayResolution {
  const { currentSceneIndex, filmToast, stagePrep, prep, isSecondaryAspectDrawing } = input;
  if (!stagePrep) {
    return { suppressDuplicateText: false, placement: "stage" };
  }
  if (stagePrep.failed || stagePrep.stale) {
    return { suppressDuplicateText: false, placement: "stage" };
  }

  const isLiveFrameBuffering = stagePrep.cause === "drawing" || stagePrep.cause === "opening";
  const toastActive = Boolean(filmToast?.active);

  if (toastActive) {
    const coveredByTopToast =
      (!isLiveFrameBuffering && filmToast?.sceneIndex === currentSceneIndex) ||
      prep === "sound" ||
      prep === "scenes" ||
      Boolean(isSecondaryAspectDrawing && filmToast?.sceneIndex === null);
    if (coveredByTopToast) {
      return { suppressDuplicateText: true, placement: "top" };
    }
    const baseText = (stagePrep.compactText ?? stagePrep.title ?? "").trim();
    const scenePrefix = stagePrep.sceneLabel ?? `Scene ${currentSceneIndex + 1}`;
    const bottomText =
      baseText && !/^scene\s+\d+/i.test(baseText) ? `${scenePrefix} · ${baseText}` : baseText;
    return {
      suppressDuplicateText: false,
      placement: "bottom",
      ...(bottomText ? { bottomText } : {})
    };
  }

  if (isLiveFrameBuffering) {
    return { suppressDuplicateText: false, placement: "top" };
  }

  const baseText = (stagePrep.compactText ?? stagePrep.title ?? "").trim();
  const scenePrefix = stagePrep.sceneLabel ?? `Scene ${currentSceneIndex + 1}`;
  const bottomText =
    baseText && !/^scene\s+\d+/i.test(baseText) ? `${scenePrefix} · ${baseText}` : baseText;
  return {
    suppressDuplicateText: false,
    placement: "bottom",
    ...(bottomText ? { bottomText } : {})
  };
}

/**
 * Formats elapsed milliseconds as `M:SS` (never negative; e.g. `67000` -> `"1:07"`).
 */
export function formatElapsed(ms: number | null | undefined): string {
  const safeMs = typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSec = Math.floor(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export const WATCHED_END_THRESHOLD_SECONDS = 0.3;
export const WATCHED_MIN_LAST_SCENE_PLAY_SECONDS = 1;

export interface WatchedTrackerState {
  watched: boolean;
  lastScenePlayedSeconds: number;
  lastTickTime: number | null;
  lastTickSceneIndex: number | null;
  versionKey: string;
}

export function createWatchedTrackerState(versionKey = ""): WatchedTrackerState {
  return {
    watched: false,
    lastScenePlayedSeconds: 0,
    lastTickTime: null,
    lastTickSceneIndex: null,
    versionKey
  };
}

/**
 * Computes a deterministic version key for the film's scenes so any redraw, applied comment,
 * revision increment, or bundleDigest change resets the "watched" state.
 */
export function computeFilmVersionKey(
  scenes: readonly {
    index?: number;
    sig?: string | null;
    rev?: number | null;
    gen?: number | null;
    bundleDigest?: string | null;
    v?: string | null;
    variants?: Partial<
      Record<
        PlateAspect,
        {
          sig?: string | null;
          rev?: number | null;
          gen?: number | null;
          bundleDigest?: string | null;
          v?: string | null;
        }
      >
    >;
  }[],
  viewAspect?: PlateAspect
): string {
  if (!scenes.length) return "";
  return scenes
    .map((s, idx) => {
      const v = viewAspect && s.variants?.[viewAspect] ? s.variants[viewAspect]! : s;
      const sig = v.sig ?? s.sig ?? "";
      const rev = v.rev ?? s.rev ?? 0;
      const gen = (v as { gen?: number | null }).gen ?? (s as { gen?: number | null }).gen ?? 0;
      const digest = v.bundleDigest ?? s.bundleDigest ?? "";
      const clipVer = (v as { v?: string | null }).v ?? "";
      return `${s.index ?? idx}:${sig}:r${rev}:g${gen}:${digest}:${clipVer}`;
    })
    .join("|");
}

export interface UpdateWatchedStateInput {
  playing: boolean;
  currentTime: number;
  totalDuration: number;
  currentSceneIndex: number;
  sceneCount: number;
  lastSceneDuration?: number;
  ended?: boolean;
  seeking?: boolean;
  versionKey?: string;
}

/**
 * Pure helper that updates the "watched" state for the Animation step:
 * - Resets `watched = false` whenever `versionKey` changes (scene redrawn, comment applied, new revision / `bundleDigest`).
 * - Accumulates real playback time (`dt` in `(0, 0.5]` s while `playing && !seeking`) inside the last scene (`currentSceneIndex === sceneCount - 1`).
 * - Marks `watched = true` once the playhead reaches the end of the film (`ended === true` or `currentTime >= totalDuration - 0.3`)
 *   AND playback actually played through the last scene for `>= min(1, lastSceneDuration)` seconds of real playback
 *   (so dragging/seeking straight to the end without playing through the last scene does not count).
 */
export function updateWatchedState(
  prev: WatchedTrackerState,
  input: UpdateWatchedStateInput
): WatchedTrackerState {
  const nextVersionKey = input.versionKey ?? prev.versionKey;
  const base: WatchedTrackerState =
    nextVersionKey !== prev.versionKey
      ? createWatchedTrackerState(nextVersionKey)
      : prev;

  const sceneCount = Math.max(0, Math.floor(input.sceneCount));
  const totalDuration =
    typeof input.totalDuration === "number" && Number.isFinite(input.totalDuration)
      ? Math.max(0, input.totalDuration)
      : 0;
  const currentTime =
    typeof input.currentTime === "number" && Number.isFinite(input.currentTime)
      ? Math.max(0, input.currentTime)
      : 0;

  if (sceneCount === 0 || totalDuration <= 0) {
    return base;
  }

  const lastSceneIdx = sceneCount - 1;
  const isOnLastScene = input.currentSceneIndex === lastSceneIdx;
  const minRequiredPlay =
    typeof input.lastSceneDuration === "number" &&
    Number.isFinite(input.lastSceneDuration) &&
    input.lastSceneDuration > 0
      ? Math.min(WATCHED_MIN_LAST_SCENE_PLAY_SECONDS, input.lastSceneDuration)
      : Math.min(WATCHED_MIN_LAST_SCENE_PLAY_SECONDS, totalDuration);

  let lastScenePlayedSeconds = base.lastScenePlayedSeconds;

  if (input.seeking) {
    return {
      ...base,
      lastTickTime: currentTime,
      lastTickSceneIndex: input.currentSceneIndex
    };
  }

  if (
    input.playing &&
    isOnLastScene &&
    base.lastTickSceneIndex === lastSceneIdx &&
    base.lastTickTime !== null
  ) {
    const dt = currentTime - base.lastTickTime;
    if (dt > 0 && dt <= 0.5) {
      lastScenePlayedSeconds += dt;
    }
  }

  const reachedEnd =
    Boolean(input.ended) ||
    currentTime >= Math.max(0, totalDuration - WATCHED_END_THRESHOLD_SECONDS);
  const playedThroughLastScene = lastScenePlayedSeconds + 1e-6 >= minRequiredPlay;
  const watched = base.watched || (reachedEnd && playedThroughLastScene);

  return {
    watched,
    lastScenePlayedSeconds,
    lastTickTime: input.playing ? currentTime : null,
    lastTickSceneIndex: input.playing ? input.currentSceneIndex : null,
    versionKey: nextVersionKey
  };
}

export interface BuildRenderConfirmReasonsInput {
  scenes?: readonly PlateScene[];
  progress?: Pick<FilmProgressResult, "total" | "drawn" | "failed"> | null;
  progressContext?: ProgressContext;
  watched: boolean;
}

export interface RenderConfirmModalDecision {
  shouldConfirm: boolean;
  title: string;
  reasons: string[];
  text: string;
}

export const RENDER_CONFIRM_MODAL_TITLE = "Make the video without reviewing it first?";

/**
 * Pure builder for the Render confirmation modal reasons, using `filmProgress` / shared scene-status helpers:
 * - When all scenes are ready (`building === 0 && failed === 0`) AND `watched === true`, returns `shouldConfirm: false`, `reasons: []`.
 * - Otherwise includes only the specific reasons that apply, in order:
 *   1. `"X of Y scenes are still being built."` (or `"1 of Y scenes is still being built."`) when `building = total - drawn - failed > 0`
 *   2. `"1 scene failed to draw."` / `"N scenes failed to draw."` when `failed > 0`
 *   3. `"You haven't watched the preview through."` when `!watched`
 */
export function buildRenderConfirmReasons(
  input: BuildRenderConfirmReasonsInput
): RenderConfirmModalDecision {
  const prog =
    input.progress ??
    (input.scenes ? filmProgress(input.scenes, input.progressContext) : { total: 0, drawn: 0, failed: 0 });
  const total = Math.max(0, prog.total);
  const drawn = Math.max(0, prog.drawn);
  const failed = Math.max(0, prog.failed);
  const building = Math.max(0, total - drawn - failed);

  const reasons: string[] = [];
  if (building > 0) {
    const verb = building === 1 ? "is" : "are";
    reasons.push(`${building} of ${total} scenes ${verb} still being built.`);
  }
  if (failed > 0) {
    reasons.push(failed === 1 ? "1 scene failed to draw." : `${failed} scenes failed to draw.`);
  }
  if (!input.watched) {
    reasons.push("You haven't watched the preview through.");
  }

  return {
    shouldConfirm: reasons.length > 0,
    title: RENDER_CONFIRM_MODAL_TITLE,
    reasons,
    text: reasons.join(" ")
  };
}

/**
 * Shared wording helper for a single scene's build/retry status (used by the unready-scene banner
 * and the film-progress toast's first line).
 * - Retrying takes priority over normal phase wording:
 *   - attempt === 1: `"Retrying scene 3 (the drawing worker restarted)"`
 *   - attempt > 1: `"Retrying scene 3 · attempt 2 · the writing process restarted"`
 * - Writing: `"Scene 7 is being written · about 2 min"`
 * - Waiting: `"Scene 4 is waiting"` (or with ETA when `options.includeEta` is true)
 * - Checking: `"Checking scene 5"` (or with ETA when `options.includeEta` is true)
 * - Drawing: `"Drawing scene 3 · 42/120"` (or `"Drawing scene 3 · about 1 min"` when no frame counts)
 */
export function formatSceneStatusText(
  sceneIndex: number,
  sp: SceneProgressResult,
  options?: { includeEta?: boolean }
): string {
  const sceneNumber = Math.max(1, Math.floor(sceneIndex) + 1);
  if (sp.stale) {
    return `Scene ${sceneNumber} needs update for the new storyboard`;
  }
  if (sp.retrying && sp.phase !== "ready" && sp.phase !== "failed") {
    return formatRetryingSceneText(sceneIndex, sp.retrying);
  }
  const etaBrief = formatEtaBrief(sp.etaSeconds) || sp.etaNote || "";

  if (sp.phase === "writing") {
    return etaBrief ? `Scene ${sceneNumber} is being written · ${etaBrief}` : `Scene ${sceneNumber} is being written`;
  }

  if (sp.phase === "drawing") {
    const m = /^Drawing\s+(\d+\/\d+)$/.exec(sp.chipLabel);
    const frameCounts = m ? m[1] : null;
    if (sp.preparingAsClip) {
      const baseText = `Scene ${sceneNumber} is being prepared as a video for smooth playback`;
      if (frameCounts) {
        if (options?.includeEta && etaBrief) {
          return `${baseText} · ${frameCounts} · ${etaBrief}`;
        }
        return `${baseText} · ${frameCounts}`;
      }
      return etaBrief ? `${baseText} · ${etaBrief}` : baseText;
    }
    if (frameCounts) {
      if (options?.includeEta && etaBrief) {
        return `Drawing scene ${sceneNumber} · ${frameCounts} · ${etaBrief}`;
      }
      return `Drawing scene ${sceneNumber} · ${frameCounts}`;
    }
    return etaBrief ? `Drawing scene ${sceneNumber} · ${etaBrief}` : `Drawing scene ${sceneNumber}`;
  }

  if (sp.phase === "checking") {
    if (options?.includeEta && sp.takingLongerThanUsual && sp.etaNote) {
      return `Checking scene ${sceneNumber} · ${sp.etaNote}`;
    }
    return options?.includeEta && etaBrief ? `Checking scene ${sceneNumber} · ${etaBrief}` : `Checking scene ${sceneNumber}`;
  }

  if (sp.phase === "waiting") {
    return options?.includeEta && etaBrief ? `Scene ${sceneNumber} is waiting · ${etaBrief}` : `Scene ${sceneNumber} is waiting`;
  }

  if (sp.phase === "failed") {
    return `Scene ${sceneNumber} failed to draw`;
  }

  return `Scene ${sceneNumber} is ready`;
}

export interface UnreadySceneBannerInput {
  scenes: readonly PlateScene[];
  perSceneProgress?: readonly SceneProgressResult[];
  progressContext?: ProgressContext;
  /** Currently selected / playhead 0-based scene index. */
  currentSceneIndex: number;
  /** 0-based scene index currently explained by the stage `AnimationPrep` overlay (`null` when not showing a scene wait). */
  stagePrepSceneIndex?: number | null;
}

export interface UnreadySceneBannerResult {
  sceneIndex: number;
  sceneNumber: number;
  phase: SceneProgressPhase;
  visualState: "ready" | "updating" | "needs-update";
  placement: "top" | "timeline";
  text: string;
  retrying: SceneRetrying | null;
}

/**
 * Pure builder for the compact unready-scene banner:
 * - Coexists with the stage `AnimationPrep` panel without duplicating it: when `stagePrepSceneIndex` already explains
 *   the current scene, the banner only shows for a different unready scene (e.g. playback is in scene 6 that is ready,
 *   or stage panel is on scene 1, and scene ahead is unready).
 * - When the selected/playhead scene itself is unready and NOT explained by the stage panel, shows for the selected scene (`placement: "top"`).
 * - Otherwise picks the next unready scene ahead of `currentSceneIndex` (`idx > currentSceneIndex`), or the earliest unready scene `!== stagePrepSceneIndex` (`placement: "timeline"`).
 * - Returns `null` when all non-stage-explained scenes are ready.
 */
export function buildUnreadySceneBanner(input: UnreadySceneBannerInput): UnreadySceneBannerResult | null {
  const { scenes, currentSceneIndex, stagePrepSceneIndex = null } = input;
  if (!scenes.length) return null;

  const enrichedCtx: ProgressContext = { ...input.progressContext, scenes };
  const progressList =
    input.perSceneProgress && input.perSceneProgress.length === scenes.length
      ? input.perSceneProgress
      : scenes.map((s) => sceneProgress(s, s.variants?.[enrichedCtx.viewAspect ?? "16:9"] ?? null, enrichedCtx));

  const isUnreadyCandidate = (idx: number): boolean => {
    if (idx < 0 || idx >= scenes.length) return false;
    if (stagePrepSceneIndex !== null && idx === stagePrepSceneIndex) return false;
    const sp = progressList[idx];
    return Boolean(sp && sp.phase !== "ready");
  };

  let targetIdx: number | null = null;
  let placement: "top" | "timeline" = "top";

  if (isUnreadyCandidate(currentSceneIndex)) {
    targetIdx = currentSceneIndex;
    placement = "top";
  } else {
    for (let i = currentSceneIndex + 1; i < scenes.length; i++) {
      if (isUnreadyCandidate(i)) {
        targetIdx = i;
        placement = "timeline";
        break;
      }
    }
    if (targetIdx === null) {
      for (let i = 0; i < scenes.length; i++) {
        if (isUnreadyCandidate(i)) {
          targetIdx = i;
          placement = "timeline";
          break;
        }
      }
    }
  }

  if (targetIdx === null) return null;

  const sp = progressList[targetIdx]!;
  const visualState: "ready" | "updating" | "needs-update" =
    sp.phase === "failed" || sp.stale ? "needs-update" : "updating";

  return {
    sceneIndex: targetIdx,
    sceneNumber: targetIdx + 1,
    phase: sp.phase,
    visualState,
    placement,
    text: formatSceneStatusText(targetIdx, sp),
    retrying: sp.retrying ?? null
  };
}

export interface FilmProgressToastInput {
  scenes: readonly PlateScene[];
  perSceneProgress?: readonly SceneProgressResult[];
  filmProgress?: FilmProgressResult;
  progressContext?: ProgressContext;
  isViewAspectDrawing?: boolean;
  viewAspect?: PlateAspect;
}

export interface FilmProgressToastResult {
  active: boolean;
  sceneIndex: number | null;
  sceneNumber: number | null;
  firstLine: string;
  secondLine: string;
  compactLine: string;
  fraction: number;
  percent: number;
  retrying: SceneRetrying | null;
}

/**
 * Pure builder for the floating film-progress toast overlay:
 * - First line: what is being built right now (the earliest retrying or actively written/checked/drawn scene,
 *   or earliest waiting scene when none is active yet), using the shared wording helper + that scene's `sceneProgress` ETA.
 * - Second line: film summary (`"6 of 7 written · 6 drawn"` + ETA when available; compact `"6/7 written · 6 drawn · ~4 min"` at 400px).
 * - `active`: true while any scene is in `"waiting" | "writing" | "checking" | "drawing"` or a secondary aspect is drawing.
 */
export function buildFilmProgressToast(input: FilmProgressToastInput): FilmProgressToastResult | null {
  const { scenes } = input;
  if (!scenes.length) return null;

  const enrichedCtx: ProgressContext = { ...input.progressContext, scenes };
  const progressList =
    input.perSceneProgress && input.perSceneProgress.length === scenes.length
      ? input.perSceneProgress
      : scenes.map((s) => sceneProgress(s, s.variants?.[enrichedCtx.viewAspect ?? "16:9"] ?? null, enrichedCtx));
  const fp = input.filmProgress ?? filmProgress(scenes, enrichedCtx);

  let targetIdx: number | null = null;
  // Priority 1: earliest open scene with `retrying`
  for (let i = 0; i < progressList.length; i++) {
    const sp = progressList[i]!;
    if (sp.retrying && sp.phase !== "ready" && sp.phase !== "failed") {
      targetIdx = i;
      break;
    }
  }
  // Priority 2: earliest scene actively being written / checked / drawn
  if (targetIdx === null) {
    for (let i = 0; i < progressList.length; i++) {
      const sp = progressList[i]!;
      if (sp.phase === "writing" || sp.phase === "checking" || sp.phase === "drawing") {
        targetIdx = i;
        break;
      }
    }
  }
  // Priority 3: earliest waiting scene (excluding unstarted stale scenes unless other scenes are actively building)
  if (targetIdx === null) {
    for (let i = 0; i < progressList.length; i++) {
      const sp = progressList[i]!;
      if (sp.phase === "waiting" && !sp.stale) {
        targetIdx = i;
        break;
      }
    }
  }

  const active = targetIdx !== null || Boolean(input.isViewAspectDrawing);
  const etaStr = formatEta(fp.etaSeconds);
  const etaCompactStr = formatEtaCompact(fp.etaSeconds);

  const firstLine =
    targetIdx !== null
      ? formatSceneStatusText(targetIdx, progressList[targetIdx]!, { includeEta: true })
      : input.isViewAspectDrawing && input.viewAspect
        ? `Drawing scenes in ${input.viewAspect}…`
        : `All ${fp.total} scenes ready`;

  const secondLine = `${fp.written} of ${fp.total} written · ${fp.drawn} drawn${etaStr ? ` · ${etaStr}` : ""}`;
  const compactLine = `${fp.written}/${fp.total} written · ${fp.drawn} drawn${etaCompactStr ? ` · ${etaCompactStr}` : ""}`;
  const fraction = clamp(fp.fraction, 0, 1);
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));

  return {
    active,
    sceneIndex: targetIdx,
    sceneNumber: targetIdx !== null ? targetIdx + 1 : null,
    firstLine,
    secondLine,
    compactLine,
    fraction,
    percent,
    retrying: targetIdx !== null ? (progressList[targetIdx]!.retrying ?? null) : null
  };
}

export interface FormatFilmButtonProgressInput {
  scenes?: readonly PlateScene[];
  progress?: FilmProgressResult | null;
  progressContext?: ProgressContext;
  cost?: number;
  rendering?: boolean;
}

export interface FilmButtonProgressResult {
  status: "ready" | "building" | "failed" | "rendering";
  buttonLabel: string;
  progressText: string;
  compactText: string;
  fraction: number;
}

/**
 * Pure helper for film progress summary / button states across the 4 canonical cases:
 * 1. `all ready`: all scenes drawn (`drawn === total && failed === 0`)
 * 2. `n of m with ETA`: scenes actively building with an ETA range (`"6 of 7 written · 6 drawn · about 4 min left"`)
 * 3. `failed`: no active work remaining and 1+ scenes failed (`"1 scene failed to draw"` / `"N scenes failed to draw"`)
 * 4. `no ETA yet`: scenes building with `etaSeconds: null` (`"6 of 7 written · 6 drawn"`)
 */
export function formatFilmButtonProgress(input: FormatFilmButtonProgressInput): FilmButtonProgressResult {
  const fp =
    input.progress ??
    (input.scenes ? filmProgress(input.scenes, input.progressContext) : {
      total: 0,
      written: 0,
      drawn: 0,
      failed: 0,
      fraction: 0,
      etaSeconds: null,
      typicalSceneSeconds: { low: 120, high: 240 }
    });

  const buttonLabel = input.rendering
    ? "Rendering…"
    : input.cost != null
      ? `Render · ${input.cost} tokens`
      : "Render";

  if (input.rendering) {
    return {
      status: "rendering",
      buttonLabel,
      progressText: "Rendering…",
      compactText: "Rendering…",
      fraction: clamp(fp.fraction, 0, 1)
    };
  }

  if (fp.total > 0 && fp.drawn === fp.total && fp.failed === 0) {
    return {
      status: "ready",
      buttonLabel,
      progressText: `${fp.total} of ${fp.total} ready`,
      compactText: `${fp.total}/${fp.total} ready`,
      fraction: 1
    };
  }

  const building = Math.max(0, fp.total - fp.drawn - fp.failed);
  if (fp.failed > 0 && building === 0) {
    const failMsg = fp.failed === 1 ? "1 scene failed to draw" : `${fp.failed} scenes failed to draw`;
    return {
      status: "failed",
      buttonLabel,
      progressText: failMsg,
      compactText: `${fp.failed} failed`,
      fraction: clamp(fp.fraction, 0, 1)
    };
  }

  const etaFull = formatEta(fp.etaSeconds);
  const etaShort = formatEtaCompact(fp.etaSeconds);
  const progressText = `${fp.written} of ${fp.total} written · ${fp.drawn} drawn${etaFull ? ` · ${etaFull}` : ""}`;
  const compactText = `${fp.written}/${fp.total} written · ${fp.drawn} drawn${etaShort ? ` · ${etaShort}` : ""}`;

  return {
    status: "building",
    buttonLabel,
    progressText,
    compactText,
    fraction: clamp(fp.fraction, 0, 1)
  };
}

export const LIVE_TEXT_THROTTLE_MS = 5_000;

export interface LiveTextThrottleState {
  text: string;
  updatedAtMs: number | null;
}

/**
 * Pure 5-second throttle stepper for `aria-live="polite"` status strings so screen readers
 * are updated immediately on initial appearance and at most once every 5 seconds thereafter.
 */
export function stepThrottledLiveText(
  prev: LiveTextThrottleState,
  nextText: string,
  nowMs: number,
  throttleMs: number = LIVE_TEXT_THROTTLE_MS
): { state: LiveTextThrottleState; delayMs: number | null } {
  if (!nextText) {
    return { state: { text: "", updatedAtMs: null }, delayMs: null };
  }
  if (!prev.text || prev.updatedAtMs === null) {
    return { state: { text: nextText, updatedAtMs: nowMs }, delayMs: null };
  }
  if (nextText === prev.text) {
    return { state: prev, delayMs: null };
  }
  const elapsed = nowMs - prev.updatedAtMs;
  if (elapsed >= throttleMs) {
    return { state: { text: nextText, updatedAtMs: nowMs }, delayMs: null };
  }
  return { state: prev, delayMs: Math.max(1, throttleMs - elapsed) };
}

export function isSceneStaleState(
  scene?: { stale?: boolean; stage?: string | null; variants?: Partial<Record<PlateAspect, { stale?: boolean; stage?: string | null }>> } | null,
  aspect?: PlateAspect
): boolean {
  if (!scene) return false;
  const v = aspect ? scene.variants?.[aspect] : undefined;
  if (v?.stale === true || v?.stage === "stale") return true;
  if (v?.stale === false) return false;
  return Boolean(scene.stale === true || scene.stage === "stale");
}

function isDemotedClipVariantWorking(item?: { state?: string; playback?: unknown; v?: string | null } | null): boolean {
  if (!item) return false;
  if (!isScenePlaybackClip(item, null)) return false;
  if (item.state === "failed") return false;
  if (item.state === "drawn" && item.v !== null) return false;
  return true;
}

export function isSceneWorkingState(scene?: PlateScene): boolean {
  if (!scene || isSceneStaleState(scene)) return false;
  const st = scene.state;
  if (st === "queued" || st === "authoring" || st === "bundled" || st === "rendering") return true;
  if (isDemotedClipVariantWorking(scene as { state?: string; playback?: unknown; v?: string | null })) return true;
  if (scene.variants) {
    for (const v of Object.values(scene.variants)) {
      if (
        v &&
        !v.stale &&
        v.stage !== "stale" &&
        (v.state === "queued" ||
          v.state === "authoring" ||
          v.state === "bundled" ||
          v.state === "rendering" ||
          isDemotedClipVariantWorking(v))
      ) {
        return true;
      }
    }
  }
  return false;
}

function simpleDjb2Hex(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export function extractProjectScriptBeats(project: VideoProject): {
  id?: string;
  keyword: string;
  visual: string | null;
  onScreen: string | null;
  line: string | null;
}[] {
  if (project.brief?.scriptBeats && project.brief.scriptBeats.length > 0) {
    return project.brief.scriptBeats.map((b) => ({
      ...(b.id ? { id: b.id } : {}),
      keyword: b.keyword,
      visual: b.visual ?? null,
      onScreen: b.onScreen ?? null,
      line: b.line ?? null
    }));
  }
  return (project.beatPlan?.beats ?? []).map((b) => ({
    ...(b.id ? { id: b.id } : {}),
    keyword: b.keyword,
    visual: null,
    onScreen: b.on_screen ?? null,
    line: b.line ?? null
  }));
}

export function computeBeatContentKey(
  beat: { keyword?: string | null; visual?: string | null; onScreen?: string | null; line?: string | null },
  project: VideoProject
): string {
  const look = project.brief?.look ?? "";
  const family = project.brief?.styleFamily ?? "";
  const example =
    project.brief?.styleExample &&
    project.brief.styleExample !== `story-${look}` &&
    project.brief.styleExample !== `style-${look}`
      ? project.brief.styleExample
      : "";
  const film = (project.brief?.text ?? "").trim();
  return [
    look,
    family,
    example,
    film,
    (beat.keyword ?? "").trim(),
    (beat.visual ?? "").trim(),
    (beat.onScreen ?? "").trim(),
    (beat.line ?? "").trim()
  ].join("\u0001");
}

/**
 * Computes a deterministic revision key for everything on `project` that affects plate scene artwork:
 * visual style (`look`, `styleFamily`, non-default `styleExample`), film brief text, chosen aspects,
 * and the ordered beats (`keyword`, `visual`, `onScreen`, `line`).
 * Deliberately excludes subtitle/caption-only and player settings so those never trigger artwork regeneration.
 */
export function computeProjectPlateRevision(project: VideoProject): string {
  const beats = extractProjectScriptBeats(project);
  const look = project.brief?.look ?? "";
  const family = project.brief?.styleFamily ?? "";
  const example =
    project.brief?.styleExample &&
    project.brief.styleExample !== `story-${look}` &&
    project.brief.styleExample !== `style-${look}`
      ? project.brief.styleExample
      : "";
  const primary = project.brief?.aspect ?? (project.request?.format === "portrait" ? "9:16" : "16:9");
  const aspects =
    project.brief?.aspects && project.brief.aspects.length > 0
      ? [primary, ...project.brief.aspects.filter((a) => a !== primary)]
      : [primary];
  const raw = JSON.stringify({
    look,
    family,
    example,
    film: (project.brief?.text ?? "").trim(),
    aspects,
    beats: beats.map((b, i) => ({
      i,
      k: (b.keyword ?? "").trim(),
      v: (b.visual ?? "").trim(),
      s: (b.onScreen ?? "").trim(),
      l: (b.line ?? "").trim()
    }))
  });
  return `prev:${simpleDjb2Hex(raw)}`;
}

function estimateBeatDurationSeconds(
  beat: { line?: string | null },
  project: VideoProject,
  index: number
): number {
  const words = (beat.line ?? "").trim().split(/\s+/).filter(Boolean).length;
  const estimated = Math.round(Math.min(8, Math.max(3, words / 2.6 + 0.8)) * 2) / 2;
  const voiceLines = project.planAudio?.voice?.lines ?? [];
  const cleaned = beat.line ? voiceText(beat.line) : "";
  const beatId = project.beatPlan?.beats?.[index]?.id;
  const take =
    voiceLines.find((item) => (beatId && item.beat === beatId) || (cleaned && item.text === cleaned)) ??
    undefined;
  if (!(take?.seconds && take.seconds > 0)) return estimated;
  const voiced = Math.ceil((take.seconds + 0.3) * 2) / 2;
  const follow = Boolean(project.brief?.audio?.language && project.brief.audio.language !== "en");
  return follow ? Math.max(1.5, voiced) : Math.max(estimated, voiced);
}

/**
 * Reconciles a `PlateStatus` payload against the current `project`'s brief/storyboard on the client so
 * stale scenes from an earlier script or style revision can never be displayed with new subtitles/voiceover
 * even before a backend rebuild runs or when a stale poll response arrives.
 */
export function reconcilePlateStatusWithProject(
  rawStatus: PlateStatus | null,
  project: VideoProject,
  knownBeatKeyBySig?: Map<string, string>
): PlateStatus | null {
  if (!rawStatus) return null;
  const beats = extractProjectScriptBeats(project);
  if (beats.length === 0 || rawStatus.scenes.length === 0) return rawStatus;

  const projectLook = project.brief?.look ?? null;
  const statusLook = rawStatus.look ?? null;
  const lookMismatch = Boolean(projectLook && statusLook && projectLook !== statusLook);
  const beatKeys = beats.map((b) => computeBeatContentKey(b, project));

  const claimedSceneIndices = new Set<number>();
  const matchedScenes = new Map<number, { scene: PlateScene; shifted: boolean }>();

  const isSceneCompatibleWithBeat = (scene: PlateScene, beatIdx: number): boolean => {
    if (lookMismatch) return false;
    if (scene.stale === true || scene.stage === "stale") return false;
    const targetKw = (beats[beatIdx]!.keyword ?? "").trim();
    const sceneKw = (scene.keyword ?? "").trim();
    if (sceneKw !== targetKw) return false;
    const targetBeatKey = beatKeys[beatIdx]!;
    if (knownBeatKeyBySig && scene.sig && !scene.sig.startsWith("stale-")) {
      const recordedKey = knownBeatKeyBySig.get(scene.sig);
      if (recordedKey !== undefined && recordedKey !== targetBeatKey) {
        return false;
      }
    }
    return true;
  };

  // Pass 1: In-place match at the same index
  for (let i = 0; i < beats.length; i++) {
    const candidate = rawStatus.scenes.find((s) => s.index === i);
    if (candidate && isSceneCompatibleWithBeat(candidate, i)) {
      claimedSceneIndices.add(candidate.index);
      matchedScenes.set(i, { scene: candidate, shifted: false });
      if (knownBeatKeyBySig && candidate.sig && !candidate.sig.startsWith("stale-")) {
        knownBeatKeyBySig.set(candidate.sig, beatKeys[i]!);
      }
    }
  }

  // Pass 2: Shifted / reordered match from another index
  for (let i = 0; i < beats.length; i++) {
    if (matchedScenes.has(i)) continue;
    const donor = rawStatus.scenes.find(
      (s) => !claimedSceneIndices.has(s.index) && isSceneCompatibleWithBeat(s, i)
    );
    if (donor) {
      claimedSceneIndices.add(donor.index);
      matchedScenes.set(i, { scene: donor, shifted: true });
      if (knownBeatKeyBySig && donor.sig && !donor.sig.startsWith("stale-")) {
        knownBeatKeyBySig.set(donor.sig, beatKeys[i]!);
      }
    }
  }

  const primaryAsp: PlateAspect =
    (project.brief?.aspect as PlateAspect | undefined) ??
    (project.request?.format === "portrait" ? "9:16" : "16:9");
  const wantedAsps: PlateAspect[] =
    project.brief?.aspects && project.brief.aspects.length > 0
      ? [primaryAsp, ...(project.brief.aspects as PlateAspect[]).filter((a) => a !== primaryAsp)]
      : [primaryAsp];

  let anyStale = Boolean(rawStatus.stale);
  let anyShifted = Boolean(rawStatus.needsReconcile);
  if (rawStatus.scenes.length !== beats.length || claimedSceneIndices.size < rawStatus.scenes.length) {
    anyShifted = true;
  }

  const reconciledScenes: PlateScene[] = beats.map((beat, idx) => {
    const m = matchedScenes.get(idx);
    if (m) {
      if (m.shifted) anyShifted = true;
      const s = m.scene;
      return {
        ...s,
        index: idx,
        keyword: beat.keyword,
        stale: false,
        ...(m.shifted ? { needsReconcile: true } : {})
      };
    }
    anyStale = true;
    anyShifted = true;
    const estSec = estimateBeatDurationSeconds(beat, project, idx);
    const estFrames = Math.max(1, Math.round(estSec * 30));
    const sigHash = simpleDjb2Hex(beatKeys[idx]!);
    const staleSig = `stale-${idx}-${sigHash}`;
    return {
      index: idx,
      keyword: beat.keyword,
      state: "queued",
      stage: "stale",
      stale: true,
      needsReconcile: true,
      seconds: estSec,
      frames: estFrames,
      framesDone: null,
      sig: staleSig,
      gen: 1,
      rev: 0,
      variantId: undefined,
      bundleDigest: null,
      live: false,
      variants: Object.fromEntries(
        (["16:9", "9:16", "1:1"] as const).map((asp) => [
          asp,
          {
            state: "queued" as const,
            stage: "stale",
            stale: true,
            needsReconcile: true,
            sig: `${staleSig}-${asp}`,
            v: null,
            gen: 1,
            rev: 0,
            variantId: undefined,
            bundleDigest: null,
            live: false,
            frames: estFrames,
            framesDone: null
          }
        ])
      )
    };
  });

  if (!anyStale && !anyShifted && !lookMismatch) {
    return rawStatus;
  }

  const mode = rawStatus.mode ?? "clip";
  const isVariantPlayable = (s: PlateScene, asp: PlateAspect): boolean => {
    if (isSceneStaleState(s, asp)) return false;
    const v = s.variants?.[asp];
    const st = v?.state ?? (asp === primaryAsp ? s.state : "queued");
    return st === "drawn" || (mode === "live" && st === "checked");
  };

  const drawnAspects: PlateAspect[] = (["16:9", "9:16", "1:1"] as const).filter(
    (asp) => reconciledScenes.length > 0 && reconciledScenes.every((s) => isVariantPlayable(s, asp))
  );
  const drawingAspects: PlateAspect[] = (["16:9", "9:16", "1:1"] as const).filter((asp) =>
    reconciledScenes.some((s) => {
      if (isSceneStaleState(s, asp)) return false;
      const v = s.variants?.[asp];
      const st = v?.state ?? (asp === primaryAsp ? s.state : undefined);
      return st === "queued" || st === "authoring" || st === "bundled" || st === "rendering";
    })
  );

  return {
    ...rawStatus,
    look: projectLook ?? rawStatus.look,
    stale: anyStale,
    needsReconcile: anyStale || anyShifted || wantedAsps.some((a) => !drawnAspects.includes(a)),
    scenes: reconciledScenes,
    running: reconciledScenes.some(isSceneWorkingState),
    drawnAspects,
    drawingAspects
  };
}
