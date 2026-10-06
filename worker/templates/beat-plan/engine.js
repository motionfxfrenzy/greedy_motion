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
  var LOG = window.__bp = { beats: [], warnings: [] };

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
  var CARD = ["--surface", "--bg", "--fg"].reduce(function (a, n) { return lum(n) > lum(a) ? n : a; }, "--surface");
  var SHADE = ["--fg", "--bg"].reduce(function (a, n) { return lum(n) < lum(a) ? n : a; }, "--fg");
  var INK = {
    "--bp-on-brand": ON_BRAND,
    "--bp-accent": firstOk(["--accent", "--brand"], "--bg", 3) || best(["--fg", "--accent"], "--bg"),
    "--bp-accent-on-brand": (tok("--accent") !== tok("--brand") && firstOk(["--accent", "--accent-2"], "--brand", 3)) || ON_BRAND,
    "--bp-muted": firstOk(["--muted"], "--bg", 4.5) || "--fg",
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
    var ul = null;
    if (spans.length) { ul = mk("i", "ul", spans[spans.length - 1]); tl.set(ul, { scaleX: 0 }, 0); }
    return { el: el, spans: spans, ul: ul, fs: fs, lines: lines };
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
  function underline(kw, t) { if (kw.ul) tl.fromTo(kw.ul, { scaleX: 0 }, { scaleX: 1, duration: 0.42, ease: "power3.out" }, snap(t)); }
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
    var t0 = i === 0 ? s : s - OV;
    hide(beat); showAt(beat, t0);
    if (!last) tl.set(beat, { autoAlpha: 0 }, snap(e)); // text is never co-visible across a cut (one side per frame)
    var mo = b.motion || {};
    var vin = vec(mo.entry, { axis: "x", dir: -1 }), vout = vec(mo.exit, { axis: "x", dir: -1 });
    seamIn(seam, vin, t0, i === 0);
    if (!last) seamOut(seam, vout, e);
    return { beat: beat, seam: seam, cam: cam, vin: vin, vout: vout, t0: t0, last: last };
  }
  function push(cam, s, e, ox, oy, energy) {
    var amt = energy === "high" ? 0.09 : energy === "calm" ? 0.05 : 0.07;
    tl.fromTo(cam, { scale: 1, transformOrigin: px(ox) + " " + px(oy) }, { scale: 1 + amt, transformOrigin: px(ox) + " " + px(oy), duration: Math.max(0.5, e - s), ease: "none" }, snap(s));
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

  // ---------- kinetic beat (also the 2D fallback for 3d / footage) ----------
  var lastFlood = false;
  function kinetic(i, b, sh, s, e, kwText, onScreen, successAt) {
    var L = LAY.kin, dur = e - s;
    var flood = !lastFlood && (b.role === "hook" || b.role === "reveal" || b.success || b.energy === "high");
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
    } else discs(sh.cam, i, sh.vout, s, e);
    var col = mk("div", "col" + (L.align === "center" ? " center" : ""), sh.cam, { left: L.col[0], top: L.col[1], width: L.col[2], height: L.col[3] });
    var badge = null;
    var bs = 0.13 * Math.min(W, H);
    if (b.success) { badge = mk("div", "", col, { position: "relative", width: bs, height: bs, marginBottom: px(0.03 * H), flex: "none" }); }
    var words = kwText.split(/\s+/).filter(Boolean).length;
    var kf = kwFit(kwText, L.col[2], words >= 3 ? L.lines : Math.min(L.lines, 2), L.cap, 72), fs = kf.fs;
    var kw = keyword(col, kwText, kf, L.align, L.col[2]);
    // incoming text ignites on the cut frame (fields and shapes already overlap the J-cut); on a flood it
    // waits until its field has (mostly) covered the frame
    var tk = i === 0 ? s + 0.06 : flood && sh.vin.axis !== "z" ? Math.max(s, sh.t0 + 0.6 * P.dIn) : s;
    var landed = textEntry(kw, tk, b.motion && b.motion.text_effect);
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
    push(sh.cam, s, e, ox, L.col[1] + L.col[3] / 2, b.energy);
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
    carry(fld, sh.vout, s + 0.3, e, 0.8);
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
    var card = free(mk("div", "card", sh.cam, { left: cx, top: cy, width: cwid, height: chei }));
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
    push(sh.cam, s, e, gx, gy, b.energy);
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
    discs(sh.cam, 0, { axis: "z", dir: 1 }, s, e, LAY.titleDiscs);
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
    var pillText = onScreen || kwText, phrase = onScreen ? kwText : "";
    var kw = null;
    if (phrase) kw = keyword(col, phrase, kwFit(phrase, L.kwW, 2, L.kw, 64), "center", L.kwW);
    if (kw) kw.el.style.marginTop = px(0.045 * H);
    var pf = L.pill, pw = Math.min(0.84 * W, pillText.length * pf * KB + pf * 2.4);
    var pill = mk("div", "pill", col, { fontSize: pf, padding: px(pf * 0.55) + " " + px(pf * 1.2), marginTop: px(0.05 * H), maxWidth: px(0.84 * W) }, pillText);
    // arrivals: lockup, key phrase, pill; then the camera keeps pushing to the last frame
    var tl0 = i === 0 ? s + 0.08 : s;
    hide(lock); showAt(lock, tl0);
    tl.fromTo(lock, { scale: 1.18 }, { scale: 1, duration: P.dIn + 0.1, ease: P.inE }, snap(tl0));
    var landed = kw ? textEntry(kw, tl0 + 0.24, b.motion && b.motion.text_effect) : tl0 + 0.24;
    rise(pill, Math.min(landed + 0.05, s + 0.9), 36);
    // the pill's centre, from the stacked heights (character-count estimates, never measured)
    var lockH = logo ? (V.logoWordmark ? Math.min(L.logoH, L.logoW / 3) : L.logoH) : (nfs || 0);
    if (MODE !== "wide" && logo && !V.logoWordmark && name) lockH += 28 + (nfs || 0);
    var kwH = kw ? kw.fs * 1.04 * kw.lines + 0.045 * H : 0;
    var pillH = pf * 1.25 + pf * 1.1, stackH = lockH + kwH + 0.05 * H + pillH;
    var pillY = H / 2 + stackH / 2 - pillH / 2;
    push(sh.cam, s, e, W / 2, H / 2, b.energy || "medium");
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
    var kind = b.kind, kwText = text(b, "keyword"), onScreen = text(b, "on_screen") || null, line = text(b, "line") || null;
    if (kind === "3d" || kind === "footage") {
      // 2D fallback until the generated clip exists; a storyboard edit to the keyword still wins
      var fb = b.fallback || {};
      var edited = has(b.id + ".keyword") && V[b.id + ".keyword"] !== b.keyword;
      if (!edited && fb.keyword) kwText = String(fb.keyword);
      kind = fb.kind === "ui" && b.ui ? "ui" : "kinetic";
    }
    var src = kind === "ui" && b.ui ? V["shot." + b.ui.screen] : null;
    if (last && b.role === "cta" && kind === "kinetic") kind = "title"; // the closing CTA always lands as the brand lockup
    if (kind === "ui" && !src) { LOG.warnings.push(b.id + ": no screenshot for " + (b.ui ? b.ui.screen : "?") + "; rendered as kinetic"); kind = "kinetic"; }
    if (kind === "title" && !last) LOG.warnings.push(b.id + ": a title beat that is not last still exits on its vector");
    if (!kwText) kwText = onScreen || String(V.brandName || "");
    var sh = shell(i, b, s, e, last);
    var dur = e - s;
    var successAt = b.success ? (typeof b.success_at === "number" ? b.success_at : s + Math.max(0.9, 0.5 * dur)) : null;
    var actAt = typeof b.act_at === "number" ? b.act_at : s + Math.max(0.9, 0.38 * dur);
    var info = { id: b.id, kind: kind, start: s, end: e };
    if (kind === "ui") Object.assign(info, uiBeat(i, b, sh, s, e, kwText, onScreen, src, actAt, successAt || 0));
    else if (kind === "title") Object.assign(info, titleBeat(i, b, sh, s, e, kwText, onScreen));
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
  window.__timelines["main"] = tl;
})();
