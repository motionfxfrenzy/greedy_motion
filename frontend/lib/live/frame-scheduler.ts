import type { Disposable, FrameCache } from "./frame-cache.ts";

export type SceneInfo = { id: string; frames: number };
export type DrawResult<T> = { value: T; bytes: number };
export type Draw<T> = (scene: string, frame: number) => Promise<DrawResult<T>> | DrawResult<T>;

export type SchedulerOptions<T extends Disposable> = {
  cache: FrameCache<T>;
  scenes: SceneInfo[];
  draw: Draw<T>;
  fps?: number;
  /** Frames drawn ahead of the playhead before the rest of the scene (default 2 s of frames). */
  lookahead?: number;
  /** Frames of the next scenes drawn before the far end of the active scene (default 15). */
  head?: number;
  /** When set, uses the Plan §6 rolling window order: playhead -> ahead share -> head of next scene -> behind share. */
  behind?: number;
  /**
   * Pre-draw mode: only the playhead and the `lookahead` frames after it are ever drawn (nothing behind, no next-scene head, no
   * far end of the scene), so the number of frames held is exactly `lookahead`.
   */
  strictAhead?: boolean;
  /** After this many failures in a row the scheduler stops (a broken scene must not spin). */
  maxConsecutiveFailures?: number;
  now?: () => number;
  onError?: (scene: string, frame: number, error: unknown) => void;
};

type Slot = { scene: string; frame: number; phase: 1 | 2 | 3 | 4 | 5 };

/**
 * Draw-ahead scheduler (docs/LIVE_SCENES_PLAN.md §6). Fills the frame cache in short, time-sliced runs so the page stays
 * responsive; the order follows the viewer: the playhead first, then what is about to play, then the rest of the scene, then
 * the first frames of the scenes around it, then everything else. A seek changes the order immediately (the order is computed
 * lazily from the current focus), so stale work is never "cancelled": it is simply no longer next.
 */
export class FrameScheduler<T extends Disposable = Disposable> {
  private scenes: SceneInfo[];
  private focusScene: string;
  private focusFrame = 0;
  private paused = false;
  private failed = new Set<string>();
  private consecutiveFailures = 0;
  private avgMs = 0;
  private avgBytes = 0;
  drawn = 0;
  failures = 0;
  halted = false;

  private opts: SchedulerOptions<T>;

  constructor(opts: SchedulerOptions<T>) {
    this.opts = opts;
    this.scenes = opts.scenes.map((s) => ({ ...s }));
    this.focusScene = this.scenes[0]?.id ?? "";
    opts.cache.setOrder(this.scenes.map((s) => s.id));
  }

  private get fps() { return this.opts.fps ?? 30; }
  private get lookahead() { return this.opts.lookahead ?? Math.round(this.fps * 2); }
  private get head() { return this.opts.head ?? 15; }
  private get behind() { return this.opts.behind; }
  private now() { return (this.opts.now ?? (() => performance.now()))(); }

  /** Updates the rolling-window shares (ahead, head of next scene, behind) when frame byte size or budget changes. */
  setWindow(win: { lookahead?: number; head?: number; behind?: number; strictAhead?: boolean }) {
    if (win.strictAhead !== undefined) this.opts.strictAhead = win.strictAhead;
    if (win.lookahead !== undefined) this.opts.lookahead = win.lookahead;
    if (win.head !== undefined) this.opts.head = win.head;
    if (win.behind !== undefined) this.opts.behind = win.behind;
  }

  setScenes(scenes: SceneInfo[], updateCacheOrder = true) {
    this.scenes = scenes.map((s) => ({ ...s }));
    if (updateCacheOrder) {
      this.opts.cache.setOrder(this.scenes.map((s) => s.id));
    }
    if (!this.scenes.some((s) => s.id === this.focusScene)) this.focusScene = this.scenes[0]?.id ?? "";
    this.halted = false;
    this.consecutiveFailures = 0;
  }

  focus(scene: string, frame: number, updateCacheFocus = true) {
    this.focusScene = scene;
    this.focusFrame = Math.max(0, Math.floor(frame));
    if (updateCacheFocus) {
      this.opts.cache.setFocus(scene, this.focusFrame);
    }
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }
  get isPaused() { return this.paused; }

  /** A scene's code changed: forget it (cache, failures) so it is drawn again from its new signature. */
  invalidate(scene: string) {
    this.opts.cache.drop(scene);
    this.clearFailed(scene);
  }

  /** Clears transient draw failures (e.g. after an idle Worker termination or scene reactivation) without dropping cached frames. */
  clearFailed(scene?: string) {
    if (!scene) {
      this.failed.clear();
    } else {
      for (const key of [...this.failed]) if (key.startsWith(`${scene}\u0000`)) this.failed.delete(key);
    }
    this.halted = false;
    this.consecutiveFailures = 0;
  }

  /** Average cost of one draw in ms, and what the player should do about it (plan §6, "draw cost model"). */
  get cost() { return this.avgMs; }
  advice(): "ok" | "downscale" | "fallback" {
    const budget = 1000 / this.fps;
    if (this.drawn < 5) return "ok";
    if (this.avgMs > 2 * budget) return "fallback";
    if (this.avgMs > budget) return "downscale";
    return "ok";
  }

  private *order(): Generator<Slot> {
    const i = this.scenes.findIndex((s) => s.id === this.focusScene);
    if (i < 0) return;
    const active = this.scenes[i]!;
    const f = Math.min(this.focusFrame, Math.max(0, active.frames - 1));
    yield { scene: active.id, frame: f, phase: 1 };
    // 2. what plays next: lookahead frames (when rolling-window `behind` is set, `lookahead` is the total ahead share including playhead)
    let remaining = this.behind !== undefined ? Math.max(0, this.lookahead - 1) : this.lookahead, s = i, frame = f + 1;
    while (remaining > 0 && s < this.scenes.length) {
      const scene = this.scenes[s]!;
      if (frame >= scene.frames) { s++; frame = 0; continue; }
      yield { scene: scene.id, frame, phase: 2 };
      frame++; remaining--;
    }
    if (this.opts.strictAhead) return;
    if (this.behind !== undefined) {
      // Rolling window order (Plan §6): playhead -> ahead share -> head of next scene -> behind share.
      const nextScene = this.scenes[i + 1];
      if (nextScene) {
        for (let n = 0; n < Math.min(this.head, nextScene.frames); n++) {
          yield { scene: nextScene.id, frame: n, phase: 2 };
        }
      }
      const minBehind = Math.max(0, f - this.behind);
      for (let n = f - 1; n >= minBehind; n--) {
        yield { scene: active.id, frame: n, phase: 2 };
      }
    }
    // 3. the rest of the active scene: forward to the end, then backwards from the playhead
    for (let n = f + 1 + this.lookahead; n < active.frames; n++) yield { scene: active.id, frame: n, phase: 3 };
    const backStart = this.behind !== undefined ? Math.max(0, f - this.behind) - 1 : f - 1;
    for (let n = backStart; n >= 0; n--) yield { scene: active.id, frame: n, phase: 3 };
    // 4. the first frames of the scenes around, nearest first, next before previous
    const around: SceneInfo[] = [];
    for (let d = 1; d < this.scenes.length; d++) {
      if (this.scenes[i + d]) around.push(this.scenes[i + d]!);
      if (this.scenes[i - d]) around.push(this.scenes[i - d]!);
    }
    for (const scene of around) for (let n = 0; n < Math.min(this.head, scene.frames); n++) yield { scene: scene.id, frame: n, phase: 4 };
    // 5. everything else, nearest scene first
    for (const scene of around) for (let n = this.head; n < scene.frames; n++) yield { scene: scene.id, frame: n, phase: 5 };
  }

  /** Draws the single highest-priority next frame (for Worker-driven draw loops). Returns true if a frame was drawn. */
  async runNext(): Promise<boolean> {
    if (this.paused || this.halted) return false;
    const slot = this.next();
    if (!slot) return false;
    const t0 = this.now();
    try {
      const result = await this.opts.draw(slot.scene, slot.frame);
      if (this.paused || this.halted || !this.scenes.some((s) => s.id === slot.scene)) {
        result.value.close?.();
        return false;
      }
      this.opts.cache.put(slot.scene, slot.frame, result.value, result.bytes);
      this.avgBytes = this.avgBytes === 0 ? result.bytes : this.avgBytes * 0.8 + result.bytes * 0.2;
      const ms = this.now() - t0;
      this.avgMs = this.drawn === 0 ? ms : this.avgMs * 0.8 + ms * 0.2;
      this.drawn++;
      this.consecutiveFailures = 0;
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error ?? "");
      if (
        (error as { aborted?: boolean })?.aborted ||
        /terminated|destroyed|switched to clip|changed mode/i.test(msg)
      ) {
        return false;
      }
      this.failed.add(`${slot.scene}\u0000${slot.frame}`);
      this.failures++;
      this.consecutiveFailures++;
      this.opts.onError?.(slot.scene, slot.frame, error);
      if (this.consecutiveFailures >= (this.opts.maxConsecutiveFailures ?? 5)) {
        this.halted = true;
      }
      return false;
    }
  }

  /** The next frame worth drawing, or null when there is nothing (left) to do. */
  next(): Slot | null {
    if (this.halted) return null;
    const cache = this.opts.cache;
    const full = cache.bytes + this.avgBytes > cache.budget;
    for (const slot of this.order()) {
      if (cache.has(slot.scene, slot.frame) || this.failed.has(`${slot.scene}\u0000${slot.frame}`)) continue;
      // A full cache only takes what is about to play; far frames would just evict nearer ones.
      if (full && slot.phase > 2) return null;
      return slot;
    }
    return null;
  }

  /** Draws frames until `budgetMs` is used up. Returns how many were drawn. Safe to call repeatedly from idle callbacks. */
  async runSlice(budgetMs: number): Promise<number> {
    const start = this.now();
    let count = 0;
    while (!this.paused && !this.halted && this.now() - start < budgetMs) {
      const slot = this.next();
      if (!slot) break;
      const t0 = this.now();
      try {
        const result = await this.opts.draw(slot.scene, slot.frame);
        if (this.paused || this.halted || !this.scenes.some((s) => s.id === slot.scene)) {
          result.value.close?.();
          break;
        }
        this.opts.cache.put(slot.scene, slot.frame, result.value, result.bytes);
        this.avgBytes = this.avgBytes === 0 ? result.bytes : this.avgBytes * 0.8 + result.bytes * 0.2;
        const ms = this.now() - t0;
        this.avgMs = this.drawn === 0 ? ms : this.avgMs * 0.8 + ms * 0.2;
        this.drawn++; count++;
        this.consecutiveFailures = 0;
      } catch (error) {
        this.failed.add(`${slot.scene}\u0000${slot.frame}`);
        this.failures++; this.consecutiveFailures++;
        this.opts.onError?.(slot.scene, slot.frame, error);
        if (this.consecutiveFailures >= (this.opts.maxConsecutiveFailures ?? 5)) { this.halted = true; break; }
      }
    }
    return count;
  }
}
