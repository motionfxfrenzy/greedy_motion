/*
 * The live player: index.html?preview=/p/preview.json plays the film in the browser, frames drawn on the fly by the same painter that renders the MP4,
 * the mixed sound as the clock. Nothing is encoded. Space plays and pauses, the bar scrubs, "draft" skips the paint pass (flat drawings: fast),
 * "loop shot" repeats the shot under the playhead, and the page reloads itself when preview.mjs rebuilds the timeline after a spec edit.
 */
(async function () {
  const src = new URLSearchParams(location.search).get("preview"); if (!src) return;
  const load = () => fetch(src + (src.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const data = await load(), dir = src.slice(0, src.lastIndexOf("/") + 1), T = data.timeline;
  await window.preparePlates(T);
  const info = window.initShort(T);
  const out = document.getElementById("out"); out.style.cssText = "display:block;margin:0 auto;max-width:100vw;max-height:calc(100vh - 54px);cursor:pointer";
  const audio = new Audio(dir + data.audio); audio.preload = "auto";
  const bar = document.createElement("div"); bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:54px;background:#111;color:#ddd;font:13px system-ui;display:flex;align-items:center;gap:12px;padding:0 14px;box-sizing:border-box";
  bar.innerHTML = '<button id="pp" style="width:64px;height:32px">play</button><input id="seek" type="range" min="0" max="1000" value="0" style="flex:1"><span id="tm" style="min-width:150px;text-align:right"></span><label><input id="draft" type="checkbox"> draft</label><label><input id="loop" type="checkbox"> loop shot</label><label title="checked: one continuous scene, drawn once at the start; unchecked: every shot draws itself in again at each transition"><input id="cont" type="checkbox"> continuous scene</label><span id="fps" style="min-width:110px"></span>';
  document.body.appendChild(bar);
  const $ = (id) => document.getElementById(id), pp = $("pp"), seek = $("seek"), tm = $("tm"), fpsEl = $("fps");
  const beatIdx = (t) => { const b = T.beats; for (let i = 0; i < b.length; i++) if (t < b[i].t1) return i; return b.length - 1; };
  let playing = false, clockT = 0, last = -1, lastDraft = null, frames = 0, tFps = performance.now(), cost = 0;
  const hashT = Number((location.hash.match(/t=([\d.]+)/) || [])[1]);
  if (hashT) { clockT = hashT; audio.currentTime = hashT; }
  const now = () => (playing ? audio.currentTime : clockT);
  function draw(force) {
    let t = now(); const loop = $("loop").checked, b = T.beats[beatIdx(t)];
    if (playing && loop && t >= b.t1 - 0.02) { audio.currentTime = clockT = t = b.t0; }
    const draft = $("draft").checked, d = Math.floor((t * T.fps) / T.twos);
    if (force || d !== last || draft !== lastDraft) { const s = performance.now(); window.playerFrame(t, draft); cost = cost * 0.8 + (performance.now() - s) * 0.2; last = d; lastDraft = draft; frames++; }
    seek.value = Math.round((t / T.duration) * 1000); tm.textContent = `${t.toFixed(1)} / ${T.duration.toFixed(1)}s  shot ${beatIdx(t) + 1}/${T.beats.length}`;
    const n = performance.now(); if (n - tFps > 1000) { fpsEl.textContent = `${Math.round((frames * 1000) / (n - tFps))} drawings/s, ${cost.toFixed(0)} ms each`; window.__stats = { drawingsPerSecond: (frames * 1000) / (n - tFps), msPerDrawing: cost, renderer: info.renderer }; frames = 0; tFps = n; }
    if (playing && audio.ended) { playing = false; pp.textContent = "play"; }
    requestAnimationFrame(() => draw(false));
  }
  const toggle = () => { if (playing) { clockT = audio.currentTime; audio.pause(); playing = false; pp.textContent = "play"; } else { if (clockT >= T.duration - 0.05) clockT = 0; audio.currentTime = clockT; audio.play().catch(() => {}); playing = true; pp.textContent = "pause"; } };
  { const c = $("cont"); c.checked = T.drawIn !== "each"; c.onchange = () => { window.setDrawIn(c.checked ? "opening" : "each"); last = -1; draw(true); }; if (T.style !== "doodle") c.parentElement.style.display = "none"; }   // the choice only means something for doodle films
  pp.onclick = toggle; out.onclick = toggle; window.__toggle = toggle;
  addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); toggle(); } if (e.code === "ArrowRight") { clockT = Math.min(T.duration, now() + 2); audio.currentTime = clockT; } if (e.code === "ArrowLeft") { clockT = Math.max(0, now() - 2); audio.currentTime = clockT; } });
  seek.oninput = () => { clockT = (seek.value / 1000) * T.duration; audio.currentTime = clockT; };
  // an edit rebuilt the timeline: reload at the same moment
  setInterval(async () => { try { const n = await load(); if (n.version !== data.version) { location.hash = "t=" + now().toFixed(2); location.reload(); } } catch {} }, 1500);
  draw(true);
})();
