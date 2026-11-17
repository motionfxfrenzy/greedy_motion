// The end of a film in the live stage (components/plate-live-stage.tsx). Kept apart so it is testable without a browser.

/** How long after the clock reaches the end of the last scene the film is finished even if the player is still "buffering" on its last frame. */
export const FILM_END_GRACE_MS = 600;

/** The clock has run to the end of a scene that nothing can follow. */
export const filmClockAtEnd = (input: { localSec: number; sceneDur: number; hasPlayableAfter: boolean }): boolean =>
  input.localSec >= input.sceneDur && !input.hasPlayableAfter;

/**
 * Whether the film must be finished now: the clock reached the end `reachedAtMs` ago (null = not yet) and the grace has passed. The stage's tick
 * holds the clock while the last scene's player says it is buffering, and the last frame can leave it there for good, so this check must not
 * depend on the tick.
 */
export const filmEndGuardDue = (reachedAtMs: number | null, nowMs: number, graceMs: number = FILM_END_GRACE_MS): boolean =>
  reachedAtMs !== null && nowMs - reachedAtMs >= graceMs;
