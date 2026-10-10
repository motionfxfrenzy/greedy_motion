// Paste into the browser console (or the app's javascript tool) on https://x.com/ann_nnng/status/2103723183899852885 .
// It pauses the benchmark video, then window.__sheet(t0, n, step, cols) draws n frames from t0 every `step` seconds into a
// full-screen contact sheet you can screenshot. Used for docs/BENCHMARK_FRAME_ANALYSIS.md: 9 frames per sheet, step 0.2 (5 frames/s).
//   A = the 1920-wide video; B (Tony Dinh) = the 640-wide quoted video on the same page: change the videoWidth below.
const v = [...document.querySelectorAll("video")].find((x) => x.videoWidth === 1920); window.__v = v; v.pause(); v.muted = true;
window.__sheet = async (t0, n = 9, step = 0.2, cols = 3) => {
  const v = window.__v, rows = Math.ceil(n / cols), cw = 384, ch = 216;
  let c = document.getElementById("__sheet"); if (!c) { c = document.createElement("canvas"); c.id = "__sheet"; document.body.appendChild(c); }
  c.width = cols * cw; c.height = rows * ch;
  c.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:" + (100 * (rows * ch)) / (cols * cw) + "vw;z-index:2147483647;background:#000";
  const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < n; i++) {
    const t = Math.min(v.duration - 0.01, t0 + i * step); v.currentTime = t;
    await new Promise((r) => { const f = () => { v.removeEventListener("seeked", f); r(); }; v.addEventListener("seeked", f); setTimeout(r, 1500); });
    await new Promise((r) => setTimeout(r, 150));
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch; g.drawImage(v, x, y, cw, ch);
    g.fillStyle = "#ff00c8"; g.font = "bold 22px monospace"; g.fillText(t.toFixed(1), x + 6, y + 22); g.strokeStyle = "#333"; g.strokeRect(x, y, cw, ch);
  }
  return "done";
};
