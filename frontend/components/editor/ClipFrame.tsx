"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { injectBridge, isFrameEvent, type FrameCommand, type FrameRects } from "../../lib/editor/frame-bridge.ts";

export type ClipFrameHandle = { style(id: string, css: Record<string, string>): void };

/**
 * The composition, in an iframe on a different origin from the app (the backend's, or the demo's trusted shell), driven over
 * postMessage. Edits replace the frame's document with the new HTML, so nothing is saved first. Two frames are
 * double-buffered: a new document loads in the hidden one and is shown only once it has sought to the playhead, so an edit
 * never flashes a blank frame.
 *
 * `allow-same-origin` is what lets the frame load its own scripts, images and fonts. It is only safe because the frame's origin
 * is not the app's, so a frame on the app's own origin is refused unless the caller marks the content trusted.
 */
export const ClipFrame = forwardRef<ClipFrameHandle, { html: string; t: number; playing?: boolean; width: number; height: number; src: string; trusted?: boolean; onRects: (r: FrameRects) => void; onDuration?: (d: number) => void }>(
  function ClipFrame({ html, t, playing = false, width, height, src, trusted = false, onRects, onDuration }, handle) {
    const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
    const [front, setFront] = useState(0);
    const frontRef = useRef(0);
    const loading = useRef<number | null>(null);
    const shellReady = useRef([false, false]);
    const sent = useRef<[string, string]>(["", ""]);
    const latest = useRef({ t, html, playing, onRects, onDuration });
    latest.current = { t, html, playing, onRects, onDuration };
    const sameOrigin = typeof window !== "undefined" && new URL(src, window.location.href).origin === window.location.origin;
    const refused = sameOrigin && !trusted;

    const post = (i: number, message: FrameCommand) => frames[i]!.current?.contentWindow?.postMessage(message, "*");

    useImperativeHandle(handle, () => ({ style: (id, css) => post(frontRef.current, { target: "gm-frame", type: "style", id, css }) }));

    /** Send the current HTML to the frame that is not on screen. */
    const loadBack = () => {
      const back = sent.current[frontRef.current] === "" ? frontRef.current : 1 - frontRef.current;
      const doc = injectBridge(latest.current.html);
      if (sent.current[back] === doc || sent.current[frontRef.current] === doc || !shellReady.current[back]) return;
      sent.current[back] = doc;
      loading.current = back;
      post(back, { target: "gm-frame", type: "load", html: doc });
    };

    useEffect(() => {
      if (refused) return;
      const onMessage = (e: MessageEvent) => {
        if (!isFrameEvent(e.data)) return;
        const index = frames.findIndex((f) => f.current?.contentWindow === e.source);
        if (index < 0) return;
        if (e.data.type === "shell") { shellReady.current[index] = true; loadBack(); return; }
        if (e.data.type === "ready") {
          if (index === frontRef.current && loading.current === null) latest.current.onDuration?.(e.data.duration);
          post(index, { target: "gm-frame", type: "seek", t: latest.current.t });
          return;
        }
        if (index === loading.current) {
          frontRef.current = index;
          loading.current = null;
          setFront(index);
          // An edit that arrived while this document was loading goes out next.
          loadBack();
        }
        if (index === frontRef.current && e.data.rects) latest.current.onRects(e.data.rects);
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refused]);

    useEffect(() => {
      if (refused || loading.current !== null) return;
      loadBack();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html, refused]);

    useEffect(() => {
      // While playing, ask for the time only; the rectangles are measured once playback stops (the dependency on `playing`).
      post(frontRef.current, { target: "gm-frame", type: "seek", t, rects: !playing });
      if (loading.current !== null) post(loading.current, { target: "gm-frame", type: "seek", t });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, front, playing]);

    if (refused) return <div className="ed-cf-refused" role="alert">This preview must run on a different origin from the app, so it is not shown. Check the preview URL.</div>;
    return (
      <div className="ed-cf" style={{ width, height }}>
        {[0, 1].map((i) => (
          <iframe
            key={i} ref={frames[i]} src={src} title={i === front ? "Composition preview" : "Composition preview (loading)"} aria-hidden={i !== front}
            sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" tabIndex={-1} className={i === front ? "front" : "back"} style={{ width, height }}
          />
        ))}
      </div>
    );
  }
);
