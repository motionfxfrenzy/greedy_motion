/** Snapping for canvas and timeline drags. Pure: callers build the candidate list and show the result. */

export type SnapCandidate = { value: number; label: string };
export type SnapHit = { value: number; label: string; distance: number };

/** The editor's snap radius in screen pixels, converted to the unit being dragged. */
export const SNAP_RADIUS_PX = 10;

export const radiusInUnits = (pxPerUnit: number, px = SNAP_RADIUS_PX) => px / Math.max(pxPerUnit, 1e-9);

/** Nearest candidate within `radius`, or null. Ties go to the earlier candidate so results are stable. */
export function nearestSnap(value: number, candidates: readonly SnapCandidate[], radius: number): SnapHit | null {
  let best: SnapHit | null = null;
  for (const c of candidates) {
    const distance = Math.abs(c.value - value);
    if (distance <= radius && (!best || distance < best.distance)) best = { value: c.value, label: c.label, distance };
  }
  return best;
}

/**
 * Snap a moving object by any of its edges (for example left / centre / right, or in / out).
 * Returns the delta to add to the object and the guide that caused it.
 */
export function snapEdges(edges: readonly number[], candidates: readonly SnapCandidate[], radius: number): { delta: number; hit: SnapHit | null } {
  let best: { delta: number; hit: SnapHit } | null = null;
  for (const edge of edges) {
    const hit = nearestSnap(edge, candidates, radius);
    if (hit && (!best || hit.distance < best.hit.distance)) best = { delta: hit.value - edge, hit };
  }
  return best ?? { delta: 0, hit: null };
}
