// Phase 0 spike harness: runs real plate scenes in a terminable Worker with OffscreenCanvas and measures it.
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const canonical = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? `[${v.map(canonical)}]` : `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k]))}}`) : JSON.stringify(v));
const scriptsOf = (html) => {
  const list = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (list.length > 1) return `${list[0]}\n;self.__SCRIPTS_READY__ = (async () => {\nawait __preloadAssets();\n${list.slice(1).join("\n;\n")}\n})();\n`;
  return list.join("\n;\n");
};

// ---- worker source -------------------------------------------------------------------------------------------------
const PRELUDE = `"use strict";
const __canvas = new OffscreenCanvas(1, 1);
self.window = self;
self.document = { getElementById: () => __canvas, createElement: () => new OffscreenCanvas(1, 1), fonts: self.fonts };
const __assetBitmaps = new Map();
self.Image = class {
  constructor() { this._src = ""; this._bm = null; this.width = 0; this.height = 0; }
  get src() { return this._src; }
  set src(v) { this._src = String(v ?? ""); this._bm = __assetBitmaps.get(this._src) || null; if (this._bm) { this.width = this._bm.width; this.height = this._bm.height; } }
  async decode() {
    if (!this._bm) {
      if (!this._src.startsWith("data:")) throw new Error("image assets in worker host must be preloaded or data: URLs");
      const [head, body = ""] = this._src.slice(5).split(",");
      const mime = head.split(";")[0] || "image/png";
      const bin = head.includes(";base64") ? atob(body) : decodeURIComponent(body);
      const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      this._bm = await createImageBitmap(new Blob([u8], { type: mime }));
      __assetBitmaps.set(this._src, this._bm);
    }
    this.width = this._bm.width; this.height = this._bm.height;
  }
};
for (const __P of [typeof OffscreenCanvasRenderingContext2D !== "undefined" && OffscreenCanvasRenderingContext2D.prototype, typeof CanvasRenderingContext2D !== "undefined" && CanvasRenderingContext2D.prototype]) {
  if (__P && !__P.__imgPatched) {
    const __origDraw = __P.drawImage;
    __P.drawImage = function(img, ...rest) { return __origDraw.call(this, img && img._bm ? img._bm : img, ...rest); };
    __P.__imgPatched = true;
  }
}
const __preloadAssets = async () => {
  const map = self.__ASSETS__ || {};
  for (const url of Object.values(map)) {
    if (typeof url === "string" && url.startsWith("data:") && !__assetBitmaps.has(url)) {
      const [head, body = ""] = url.slice(5).split(",");
      const mime = head.split(";")[0] || "image/png";
      const bin = head.includes(";base64") ? atob(body) : decodeURIComponent(body);
      const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      __assetBitmaps.set(url, await createImageBitmap(new Blob([u8], { type: mime })));
    }
  }
};
const __fetch0 = self.fetch, __XHR0 = self.XMLHttpRequest, __WS0 = self.WebSocket, __IS0 = self.importScripts, __IDB0 = self.indexedDB, __CA0 = self.caches, __BC0 = self.BroadcastChannel, __W0 = self.Worker;
`;
const NEUTER = `for (const k of ["fetch","XMLHttpRequest","WebSocket","EventSource","importScripts","indexedDB","caches","BroadcastChannel","SharedWorker","Worker","WebTransport"]) { try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) {} }\n`;
const HANDLER = `
let port; const post = (m, t) => port.postMessage(m, t || []);
self.addEventListener("message", (e) => { if (e.data && e.data.t === "port") { port = e.data.port; port.onmessage = handle; post({ t: "up" }); } });
self.addEventListener("error", (e) => port && post({ t: "error", message: String(e.message) }));
self.addEventListener("unhandledrejection", (e) => port && post({ t: "error", message: String(e.reason) }));
const held = [];
const probes = {
  fetch: async (o) => { const r = await __fetch0(o + "/probe-hit?via=fetch", { mode: "no-cors" }); return "response " + r.type; },
  fetchAfterNeuter: async (o) => { const f = Object.getPrototypeOf(self).fetch || (self.WorkerGlobalScope && WorkerGlobalScope.prototype.fetch); if (!f) throw new Error("no fetch on the prototype chain"); const r = await f.call(self, o + "/probe-hit?via=fetch-proto", { mode: "no-cors" }); return "response " + r.type; },
  xhr: (o) => new Promise((ok, no) => { const x = new __XHR0(); x.open("GET", o + "/probe-hit?via=xhr"); x.onload = () => ok("status " + x.status); x.onerror = () => no(new Error("xhr error")); x.send(); }),
  websocket: (o) => new Promise((ok, no) => { const w = new __WS0(o.replace("http", "ws") + "/probe-hit?via=ws"); w.onopen = () => ok("open"); w.onerror = () => no(new Error("websocket error")); setTimeout(() => no(new Error("websocket timeout")), 1500); }),
  importScripts: async (o) => { __IS0(o + "/probe-hit?via=importScripts"); return "ran"; },
  dynamicImport: async (o) => { await import(o + "/probe-hit?via=import"); return "imported"; },
  nestedWorker: (o) => new Promise((ok, no) => { const w = new __W0(o + "/probe-hit?via=nested-worker"); w.onerror = (e) => ok("constructed; script error " + (e.message || "")); w.onmessage = () => ok("message"); setTimeout(() => ok("constructed"), 800); }),
  indexedDB: (o) => new Promise((ok, no) => { const r = __IDB0.open("phase0-probe"); r.onsuccess = () => { r.result.close(); __IDB0.deleteDatabase("phase0-probe"); ok("opened"); }; r.onerror = () => no(new Error("idb error " + (r.error && r.error.name))); }),
  cacheStorage: async () => { const c = await __CA0.open("phase0-probe"); await __CA0.delete("phase0-probe"); return "opened"; },
  broadcastChannel: async () => { const b = new __BC0("phase0-leak"); b.postMessage("scene says hi"); b.close(); return "posted"; },
};
async function handle(e) {
  const m = e.data;
  try {
    if (m.t === "init") { const t0 = performance.now(); if (self.__SCRIPTS_READY__) await self.__SCRIPTS_READY__; await self.FILM.ready; self.FILM.mount(m.scale); post({ t: "ready", id: m.id, ms: performance.now() - t0, w: __canvas.width, h: __canvas.height, meta: self.FILM.meta }); }
    else if (m.t === "frame") {
      const t0 = performance.now(); for (let i = 0; i < (m.repeat || 1); i++) self.FILM.seek(m.n); const draw = (performance.now() - t0) / (m.repeat || 1);
      const out = { t: "frame", id: m.id, n: m.n, draw };
      if (m.mode === "bitmap") { const t1 = performance.now(); out.bitmap = await createImageBitmap(__canvas); out.copy = performance.now() - t1; post(out, [out.bitmap]); }
      else if (m.mode === "png") { const blob = await __canvas.convertToBlob({ type: "image/png" }); out.png = await blob.arrayBuffer(); post(out, [out.png]); }
      else post(out);
    }
    else if (m.t === "params") post({ t: "params", id: m.id, echo: JSON.stringify(self.__PARAMS__ ?? null) });
    else if (m.t === "leak") { for (let i = 0; i < m.mb / 10; i++) { const a = new Uint8Array(10 * 1024 * 1024); a.fill(3); held.push(a); } post({ t: "leak", id: m.id, heldMB: held.length * 10 }); }
    else if (m.t === "hb") post({ t: "hb", id: m.id });
    else if (m.t === "probe") { const res = {}; for (const [k, fn] of Object.entries(probes)) { try { res[k] = "ALLOWED: " + await fn(m.origin); } catch (err) { res[k] = "blocked: " + (err && err.name || "Error") + " " + String(err && err.message || err).slice(0, 60); } } post({ t: "probe", id: m.id, res }); }
    else if (m.t === "mem") post({ t: "mem", id: m.id, perfMemory: self.performance.memory ? self.performance.memory.usedJSHeapSize : null, heldMB: held.length * m.chunkMB });
    else if (m.t === "alloc") { for (let i = 0; i < m.mb / 10; i++) { const a = new Uint8Array(10 * 1024 * 1024); a.fill(1); held.push(a); } post({ t: "alloc", id: m.id, heldMB: held.length * 10 }); }
    else if (m.t === "hang") { post({ t: "hang", id: m.id }); for (;;) {} }
    else if (m.t === "bomb") { post({ t: "bomb", id: m.id }); const keep = []; for (;;) { const a = new Uint8Array(50 * 1024 * 1024); a.fill(7); keep.push(a); if (keep.length >= m.capMB / 50) { post({ t: "bomb-cap" }); for (;;) {} } } }
    else if (m.t === "features") post({ t: "features", id: m.id, f: { offscreen2d: !!__canvas.getContext("2d"), imageBitmap: typeof createImageBitmap === "function", fontFace: typeof FontFace === "function", fonts: self.fonts ? self.fonts.size : null, filter: "filter" in OffscreenCanvasRenderingContext2D.prototype, letterSpacing: "letterSpacing" in OffscreenCanvasRenderingContext2D.prototype, deviceMemory: self.navigator.deviceMemory ?? null, cores: self.navigator.hardwareConcurrency, perfMemory: !!self.performance.memory, ua: self.navigator.userAgent } });
  } catch (err) { post({ t: "fail", id: m.id, message: String(err && err.message || err) }); }
}
`;
const buildSource = (html, { neuter, params }) => PRELUDE + (params ? `self.__PARAMS__ = ${params};\n` : "") + (neuter ? NEUTER : "") + scriptsOf(html) + "\n;\n" + HANDLER;

// ---- host ----------------------------------------------------------------------------------------------------------
// kind: "plain" (Worker straight from the page), "csp" (Worker created inside a sandboxed, CSP'd iframe), plus "+neuter"
async function createHost(html, kind = "csp+neuter", params = null) {
  const neuter = kind.endsWith("+neuter"), contained = kind.startsWith("csp");
  const src = buildSource(html, { neuter, params }), channel = new MessageChannel();
  let iframe = null, worker = null, portP;
  if (contained) {
    iframe = document.createElement("iframe"); iframe.setAttribute("sandbox", "allow-scripts"); iframe.style.display = "none";
    iframe.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; img-src data: blob:"><script>onmessage=(e)=>{if(e.data&&e.data.t==="make"){const w=new Worker(URL.createObjectURL(new Blob([e.data.src])));window.__w=w;const ch=new MessageChannel();w.postMessage({t:"port",port:ch.port2},[ch.port2]);parent.postMessage({t:"port",port:ch.port1},"*",[ch.port1]);}};parent.postMessage({t:"iframe-up"},"*");<\/script>`;
    portP = new Promise((ok) => { const on = (e) => { if (e.source !== iframe.contentWindow) return; if (e.data.t === "iframe-up") iframe.contentWindow.postMessage({ t: "make", src }, "*"); else if (e.data.t === "port") { window.removeEventListener("message", on); ok(e.data.port); } }; window.addEventListener("message", on); });
    document.body.appendChild(iframe);
  } else {
    worker = new Worker(URL.createObjectURL(new Blob([src])));
    worker.postMessage({ t: "port", port: channel.port2 }, [channel.port2]); portP = Promise.resolve(channel.port1);
  }
  const port = await portP; let seq = 0; const waiting = new Map(), events = [];
  port.onmessage = (e) => { const m = e.data; if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else events.push(m); };
  const call = (m, timeout = 120000) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, ok); port.postMessage({ ...m, id }); setTimeout(() => { if (waiting.delete(id)) no(new Error("timeout " + m.t)); }, timeout); });
  await new Promise((ok) => { const t0 = performance.now(); const poll = () => (events.some((m) => m.t === "up") || performance.now() - t0 > 4000 ? ok() : setTimeout(poll, 5)); poll(); });
  return { kind, call, events, srcBytes: src.length, kill: () => { try { worker?.terminate(); } catch {} if (iframe) iframe.remove(); } };
}

// ---- helpers: scenes, pixels --------------------------------------------------------------------------------------
const loadIndex = async () => (await (await fetch("index.json")).json()).filter((s) => !s.error);
const loadHtml = async (s) => (await (await fetch(s.name + ".html")).text());
async function pixelsOf(buf) { const bm = await createImageBitmap(new Blob([buf], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" }); const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext("2d"); x.drawImage(bm, 0, 0); return x.getImageData(0, 0, bm.width, bm.height); }
function diffImages(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: [a.width, a.height, b.width, b.height] };
  let n = 0, big = 0, max = 0, sum = 0; const d1 = a.data, d2 = b.data;
  for (let i = 0; i < d1.length; i += 4) { const d = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2])); if (d) { n++; sum += d; if (d > 2) big++; if (d > max) max = d; } }
  const px = d1.length / 4; return { diffPx: n, diffPct: +(100 * n / px).toFixed(4), over2Pct: +(100 * big / px).toFixed(4), maxChannel: max, meanAbsOverAll: +(sum / px).toFixed(4) };
}

// ---- tests ---------------------------------------------------------------------------------------------------------
const api = {};
api.features = async () => {
  const main = { crossOriginIsolated, secureContext: isSecureContext, offscreenCanvas: typeof OffscreenCanvas !== "undefined", createImageBitmap: typeof createImageBitmap, performanceMemory: !!performance.memory, uaMemory: typeof performance.measureUserAgentSpecificMemory === "function", ua: navigator.userAgent, cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null };
  let worker = null; try { const h = await createHost("", "plain"); worker = (await h.call({ t: "features" })).f; h.kill(); } catch (e) { worker = { error: String(e.message || e) }; }
  return { main, worker };
};

// speed: sequential draw of every frame; `repeat` emulates a slower CPU by drawing each frame N times (CDP throttling does not reach Workers)
api.speed = async (name, scale, { repeat = 1, kind = "csp+neuter" } = {}) => {
  const s = (await loadIndex()).find((x) => x.name === name), html = await loadHtml(s), host = await createHost(html, kind);
  const t0 = performance.now(); const ready = await host.call({ t: "init", scale }); if (ready.t === "fail") { host.kill(); return { name, error: ready.message }; }
  const readyMs = performance.now() - t0, draws = [], walls = [], copies = [];
  for (let n = 0; n < s.frames; n++) { const t = performance.now(); const r = await host.call({ t: "frame", n, mode: "bitmap", repeat }); walls.push(performance.now() - t); draws.push(r.draw); copies.push(r.copy); r.bitmap.close(); }
  const bytes = ready.w * ready.h * 4; host.kill();
  const meanWall = mean(walls) + (repeat - 1) * mean(draws), produceFps = 1000 / meanWall, clipSeconds = s.frames / 30;
  const lead = clipSeconds * Math.max(0, 1 - produceFps / 30) + 0.5, windowFrames = Math.floor(160 * 1024 * 1024 / bytes), aheadFrames = Math.floor(windowFrames * 0.65), aheadSeconds = aheadFrames / 30;
  return { name, look: s.look, frames: s.frames, scale, repeat, size: ready.w + "x" + ready.h, frameMB: r1(bytes / 1048576), readyMs: r1(readyMs), drawMs: { mean: r1(mean(draws)), p50: r1(pct(draws, 0.5)), p95: r1(pct(draws, 0.95)), max: r1(Math.max(...draws)) }, copyMsMean: r1(mean(copies)), wallMsPerFrame: r1(meanWall), produceFps: r1(produceFps), realtimeRatio: r1(produceFps / 30), gate: { leadSeconds: r1(lead), windowFrames, aheadSeconds: r1(aheadSeconds), decision: lead <= aheadSeconds ? "live" : "clip-fallback" } };
};

// pixels: Worker host at full size vs (a) the CPU-export reference (the worker's own capture code) and (b) the same bundle on the page thread
api.identity = async (name, kind = "csp+neuter") => {
  const s = (await loadIndex()).find((x) => x.name === name), html = await loadHtml(s), htmlSha = await sha256(html);
  const host = await createHost(html, kind); await host.call({ t: "init", scale: 1 });
  const frames = Object.keys(s.refs).map(Number), out = { name, htmlShaMatchesExport: htmlSha === s.htmlSha, frames: {} };
  const iframe = document.createElement("iframe"); iframe.style.cssText = "position:fixed;left:-9999px;width:1920px;height:1080px"; iframe.src = name + ".html"; document.body.appendChild(iframe);
  await new Promise((ok) => (iframe.onload = ok)); const w = iframe.contentWindow; await w.FILM.ready; w.FILM.mount(1);
  for (const n of frames) {
    const r = await host.call({ t: "frame", n, mode: "png" }); const mine = await pixelsOf(r.png);
    const ref = await pixelsOf(await (await fetch(`${name}-ref-${n}.png`)).arrayBuffer());
    w.FILM.seek(n); const c = iframe.contentDocument.getElementById("film"), pc = new OffscreenCanvas(c.width, c.height), px = pc.getContext("2d"); px.drawImage(c, 0, 0); const page = px.getImageData(0, 0, c.width, c.height);
    const d0 = mine.data; let nonBg = 0; for (let i = 4; i < d0.length; i += 4) if (d0[i] !== d0[0] || d0[i + 1] !== d0[1] || d0[i + 2] !== d0[2]) nonBg++;
    out.frames[n] = { nonBackgroundPct: +(100 * nonBg / (d0.length / 4)).toFixed(1), workerVsCpuExport: diffImages(mine, ref), workerVsPageThread: diffImages(mine, page), pageThreadVsCpuExport: diffImages(page, ref) };
  }
  iframe.remove(); host.kill(); return out;
};

// identity of everything that feeds a frame: code, params, fonts, engine
api.digests = async (name) => {
  const s = (await loadIndex()).find((x) => x.name === name), html = await loadHtml(s), htmlSha = await sha256(html);
  const fonts = { families: ["sans-serif (probe only, never drawn)"], faceCount: document.fonts.size }, engine = await sha256("engine:" + s.look);
  const dig = async (params) => sha256([htmlSha, await sha256(canonical(params)), await sha256(canonical(fonts)), engine].join("|"));
  const a = await dig({ light: { color: "#fff", y: 3 } }), b = await dig({ light: { y: 3, color: "#fff" } }), c = await dig({ light: { color: "#3fbf5a", y: 3 } });
  return { htmlSha, sameParamsAnyKeyOrderSameDigest: a === b, changedParamChangesDigest: a !== c, fontsInBundle: /FontFace|@font-face/.test(html) };
};

api.containment = async (name = "fox-397b0ec8-0") => {
  const s = (await loadIndex()).find((x) => x.name === name), html = await loadHtml(s), origin = location.origin, out = {};
  await fetch("/probe-reset"); let leaked = false; const bc = new BroadcastChannel("phase0-leak"); bc.onmessage = () => (leaked = true);
  for (const kind of ["plain", "plain+neuter", "csp", "csp+neuter"]) {
    const host = await createHost(html, kind); const r = await host.call({ t: "probe", origin }, 30000); host.kill();
    await sleep(300); out[kind] = { probes: r.res, broadcastReachedPage: leaked }; leaked = false;
  }
  out.serverSaw = (await (await fetch("/probe-hits")).json()).map((h) => h.via ?? new URL(h.path, origin).searchParams.get("via"));
  bc.close(); return out;
};

api.hang = async (kind = "csp+neuter", name = "fox-397b0ec8-0", deadMs = 2000) => {
  const s = (await loadIndex()).find((x) => x.name === name), html = await loadHtml(s); let host = await createHost(html, kind); await host.call({ t: "init", scale: 0.445 });
  let maxGap = 0, last = performance.now(); const tick = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 16);
  const t0 = performance.now(); host.call({ t: "hang" }, 500).catch(() => {});
  let alive = true; while (alive) { await sleep(250); try { await host.call({ t: "hb" }, 200); } catch { if (performance.now() - t0 > deadMs) alive = false; } }
  const detected = performance.now() - t0; host.kill(); const killedAt = performance.now();
  await sleep(300); clearInterval(tick);
  host = await createHost(html, kind); await host.call({ t: "init", scale: 0.445 }); const f = await host.call({ t: "frame", n: 5, mode: "bitmap" }); const recovered = f.t === "frame"; host.kill();
  return { kind, watchdogMs: deadMs, detectedAfterMs: r1(detected), recreatedAndDrewFrameMs: r1(performance.now() - killedAt), recovered, mainThreadMaxGapMs: r1(maxGap) };
};

api.memorySnapshot = async (host) => {
  const snap = { main: performance.memory ? performance.memory.usedJSHeapSize : null };
  if (host) { try { snap.workerSelf = (await host.call({ t: "mem", chunkMB: 10 }, 3000)).perfMemory; } catch { snap.workerSelf = "unresponsive"; } }
  if (performance.measureUserAgentSpecificMemory) { try { const m = await performance.measureUserAgentSpecificMemory(); snap.uaTotal = m.bytes; snap.uaScopes = [...new Set(m.breakdown.flatMap((b) => b.attribution.map((a) => a.scope + ":" + (a.url ? a.url.slice(0, 30) : ""))))]; } catch (e) { snap.ua = "error " + e.name; } }
  return snap;
};
api.memoryVisibility = async (name = "fox-397b0ec8-0", mb = 300) => {
  const s = (await loadIndex()).find((x) => x.name === name), host = await createHost(await loadHtml(s), "csp+neuter"); await host.call({ t: "init", scale: 0.445 });
  const before = await api.memorySnapshot(host); await host.call({ t: "alloc", mb }); await sleep(500); const after = await api.memorySnapshot(host); host.kill(); return { allocatedInWorkerMB: mb, before, after };
};
api.bomb = async (capMB = 1500, deadMs = 2000) => {
  const s = (await loadIndex())[3], html = await loadHtml(s); let host = await createHost(html, "csp+neuter"); await host.call({ t: "init", scale: 0.445 });
  const t0 = performance.now(); host.call({ t: "bomb", capMB }, 500).catch(() => {}); let alive = true; while (alive) { await sleep(250); try { await host.call({ t: "hb" }, 200); } catch { if (performance.now() - t0 > deadMs) alive = false; } }
  const detected = performance.now() - t0; host.kill(); await sleep(500);
  host = await createHost(html, "csp+neuter"); await host.call({ t: "init", scale: 0.445 }); const f = await host.call({ t: "frame", n: 1, mode: "bitmap" }); host.kill();
  return { capMB, watchdogMs: deadMs, detectedAfterMs: r1(detected), pageSurvivedAndRecovered: f.t === "frame" };
};

// soak: real-time playback loop with a bounded ring of bitmaps, plus scrubs
api.soak = async (name, seconds, ringFrames = 64, sample = true) => {
  const s = (await loadIndex()).find((x) => x.name === name), host = await createHost(await loadHtml(s), "csp+neuter"); await host.call({ t: "init", scale: 0.445 });
  const ring = [], samples = [], lateMs = []; const t0 = performance.now(); let n = 0, produced = 0, nextSample = 0, next = t0;
  while (performance.now() - t0 < seconds * 1000) {
    const frame = n % s.frames, r = await host.call({ t: "frame", n: frame, mode: "bitmap" }); produced++; n++;
    ring.push(r.bitmap); while (ring.length > ringFrames) ring.shift().close();
    next += 1000 / 30; const wait = next - performance.now(); if (wait > 0) await sleep(wait); else lateMs.push(-wait);
    if (sample && (performance.now() - t0) / 1000 >= nextSample) { samples.push({ t: Math.round((performance.now() - t0) / 1000), ...(await api.memorySnapshot(host)) }); nextSample += Math.max(10, seconds / 12); }
  }
  const scrubs = []; for (let i = 0; i < 20; i++) { const f = Math.floor(Math.random() * s.frames), t = performance.now(); const r = await host.call({ t: "frame", n: f, mode: "bitmap" }); scrubs.push(performance.now() - t); ring.push(r.bitmap); while (ring.length > ringFrames) ring.shift().close(); }
  const after = await api.memorySnapshot(host); ring.forEach((b) => b.close()); host.kill();
  return { name, seconds, produced, lateFrames: lateMs.length, lateMsP95: r1(pct(lateMs, 0.95)), scrubMs: { mean: r1(mean(scrubs)), p95: r1(pct(scrubs, 0.95)), max: r1(Math.max(...scrubs)) }, samples, afterScrubs: after };
};

// one real parameter edit through both hosts: the scene reads self.__PARAMS__ (Worker preview) / a baked window.__PARAMS__ (CPU export)
api.paramEdit = async () => {
  const idx = await (await fetch("foxparams.json")).json(), html = await (await fetch("foxparams.html")).text(), out = { frames: {} };
  const draw = async (set) => { const host = await createHost(html, "csp+neuter", idx.sets[set].canonical); await host.call({ t: "init", scale: 1 }); const echo = (await host.call({ t: "params" })).echo, px = {}; for (const n of [0, 45]) px[n] = await pixelsOf((await host.call({ t: "frame", n, mode: "png" })).png); host.kill(); return { echo, px }; };
  const A = await draw("A"), B = await draw("B");
  for (const [k, w] of [["A", A], ["B", B]]) out["echoedParamsDigest" + k + "MatchesManifest"] = (await sha256(canonical(JSON.parse(w.echo)))) === idx.sets[k].paramsDigest;
  for (const n of [0, 45]) {
    const eA = await pixelsOf(await (await fetch(`foxparamsA-ref-${n}.png`)).arrayBuffer()), eB = await pixelsOf(await (await fetch(`foxparamsB-ref-${n}.png`)).arrayBuffer());
    out.frames[n] = { workerA_vs_exportA: diffImages(A.px[n], eA), workerB_vs_exportB: diffImages(B.px[n], eB), editChangesWorkerPixels: diffImages(A.px[n], B.px[n]), editChangesExportPixels: diffImages(eA, eB) };
  }
  const bd = async (k) => sha256([idx.htmlSha, idx.sets[k].paramsDigest, "fonts:none", "engine:fox"].join("|"));
  out.bundleDigestChangesWithParams = (await bd("A")) !== (await bd("B")); out.htmlShaUnchanged = true;
  return out;
};
// a scene that keeps heartbeating while retaining memory: the watchdog cannot see it
api.leak = async (mbPerFrame = 20, frames = 40) => {
  const s = (await loadIndex()).find((x) => x.name === "fox-397b0ec8-0"), host = await createHost(await loadHtml(s), "csp+neuter"); await host.call({ t: "init", scale: 0.445 });
  let hbOk = 0, held = 0; for (let i = 0; i < frames; i++) { await host.call({ t: "frame", n: i % 90, mode: "none" }); held = (await host.call({ t: "leak", mb: mbPerFrame })).heldMB; try { await host.call({ t: "hb" }, 500); hbOk++; } catch {} await sleep(150); }
  await sleep(1500); host.kill(); await sleep(1500); return { frames, retainedMB: held, heartbeatsAnswered: hbOk, watchdogTripped: hbOk < frames };
};
api.deviceReport = async () => {
  const index = await loadIndex(), rep = { when: new Date().toISOString(), features: await api.features(), speed: [], containment: null, hang: null, identity: [] };
  for (const s of index) rep.speed.push(await api.speed(s.name, 0.445));
  rep.containment = await api.containment(); rep.hang = await api.hang("csp+neuter");
  for (const s of index.slice(0, 3)) rep.identity.push(await api.identity(s.name));
  return rep;
};
function judgeTolerance(d) {
  const pass = d.over2Pct <= 2 && d.maxChannel <= 16;
  return { ...d, pass };
}
api.linuxParity = async (name, framesOpt = null, kind = "csp+neuter") => {
  const all = [...(await loadIndex()), ...(await (await fetch("job-b.json")).json().catch(() => []))];
  const s = all.find((x) => x.name === name);
  const html = await (await fetch(`${name}.html`)).text();
  const host = await createHost(html, kind); await host.call({ t: "init", scale: 1 });
  const frames = framesOpt || Object.keys(s.refs).map(Number).sort((a, b) => a - b);
  const out = { name, look: s?.look ?? "custom", frames: {}, scenePassWorkerVsLinux: true, scenePassMacVsLinux: true };
  for (const n of frames) {
    const r = await host.call({ t: "frame", n, mode: "png" }); const worker = await pixelsOf(r.png);
    const mac = await pixelsOf(await (await fetch(`${name}-ref-${n}.png`)).arrayBuffer());
    const linux = await pixelsOf(await (await fetch(`linux/${name}-ref-${n}.png`)).arrayBuffer());
    const wVsL = judgeTolerance(diffImages(worker, linux));
    const mVsL = judgeTolerance(diffImages(mac, linux));
    const wVsM = judgeTolerance(diffImages(worker, mac));
    if (!wVsL.pass) out.scenePassWorkerVsLinux = false;
    if (!mVsL.pass) out.scenePassMacVsLinux = false;
    out.frames[n] = { workerVsLinux: wVsL, macExportVsLinux: mVsL, workerVsMacExport: wVsM };
  }
  host.kill(); return out;
};
api.linuxParamsParity = async () => {
  const idx = await (await fetch("foxparams.json")).json(), html = await (await fetch("foxparams.html")).text(), out = {};
  for (const k of ["A", "B"]) {
    const name = `foxparams${k}`;
    const host = await createHost(html, "csp+neuter", idx.sets[k].canonical); await host.call({ t: "init", scale: 1 });
    out[name] = { name, frames: {}, scenePassWorkerVsLinux: true, scenePassMacVsLinux: true };
    for (const n of [0, 45]) {
      const worker = await pixelsOf((await host.call({ t: "frame", n, mode: "png" })).png);
      const mac = await pixelsOf(await (await fetch(`${name}-ref-${n}.png`)).arrayBuffer());
      const linux = await pixelsOf(await (await fetch(`linux/${name}-ref-${n}.png`)).arrayBuffer());
      const wVsL = judgeTolerance(diffImages(worker, linux));
      const mVsL = judgeTolerance(diffImages(mac, linux));
      const wVsM = judgeTolerance(diffImages(worker, mac));
      if (!wVsL.pass) out[name].scenePassWorkerVsLinux = false;
      if (!mVsL.pass) out[name].scenePassMacVsLinux = false;
      out[name].frames[n] = { workerVsLinux: wVsL, macExportVsLinux: mVsL, workerVsMacExport: wVsM };
    }
    host.kill();
  }
  return out;
};
window.phase0 = api;
document.getElementById("run").onclick = async () => { const st = document.getElementById("state"); st.textContent = "running…"; try { const r = await api.deviceReport(); const txt = JSON.stringify(r, null, 1); document.getElementById("out").textContent = txt; st.textContent = "done"; try { await navigator.clipboard.writeText(txt); st.textContent = "done (copied)"; } catch {} } catch (e) { st.textContent = "failed"; document.getElementById("out").textContent = String(e.stack || e); } };
