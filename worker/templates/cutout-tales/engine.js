/* Cutout Tales composition glue. The drawing lives in kit.js (pure drawFrame(ctx, spec, t)); this file only
   reads the validated shot list from the composition variables, sizes a canvas, and redraws on every timeline
   update. Deterministic and seek-safe: no clocks, no Math.random, nothing carried between frames. */
(function () {
  "use strict";
  var root = document.getElementById("root");
  var HF = window.__hyperframes, V = {};
  try { V = Object.assign({}, window.__hfVariables || {}, HF && HF.getVariables ? HF.getVariables() : {}); } catch (e) { V = Object.assign({}, window.__hfVariables || {}); }
  var block = document.getElementById("hf-variables");
  if (block) { try { var extra = JSON.parse(block.textContent || "{}"); if (extra && typeof extra === "object") for (var k in extra) V[k] = extra[k]; } catch (e) {} }
  var spec = V.spec;
  if (typeof spec === "string") { try { spec = JSON.parse(spec); } catch (e) { spec = null; } }
  if (!spec || !Array.isArray(spec.shots) || !spec.shots.length) throw new Error("cutout-tales: the `spec` variable must hold a shot list.");
  var dims = CutoutKit.dims(spec);
  var canvas = document.createElement("canvas");
  canvas.width = dims.W; canvas.height = dims.H;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;left:0;top:0;width:" + dims.W + "px;height:" + dims.H + "px;display:block";
  root.appendChild(canvas);
  var ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("cutout-tales: Canvas 2D is unavailable.");
  var duration = Number(spec.duration) || spec.shots[spec.shots.length - 1].t1;
  // Burned-in captions (the project's subtitle settings; cues are timed on the film clock by the backend).
  var caps = V.captions;
  if (typeof caps === "string") { try { caps = JSON.parse(caps); } catch (e) { caps = null; } }
  var cues = caps && Array.isArray(caps.cues) && caps.mode !== "none" ? caps.cues : [];
  function wrap(text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + " " + words[i] : words[i];
      if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = words[i]; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  function rrect(x0, y0, w, h, r) { ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r); ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.closePath(); }
  // The six shared subtitle styles (same looks as the beat-plan engine's CSS), drawn on the canvas.
  var STYLES = {
    pill: { bg: "rgba(12,15,22,0.82)", fg: "#f8fafc", font: '700 {s}px "Hanken Grotesk", sans-serif', r: 999, stroke: "rgba(255,255,255,0.14)", sw: 1, shadow: "rgba(0,0,0,0.38)", sy: 4, sb: 14 },
    cinema: { bg: null, fg: "#fef08a", font: '700 {s}px "Hanken Grotesk", sans-serif', halo: "#090b10" },
    kinetic: { bg: "#facc15", fg: "#0b0d12", font: '800 {s}px "Hanken Grotesk", sans-serif', r: 10, stroke: "#0b0d12", sw: 3, drop: "#0b0d12", upper: true },
    paper: { bg: "#faf5e8", fg: "#231f1b", font: '600 {s}px Georgia, "Times New Roman", serif', r: 10, stroke: "#3b3228", sw: 2, drop: "rgba(30,22,14,0.32)" },
    shadow: { bg: null, fg: "#ffffff", font: '800 {s}px "Hanken Grotesk", sans-serif', soft: "rgba(0,0,0,0.85)", big: 2 },
    blueprint: { bg: "rgba(12,42,74,0.9)", fg: "#f0f9ff", font: '600 {s}px Menlo, monospace', r: 6, stroke: "#7dd3fc", sw: 2, shadow: "rgba(4,16,36,0.45)", sy: 4, sb: 12 }
  };
  function drawCaption(t) {
    var cue = null;
    for (var i = 0; i < cues.length; i++) if (t >= cues[i].s && t < cues[i].e) { cue = cues[i]; break; }
    if (!cue) return;
    var st = STYLES[caps.style] || STYLES.pill;
    var W = dims.W, H = dims.H;
    var fs = Math.round((W > H * 1.2 ? 42 : 40) * (st.big || 1) * Math.min(1.6, Math.max(0.5, (+caps.size || 100) / 100)) * (W > H ? W / 1920 : W / 1080));
    var fg = caps.color || st.fg, bgc = caps.bg || st.bg;
    var text = st.upper ? String(cue.t).toUpperCase() : cue.t;
    ctx.save();
    ctx.font = st.font.replace("{s}", fs);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var lines = wrap(text, W * 0.84), lh = Math.round(fs * 1.25), padX = Math.round(fs * 0.7), padY = Math.round(fs * 0.4);
    var tw = 0; for (var j = 0; j < lines.length; j++) tw = Math.max(tw, ctx.measureText(lines[j]).width);
    var bw = tw + padX * 2, bh = lines.length * lh + padY * 2;
    var cx = W * (+caps.x || 50) / 100, cy = H * (+caps.y || 88) / 100;
    cx = Math.min(W - bw / 2 - 12, Math.max(bw / 2 + 12, cx)); cy = Math.min(H - bh / 2 - 12, Math.max(bh / 2 + 12, cy));
    ctx.globalAlpha = Math.min(1, Math.max(0.2, (+caps.opacity || 100) / 100));
    var x0 = cx - bw / 2, y0 = cy - bh / 2;
    if (st.bg !== null) {
      var r = Math.min(bh / 2, st.r === 999 ? bh / 2 : st.r);
      if (st.drop) { ctx.fillStyle = st.drop; rrect(x0 + (caps.style === "paper" ? 3 : 0), y0 + (caps.style === "paper" ? 4 : 4), bw, bh, r); ctx.fill(); }
      ctx.save(); if (st.shadow) { ctx.shadowColor = st.shadow; ctx.shadowOffsetY = st.sy; ctx.shadowBlur = st.sb; }
      ctx.fillStyle = bgc; rrect(x0, y0, bw, bh, r); ctx.fill(); ctx.restore();
      if (st.sw) { ctx.lineWidth = st.sw; ctx.strokeStyle = st.stroke; rrect(x0, y0, bw, bh, r); ctx.stroke(); }
    }
    ctx.fillStyle = fg;
    for (var m = 0; m < lines.length; m++) {
      var ty = y0 + padY + lh * (m + 0.5);
      if (st.halo || st.soft) {
        var halo = caps.bg || st.halo || st.soft;
        ctx.save(); ctx.lineJoin = "round"; ctx.lineWidth = Math.max(4, fs * 0.16); ctx.strokeStyle = halo; ctx.strokeText(lines[m], cx, ty);
        if (st.soft) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4; }
        ctx.restore();
      }
      ctx.fillText(lines[m], cx, ty);
    }
    ctx.restore();
  }
  function draw(t) { var tt = Math.max(0, Math.min(duration, t)); CutoutKit.drawFrame(ctx, spec, tt); if (cues.length) drawCaption(tt); }
  var tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
  tl.set({}, {}, duration);
  tl.eventCallback("onUpdate", function () { draw(tl.time()); });
  // webfonts: redraw once they are ready (the kit re-lays out when text metrics change).
  try { var fonts = document.fonts; if (fonts && fonts.load) Promise.all([fonts.load('700 38px "Hanken Grotesk"'), fonts.load('400 20px "Hanken Grotesk"')]).then(function () { draw(tl.time()); }); } catch (e) {}
  draw(0);
  window.__cutout = { spec: spec, draw: draw };
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
})();
