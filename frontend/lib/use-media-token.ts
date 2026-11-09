"use client";
import { useEffect, useSyncExternalStore } from "react";
import { currentMediaToken, ensureMediaToken, subscribeMediaToken } from "./api";

/**
 * The media token for <img>/<video> URLs (lib/api.ts withMediaToken). Call it in any component that renders
 * backend media, so the component re-renders when the token arrives and again when it is renewed.
 */
export function useMediaToken() {
  const token = useSyncExternalStore(subscribeMediaToken, currentMediaToken, () => "");
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const renew = () => {
      void ensureMediaToken().catch(() => undefined).finally(() => {
        // Check again in 30 minutes once acquired; if not yet available, retry shortly after session hydration.
        if (live) timer = setTimeout(renew, currentMediaToken() ? 30 * 60_000 : 1_500);
      });
    };
    renew();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, []);
  return token;
}
