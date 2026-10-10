/**
 * The Pro Editor's composition frame. User HTML and JS run in an iframe whose origin is NOT the app's (the backend's origin),
 * so `allow-same-origin` is safe: the frame cannot reach the app's cookies, storage or DOM. A null-origin sandbox is not an
 * option, because browsers block such a frame from loading any subresource on a local or private address (scripts, images,
 * fonts), so compositions silently do not animate.
 *
 * The frame loads a tiny shell page (`frameShellHtml`). The editor posts the composition's HTML to it (`load`), and every
 * later edit replaces the document the same way, with no server round trip. The same bridge script is injected into the
 * composition, and answers `seek` / `style` messages. It plays no media and runs no editor code.
 */

export type FrameCommand =
  | { target: "gm-frame"; type: "load"; html: string }
  | { target: "gm-frame"; type: "seek"; t: number; /** false while playing: measuring every clip each frame is the expensive part */ rects?: boolean }
  | { target: "gm-frame"; type: "style"; id: string; css: Record<string, string> };

export type FrameRects = Record<string, [number, number, number, number]>;

export type FrameEvent =
  | { source: "gm-frame"; type: "shell" }
  | { source: "gm-frame"; type: "ready"; duration: number; rects: FrameRects }
  | { source: "gm-frame"; type: "seeked"; t: number; rects?: FrameRects };

export const isFrameEvent = (data: unknown): data is FrameEvent =>
  typeof data === "object" && data !== null && (data as { source?: unknown }).source === "gm-frame";

/** ES5 on purpose: it runs inside user compositions. */
export const FRAME_BRIDGE_SCRIPT = `(function () {
  var timeline = null;
  function find() {
    var all = window.__timelines;
    if (!all) return null;
    var keys = Object.keys(all);
    return keys.length ? all[keys[0]] : null;
  }
  function rects() {
    var out = {};
    var nodes = document.querySelectorAll("[data-start][id]");
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect();
      out[nodes[i].id] = [r.left, r.top, r.width, r.height];
    }
    return out;
  }
  function clipsAt(t) {
    var nodes = document.querySelectorAll("[data-start][id]");
    for (var i = 0; i < nodes.length; i++) {
      var s = parseFloat(nodes[i].getAttribute("data-start")) || 0;
      var d = parseFloat(nodes[i].getAttribute("data-duration")) || 0;
      nodes[i].style.visibility = t >= s - 1e-6 && t < s + d ? "" : "hidden";
    }
  }
  function seek(t, withRects) {
    timeline = timeline || find();
    if (timeline) { timeline.pause(); timeline.time(t, false); }
    clipsAt(t);
    var reply = { source: "gm-frame", type: "seeked", t: t };
    if (withRects) reply.rects = rects();
    parent.postMessage(reply, "*");
  }
  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || m.target !== "gm-frame" || event.source !== parent) return;
    // A window can hold the listeners of two bridges (the shell's and its composition's): handle each message once.
    if (event.__gmHandled) return;
    event.__gmHandled = true;
    if (m.type === "seek" && typeof m.t === "number") seek(m.t, m.rects !== false);
    if (m.type === "style" && typeof m.id === "string" && m.css) {
      var el = document.getElementById(m.id);
      if (el) for (var key in m.css) el.style.setProperty(key, m.css[key]);
    }
    if (m.type === "load" && typeof m.html === "string") {
      window.__gmShell = false; // the window outlives document.open(); the new page must not look like the shell
      document.open();
      document.write(m.html);
      document.close();
    }
  });
  if (window.__gmShell) { parent.postMessage({ source: "gm-frame", type: "shell" }, "*"); return; }
  window.addEventListener("load", function () {
    timeline = find();
    parent.postMessage({ source: "gm-frame", type: "ready", duration: timeline ? timeline.duration() : 0, rects: rects() }, "*");
  });
})();`;

/** The page the frame loads first: the bridge, waiting for a `load` message. */
export const frameShellHtml = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>Composition</title></head>
<body style="margin:0;background:#fff"><script>window.__gmShell = true;</script><script>${FRAME_BRIDGE_SCRIPT}</script></body></html>
`;

/** Add the bridge to a composition just before </body> (or at the end). */
export function injectBridge(html: string): string {
  const tag = `<script data-gm-bridge>${FRAME_BRIDGE_SCRIPT}</script>`;
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}
