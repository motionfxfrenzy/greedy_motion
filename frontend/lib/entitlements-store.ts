/**
 * What the signed-in user's plan allows, as the interface sees it. Framework-free so it is unit-tested; the React hook
 * and the API call live in entitlements.ts.
 *
 * The state is three-way on purpose. A failed lookup (offline, 5xx, timeout) is `unavailable`, never "no plan": hiding
 * the Pro editor from someone who has it because of a network blip would be wrong. Only a real answer that says
 * `proEditor: "none"` is treated as not being on a plan. This is display only; the backend enforces access on every
 * request and fails closed.
 */
export type ProEditorAccess = "edit" | "view" | "none";
export type Entitlements = {
  plan: "free" | "pro";
  features: { proEditor: ProEditorAccess };
  validUntil: string | null;
  source: string | null;
  reason: "expired" | "canceled" | "revoked" | "payment_failed" | null;
  cancelAtPeriodEnd: boolean;
  asOf: string;
};

export type EntitlementsState =
  | { status: "loading" }
  /** `stale`: the last refresh failed, so this is the last answer we had. */
  | { status: "ready"; entitlements: Entitlements; stale: boolean }
  | { status: "unavailable" };

/** A response we trust enough to act on; anything else counts as a failed lookup, not as "none". */
export function isEntitlements(value: unknown): value is Entitlements {
  const v = value as Partial<Entitlements> | null;
  return Boolean(v && typeof v === "object" && v.features && ["edit", "view", "none"].includes(v.features.proEditor as string) && (v.plan === "free" || v.plan === "pro"));
}

export type StoreOptions = {
  fetcher: () => Promise<unknown>;
  /** A lookup that takes longer than this counts as failed. */
  timeoutMs?: number;
  /** Automatic retries after a failure, in order; then it waits for focus, going online, or a manual retry. */
  retryDelaysMs?: number[];
  /** A good answer older than this is refreshed when the page regains focus. */
  maxAgeMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export function createEntitlementsStore(options: StoreOptions) {
  const { fetcher, timeoutMs = 8000, retryDelaysMs = [2000, 5000, 15000], maxAgeMs = 5 * 60_000, now = Date.now } = options;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let state: EntitlementsState = { status: "loading" };
  let answeredAt = 0;
  let inFlight: Promise<void> | null = null;
  let attempts = 0;
  let retryHandle: unknown = null;
  let started = false;
  const listeners = new Set<() => void>();

  const set = (next: EntitlementsState) => { state = next; for (const listener of listeners) listener(); };
  const cancelRetry = () => { if (retryHandle !== null) { clearTimer(retryHandle); retryHandle = null; } };

  function lookup(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => reject(new Error("The plan lookup timed out.")), timeoutMs);
      fetcher().then(
        (value) => { clearTimer(timer); resolve(value); },
        (error) => { clearTimer(timer); reject(error); }
      );
    });
  }

  function failed() {
    set(state.status === "ready" ? { ...state, stale: true } : { status: "unavailable" });
    if (attempts < retryDelaysMs.length) {
      const delay = retryDelaysMs[attempts++];
      cancelRetry();
      retryHandle = setTimer(() => { retryHandle = null; void refresh(); }, delay);
    }
  }

  function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    cancelRetry();
    inFlight = lookup()
      .then((value) => {
        if (!isEntitlements(value)) throw new Error("Unexpected plan response.");
        attempts = 0;
        answeredAt = now();
        set({ status: "ready", entitlements: value, stale: false });
      })
      .catch(() => failed())
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Starts the first lookup (once). */
    start() { if (!started) { started = true; void refresh(); } },
    refresh,
    /** The user pressed Retry: forget the backoff and ask now. */
    retry() { attempts = 0; return refresh(); },
    /** Focus or the browser coming back online: ask again if we have no good answer or it is old. */
    refreshIfNeeded() {
      if (!started) return;
      if (state.status !== "ready" || state.stale || now() - answeredAt > maxAgeMs) { attempts = 0; void refresh(); }
    },
    dispose() { cancelRetry(); listeners.clear(); }
  };
}

/** What the Studio project menu shows for the Pro editor, or nothing. */
export type ProMenuEntry = { label: string; disabled: boolean; action: "open" | "retry" | null } | null;

export function proMenuEntry(state: EntitlementsState): ProMenuEntry {
  switch (state.status) {
    case "loading": return { label: "Pro editor…", disabled: true, action: null };
    case "unavailable": return { label: "Pro editor: couldn't check your plan. Retry", disabled: false, action: "retry" };
    case "ready":
      if (state.entitlements.features.proEditor === "edit") return { label: "Open in Pro editor", disabled: false, action: "open" };
      if (state.entitlements.features.proEditor === "view") return { label: "Open in Pro editor (view only)", disabled: false, action: "open" };
      return null;
  }
}
