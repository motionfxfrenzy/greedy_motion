"use client";
import { useEffect, useSyncExternalStore } from "react";
import { getMyEntitlements } from "./api";
import { createEntitlementsStore, type EntitlementsState } from "./entitlements-store.ts";

export * from "./entitlements-store.ts";

// One store per page load, shared by everything that shows plan-dependent UI.
const store = createEntitlementsStore({ fetcher: getMyEntitlements });
const loading: EntitlementsState = { status: "loading" };

/** The caller's plan as {loading | ready | unavailable}, plus a retry. Never turns a failed lookup into "no plan". */
export function useEntitlements() {
  const state = useSyncExternalStore(store.subscribe, store.getState, () => loading);
  useEffect(() => {
    store.start();
    const again = () => store.refreshIfNeeded();
    window.addEventListener("focus", again);
    window.addEventListener("online", again);
    return () => { window.removeEventListener("focus", again); window.removeEventListener("online", again); };
  }, []);
  return { state, retry: () => void store.retry() };
}
