/**
 * When the film clock and a clip's own playhead disagree by more than this, the clip is seeked. Ordinary playback drifts by a frame
 * or two; seeking on every clock tick (once per frame) keeps the decoder re-seeking and makes the clip crawl at 0.1x to 0.2x speed.
 */
export const SEEK_DRIFT_SECONDS = 0.25;

/** True when the clip's media time (seconds of the scene, rate applied) is further than SEEK_DRIFT_SECONDS from where the film clock says it should be. */
export function shouldSeekClip({ mediaTime, expected, tolerance = SEEK_DRIFT_SECONDS }: { mediaTime: number; expected: number; tolerance?: number }): boolean {
  if (!Number.isFinite(mediaTime) || !Number.isFinite(expected)) return true;
  return Math.abs(mediaTime - expected) > tolerance;
}
