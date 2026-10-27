/* Beat-plan composition engine: renders ANY beat plan (packages/contracts/src/beat-plan.ts) at any length and
   aspect from the composition variables. Deterministic and seek-safe: no clocks, no Math.random, no text
   measurement (sizes come from character counts), finite tweens, immediateRender:false, every animated
   property repeated in from AND to, every hidden element set at t=0, binary arrivals via autoAlpha sets. */
(function () {
  "use strict";
  var FPS = 30;
  function snap(t) { return Math.round(t * FPS) / FPS; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function px(n) { return Math.round(n) + "px"; }
  var root = document.getElementById("root");
  var stage = document.getElementById("stage");
  var wipes = document.getElementById("wipes");
  var capLayer = document.getElementById("captions");
  var tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
  var LOG = window.__bp = { beats: [], warnings: [], canvas: [] };
  var CANVAS_LAYERS = [];
  /* CANVAS_LAYER */

  // ---------- variables ----------
  var HF = window.__hyperframes, V = {};
  try { V = Object.assign({}, window.__hfVariables || {}, HF && HF.getVariables ? HF.getVariables() : {}); } catch (e) { V = Object.assign({}, window.__hfVariables || {}); }
  var block = document.getElementById("hf-variables");
  if (block) {
    try { var edits = JSON.parse(block.textContent || "{}"); if (edits && typeof edits === "object" && !Array.isArray(edits)) for (var ek in edits) V[ek] = edits[ek]; }
    catch (e) { LOG.warnings.push("hf-variables block is not valid JSON"); }
  }
  function J(s, d) { if (s && typeof s === "object") return s; try { return JSON.parse(s); } catch (e) { return d; } }
  var PLAN = J(V.plan, null) || { beats: [] };
  var BEATS = Array.isArray(PLAN.beats) ? PLAN.beats : [];
  function has(k) { return Object.prototype.hasOwnProperty.call(V, k) && typeof V[k] === "string"; }
  function same(a, b) { var n = function (x) { return String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }; return n(a) === n(b); }
  // plain text: markdown emphasis markers (**now.**, `x`) are never drawn; the last word takes the accent anyway
  function text(b, field) { var k = b.id + "." + field; var v = has(k) ? V[k] : b[field]; v = v == null ? "" : String(v).replace(/[*`~]+/g, "").replace(/(^|[\s([{"'])_{1,2}(?=\S)([^_]*?\S)_{1,2}(?=$|[\s.,;:!?)\]}"'])/g, "$1$2").replace(/\s+/g, " ").trim(); return v; }

  // ---------- canvas ----------
  var W = +root.getAttribute("data-width") || 1920, H = +root.getAttribute("data-height") || 1080;
  var MODE = W > H * 1.2 ? "wide" : H > W * 1.2 ? "tall" : "square";
  LOG.mode = MODE; LOG.size = [W, H];

  // ---------- inks: theme tokens, chosen per theme for contrast ----------
  var CS = getComputedStyle(root);
  function tok(n) { return (CS.getPropertyValue(n) || "").trim(); }
  function rgb(s) {
    var m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) { var h = m[1]; if (h.length < 6) h = h.split("").map(function (c) { return c + c; }).join(""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function lum(n) { var c = rgb(tok(n)); if (!c) return 0.5; var a = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function best(list, on) { var r = list[0], v = -1; list.forEach(function (n) { var c = ratio(n, on); if (c > v) { v = c; r = n; } }); return r; }
  function firstOk(list, on, min) { for (var i = 0; i < list.length; i++) if (ratio(list[i], on) >= min) return list[i]; return null; }
  var ON_BRAND = best(["--bg", "--surface", "--fg"], "--brand");
  // Full-bleed brand fields use the kit's primary exactly as set (--brand-fill) when there is one; --brand is that colour adjusted until text in it reads.
  var FIELD = tok("--brand-fill") ? "--brand-fill" : "--brand";
  var ON_FIELD = best(["--bg", "--surface", "--fg"], FIELD);
  var CARD = ["--surface", "--bg", "--fg"].reduce(function (a, n) { return lum(n) > lum(a) ? n : a; }, "--surface");
  var SHADE = ["--fg", "--bg"].reduce(function (a, n) { return lum(n) < lum(a) ? n : a; }, "--fg");
  var INK = {
    "--bp-on-brand": ON_BRAND,
    "--bp-accent": firstOk(["--accent", "--brand"], "--bg", 3) || best(["--fg", "--accent"], "--bg"),
    "--bp-accent-on-brand": (tok("--accent") !== tok("--brand") && firstOk(["--accent", "--accent-2"], "--brand", 3)) || ON_BRAND,
    "--bp-muted": firstOk(["--muted"], "--bg", 4.5) || "--fg",
    "--bp-field": FIELD,
    "--bp-on-field": ON_FIELD,
    "--bp-accent-on-dark": firstOk([FIELD, "--brand"], SHADE, 3) || "--bg",
    "--bp-accent-on-light": firstOk([FIELD], "--bg", 3) || "--brand",
    "--bp-card": CARD,
    "--bp-on-card": best(["--fg", "--bg", "--surface"], CARD),
    "--bp-shade": SHADE,
    "--bp-cursor": SHADE,
    "--bp-cursor-edge": CARD
  };
  for (var ik in INK) root.style.setProperty(ik, "var(" + INK[ik] + ")");
  var ACCENT_ON_FLOOD = INK["--bp-accent-on-brand"] !== ON_BRAND;
  var DISPLAY = tok("--font-display").toLowerCase();
  var ONE_WEIGHT = /bebas|archivo black|shrikhand|instrument serif/.test(DISPLAY);
  root.style.setProperty("--bp-dw", ONE_WEIGHT ? "400" : "700");
  // average glyph width (em) of the display face; sizes come from character counts, never from measuring
  var K = /bebas/.test(DISPLAY) ? 0.46 : /archivo black|shrikhand/.test(DISPLAY) ? 0.76 : /playfair|bodoni|garamond|baskerville|newsreader|instrument serif|source serif/.test(DISPLAY) ? 0.56 : 0.62;
  var KB = 0.56; // body face, bold

  // ---------- motion profile ----------
  var PROFILES = {
    snappy: { inE: "expo.out", outE: "expo.in", dIn: 0.34, dOut: 0.26, popE: "expo.out", popD: 0.3, wordE: "expo.out", wordD: 0.28, gap: 0.05, travelE: "expo.out" },
    smooth: { inE: "power3.out", outE: "power3.in", dIn: 0.62, dOut: 0.42, popE: "power3.out", popD: 0.55, wordE: "power3.out", wordD: 0.5, gap: 0.08, travelE: "power3.out" },
    springy: { inE: "back.out(1.3)", outE: "power3.in", dIn: 0.46, dOut: 0.32, popE: "back.out(1.7)", popD: 0.42, wordE: "back.out(1.6)", wordD: 0.4, gap: 0.06, travelE: "power3.out" }
  };
  var P = PROFILES[PLAN.motion_profile] || PROFILES.smooth;
  var OV = 0.08; // J-cut overlap: the incoming beat starts moving this long before the cut

  // ---------- layout per canvas (px at 1080 on the short side) ----------
  var LAY = {
    wide: {
      kin: { col: [0.1 * W, 0, 0.56 * W, H], cap: 190, lines: 2, sub: 46, align: "left", top: false },
      ui: { col: [0.07 * W, 0, 0.28 * W, H], cap: 124, lines: 3, sub: 36, card: [0.665 * W, 0.5 * H, 0.53 * W], field: [0.38 * W, -0.08 * H, 0.72 * W, 1.16 * H] },
      title: { name: 170, logoH: 190, logoW: 0.42 * W, kw: 120, kwW: 0.7 * W, pill: 46 },
      discs: [[[0.97 * W, 0.64 * H, 1.05 * H], [0.8 * W, 0.1 * H, 0.26 * H]], [[0.9 * W, 1.0 * H, 0.95 * H], [0.03 * W, 0.08 * H, 0.22 * H]]],
      titleDiscs: [[0.97 * W, 1.04 * H, 0.56 * H], [0.03 * W, -0.02 * H, 0.34 * H]],
      capBottom: 0.1 * H, capFs: 40, capWords: 7, cursor: 0.07 * W, DX: 0.12 * W, DY: 0.14 * H
    },
    tall: {
      kin: { col: [0.09 * W, 0.06 * H, 0.82 * W, 0.78 * H], cap: 176, lines: 3, sub: 48, align: "left", top: false },
      ui: { col: [0.08 * W, 0.065 * H, 0.84 * W, 0.27 * H], cap: 140, lines: 3, sub: 40, top: true, card: [0.5 * W, 0.575 * H, 0.86 * W], field: [-0.05 * W, 0.42 * H, 1.1 * W, 0.68 * H] },
      title: { name: 150, logoH: 200, logoW: 0.76 * W, kw: 120, kwW: 0.84 * W, pill: 48 },
      discs: [[[0.95 * W, 0.98 * H, 0.95 * W], [0.06 * W, 0.06 * H, 0.34 * W]], [[0.02 * W, 0.97 * H, 0.9 * W], [0.96 * W, 0.07 * H, 0.32 * W]]],
      titleDiscs: [[1.0 * W, 1.0 * H, 0.7 * W], [0.0 * W, 0.0 * H, 0.46 * W]],
      capBottom: 0.2 * H, capFs: 46, capWords: 4, cursor: 0.11 * W, DX: 0.16 * W, DY: 0.1 * H
    },
    square: {
      kin: { col: [0.1 * W, 0.04 * H, 0.8 * W, 0.84 * H], cap: 150, lines: 3, sub: 42, align: "center", top: false },
      ui: { col: [0.08 * W, 0.07 * H, 0.84 * W, 0.3 * H], cap: 106, lines: 2, sub: 34, top: true, card: [0.5 * W, 0.64 * H, 0.74 * W], field: [-0.05 * W, 0.5 * H, 1.1 * W, 0.6 * H] },
      title: { name: 140, logoH: 160, logoW: 0.66 * W, kw: 104, kwW: 0.82 * W, pill: 44 },
      discs: [[[0.96 * W, 1.0 * H, 0.62 * W], [0.05 * W, 0.05 * H, 0.28 * W]], [[0.04 * W, 0.98 * H, 0.56 * W], [0.95 * W, 0.04 * H, 0.26 * W]]],
      titleDiscs: [[1.0 * W, 1.02 * H, 0.46 * W], [0.0 * W, -0.02 * H, 0.32 * W]],
      capBottom: 0.1 * H, capFs: 40, capWords: 5, cursor: 0.1 * W, DX: 0.14 * W, DY: 0.14 * H
    }
  }[MODE];

  // ---------- helpers ----------
  function mk(tag, cls, parent, css, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) for (var k in css) e.style[k] = typeof css[k] === "number" ? px(css[k]) : css[k];
    if (txt != null) e.textContent = txt;
    parent.appendChild(e);
    return e;
  }
  function free(e) { e.setAttribute("data-layout-allow-overflow", ""); e.setAttribute("data-layout-allow-overlap", ""); return e; }
  function hide(e) { tl.set(e, { autoAlpha: 0 }, 0); }
  function showAt(e, t) { tl.set(e, { autoAlpha: 1 }, snap(t)); }
  function pop(e, t, from) { hide(e); showAt(e, t); tl.fromTo(e, { scale: from }, { scale: 1, duration: P.popD, ease: P.popE }, snap(t)); }
  function drift(e, t0, t1, to) {
    if (t1 - t0 < 0.3) return;
    var from = {}; for (var k in to) from[k] = k === "scale" ? 1 : 0;
    tl.fromTo(e, from, Object.assign({ duration: t1 - t0, ease: "none" }, to), snap(t0));
  }
  function cw(ch) { return /[A-Z]/.test(ch) ? 1.16 : /[mwMW@%]/.test(ch) ? 1.38 : /[ijlI.,'!:;|]/.test(ch) ? 0.46 : /[ft r]/.test(ch) ? 0.72 : 1; }
  function wordWidth(w, fs, k) { var s = 0; for (var i = 0; i < w.length; i++) s += cw(w[i]); return s * k * fs; }
  function lineCount(words, fs, maxW, k) {
    var n = 1, cur = 0, sp = 0.28 * fs;
    for (var i = 0; i < words.length; i++) {
      var ww = wordWidth(words[i], fs, k);
      if (ww > maxW) return 99;
      if (!cur) cur = ww; else if (cur + sp + ww <= maxW) cur += sp + ww; else { n++; cur = ww; }
    }
    return n;
  }
  function fit(str, maxW, lines, cap, floor, k) {
    var words = String(str).split(/\s+/).filter(Boolean);
    for (var fs = cap; fs > floor; fs -= 2) if (lineCount(words, fs, maxW * 0.94, k || K) <= lines) return fs;
    return floor;
  }
  var CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.6l4.6 4.6L19.2 7.4"/></svg>';
  var ARROW = '<svg viewBox="0 0 24 24"><path d="M5 3 L5 19.6 L9.2 15.6 L12 21.8 L15.1 20.4 L12.4 14.4 L18.3 14.4 Z" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  var GRIP = '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

  // key-phrase size: a phrase made of short sentences ("Screens in. Film out.") breaks at its full stops
  // when that keeps the type within ~70% of the free-wrap size
  function kwFit(str, maxW, lines, cap, floor) {
    var whole = fit(str, maxW, lines, cap, floor);
    var ph = String(str).split(/(?<=[.!?])\s+/).filter(Boolean);
    if (ph.length < 2 || ph.length > lines) return { fs: whole, phrases: null };
    var each = Math.min.apply(null, ph.map(function (p) { return fit(p, maxW, 1, cap, floor); }));
    return each >= 0.72 * whole ? { fs: each, phrases: ph } : { fs: whole, phrases: null };
  }
  // kinetic key phrase: one span per word, last word in the accent (a waterfall entry, cut-the-curve §6)
  function keyword(parent, str, kf, align, maxW) {
    var fs = kf.fs;
    var el = mk("div", "kw", parent, { fontSize: fs, textAlign: align || "left" });
    var groups = kf.phrases || [String(str)], spans = [], all = String(str).split(/\s+/).filter(Boolean).length;
    groups.forEach(function (g) {
      var host = kf.phrases ? mk("span", "ph", el) : el;
      var words = g.split(/\s+/).filter(Boolean);
      words.forEach(function (w, j) {
        spans.push(mk("span", "w" + (spans.length === all - 1 ? " acc" : ""), host, null, w));
        if (j < words.length - 1) host.appendChild(document.createTextNode(" "));
      });
    });
    var lines = kf.phrases ? kf.phrases.length : lineCount(String(str).split(/\s+/).filter(Boolean), fs, (maxW || W) * 0.94, K);
    var ul = null, ink = null;
    if (spans.length && SKETCH) ink = sketchUnderline(spans[spans.length - 1], str);
    else if (spans.length) { ul = mk("i", "ul", spans[spans.length - 1]); tl.set(ul, { scaleX: 0 }, 0); }
    return { el: el, spans: spans, ul: ul, ink: ink, fs: fs, lines: lines };
  }

  // ---------- Sketch look (Rough.js): hand-drawn ink that draws on through the timeline ----------
  // Every shape is seeded from the beat, so each frame (and every re-render) draws the same ink; the
  // colour is a theme token (currentColor of the accent word, or --bp-accent), never a literal.
  var STYLE_CATALOG = /* STYLE_CATALOG */ [];
  var STYLE = STYLE_CATALOG.find(function (item) { return item.id === V.look; }) || STYLE_CATALOG[0];
  var MATERIAL = STYLE && STYLE.renderMode === "generated";
  var DOODLE = STYLE && STYLE.renderer === "doodle";
  var VOX = V.look === "vox-collage";
  // The typography showreel: the "clean" look in its type family. Every beat is a typographic scene (wall, glitch, stack, outline fill).
  var TYPE = V.family === "clean-type" && (!V.look || V.look === "clean");
  var SKETCH = (V.look === "sketch" || DOODLE || (STYLE && STYLE.renderer === "collage")) && !!window.rough;
  LOG.look = STYLE ? STYLE.id : "clean";
  LOG.styleVersion = STYLE ? STYLE.version : 1;
  var HAIRLINE = V.look === "hairline";
  var HAIRLINE_PLATES = /* HAIRLINE_GEOMETRY */ [];
  var hs = document.createElement("style");
  hs.textContent = ".look-hairline .ul{height:2px}.look-hairline .card{border:2px solid var(--fg);box-shadow:none}.look-hairline .pill{background:transparent;color:var(--fg);border:2px solid var(--bp-accent)}.look-hairline .disc,.look-hairline .panel{background:transparent;border:2px solid var(--bp-accent)}";
  root.appendChild(hs);
  function sceneStyle(id, host) {
    STYLE = STYLE_CATALOG.find(function(item){return item.id === id;}) || STYLE_CATALOG[0];
    MATERIAL = STYLE && STYLE.renderMode === "generated";
    DOODLE = STYLE && STYLE.renderer === "doodle";
    VOX = id === "vox-collage";
    SKETCH = (id === "sketch" || DOODLE || (STYLE && STYLE.renderer === "collage")) && !!window.rough;
    HAIRLINE = id === "hairline";
    if(host){host.classList.add("look-"+STYLE.id);if(MATERIAL)host.classList.add("look-material");if(DOODLE)host.classList.add("look-drawn");if(STYLE.renderer === "clay")host.classList.add("look-clay");}
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  // Original Hairline plate geometry, vendored at build time; MIT notice is embedded in the page.
  function hairlineFigure(parent, s, e, n) {
    if ((n || 0) % 4 !== 0) return hairlineVariant(parent, s, e, n);
    var wide = MODE === "wide", size = Math.min(W * (wide ? 0.36 : 0.7), H * (wide ? 0.8 : 0.38));
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "20 20 320 290");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "hairline-figure");
    Object.assign(svg.style, { position: "absolute", left: px(wide ? W * 0.68 : (W - size) / 2), top: px(wide ? (H - size) / 2 : H * 0.59), width: px(size), height: px(size), overflow: "visible" });
    parent.appendChild(svg);
    tl.set(svg, { rotation: [0, -7, 6][(n || 0) % 3], transformOrigin: "50% 50%" }, 0);
    var duration = e - s;
    HAIRLINE_PLATES.forEach(function (markup, i) {
      var plate = document.createElementNS(SVGNS, "g");
      plate.innerHTML = markup; svg.appendChild(plate);
      Array.prototype.forEach.call(plate.querySelectorAll("path"), function (p) {
        p.style.fill = p.classList.contains("silhouette") ? "var(--bg)" : "none";
        p.style.stroke = "var(--fg)";
        p.style.strokeWidth = p.classList.contains("silhouette") ? "1.5" : "1";
      });
      var lift = -(n % 2 ? 62 : 40) * i * (size / 520);
      tl.fromTo(plate, { y: 0 }, { y: lift, duration: duration * 0.25, ease: "sine.inOut" }, snap(s + duration * (0.06 + i * 0.025)));
      tl.fromTo(plate, { y: lift }, { y: 0, duration: duration * 0.25, ease: "sine.inOut" }, snap(s + duration * (0.61 + (3 - i) * 0.025)));
      var edge = plate.querySelector(".silhouette");
      tl.fromTo(edge, { stroke: "var(--fg)" }, { stroke: "var(--bp-accent)", duration: duration * 0.1, ease: "none" }, snap(s + duration * (0.3 + i * 0.05)));
      tl.fromTo(edge, { stroke: "var(--bp-accent)" }, { stroke: "var(--fg)", duration: duration * 0.1, ease: "none" }, snap(s + duration * (0.55 + i * 0.05)));
    });
  }
  // Native graphic adaptations: all positions are deterministic; motion reuses the engine timeline.
  // These are intentionally described as graphic treatments, not photoreal material footage.
  function styleFigure(parent, b, s, e) {
    var wide = MODE === "wide", size = Math.min(W * (wide ? 0.27 : 0.53), H * (wide ? 0.62 : 0.28));
    var host = free(mk("div", "style-figure", parent, { left: wide ? W * 0.69 : (W - size) / 2, top: wide ? (H - size) / 2 : H * 0.62, width: size, height: size }));
    var parts = [[.02,.18,.68,.64,-9],[.29,.03,.60,.53,8],[.26,.44,.60,.49,-4]];
    if (STYLE.renderer === "diorama" || STYLE.id === "paper") parts = [[.02,.04,.9,.86,-4],[.12,.16,.74,.69,3],[.25,.31,.50,.47,-2]];
    parts.forEach(function (v, i) {
      var piece;
      if (DOODLE && window.rough) {
        piece = inkSvg(host, { left: px(v[0]*size), top: px(v[1]*size), width: px(v[2]*size), height: px(v[3]*size) }, 200, 160);
        var opts = { seed: seedOf(STYLE.id + "|" + b.id + "|" + i), fill: tok("--brand"), stroke: tok("--fg"), fillStyle: STYLE.fillStyle, roughness: 1.6, hachureGap: 9, strokeWidth: 2 };
        piece.appendChild(i === 1 ? rough.svg(piece).ellipse(100,80,178,138,opts) : rough.svg(piece).rectangle(10,10,178,138,opts));
      } else piece = mk("div", "style-piece", host, { left:v[0]*size, top:v[1]*size, width:v[2]*size, height:v[3]*size });
      tl.set(piece, { rotation: v[4] }, 0);
      var at = s + i * Math.min(.16, (e-s)*.05), duration = Math.min(.6,(e-s)*.22);
      hide(piece); showAt(piece, at);
      var stepped = MATERIAL && STYLE.renderer !== "collage" && STYLE.renderer !== "diorama";
      tl.fromTo(piece, { y: size*.2 }, { y: 0, duration: duration, ease: stepped ? "steps(7)" : P.inE }, snap(at));
      tl.fromTo(piece, { x: 0 }, { x: (i-1)*size*.06, duration: Math.max(.2,e-at-duration), ease: stepped ? "steps(" + Math.max(2,Math.round((e-at-duration)*12)) + ")" : "none" }, snap(at+duration));
    });
  }
  // The scene the director chose for this beat (from the style's scene list), else the style's own rotation.
  function pick(b, ids, i) { var k = b && b.scene ? ids.indexOf(b.scene) : -1; return k >= 0 ? k : i % ids.length; }
  function seedOf(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 1) % 2147483646) + 1; }
  function inkSvg(parent, css, w, h) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 " + w + " " + h); s.setAttribute("preserveAspectRatio", "none"); s.setAttribute("class", "ink");
    Object.assign(s.style, { position: "absolute", overflow: "visible", pointerEvents: "none" }, css);
    parent.appendChild(s); return free(s);
  }
  function inkPaths(svgEl, color, width) {
    var ps = Array.prototype.slice.call(svgEl.querySelectorAll("path"));
    ps.forEach(function (p) {
      p.style.stroke = color; p.style.fill = "none"; p.style.strokeWidth = px(width);
      p.setAttribute("vector-effect", "non-scaling-stroke"); p.setAttribute("stroke-linecap", "round");
      var n = Math.ceil(p.getTotalLength()) + 2; p.style.strokeDasharray = n; p.style.strokeDashoffset = n; p.__len = n;
    });
    return ps;
  }
  function inkDraw(ps, t, d) {
    if (!ps || !ps.length) return;
    tl.fromTo(ps, { strokeDashoffset: function (i, el) { return el.__len; } }, { strokeDashoffset: 0, duration: d, ease: "power2.inOut", stagger: d * 0.15 }, snap(t));
  }
  function sketchUnderline(span, str) {
    var sv = inkSvg(span, { left: "-0.04em", width: "calc(100% + 0.08em)", bottom: "-0.2em", height: "0.3em" }, 100, 12);
    sv.appendChild(rough.svg(sv).line(2, 7, 98, 5, { seed: seedOf("ul|" + str), roughness: 1.2, bowing: 1.6 }));
    return inkPaths(sv, "currentColor", clamp(Math.min(W, H) * 0.005, 4, 8));
  }
  // The ring sits on a screenshot that may be light or dark, so it is drawn in the loud brand accent over a
  // halo in the card colour: the same seeded ellipse twice, so the two always line up.
  function sketchRing(parent, x, y, w, h, key, t) {
    var pad = 16, ww = w + 2 * pad, hh = h + 2 * pad, box = { left: px(x - w / 2 - pad), top: px(y - h / 2 - pad), width: px(ww), height: px(hh) };
    var weight = clamp(Math.min(W, H) * 0.005, 4, 7), opts = { seed: seedOf("ring|" + key), roughness: 1.5, bowing: 1.1 };
    var halo = inkSvg(parent, Object.assign({ opacity: "0.75" }, box), ww, hh), ink = inkSvg(parent, box, ww, hh);
    halo.appendChild(rough.svg(halo).ellipse(ww / 2, hh / 2, w, h, opts));
    ink.appendChild(rough.svg(ink).ellipse(ww / 2, hh / 2, w, h, opts));
    inkDraw(inkPaths(halo, "var(--bp-card)", weight + 5), t, 0.55);
    inkDraw(inkPaths(ink, VOX ? "var(--bp-shade)" : "var(--bp-accent-on-brand)", VOX ? weight * 1.5 : weight), t, 0.55);
  }
  function waterfall(kw, t) {
    var gap = P.gap, at = t, lift = clamp(kw.fs * 0.42, 40, 80);
    kw.spans.forEach(function (s, j) {
      var last = j === kw.spans.length - 1;
      hide(s); showAt(s, at);
      tl.fromTo(s, { y: last ? lift * 1.3 : lift }, { y: 0, duration: P.wordD * (last ? 1.12 : 1), ease: P.wordE }, snap(at));
      at += gap; gap *= 0.84;
    });
    return at + P.wordD;
  }
  function underline(kw, t) {
    if (kw.ink) inkDraw(kw.ink, t, 0.45);
    else if (kw.ul) tl.fromTo(kw.ul, { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "power3.out" }, snap(t));
  }
  function rise(e, t, dist) { hide(e); showAt(e, t); tl.fromTo(e, { y: dist || 30 }, { y: 0, duration: P.popD, ease: P.inE }, snap(t)); }
  function checkPop(parent, x, y, size, t) {
    var burst = free(mk("div", "burst", parent, { left: x - size / 2, top: y - size / 2, width: size, height: size }));
    tl.set(burst, { opacity: 0 }, 0);
    tl.fromTo(burst, { scale: 0.7, opacity: 0.9 }, { scale: 2.1, opacity: 0, duration: 0.7, ease: "power2.out" }, snap(t + 0.05));
    var c = free(mk("div", "check", parent, { left: x - size / 2, top: y - size / 2, width: size, height: size }));
    c.innerHTML = CHECK;
    pop(c, t, 0.3);
    return c;
  }

  // ---------- seams: the plan's entry/exit vectors, velocity-matched (motion-doctrine, cut-the-curve) ----------
  function vec(v, d) { return v && (v.axis === "x" || v.axis === "y" || v.axis === "z") && (v.dir === 1 || v.dir === -1) ? v : d; }
  function seamIn(el, v, t0, first) {
    var d = P.dIn;
    if (v.axis === "x") tl.fromTo(el, { x: -v.dir * LAY.DX }, { x: 0, duration: d, ease: P.inE }, snap(t0));
    else if (v.axis === "y") tl.fromTo(el, { y: -v.dir * LAY.DY }, { y: 0, duration: d, ease: P.inE }, snap(t0));
    else tl.fromTo(el, { scale: v.dir > 0 ? 0.84 : 1.18, filter: "blur(8px)" }, { scale: 1, filter: "blur(0px)", duration: d, ease: P.inE }, snap(t0));
    tl.fromTo(el, { opacity: first ? 0.5 : 0.35 }, { opacity: 1, duration: first ? 0.2 : 0.16, ease: "none" }, snap(t0));
  }
  function seamOut(el, v, t1) {
    var d = P.dOut, t0 = t1 - d;
    if (v.axis === "x") tl.fromTo(el, { x: 0 }, { x: v.dir * LAY.DX, duration: d, ease: P.outE }, snap(t0));
    else if (v.axis === "y") tl.fromTo(el, { y: 0 }, { y: v.dir * LAY.DY, duration: d, ease: P.outE }, snap(t0));
    else tl.fromTo(el, { scale: 1, filter: "blur(0px)" }, { scale: v.dir > 0 ? 1.16 : 0.86, filter: "blur(8px)", duration: d, ease: P.outE }, snap(t0));
    tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: d * 0.4, ease: "power1.in" }, snap(t1 - d * 0.4));
  }
  // brand-field wipe: a brand panel travels along the seam vector, covering the cut (the carrier)
  function wipe(v, cut) {
    var w;
    if (v.axis === "z") {
      var dia = Math.sqrt(W * W + H * H) * 1.08;
      w = free(mk("div", "wipe disc", wipes, { left: W / 2 - dia / 2, top: H / 2 - dia / 2, width: dia, height: dia }));
      tl.set(w, { opacity: 0 }, 0);
      tl.fromTo(w, { scale: v.dir > 0 ? 0.05 : 1.6, opacity: 1 }, { scale: 1, opacity: 1, duration: 0.3, ease: "power3.in" }, snap(cut - 0.3));
      tl.fromTo(w, { opacity: 1 }, { opacity: 0, duration: 0.24, ease: "none" }, snap(cut + 0.04));
      return;
    }
    var big = v.axis === "x" ? W : H, span = big * 1.35;
    w = free(mk("div", "wipe", wipes, v.axis === "x" ? { left: 0, top: -0.05 * H, width: span, height: H * 1.1 } : { left: -0.05 * W, top: 0, width: W * 1.1, height: span }));
    // the panel enters from one side, is centred on the frame at the cut and leaves by the other, never stopping
    var key = v.axis === "x" ? "x" : "y", from = {}, mid = {}, to = {};
    from[key] = v.dir < 0 ? big : -span; mid[key] = -(span - big) / 2; to[key] = v.dir < 0 ? -span : big;
    tl.set(w, from, 0);
    tl.fromTo(w, from, Object.assign({ duration: 0.3, ease: "power2.in" }, mid), snap(cut - 0.3));
    tl.fromTo(w, mid, Object.assign({ duration: 0.36, ease: "power2.out" }, to), snap(cut));
  }

  // a full-bleed brand field travels the whole frame along the seam vectors: it wipes in on the entry
  // vector (covering the outgoing beat) and leaves on the exit vector, revealing the next beat
  function fieldCarrier(f, sh, first, e, wiped) {
    var full = function (v) { return v.axis === "x" ? 1.15 * W : 1.15 * H; };
    // the film's first beat is already on its field at frame 0 (its seam entry carries the motion)
    if (first) {} else if (sh.vin.axis === "z") tl.fromTo(f, { scale: sh.vin.dir > 0 ? 0.84 : 1.18 }, { scale: 1, duration: P.dIn, ease: P.inE }, snap(sh.t0));
    else { var a = {}, b = {}; a[sh.vin.axis] = -sh.vin.dir * full(sh.vin); b[sh.vin.axis] = 0; tl.fromTo(f, a, Object.assign({ duration: P.dIn, ease: P.inE }, b), snap(sh.t0)); }
    if (sh.last || wiped) return; // a brand-field wipe takes over from the field at the cut
    var d = P.dOut;
    if (sh.vout.axis === "z") {
      tl.fromTo(f, { scale: 1 }, { scale: sh.vout.dir > 0 ? 1.16 : 0.86, duration: d, ease: P.outE }, snap(e - d));
      tl.fromTo(f, { opacity: 1 }, { opacity: 0, duration: d * 0.4, ease: "power1.in" }, snap(e - d * 0.4));
    } else { var c = {}, g = {}; c[sh.vout.axis] = 0; g[sh.vout.axis] = sh.vout.dir * full(sh.vout); tl.fromTo(f, c, Object.assign({ duration: d, ease: P.outE }, g), snap(e - d)); }
  }

  // ---------- one beat shell: window → seam (vectors) → cam (push) ----------
  function shell(i, b, s, e, last) {
    var beat = free(mk("div", "beat", stage));
    beat.setAttribute("data-beat", b.id);
    var seam = free(mk("div", "seam", beat));
    var cam = free(mk("div", "cam", seam));
    var t0 = i === 0 || TYPE ? s : s - OV; // a typography film cuts hard on the beat
    hide(beat); showAt(beat, t0);
    if (!last) tl.set(beat, { autoAlpha: 0 }, snap(e)); // text is never co-visible across a cut (one side per frame)
    var mo = b.motion || {};
    var vin = vec(mo.entry, { axis: "x", dir: -1 }), vout = vec(mo.exit, { axis: "x", dir: -1 });
    if (!TYPE) { seamIn(seam, vin, t0, i === 0); if (!last) seamOut(seam, vout, e); }
    return { beat: beat, seam: seam, cam: cam, vin: vin, vout: vout, t0: t0, last: last };
  }
  // ---------- the camera: the engine decides, per beat, whether the camera moves and how ----------
  // 1. The director's words ("pan right 6%", "pull-back 8%", "dolly zoom", "short decisive push-in") are read for a verb, a
  //    direction, a size and a pace. When the plan says nothing usable, the engine picks a move from the beat's role, its
  //    exit vector (so the camera carries the eye into the seam), its energy and what the previous beat just did.
  // 2. Some beats get no move at all: a beat too short to read a move in, a calm beat that is barely a second long.
  // 3. Whatever is chosen is then fitted to the words on screen: the move is shrunk until the text box stays inside the
  //    frame (with a margin) at both ends of the move, and dropped if it cannot. Text is never cropped by the camera.
  // Every move is a fromTo on the film's timeline, so a seek lands on the same pixels. The decisions are listed in
  // window.__bp.cam for the tests and the editor.
  function camRead(text) {
    var t = String(text || "").toLowerCase();
    var pct = /(\d+(?:\.\d+)?)\s*(?:%|percent)/.exec(t);
    var left = /\bleft\b/.test(t), right = /\bright\b/.test(t), up = /\b(up|rise|lift)\b/.test(t), down = /\b(down|drop|descend)\b/.test(t);
    var kind = /dolly[- ]?zoom|vertigo|contra[- ]?zoom/.test(t) ? "dolly"
      : /pull[- ]?back|pull out|wide reveal|zoom out/.test(t) ? "pull"
      : /\b(pan|truck|lateral|slide)\b/.test(t) && (left || right) ? "pan"
      : /\b(tilt|crane|rise|drop)\b/.test(t) && (up || down || /rise|drop/.test(t)) ? "tilt"
      : /\barc\b/.test(t) ? "arc"
      : /\b(static|locked|still|hold)\b/.test(t) && !/push|pull|pan|tilt/.test(t) ? "hold"
      : /push|dolly|zoom|move in|drift/.test(t) ? "push" : null;
    return { kind: kind, rev: kind === "dolly" && /\b(out|reverse|away|back)\b/.test(t), pct: pct ? clamp(parseFloat(pct[1]), 2, 12) / 100 : null, sx: left ? -1 : 1, sy: down ? 1 : -1,
      ease: /expo|snap|decisive|quick|fast|punch|slam|whip/.test(t) ? "expo.out" : /slow|gentle|drift|settle|float/.test(t) ? "sine.inOut" : "none" };
  }
  var CAM_LOG = [], CAM_LAST = { kind: null, dir: 0 }, CAM_DOLLY = 0, DOLLY_HOLD = 0.6; // the words follow the background's zoom by 40%
  window.__bp.cam = CAM_LOG;
  function camChoose(b, i, dur, sh, energy, text) {
    var r = camRead(text), base = energy === "high" ? 0.09 : energy === "calm" ? 0.05 : 0.07;
    if (b && dur < 0.9) return { kind: null, why: "beat too short for a move" };
    if (b && energy === "calm" && dur < 1.6 && !(r.kind && r.kind !== "hold")) return { kind: null, why: "calm and brief" };
    if (r.kind === "hold") return { kind: null, why: "the plan asks for a locked frame" };
    if (r.kind) return { kind: r.kind, rev: r.rev, amt: r.pct || base, ease: r.ease, sx: r.sx, sy: r.sy, src: "plan" };
    // nothing usable in the plan: choose from the beat itself
    var v = sh && sh.vout, last = i === BEATS.length - 1, role = b && b.role, kind;
    if (last || role === "cta") kind = "pull";
    else if (role === "success" || (role === "hook" && i === 0)) kind = "push";
    else if (role === "reveal" && CAM_DOLLY < 1 && i > 0 && energy === "high") { kind = "dolly"; CAM_DOLLY++; }
    else if (v && v.axis === "x") kind = "pan";
    else if (v && v.axis === "y") kind = "tilt";
    else kind = v && v.dir < 0 ? "pull" : "push";
    if (kind === CAM_LAST.kind && kind !== "pull") kind = kind === "push" ? "arc" : "push"; // neighbours do not repeat a move
    var dir = v && v.axis === "x" ? v.dir : v && v.axis === "y" ? v.dir : 1;
    return { kind: kind, amt: base, ease: kind === "push" && (role === "success" || energy === "high") ? "expo.out" : kind === "pull" || last ? "sine.inOut" : "none", sx: dir, sy: dir, src: "auto" };
  }
  // The words on this beat, as one box in frame coordinates, or null when there is nothing to measure.
  function camTextBox(cam) {
    var rr = root.getBoundingClientRect(), k = rr.width / W || 1, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, any = false;
    cam.querySelectorAll(".kw, .sub, .pill, .lock, .ty-t").forEach(function (n) {
      var r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      any = true; x0 = Math.min(x0, (r.left - rr.left) / k); y0 = Math.min(y0, (r.top - rr.top) / k); x1 = Math.max(x1, (r.right - rr.left) / k); y1 = Math.max(y1, (r.bottom - rr.top) / k);
    });
    return any ? { x0: x0, y0: y0, x1: x1, y1: y1 } : null;
  }
  // The two end states of a move: scale, offset and the point it turns about.
  function camStates(m, ox, oy) {
    var a = m.amt, c = { x: W / 2, y: H / 2 };
    if (m.kind === "pull") return [{ s: 1 + a, x: 0, y: 0, o: { x: ox, y: oy } }, { s: 1, x: 0, y: 0, o: { x: ox, y: oy } }];
    if (m.kind === "pan") return [{ s: 1 + a * 0.9, x: m.sx * 0.5 * a * W, y: 0, o: c }, { s: 1 + a * 0.9, x: -m.sx * 0.5 * a * W, y: 0, o: c }];
    if (m.kind === "tilt") return [{ s: 1 + a * 0.9, x: 0, y: m.sy * 0.5 * a * H, o: c }, { s: 1 + a * 0.9, x: 0, y: -m.sy * 0.5 * a * H, o: c }];
    if (m.kind === "arc") return [{ s: 1, x: -0.4 * a * W, y: 0.25 * a * H, o: { x: ox, y: oy } }, { s: 1, x: 0.4 * a * W, y: -0.25 * a * H, o: { x: ox, y: oy } }];
    // A dolly zoom: the background closes in (or backs away) by `a` while the words change size by less, so they swell or shrink
    // against it. The state's scale is the words' own, which is what the frame guardrail has to hold.
    if (m.kind === "dolly") { var w = Math.pow(1 + a, 1 - DOLLY_HOLD); return m.rev ? [{ s: w, x: 0, y: 0, o: { x: ox, y: oy } }, { s: 1, x: 0, y: 0, o: { x: ox, y: oy } }] : [{ s: 1, x: 0, y: 0, o: { x: ox, y: oy } }, { s: w, x: 0, y: 0, o: { x: ox, y: oy } }]; }
    return [{ s: 1, x: 0, y: 0, o: { x: ox, y: oy } }, { s: 1 + a, x: 0, y: 0, o: { x: ox, y: oy } }];
  }
  function camFits(m, ox, oy, box, mx, my) {
    if (!box) return true;
    return camStates(m, ox, oy).every(function (st) {
      var fx = function (v) { return st.o.x + st.s * (v - st.o.x) + st.x; }, fy = function (v) { return st.o.y + st.s * (v - st.o.y) + st.y; };
      return fx(box.x0) >= mx && fx(box.x1) <= W - mx && fy(box.y0) >= my && fy(box.y1) <= H - my;
    });
  }
  function push(cam, s, e, ox, oy, energy, text, b, i, sh) {
    var dur = Math.max(0.5, e - s), m = camChoose(b, i, dur, sh, energy, text), box = camTextBox(cam), mx = 0.045 * W, my = 0.05 * H;
    var log = { beat: b && b.id, kind: m.kind, src: m.src || "none", amt: m.amt, why: m.why };
    if (m.kind) {
      // Fit the move to the words: shrink it until the text box stays inside the frame at both ends, drop it if it never fits.
      // Origin for a push: the words' own centre, so the frame grows evenly around them.
      if (box && (m.kind === "push" || m.kind === "pull" || m.kind === "dolly")) { ox = (box.x0 + box.x1) / 2; oy = (box.y0 + box.y1) / 2; }
      var want = m.amt, n = 0;
      while (!camFits(m, ox, oy, box, mx, my) && n < 8) { m.amt *= 0.75; n++; }
      if (!camFits(m, ox, oy, box, mx, my) || m.amt < 0.012) { log.kind = null; log.why = "text would leave the frame"; m = { kind: null }; }
      else if (n) { log.why = "shrunk to keep the text in frame (" + Math.round(want * 100) + "% to " + Math.round(m.amt * 1000) / 10 + "%)"; log.amt = m.amt; }
    }
    CAM_LOG.push(log);
    CAM_LAST = { kind: m.kind, dir: m.sx || 0 };
    if (!m.kind) return;
    var st = camStates(m, ox, oy), ease = m.ease || "none";
    var camS = m.kind === "dolly" ? (m.rev ? [1 + m.amt, 1] : [1, 1 + m.amt]) : [st[0].s, st[1].s];
    var from = { scale: camS[0], x: st[0].x, y: st[0].y, transformOrigin: px(st[0].o.x) + " " + px(st[0].o.y) };
    var to = { scale: camS[1], x: st[1].x, y: st[1].y, transformOrigin: px(st[1].o.x) + " " + px(st[1].o.y), duration: dur, ease: ease };
    tl.fromTo(cam, from, to, snap(s));
    if (m.kind === "dolly") {
      // The words change size by less than the background (DOLLY_HOLD): counter-scale the text columns about the same point.
      var back = Math.pow(1 + m.amt, -DOLLY_HOLD);
      cam.querySelectorAll(".col").forEach(function (c) {
        tl.fromTo(c, { scale: m.rev ? back : 1, transformOrigin: px(ox) + " " + px(oy) }, { scale: m.rev ? 1 : back, transformOrigin: px(ox) + " " + px(oy), duration: dur, ease: ease }, snap(s));
      });
    }
  }
  // The text effect for a beat. The director writes it as free text ("word-by-word fade-up", "spring-pop scale-up"), and only
  // the eight named effects used to count: everything else fell back to the plain waterfall. Free text is now mapped to the
  // nearest named effect, and a beat with none gets one that suits its role, so neighbouring frames do not all enter alike.
  var ROLE_EFFECTS = { hook: "per-character-rise", reveal: "stagger-from-center", success: "spring-scale-in", problem: "soft-blur-in", proof: "mask-reveal-up", cta: "mask-reveal-up", title: "mask-reveal-up" };
  var FEATURE_EFFECTS = ["waterfall", "spring-scale-in", "mask-reveal-up", "soft-blur-in"];
  function effectFor(b, i) {
    var raw = String((b.motion && b.motion.text_effect) || "").toLowerCase().trim();
    if (TEXT_EFFECTS.indexOf(raw) > -1) return raw;
    if (raw) {
      if (/typewriter|type[- ]?on|keystroke/.test(raw)) return "typewriter";
      if (/stagger.*(center|centre)|from[- ]center|scatter|assemble/.test(raw)) return "stagger-from-center";
      if (/char|letter/.test(raw)) return "per-character-rise";
      if (/blur/.test(raw)) return "soft-blur-in";
      if (/parallax|depth/.test(raw)) return "depth-parallax-words";
      if (/spring|pop|bounce|overshoot|slam|stamp|scale/.test(raw)) return "spring-scale-in";
      if (/mask|reveal|rise|wipe|slide/.test(raw)) return "mask-reveal-up";
      if (/waterfall|cascade|word|line|fade|stagger/.test(raw)) return "waterfall";
    }
    return ROLE_EFFECTS[b.role] || FEATURE_EFFECTS[i % FEATURE_EFFECTS.length];
  }
  // brand shapes under the camera: they drift along the beat's exit vector, carrying the eye into the seam
  function carry(el, v, s, e, k) {
    var to = v.axis === "x" ? { x: v.dir * 0.05 * W * k } : v.axis === "y" ? { y: v.dir * 0.05 * H * k } : { scale: 1 + (v.dir > 0 ? 0.08 : -0.06) * k };
    drift(el, s, e, to);
  }
  function discs(cam, variant, v, s, e, set) {
    (set || LAY.discs[variant % 2]).forEach(function (d, j) {
      var el = free(mk("div", "field disc", cam, { left: d[0] - d[2] / 2, top: d[1] - d[2] / 2, width: d[2], height: d[2] }));
      carry(el, v, s, e, j ? 1.6 : 1);
    });
  }

  // Sketch look on a type scene: notebook paper, a hand-drawn frame and loose doodles (arrow, star, squiggle, circle) that draw on
  // with the type, all seeded so every seek is identical. Replaces the solid brand-colour flood and the clean discs.
  // A product screen drawn as a wireframe: window with its three dots, a sidebar of rows, a heading, a rising chart with a
  // tick, and two small cards. Strokes are listed in the order a hand would draw them; the chart and tick take the accent.
  function sketchScreen(r, o, a) {
    var out = [], mark = function (shape) { shape.__accent = true; return shape; };
    var sx = a.x + a.w * 0.26, bar = a.h * 0.12, dot = Math.min(a.w, a.h) * 0.022;
    out.push(r.rectangle(a.x, a.y, a.w, a.h, o("scr", { roughness: 1.3 })));
    out.push(r.line(a.x, a.y + bar, a.x + a.w, a.y + bar, o("bar")));
    [0, 1, 2].forEach(function (k) { out.push(r.circle(a.x + a.w * 0.045 + k * dot * 2.8, a.y + bar / 2, dot * 1.6, o("dot" + k))); });
    out.push(r.line(sx, a.y + bar, sx, a.y + a.h, o("side")));
    for (var k = 0; k < 4; k++) {
      var ry = a.y + bar + a.h * (0.14 + k * 0.15);
      out.push(r.circle(a.x + a.w * 0.07, ry, dot * 1.8, o("rc" + k)));
      out.push(r.line(a.x + a.w * 0.12, ry, a.x + a.w * (0.2 + (k % 2) * 0.03), ry, o("rl" + k)));
    }
    out.push(r.rectangle(sx + a.w * 0.05, a.y + bar + a.h * 0.07, a.w * 0.34, a.h * 0.09, o("head", { roughness: 1.2 })));
    var cx0 = sx + a.w * 0.05, cx1 = a.x + a.w * 0.94, cy0 = a.y + a.h * 0.78, cy1 = a.y + bar + a.h * 0.26;
    out.push(r.line(cx0, cy1, cx0, cy0, o("ax")), r.line(cx0, cy0, cx1, cy0, o("ay")));
    var pts = [0, 0.18, 0.1, 0.42, 0.34, 0.62, 0.55, 0.85].reduce(function (acc, v, n, all) { if (n % 2 === 0) acc.push([cx0 + (cx1 - cx0) * (0.08 + 0.84 * (n / 6)), cy0 - (cy0 - cy1) * (all[n + 1])]); return acc; }, []);
    out.push(mark(r.linearPath(pts, o("chart", { roughness: 1.1, strokeWidth: 1.4 }))));
    var tx = cx1 - (cx1 - cx0) * 0.1, ty = cy1 - (cy0 - cy1) * 0.02;
    out.push(mark(r.linearPath([[tx - dot * 2, ty + dot], [tx - dot * 0.4, ty + dot * 2.6], [tx + dot * 2.6, ty - dot * 1.4]], o("tick", { strokeWidth: 1.6 }))));
    out.push(r.rectangle(cx0, a.y + a.h * 0.86, (cx1 - cx0) * 0.46, a.h * 0.09, o("c1")), r.rectangle(cx0 + (cx1 - cx0) * 0.54, a.y + a.h * 0.86, (cx1 - cx0) * 0.46, a.h * 0.09, o("c2")));
    return out;
  }
  function sketchFigure(cam, b, i, s, e) {
    var grid = free(mk("div", "sk-paper", cam, { left: -0.1 * W, top: -0.1 * H, width: 1.2 * W, height: 1.2 * H }));
    var pad = 0.05 * Math.min(W, H), key = "sk|" + b.id + "|" + i;
    var svg = inkSvg(cam, { left: 0, top: 0, width: px(W), height: px(H) }, W, H), r = rough.svg(svg), wide = MODE === "wide";
    var o = function (n, extra) { return Object.assign({ seed: seedOf(key + n), roughness: 1.6, bowing: 1.4, strokeWidth: 1 }, extra || {}); };
    svg.appendChild(r.rectangle(pad, pad, W - 2 * pad, H - 2 * pad, o("frame", { roughness: 1.2 })));
    var u = Math.min(W, H), fx = wide ? 0.78 * W : 0.5 * W, fy = wide ? 0.5 * H : 0.8 * H;
    var sk = pick(b, ["ring", "screen", "box"], i), screen = b.kind !== "title" && sk === 1, closing = b.kind === "title";
    var shapes = closing ? [r.line(0.3 * W, 0.86 * H, 0.7 * W, 0.845 * H, o("u1")), r.line(0.38 * W, 0.9 * H, 0.62 * W, 0.895 * H, o("u2"))] : screen ? sketchScreen(r, o, wide ? { x: 0.585 * W, y: 0.2 * H, w: 0.33 * W, h: 0.6 * H } : { x: 0.12 * W, y: 0.52 * H, w: 0.76 * W, h: 0.3 * H }) : sk === 0
      ? [r.circle(fx, fy, 0.34 * u, o("c")), r.line(fx - 0.2 * u, fy + 0.28 * u, fx - 0.04 * u, fy + 0.18 * u, o("a1")), r.line(fx - 0.04 * u, fy + 0.18 * u, fx - 0.1 * u, fy + 0.25 * u, o("a2")), r.line(fx - 0.04 * u, fy + 0.18 * u, fx - 0.14 * u, fy + 0.15 * u, o("a3"))]
      : [r.rectangle(fx - 0.17 * u, fy - 0.14 * u, 0.34 * u, 0.28 * u, o("b")), r.linearPath([[fx - 0.13 * u, fy - 0.06 * u], [fx - 0.1 * u, fy - 0.02 * u], [fx - 0.03 * u, fy - 0.1 * u]], o("tk", { strokeWidth: 1.5 })), r.line(fx - 0.04 * u, fy - 0.06 * u, fx + 0.12 * u, fy - 0.07 * u, o("t1")), r.line(fx - 0.13 * u, fy + 0.03 * u, fx + 0.12 * u, fy + 0.02 * u, o("t2")), r.line(fx - 0.13 * u, fy + 0.09 * u, fx + 0.05 * u, fy + 0.085 * u, o("t3")), r.line(fx - 0.2 * u, fy + 0.2 * u, fx + 0.2 * u, fy + 0.18 * u, o("u1")), r.line(fx - 0.14 * u, fy + 0.24 * u, fx + 0.14 * u, fy + 0.23 * u, o("u2"))];
    var sx = screen ? 0.5 * W : wide ? 0.9 * W : 0.86 * W, sy = screen ? 0.14 * H : 0.2 * H;
    for (var k = 0; k < 8; k++) { var a = (k / 8) * Math.PI * 2; shapes.push(r.line(sx + Math.cos(a) * 0.012 * u, sy + Math.sin(a) * 0.012 * u, sx + Math.cos(a) * 0.04 * u, sy + Math.sin(a) * 0.04 * u, o("s" + k))); }
    shapes.forEach(function (p) { svg.appendChild(p); });
    var ps = inkPaths(svg, "currentColor", clamp(u * 0.0055, 3, 7));
    ps.forEach(function (p, j) { p.style.opacity = j === 0 ? "0.55" : "0.9"; if (p.__accent) p.style.stroke = "var(--bp-accent-on-brand)"; });
    // The drawing always finishes inside the beat: a short beat draws faster, a long one takes its time.
    var span = Math.min(screen ? 1.7 : 1.1, (screen ? 0.62 : 0.5) * (e - s)), each = Math.max(0.12, span * 0.45), gap = ps.length > 1 ? (span - each) / (ps.length - 1) : 0;
    tl.fromTo(ps, { strokeDashoffset: function (n, el) { return el.__len; } }, { strokeDashoffset: 0, duration: each, ease: "power2.inOut", stagger: gap }, snap(s + 0.05));
    hide(grid); showAt(grid, s);
  }




  // ---------- Hairline: a different fine-line figure on every beat ----------
  // Beat 1 keeps the layered plates that lift apart and settle; the others are an isometric cube whose faces separate and
  // close again, a row of isometric bars that rise in turn, and stacked rings that float apart. Every stroke draws on,
  // fits inside the beat, and uses the brand's ink and accent.
  function hairlineVariant(parent, s, e, n) {
    var wide = MODE === "wide", size = Math.min(W * (wide ? 0.36 : 0.7), H * (wide ? 0.8 : 0.38)), dur = e - s;
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 320 290"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "hairline-figure");
    Object.assign(svg.style, { position: "absolute", left: px(wide ? W * 0.6 : (W - size) / 2), top: px(wide ? (H - size) / 2 : H * 0.59), width: px(size), height: px(size), overflow: "visible" });
    parent.appendChild(svg);
    var v = n % 4, K = v === 1 ? 52 : v === 2 ? 40 : 30, OX = v === 2 ? -2.3 * 0.866 * K : 0;
    var iso = function (x, y, z) { return [160 + OX + (x - y) * 0.866 * K, 232 + (x + y) * 0.5 * K - z * K - (v === 2 ? 70 : v === 1 ? 70 : 20)]; };
    var pt = function (a) { var q = iso(a[0], a[1], a[2]); return q[0].toFixed(1) + " " + q[1].toFixed(1); };
    var poly = function (pts) { return "M" + pts.map(pt).join("L") + "Z"; };
    var groups = [];
    var group = function (accent) { var g = document.createElementNS(SVGNS, "g"); svg.appendChild(g); groups.push({ g: g, accent: !!accent }); return g; };
    var add = function (g, d, accent) { var p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); p.setAttribute("data-accent", accent ? "1" : "0"); g.appendChild(p); return p; };
    var box = function (g, x, y, z, w, d, h, accent) { add(g, poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]), accent); add(g, poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])); add(g, poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])); };
    var moves = [];
    if (v === 1) {
      var top = group(true), right = group(), front = group();
      add(top, poly([[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]), true); add(right, poly([[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]])); add(front, poly([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]));
      // two small cubes beside it for scale
      var side = group(); box(side, 1.5, 0.2, 0, 0.5, 0.5, 0.5); var side2 = group(); box(side2, -0.9, 0.5, 0, 0.4, 0.4, 0.4);
      moves = [[top, 0, -46], [right, 40, 0], [front, -34, 22], [side, 0, 0], [side2, 0, 0]];
    } else if (v === 2) {
      [1, 1.7, 1.3, 2.5, 3.3].forEach(function (h, j) { var g = group(j === 4); box(g, j * 1.05, 0, 0, 0.78, 0.78, h, j === 4); moves.push([g, 0, 30]); });
      var base = group(); for (var j = 0; j <= 5; j++) add(base, "M" + pt([j * 1.05, -0.4, 0]) + "L" + pt([j * 1.05, 1.3, 0]));
      add(base, "M" + pt([-0.3, 1.3, 0]) + "L" + pt([5.3, 1.3, 0]));
    } else if (v === 3) {
      [0, 1, 2, 3].forEach(function (z) {
        var g = group(z === 3), c = iso(0, 0, z * 0.9), rx = 92 - z * 10, ry = rx * 0.58;
        add(g, "M" + (c[0] - rx) + " " + c[1] + "A" + rx + " " + ry + " 0 1 0 " + (c[0] + rx) + " " + c[1] + "A" + rx + " " + ry + " 0 1 0 " + (c[0] - rx) + " " + c[1] + "Z", z === 3);
        moves.push([g, 0, -z * 22]);
      });
      var rod = group(); var a = iso(0, 0, 0), b = iso(0, 0, 3 * 0.9); add(rod, "M" + a[0] + " " + a[1] + "L" + b[0] + " " + b[1]);
    }
    var paths = [];
    groups.forEach(function (it) { Array.prototype.forEach.call(it.g.querySelectorAll("path"), function (p) {
      var acc = it.accent || p.getAttribute("data-accent") === "1";
      Object.assign(p.style, { fill: "var(--bg)", stroke: acc ? "var(--bp-accent)" : "var(--fg)", strokeWidth: acc ? "2.4px" : "1.7px", strokeLinejoin: "round", strokeLinecap: "round" });
      p.setAttribute("vector-effect", "non-scaling-stroke");
      var len = Math.ceil(p.getTotalLength() * (size / 320)) + 4; // non-scaling strokes dash in screen pixels
      p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.__len = len; paths.push(p);
    }); });
    var span = Math.min(1.5, 0.55 * dur), each = Math.max(0.14, span * 0.45), gap = paths.length > 1 ? (span - each) / (paths.length - 1) : 0;
    tl.fromTo(paths, { strokeDashoffset: function (i, el) { return el.__len; } }, { strokeDashoffset: 0, duration: each, ease: "power2.inOut", stagger: gap }, snap(s + 0.08));
    moves.forEach(function (m, idx) {
      var out = Math.min(0.6, dur * 0.22), at = s + 0.08 + span * 0.8 + idx * 0.04;
      tl.fromTo(m[0], { x: 0, y: m[2] * 0.0 }, { x: m[1] * (size / 520), y: m[2] * (size / 520), duration: out, ease: "sine.inOut" }, snap(at));
      tl.fromTo(m[0], { x: m[1] * (size / 520), y: m[2] * (size / 520) }, { x: 0, y: 0, duration: out, ease: "sine.inOut" }, snap(Math.max(at + out, e - out - 0.1)));
    });
  }


  // ---------- Typography showreel (style family "clean-type") ----------
  // Four typographic scenes cycle beat by beat, all in the brand's colours and display face, and cut hard on the beat:
  //   wall         a tilted wall of the film's own words scrolling in opposite directions, the beat's word in the accent row,
  //                then the wall dims and that word swells
  //   glitch slam  one huge word sliced into strips that jitter and lock, an accent rule drawn under it and a dot
  //   word stack   the phrase one word per line, one word per cut, with a shape snapping in
  //   outline fill the phrase in outline, filled by a sweep, with an index and rules like a reel's slate
  // Every motion ends inside its beat, so a short beat just moves faster.
  // Every film is different: the variations below (backgrounds, tilt, directions, shapes) come from a seed made of the film's own words.
  var SEED = 0;
  function tySeed() { if (!SEED) SEED = seedOf(BEATS.map(function (b) { return text(b, "keyword"); }).join("|") + "|" + String(V.brandName || "")); return SEED; }
  // The brand name as a label: a missing or sentence-long name (a project named after its prompt) is not printed as a brand.
  function tyBrand() { var n = String(V.brandName || "").trim(); return n && n.length <= 24 ? n : ""; }
  var TY_LAST = "";
  function tyKind(i, options) { var k = options[(tySeed() + i) % options.length]; if (k === TY_LAST) k = options[(tySeed() + i + 1) % options.length]; if (k === TY_LAST) k = ["light", "dark", "brand"].filter(function (x) { return x !== TY_LAST; })[(tySeed() + i) % 2]; TY_LAST = k; return k; } // neighbouring beats never share a background
  function tyPool() {
    var seen = {}, out = [];
    BEATS.forEach(function (b) { var k = String(text(b, "keyword") || "").replace(/[.!?]+$/, "").trim().toUpperCase(); if (k && !seen[k]) { seen[k] = 1; out.push(k); } });
    var n = tyBrand().toUpperCase(); if (n && !seen[n]) out.push(n);
    return out.slice(0, 10);
  }
  function tyBg(cam, kind) {
    var bg = kind === "dark" ? "var(--bp-shade)" : kind === "brand" ? "var(--bp-field)" : "var(--bg)";
    var ink = kind === "dark" ? "var(--bg)" : kind === "brand" ? "var(--bp-on-field)" : "var(--fg)";
    free(mk("div", "ty-bg", cam, { position: "absolute", left: -0.12 * W, top: -0.12 * H, width: 1.24 * W, height: 1.24 * H, background: bg }));
    // Typography films mark emphasis in the kit's primary colour only (not its accent): on a light ground the brand colour itself, on a dark one the brand colour if it reads there, on the brand field the ink.
    return { ink: ink, accent: kind === "brand" ? ink : kind === "dark" ? "var(--bp-accent-on-dark)" : "var(--bp-accent-on-light)" };
  }
  function tyText(parent, str, fs, color, css) {
    return free(mk("div", "ty-t", parent, Object.assign({ position: "relative", whiteSpace: "nowrap", fontFamily: "var(--font-display)", fontWeight: "900", textTransform: "uppercase", letterSpacing: "-0.025em", lineHeight: "0.9", fontSize: px(fs), color: color }, css || {}), str));
  }
  function tyOutline(el, ink, w) { el.style.color = "transparent"; el.style.webkitTextStroke = px(w || Math.max(2, H * 0.003)) + " " + ink; }
  function tySlate(cam, i, n, ink, sub, s) {
    var fs = Math.max(16, Math.min(W, H) * 0.02), mono = { position: "absolute", fontFamily: "var(--font-mono, monospace)", fontSize: px(fs), letterSpacing: "0.12em", textTransform: "uppercase", color: ink, opacity: "0.8", whiteSpace: "nowrap" };
    var tag = free(mk("div", "ty-slate", cam, Object.assign({ left: 0.05 * W, top: 0.05 * H }, mono), (tyBrand() ? tyBrand().toUpperCase() + "  ·  " : "") + String(i + 1).padStart(2, "0") + " / " + String(n).padStart(2, "0")));
    hide(tag); showAt(tag, s + 0.05);
    if (sub) { var cap = free(mk("div", "ty-cap", cam, Object.assign({ left: 0.05 * W, bottom: 0.06 * H, maxWidth: px(0.7 * W), whiteSpace: "normal" }, mono), sub)); hide(cap); showAt(cap, s + 0.28); tl.fromTo(cap, { y: 14 }, { y: 0, duration: 0.2, ease: "power3.out" }, snap(s + 0.28)); }
  }
  function tyColumn(cam, align) { return free(mk("div", "ty-col", cam, { position: "absolute", left: 0.05 * W, top: 0, width: 0.9 * W, height: H, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: align || "flex-start" })); }
  function typeWall(cam, i, b, s, e, kw, sub, pool) {
    var dur = e - s, c = tyBg(cam, tyKind(i, ["light", "dark", "light"])), fs = H * 0.15, rows = 8, tilt = (tySeed() % 2 ? -1 : 1) * (6 + tySeed() % 5), flip = (tySeed() >> 3) % 2 ? -1 : 1;
    var wrap = free(mk("div", "ty-wall", cam, { position: "absolute", left: -0.45 * W, top: -0.55 * H, width: 1.9 * W, height: 2.1 * H }));
    tl.set(wrap, { rotation: tilt, transformOrigin: "50% 50%" }, 0);
    var hot = 4, rowEls = [];
    for (var r = 0; r < rows; r++) {
      var words = r === hot ? [kw] : pool.slice(r % Math.max(1, pool.length)).concat(pool.slice(0, r % Math.max(1, pool.length)));
      var row = free(mk("div", "ty-row", wrap, { position: "absolute", left: 0, top: px(r * fs * 1.04), whiteSpace: "nowrap", fontFamily: "var(--font-display)", fontWeight: "900", textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: "0.9", fontSize: px(fs), color: c.ink }));
      var line = []; for (var k = 0; k < 5; k++) line = line.concat(words.length ? words : [kw]);
      row.textContent = line.join("  •  ") + "  •  ";
      if (r === hot) row.style.color = c.accent; else if (r % 2) tyOutline(row, c.ink, Math.max(2, H * 0.0028));
      var dir = (r % 2 ? 1 : -1) * flip, span = 0.55 * W;
      tl.fromTo(row, { x: dir > 0 ? -span : 0 }, { x: dir > 0 ? 0 : -span, duration: dur, ease: "none" }, snap(s));
      rowEls.push(row);
    }
    var swell = s + Math.max(0.5, 0.55 * dur);
    rowEls.forEach(function (row, r) { if (r !== hot) tl.to(row, { opacity: 0.1, duration: 0.2, ease: "power2.out" }, snap(swell)); });
    tl.to(rowEls[hot], { scale: 1.3, duration: Math.max(0.3, e - swell - 0.05), ease: "power2.out", transformOrigin: "50% 50%" }, snap(swell));
    tySlate(cam, i, BEATS.length, c.ink, sub, s);
  }
  function typeGlitch(cam, i, b, s, e, kw, sub) {
    var dur = e - s, c = tyBg(cam, tyKind(i, ["dark", "brand", "dark"])), col = tyColumn(cam, "flex-start");
    var fs = fit(kw.toUpperCase(), 0.88 * W, 2, 0.36 * H, 90, K);
    var holder = free(mk("div", "ty-holder", col, { position: "relative", display: "inline-block" }));
    var base = tyText(holder, kw, fs, c.ink, { whiteSpace: "normal", maxWidth: px(0.88 * W) });
    hide(holder); showAt(holder, s + 0.02);
    var N = 5, steps = [0.045, 0.09, 0.135, 0.18, 0.225], dx = [-1, 1, -0.6, 0.8, -0.3];
    for (var k = 0; k < N; k++) {
      var clone = tyText(holder, kw, fs, c.ink, { position: "absolute", left: 0, top: 0, whiteSpace: "normal", maxWidth: px(0.88 * W), clipPath: "inset(" + (k * 100 / N) + "% 0 " + (100 - (k + 1) * 100 / N) + "% 0)" });
      tl.set(clone, { x: 0.05 * W * dx[k] }, snap(s));
      steps.forEach(function (t, j) { tl.set(clone, { x: 0.05 * W * dx[(k + j + 1) % N] * (1 - j / 5) }, snap(s + t * Math.min(1, dur / 1.2))); });
      tl.set(clone, { x: 0 }, snap(s + 0.28 * Math.min(1, dur / 1.2)));
    }
    var bar = free(mk("div", "ty-bar", col, { position: "relative", width: "0px", height: px(Math.max(6, fs * 0.07)), marginTop: px(fs * 0.12), background: c.accent }));
    tl.to(bar, { width: px(Math.min(0.6 * W, fs * 0.5 * Math.max(4, kw.length * 0.8))), duration: Math.min(0.4, 0.3 * dur), ease: "power3.out" }, snap(s + 0.22));
    var dot = free(mk("div", "ty-dot", cam, { position: "absolute", right: 0.07 * W, top: 0.14 * H, width: px(0.045 * H), height: px(0.045 * H), borderRadius: "50%", background: c.accent }));
    hide(dot); showAt(dot, s + 0.3); tl.fromTo(dot, { scale: 0 }, { scale: 1, duration: 0.2, ease: "back.out(2)" }, snap(s + 0.3));
    tySlate(cam, i, BEATS.length, c.ink, sub, s);
  }
  function typeStack(cam, i, b, s, e, kw, sub) {
    var dur = e - s, c = tyBg(cam, tyKind(i, ["brand", "dark", "brand"])), col = tyColumn(cam, "flex-start");
    var words = kw.split(/\s+/).filter(Boolean).slice(0, 4), fs = Infinity;
    words.forEach(function (w) { fs = Math.min(fs, fit(w.toUpperCase(), 0.88 * W, 1, 0.38 * H, 80, K)); });
    if (words.length * fs * 0.92 > 0.86 * H) fs = 0.86 * H / (words.length * 0.92);
    var step = clamp(dur * 0.14, 0.1, 0.22);
    words.forEach(function (w, k) {
      var el = tyText(col, w, fs, k === words.length - 1 ? c.accent : c.ink);
      if (k % 2 === 1 && k !== words.length - 1) tyOutline(el, c.ink, Math.max(2, H * 0.003));
      hide(el); showAt(el, s + 0.05 + k * step);
      tl.fromTo(el, { y: fs * 0.25, scale: 1.08 }, { y: 0, scale: 1, duration: 0.2, ease: "power4.out", transformOrigin: "0% 50%" }, snap(s + 0.05 + k * step));
    });
    var d = 0.34 * H, shape = (tySeed() + i) % 3, ring = free(mk("div", "ty-ring", cam, { position: "absolute", right: 0.07 * W, top: 0.12 * H, width: px(d), height: px(d), borderRadius: shape === 0 ? "50%" : shape === 1 ? "8%" : "0", border: shape === 2 ? "0" : px(Math.max(6, d * 0.12)) + " solid " + c.ink, background: shape === 2 ? c.ink : "transparent", clipPath: shape === 2 ? "polygon(50% 0, 100% 100%, 0 100%)" : "none", boxSizing: "border-box" }));
    hide(ring); showAt(ring, s + 0.12); tl.fromTo(ring, { scale: 0.2, rotation: -40 }, { scale: 1, rotation: 0, duration: 0.3, ease: "back.out(1.7)" }, snap(s + 0.12));
    var rule = free(mk("div", "ty-rule", cam, { position: "absolute", right: 0.07 * W, bottom: 0.1 * H, width: "0px", height: px(Math.max(6, H * 0.008)), background: c.ink }));
    tl.to(rule, { width: px(0.2 * W), duration: 0.3, ease: "power3.out" }, snap(s + 0.3));
    tySlate(cam, i, BEATS.length, c.ink, sub, s);
  }
  function typeOutline(cam, i, b, s, e, kw, sub) {
    var dur = e - s, c = tyBg(cam, tyKind(i, ["light", "brand", "light"])), col = tyColumn(cam, "flex-start");
    var fs = fit(kw.toUpperCase(), 0.88 * W, 2, 0.34 * H, 90, K);
    var holder = free(mk("div", "ty-holder", col, { position: "relative", display: "inline-block" }));
    var base = tyText(holder, kw, fs, c.ink, { whiteSpace: "normal", maxWidth: px(0.88 * W) }); tyOutline(base, c.ink, Math.max(3, H * 0.004));
    var fill = tyText(holder, kw, fs, c.ink === "var(--bp-on-field)" ? "var(--bp-on-field)" : c.accent, { position: "absolute", left: 0, top: 0, whiteSpace: "normal", maxWidth: px(0.88 * W) });
    hide(holder); showAt(holder, s + 0.02);
    tl.fromTo(fill, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: clamp(0.45 * dur, 0.3, 0.9), ease: "power3.inOut" }, snap(s + 0.15));
    [0.12, 0.88].forEach(function (f, n) {
      var line = free(mk("div", "ty-line", cam, { position: "absolute", left: 0.05 * W, top: px(f * H), width: "0px", height: px(Math.max(3, H * 0.004)), background: c.ink }));
      tl.to(line, { width: px(0.9 * W), duration: 0.35, ease: "power3.out" }, snap(s + 0.05 + n * 0.08));
    });
    tySlate(cam, i, BEATS.length, c.ink, sub, s);
  }
  function typeMarquee(cam, i, b, s, e, kw, sub) {
    var dur = e - s, c = tyBg(cam, tyKind(i, ["dark", "brand", "light"])), fs = H * 0.34, phrase = kw.toUpperCase() + "  ·  ", line = "";
    for (var k = 0; k < 8; k++) line += phrase;
    [0, 1].forEach(function (r) {
      var row = free(mk("div", "ty-marq", cam, { position: "absolute", left: 0, top: px((r ? 0.52 : 0.1) * H), whiteSpace: "nowrap", fontFamily: "var(--font-display)", fontWeight: "900", textTransform: "uppercase", letterSpacing: "-0.025em", lineHeight: "0.95", fontSize: px(fs), color: c.ink }, line));
      if (r) tyOutline(row, c.ink, Math.max(3, H * 0.004)); else row.style.color = c.accent;
      var dir = (r ? 1 : -1) * ((tySeed() >> 2) % 2 ? -1 : 1), span = Math.min(2.4 * W, 0.9 * W + dur * 0.5 * W);
      tl.fromTo(row, { x: dir > 0 ? -span : 0 }, { x: dir > 0 ? 0 : -span, duration: dur, ease: "none" }, snap(s));
    });
    tySlate(cam, i, BEATS.length, c.ink, sub, s);
  }
  function typeCounter(cam, i, b, s, e, kw, sub) {
    var dur = e - s, c = tyBg(cam, tyKind(i, ["brand", "dark", "light"])), col = tyColumn(cam, "flex-start");
    var m = /(\d[\d,]*(?:\.\d+)?)/.exec(kw), numStr = m ? m[1] : "", unit = m ? kw.replace(m[0], "").trim() : kw, num = m ? parseFloat(numStr.replace(/,/g, "")) : 0, dec = /\./.test(numStr) ? numStr.split(".")[1].length : 0, grp = /,/.test(numStr);
    var fs = fit((numStr || kw).toUpperCase(), 0.88 * W, 1, 0.5 * H, 120, K);
    var big = tyText(col, numStr ? "0" : kw, fs, c.ink);
    var u = tyText(col, unit, fs * 0.34, c.accent, { marginTop: px(fs * 0.08) });
    hide(col); showAt(col, s + 0.02);
    var t0 = s + 0.1, span = Math.max(0.4, Math.min(1.2, 0.6 * dur));
    function fmt(v) { var t = v.toFixed(dec); if (grp) { var parts = t.split("."); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); t = parts.join("."); } return t; }
    if (numStr) CANVAS_LAYERS.push(function (t) { var p = clamp((t - t0) / span, 0, 1); big.textContent = fmt(num * (1 - Math.pow(1 - p, 3))); });
    tySlate(cam, i, BEATS.length, c.ink, sub, s);
  }
  var TY_IDS = ["wall", "glitch", "stack", "outline", "marquee", "counter"];
  var TY_SCENES = [typeWall, typeGlitch, typeStack, typeOutline, typeMarquee, typeCounter];
  function typeBeat(i, b, sh, s, e, kwText, onScreen, closing) {
    var kw = String(kwText || "").replace(/[.!?]+$/, "").trim();
    if (closing) { typeGlitch(sh.cam, i, b, s, e, tyBrand() || kw, tyBrand() ? onScreen || kwText : onScreen); }
    else TY_SCENES[pick(b, TY_IDS, i)](sh.cam, i, b, s, e, kw, onScreen, tyPool());
    push(sh.cam, s, e, W / 2, H / 2, b.energy || "high", b.motion && b.motion.camera, b, i, sh);
    return {};
  }

  // ---------- Doodle looks (doodle, cross-hatch, zig-zag): a different hand-drawn scene on every beat ----------
  // Four compositions that rotate with the beat (a light bulb, a looping arrow with stars, a checklist, a rising chart),
  // all drawn with the look's own fill (hachure, cross-hatch or zig-zag) in the brand colours. The strokes draw on in
  // order and always finish inside the beat, so a short beat just draws faster.
  function doodleFigure(cam, b, i, s, e) {
    var wide = MODE === "wide", u = Math.min(W, H), dur = e - s, key = "dd|" + STYLE.id + "|" + b.id + "|" + i;
    var closing = b.kind === "title";
    var R = closing ? (wide ? { x: 0.03 * W, y: 0.56 * H, w: 0.2 * W, h: 0.36 * H } : { x: 0.05 * W, y: 0.74 * H, w: 0.3 * W, h: 0.2 * H }) : wide ? { x: 0.585 * W, y: 0.14 * H, w: 0.35 * W, h: 0.72 * H } : { x: 0.1 * W, y: 0.54 * H, w: 0.8 * W, h: 0.4 * H };
    var svg = inkSvg(cam, { left: 0, top: 0, width: px(W), height: px(H) }, W, H), r = rough.svg(svg);
    var fillStyle = STYLE.fillStyle || "hachure", brand = tok("--brand"), fg = tok("--fg"), accent = tok("--accent") || brand;
    var o = function (n, x) { return Object.assign({ seed: seedOf(key + n), roughness: 1.7, bowing: 1.5, strokeWidth: 3, stroke: fg }, x || {}); };
    var fill = function (n, color, x) { return o(n, Object.assign({ fill: color, fillStyle: fillStyle, hachureGap: Math.max(8, u * 0.014), fillWeight: 3, stroke: fg }, x || {})); };
    var X = function (f) { return R.x + R.w * f; }, Y = function (f) { return R.y + R.h * f; };
    var star = function (cx, cy, rad, n, color) { var pts = []; for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? rad * 0.45 : rad; pts.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]); } return r.polygon(pts, fill("star" + n, color, { roughness: 1.3 })); };
    var shapes = [], v = pick(b, ["bulb", "loop", "checklist", "chart"], i);
    if (v === 0) {
      shapes.push(r.circle(X(0.5), Y(0.38), R.h * 0.5, fill("bulb", brand)), r.rectangle(X(0.4), Y(0.66), R.w * 0.2, R.h * 0.07, fill("b1", fg, { fillWeight: 2 })), r.rectangle(X(0.43), Y(0.74), R.w * 0.14, R.h * 0.05, o("b2")));
      for (var k = 0; k < 7; k++) { var a = Math.PI + (k / 6) * Math.PI, c0 = [X(0.5) + Math.cos(a) * R.h * 0.34, Y(0.38) + Math.sin(a) * R.h * 0.34], c1 = [X(0.5) + Math.cos(a) * R.h * 0.46, Y(0.38) + Math.sin(a) * R.h * 0.46]; shapes.push(r.line(c0[0], c0[1], c1[0], c1[1], o("ray" + k))); }
      shapes.push(star(X(0.9), Y(0.82), R.h * 0.09, 1, accent));
    } else if (v === 1) {
      var loop = []; for (var j = 0; j <= 28; j++) { var tt = j / 28; loop.push([X(0.08 + 0.78 * tt), Y(0.7 - 0.5 * tt + 0.11 * Math.sin(tt * Math.PI * 5))]); }
      shapes.push(r.curve(loop, o("loop", { strokeWidth: 4 })), r.line(X(0.86), Y(0.2), X(0.72), Y(0.2), o("ah1", { strokeWidth: 4 })), r.line(X(0.86), Y(0.2), X(0.82), Y(0.36), o("ah2", { strokeWidth: 4 })), star(X(0.24), Y(0.28), R.h * 0.11, 2, accent), star(X(0.62), Y(0.8), R.h * 0.08, 3, brand), star(X(0.88), Y(0.62), R.h * 0.06, 4, fg));
    } else if (v === 2) {
      for (var row = 0; row < 3; row++) {
        var yy = 0.14 + row * 0.27;
        shapes.push(r.rectangle(X(0.08), Y(yy), R.w * 0.16, R.h * 0.16, row < 2 ? fill("cb" + row, brand) : o("cb" + row)));
        if (row < 2) shapes.push(r.linearPath([[X(0.1), Y(yy + 0.08)], [X(0.16), Y(yy + 0.15)], [X(0.28), Y(yy - 0.04)]], o("ck" + row, { strokeWidth: 5, stroke: fg })));
        shapes.push(r.line(X(0.36), Y(yy + 0.08), X(0.9 - row * 0.1), Y(yy + 0.07), o("ln" + row, { strokeWidth: 4 })), r.line(X(0.36), Y(yy + 0.14), X(0.74 - row * 0.1), Y(yy + 0.15), o("lm" + row)));
      }
    } else {
      var bars = [0.28, 0.44, 0.38, 0.66, 0.88];
      bars.forEach(function (hgt, n) { shapes.push(r.rectangle(X(0.06 + n * 0.18), Y(0.88 - hgt * 0.74), R.w * 0.13, R.h * hgt * 0.74, n === 4 ? fill("bar" + n, brand) : fill("bar" + n, accent, { fillWeight: 2 }))); });
      shapes.push(r.line(X(0.02), Y(0.9), X(0.98), Y(0.9), o("base", { strokeWidth: 4 })), r.linearPath([[X(0.1), Y(0.5)], [X(0.34), Y(0.3)], [X(0.58), Y(0.38)], [X(0.86), Y(0.08)]], o("trend", { strokeWidth: 5 })), r.line(X(0.86), Y(0.08), X(0.74), Y(0.1), o("th1", { strokeWidth: 5 })), r.line(X(0.86), Y(0.08), X(0.84), Y(0.22), o("th2", { strokeWidth: 5 })));
    }
    shapes.forEach(function (p) { svg.appendChild(p); });
    var ps = inkPaths(svg, "currentColor", 3);
    // keep each stroke's own colour (fills and ink are set by rough), only the dash drawing is applied
    Array.prototype.forEach.call(svg.querySelectorAll("path"), function (p) { var st = p.getAttribute("stroke"); if (st && st !== "none") p.style.stroke = st; p.style.strokeWidth = p.getAttribute("stroke-width") + "px"; p.setAttribute("vector-effect", "non-scaling-stroke"); });
    var span = Math.min(1.5, 0.55 * dur), each = Math.max(0.12, span * 0.4), gap = ps.length > 1 ? (span - each) / (ps.length - 1) : 0;
    tl.fromTo(ps, { strokeDashoffset: function (n, el) { return el.__len; } }, { strokeDashoffset: 0, duration: each, ease: "power2.inOut", stagger: gap }, snap(s + 0.06));
  }

  // ---------- Vox editorial collage (look "vox-collage") ----------
  // The grammar of the reference: flat colour fields, halftone, cut-paper subjects with thick paper borders, tape and soft
  // shadows, marker annotations, and abstract data graphics. Everything is drawn from the brand's own colours; there are no
  // photographs, so the "archival cutouts" are cut-paper shapes. Positions are deterministic; the motion is snappy and ends
  // inside the beat, so a short beat simply moves faster.
  function voxCut(cam, x, y, w, h, rot, t, tape) {
    var bw = clamp(Math.min(w, h) * 0.05, 8, 16);
    var cut = free(mk("div", "vox-cut", cam, { position: "absolute", left: x, top: y, width: w, height: h, background: "var(--bp-card)", border: px(bw) + " solid var(--bp-card)", boxShadow: "0 " + px(bw * 1.2) + " " + px(bw * 3) + " rgba(0,0,0,.3)", borderRadius: px(bw * 0.35), overflow: "hidden" }));
    var wrap = free(mk("div", "vox-cut-wrap", cam, { position: "absolute", left: x, top: y, width: w, height: h }));
    wrap.appendChild(cut); cut.style.left = "0"; cut.style.top = "0";
    var inner = free(mk("div", "vox-inner", cut, { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }));
    if (tape) free(mk("div", "vox-tape", wrap, { position: "absolute", left: "34%", top: px(-bw * 1.5), width: "32%", height: px(bw * 2.6), background: "color-mix(in srgb, var(--bp-accent) 40%, #fff)", opacity: "0.82", transform: "rotate(" + (rot > 0 ? -5 : 5) + "deg)", boxShadow: "0 2px 6px rgba(0,0,0,.18)" }));
    tl.set(wrap, { rotation: rot, transformOrigin: "50% 50%" }, 0);
    hide(wrap); showAt(wrap, t);
    tl.fromTo(wrap, { scale: 0.55, y: h * 0.18 }, { scale: 1, y: 0, duration: 0.42, ease: "back.out(1.5)" }, snap(t));
    return { wrap: wrap, inner: inner, w: w - 2 * bw, h: h - 2 * bw };
  }
  function voxFigure(cam, b, i, s, e, flood) {
    var wide = MODE === "wide", u = Math.min(W, H), dur = e - s, key = "vox|" + b.id + "|" + i;
    var R = b.kind === "title" ? (wide ? { x: 0.04 * W, y: 0.58 * H, w: 0.2 * W, h: 0.34 * H } : { x: 0.06 * W, y: 0.74 * H, w: 0.3 * W, h: 0.2 * H }) : wide ? { x: 0.585 * W, y: 0.16 * H, w: 0.34 * W, h: 0.68 * H } : { x: 0.1 * W, y: 0.55 * H, w: 0.8 * W, h: 0.38 * H };
    var dots = free(mk("div", "vox-halftone", cam, { left: -0.1 * W, top: -0.1 * H, width: 1.2 * W, height: 1.2 * H, backgroundImage: "radial-gradient(var(--bp-shade) 28%, transparent 32%)", backgroundSize: px(u * 0.011) + " " + px(u * 0.011), opacity: flood ? "0.1" : "0.12", position: "absolute", pointerEvents: "none", WebkitMaskImage: "radial-gradient(ellipse at " + (wide ? "85% 60%" : "50% 85%") + ", #000 0%, transparent 70%)", maskImage: "radial-gradient(ellipse at " + (wide ? "85% 60%" : "50% 85%") + ", #000 0%, transparent 70%)" }));
    hide(dots); showAt(dots, s);
    var kind = pick(b, ["cutouts", "data", "scale"], i), step = clamp(dur * 0.1, 0.1, 0.22), t = s + 0.08;
    var ink = flood ? "var(--bp-card)" : "var(--bp-shade)";
    var mark = function (fn, at, span) {
      var sv = inkSvg(cam, { left: 0, top: 0, width: px(W), height: px(H) }, W, H), r = rough.svg(sv);
      fn(sv, r, function (n, x) { return Object.assign({ seed: seedOf(key + n), roughness: 1.4, bowing: 1.2, strokeWidth: 1 }, x || {}); });
      var ps = inkPaths(sv, ink, clamp(u * 0.009, 6, 12));
      inkDraw(ps, at, Math.min(span, Math.max(0.2, e - at - 0.1)));
    };
    if (kind === 0) {
      // two cut-paper subjects, one over the other, with a marker ring and arrow on the front one
      var a = voxCut(cam, R.x + R.w * 0.02, R.y + R.h * 0.06, R.w * 0.62, R.h * 0.56, 6, t, true);
      var c = voxCut(cam, R.x + R.w * 0.3, R.y + R.h * 0.34, R.w * 0.66, R.h * 0.6, -4, t + step, true);
      [a, c].forEach(function (cp, n) {
        var sv = inkSvg(cp.inner, { left: 0, top: 0, width: "100%", height: "100%" }, 200, 160), r = rough.svg(sv);
        sv.appendChild(n === 0 ? r.rectangle(30, 30, 140, 100, { seed: seedOf(key + "r"), fill: tok("--fg"), fillStyle: "solid", stroke: "none" }) : r.circle(100, 80, 118, { seed: seedOf(key + "c"), fill: tok("--brand"), fillStyle: "solid", stroke: "none", roughness: 1.8 }));
        sv.appendChild(r.line(24, 138, 176, 134, { seed: seedOf(key + "l" + n), stroke: tok("--fg"), strokeWidth: 3, roughness: 1.2 }));
        Array.prototype.forEach.call(sv.querySelectorAll("path"), function (p) { p.setAttribute("vector-effect", "non-scaling-stroke"); });
      });
      mark(function (sv, r, o) {
        sv.appendChild(r.ellipse(R.x + R.w * 0.62, R.y + R.h * 0.62, R.w * 0.74, R.h * 0.7, o("ring")));
        sv.appendChild(r.line(R.x + R.w * 0.02, R.y + R.h * 0.98, R.x + R.w * 0.2, R.y + R.h * 0.8, o("ar1")));
        sv.appendChild(r.line(R.x + R.w * 0.2, R.y + R.h * 0.8, R.x + R.w * 0.07, R.y + R.h * 0.81, o("ar2")));
        sv.appendChild(r.line(R.x + R.w * 0.2, R.y + R.h * 0.8, R.x + R.w * 0.17, R.y + R.h * 0.93, o("ar3")));
      }, t + 2 * step, Math.min(0.9, 0.5 * dur));
    } else if (kind === 1) {
      // a data card: bars growing, a marker line rising over them
      var d = voxCut(cam, R.x, R.y + R.h * 0.08, R.w, R.h * 0.78, -3, t, true), n = 5, bw = d.w * 0.12, gap = (d.w - n * bw) / (n + 1);
      free(mk("div", "vox-base", d.inner, { position: "absolute", left: px(gap * 0.5), top: px(d.h * 0.92), width: px(d.w - gap), height: px(Math.max(4, u * 0.006)), background: "var(--bp-on-card)" }));
      for (var k = 0; k < n; k++) {
        var hh = d.h * [0.26, 0.38, 0.34, 0.6, 0.82][k], bar = free(mk("div", "vox-bar", d.inner, { position: "absolute", left: px(gap + k * (bw + gap)), top: px(d.h * 0.92 - hh), width: px(bw), height: px(hh), background: k === n - 1 ? "var(--brand)" : "var(--bp-on-card)", transformOrigin: "50% 100%" }));
        hide(bar); showAt(bar, t + 0.18 + k * step * 0.7);
        tl.fromTo(bar, { scaleY: 0 }, { scaleY: 1, duration: clamp(dur * 0.16, 0.16, 0.36), ease: "back.out(1.3)" }, snap(t + 0.18 + k * step * 0.7));
      }
      mark(function (sv, r, o) {
        var x0 = R.x + R.w * 0.06, y0 = R.y + R.h * 0.62, x1 = R.x + R.w * 0.9, y1 = R.y + R.h * 0.1;
        sv.appendChild(r.linearPath([[x0, y0], [x0 + (x1 - x0) * 0.34, y0 - (y0 - y1) * 0.3], [x0 + (x1 - x0) * 0.58, y0 - (y0 - y1) * 0.22], [x1, y1]], o("trend")));
        sv.appendChild(r.line(x1, y1, x1 - R.w * 0.1, y1 + R.h * 0.02, o("h1")));
        sv.appendChild(r.line(x1, y1, x1 - R.w * 0.02, y1 + R.h * 0.1, o("h2")));
      }, t + 0.5, Math.min(0.9, 0.45 * dur));
    } else {
      // a scale comparison: one small block beside a tower that keeps growing
      var q = voxCut(cam, R.x + R.w * 0.04, R.y + R.h * 0.1, R.w * 0.92, R.h * 0.76, 3, t, true), bsz = q.w * 0.2, base = q.h * 0.9;
      var column = function (x, count, color) { for (var z = 0; z < count; z++) { var blk = free(mk("div", "vox-block", q.inner, { position: "absolute", left: px(x), top: px(base - (z + 1) * bsz * 0.98), width: px(bsz), height: px(bsz * 0.9), background: color, border: "3px solid var(--bp-on-card)", boxSizing: "border-box" })); hide(blk); showAt(blk, t + 0.2 + z * step * 0.8 + (count > 1 ? 0.2 : 0)); tl.fromTo(blk, { y: -q.h * 0.4 }, { y: 0, duration: 0.3, ease: "back.out(1.4)" }, snap(t + 0.2 + z * step * 0.8 + (count > 1 ? 0.2 : 0))); } };
      column(q.w * 0.14, 1, "var(--bp-on-card)");
      column(q.w * 0.6, 5, "var(--brand)");
      mark(function (sv, r, o) {
        sv.appendChild(r.line(R.x + R.w * 0.06, R.y + R.h * 0.02, R.x + R.w * 0.9, R.y + R.h * 0.01, o("top")));
        sv.appendChild(r.line(R.x + R.w * 0.9, R.y + R.h * 0.01, R.x + R.w * 0.86, R.y + R.h * 0.08, o("a2")));
      }, t + 0.6, Math.min(0.7, 0.35 * dur));
    }
  }

  // ---------- kinetic beat (also the 2D fallback for 3d / footage) ----------
  var lastFlood = false;
  function kinetic(i, b, sh, s, e, kwText, onScreen, successAt) {
    var L = LAY.kin, dur = e - s;
    var procedural = b.route && b.route.renderer === "canvas2d" && !b.has_visual;
    var inkSketch = SKETCH && !DOODLE && !VOX && !MATERIAL && !procedural && !b.has_visual;
    var flood = !inkSketch && !procedural && !b.has_visual && !MATERIAL && !DOODLE && !HAIRLINE && !lastFlood && (VOX ? i % 2 === 0 : (b.role === "hook" || b.role === "reveal" || b.success || b.energy === "high"));
    lastFlood = flood;
    if (flood) {
      sh.cam.classList.add("flood");
      var f = free(mk("div", "field", sh.beat, { left: -0.1 * W, top: -0.1 * H, width: 1.2 * W, height: 1.2 * H }));
      sh.beat.insertBefore(f, sh.seam);
      fieldCarrier(f, sh, i === 0, e, b.transition_out && b.transition_out.type === "brand-field-wipe");
      var hd = Math.max(W, H) * 0.7;
      var halo = free(mk("div", "halo", sh.cam, { left: (MODE === "wide" ? 0.82 * W : 0.7 * W) - hd / 2, top: 0.86 * H - hd / 2, width: hd, height: hd, borderWidth: px(Math.min(W, H) * 0.05) }));
      carry(halo, sh.vout, s, e, 1.4);
      f.setAttribute("data-bp", "flood");
      if (VOX) voxFigure(sh.cam, b, i, s, e, true);
    } else if (b.has_visual) { /* generated footage owns the scene */ }
    else if (procedural) canvasFigure(sh.cam, b, s, e);
    else if (inkSketch) sketchFigure(sh.cam, b, i, s, e);
    else if (VOX) voxFigure(sh.cam, b, i, s, e, flood);
    else if (DOODLE && window.rough) doodleFigure(sh.cam, b, i, s, e);
    else if (MATERIAL || DOODLE) styleFigure(sh.cam, b, s, e);
    else if (HAIRLINE) hairlineFigure(sh.cam, s, e, pick(b, ["plates", "cube", "bars", "rings"], i));
    else discs(sh.cam, i, sh.vout, s, e);
    var col = mk("div", "col" + (L.align === "center" ? " center" : ""), sh.cam, { left: L.col[0], top: L.col[1], width: L.col[2], height: L.col[3] });
    if ((procedural || HAIRLINE || MATERIAL || DOODLE) && MODE !== "wide") col.style.height = px(H * 0.48);
    var badge = null;
    var bs = 0.13 * Math.min(W, H);
    if (b.success) { badge = mk("div", "", col, { position: "relative", width: bs, height: bs, marginBottom: px(0.03 * H), flex: "none" }); }
    var words = kwText.split(/\s+/).filter(Boolean).length;
    var kf = kwFit(kwText, L.col[2], words >= 3 ? L.lines : Math.min(L.lines, 2), L.cap, 72), fs = kf.fs;
    var kw = keyword(col, kwText, kf, L.align, L.col[2]);
    // incoming text ignites on the cut frame (fields and shapes already overlap the J-cut); on a flood it
    // waits until its field has (mostly) covered the frame
    var tk = i === 0 ? s + 0.06 : flood && sh.vin.axis !== "z" ? Math.max(s, sh.t0 + 0.6 * P.dIn) : s;
    var landed = textEntry(kw, tk, effectFor(b, i));
    var sub = null;
    if (onScreen && !same(onScreen, kwText)) {
      var sfs = fit(onScreen, L.col[2] * 0.92, 3, L.sub, 30, KB);
      sub = mk("div", "sub", col, { fontSize: sfs, marginTop: px(fs * 0.32), maxWidth: px(L.col[2] * 0.92) }, onScreen);
      rise(sub, Math.min(landed + 0.12, s + 0.45 * dur), 28);
    }
    if (badge) {
      checkPop(badge, bs / 2, bs / 2, bs, successAt);
    } else if (dur >= 2.6) underline(kw, s + 0.56 * dur);
    var ox = L.align === "center" ? W / 2 : L.col[0] + L.col[2] * 0.3;
    push(sh.cam, s, e, ox, L.col[1] + L.col[3] / 2, b.energy, b.motion && b.motion.camera, b, i, sh);
    return { flood: flood };
  }

  // ---------- named text effects (the director picks one per beat: motion.text_effect; vocabulary after animate-text) ----------
  var TEXT_EFFECTS = ["waterfall", "per-character-rise", "typewriter", "stagger-from-center", "soft-blur-in", "spring-scale-in", "mask-reveal-up", "depth-parallax-words"];
  function splitChars(kw) {
    return kw.spans.map(function (w) {
      var node = null, i;
      for (i = 0; i < w.childNodes.length; i++) if (w.childNodes[i].nodeType === 3) { node = w.childNodes[i]; break; }
      if (!node) return [];
      var chars = String(node.textContent).split("").map(function (c) { var el = document.createElement("span"); el.className = "ch"; el.style.display = "inline-block"; el.textContent = c; w.insertBefore(el, node); return el; });
      w.removeChild(node);
      return chars;
    });
  }
  function textEntry(kw, t, effect) {
    if (TEXT_EFFECTS.indexOf(effect) < 1) return waterfall(kw, t);
    var spans = kw.spans, at = t, lift = clamp(kw.fs * 0.42, 40, 80), end = t;
    if (effect === "per-character-rise" || effect === "typewriter" || effect === "stagger-from-center") {
      var groups = splitChars(kw), flat = [];
      groups.forEach(function (g) { g.forEach(function (c) { flat.push(c); }); });
      spans.forEach(function (w) { hide(w); showAt(w, t); });
      var n = flat.length || 1, step = effect === "typewriter" ? Math.min(0.05, 0.9 / n) : Math.min(P.gap * 0.32, 1.0 / n);
      flat.forEach(function (c, k) {
        hide(c);
        var order = effect === "stagger-from-center" ? Math.abs(k - (n - 1) / 2) : k;
        var ct = at + order * step * (effect === "stagger-from-center" ? 1.5 : 1);
        showAt(c, ct);
        if (effect === "per-character-rise") tl.fromTo(c, { y: lift * 0.9 }, { y: 0, duration: P.wordD, ease: P.wordE }, snap(ct));
        else if (effect === "stagger-from-center") tl.fromTo(c, { scale: 0.3, y: lift * 0.25 }, { scale: 1, y: 0, duration: P.wordD, ease: P.popE }, snap(ct));
        end = Math.max(end, ct + (effect === "typewriter" ? 0.05 : P.wordD));
      });
      return end;
    }
    var gap = effect === "depth-parallax-words" ? 0.12 : effect === "spring-scale-in" ? 0.09 : effect === "soft-blur-in" ? 0.1 : 0.1;
    spans.forEach(function (w, j) {
      var last = j === spans.length - 1;
      hide(w); showAt(w, at);
      if (effect === "soft-blur-in") tl.fromTo(w, { y: 16, filter: "blur(14px)" }, { y: 0, filter: "blur(0px)", duration: 0.55, ease: "power2.out" }, snap(at));
      else if (effect === "spring-scale-in") tl.fromTo(w, { scale: 0.5, y: lift * 0.4 }, { scale: 1, y: 0, duration: P.wordD * 1.4, ease: "back.out(2.2)" }, snap(at));
      else if (effect === "mask-reveal-up") tl.fromTo(w, { y: lift * 1.1, clipPath: "inset(0 0 100% 0)" }, { y: 0, clipPath: "inset(-20% -10% -20% -10%)", duration: P.wordD * 1.2, ease: P.wordE }, snap(at));
      else tl.fromTo(w, { scale: 1.7, filter: "blur(12px)" }, { scale: 1, filter: "blur(0px)", duration: 0.6, ease: "expo.out" }, snap(at));
      end = Math.max(end, at + 0.6);
      at += gap * (last ? 1 : 1);
    });
    return end;
  }

  // ---------- UI beat: the real screen as a card on a brand field; the oversized cursor performs the action ----------
  function targetPoint(ui) {
    var t = String(ui.target || "").toLowerCase();
    var p = { click: [0.62, 0.58], type: [0.42, 0.3], toggle: [0.78, 0.36], count: [0.5, 0.42], scroll: [0.88, 0.48], drag: [0.28, 0.56], select: [0.46, 0.5], send: [0.8, 0.8] }[ui.action] || [0.6, 0.56];
    if (/button|cta|render|export|publish|submit|save|apply|approve|share|send|download|checkout|buy/.test(t)) p = [0.8, 0.82];
    else if (/search|input|field|box|prompt|editor|message|comment/.test(t)) p = [0.42, 0.3];
    else if (/nav|sidebar|menu|tab/.test(t)) p = [0.14, 0.38];
    else if (/timeline|track|frame|clip|scrub/.test(t)) p = [0.5, 0.8];
    else if (/chart|graph|metric|number|stat|total|revenue|count/.test(t)) p = [0.62, 0.4];
    else if (/header|title|top/.test(t)) p = [0.42, 0.14];
    if (ui.action === "scroll") p = [0.9, 0.42];
    return p;
  }
  var HAS_UI = false;
  function uiBeat(i, b, sh, s, e, kwText, onScreen, src, actAt, successAt) {
    var L = LAY.ui, dur = e - s, ui = b.ui;
    // brand field behind the card
    var fld = free(mk("div", "field panel", sh.cam, { left: L.field[0], top: L.field[1], width: L.field[2], height: L.field[3] }));
    if (b.has_visual) fld.style.display = "none";
    else carry(fld, sh.vout, s + 0.3, e, 0.8);
    // key phrase in its corner, never over the screen
    var col = mk("div", "col" + (L.top ? " top" : ""), sh.cam, { left: L.col[0], top: L.col[1], width: L.col[2], height: L.col[3] });
    var words = kwText.split(/\s+/).filter(Boolean).length;
    var kf = kwFit(kwText, L.col[2], words >= 3 ? L.lines : Math.min(L.lines, 2), L.cap, 64), fs = kf.fs;
    var kw = keyword(col, kwText, kf, "left", L.col[2]);
    var landed = waterfall(kw, i === 0 ? s + 0.1 : s);
    var typesSub = ui.action === "type" && onScreen && onScreen.length <= 32;
    if (onScreen && !same(onScreen, kwText) && !typesSub) {
      var sub = mk("div", "sub", col, { fontSize: fit(onScreen, L.col[2], 3, L.sub, 30, KB), marginTop: px(fs * 0.3) }, onScreen);
      rise(sub, Math.min(landed + 0.1, s + 0.8), 24);
    }
    // the card (aspect from the screenshot, clamped)
    // the card: the screenshot's own shape (clamped); on 9:16 a taller card that crops around the action
    var ar = clamp(+ui.aspect || 1.6, 0.5, 2.4), cardAr = MODE === "tall" ? Math.min(ar, 1.2) : clamp(ar, 1.25, 2.0);
    var cwid = L.card[2], chei = cwid / cardAr;
    var maxH = MODE === "wide" ? 0.7 * H : MODE === "tall" ? 0.44 * H : 0.46 * H;
    if (chei > maxH) { chei = maxH; cwid = chei * cardAr; }
    var cx = L.card[0] - cwid / 2, cy = L.card[1] - chei / 2;
    if (HAIRLINE) {
      fld.style.borderRadius = "0";
      [2, 1].forEach(function (depth) {
        var plate = mk("div", "hairline-screen-layer", sh.cam, { position: "absolute", left: cx, top: cy, width: cwid, height: chei, border: "2px solid var(--bp-accent)", borderRadius: "12px" });
        var shift = 14 * depth;
        tl.fromTo(plate, { x: 0, y: 0 }, { x: shift, y: shift, duration: Math.min(0.65, dur * 0.2), ease: "sine.inOut" }, snap(s));
        tl.fromTo(plate, { x: shift, y: shift }, { x: 0, y: 0, duration: Math.min(0.6, dur * 0.2), ease: "sine.inOut" }, snap(e - Math.min(0.8, dur * 0.3)));
      });
    }
    var card = free(mk("div", "card", sh.cam, { left: cx, top: cy, width: cwid, height: chei }));
    if (VOX) {
      // cut-paper print: a thick paper border, a strip of tape, a slight tilt and a soft shadow, over a halftone field
      var pb = clamp(Math.min(cwid, chei) * 0.035, 8, 16);
      Object.assign(card.style, { border: px(pb) + " solid var(--bp-card)", borderRadius: px(pb * 0.35), boxShadow: "0 " + px(pb * 1.4) + " " + px(pb * 3.4) + " rgba(0,0,0,.34)" });
      tl.set(card, { rotation: i % 2 ? 1.4 : -1.6, transformOrigin: "50% 50%" }, 0);
      free(mk("div", "vox-tape", card, { position: "absolute", left: "36%", top: px(-pb * 2.2), width: "28%", height: px(pb * 2.6), background: "color-mix(in srgb, var(--bp-accent) 40%, #fff)", opacity: "0.85", transform: "rotate(-4deg)", zIndex: 3 }));
      var ht = free(mk("div", "vox-halftone", sh.cam, { position: "absolute", left: -0.1 * W, top: -0.1 * H, width: 1.2 * W, height: 1.2 * H, backgroundImage: "radial-gradient(var(--bp-shade) 28%, transparent 32%)", backgroundSize: px(Math.min(W, H) * 0.011) + " " + px(Math.min(W, H) * 0.011), opacity: "0.12", pointerEvents: "none" }));
      sh.cam.insertBefore(ht, card);
    } else if (SKETCH && !DOODLE && !MATERIAL) {
      // notebook page with the screen drawn onto it: a hand-inked window frame goes round the screenshot as it lands
      fld.style.display = "none";
      var page = free(mk("div", "sk-paper", sh.cam, { left: -0.1 * W, top: -0.1 * H, width: 1.2 * W, height: 1.2 * H }));
      sh.cam.insertBefore(page, card); hide(page); showAt(page, s);
      var fsv = inkSvg(sh.cam, { left: px(cx - 22), top: px(cy - 22), width: px(cwid + 44), height: px(chei + 44) }, cwid + 44, chei + 44), fr = rough.svg(fsv), fo = function (n, x) { return Object.assign({ seed: seedOf("uf|" + b.id + n), roughness: 1.5, bowing: 1.3, strokeWidth: 1 }, x || {}); };
      fsv.appendChild(fr.rectangle(8, 8, cwid + 28, chei + 28, fo("f")));
      fsv.appendChild(fr.line(8, 40, cwid + 36, 38, fo("t")));
      [0, 1, 2].forEach(function (n) { fsv.appendChild(fr.circle(36 + n * 26, 24, 12, fo("d" + n))); });
      var fps = inkPaths(fsv, "currentColor", clamp(Math.min(W, H) * 0.0055, 3, 7)), span = Math.min(1.3, 0.4 * dur);
      tl.fromTo(fps, { strokeDashoffset: function (n, el) { return el.__len; } }, { strokeDashoffset: 0, duration: Math.max(0.2, span * 0.5), ease: "power2.inOut", stagger: (span * 0.5) / Math.max(1, fps.length - 1) }, snap(s + 0.05));
      sh.cam.insertBefore(fsv, card);
    }
    var shot = mk("div", "shot", card);
    var img = mk("img", null, shot);
    img.src = src; img.alt = "";
    // the card trails the field into the frame (depth); z entries arrive composed
    if (sh.vin.axis !== "z") {
      var tr = {}; tr[sh.vin.axis] = -sh.vin.dir * (sh.vin.axis === "x" ? LAY.DX : LAY.DY) * 0.5;
      var tz = {}; tz[sh.vin.axis] = 0;
      tl.fromTo(card, tr, Object.assign({ duration: P.dIn + 0.12, ease: P.inE }, tz), snap(sh.t0));
    }
    var iw = cwid - 20, ih = chei - 20; // inner (screenshot) box, card-local origin at (10,10)
    // the screenshot covers the inner box (taller for a scroll) and is cropped so the target stays in view
    var imgW = ar >= iw / ih ? ih * ar : iw, imgH = imgW / ar;
    if (ui.action === "scroll" && imgH < 1.5 * ih) { imgW *= 1.5 * ih / imgH; imgH = 1.5 * ih; }
    var tp = targetPoint(ui);
    var ox = clamp(tp[0] * imgW - iw / 2, 0, imgW - iw), oy = ui.action === "scroll" ? 0 : clamp(tp[1] * imgH - ih / 2, 0, imgH - ih);
    Object.assign(img.style, { left: px(-ox), top: px(-oy), width: px(imgW), height: px(imgH) });
    var tx = 10 + tp[0] * imgW - ox, ty = 10 + tp[1] * imgH - oy;
    var gx = cx + tx, gy = cy + ty; // screen position of the target (the camera pushes about it, so it holds)
    push(sh.cam, s, e, gx, gy, b.energy, b.motion && b.motion.camera, b, i, sh);
    // cursor: enters from below on one vector, lands its tip on the target, presses on the verb
    HAS_UI = true;
    var CZ = LAY.cursor, TX = 0.208 * CZ, TY = 0.125 * CZ;
    var cur = free(mk("div", "cursor", sh.seam, { width: CZ, height: CZ }));
    cur.innerHTML = ARROW;
    var pos = { x: gx - TX + 0.04 * W, y: H + 0.04 * H };
    tl.set(cur, { x: pos.x, y: pos.y, scale: 1, transformOrigin: "21% 13%" }, 0);
    function go(x, y, t0, d, ease) { tl.fromTo(cur, { x: pos.x, y: pos.y }, { x: x - TX, y: y - TY, duration: d, ease: ease || "power2.inOut" }, snap(t0)); pos = { x: x - TX, y: y - TY }; }
    function press(t, hold) {
      tl.fromTo(cur, { scale: 1 }, { scale: 0.84, duration: 0.1, ease: "power2.in" }, snap(t));
      tl.fromTo(cur, { scale: 0.84 }, { scale: 1, duration: 0.22, ease: "power2.out" }, snap(t + 0.1 + (hold || 0)));
    }
    function cardPress(t) {
      tl.fromTo(card, { scale: 1 }, { scale: 0.985, duration: 0.08, ease: "power2.in" }, snap(t));
      tl.fromTo(card, { scale: 0.985 }, { scale: 1, duration: 0.22, ease: "power2.out" }, snap(t + 0.08));
    }
    var act = ui.action, tv = actAt;
    var aim = act === "select" ? [tx - 0.14 * iw, ty - 0.09 * ih] : [tx, ty];
    var arrive = tv - 0.1, travel = clamp(arrive - (s + 0.16), 0.45, 0.9);
    go(cx + aim[0], cy + aim[1], arrive - travel, travel, P.travelE === "expo.out" ? "expo.out" : "power3.out");
    // Sketch look: a hand-drawn ring lands around the target as the cursor arrives (in camera space, so it
    // moves with the card and is never clipped by it)
    if (SKETCH && act !== "type" && act !== "scroll") sketchRing(sh.cam, cx + aim[0], cy + aim[1], clamp(0.24 * iw, 150, 420), clamp(0.18 * ih, 96, 240), b.id, tv - 0.05);
    var done = tv + 0.3, sz = Math.min(W, H);
    if (act === "type") {
      var str = onScreen && onScreen.length <= 32 ? onScreen : kwText;
      var tfs = MODE === "wide" ? 34 : 36, bw = clamp(str.length * tfs * KB + 90, 0.42 * iw, 0.86 * iw), bh = tfs * 2.1;
      var bx = clamp(tx - 0.16 * bw, 18, cwid - bw - 18);
      var box = free(mk("div", "fieldbox", card, { left: bx, top: ty - bh / 2, width: bw, height: bh }));
      var wrap = mk("div", "type-wrap", box, { lineHeight: px(bh - 8) });
      mk("span", "type-txt", wrap, { fontSize: tfs }, str).setAttribute("data-layout-allow-occlusion", ""); // revealed by the cover
      // typing: a card-coloured cover slides off the text (transform only); the caret rides its leading edge
      var cover = mk("div", "type-cover", box, { left: 22, width: bw });
      mk("i", "caret", cover, { left: 0 });
      pop(box, tv, 0.92);
      var td = clamp(str.length / 22, 0.5, 1.4), reach = Math.min(bw - 40, str.length * tfs * KB + 8);
      tl.fromTo(cover, { x: 0 }, { x: reach, duration: td, ease: "none" }, snap(tv + 0.12));
      press(tv); done = tv + 0.12 + td;
      var tk = free(mk("div", "check", card, { left: bx + bw - bh * 0.42, top: ty - bh * 0.62, width: bh * 0.5, height: bh * 0.5 })); tk.innerHTML = CHECK;
      pop(tk, done + 0.05, 0.4); done += 0.2;
    } else if (act === "toggle") {
      var tw = clamp(0.11 * iw, 96, 150), th = tw * 0.54;
      var holder = free(mk("div", "chipbox", card, { left: tx - tw / 2 - 14, top: ty - th / 2 - 14, width: tw + 28, height: th + 28 }));
      var off = mk("i", "track off", holder, { left: "14px", top: "14px", width: px(tw), height: px(th) });
      var on = mk("i", "track on", holder, { left: "14px", top: "14px", width: px(tw), height: px(th) });
      var knob = mk("i", "knob", holder, { left: px(14 + th * 0.1), top: px(14 + th * 0.1), width: px(th * 0.8), height: px(th * 0.8) });
      pop(holder, arrive - travel + 0.1, 0.8);
      tl.set(on, { opacity: 0 }, 0);
      tl.fromTo(on, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, snap(tv));
      tl.fromTo(knob, { x: 0 }, { x: tw - th, duration: P.popD * 0.8, ease: P.popE }, snap(tv));
      press(tv); cardPress(tv); done = tv + 0.35;
    } else if (act === "count") {
      var src2 = [onScreen, kwText, b.line].join(" ");
      var m = /(\d[\d,]*(?:\.\d+)?)/.exec(src2);
      var sw = clamp(0.34 * iw, 260, 520), shh = sw * 0.42;
      var stat = free(mk("div", "chipbox", card, { left: clamp(tx - sw / 2, 18, cwid - sw - 18), top: ty - shh / 2, width: sw, height: shh }));
      pop(stat, tv, 0.85);
      if (m) {
        var raw = m[1], target = parseFloat(raw.replace(/,/g, "")), dec = (raw.split(".")[1] || "").length, comma = raw.indexOf(",") >= 0;
        var fmt = function (v) { var s2 = v.toFixed(dec); if (comma) s2 = s2.replace(/\B(?=(\d{3})+(?!\d))/g, ","); return s2; };
        var num = mk("div", "stat", stat, { left: 0, top: 0, width: "100%", height: "100%", fontSize: px(shh * 0.56) }, fmt(0));
        var o = { v: 0 };
        tl.fromTo(o, { v: 0 }, { v: target, duration: 0.85, ease: "power2.out", onUpdate: function () { num.textContent = fmt(o.v); } }, snap(tv + 0.05));
        tl.fromTo(num, { scale: 1 }, { scale: 1.08, duration: 0.12, ease: "power2.out" }, snap(tv + 0.9));
        tl.fromTo(num, { scale: 1.08 }, { scale: 1, duration: 0.3, ease: P.popE }, snap(tv + 1.02));
      } else {
        var bar = mk("div", "bar", stat, { left: "10%", top: "42%", width: "80%", height: "16%" });
        var fill = mk("i", null, bar);
        tl.set(fill, { scaleX: 0 }, 0);
        tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: 0.85, ease: "power2.inOut" }, snap(tv + 0.05));
      }
      press(tv); done = tv + 0.9;
    } else if (act === "scroll") {
      var thumb = free(mk("i", "thumb", card, { left: cwid - 26, top: 0.12 * chei, height: 0.22 * chei }));
      pop(thumb, arrive - 0.2, 0.6);
      press(tv, 0.85);
      tl.fromTo(img, { y: 0 }, { y: -0.3 * ih, duration: 0.95, ease: "power2.inOut" }, snap(tv + 0.05));
      tl.fromTo(thumb, { y: 0 }, { y: 0.5 * chei, duration: 0.95, ease: "power2.inOut" }, snap(tv + 0.05));
      go(gx, gy + 0.5 * chei * 0.5, tv + 0.05, 0.95, "power2.inOut");
      done = tv + 1.0;
    } else if (act === "drag") {
      var dw = clamp(0.15 * iw, 110, 190), dh = dw * 0.62;
      var to2 = [clamp(tx + 0.32 * iw, dw, iw - dw * 0.4), clamp(ty - 0.16 * ih, dh, ih - dh * 0.4)];
      var drop = free(mk("div", "drop", card, { left: to2[0] - dw / 2 - 10, top: to2[1] - dh / 2 - 10, width: dw + 20, height: dh + 20 }));
      var chip = free(mk("div", "drag", card, { left: tx - dw / 2, top: ty - dh / 2, width: dw, height: dh }));
      chip.innerHTML = GRIP;
      pop(drop, arrive - travel + 0.05, 0.9);
      pop(chip, arrive - travel + 0.15, 0.6);
      press(tv, 0.7);
      tl.fromTo(chip, { scale: 1 }, { scale: 1.08, duration: 0.12, ease: "power2.out" }, snap(tv));
      tl.fromTo(chip, { x: 0, y: 0 }, { x: to2[0] - tx, y: to2[1] - ty, duration: 0.65, ease: "power2.inOut" }, snap(tv + 0.1));
      go(cx + to2[0], cy + to2[1], tv + 0.1, 0.65, "power2.inOut");
      tl.fromTo(chip, { scale: 1.08 }, { scale: 1, duration: 0.3, ease: P.popE }, snap(tv + 0.8));
      done = tv + 0.85;
    } else if (act === "select") {
      var mw = 0.28 * iw, mh = 0.18 * ih;
      var mq = free(mk("div", "marquee", card, { left: aim[0], top: aim[1], width: mw, height: mh }));
      hide(mq); showAt(mq, tv);
      tl.fromTo(mq, { scaleX: 0.04, scaleY: 0.04 }, { scaleX: 1, scaleY: 1, duration: 0.45, ease: "power2.inOut" }, snap(tv + 0.05));
      press(tv, 0.4);
      go(cx + aim[0] + mw, cy + aim[1] + mh, tv + 0.05, 0.45, "power2.inOut");
      var sk = free(mk("div", "check", card, { left: aim[0] + mw - 30, top: aim[1] - 30, width: 60, height: 60 })); sk.innerHTML = CHECK;
      pop(sk, tv + 0.55, 0.4);
      done = tv + 0.6;
    } else { // click, send
      var rw = clamp(0.24 * iw, 140, 320), rh = clamp(0.13 * ih, 70, 130);
      var ring = free(mk("div", "ring", card, { left: tx - rw / 2, top: ty - rh / 2, width: rw, height: rh }));
      pop(ring, tv, 1.15);
      var rip = free(mk("div", "ripple", card, { left: tx - 55, top: ty - 55, width: 110, height: 110 }));
      tl.set(rip, { opacity: 0 }, 0);
      tl.fromTo(rip, { scale: 0.3, opacity: 0.9 }, { scale: 2.3, opacity: 0, duration: 0.6, ease: "power2.out" }, snap(tv));
      if (act === "send") {
        var dot = free(mk("div", "dot", card, { left: tx - 18, top: ty - 18, width: 36, height: 36 }));
        tl.set(dot, { opacity: 0 }, 0);
        tl.fromTo(dot, { x: 0, y: 0, opacity: 1 }, { x: 0.3 * iw, y: -0.4 * ih, opacity: 0, duration: 0.5, ease: "power2.in" }, snap(tv + 0.05));
      }
      press(tv); cardPress(tv); done = tv + 0.3;
    }
    if (b.success) checkPop(sh.cam, cx + cwid - 0.04 * sz, cy + 0.02 * sz, 0.11 * sz, Math.max(successAt, done + 0.3));
    // after the result the cursor drifts off it (never parked on it, never wobbling); the seam carries it out
    var dt = Math.max(done, b.success ? Math.max(successAt, done + 0.3) + 0.2 : done) + 0.1;
    if (dt + 0.6 <= e - P.dOut) go(gx + 0.07 * W, gy + (gy > H * 0.55 ? -0.08 : 0.1) * H, dt, 0.6, "power2.out");
    return { act: act, actAt: tv, target: [Math.round(gx), Math.round(gy)], done: done };
  }

  // ---------- title / CTA lockup: a landed ending that keeps moving to the last frame ----------
  function titleBeat(i, b, sh, s, e, kwText, onScreen) {
    var L = LAY.title;
    if (VOX) voxFigure(sh.cam, b, i, s, e, false); else if (DOODLE && window.rough) doodleFigure(sh.cam, b, i, s, e); else if (SKETCH && !DOODLE && !MATERIAL) sketchFigure(sh.cam, b, i, s, e); else discs(sh.cam, 0, { axis: "z", dir: 1 }, s, e, LAY.titleDiscs);
    var col = mk("div", "col center", sh.cam, { left: 0.08 * W, top: 0, width: 0.84 * W, height: H });
    var lock = mk("div", "lockup", col);
    var logo = typeof V.logo === "string" && V.logo ? V.logo : "";
    var name = String(V.brandName || "").trim();
    if (logo) {
      var im = mk("img", null, lock, { maxHeight: px(L.logoH), maxWidth: px(V.logoWordmark ? L.logoW : L.logoH * 1.4) });
      im.src = logo; im.alt = "";
    }
    var nfs = 0;
    if (name && !(logo && V.logoWordmark)) {
      nfs = fit(name, logo ? L.logoW : 0.84 * W, 1, logo ? L.name * 0.7 : L.name, 64);
      mk("div", "name", lock, { fontSize: nfs }, name);
    }
    if (MODE !== "wide" && logo && !V.logoWordmark) lock.style.flexDirection = "column";
    var pillText = onScreen || kwText, phrase = onScreen && !same(kwText, name) ? kwText : ""; // never print the brand name twice
    var kw = null;
    if (phrase) kw = keyword(col, phrase, kwFit(phrase, L.kwW, 2, L.kw, 64), "center", L.kwW);
    if (kw) kw.el.style.marginTop = px(0.045 * H);
    var pf = L.pill, pw = Math.min(0.84 * W, pillText.length * pf * KB + pf * 2.4);
    var pill = mk("div", "pill", col, { fontSize: pf, padding: px(pf * 0.55) + " " + px(pf * 1.2), marginTop: px(0.05 * H), maxWidth: px(0.84 * W) }, pillText);
    // arrivals: lockup, key phrase, pill; then the camera keeps pushing to the last frame
    var tl0 = i === 0 ? s + 0.08 : s;
    hide(lock); showAt(lock, tl0);
    tl.fromTo(lock, { scale: 1.18 }, { scale: 1, duration: P.dIn + 0.1, ease: P.inE }, snap(tl0));
    var landed = kw ? textEntry(kw, tl0 + 0.24, effectFor(b, i)) : tl0 + 0.24;
    rise(pill, Math.min(landed + 0.05, s + 0.9), 36);
    // the pill's centre, from the stacked heights (character-count estimates, never measured)
    var lockH = logo ? (V.logoWordmark ? Math.min(L.logoH, L.logoW / 3) : L.logoH) : (nfs || 0);
    if (MODE !== "wide" && logo && !V.logoWordmark && name) lockH += 28 + (nfs || 0);
    var kwH = kw ? kw.fs * 1.04 * kw.lines + 0.045 * H : 0;
    var pillH = pf * 1.25 + pf * 1.1, stackH = lockH + kwH + 0.05 * H + pillH;
    var pillY = H / 2 + stackH / 2 - pillH / 2;
    push(sh.cam, s, e, W / 2, H / 2, b.energy || "medium", b.motion && b.motion.camera, b, i, sh);
    var pressAt = null;
    if (HAS_UI && e - s >= 2.2) {
      var CZ = LAY.cursor, TX = 0.208 * CZ, TY = 0.125 * CZ, cur = free(mk("div", "cursor", sh.seam, { width: CZ, height: CZ }));
      cur.innerHTML = ARROW;
      var aimx = W / 2 + Math.min(pw * 0.32, 0.25 * W), aimy = pillY;
      pressAt = snap(Math.min(e - 0.9, Math.max(s + 1.3, b.vo ? b.vo.start + 0.4 : s + 1.3)));
      tl.set(cur, { x: aimx - TX + 0.05 * W, y: H + 0.04 * H, scale: 1, transformOrigin: "21% 13%" }, 0);
      tl.fromTo(cur, { x: aimx - TX + 0.05 * W, y: H + 0.04 * H }, { x: aimx - TX, y: aimy - TY, duration: 0.7, ease: "power3.out" }, snap(pressAt - 0.8));
      tl.fromTo(cur, { scale: 1 }, { scale: 0.84, duration: 0.1, ease: "power2.in" }, snap(pressAt));
      tl.fromTo(cur, { scale: 0.84 }, { scale: 1, duration: 0.22, ease: "power2.out" }, snap(pressAt + 0.1));
      tl.fromTo(pill, { scale: 1 }, { scale: 0.94, duration: 0.08, ease: "power2.in" }, snap(pressAt));
      tl.fromTo(pill, { scale: 0.94 }, { scale: 1, duration: 0.3, ease: P.popE }, snap(pressAt + 0.08));
      // exit law: after the press the cursor leaves by the nearest edge (never parked on the ending)
      tl.fromTo(cur, { x: aimx - TX, y: aimy - TY }, { x: aimx - TX + 0.16 * W, y: H + 0.06 * H, duration: 0.6, ease: "power2.in" }, snap(pressAt + 0.4));
    }
    return { pressAt: pressAt };
  }

  // ---------- captions (full): the line as a lower-third overlay, chunked, timed to the voiceover ----------
  function captions(b, line, s, e) {
    var vo = b.vo && typeof b.vo.start === "number" ? b.vo : { start: s + 0.15, end: e - 0.1 };
    var words = line.split(/\s+/).filter(Boolean);
    if (!words.length) return;
    var n = Math.ceil(words.length / LAY.capWords), per = Math.ceil(words.length / n), chunks = [];
    for (var c = 0; c < words.length; c += per) chunks.push(words.slice(c, c + per).join(" "));
    // the voiced take's transcript times each chunk to the real read (an edited line falls back to the estimate)
    var heard = Array.isArray(b.words) && b.words.length === words.length && b.words.map(function (w) { return w.text; }).join(" ") === words.join(" ") ? b.words : null;
    if (heard) {
      chunks.forEach(function (ch, j) {
        var w0 = heard[j * per], wn = heard[Math.min(heard.length, (j + 1) * per) - 1], next = heard[(j + 1) * per];
        var el = free(mk("div", "cap", capLayer, { bottom: LAY.capBottom }));
        mk("span", null, el, { fontSize: LAY.capFs }, ch);
        hide(el); showAt(el, w0.start - 0.04);
        tl.fromTo(el, { y: 12 }, { y: 0, duration: 0.14, ease: "power2.out" }, snap(w0.start - 0.04));
        tl.set(el, { autoAlpha: 0 }, snap(next ? next.start - 0.04 : Math.min(wn.end + 0.2, e + 0.25)));
      });
      return;
    }
    var total = chunks.reduce(function (a, ch) { return a + ch.length; }, 0), at = vo.start, span = Math.max(0.6, vo.end - vo.start);
    chunks.forEach(function (ch, j) {
      var d = span * ch.length / total;
      var el = free(mk("div", "cap", capLayer, { bottom: LAY.capBottom }));
      mk("span", null, el, { fontSize: LAY.capFs }, ch);
      hide(el); showAt(el, at);
      tl.fromTo(el, { y: 12 }, { y: 0, duration: 0.14, ease: "power2.out" }, snap(at));
      tl.set(el, { autoAlpha: 0 }, snap(j === chunks.length - 1 ? Math.min(at + d + 0.2, e + 0.25) : at + d));
      at += d;
    });
  }

  // ---------- build ----------
  if (!BEATS.length) LOG.warnings.push("the plan has no beats");
  var TOTAL = 0, WIPED = [];
  BEATS.forEach(function (b, i) {
    var s = +b.start || 0, e = +b.end || s + 2, last = i === BEATS.length - 1;
    TOTAL = Math.max(TOTAL, e);
    b.has_visual = Boolean(V["visual." + b.id]);
    var media = document.getElementById("visual-" + b.id);
    if (media) { tl.set(media, { visibility: "visible" }, s); tl.set(media, { visibility: "hidden" }, e); }
    var kind = b.kind, kwText = text(b, "keyword"), onScreen = text(b, "on_screen") || null, line = text(b, "line") || null;
    if (kind === "3d" || kind === "footage") {
      // 2D fallback until the generated clip exists; a storyboard edit to the keyword still wins
      var fb = b.fallback || {};
      var edited = has(b.id + ".keyword") && V[b.id + ".keyword"] !== b.keyword;
      if (!b.has_visual && !edited && fb.keyword) kwText = String(fb.keyword);
      kind = fb.kind === "ui" && b.ui ? "ui" : "kinetic";
    }
    var src = kind === "ui" && b.ui ? V["shot." + b.ui.screen] : null;
    if (last && b.role === "cta" && kind === "kinetic") kind = "title"; // the closing CTA always lands as the brand lockup
    if (kind === "ui" && !src) { LOG.warnings.push(b.id + ": no screenshot for " + (b.ui ? b.ui.screen : "?") + "; rendered as kinetic"); kind = "kinetic"; }
    if (kind === "title" && !last) LOG.warnings.push(b.id + ": a title beat that is not last still exits on its vector");
    if (!kwText) kwText = onScreen || String(V.brandName || "");
    var sh = shell(i, b, s, e, last);
    sceneStyle(b.route ? b.route.treatment : V.look, sh.beat);
    sh.beat.setAttribute("data-renderer", b.route ? b.route.renderer : "legacy");
    // the kit's logo mark (or silhouette), small in a corner of every content scene (top-left on wide, bottom-left on vertical and square canvases, where the headline starts at the top); the closing lockup carries the full logo
    var bugSrc = typeof V.logoBug === "string" && V.logoBug ? V.logoBug : "";
    if (bugSrc && kind !== "title") {
      var bugImg = free(mk("img", "logo-bug", sh.beat, { left: px(0.045 * W), top: px((MODE === "wide" ? 0.06 : 0.86) * H), height: px(0.085 * Math.min(W, H)), maxWidth: px(0.22 * W) }));
      bugImg.src = bugSrc; bugImg.alt = "";
      bugImg.setAttribute("data-layout-allow-occlusion", "");
    }
    if (b.has_visual) sh.beat.classList.add("has-material-video");
    var dur = e - s;
    var successAt = b.success ? (typeof b.success_at === "number" ? b.success_at : s + Math.max(0.9, 0.5 * dur)) : null;
    var actAt = typeof b.act_at === "number" ? b.act_at : s + Math.max(0.9, 0.38 * dur);
    var info = { id: b.id, kind: kind, start: s, end: e, route: b.route || null };
    if (kind === "ui") Object.assign(info, uiBeat(i, b, sh, s, e, kwText, onScreen, src, actAt, successAt || 0));
    else if (kind === "title" && TYPE) Object.assign(info, typeBeat(i, b, sh, s, e, kwText, onScreen, true));
    else if (kind === "title") Object.assign(info, titleBeat(i, b, sh, s, e, kwText, onScreen));
    else if (TYPE && !b.has_visual) Object.assign(info, typeBeat(i, b, sh, s, e, kwText, onScreen, false));
    else Object.assign(info, kinetic(i, b, sh, s, e, kwText, onScreen, successAt));
    if (kind !== "kinetic") lastFlood = false;
    if (successAt !== null) info.successAt = successAt;
    if (!last && b.transition_out && b.transition_out.type === "brand-field-wipe") { wipe(sh.vout, e); info.wipe = true; WIPED.push(i, i + 1); }
    if (PLAN.captions === "full" && line) captions(b, line, s, e);
    LOG.beats.push(info);
  });
  // text either side of a brand-field wipe is covered by the wipe on purpose (it is the carrier)
  WIPED.forEach(function (k) {
    var el = stage.children[k];
    if (el) Array.prototype.forEach.call(el.querySelectorAll(".w, .sub, .name, .pill, .type-txt, .stat"), function (t) { t.setAttribute("data-layout-allow-occlusion", ""); });
  });
  LOG.total = TOTAL;
  tl.set({}, {}, snap(TOTAL));
  tl.eventCallback("onUpdate", function(){var t=tl.time();CANVAS_LAYERS.forEach(function(draw){draw(t);});});
  CANVAS_LAYERS.forEach(function(draw){draw(0);});
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
})();
