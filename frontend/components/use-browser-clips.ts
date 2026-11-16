"use client";

import { useEffect, useRef, useState } from "react";
import { withBackendAuth } from "../lib/live/api";
import { browserClipNote, browserClipsSupported, createBrowserClipScheduler, type BrowserClipScheduler, type BrowserClipStatus } from "../lib/live/browser-clips";
import { createClient } from "../utils/supabase/client";

const authedFetch = withBackendAuth(async () => (await createClient().auth.getSession()).data.session?.access_token);

/**
 * Fast export: while this live Preview is open and idle, draw the export's missing scene clips in the browser and upload them
 * (lib/live/browser-clips.ts). `playing` and `time` mark the user as busy: playing, or the playhead moved in the last moment
 * (scrubbing). `refreshKey` changes when the film changes (a comment fix), so the changed scene is picked up at once.
 * Returns a short note for the Render button, or undefined.
 */
export function useBrowserClips(options: { projectId: string; aspect: string; enabled: boolean; playing: boolean; time: number; refreshKey?: string | number }): string | undefined {
  const { projectId, aspect, enabled, playing, time, refreshKey } = options;
  const [status, setStatus] = useState<BrowserClipStatus | null>(null);
  const busy = useRef({ playing, lastMoveAt: 0, lastTime: time });
  busy.current.playing = playing;
  if (busy.current.lastTime !== time) {
    busy.current.lastTime = time;
    busy.current.lastMoveAt = Date.now();
  }
  const scheduler = useRef<BrowserClipScheduler | null>(null);

  useEffect(() => {
    setStatus(null);
    if (!enabled || typeof window === "undefined" || !browserClipsSupported()) return;
    const s = createBrowserClipScheduler({
      projectId,
      aspect,
      baseUrl: "/api/backend",
      fetch: authedFetch,
      isBusy: () => busy.current.playing || Date.now() - busy.current.lastMoveAt < 1000 || document.visibilityState === "hidden",
      onStatus: setStatus,
      onLog: (event, detail) => { if (event !== "browser_clips_paused") console.debug(`[fast-export] ${event}`, detail ?? ""); }
    });
    scheduler.current = s;
    s.start();
    const stop = () => s.stop();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      s.stop();
      if (scheduler.current === s) scheduler.current = null;
    };
  }, [projectId, aspect, enabled]);

  useEffect(() => {
    scheduler.current?.poke();
  }, [refreshKey]);

  return browserClipNote(status);
}
