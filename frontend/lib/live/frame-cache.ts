/**
 * Frame cache for live scenes (docs/LIVE_SCENES_PLAN.md §6).
 *
 * A frame is a pure function of (bundle digest, frame number, size) for one renderer environment, so an entry is valid for as
 * long as it exists: there is no invalidation, only eviction. The "scene" id passed in is the **bundle digest**, never the
 * project's input signature (which stays the same after a comment). Entries are grouped by scene so eviction can drop the scenes the viewer is farthest
 * from first, then the frames of a scene that are farthest from the playhead. The active scene and its neighbours can be pinned.
 */
export interface Disposable { close?: () => void }

/** Canonical scene-group cache key combining `bundleDigest` and `previewSize` (e.g. `"854x480"`). */
export function sceneCacheKey(bundleDigest: string, previewSize?: string): string {
  return previewSize ? `${bundleDigest}|${previewSize}` : bundleDigest;
}

/** Full frame cache key `bundleDigest | frame | previewSize` (docs/LIVE_SCENES_PLAN.md §6). */
export function frameCacheKey(bundleDigest: string, frame: number, previewSize = "854x480"): string {
  return `${bundleDigest}|${frame}|${previewSize}`;
}

export type RollingWindowSplit = {
  windowFrames: number;
  behindFrames: number;
  headFrames: number;
  aheadFrames: number;
};

/**
 * Computes the rolling frame window from the byte budget and frame byte size (docs/LIVE_SCENES_PLAN.md §6):
 * `windowFrames = floor(budgetBytes / bytesPerFrame)`, split 20% behind the playhead,
 * 15% (capped at 15 frames) head of the next scene, and the remainder ahead.
 */
export function computeRollingWindow(
  budgetBytes: number,
  bytesPerFrame: number,
  hasNextScene = true
): RollingWindowSplit {
  if (!(budgetBytes > 0) || !(bytesPerFrame > 0)) {
    return { windowFrames: 0, behindFrames: 0, headFrames: 0, aheadFrames: 0 };
  }
  const windowFrames = Math.floor(budgetBytes / bytesPerFrame);
  if (windowFrames <= 0) {
    return { windowFrames: 0, behindFrames: 0, headFrames: 0, aheadFrames: 0 };
  }
  const behindFrames = Math.floor(windowFrames * 0.2);
  const headFrames = hasNextScene ? Math.min(15, Math.floor(windowFrames * 0.15)) : 0;
  const aheadFrames = Math.max(0, windowFrames - behindFrames - headFrames);
  return { windowFrames, behindFrames, headFrames, aheadFrames };
}

type Entry<T> = { value: T; bytes: number };
type Scene<T> = { frames: Map<number, Entry<T>>; bytes: number };

export class FrameCache<T extends Disposable = Disposable> {
  private scenes = new Map<string, Scene<T>>();
  private order: string[] = [];
  private pinned = new Set<string>();
  private focusScene: string | null = null;
  private focusFrame = 0;
  private total = 0;
  hits = 0;
  misses = 0;
  evictions = 0;

  private budgetBytes: number;

  constructor(budgetBytes: number) {
    if (!(budgetBytes > 0)) throw new Error("The cache budget must be positive.");
    this.budgetBytes = budgetBytes;
  }

  get bytes() { return this.total; }
  get budget() { return this.budgetBytes; }

  /** Scene ids in timeline order; distance between scenes is the distance in this list. */
  setOrder(ids: string[]) { this.order = [...ids]; }

  /** The viewer's position. Eviction keeps what is near it. */
  setFocus(scene: string, frame: number) { this.focusScene = scene; this.focusFrame = frame; }

  pin(...ids: string[]) { for (const id of ids) this.pinned.add(id); }
  unpin(...ids: string[]) { for (const id of ids) this.pinned.delete(id); }
  setPinned(ids: string[]) { this.pinned = new Set(ids); }

  has(scene: string, frame: number) { return this.scenes.get(scene)?.frames.has(frame) ?? false; }

  get(scene: string, frame: number): T | undefined {
    const entry = this.scenes.get(scene)?.frames.get(frame);
    if (entry) { this.hits++; return entry.value; }
    this.misses++;
    return undefined;
  }

  put(scene: string, frame: number, value: T, bytes: number) {
    if (!(bytes > 0)) throw new Error("An entry needs a positive size.");
    let group = this.scenes.get(scene);
    if (!group) { group = { frames: new Map(), bytes: 0 }; this.scenes.set(scene, group); }
    const old = group.frames.get(frame);
    if (old) { this.release_(old, group); }
    group.frames.set(frame, { value, bytes });
    group.bytes += bytes;
    this.total += bytes;
    this.evict(scene, frame);
  }

  /** Closes and removes one cached frame at once (pre-draw mode frees a frame the moment the playhead has passed it). */
  release(scene: string, frame: number): boolean {
    const group = this.scenes.get(scene);
    const entry = group?.frames.get(frame);
    if (!group || !entry) return false;
    group.frames.delete(frame);
    this.release_(entry, group);
    if (group.frames.size === 0) this.scenes.delete(scene);
    return true;
  }

  /** Bytes held for one scene. */
  sceneBytes(scene: string): number { return this.scenes.get(scene)?.bytes ?? 0; }

  /** Cached frame indices of one scene (unsorted). */
  frameIndices(scene: string): number[] { return [...(this.scenes.get(scene)?.frames.keys() ?? [])]; }

  /** Drops a whole scene (its code changed, so its signature is gone). */
  drop(scene: string) {
    const group = this.scenes.get(scene);
    if (!group) return;
    for (const entry of group.frames.values()) { entry.value.close?.(); }
    this.total -= group.bytes;
    this.scenes.delete(scene);
    this.pinned.delete(scene);
  }

  clear() { for (const id of [...this.scenes.keys()]) this.drop(id); }

  /** Cached frame ranges of a scene (inclusive). */
  buffered(scene: string): { from: number; to: number }[] {
    const frames = [...(this.scenes.get(scene)?.frames.keys() ?? [])].sort((a, b) => a - b);
    const ranges: { from: number; to: number }[] = [];
    for (const f of frames) {
      const last = ranges[ranges.length - 1];
      if (last && f === last.to + 1) last.to = f; else ranges.push({ from: f, to: f });
    }
    return ranges;
  }

  /** A smaller budget (a tab under memory pressure) evicts at once. */
  resize(budgetBytes: number) {
    if (!(budgetBytes > 0)) throw new Error("The cache budget must be positive.");
    this.budgetBytes = budgetBytes;
    this.evict(null, -1);
  }

  private release_(entry: Entry<T>, group: Scene<T>) {
    entry.value.close?.();
    group.bytes -= entry.bytes;
    this.total -= entry.bytes;
  }

  private sceneDistance(id: string) {
    const here = this.focusScene === null ? -1 : this.order.indexOf(this.focusScene);
    const there = this.order.indexOf(id);
    if (here < 0 || there < 0) return Number.MAX_SAFE_INTEGER;
    return Math.abs(there - here);
  }

  /** Evicts until within budget, never the entry just added (`keepScene`/`keepFrame`). */
  private evict(keepScene: string | null, keepFrame: number) {
    while (this.total > this.budgetBytes) {
      const victim = this.pickVictim(keepScene, keepFrame);
      if (!victim) return; // only the entry just added is left: keep it, the budget is smaller than one frame
      const group = this.scenes.get(victim.scene)!;
      const entry = group.frames.get(victim.frame)!;
      group.frames.delete(victim.frame);
      this.release_(entry, group);
      this.evictions++;
      if (group.frames.size === 0) { this.scenes.delete(victim.scene); }
    }
  }

  private pickVictim(keepScene: string | null, keepFrame: number): { scene: string; frame: number } | null {
    // The entry just added is exempt only when it belongs to the scene being watched or to a pinned scene. A frame of a far,
    // unpinned scene that arrives into a full cache is the first thing to go (it must not push out the frames near the playhead).
    const exempt = (id: string) => id === keepScene && (id === this.focusScene || this.pinned.has(id));
    let sceneId: string | null = null, far = -1;
    for (const id of this.scenes.keys()) {
      if (this.pinned.has(id)) continue;
      const d = this.sceneDistance(id);
      if (d > far) { far = d; sceneId = id; }
    }
    // Farthest unpinned scene first; if it has nothing evictable, the farthest frame of any scene (the budget is a hard limit).
    return (sceneId ? this.farthestFrame([sceneId], exempt, keepFrame) : null) ?? this.farthestFrame([...this.scenes.keys()], exempt, keepFrame);
  }

  private farthestFrame(candidates: string[], exempt: (id: string) => boolean, keepFrame: number): { scene: string; frame: number } | null {
    let best: { scene: string; frame: number } | null = null, bestDistance = -1;
    for (const id of candidates) {
      const group = this.scenes.get(id);
      if (!group) continue;
      // Inside a scene, drop the frame farthest from the playhead (or from the start, for a scene that is not the focus).
      // For the focus scene, weight distances by the rolling-window split (20% behind vs 65% ahead) so frames behind
      // the 20% tail are evicted before frames inside the 65% ahead window.
      const isFocus = id === this.focusScene;
      const anchor = isFocus ? this.focusFrame : 0;
      for (const frame of group.frames.keys()) {
        if (exempt(id) && frame === keepFrame) continue;
        const d = isFocus
          ? (frame < anchor ? (anchor - frame) / 0.2 : (frame - anchor) / 0.65)
          : Math.abs(frame - anchor);
        if (d > bestDistance) { bestDistance = d; best = { scene: id, frame }; }
      }
    }
    return best;
  }
}
