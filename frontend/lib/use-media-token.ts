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
        // Check again in 30 minutes; ensureMediaToken renews only within an hour of expiry.
        if (live) timer = setTimeout(renew, 30 * 60_000);
      });
    };
    renew();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, []);
  return token;
}
