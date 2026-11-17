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

/** A voice with less than this left (seconds) never holds a scene's end: its last breath is not worth waiting for. */
export const VOICE_TAIL_GRACE_S = 0.25;

/**
 * Whether a scene whose picture has ended must still wait for its voice: only while the voice is really playing with more than the tail left.
 * Without the tail rule a voice stopped just short of its end (the preview seeks voices to `duration - 0.05`) held the scene for ever.
 */
export const voiceHoldsSceneEnd = (voice: { paused: boolean; ended: boolean; duration: number; currentTime: number } | null | undefined): boolean => {
  if (!voice || voice.paused || voice.ended) return false;
  const remaining = Number.isFinite(voice.duration) ? voice.duration - voice.currentTime : 0;
  return remaining > VOICE_TAIL_GRACE_S;
};

/** How long to wait for a holding voice to end before the scene moves on anyway (a voice that stalled mid-file never ends): its remaining time plus a margin. */
export const voiceStallLimitMs = (voice: { duration: number; currentTime: number }): number => {
  const remaining = Number.isFinite(voice.duration) ? Math.max(0, voice.duration - voice.currentTime) : 0;
  return Math.round(remaining * 1000) + 1500;
};
