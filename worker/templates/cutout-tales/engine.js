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
  function draw(t) { CutoutKit.drawFrame(ctx, spec, Math.max(0, Math.min(duration, t))); }
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
