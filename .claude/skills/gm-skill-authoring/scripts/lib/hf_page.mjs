// hf_page.mjs — shared harness for gm gates that need a real browser on a HyperFrames composition.
// Zero npm dependencies (Node >= 22): spawns the repo-pinned `hyperframes preview`, drives
// chrome-headless-shell over raw CDP, and seeks the composition with the runtime's own `__player`.
//
//   import { withComposition } from "./lib/hf_page.mjs";
//   await withComposition({ project }, async (page) => {
//     await page.seek(1.5);                 // pause + seek, layout flushed
//     const v = await page.ev("document.title");
//     const png = await page.screenshot();  // Buffer
//     page.dims  // { w, h, d }  composition size and duration (data-* attrs, else inferred from the runtime)
//   });

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = [];
process.on("exit", () => cleanup.forEach((fn) => { try { fn(); } catch {} }));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

/** The repo root (the folder holding worker/node_modules/.bin/hyperframes), or null outside the repo. */
export const repoRoot = (() => {
  let d = HERE;
  for (let i = 0; i < 10; i++) { if (existsSync(join(d, "worker", "node_modules", ".bin", "hyperframes"))) return d; d = dirname(d); }
  return null;
})();

const httpOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };

/** Start the pinned preview server for a project dir; resolves to the composition URL. */
export async function startPreview(project, { serverCmd } = {}) {
  const port = 5420 + Math.floor(Math.random() * 40);
  const env = { ...process.env }; delete env.HYPERFRAME_RUNTIME_URL;
  const cli = repoRoot ? `"${join(repoRoot, "worker", "node_modules", ".bin", "hyperframes")}"` : "npx --yes hyperframes@0.8.111";
  const cmd = (serverCmd ?? `${cli} preview --foreground --no-open --port ${port}`).replace(/\{port\}/g, String(port));
  const child = spawn("sh", ["-c", cmd], { cwd: resolve(project), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  cleanup.push(() => { try { process.kill(-child.pid, "SIGTERM"); } catch {} });
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await httpOk(base + "/api/projects")) break;
    if (child.exitCode !== null) throw new Error("preview server exited early");
    await sleep(500);
  }
  if (!(await httpOk(base + "/api/projects"))) throw new Error("preview server never became ready");
  const j = await (await fetch(base + "/api/projects")).json();
  const id = j?.projects?.[0]?.id;
  if (!id) throw new Error("could not resolve the project id from /api/projects");
  return `${base}/api/projects/${id}/preview/comp/index.html`;
}

function findChrome() {
  if (process.env.CHROME_PATH) return { bin: process.env.CHROME_PATH, headless: true };
  const roots = [join(homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell"), join(homedir(), ".cache", "puppeteer", "chrome-headless-shell")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).sort().reverse()) {
      for (const plat of readdirSync(join(root, v))) {
        const bin = join(root, v, plat, "chrome-headless-shell");
        if (existsSync(bin)) return { bin, headless: false };
      }
    }
  }
  const sys = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(sys)) return { bin: sys, headless: true };
  throw new Error("no Chrome found (set CHROME_PATH)");
}

async function launchChrome() {
  const { bin, headless } = findChrome();
  const args = ["--remote-debugging-port=0", "--no-first-run", "--mute-audio", "--hide-scrollbars", "--disable-extensions", "about:blank"];
  if (process.platform === "linux") args.unshift("--no-sandbox", "--disable-dev-shm-usage");
  if (headless) args.unshift("--headless=new");
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
  cleanup.push(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  return new Promise((res, rej) => {
    let buf = "";
    const t = setTimeout(() => rej(new Error("chrome DevTools endpoint timeout")), 20_000);
    child.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
    child.on("exit", () => rej(new Error("chrome exited: " + buf.slice(-300))));
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws connect failed")); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined && c.pending.has(m.id)) { const p = c.pending.get(m.id); c.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
      else if (m.method) c.listeners.forEach((l) => l(m));
    };
    return c;
  }
  send(method, params = {}, sessionId, timeout = 60_000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(method + " timeout")); } }, timeout);
    });
  }
  once(method, sessionId, timeout = 60_000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("waiting " + method + " timeout")), timeout);
      const l = (m) => { if (m.method === method && (!sessionId || m.sessionId === sessionId)) { clearTimeout(t); this.listeners = this.listeners.filter((x) => x !== l); res(m.params); } };
      this.listeners.push(l);
    });
  }
}

/**
 * Open a composition in a fresh browser and hand a page object to `fn`.
 * opts: { project | url, width, height, duration, serverCmd }
 */
export async function withComposition(opts, fn) {
  const compUrl = opts.url ?? (await startPreview(opts.project, { serverCmd: opts.serverCmd }));
  const cdp = await CDP.connect(await launchChrome());
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  const metrics = (w, h) => cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
  await metrics(opts.width ?? 1920, opts.height ?? 1080);
  const loaded = cdp.once("Page.loadEventFired", sessionId, 60_000);
  await cdp.send("Page.navigate", { url: compUrl }, sessionId);
  await loaded;
  const ev = async (expr, awaitPromise = false) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise }, sessionId);
    if (r.exceptionDetails) throw new Error("page error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) { if (await ev("!!(window.__playerReady && window.__renderReady && window.__player)")) break; await sleep(300); }
  if (!(await ev("!!window.__player"))) throw new Error("HyperFrames player never appeared — is this a preview comp URL?");
  await ev("document.fonts.ready.then(()=>true)", true);
  const dims = await ev(`(() => { const r = document.querySelector("[data-composition-id]"); return { w: Number(r?.getAttribute("data-width")) || innerWidth, h: Number(r?.getAttribute("data-height")) || innerHeight, d: Number(r?.getAttribute("data-duration")) || 0 }; })()`);
  if (dims.w !== (opts.width ?? 1920) || dims.h !== (opts.height ?? 1080)) { await metrics(dims.w, dims.h); await sleep(200); }
  // Films like gm-feature-explainer carry no data-duration: infer it from the runtime.
  const inferred = await ev(`(() => { const p = window.__player, c = [];
    if (p) { for (const k of ["getDuration", "duration", "totalDuration"]) { try { const v = typeof p[k] === "function" ? p[k]() : p[k]; if (v > 0) c.push(v); } catch {} } }
    for (const t of Object.values(window.__timelines || {})) { try { const v = t.duration(); if (v > 0) c.push(v); } catch {} }
    return Math.max(0, ...c); })()`);
  dims.d = Number(opts.duration) || dims.d || inferred || 0;
  const page = {
    ev, dims,
    // Two animation frames after the seek let the compositor finish rasterising before a screenshot; without them a frame
    // with many scaled layers can be captured half-rasterised, which reads as a seek-safety failure that is really a race.
    seek: (t) => ev(`(async () => { __player.pause(); __player.seek(${t}); void document.body.offsetHeight; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return 0; })()`, true),
    screenshot: async (clip) => { const r = await cdp.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, sessionId); return Buffer.from(r.data, "base64"); },
  };
  return fn(page);
}
