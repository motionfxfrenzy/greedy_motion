import type { EtaRange, FilmProgress, LiveMode, ProgressStage, SceneProgress, VariantState } from "./model.ts";

/**
 * Pure ETA and progress estimator for plate scenes and films.
 * Never claims an exact countdown: returns rounded ranges (`{ low, high }` in seconds, rounded to 10 s).
 */

/** Fallback typical writing time per scene when neither this film nor recent DB history has finished scenes (3 minutes). */
export const DEFAULT_TYPICAL_AUTHOR_MS = 180_000;
/** Fallback typical output token count for a finished scene. */
export const DEFAULT_TYPICAL_TOKENS = 6000;
/** Floor and ceiling on writing fraction while a model call is streaming. */
export const MIN_WRITING_FRACTION = 0.03;
export const MAX_WRITING_FRACTION = 0.95;
/** Floor on remaining time (in seconds) for any active stage so the estimate never reaches 0 while still working. */
export const MIN_REMAINING_SECONDS = 10;
/** Assumed duration (in seconds) for browser/worker bundle verification (`bundled` / unplayable `checked`). */
export const CHECKING_SECONDS = 20;
/** Threshold (in seconds) after which a scene still in `checking` stops promising a short countdown (`etaSeconds: null`). */
export const CHECKING_TAKING_LONGER_SECONDS = 90;
/** Assumed full duration (in seconds) for rendering frames of one scene clip when `framesDone` is 0. */
export const DEFAULT_DRAWING_SECONDS = 40;
/** Default per-project concurrent authoring cap when not supplied by caller. */
export const DEFAULT_AUTHOR_CAP = 4;

export type SceneEtaRow = {
  state: VariantState;
  stage?: string | null;
  mode?: LiveMode;
  playable?: boolean;
  createdAt?: number | Date | string | null;
  updatedAt?: number | Date | string | null;
  authorStartedAt?: number | null;
  authorTotalMs?: number | null;
  bundleMs?: number | null;
  writtenTokens?: number | null;
  writtenChars?: number | null;
  writtenLines?: number | null;
  frames?: number | null;
  framesDone?: number | null;
  attempt?: number | null;
  retrying?: { attempt: number; reason: string } | null;
  /** 1-based position in the authoring queue (1 = runs in the first wave). */
  position?: number;
  /** Number of scenes ahead of this queued scene (0 = first in line, so position = ahead + 1). */
  ahead?: number;
  cap?: number;
  now?: number;
  typicalWritingMs?: number;
  typicalTokens?: number;
};

export type SceneEtaOptions = {
  now?: number;
  typicalWritingMs?: number;
  typicalTokens?: number;
  recentMedianAuthorMs?: number | null;
  recentMedianTokens?: number | null;
  finishedScenes?: Pick<SceneEtaRow, "state" | "authorTotalMs" | "writtenTokens">[];
  position?: number;
  ahead?: number;
  cap?: number;
  mode?: LiveMode;
  playable?: boolean;
};

export type FilmEtaInput = {
  scenes: SceneEtaRow[];
  now?: number;
  recentMedianAuthorMs?: number | null;
  recentMedianTokens?: number | null;
  cap?: number;
  mode?: LiveMode;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const toEpochMs = (v: number | Date | string | null | undefined): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (typeof v === "string" && v) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
};

/** Median of positive finite numbers, or `undefined` when empty. */
export function median(values: readonly (number | null | undefined)[]): number | undefined {
  const valid = values.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (valid.length === 0) return undefined;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 1 ? valid[mid]! : (valid[mid - 1]! + valid[mid]!) / 2;
}

const round10 = (seconds: number): number => Math.max(10, Math.round(seconds / 10) * 10);

/** Converts a point estimate (in seconds) into `{ low: 0.75x, high: 1.5x }` rounded to 10 s. */
export function toEtaRange(estimateSeconds: number): EtaRange {
  const s = Math.max(MIN_REMAINING_SECONDS, estimateSeconds);
  const low = round10(s * 0.75);
  const high = Math.max(low + 10, round10(s * 1.5));
  return { low, high };
}

const isFinishedWritingState = (state: VariantState): boolean =>
  state === "bundled" || state === "checked" || state === "rendering" || state === "drawn";

/** Resolves typical writing ms and typical token count from this film's finished scenes, then recent DB medians, then constants. */
export function resolveTypicalAuthorStats(input: {
  scenes?: Pick<SceneEtaRow, "state" | "authorTotalMs" | "writtenTokens">[];
  recentMedianAuthorMs?: number | null;
  recentMedianTokens?: number | null;
  typicalWritingMs?: number;
  typicalTokens?: number;
}): { typicalWritingMs: number; typicalTokens: number } {
  const finished = (input.scenes ?? []).filter((s) => isFinishedWritingState(s.state));
  const filmMedianMs = median(finished.map((s) => s.authorTotalMs));
  const filmMedianTokens = median(finished.map((s) => s.writtenTokens));

  const typicalWritingMs =
    input.typicalWritingMs && input.typicalWritingMs > 0
      ? input.typicalWritingMs
      : filmMedianMs ??
        (typeof input.recentMedianAuthorMs === "number" && input.recentMedianAuthorMs > 0
          ? input.recentMedianAuthorMs
          : DEFAULT_TYPICAL_AUTHOR_MS);

  const typicalTokens =
    input.typicalTokens && input.typicalTokens > 0
      ? input.typicalTokens
      : filmMedianTokens ??
        (typeof input.recentMedianTokens === "number" && input.recentMedianTokens > 0
          ? input.recentMedianTokens
          : DEFAULT_TYPICAL_TOKENS);

  return { typicalWritingMs, typicalTokens };
}

/** Maps a variant row state + mode into the user-facing progress stage. */
export function stageForScene(row: Pick<SceneEtaRow, "state" | "stage" | "mode" | "playable">, defaultMode: LiveMode = "live"): ProgressStage {
  const mode = row.mode ?? defaultMode;
  if (row.state === "failed") return "failed";
  if (row.state === "drawn") return "ready";
  if (row.state === "checked") {
    const playable = row.playable ?? (mode === "live" && row.stage !== "queued for rendering");
    return playable ? "ready" : "checking";
  }
  if (row.state === "rendering") return "drawing";
  if (row.state === "bundled") return "checking";
  if (row.state === "authoring") return "writing";
  return "waiting";
}

function estimateSceneInternal(
  row: SceneEtaRow,
  opts: Required<Pick<SceneEtaOptions, "now" | "typicalWritingMs" | "typicalTokens" | "cap" | "mode">> & {
    position: number;
    playable?: boolean;
  }
): { progress: SceneProgress; remainingSeconds: number; writingSeconds: number; tailSeconds: number } {
  const stage = stageForScene(
    { state: row.state, stage: row.stage, mode: row.mode ?? opts.mode, ...(row.playable !== undefined ? { playable: row.playable } : opts.playable !== undefined ? { playable: opts.playable } : {}) },
    opts.mode
  );
  const typicalWritingSeconds = opts.typicalWritingMs / 1000;

  const hasWritten =
    (typeof row.writtenChars === "number" && row.writtenChars > 0) ||
    (typeof row.writtenLines === "number" && row.writtenLines > 0) ||
    (typeof row.writtenTokens === "number" && row.writtenTokens > 0) ||
    stage === "writing";
  const chars = typeof row.writtenChars === "number" && row.writtenChars >= 0 ? row.writtenChars : 0;
  const lines = typeof row.writtenLines === "number" && row.writtenLines >= 0 ? row.writtenLines : 0;
  const tokens =
    typeof row.writtenTokens === "number" && row.writtenTokens >= 0
      ? row.writtenTokens
      : chars > 0
        ? Math.round(chars / 3.5)
        : 0;
  const written = hasWritten ? { chars, lines, tokens } : undefined;

  const createdMs = toEpochMs(row.createdAt);
  const startedMs = typeof row.authorStartedAt === "number" && Number.isFinite(row.authorStartedAt) ? row.authorStartedAt : undefined;
  let elapsedMs: number | undefined;
  if (stage === "waiting") {
    if (createdMs !== undefined) elapsedMs = Math.max(0, opts.now - createdMs);
  } else if (stage === "writing" || stage === "checking" || stage === "drawing") {
    if (startedMs !== undefined) elapsedMs = Math.max(0, opts.now - startedMs);
    else if (createdMs !== undefined) elapsedMs = Math.max(0, opts.now - createdMs);
  } else if (typeof row.authorTotalMs === "number" && Number.isFinite(row.authorTotalMs)) {
    elapsedMs = Math.max(0, row.authorTotalMs);
  } else if (startedMs !== undefined) {
    elapsedMs = Math.max(0, opts.now - startedMs);
  }

  const attempt = typeof row.attempt === "number" && row.attempt > 0 ? row.attempt : undefined;
  const retrying =
    row.retrying && typeof row.retrying.attempt === "number" && typeof row.retrying.reason === "string" && row.retrying.reason
      ? { attempt: row.retrying.attempt, reason: row.retrying.reason }
      : undefined;

  if (stage === "ready") {
    return {
      progress: {
        stage,
        ...(written ? { written } : {}),
        fraction: 1,
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        etaSeconds: null,
        ...(attempt !== undefined ? { attempt } : {})
      },
      remainingSeconds: 0,
      writingSeconds: 0,
      tailSeconds: 0
    };
  }

  if (stage === "failed") {
    return {
      progress: {
        stage,
        ...(written ? { written } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        etaSeconds: null,
        ...(attempt !== undefined ? { attempt } : {})
      },
      remainingSeconds: 0,
      writingSeconds: 0,
      tailSeconds: 0
    };
  }

  if (stage === "waiting") {
    const rounds = Math.ceil(Math.max(1, opts.position) / Math.max(1, opts.cap));
    const remainingSeconds = Math.max(MIN_REMAINING_SECONDS, rounds * typicalWritingSeconds);
    return {
      progress: {
        stage,
        fraction: 0,
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        etaSeconds: toEtaRange(remainingSeconds),
        ...(attempt !== undefined ? { attempt } : {}),
        ...(retrying ? { retrying } : {})
      },
      remainingSeconds,
      writingSeconds: typicalWritingSeconds,
      tailSeconds: CHECKING_SECONDS
    };
  }

  if (stage === "writing") {
    const fraction = clamp(tokens / Math.max(1, opts.typicalTokens), MIN_WRITING_FRACTION, MAX_WRITING_FRACTION);
    const remainingSeconds = Math.max(MIN_REMAINING_SECONDS, typicalWritingSeconds * (1 - fraction));
    return {
      progress: {
        stage,
        ...(written ? { written } : {}),
        fraction,
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        etaSeconds: toEtaRange(remainingSeconds),
        ...(attempt !== undefined ? { attempt } : {}),
        ...(retrying ? { retrying } : {})
      },
      remainingSeconds,
      writingSeconds: remainingSeconds,
      tailSeconds: CHECKING_SECONDS
    };
  }

  if (stage === "checking") {
    const updatedMs = toEpochMs(row.updatedAt);
    const checkingElapsedSec =
      updatedMs !== undefined ? Math.max(0, (opts.now - updatedMs) / 1000) : 0;
    const overdue = checkingElapsedSec >= CHECKING_TAKING_LONGER_SECONDS;
    const remainingSeconds = overdue ? 0 : CHECKING_SECONDS;
    return {
      progress: {
        stage,
        ...(written ? { written } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        etaSeconds: overdue ? null : toEtaRange(remainingSeconds),
        ...(attempt !== undefined ? { attempt } : {}),
        ...(retrying ? { retrying } : {})
      },
      remainingSeconds,
      writingSeconds: 0,
      tailSeconds: remainingSeconds
    };
  }

  // stage === "drawing"
  const totalFrames = typeof row.frames === "number" && row.frames > 0 ? row.frames : 0;
  const doneFrames = typeof row.framesDone === "number" && row.framesDone > 0 ? Math.min(totalFrames || row.framesDone, row.framesDone) : 0;
  const fraction = totalFrames > 0 ? clamp(doneFrames / totalFrames, 0, 1) : 0;
  const remainingSeconds =
    doneFrames <= 0 || totalFrames <= 0
      ? DEFAULT_DRAWING_SECONDS
      : Math.max(MIN_REMAINING_SECONDS, DEFAULT_DRAWING_SECONDS * (1 - fraction));
  return {
    progress: {
      stage,
      ...(written ? { written } : {}),
      fraction,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      etaSeconds: toEtaRange(remainingSeconds),
      ...(attempt !== undefined ? { attempt } : {}),
      ...(retrying ? { retrying } : {})
    },
    remainingSeconds,
    writingSeconds: 0,
    tailSeconds: remainingSeconds
  };
}

/** Estimates progress and ETA range for a single scene variant. */
export function estimateScene(row: SceneEtaRow, options: SceneEtaOptions = {}): SceneProgress {
  const now = options.now ?? row.now ?? Date.now();
  const cap = Math.max(1, options.cap ?? row.cap ?? DEFAULT_AUTHOR_CAP);
  const mode = options.mode ?? row.mode ?? "live";
  const { typicalWritingMs, typicalTokens } = resolveTypicalAuthorStats({
    scenes: options.finishedScenes,
    recentMedianAuthorMs: options.recentMedianAuthorMs,
    recentMedianTokens: options.recentMedianTokens,
    typicalWritingMs: options.typicalWritingMs ?? row.typicalWritingMs,
    typicalTokens: options.typicalTokens ?? row.typicalTokens
  });
  const ahead = options.ahead ?? row.ahead;
  const position =
    options.position ??
    row.position ??
    (typeof ahead === "number" && Number.isFinite(ahead) ? Math.max(1, Math.floor(ahead) + 1) : 1);

  return estimateSceneInternal(row, {
    now,
    typicalWritingMs,
    typicalTokens,
    cap,
    mode,
    position,
    ...(options.playable !== undefined ? { playable: options.playable } : {})
  }).progress;
}

/** Estimates overall film progress and ETA range across primary-aspect scene rows, plus each scene's progress. */
export function estimateFilmWithScenes(
  input: FilmEtaInput | SceneEtaRow[],
  extra?: Omit<FilmEtaInput, "scenes">
): { film: FilmProgress; scenes: SceneProgress[] } {
  const normalized: FilmEtaInput = Array.isArray(input) ? { scenes: input, ...extra } : input;
  const rows = normalized.scenes ?? [];
  const now = normalized.now ?? Date.now();
  const cap = Math.max(1, normalized.cap ?? DEFAULT_AUTHOR_CAP);
  const mode = normalized.mode ?? "live";
  const { typicalWritingMs, typicalTokens } = resolveTypicalAuthorStats({
    scenes: rows,
    recentMedianAuthorMs: normalized.recentMedianAuthorMs,
    recentMedianTokens: normalized.recentMedianTokens
  });
  const typicalSceneSeconds = toEtaRange(typicalWritingMs / 1000);

  // Assign 1-based queue positions to waiting scenes after any currently-writing scenes.
  const activeWritingCount = rows.filter((r) => stageForScene(r, mode) === "writing").length;
  let queuedSeen = 0;

  const evaluated = rows.map((row) => {
    const stage = stageForScene(row, mode);
    const defaultPos = stage === "waiting" ? activeWritingCount + ++queuedSeen : 1;
    const position =
      row.position ??
      (typeof row.ahead === "number" && Number.isFinite(row.ahead) ? Math.max(1, Math.floor(row.ahead) + 1) : defaultPos);
    return estimateSceneInternal(row, {
      now,
      typicalWritingMs,
      typicalTokens,
      cap,
      mode,
      position
    });
  });

  const total = rows.length;
  const written = rows.filter((r) => isFinishedWritingState(r.state)).length;
  const checked = rows.filter((r) => r.state === "checked" || r.state === "drawn").length;
  const drawn = rows.filter((r) => r.state === "drawn").length;
  const failed = rows.filter((r) => r.state === "failed").length;

  const open = evaluated.filter((e) => e.progress.stage !== "ready" && e.progress.stage !== "failed");
  if (open.length === 0) {
    return {
      film: { total, written, checked, drawn, failed, etaSeconds: null, typicalSceneSeconds },
      scenes: evaluated.map((e) => e.progress)
    };
  }

  const writingWorks = open.filter((e) => e.writingSeconds > 0).map((e) => e.writingSeconds);
  const sumWriting = writingWorks.reduce((a, b) => a + b, 0);
  const maxWriting = writingWorks.length > 0 ? Math.max(...writingWorks) : 0;
  // Parallel writes up to `cap`, bounded below by the longest single scene still writing.
  const writingSpread = writingWorks.length > 0 ? Math.max(maxWriting, sumWriting / cap) : 0;

  const activeTails = open.filter((e) => e.writingSeconds === 0 && e.tailSeconds > 0).map((e) => e.tailSeconds);
  const maxActiveTail = activeTails.length > 0 ? Math.max(...activeTails) : 0;
  const drawingTail = writingWorks.length > 0 ? Math.max(maxActiveTail, CHECKING_SECONDS) : maxActiveTail;
  const hasMeasurableEta = writingWorks.length > 0 || activeTails.length > 0;

  const totalEstimateSeconds = Math.max(MIN_REMAINING_SECONDS, writingSpread + drawingTail);
  return {
    film: {
      total,
      written,
      checked,
      drawn,
      failed,
      etaSeconds: hasMeasurableEta ? toEtaRange(totalEstimateSeconds) : null,
      typicalSceneSeconds
    },
    scenes: evaluated.map((e) => e.progress)
  };
}

/** Pure film-level progress and ETA estimator. */
export function estimateFilm(
  input: FilmEtaInput | SceneEtaRow[],
  extra?: Omit<FilmEtaInput, "scenes">
): FilmProgress {
  return estimateFilmWithScenes(input, extra).film;
}
