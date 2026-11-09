export type PlateAnswerState = {
  id: string;
  available: boolean | null;
  falseCount: number;
};

export type PlateCheckResult =
  | { ok: true; available: boolean; look?: string | null }
  | { ok: false; error?: unknown };

export const PLATE_CONFIRM_FALSE_DELAY_MS = 2_000;
export const PLATE_RETRY_BASE_MS = 1_000;
export const PLATE_RETRY_CAP_MS = 8_000;
export const PLATE_RETRY_MAX_ELAPSED_MS = 120_000;
export const PLATE_FALLBACK_NOTICE =
  "This is a quick preview. Your styled scenes aren't drawn in this setup.";

export function isPlateLook(look?: string | null): boolean {
  return Boolean(look?.startsWith("illus-"));
}

/**
 * Computes the next plate-availability state for a project.
 *
 * Rules:
 * 1. Never cache a plate-availability failure (error / 401 / timeout) as `false`:
 *    an error leaves `available` unknown (`null`), or preserves a previously confirmed answer for the same project.
 * 2. A successful `{ available: true }` is immediately known `true` (`{ id, available: true, falseCount: 0 }`).
 * 3. A successful `{ available: false }` is trusted immediately only when the project's look is NOT an `illus-*` plate look;
 *    for a plate look, `{ available: false }` must be confirmed twice (2 s apart) before `available` becomes `false`.
 */
export function nextPlateAnswer(
  prev: PlateAnswerState | null,
  id: string,
  result: PlateCheckResult,
  projectLook?: string | null
): PlateAnswerState | null {
  const base: PlateAnswerState =
    prev && prev.id === id
      ? prev
      : { id, available: null, falseCount: 0 };

  if (!result.ok) {
    return prev && prev.id === id ? prev : null;
  }

  if (result.available) {
    return { id, available: true, falseCount: 0 };
  }

  const effectiveLook = projectLook ?? result.look ?? null;
  if (!isPlateLook(effectiveLook)) {
    return { id, available: false, falseCount: base.falseCount + 1 };
  }

  const nextFalseCount = base.falseCount + 1;
  if (nextFalseCount >= 2) {
    return { id, available: false, falseCount: nextFalseCount };
  }

  return { id, available: null, falseCount: nextFalseCount };
}

/**
 * Exponential backoff delay for retrying an unknown plate check after an error:
 * 1 s, 2 s, 4 s, capped at 8 s, stopping once elapsed time reaches ~2 minutes (120 s).
 */
export function plateRetryDelayMs(attempt: number, elapsedMs = 0): number | null {
  if (elapsedMs >= PLATE_RETRY_MAX_ELAPSED_MS) {
    return null;
  }
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const raw = PLATE_RETRY_BASE_MS * Math.pow(2, safeAttempt);
  return Math.min(PLATE_RETRY_CAP_MS, raw);
}

/**
 * Derives `{ plateKnown, isPlateStyle, plateChecking }` for `Studio`.
 * While the answer is unknown for a plate look, `plateChecking` is `true` (never the generic preview).
 */
export function resolvePlateRouting(
  plateLook: boolean,
  projectId: string | null | undefined,
  answer: PlateAnswerState | null
): {
  plateKnown: boolean;
  isPlateStyle: boolean;
  plateChecking: boolean;
} {
  const hasProject = Boolean(projectId);
  const matching = hasProject && answer?.id === projectId ? answer : null;
  const plateKnown = Boolean(matching && typeof matching.available === "boolean");
  const isPlateStyle = plateLook && plateKnown && matching?.available === true;
  const plateChecking = plateLook && hasProject && !plateKnown;
  return { plateKnown, isPlateStyle, plateChecking };
}
