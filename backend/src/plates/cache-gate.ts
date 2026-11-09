import { config } from "../config.ts";

/**
 * In-process prompt-cache gate for plate scene authoring.
 *
 * Production runs one author process per backend instance; with several instances at worst each instance
 * warms once per cache key, which is still correct and requires no cross-process coordination.
 *
 * For a given `cacheKey`:
 * - The first caller (when no warm entry or active warmer exists) gets `role: "warmer"` and proceeds immediately.
 * - While the warmer is pending (before `started()`), concurrent callers for the same key wait until:
 *   1. the warmer calls `started()` (on SSE `message_start`), waking all waiting followers in the same tick (`role: "follower"`), or
 *   2. the warmer calls `done()` without `started()` (failed/aborted before `message_start`), promoting the next waiting caller to `"warmer"` while remaining callers keep waiting, or
 *   3. `warmTimeoutMs` elapses since the caller acquired (hard guarantee: no caller is ever delayed by more than `warmTimeoutMs`; it never rejects), or
 *   4. the caller's own `AbortSignal` aborts (the caller resolves immediately with `role: "follower"` without throwing and without blocking others).
 * - Once `started()` is called, the key stays warm for `ttlMs` (default 240_000 ms, inside Anthropic's 5-minute ephemeral cache TTL): subsequent callers get `role: "open"` immediately.
 * - After `ttlMs`, the entry expires and the next caller becomes the new `"warmer"`.
 */

export type CacheGateRole = "warmer" | "follower" | "open";

export type CacheGateLease = {
  role: CacheGateRole;
  started(): void;
  done(): void;
};

export type CacheGateOptions = {
  now?: () => number;
  warmTimeoutMs?: number;
  ttlMs?: number;
  enabled?: boolean | (() => boolean);
};

export const DEFAULT_WARM_TIMEOUT_MS = 20_000;
export const DEFAULT_CACHE_TTL_MS = 240_000;

const noop = () => {};
const followerLease = (): CacheGateLease => ({ role: "follower", started: noop, done: noop });
const openLease = (): CacheGateLease => ({ role: "open", started: noop, done: noop });

type Waiter = {
  acquiredAt: number;
  deadline: number;
  signal?: AbortSignal;
  timer: ReturnType<typeof setTimeout> | null;
  cleanupAbort: (() => void) | null;
  settled: boolean;
  resolve: (lease: CacheGateLease) => void;
};

type ActiveWarmer = {
  id: symbol;
  startedAt: number;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
};

type KeyEntry = {
  warmUntil: number | null;
  activeWarmer: ActiveWarmer | null;
  waiters: Waiter[];
};

export function createCacheGate(options: CacheGateOptions = {}) {
  const now = options.now ?? Date.now;
  const warmTimeoutMs = options.warmTimeoutMs ?? DEFAULT_WARM_TIMEOUT_MS;
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const isEnabled =
    typeof options.enabled === "function"
      ? options.enabled
      : typeof options.enabled === "boolean"
        ? () => options.enabled as boolean
        : () => (process.env.PLATE_CACHE_GATE ?? (config.plates.cacheGate ? "on" : "off")).trim().toLowerCase() !== "off";

  const entries = new Map<string, KeyEntry>();

  const getOrCreateEntry = (key: string): KeyEntry => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { warmUntil: null, activeWarmer: null, waiters: [] };
      entries.set(key, entry);
    }
    return entry;
  };

  const cleanupEntryIfIdle = (key: string, entry: KeyEntry, t: number) => {
    if (entry.warmUntil !== null && t >= entry.warmUntil) {
      entry.warmUntil = null;
    }
    if (entry.warmUntil === null && entry.activeWarmer === null && entry.waiters.length === 0) {
      entries.delete(key);
    }
  };

  const clearWaiterHandles = (w: Waiter) => {
    if (w.timer !== null) {
      clearTimeout(w.timer);
      w.timer = null;
    }
    if (w.cleanupAbort !== null) {
      w.cleanupAbort();
      w.cleanupAbort = null;
    }
  };

  const clearWarmerTimer = (warmer: ActiveWarmer) => {
    if (warmer.timer !== null) {
      clearTimeout(warmer.timer);
      warmer.timer = null;
    }
  };

  const releaseAllWaitersAsFollower = (key: string, entry: KeyEntry) => {
    const queue = entry.waiters.splice(0, entry.waiters.length);
    for (const w of queue) {
      if (w.settled) continue;
      w.settled = true;
      clearWaiterHandles(w);
      w.resolve(followerLease());
    }
    cleanupEntryIfIdle(key, entry, now());
  };

  const promoteNextOrCleanup = (key: string, entry: KeyEntry, t: number) => {
    // First release any waiters whose own warmTimeoutMs has already elapsed or whose signal is aborted
    while (entry.waiters.length > 0) {
      const head = entry.waiters[0]!;
      if (head.settled) {
        entry.waiters.shift();
        continue;
      }
      if (head.signal?.aborted || t >= head.deadline) {
        entry.waiters.shift();
        head.settled = true;
        clearWaiterHandles(head);
        head.resolve(followerLease());
        continue;
      }
      // Promote this waiting caller to be the new warmer
      entry.waiters.shift();
      head.settled = true;
      clearWaiterHandles(head);
      const lease = createWarmerLease(key, entry, t);
      head.resolve(lease);
      return;
    }
    cleanupEntryIfIdle(key, entry, t);
  };

  const onWarmerTimeout = (key: string, entry: KeyEntry, warmer: ActiveWarmer) => {
    if (warmer.settled || entry.activeWarmer !== warmer) return;
    warmer.settled = true;
    clearWarmerTimer(warmer);
    entry.activeWarmer = null;
    const t = now();
    // Release any waiters that were waiting on this timed-out warmer and have reached their deadline
    // (or all waiters that arrived with this warmer so a dead warmer never stalls the film past warmTimeoutMs).
    const remaining: Waiter[] = [];
    for (const w of entry.waiters) {
      if (w.settled) continue;
      if (w.signal?.aborted || t >= w.deadline || w.acquiredAt <= warmer.startedAt) {
        w.settled = true;
        clearWaiterHandles(w);
        w.resolve(followerLease());
      } else {
        remaining.push(w);
      }
    }
    entry.waiters = remaining;
    promoteNextOrCleanup(key, entry, t);
  };

  const createWarmerLease = (key: string, entry: KeyEntry, startedAt: number): CacheGateLease => {
    const warmer: ActiveWarmer = {
      id: Symbol("warmer"),
      startedAt,
      deadline: startedAt + warmTimeoutMs,
      timer: null,
      settled: false
    };
    entry.activeWarmer = warmer;

    if (warmTimeoutMs > 0 && Number.isFinite(warmTimeoutMs)) {
      const timer = setTimeout(() => {
        onWarmerTimeout(key, entry, warmer);
      }, warmTimeoutMs);
      timer.unref?.();
      warmer.timer = timer;
    }

    return {
      role: "warmer",
      started() {
        if (warmer.settled || entry.activeWarmer !== warmer) return;
        warmer.settled = true;
        clearWarmerTimer(warmer);
        entry.activeWarmer = null;
        entry.warmUntil = now() + ttlMs;
        releaseAllWaitersAsFollower(key, entry);
      },
      done() {
        if (warmer.settled || entry.activeWarmer !== warmer) return;
        warmer.settled = true;
        clearWarmerTimer(warmer);
        entry.activeWarmer = null;
        promoteNextOrCleanup(key, entry, now());
      }
    };
  };

  const sweepKey = (key: string, entry: KeyEntry, t: number) => {
    if (entry.warmUntil !== null && t >= entry.warmUntil) {
      entry.warmUntil = null;
    }
    if (entry.activeWarmer !== null && t >= entry.activeWarmer.deadline) {
      onWarmerTimeout(key, entry, entry.activeWarmer);
    }
    cleanupEntryIfIdle(key, entry, t);
  };

  return {
    acquire(key: string, signal?: AbortSignal): Promise<CacheGateLease> {
      try {
        if (!key || !isEnabled()) {
          return Promise.resolve(openLease());
        }
        const t = now();
        const existing = entries.get(key);
        if (existing) {
          sweepKey(key, existing, t);
        }
        const entry = getOrCreateEntry(key);

        if (entry.warmUntil !== null && t < entry.warmUntil) {
          return Promise.resolve(openLease());
        }

        if (signal?.aborted) {
          cleanupEntryIfIdle(key, entry, t);
          return Promise.resolve(followerLease());
        }

        if (entry.activeWarmer === null) {
          return Promise.resolve(createWarmerLease(key, entry, t));
        }

        return new Promise<CacheGateLease>((resolve) => {
          const waiter: Waiter = {
            acquiredAt: t,
            deadline: t + warmTimeoutMs,
            signal,
            timer: null,
            cleanupAbort: null,
            settled: false,
            resolve
          };

          const settleAsFollower = () => {
            if (waiter.settled) return;
            waiter.settled = true;
            clearWaiterHandles(waiter);
            const idx = entry.waiters.indexOf(waiter);
            if (idx >= 0) entry.waiters.splice(idx, 1);
            if (entry.activeWarmer !== null && now() >= entry.activeWarmer.deadline) {
              onWarmerTimeout(key, entry, entry.activeWarmer);
            } else {
              cleanupEntryIfIdle(key, entry, now());
            }
            resolve(followerLease());
          };

          if (warmTimeoutMs > 0 && Number.isFinite(warmTimeoutMs)) {
            const timer = setTimeout(settleAsFollower, warmTimeoutMs);
            timer.unref?.();
            waiter.timer = timer;
          }

          if (signal) {
            const onAbort = () => settleAsFollower();
            signal.addEventListener("abort", onAbort, { once: true });
            waiter.cleanupAbort = () => signal.removeEventListener("abort", onAbort);
          }

          entry.waiters.push(waiter);
        });
      } catch {
        return Promise.resolve(followerLease());
      }
    }
  };
}

export const plateCacheGate = createCacheGate({
  now: Date.now,
  warmTimeoutMs: config.plates.cacheWarmTimeoutMs,
  ttlMs: DEFAULT_CACHE_TTL_MS
});
