/* Cutout Tales drawing kit: code-drawn 2D cutout / puppet look.
   Ported from the MIT-licensed "growkaz-cutout-tales" skill (third_party/cutout-tales/LICENSE) from pycairo
   to Canvas 2D. The `Cr` class mirrors the cairo call names the original used (move_to, curve_to, fill_preserve,
   clip, ...) so the port stays close to the source and is easy to diff against it.

   Contract: drawFrame(ctx, spec, t) is a PURE function of (spec, t). All randomness is seeded from spec.seed,
   there are no clocks and no Math.random, nothing is carried between frames, so seeking forwards, backwards
   or repeatedly gives identical pixels. Fonts must already be loaded by the host page. */
(function (root) {
  "use strict";
  var PI = Math.PI, TAU = Math.PI * 2;
  var LINE = [0.17, 0.11, 0.09];
  var FONT = '"Hanken Grotesk", "Poppins", "Helvetica Neue", Arial, sans-serif';
  var DW = 1920, DH = 1080; // design space every set is drawn in

  // ------------------------------------------------------------------ helpers
  function hexc(h, a) { h = String(h).replace("#", ""); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, a === undefined ? 1 : a]; }
  function clamp(x, a, b) { if (a === undefined) a = 0; if (b === undefined) b = 1; return Math.max(a, Math.min(b, x)); }
  function ease(t) { t = clamp(t); return t * t * (3 - 2 * t); }
  function backOut(t) { t = clamp(t); var c = 2.2; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function S(s) { return Math.max(s, 0.001); }
  function darker(col, k) { if (k === undefined) k = 0.78; return [col[0] * k, col[1] * k, col[2] * k, col.length > 3 ? col[3] : 1]; }
  function rgba(col, a) { return "rgba(" + Math.round(col[0] * 255) + "," + Math.round(col[1] * 255) + "," + Math.round(col[2] * 255) + "," + (a === undefined ? (col.length > 3 ? col[3] : 1) : a) + ")"; }
  /** Seeded PRNG (mulberry32). The only source of randomness in the kit. */
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ------------------------------------------------------------------ cairo-style wrapper
  function Gradient(g) { this.g = g; }
  Gradient.prototype.add_color_stop_rgba = function (o, r, g, b, a) { this.g.addColorStop(o, rgba([r, g, b], a)); };
  function Cr(ctx) { this.ctx = ctx; this.nsp = false; this.pen = [0, 0]; ctx.beginPath(); }
  var P = Cr.prototype;
  P.save = function () { this.ctx.save(); };
  P.restore = function () { this.ctx.restore(); this.nsp = false; };
  P.translate = function (x, y) { this.ctx.translate(x, y); };
  P.rotate = function (a) { this.ctx.rotate(a); };
  P.scale = function (x, y) { this.ctx.scale(x, y); };
  P.new_path = function () { this.ctx.beginPath(); this.nsp = false; };
  P.new_sub_path = function () { this.nsp = true; };
  P.move_to = function (x, y) { this.ctx.moveTo(x, y); this.pen = [x, y]; this.nsp = false; };
  P.line_to = function (x, y) { this.ctx.lineTo(x, y); this.nsp = false; };
  P.curve_to = function (a, b, c, d, e, f) { this.ctx.bezierCurveTo(a, b, c, d, e, f); this.nsp = false; };
  P.close_path = function () { this.ctx.closePath(); };
  P.rectangle = function (x, y, w, h) { this.ctx.rect(x, y, w, h); this.nsp = false; };
  P.arc = function (x, y, r, a0, a1) {
    if (this.nsp) { this.ctx.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0)); this.nsp = false; }
    this.ctx.arc(x, y, r, a0, a1);
  };
  P.set_source_rgba = function (r, g, b, a) { var s = rgba([r, g, b], a === undefined ? 1 : a); this.ctx.fillStyle = s; this.ctx.strokeStyle = s; };
  P.set_source_rgb = function (r, g, b) { this.set_source_rgba(r, g, b, 1); };
  P.set_source = function (g) { this.ctx.fillStyle = g.g; this.ctx.strokeStyle = g.g; };
  P.set_line_width = function (w) { this.ctx.lineWidth = w; };
  P.set_line_join = function (j) { this.ctx.lineJoin = j ? "round" : "miter"; };
  P.set_line_cap = function (j) { this.ctx.lineCap = j ? "round" : "butt"; };
  P.fill_preserve = function () { this.ctx.fill(); };
  P.fill = function () { this.ctx.fill(); this.ctx.beginPath(); this.nsp = false; };
  P.stroke = function () { this.ctx.stroke(); this.ctx.beginPath(); this.nsp = false; };
  P.clip = function () { this.ctx.clip(); this.ctx.beginPath(); this.nsp = false; };
  P.paint = function () { this.ctx.fillRect(-100000, -100000, 200000, 200000); };
  P.linear = function (x0, y0, x1, y1) { return new Gradient(this.ctx.createLinearGradient(x0, y0, x1, y1)); };
  P.radial = function (x0, y0, r0, x1, y1, r1) { return new Gradient(this.ctx.createRadialGradient(x0, y0, r0, x1, y1, r1)); };
  P.font = function (size, bold) { this.ctx.font = (bold === false ? "400 " : "700 ") + size + "px " + FONT; };
  P.text_extents = function (txt) {
    var m = this.ctx.measureText(txt);
    return { width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, x_bearing: -m.actualBoundingBoxLeft, x_advance: m.width };
  };
  P.show_text = function (txt) { this.ctx.textBaseline = "alphabetic"; this.ctx.fillText(txt, this.pen[0], this.pen[1]); };

  // ------------------------------------------------------------------ drawing helpers (engine.py)
  function circ(c, x, y, r) { c.new_sub_path(); c.arc(x, y, r, 0, TAU); }
  function rrect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); c.new_sub_path();
    c.arc(x + w - r, y + r, r, -PI / 2, 0); c.arc(x + w - r, y + h - r, r, 0, PI / 2);
    c.arc(x + r, y + h - r, r, PI / 2, PI); c.arc(x + r, y + r, r, PI, 3 * PI / 2); c.close_path();
  }
  function poly(c, pts) { c.move_to(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) c.line_to(pts[i][0], pts[i][1]); c.close_path(); }
  function stroke(c, w, col) { if (w === undefined) w = 3.2; col = col || LINE; c.set_source_rgb(col[0], col[1], col[2]); c.set_line_width(w); c.set_line_join(1); c.set_line_cap(1); c.stroke(); }
  function fs(c, col, lw) { c.set_source_rgba(col[0], col[1], col[2], col.length > 3 ? col[3] : 1); c.fill_preserve(); stroke(c, lw === undefined ? 3.2 : lw); }
  function shade(c, pathFn, shadowFn, base, dark, lw) {
    pathFn(); c.set_source_rgba(base[0], base[1], base[2], base.length > 3 ? base[3] : 1); c.fill_preserve();
    c.save(); c.clip(); shadowFn(); c.set_source_rgba(dark[0], dark[1], dark[2], dark.length > 3 ? dark[3] : 1); c.fill(); c.restore();
    pathFn(); stroke(c, lw === undefined ? 3.2 : lw);
  }
  function textC(c, txt, x, y, size, col, bold) {
    col = col || LINE; c.font(size, bold); var e = c.text_extents(txt);
    c.move_to(x - e.width / 2 - e.x_bearing, y); c.set_source_rgba(col[0], col[1], col[2], col.length > 3 ? col[3] : 1); c.show_text(txt);
  }
  function wrapText(c, txt, size, maxw, bold) {
    c.font(size, bold); var words = String(txt).split(/\s+/).filter(Boolean), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var t = (cur + " " + words[i]).trim();
      if (c.text_extents(t).x_advance > maxw && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ------------------------------------------------------------------ characters
  var SKINS = { a: hexc("e8b894"), b: hexc("c98d68"), c: hexc("8d5a3b"), d: hexc("f1cdb0"), e: hexc("6b4430") };
  /* Original archetypes only. Never a game, film or TV character. `name` in a shot list is a display label. */
  var ARCHETYPES = {
    everyman: { skin: "b", hair: "short", hair_col: "2b1f1a", shirt: "e9e2d2", jacket: "3f6f8f", pants: "3a3f4c", shoes: "2d2a2a", stubble: true },
    mother: { skin: "b", hair: "bun", hair_col: "3a2a22", shirt: "b65a4a", dress: true, pants: "6a3a34", shoes: "3b2a26", female: true },
    father: { skin: "b", hair: "short", hair_col: "4a4a4a", shirt: "7a8f6a", pants: "4a4038", shoes: "3b2a26", mustache: true, stubble: true },
    executive: { skin: "d", hair: "slick", hair_col: "1e1a1a", shirt: "f2efe8", jacket: "2a2a36", tie: "a8322c", pants: "2a2a36", shoes: "1a1616", mustache: true },
    tycoon: { skin: "d", hair: "bald", hair_col: "9a9a9a", shirt: "f2efe8", jacket: "3a2050", tie: "d8b45a", pants: "3a2050", shoes: "1a1616", mustache: true, tophat: true, chubby: true },
    underdog: { skin: "c", hair: "short", hair_col: "1e1715", shirt: "c9a46a", pants: "5a4a3a", shoes: "4a3426", patched: true },
    friend_a: { skin: "a", hair: "curly", hair_col: "7a3e22", shirt: "d9a23e", pants: "3a4a5c", shoes: "f0f0f0" },
    friend_b: { skin: "c", hair: "long", hair_col: "1e1715", shirt: "6a8fb8", pants: "2e2e3a", shoes: "2d2a2a", female: true },
    drifter: { skin: "b", hair: "short", hair_col: "2b1f1a", shirt: "8f6a4a", jacket: "3a2a2a", pants: "4a3a30", shoes: "3b2a1e", mustache: true, stubble: true, stetson: "2a1f1b", bandana: "a8322c", holster: true },
    markswoman: { skin: "a", hair: "long", hair_col: "8a3a22", shirt: "e2d6bc", jacket: "6a4a2c", pants: "5a4a3a", shoes: "3b2a1e", female: true, stetson: "8a6a4a", band: "3a2a22", holster: true },
    scamp: { skin: "d", hair: "curly", hair_col: "c89a4a", shirt: "6a8fb8", pants: "8a7a5a", shoes: "6a4a2a", bandana: "d8b45a" },
    marshal: { skin: "c", hair: "short", hair_col: "d0d0d0", shirt: "e8e0cc", jacket: "5a5a3a", pants: "3a3a40", shoes: "2a2220", mustache: true, stetson: "d8c8a0", band: "6a4a2a", holster: true, star: true },
    child: { skin: "b", hair: "short", hair_col: "2b1f1a", shirt: "e8c34a", pants: "3a5a8a", shoes: "d84a3a", chibi: true },
    laborer: { skin: "b", hair: "short", hair_col: "3a2a22", shirt: "4a6a9a", pants: "3a3a44", shoes: "2d2a2a", mustache: true, stubble: true, cap: "c9a23a" }
  };
  var COLOR_KEYS = ["hair_col", "shirt", "jacket", "pants", "shoes", "tie", "stetson", "bandana", "band", "cap"];
  var FLAG_KEYS = ["stubble", "mustache", "female", "dress", "tophat", "chubby", "patched", "holster", "star", "chibi", "glasses"];
  var HAIRS = ["short", "curly", "slick", "long", "bun", "bald"];
  /** archetype + whitelisted `look` overrides -> the drawing dict (colours become rgba arrays). */
  function resolveLook(archetype, look) {
    var base = ARCHETYPES[archetype] || ARCHETYPES.everyman, d = {}, k;
    var merged = {}; for (k in base) merged[k] = base[k];
    if (look) {
      if (SKINS[look.skin]) merged.skin = look.skin;
      if (HAIRS.indexOf(look.hair) >= 0) merged.hair = look.hair;
      COLOR_KEYS.forEach(function (key) { var v = look[key] === undefined && key === "hair_col" ? look.hairColor : look[key]; if (typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v)) merged[key] = v.replace("#", ""); });
      FLAG_KEYS.forEach(function (key) { if (typeof look[key] === "boolean") merged[key] = look[key]; });
    }
    for (k in merged) d[k] = COLOR_KEYS.indexOf(k) >= 0 ? hexc(merged[k]) : merged[k];
    return d;
  }
  var POSES = {
    idle: { ba1: 0.12, ba2: -0.12, fa1: -0.12, fa2: 0.12 },
    hips: { ba1: 0.38, ba2: -1.25, fa1: -0.38, fa2: 1.25 },
    cross: { ba1: -0.25, ba2: -1.75, fa1: 0.25, fa2: 1.75, both_front: true },
    point: { ba1: 0.12, ba2: -0.12, fa1: -1.75, fa2: 0.15 },
    shrug: { ba1: 0.9, ba2: -1.7, fa1: -0.9, fa2: 1.7 },
    think: { ba1: -0.25, ba2: -1.75, fa1: -0.35, fa2: 2.75, both_front: true },
    wave: { ba1: 0.12, ba2: -0.12, fa1: -2.6, fa2: 0.35 },
    up: { ba1: 2.6, ba2: -0.35, fa1: -2.6, fa2: 0.35 },
    sad: { ba1: 0.05, ba2: -0.05, fa1: -0.05, fa2: 0.05 },
    hold: { ba1: 0.12, ba2: -0.12, fa1: -0.55, fa2: 1.6 },
    present: { ba1: 0.12, ba2: -0.12, fa1: -1.2, fa2: -0.3 },
    hat_tip: { ba1: 0.38, ba2: -1.25, fa1: -2.5, fa2: 0.55 }
  };
  var EXPR = {
    neutral: { brow: 0, smile: 0, look: 0 }, happy: { brow: -3, smile: 6, look: 0 },
    worried: { brow: -6, smile: -4, look: 0, tilt: 1 }, angry: { brow: 6, smile: -3, look: 0 },
    sly: { brow: 4, smile: 5, look: 2 }, think: { brow: -4, smile: -1, look: 3 },
    sad: { brow: -7, smile: -6, look: -1 }, shock: { brow: -9, smile: 0, look: 0, mouth_o: true }
  };

  function arm(c, sx, sy, a1, a2, col, dcol, skin, ua, fa, w) {
    ua = ua || 88; fa = fa || 80; w = w || 26;
    c.save(); c.translate(sx, sy); c.rotate(a1);
    shade(c, function () { rrect(c, -w / 2, -6, w, ua + 8, w / 2); }, function () { c.rectangle(w * 0.15, -10, w, ua + 30); }, col, dcol);
    c.translate(0, ua - 4); c.rotate(a2);
    shade(c, function () { rrect(c, -w / 2 + 1, -6, w - 2, fa, w / 2 - 1); }, function () { c.rectangle(w * 0.12, -10, w, fa + 20); }, col, dcol);
    circ(c, 0, fa + 4, 13.5); fs(c, skin);
    c.restore();
  }

  function head(c, d, ex, blink, chibi) {
    var skin = SKINS[d.skin], sd = darker(skin, 0.84), hc = d.hair_col, s, ex_;
    if (d.hair === "long") { rrect(c, -46, -48, 92, 120, 40); fs(c, hc); }
    if (d.hair === "bun") { circ(c, 0, -62, 22); fs(c, hc); }
    for (var q = -1; q <= 1; q += 2) { c.save(); c.translate(q * 38, 4); c.scale(0.6, 1); circ(c, 0, 0, 13); c.restore(); fs(c, skin); }
    var face;
    if (chibi) face = function () { circ(c, 0, 0, 50); };
    else if (d.female) face = function () { c.move_to(-37, -30); c.curve_to(-40, 10, -32, 36, -12, 50); c.curve_to(-4, 55, 4, 55, 12, 50); c.curve_to(32, 36, 40, 10, 37, -30); c.curve_to(30, -62, -30, -62, -37, -30); c.close_path(); };
    else face = function () { c.move_to(-38, -30); c.curve_to(-42, 10, -36, 34, -16, 52); c.curve_to(-6, 60, 6, 60, 16, 52); c.curve_to(36, 34, 42, 10, 38, -30); c.curve_to(30, -62, -30, -62, -38, -30); c.close_path(); };
    shade(c, face, function () { c.move_to(14, -70); c.curve_to(30, 0, 30, 30, 8, 70); c.line_to(60, 70); c.line_to(60, -70); c.close_path(); }, skin, sd);
    if (d.stubble) {
      c.save(); face(); c.clip();
      c.move_to(-40, 12); c.curve_to(-30, 30, -20, 40, 0, 42); c.curve_to(20, 40, 30, 30, 40, 12);
      c.line_to(40, 70); c.line_to(-40, 70); c.close_path(); c.set_source_rgba(0.2, 0.14, 0.11, 0.35); c.fill(); c.restore();
    }
    if (d.mustache) { c.move_to(-20, 26); c.curve_to(-10, 18, 10, 18, 20, 26); c.set_source_rgba(hc[0], hc[1], hc[2], 1); c.set_line_width(7); c.set_line_cap(1); c.stroke(); }
    if (!chibi) { poly(c, [[2, -6], [10, 14], [-2, 16]]); c.set_source_rgba(sd[0], sd[1], sd[2], 1); c.fill(); }
    for (s = -1; s <= 1; s += 2) {
      ex_ = s * 16;
      if (blink) { c.move_to(ex_ - 8, -6); c.line_to(ex_ + 8, -6); stroke(c, 3); }
      else if (chibi) { circ(c, ex_ + (ex.look || 0), -4, 5); c.set_source_rgb(LINE[0], LINE[1], LINE[2]); c.fill(); }
      else {
        c.save(); c.translate(ex_, -6); c.scale(1.4, 1); circ(c, 0, 0, 5.5); c.restore(); c.set_source_rgb(0.98, 0.95, 0.9); c.fill();
        circ(c, ex_ + 1.5 + (ex.look || 0), -6, 3.6); c.set_source_rgb(LINE[0], LINE[1], LINE[2]); c.fill();
        if (d.female) { c.move_to(ex_ - 9, -10); c.line_to(s > 0 ? ex_ + 9 : ex_ + 8, -11); stroke(c, 2.6); }
      }
      var b = ex.brow || 0, inner = b > 0 ? b : b * 0.4, outer = b > 0 ? 0 : b, by = -21;
      var xIn = ex_ - s * 11, xOut = ex_ + s * 12;
      c.move_to(xOut, by + outer * 0.6); c.line_to(xIn, by + inner * 0.6 + (b > 0 ? 2 : (b < 0 ? -2 : 0)));
      c.set_source_rgba(hc[0], hc[1], hc[2], 1); c.set_line_width(d.female || chibi ? 5 : 7); c.set_line_cap(1); c.stroke();
    }
    if (d.glasses) { for (s = -1; s <= 1; s += 2) circ(c, s * 16, -6, 11); stroke(c, 2.6); }
    var sm = ex.smile || 0;
    if (ex.mouth_o) { c.save(); c.translate(0, 36); c.scale(0.8, 1); circ(c, 0, 0, 7); c.restore(); c.set_source_rgb(0.35, 0.12, 0.1); c.fill(); }
    else { c.move_to(-10, 35); c.curve_to(-4, 35 + sm, 4, 35 + sm, 10, 35); stroke(c, 3); }
    var hs = d.hair;
    if (hs === "short" || hs === "curly" || hs === "slick" || hs === "long" || hs === "bun") {
      c.new_path();
      if (hs === "curly") {
        for (var i = 0; i < 9; i++) { var a = PI + i * PI / 8; circ(c, 42 * Math.cos(a), -22 + 38 * Math.sin(a), 15); }
        c.set_source_rgba(hc[0], hc[1], hc[2], 1); c.fill_preserve(); stroke(c, 2.5);
      } else {
        shade(c, function () {
          c.move_to(-41, -14); c.curve_to(-46, -64, 46, -72, 41, -14);
          if (hs !== "long" && hs !== "bun") c.curve_to(30, hs !== "slick" ? -36 : -40, -10, -44, -36, -26); else c.curve_to(20, -46, -20, -46, -41, -14);
          c.close_path();
        }, function () { c.rectangle(14, -80, 40, 80); }, hc, darker(hc, 0.75), 2.8);
      }
    } else if (hs === "bald") {
      c.move_to(-38, -18); c.curve_to(-40, -6, -40, 4, -38, 10); c.set_source_rgba(hc[0], hc[1], hc[2], 1); c.set_line_width(8); c.stroke();
      c.move_to(38, -18); c.curve_to(40, -6, 40, 4, 38, 10); c.stroke();
    }
    if (d.cap) {
      shade(c, function () { c.move_to(-42, -24); c.curve_to(-44, -72, 44, -72, 42, -24); c.close_path(); }, function () { c.rectangle(14, -80, 40, 60); }, d.cap, darker(d.cap));
      poly(c, [[-44, -24], [66, -24], [60, -14], [-44, -16]]); fs(c, darker(d.cap, 0.8));
    }
    if (d.stetson) {
      var hc2 = d.stetson, bandc = d.band || hexc("8a6a4a");
      c.save(); c.translate(0, -38 + (ex.hat_dy || 0)); c.rotate(ex.hat_rot || 0);
      shade(c, function () { c.move_to(-34, 0); c.curve_to(-36, -40, -26, -62, 0, -54); c.curve_to(26, -62, 36, -40, 34, 0); c.close_path(); }, function () { c.rectangle(10, -80, 40, 90); }, hc2, darker(hc2, 0.75));
      c.move_to(-34, -12); c.line_to(34, -12); c.set_source_rgba(bandc[0], bandc[1], bandc[2], 1); c.set_line_width(8); c.stroke();
      shade(c, function () { c.move_to(-86, -2); c.curve_to(-60, 12, 60, 12, 86, -2); c.curve_to(92, 8, 70, 16, 0, 18); c.curve_to(-70, 16, -92, 8, -86, -2); c.close_path(); }, function () { c.rectangle(-100, 10, 200, 20); }, hc2, darker(hc2, 0.75));
      c.restore();
    }
    if (d.tophat) {
      c.save(); c.translate(0, -40); c.rotate(-0.08);
      rrect(c, -64, -6, 128, 14, 6); fs(c, hexc("1c1a22"));
      rrect(c, -38, -82, 76, 80, 6); fs(c, hexc("1c1a22"));
      c.rectangle(-38, -22, 76, 12); c.set_source_rgba(0.66, 0.2, 0.17, 1); c.fill(); c.restore();
    }
  }

  /** Draws one character with feet at the origin (call after translate/scale). Idle breathing/blink/sway are built in. */
  function character(c, d, t, pose, expr, blink, flip, seed) {
    var p = {}, k;
    for (k in pose) p[k] = pose[k];
    var ex = expr;
    c.save();
    if (flip) c.scale(-1, 1);
    var chibi = d.chibi;
    if (chibi) c.scale(0.62, 0.62);
    var ph = seed * 1.7, breathe = Math.sin(t * 2.1 + ph) * 0.012, bob = Math.sin(t * 2.1 + 0.6 + ph) * 1.6;
    var skin = SKINS[d.skin], wid = d.chubby ? 1.25 : 1.0, legh = chibi ? 150 : 230, i;
    [-24, 24].forEach(function (lx) {
      shade(c, function () { c.move_to(lx - 22 * wid, -legh); c.line_to(lx + 22 * wid, -legh); c.line_to(lx + 19, -26); c.line_to(lx - 19, -26); c.close_path(); },
        function () { c.rectangle(lx + 6, -legh - 10, 34, legh); }, d.pants, darker(d.pants));
      rrect(c, lx - 22 + (lx > 0 ? 0 : -8), -30, 46, 30, 12); fs(c, d.shoes);
    });
    c.save(); c.translate(0, -legh + 2); c.scale(1 + breathe, 1 + breathe); c.translate(0, bob * 0.3);
    var shirt = d.shirt, jacket = d.jacket, sleeve = jacket || shirt;
    if (!p.both_front) arm(c, -52 * wid, -150, p.ba1, p.ba2, sleeve, darker(sleeve), skin);
    var tw = 56 * wid;
    if (d.dress) {
      shade(c, function () { c.move_to(-tw, -168); c.curve_to(-tw - 4, -100, -tw + 6, -40, -tw - 24, 120); c.line_to(tw + 24, 120); c.curve_to(tw - 6, -40, tw + 4, -100, tw, -168); c.curve_to(30, -182, -30, -182, -tw, -168); c.close_path(); },
        function () { c.rectangle(18, -200, 90, 340); }, shirt, darker(shirt));
    } else {
      shade(c, function () { c.move_to(-tw, -168); c.curve_to(-tw - 4, -100, -tw + 6, -40, -tw + 10, 6); c.line_to(tw - 10, 6); c.curve_to(tw - 6, -40, tw + 4, -100, tw, -168); c.curve_to(30, -182, -30, -182, -tw, -168); c.close_path(); },
        function () { c.rectangle(18, -200, 90, 230); }, shirt, darker(shirt));
    }
    if (d.patched) { rrect(c, -34, -70, 24, 22, 3); fs(c, hexc("8a6a44"), 2.4); }
    if (d.tie) { poly(c, [[-8, -168], [8, -168], [12, -60], [0, -44], [-12, -60]]); fs(c, d.tie, 2.6); }
    if (jacket) {
      shade(c, function () { c.move_to(-tw - 2, -166); c.curve_to(-tw - 6, -100, -tw + 4, -40, -tw + 8, 10); c.line_to(-14, 10); c.line_to(-16, -70); c.line_to(-26, -170); c.close_path(); },
        function () { c.rectangle(0, 0, 0, 0); }, jacket, darker(jacket));
      shade(c, function () { c.move_to(tw + 2, -166); c.curve_to(tw + 6, -100, tw - 4, -40, tw - 8, 10); c.line_to(14, 10); c.line_to(16, -70); c.line_to(26, -170); c.close_path(); },
        function () { c.rectangle(0, -200, 90, 230); }, jacket, darker(jacket));
    }
    if (!d.dress) { rrect(c, -tw + 8, -4, 2 * tw - 16, 14, 3); fs(c, hexc("3a2a22"), 2.6); }
    rrect(c, -15, -194, 30, 30, 8); fs(c, darker(skin, 0.86));
    if (d.tie || jacket) { poly(c, [[-24, -176], [0, -150], [24, -176], [0, -168]]); fs(c, shirt, 2.6); }
    if (d.bandana) { poly(c, [[-32, -176], [32, -176], [0, -142]]); fs(c, d.bandana, 2.6); rrect(c, -34, -184, 68, 15, 7); fs(c, d.bandana, 2.6); }
    if (d.holster) {
      shade(c, function () { c.move_to(-tw - 4, 12); c.line_to(-tw + 20, 12); c.line_to(-tw + 22, 76); c.line_to(-tw + 2, 82); c.close_path(); },
        function () { c.rectangle(-tw + 10, 0, 20, 90); }, hexc("7a4a2c"), hexc("5e3820"));
      rrect(c, -tw - 2, -6, 14, 26, 4); fs(c, hexc("2b2b2e"));
    }
    if (d.star) {
      var pts = []; for (i = 0; i < 10; i++) { var rr = i % 2 === 0 ? 14 : 6; pts.push([rr * Math.cos(-PI / 2 + i * PI / 5) + 30, -120 + rr * Math.sin(-PI / 2 + i * PI / 5)]); }
      poly(c, pts); fs(c, hexc("e8c04a"), 2.2);
    }
    c.save();
    if (chibi) { c.translate(0, -175); c.scale(1.9, 1.9); c.translate(0, -40); } else c.translate(0, -238 + bob * 0.5);
    c.rotate(Math.sin(t * 0.9 + ph) * 0.025 + (ex.tilt || 0) * 0.06 + (p.head || 0));
    head(c, d, ex, blink, chibi);
    c.restore();
    if (p.both_front) arm(c, -52 * wid, -150, p.ba1, p.ba2, sleeve, darker(sleeve), skin);
    arm(c, 52 * wid, -150, p.fa1, p.fa2, sleeve, darker(sleeve), skin);
    c.restore(); c.restore();
  }

  // ------------------------------------------------------------------ world (seeded, memoised)
  var worldCache = {};
  function world(seed, W, H) {
    var key = seed + ":" + W + "x" + H; if (worldCache[key]) return worldCache[key];
    var r = rng(seed * 7919 + 11), i, w = {};
    w.stars = []; for (i = 0; i < 80; i++) w.stars.push([r() * DW * 1.4 - 100, r() * 420, r()]);
    w.dust = []; for (i = 0; i < 90; i++) w.dust.push([r() * W, r() * H, 1.2 + r() * 2, r() * 6.3, 8 + r() * 14]);
    w.tufts = []; for (i = 0; i < 70; i++) w.tufts.push([-200 + r() * (DW + 400), 820 + r() * 260]);
    w.skyline = []; var x = -300;
    while (x < DW + 400) { var ww = 90 + Math.floor(r() * 110), hh = 180 + Math.floor(r() * 300); var lit = []; for (i = 0; i < 600; i++) lit.push(r() < 0.38); w.skyline.push({ x: x, w: ww, h: hh, lit: lit }); x += ww + Math.floor(r() * 30) - 10; }
    w.skyline2 = w.skyline.map(function (b) { return { x: b.x + 60, w: b.w * 0.8, h: b.h * 0.7, lit: b.lit }; });
    return (worldCache[key] = w);
  }

  var MOODS = {
    dusk: { sky: ["3d2a5c", "c4566a", "f6a65a"], far: "7d4a72", near: "a65a6a", city: "4a2e52", win: "f6c46d", light: [1, 0.72, 0.4], dust: [1, 0.88, 0.65] },
    night: { sky: ["0f1430", "1d2550", "34407a"], far: "1c2448", near: "252f5c", city: "161c3a", win: "f2c46d", light: [0.8, 0.85, 1], dust: [0.8, 0.85, 1] },
    day: { sky: ["6fa8de", "a9d0ef", "dcecf6"], far: "8aa6c2", near: "a9bfd4", city: "7f97b3", win: "e6f0f8", light: [1, 0.97, 0.85], dust: [1, 1, 0.9] },
    gold: { sky: ["5a3a6a", "e07a5a", "ffc870"], far: "9a5a6a", near: "c47a6a", city: "5e3a50", win: "ffd88a", light: [1, 0.8, 0.5], dust: [1, 0.9, 0.7] },
    interior: { sky: ["6fa8de", "a9d0ef", "dcecf6"], far: "8aa6c2", near: "a9bfd4", city: "7f97b3", win: "e6f0f8", light: [1, 0.85, 0.55], dust: [1, 0.9, 0.7] }
  };

  function sky(c, m) {
    var g = c.linear(0, 0, 0, DH * 0.8), a = hexc(m.sky[0]), b = hexc(m.sky[1]), d = hexc(m.sky[2]);
    g.add_color_stop_rgba(0, a[0], a[1], a[2], 1); g.add_color_stop_rgba(0.55, b[0], b[1], b[2], 1); g.add_color_stop_rgba(1, d[0], d[1], d[2], 1);
    c.set_source(g); c.paint();
  }
  function glow(c, x, y, r, col, a, k) {
    a = a === undefined ? 0.55 : a; k = k === undefined ? 5 : k;
    var g = c.radial(x, y, r * 0.4, x, y, r * k); g.add_color_stop_rgba(0, col[0], col[1], col[2], a); g.add_color_stop_rgba(1, col[0], col[1], col[2], 0);
    c.set_source(g); c.paint();
  }
  function sun(c, x, y, r, m, moon) { glow(c, x, y, r, m.light); circ(c, x, y, r); c.set_source_rgba(1, 0.95, moon ? 0.92 : 0.8, 1); c.fill(); }
  function cloud(c, x, y, s, col) {
    c.save(); c.translate(x, y); c.scale(S(s), S(s));
    [[0, 0, 40], [45, -18, 48], [95, -6, 38], [135, 6, 28], [-35, 8, 26]].forEach(function (q) { circ(c, q[0], q[1], q[2]); });
    c.rectangle(-60, 6, 220, 30); c.set_source_rgba(col[0], col[1], col[2], col[3]); c.fill(); c.restore();
  }
  function stars(c, w, a) { w.stars.forEach(function (s) { circ(c, s[0], s[1], 1 + s[2]); c.set_source_rgba(1, 1, 1, a * s[2]); c.fill(); }); }
  function skylineDraw(c, w, base, m, far) {
    var col = hexc(m[far ? "far" : "city"]);
    (far ? w.skyline2 : w.skyline).forEach(function (b) {
      var hh = b.h * (far ? 0.75 : 1);
      c.rectangle(b.x, base - hh, b.w, hh); c.set_source_rgba(col[0], col[1], col[2], 1); c.fill();
      if (!far) {
        var wc = hexc(m.win, 0.85), n = 0;
        for (var wy = Math.floor(base - hh + 24); wy < base - 20; wy += 34) for (var wx = Math.floor(b.x + 14); wx < b.x + b.w - 20; wx += 30) { if (b.lit[n++ % 600]) { c.rectangle(wx, wy, 14, 18); c.set_source_rgba(wc[0], wc[1], wc[2], wc[3]); c.fill(); } }
      }
    });
  }
  function vignette(c, W, H, s) {
    var g = c.radial(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
    g.add_color_stop_rgba(0, 0, 0, 0, 0); g.add_color_stop_rgba(1, 0.05, 0.02, 0.05, s); c.set_source(g); c.paint();
  }
  function dustDraw(c, w, W, H, t, col) {
    w.dust.forEach(function (p) {
      var sp = p[4], xx = ((p[0] + t * sp) % W + W) % W, yy = ((p[1] - t * sp * 0.6 + Math.sin(t + p[3]) * 12) % H + H) % H;
      var a = 0.2 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.7 + p[3]));
      circ(c, xx, yy, p[2]); c.set_source_rgba(col[0], col[1], col[2], a); c.fill();
    });
  }

  // ---- sets (all drawn in the 1920x1080 design space)
  function wall(c, col, floorCol, fy) {
    fy = fy || 800;
    var g = c.linear(0, 0, 0, fy); var a = darker(col, 0.8);
    g.add_color_stop_rgba(0, a[0], a[1], a[2], 1); g.add_color_stop_rgba(1, col[0], col[1], col[2], 1);
    c.rectangle(0, 0, DW, fy); c.set_source(g); c.fill();
    c.rectangle(0, fy - 150, DW, 150); var wd = darker(col, 0.86); c.set_source_rgba(wd[0], wd[1], wd[2], 1); c.fill();
    c.move_to(0, fy - 150); c.line_to(DW, fy - 150); stroke(c, 3, darker(col, 0.6));
    g = c.linear(0, fy, 0, DH); var fd = darker(floorCol, 0.7);
    g.add_color_stop_rgba(0, floorCol[0], floorCol[1], floorCol[2], 1); g.add_color_stop_rgba(1, fd[0], fd[1], fd[2], 1);
    c.rectangle(-300, fy, DW + 600, DH); c.set_source(g); c.fill();
    for (var i = -4; i < 30; i++) { c.move_to(i * 90, fy); c.line_to(i * 90 - 260 + (i * 90 - DW / 2) * 0.4, DH); stroke(c, 2, darker(floorCol, 0.82)); }
    c.move_to(-300, fy); c.line_to(DW + 300, fy); stroke(c, 3);
  }
  function windowDraw(c, w, x, y, ww, hh, m, night) {
    rrect(c, x - 14, y - 14, ww + 28, hh + 28, 6); fs(c, hexc("f0e6d6"));
    c.save(); rrect(c, x, y, ww, hh, 3); c.clip();
    c.translate(x, y); c.scale(ww / DW, hh / (DH * 0.8));
    sky(c, m);
    if (night) { stars(c, w, 0.7); sun(c, DW * 0.75, 160, 60, m, true); } else sun(c, DW * 0.7, 420, 80, m);
    skylineDraw(c, w, DH * 0.8, m, true); skylineDraw(c, w, DH * 0.8 + 40, m, false);
    c.restore();
    rrect(c, x, y, ww, hh, 3); stroke(c, 4);
    c.move_to(x + ww / 2, y); c.line_to(x + ww / 2, y + hh); c.move_to(x, y + hh / 2); c.line_to(x + ww, y + hh / 2); stroke(c, 7, hexc("f0e6d6"));
    rrect(c, x - 24, y + hh + 10, ww + 48, 18, 4); fs(c, hexc("e2d6c4"));
  }
  function lamp(c, x, y, on) {
    if (on) glow(c, x, y - 120, 60, [1, 0.85, 0.5], 0.45, 5);
    rrect(c, x - 8, y - 110, 16, 110, 4); fs(c, hexc("5a4a3a")); rrect(c, x - 40, y - 10, 80, 14, 6); fs(c, hexc("5a4a3a"));
    poly(c, [[x - 55, y - 110], [x + 55, y - 110], [x + 34, y - 180], [x - 34, y - 180]]); fs(c, hexc("f2d79a"));
  }
  function couch(c, x, y, col) {
    rrect(c, x, y - 170, 520, 120, 30); fs(c, darker(col, 0.85)); rrect(c, x - 20, y - 90, 560, 70, 24); fs(c, col);
    [-40, 500].forEach(function (dx) { rrect(c, x + dx, y - 140, 60, 120, 26); fs(c, darker(col, 0.9)); });
    [10, 490].forEach(function (dx) { rrect(c, x + dx, y - 24, 20, 24, 4); fs(c, hexc("3a2a22")); });
  }
  function plant(c, x, y) {
    rrect(c, x - 34, y - 80, 68, 80, 8); fs(c, hexc("c4704a"));
    [-0.9, -0.45, 0, 0.45, 0.9].forEach(function (a) { c.save(); c.translate(x, y - 78); c.rotate(a); c.scale(0.45, 1); circ(c, 0, -60, 50); c.restore(); fs(c, hexc("5a8a4a"), 2.6); });
  }
  function framePic(c, x, y, w, h, col) { rrect(c, x, y, w, h, 4); fs(c, hexc("6a4a34")); rrect(c, x + 10, y + 10, w - 20, h - 20, 2); fs(c, col, 2); }
  function streetBg(c, w, m, t, night) {
    sky(c, m);
    if (night) { stars(c, w, 0.5); sun(c, 1500, 180, 55, m, true); } else sun(c, 1250, 560, 75, m);
    var nc = hexc(m.near);
    cloud(c, 250 + t * 6, 160, 1.1, [nc[0], nc[1], nc[2], 0.45]); cloud(c, 1350 + t * 4, 110, 1.3, [nc[0], nc[1], nc[2], 0.4]);
    skylineDraw(c, w, 760, m, true); skylineDraw(c, w, 790, m, false);
  }
  function groundStreet(c) {
    c.rectangle(-300, 790, DW + 600, 60); var s = hexc("8a8a90"); c.set_source_rgba(s[0], s[1], s[2], 1); c.fill();
    c.move_to(-300, 790); c.line_to(DW + 300, 790); stroke(c, 3);
    var g = c.linear(0, 850, 0, DH), a = hexc("4a4a54"), b = hexc("2e2e36");
    g.add_color_stop_rgba(0, a[0], a[1], a[2], 1); g.add_color_stop_rgba(1, b[0], b[1], b[2], 1);
    c.rectangle(-300, 850, DW + 600, DH); c.set_source(g); c.fill(); c.move_to(-300, 850); c.line_to(DW + 300, 850); stroke(c, 3);
    for (var i = -2; i < 14; i++) { rrect(c, i * 190, 960, 100, 12, 4); c.set_source_rgba(0.95, 0.85, 0.5, 0.8); c.fill(); }
  }
  function streetlamp(c, x, on) {
    if (on) glow(c, x + 40, 420, 50, [1, 0.85, 0.5], 0.5, 5);
    rrect(c, x - 7, 420, 14, 380, 4); fs(c, hexc("2e2e36"));
    c.move_to(x, 430); c.curve_to(x, 400, x + 30, 395, x + 46, 405); stroke(c, 8, hexc("2e2e36"));
    rrect(c, x + 28, 402, 36, 18, 6); fs(c, hexc("ffe0a0"));
  }
  function stage(c) {
    var b = hexc("241a2a"); c.set_source_rgba(b[0], b[1], b[2], 1); c.paint();
    glow(c, DW / 2, 500, 200, [1, 0.85, 0.6], 0.45, 4);
    var g = c.linear(0, 820, 0, DH), a = hexc("8a5a3a"), d = hexc("4a2e20");
    g.add_color_stop_rgba(0, a[0], a[1], a[2], 1); g.add_color_stop_rgba(1, d[0], d[1], d[2], 1);
    c.rectangle(0, 820, DW, DH); c.set_source(g); c.fill(); c.move_to(0, 820); c.line_to(DW, 820); stroke(c, 3);
    [-1, 1].forEach(function (s) {
      var x0 = s < 0 ? 0 : DW;
      for (var i = 0; i < 6; i++) {
        var xx = s > 0 ? x0 - i * 46 : i * 46;
        c.move_to(xx, 0); c.curve_to(xx + 30, 300, xx - 20, 600, xx + 10, 840); c.line_to(xx + 50, 840); c.curve_to(xx + 20, 600, xx + 70, 300, xx + 46, 0); c.close_path();
        fs(c, i % 2 ? hexc("9a2a2a") : hexc("7a1e22"), 2.5);
      }
    });
    for (var j = 0; j < 14; j++) { var x2 = j * 150 - 20; c.move_to(x2, 0); c.curve_to(x2 + 40, 90, x2 + 110, 90, x2 + 150, 0); c.close_path(); fs(c, hexc("8a2226"), 2.5); }
  }
  function plainBg(c, a, b) {
    var g = c.radial(DW / 2, DH * 0.45, 100, DW / 2, DH / 2, DH), ca = hexc(a), cb = hexc(b);
    g.add_color_stop_rgba(0, ca[0], ca[1], ca[2], 1); g.add_color_stop_rgba(1, cb[0], cb[1], cb[2], 1); c.set_source(g); c.paint();
  }
  // ---- western pieces (scene.py)
  function mountains(c, base, pts, col) {
    c.move_to(-300, base); pts.forEach(function (p) { c.line_to(p[0], p[1]); });
    c.line_to(DW + 300, base); c.line_to(DW + 300, DH); c.line_to(-300, DH); c.close_path(); c.set_source_rgba(col[0], col[1], col[2], col[3]); c.fill();
  }
  function building(c, x, w, h, col, sign) {
    var gy = 760, trim = hexc("3c2a24");
    rrect(c, x, gy - h, w, h, 2); fs(c, col, 3);
    rrect(c, x - 8, gy - h - 16, w + 16, 22, 3); fs(c, trim, 3);
    for (var i = 0; i < Math.floor(w / 70); i++) {
      var wx = x + 24 + i * 70; if (wx + 36 > x + w - 10) break;
      rrect(c, wx, gy - h + 50, 36, 48, 3); fs(c, hexc("f2c46d"), 2.6);
      c.move_to(wx + 18, gy - h + 50); c.line_to(wx + 18, gy - h + 98); c.set_line_width(2.5); c.set_source_rgb(LINE[0], LINE[1], LINE[2]); c.stroke();
    }
    poly(c, [[x - 14, gy - 112], [x + w + 14, gy - 112], [x + w + 4, gy - 92], [x - 4, gy - 92]]); fs(c, trim, 3);
    [x + 6, x + w - 10].forEach(function (px) { rrect(c, px, gy - 92, 8, 92, 2); fs(c, trim, 2.4); });
    rrect(c, x + w / 2 - 26, gy - 84, 52, 84, 3); fs(c, hexc("5a3a2c"), 3);
    if (sign) { rrect(c, x + w / 2 - 70, gy - h + 8, 140, 32, 4); fs(c, hexc("efe2c4"), 2.6); textC(c, sign, x + w / 2, gy - h + 31, 19); }
  }
  function tuft(c, x, y, col) {
    [-0.5, -0.15, 0.2, 0.55].forEach(function (a) { c.move_to(x, y); c.curve_to(x + a * 10, y - 10, x + a * 22, y - 18, x + a * 26, y - 24); });
    c.set_source_rgba(col[0], col[1], col[2], col[3]); c.set_line_width(2.6); c.set_line_cap(1); c.stroke();
  }
  function horseRider(c, t) {
    var s = t * 7.0, lg = function (ph) { return Math.sin(s + ph) * 0.42; };
    function leg(x, y, ph, front) {
      c.save(); c.translate(x, y); c.rotate(lg(ph)); rrect(c, -9, 0, 18, 70, 8); c.fill();
      c.translate(0, 64); c.rotate(front ? Math.max(0, -lg(ph) * 1.3) : -Math.max(0, lg(ph)) * 1.1); rrect(c, -7, 0, 14, 66, 6); c.fill(); c.restore();
    }
    c.set_source_rgb(0.08, 0.05, 0.1);
    var bob = Math.abs(Math.sin(s)) * 5;
    c.save(); c.translate(0, -bob);
    [[-70, 0, 0], [60, PI, 1], [-55, PI, 0], [75, 0, 1]].forEach(function (q) { leg(q[0], -150, q[1], q[2]); });
    c.save(); c.translate(0, -175); c.scale(1.2, 0.62); circ(c, 0, 0, 100); c.restore(); c.fill();
    poly(c, [[70, -210], [115, -300], [150, -290], [140, -250], [100, -170]]); c.fill();
    c.save(); c.translate(160, -282); c.rotate(0.55); c.scale(1.6, 0.75); circ(c, 0, 0, 28); c.restore(); c.fill();
    poly(c, [[126, -320], [134, -342], [142, -316]]); c.fill();
    c.move_to(-118, -195); c.curve_to(-160, -170, -150, -110, -170, -80 + Math.sin(s) * 6); c.set_line_width(16); c.stroke();
    c.save(); c.translate(-5, -205 + Math.sin(s * 2) * 2);
    rrect(c, -30, -110, 60, 115, 22); c.fill(); circ(c, 0, -138, 30); c.fill();
    c.save(); c.translate(0, -158); c.scale(1, 0.28); circ(c, 0, 0, 78); c.restore(); c.fill();
    c.move_to(-28, -160); c.curve_to(-28, -205, 28, -205, 28, -160); c.fill();
    rrect(c, -14, -10, 28, 95, 12); c.fill();
    c.restore(); c.restore();
  }
  var MTN1 = [[-100, 600], [150, 470], [330, 610], [560, 430], [760, 590], [980, 500], [1200, 610], [1500, 450], [1750, 600], [2000, 520]];
  var MTN2 = [[-100, 680], [300, 610], [650, 690], [1050, 630], [1400, 700], [1800, 620], [2100, 690]];
  var MTN_SIL = [[-100, 760], [260, 640], [520, 780], [900, 690], [1300, 790], [1600, 660], [2050, 760]];
  function groundWestern(c, w, dark) {
    var g = c.linear(0, 750, 0, DH), a = hexc(dark ? "3a3048" : "c98a5a"), b = hexc(dark ? "1e1828" : "8e5a3c");
    g.add_color_stop_rgba(0, a[0], a[1], a[2], 1); g.add_color_stop_rgba(1, b[0], b[1], b[2], 1);
    c.rectangle(-400, 757, DW + 800, DH); c.set_source(g); c.fill(); c.move_to(-400, 757); c.line_to(DW + 400, 757); stroke(c, 3);
    var tc = dark ? hexc("2a2238") : hexc("6e4a2e"); w.tufts.forEach(function (p) { tuft(c, p[0], p[1], tc); });
  }
  var BUILD_SETS = {
    western_town: [[60, 300, 300, "a8705a", "HOTEL"], [390, 340, 360, "c99a6e", "SALOON"], [1220, 300, 310, "8e6a5e", "BANK"], [1550, 330, 280, "b5805e", "GENERAL"]]
  };

  /** Set renderers: (c, env). env.layer(depth, fn) wraps parallax; env.w is the seeded world; env.t absolute time. */
  var SETS = {
    western_town: function (c, e) {
      var m = e.m, t = e.t;
      sky(c, m);
      e.layer(0.05, function () { if (e.mood === "night") stars(c, e.w, 0.7); });
      e.layer(0.1, function () { if (e.mood === "night") sun(c, 1500, 170, 55, m, true); else sun(c, 1380, 560, 70, m); });
      e.layer(0.15, function () { cloud(c, 200 + t * 8, 170, 1.0, hexc("d8708a", 0.5)); cloud(c, 1100 + t * 5, 120, 1.3, hexc("e48a7e", 0.45)); cloud(c, 1650 + t * 7, 260, 0.8, hexc("f2a07a", 0.55)); });
      e.layer(0.25, function () { mountains(c, 760, MTN1, hexc(m.far)); });
      e.layer(0.4, function () { mountains(c, 760, MTN2, hexc(m.near)); });
      e.layer(0.6, function () { BUILD_SETS.western_town.forEach(function (b) { building(c, b[0], b[1], b[2], hexc(b[3]), b[4]); }); });
      e.layer(0.85, function () { groundWestern(c, e.w, false); rrect(c, 1080, 830, 80, 104, 18); fs(c, hexc("8a5a36")); [852, 910].forEach(function (yy) { c.move_to(1082, yy); c.line_to(1158, yy); c.set_line_width(5); c.set_source_rgba(0.29, 0.23, 0.19, 1); c.stroke(); }); });
    },
    camp: function (c, e) {
      var m = MOODS.night, t = e.t; sky(c, m);
      e.layer(0.05, function () { stars(c, e.w, 0.8); });
      e.layer(0.1, function () { sun(c, 1560, 160, 50, m, true); });
      e.layer(0.3, function () { mountains(c, 760, [[-100, 640], [300, 520], [620, 650], [1000, 560], [1400, 660], [1800, 540], [2100, 640]], hexc("1c2448")); });
      e.layer(0.5, function () { for (var x = -40; x < DW + 80; x += 120) { poly(c, [[x, 760], [x + 50, 620 - ((x * 7) % 60 + 60) % 60], [x + 100, 760]]); c.set_source_rgba(0.08, 0.1, 0.21, 1); c.fill(); } });
      e.layer(0.85, function () {
        groundWestern(c, e.w, true);
        poly(c, [[1340, 820], [1500, 560], [1660, 820]]); fs(c, hexc("d8c8a0")); poly(c, [[1460, 820], [1500, 640], [1540, 820]]); fs(c, hexc("3a2a22"));
        var fl = 0.85 + 0.15 * Math.sin(t * 13) + 0.08 * Math.sin(t * 29); glow(c, 960, 900, 90, [1, 0.6, 0.25], 0.55 * fl, 6);
      });
    },
    silhouette: function (c, e) {
      var m = MOODS.gold, t = e.t; sky(c, m);
      e.layer(0.05, function () { e.w.stars.forEach(function (s) { circ(c, s[0], s[1] * 0.7, 1 + s[2]); c.set_source_rgba(1, 1, 1, 0.3 * s[2]); c.fill(); }); });
      e.layer(0.1, function () { sun(c, DW * 0.5, 780, 260, { light: [1, 0.7, 0.45] }); });
      e.layer(0.15, function () { cloud(c, 300 + t * 10, 220, 1.2, hexc("e07a86", 0.5)); cloud(c, 1350 + t * 6, 160, 1.4, hexc("e8907e", 0.45)); });
      e.layer(0.3, function () { mountains(c, 900, MTN_SIL, hexc("5a2d55")); });
      e.layer(0.85, function () { c.rectangle(-300, 860, DW + 600, DH); c.set_source_rgb(0.1, 0.06, 0.11); c.fill(); });
    },
    apartment: function (c, e) {
      var m = MOODS[e.mood === "night" ? "night" : e.mood === "dusk" ? "dusk" : "day"];
      e.layer(0.6, function () {
        wall(c, e.mood === "night" ? hexc("6a5a72") : hexc("c9a98a"), hexc("9a6a4a"));
        windowDraw(c, e.w, 1180, 170, 460, 380, m, e.mood === "night");
        framePic(c, 260, 220, 170, 130, hexc("e0b070")); framePic(c, 470, 260, 110, 150, hexc("8ab0c0"));
        lamp(c, 1760, 800, true); couch(c, 140, 820, hexc("5a7a8a")); plant(c, 1060, 800);
        if (e.mood === "night") { c.rectangle(-300, 0, DW + 600, DH); c.set_source_rgba(0.05, 0.05, 0.15, 0.25); c.fill(); }
      });
    },
    office: function (c, e) {
      var m = MOODS[e.mood === "night" ? "night" : e.mood === "dusk" ? "dusk" : "day"];
      e.layer(0.6, function () {
        wall(c, hexc("b9c4cc"), hexc("6a6a72"));
        windowDraw(c, e.w, 1260, 150, 520, 400, m, e.mood === "night");
        for (var i = 0; i < 9; i++) { c.rectangle(1260, 160 + i * 44, 520, 6); c.set_source_rgba(0.95, 0.95, 0.95, 0.5); c.fill(); }
        framePic(c, 300, 230, 220, 150, hexc("e0c060")); rrect(c, 330, 260, 160, 90, 2); c.set_source_rgba(0.48, 0.69, 0.42, 1); c.fill();
        c.move_to(340, 340); c.line_to(380, 310); c.line_to(420, 325); c.line_to(480, 270); stroke(c, 5, [1, 1, 1]);
        plant(c, 140, 800);
      });
    },
    street: function (c, e) {
      var m = MOODS[e.mood === "night" ? "night" : e.mood === "day" ? "day" : "dusk"], t = e.t;
      e.layer(0.6, function () { streetBg(c, e.w, m, t, e.mood === "night"); groundStreet(c); streetlamp(c, 220, e.mood !== "day"); streetlamp(c, 1640, e.mood !== "day"); });
    },
    dinner: function (c, e) {
      var m = MOODS[e.mood === "day" ? "day" : "night"];
      e.layer(0.6, function () {
        wall(c, hexc("b98a6a"), hexc("7a5236"));
        windowDraw(c, e.w, 760, 160, 400, 330, m, e.mood !== "day");
        glow(c, 960, 120, 60, [1, 0.85, 0.5], 0.5, 5); c.move_to(960, 0); c.line_to(960, 110); stroke(c, 3);
        poly(c, [[900, 140], [1020, 140], [990, 100], [930, 100]]); fs(c, hexc("f2d79a"));
        framePic(c, 260, 240, 180, 140, hexc("d0a070")); framePic(c, 1520, 240, 160, 180, hexc("a0c0a0"));
      });
    },
    stage: function (c, e) { e.layer(0.6, function () { stage(c); }); },
    plain: function (c, e) { e.layer(0.6, function () { plainBg(c, "3a2a4a", "140c18"); }); },
    roof: function (c, e) {
      var m = MOODS[e.mood === "night" ? "night" : e.mood === "day" ? "day" : "dusk"];
      e.layer(0.6, function () {
        sky(c, m); sun(c, DW * 0.55, 700, 200, m); stars(c, e.w, 0.25); skylineDraw(c, e.w, 860, m, true);
        c.rectangle(-300, 860, DW + 600, DH); c.set_source_rgb(0.1, 0.06, 0.11); c.fill();
        [200, 1500].forEach(function (x) { rrect(c, x, 790, 120, 70, 4); c.set_source_rgb(0.1, 0.06, 0.11); c.fill(); });
      });
    }
  };
  var SET_IDS = Object.keys(SETS), MOOD_IDS = ["dusk", "night", "day", "gold", "interior"];

  // ---- foreground props (drawn in the character layer, design coordinates of the landscape frame)
  var PROPS = {
    fire: function (c, e) {
      var t = e.t; [-0.4, 0.4].forEach(function (a) { c.save(); c.translate(960, 950); c.rotate(a); rrect(c, -70, -10, 140, 20, 8); fs(c, hexc("5a3a26")); c.restore(); });
      [[hexc("e8502a"), 1.0], [hexc("f6a03a"), 0.7], [hexc("ffe08a"), 0.4]].forEach(function (q, i) {
        var h = (90 + 14 * Math.sin(t * 11 + i)) * q[1], w_ = 52 * q[1], col = q[0];
        c.move_to(960 - w_, 945); c.curve_to(960 - w_, 945 - h * 0.6, 960 - 8 + 6 * Math.sin(t * 9), 945 - h * 0.8, 960 + 4 * Math.sin(t * 7 + i), 945 - h);
        c.curve_to(960 + 8, 945 - h * 0.7, 960 + w_, 945 - h * 0.5, 960 + w_, 945); c.close_path(); c.set_source_rgba(col[0], col[1], col[2], 1); c.fill();
      });
    },
    riders: function (c, e) {
      var lt = e.lt, pt = e.portrait;
      for (var i = 0; i < 3; i++) { c.save(); c.translate(pt ? 760 + lt * 40 - i * 250 : 300 + lt * 90 - i * 330, 870); if (pt) c.scale(0.62, 0.62); horseRider(c, e.t + i * 0.37); c.restore(); }
    },
    rider: function (c, e) { c.save(); c.translate(lerp(560, 1260, clamp(e.lt / Math.max(0.1, e.dur))), 870); c.scale(1.15, 1.15); horseRider(c, e.lt); c.restore(); },
    table: function (c) {
      rrect(c, 260, 820, 1400, 40, 10); fs(c, hexc("9a6a44")); rrect(c, 290, 860, 1340, 240, 0); fs(c, hexc("7a4e30"));
      [520, 900, 1300].forEach(function (x) { c.save(); c.translate(x, 818); c.scale(1, 0.3); circ(c, 0, 0, 70); c.restore(); fs(c, [0.97, 0.96, 0.93, 1]); });
    }
  };
  var PROP_IDS = Object.keys(PROPS);

  // ------------------------------------------------------------------ overlays
  var OV_TYPES = ["tag", "year", "stamp", "rating", "bubble", "caption", "title"];
  function pop(t, t0, d) { return backOut((t - t0) / (d || 0.28)); }
  function shadowRect(c, x, y, w, h, r, a) { c.save(); c.translate(6, 8); rrect(c, x, y, w, h, r); c.set_source_rgba(0, 0, 0, a === undefined ? 0.3 : a); c.fill(); c.restore(); }

  /** Size {w,h} of an overlay's body in its own (unscaled) units; used by drawing AND layout so they agree. */
  function ovSize(c, ov, u, W) {
    var sz, w, h, lines, lw, e, fitSize;
    switch (ov.type) {
      case "tag": case "year": c.font(38); e = c.text_extents(ov.text); w = Math.max(e.width, 140) + 52; if (ov.sub) { c.font(20, false); w = Math.max(w, c.text_extents(ov.sub).width + 52); } h = ov.sub ? 92 : 64; break;
      case "stamp": sz = ov.size || 34; c.font(sz); e = c.text_extents(ov.text); w = e.width + 56; h = sz * 2; break;
      case "rating": c.font(34); e = c.text_extents(ov.text); w = Math.max(e.width, 240) + 20; h = 120; break;
      case "bubble": sz = ov.size || 34; lines = wrapText(c, ov.text, sz, Math.min(ov.maxw || 620, (W * 0.84) / u - 80)); c.font(sz); lw = 0; lines.forEach(function (l) { lw = Math.max(lw, c.text_extents(l).x_advance); }); w = lw + 80; h = lines.length * sz * 1.3 + 46; break;
      case "caption": sz = ov.size || 46; lines = wrapText(c, ov.text, sz, Math.min(1400, (W * 0.92) / u - 72)); c.font(sz); lw = 0; lines.forEach(function (l) { lw = Math.max(lw, c.text_extents(l).x_advance); }); w = lw + 72; h = lines.length * sz * 1.25 + 34; break;
      default: sz = ov.size || 84; c.font(sz); e = c.text_extents(ov.text);
        if (e.width + 20 > (W * 0.92) / u) { sz = Math.floor(sz * ((W * 0.92) / u - 20) / e.width); c.font(sz); e = c.text_extents(ov.text); ov = { type: ov.type, size: sz }; }
        w = e.width + 20; h = sz * 1.25; fitSize = sz; break;
    }
    return { w: w * u, h: h * u, rw: w, rh: h, lines: lines, lw: lw, fit: fitSize };
  }

  function drawOverlay(c, ov, lt, box, u, W) {
    var t0 = ov.t0, t1 = ov.t1, sz, s, e, k;
    if (lt < t0 || (t1 !== undefined && lt > t1 + 0.01)) return;
    var out = t1 !== undefined ? 1 - ease((lt - (t1 - 0.2)) / 0.2) : 1;
    var sizeInfo = box.size, x = box.cx, y = box.cy, rot = ov.rot === undefined ? (ov.type === "stamp" ? 0.07 : ov.type === "year" ? -0.08 : -0.04) : ov.rot;
    c.save(); c.translate(x, y); c.scale(u, u);
    if (ov.type === "tag" || ov.type === "year") {
      s = pop(lt, t0) * out; c.rotate(rot); c.scale(S(s), S(s));
      var w = sizeInfo.rw, h = sizeInfo.rh;
      shadowRect(c, -w / 2, -h / 2, w, h, 14); rrect(c, -w / 2, -h / 2, w, h, 14); c.set_source_rgb(0.98, 0.97, 0.94); c.fill_preserve(); stroke(c, 4);
      textC(c, ov.text, 0, ov.sub ? -6 : 14, 38); if (ov.sub) textC(c, ov.sub, 0, 30, 20, [0.35, 0.3, 0.28], false);
    } else if (ov.type === "stamp") {
      sz = ov.size || 34; var colr = ov.color ? hexc(ov.color) : [0.78, 0.15, 0.13, 1], dt = lt - t0;
      var sc = dt < 0.18 ? lerp(2.2, 1, ease(dt / 0.18)) : 1, a = clamp(dt / 0.12) * out;
      c.rotate(rot); c.scale(sc, sc);
      var sw = sizeInfo.rw, sh = sizeInfo.rh;
      rrect(c, -sw / 2, -sh / 2, sw, sh, 6); c.set_source_rgba(0.98, 0.95, 0.88, 0.95 * a); c.fill();
      [0, 7].forEach(function (o) { rrect(c, -sw / 2 + o / 2, -sh / 2 + o / 2, sw - o, sh - o, 6); c.set_source_rgba(colr[0], colr[1], colr[2], a); c.set_line_width(o === 0 ? 5 : 2.5); c.stroke(); });
      textC(c, ov.text, 0, sz * 0.36, sz, [colr[0], colr[1], colr[2], a]);
    } else if (ov.type === "rating") {
      var a2 = clamp((lt - t0) / 0.25) * out; c.font(34); e = c.text_extents(ov.text);
      c.translate(0, -sizeInfo.rh / 2 + 34);
      c.move_to(-e.width / 2 - e.x_bearing + 3, 3); c.set_source_rgba(0, 0, 0, 0.4 * a2); c.show_text(ov.text);
      c.move_to(-e.width / 2 - e.x_bearing, 0); c.set_source_rgba(1, 1, 1, a2); c.show_text(ov.text);
      var count = Math.max(1, Math.min(5, ov.stars || 5));
      for (var i = 0; i < count; i++) {
        s = backOut((lt - t0 - 0.25 - i * 0.12) / 0.25) * out; if (s <= 0) continue;
        c.save(); c.translate(-(count - 1) * 24 + i * 48, 46); c.scale(S(s), S(s));
        var pts = []; for (var j = 0; j < 10; j++) { var rr = j % 2 === 0 ? 20 : 9; pts.push([rr * Math.cos(-PI / 2 + j * PI / 5), rr * Math.sin(-PI / 2 + j * PI / 5)]); }
        poly(c, pts); c.set_source_rgba(1, 0.84, 0.3, 1); c.fill_preserve(); stroke(c, 2.5); c.restore();
      }
    } else if (ov.type === "bubble") {
      s = pop(lt, t0, 0.3) * out; c.scale(S(s), S(s)); c.rotate(-0.02);
      var bw = sizeInfo.rw, bh = sizeInfo.rh, lines = sizeInfo.lines, tip = box.tip;
      var nch = Math.floor(ov.text.length * clamp((lt - t0) / Math.min(1.2, ((t1 === undefined ? t0 + 3 : t1) - t0) * 0.4)));
      shadowRect(c, -bw / 2, -bh / 2, bw, bh, Math.min(bh / 2, 45), 0.2);
      var bx = 0;
      if (tip && !ov.think) {
        bx = clamp(tip[0] / u * 0.3, -bw / 2 + 50, bw / 2 - 80);
        c.move_to(bx - 26, bh / 2 - 6); c.line_to(tip[0] / u, tip[1] / u); c.line_to(bx + 26, bh / 2 - 6); c.close_path(); c.set_source_rgb(0.99, 0.99, 0.97); c.fill_preserve(); stroke(c, 4);
      } else if (tip && ov.think) {
        [16, 11, 7].forEach(function (r, ii) { var fx = lerp(0, tip[0] / u, 0.45 + ii * 0.2), fy = lerp(bh / 2, tip[1] / u, 0.45 + ii * 0.2); circ(c, fx, fy, r); c.set_source_rgb(0.99, 0.99, 0.97); c.fill_preserve(); stroke(c, 3.5); });
      }
      rrect(c, -bw / 2, -bh / 2, bw, bh, Math.min(bh / 2, 45)); c.set_source_rgb(0.99, 0.99, 0.97); c.fill_preserve(); stroke(c, 4);
      if (tip && !ov.think) { c.move_to(bx - 22, bh / 2 - 2); c.line_to(bx + 22, bh / 2 - 2); c.set_source_rgb(0.99, 0.99, 0.97); c.set_line_width(8); c.stroke(); }
      var shown = 0; c.font(ov.size || 34);
      lines.forEach(function (l, li) {
        var part = l.slice(0, Math.max(0, nch - shown)); shown += l.length + 1;
        c.move_to(-sizeInfo.lw / 2, -bh / 2 + 23 + (ov.size || 34) * 1.05 + li * (ov.size || 34) * 1.3); c.set_source_rgb(LINE[0], LINE[1], LINE[2]); c.show_text(part);
      });
    } else if (ov.type === "caption") {
      s = pop(lt, t0, 0.3) * out; c.scale(S(s), S(s)); c.rotate(-0.012);
      var cw = sizeInfo.rw, ch = sizeInfo.rh; sz = ov.size || 46;
      rrect(c, -cw / 2, -ch / 2, cw, ch, 12); c.set_source_rgba(0.1, 0.07, 0.1, 0.82); c.fill();
      sizeInfo.lines.forEach(function (l, li) { textC(c, l, 0, -ch / 2 + 17 + sz * 0.95 + li * sz * 1.25, sz, [1, 1, 1]); });
    } else { // title (big word)
      sz = sizeInfo.fit || ov.size || 84; s = pop(lt, t0) * out; c.rotate(-0.03); c.scale(S(s), S(s)); c.font(sz); e = c.text_extents(ov.text);
      var tc = ov.color ? hexc(ov.color) : [1, 0.86, 0.35, 1];
      c.move_to(-e.width / 2 - e.x_bearing + 5, 7 + sz * 0.3); c.set_source_rgba(0, 0, 0, 0.45); c.show_text(ov.text);
      c.move_to(-e.width / 2 - e.x_bearing, sz * 0.3); c.set_source_rgba(tc[0], tc[1], tc[2], 1); c.show_text(ov.text);
    }
    c.restore();
  }

  // ------------------------------------------------------------------ layout (frame geometry, shots, cast, overlay slots)
  function dims(spec) { var portrait = spec.aspect === "9:16"; return { W: portrait ? 1080 : 1920, H: portrait ? 1920 : 1080, portrait: portrait }; }

  /** Where each cast member stands on screen (feet position and scale), re-framed for the aspect. */
  function placeCast(spec, shot) {
    var D = dims(spec), n = shot.cast.length, out = [];
    shot.cast.forEach(function (ch, i) {
      var chibi = (ARCHETYPES[ch.archetype] || {}).chibi || (ch.look && ch.look.chibi === true);
      var s = ch.scale || 1.25, x, y, sc;
      if (!D.portrait) { x = (ch.x === undefined ? (i + 0.5) / n : ch.x) * D.W; y = D.H * 0.958; sc = s; }
      else {
        // ~60% of frame height for a lone hero; shrink so several characters still fit across the 1080px width.
        var order = shot.cast.map(function (q, qi) { return { qi: qi, x: q.x === undefined ? (qi + 0.5) / n : q.x }; }).sort(function (a, b) { return a.x - b.x; });
        var rank = order.findIndex(function (q) { return q.qi === i; });
        // spread evenly about the centre; shrink so n characters (about 190px wide each at scale 1) fit the 1080px frame
        x = D.W * (0.5 + (rank - (n - 1) / 2) * (0.9 / Math.max(n, 1)) * (n === 1 ? 0 : 1));
        var fitW = (0.92 * D.W) / (n * 190);
        sc = Math.min((0.6 * D.H) / 470 * (s / 1.25) * (chibi ? 1.6 : 1), fitW * (chibi ? 1.5 : 1));
        y = D.H * 0.9;
      }
      out.push({ x: x, y: y, s: sc, chibi: !!chibi });
    });
    return out;
  }
  /** Head bounding box in frame px (generous: includes hats). */
  function headBox(pl, ch) {
    var d = resolveLook(ch.archetype, ch.look), s = pl.s, hat = d.stetson || d.tophat || d.cap;
    var cy, rx, top, bot;
    if (d.chibi) { cy = pl.y - 247 * s; rx = 66 * s; top = cy - 66 * s; bot = cy + 62 * s; }
    else { cy = pl.y - 466 * s; rx = (d.stetson ? 92 : d.tophat ? 70 : 54) * s; top = cy - (hat ? (d.tophat ? 140 : d.stetson ? 100 : 78) : 78) * s; bot = cy + 66 * s; }
    return { x0: pl.x - rx, y0: top, x1: pl.x + rx, y1: bot };
  }
  /** Boxes around each arm (shoulder, elbow, hand) for one pose, in frame px, so raised hands count as obstacles too. */
  function armBoxes(pl, ch, pose) {
    var d = resolveLook(ch.archetype, ch.look), wid = d.chubby ? 1.25 : 1, legh = d.chibi ? 150 : 230, sc = pl.s * (d.chibi ? 0.62 : 1), flip = ch.flip ? -1 : 1, out = [];
    [[-52 * wid, pose.ba1, pose.ba2], [52 * wid, pose.fa1, pose.fa2]].forEach(function (a) {
      var sx = a[0], sy = -150, ex = sx - Math.sin(a[1]) * 84, ey = sy + Math.cos(a[1]) * 84, hx = ex - Math.sin(a[1] + a[2]) * 84, hy = ey + Math.cos(a[1] + a[2]) * 84;
      var xs = [sx, ex, hx].map(function (x) { return pl.x + flip * x * sc; }), ys = [sy, ey, hy].map(function (y) { return pl.y + (y - legh + 2) * sc; }), pad = 30 * sc;
      out.push({ x0: Math.min.apply(null, xs) - pad, x1: Math.max.apply(null, xs) + pad, y0: Math.min.apply(null, ys) - pad, y1: Math.max.apply(null, ys) + pad });
    });
    return out;
  }
  function overlap(a, b, pad) { pad = pad || 0; return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad; }

  var layoutCache = typeof WeakMap === "function" ? new WeakMap() : null;
  var SAMPLES = [0, 0.2, 0.4, 0.6, 0.8, 1];
  /** Camera maths shared by layout, drawing and QC: shot progress p -> zoom z, frame focus, depth transform. */
  function camOf(spec, shot) {
    var D = dims(spec), zoom = shot.zoom || [1.0, 1.12], dur = Math.max(0.001, shot.t1 - shot.t0);
    var fx = D.W / 2, fy = D.H * (D.portrait ? 0.62 : 0.58);
    return {
      fx: fx, fy: fy, dur: dur,
      /** frame-space box of a pre-camera box `b` drawn at parallax `depth`, at shot progress p */
      proj: function (b, depth, p) {
        var z = lerp(zoom[0], zoom[1], ease(p)), zz = 1 + (z - 1) * depth, sx = -p * dur * 5 * depth;
        return { x0: fx + (b.x0 + sx - fx) * zz, x1: fx + (b.x1 + sx - fx) * zz, y0: fy + (b.y0 - fy) * zz, y1: fy + (b.y1 - fy) * zz };
      },
      /** inverse for a point: where must a pre-camera point sit so it lands on frame point (x, y) at progress p */
      unproj: function (x, y, depth, p) {
        var z = lerp(zoom[0], zoom[1], ease(p)), zz = 1 + (z - 1) * depth, sx = -p * dur * 5 * depth;
        return [fx + (x - fx) / zz - sx, fy + (y - fy) / zz];
      }
    };
  }
  /** Deterministic overlay placement, once per spec: a pure function of the spec (no time input). Candidates are
      tested against the cast's heads and the other overlays across the whole camera push-in (6 samples). */
  function layoutSpec(c, spec) {
    // Text widths feed the layout, so the cache is keyed by a font probe: if the webfont finishes loading after
    // the first call, the layout is recomputed (still a pure function of spec + loaded font).
    c.font(38); var sig = c.ctx.measureText("Wagging the dog MW").width;
    if (layoutCache && layoutCache.has(spec) && layoutCache.get(spec).sig === sig) return layoutCache.get(spec);
    var D = dims(spec), u = D.portrait ? 0.8 : 1, byShot = new Map();
    var xsP = [0.5, 0.27, 0.73], ysP = [0.07, 0.13, 0.19, 0.25, 0.94, 0.97], slots = [];
    if (D.portrait) { ysP.forEach(function (y) { xsP.forEach(function (x) { slots.push([x, y]); }); }); }
    else slots = [[0.2, 0.17], [0.8, 0.17], [0.5, 0.12], [0.17, 0.42], [0.83, 0.42], [0.5, 0.28], [0.3, 0.3], [0.7, 0.3], [0.12, 0.62], [0.88, 0.62], [0.5, 0.06], [0.2, 0.08], [0.8, 0.08], [0.3, 0.95], [0.7, 0.95]];
    spec.shots.forEach(function (shot) {
      var cam = camOf(spec, shot), dur = cam.dur, pl = placeCast(spec, shot);
      var heads = shot.cast.map(function (ch, i) { return headBox(pl[i], ch); });
      // arms in every pose the cast takes during the shot (conservative: a raised hand blocks its space all shot)
      var arms = []; shot.cast.forEach(function (ch, i) {
        var names = [ch.pose || "idle"].concat((ch.gestures || []).map(function (g) { return g.pose; }));
        names.forEach(function (n) { armBoxes(pl[i], ch, POSES[n] || POSES.idle).forEach(function (b) { arms.push(b); }); });
      });
      var obstacles = heads.concat(arms);
      var margin = 24, topM = D.portrait ? 110 : 36, botM = 36, boxes = [], placed = [];
      // Burned-in subtitles own a band at the bottom: tags, stamps and ratings keep out of it (explicit caption/title overlays live there).
      var band = spec.captionBand > 0 ? D.H * Math.min(0.3, spec.captionBand) : 0, curBot = botM;
      var order = (shot.overlays || []).map(function (ov, idx) { return { ov: ov, idx: idx, fixed: ov.type === "caption" || ov.type === "title" ? 0 : (ov.target !== undefined || ov.speaker !== undefined || ov.at ? 1 : 2) }; })
        .sort(function (a, b) { return a.fixed - b.fixed || a.ov.t0 - b.ov.t0 || a.idx - b.idx; });
      function bbAt(cx, cy, size) { return { x0: cx - size.w / 2 - 14 * u, x1: cx + size.w / 2 + 14 * u, y0: cy - size.h / 2 - 14 * u, y1: cy + size.h / 2 + 14 * u }; }
      function inFrame(bb) { return SAMPLES.every(function (p) { var q = cam.proj(bb, 0.85, p); return q.x0 >= margin && q.x1 <= D.W - margin && q.y0 >= topM && q.y1 <= D.H - curBot; }); }
      function clearOfHeads(bb) { return SAMPLES.every(function (p) { var q = cam.proj(bb, 0.85, p); return obstacles.every(function (h) { return !overlap(q, cam.proj(h, 1.0, p), 22); }); }); }
      order.forEach(function (it) {
        var ov = it.ov, size = ovSize(c, ov, u, D.W), end = ov.t1 === undefined ? dur : ov.t1, cands = [], chosen = null;
        var focus = null;
        if (ov.type === "bubble" && ov.speaker !== undefined && heads[ov.speaker]) focus = heads[ov.speaker];
        else if (ov.type !== "bubble" && ov.target !== undefined && heads[ov.target]) focus = heads[ov.target];
        function frameToPre(fxp, fyp) { var q = cam.unproj(fxp, fyp, 0.85, 0.5); return q; }
        if (ov.type === "caption") cands.push([D.W * 0.5, D.H * (D.portrait ? 0.945 : 0.85)]);
        else if (ov.type === "title") cands.push([D.W * 0.5, D.H * (D.portrait ? 0.14 : 0.27)]);
        if (ov.at) cands.push([ov.at.x * D.W, ov.at.y * D.H]);
        if (focus) {
          var hb = cam.proj(focus, 1.0, 0.5), hx = (hb.x0 + hb.x1) / 2, hy = (hb.y0 + hb.y1) / 2, gap = 70, edge = 62, sw = size.w, sh = size.h;
          var around = ov.type === "bubble"
            ? [[hx - sw * 0.25, hb.y0 - sh / 2 - gap], [hx + sw * 0.25, hb.y0 - sh / 2 - gap], [hx - sw * 0.7, hb.y0 - sh / 2 - gap], [hx + sw * 0.7, hb.y0 - sh / 2 - gap], [hx, hb.y0 - sh / 2 - gap - sh]]
            : [[hx, hb.y0 - sh / 2 - edge], [hb.x0 - sw / 2 - edge, hy], [hb.x1 + sw / 2 + edge, hy], [hb.x0 - sw / 2 - edge, hb.y0 - sh / 2 - edge], [hb.x1 + sw / 2 + edge, hb.y0 - sh / 2 - edge], [hx, hb.y0 - sh * 1.5 - edge]];
          // more rows and sideways offsets above the head, so a long bubble can slide toward the frame centre
          [0, 1, 2].forEach(function (row) { [-0.9, -0.7, -0.5, -0.25, 0, 0.25, 0.5, 0.7, 0.9].forEach(function (k) { around.push([hx + k * sw, hb.y0 - sh / 2 - (ov.type === "bubble" ? gap : edge) - row * (sh + 12)]); }); });
          around.forEach(function (q) { var pre = frameToPre(q[0], q[1]); cands.push([pre[0], pre[1]]); });
        }
        if (!focus) slots.forEach(function (q) { cands.push([q[0] * D.W, q[1] * D.H]); });
        // systematic fallback: a grid over the frame, nearest the focus (or the frame centre) first, so a free spot is
        // always found when one exists.
        var grid = [], gcx = focus ? (focus.x0 + focus.x1) / 2 : D.W / 2, gcy = focus ? (focus.y0 + focus.y1) / 2 : D.H / 2;
        for (var gy = 0.05; gy <= 0.97; gy += 0.04) for (var gx = 0.06; gx <= 0.95; gx += 0.04) grid.push([gx * D.W, gy * D.H]);
        grid.sort(function (a, b) { return Math.hypot(a[0] - gcx, a[1] - gcy) - Math.hypot(b[0] - gcx, b[1] - gcy) || a[1] - b[1] || a[0] - b[0]; });
        grid.forEach(function (q) { var pre = frameToPre(q[0], q[1]); cands.push([pre[0], pre[1]]); });
        // The subtitle band is a preference: first look for a free spot outside it, then anywhere in the frame.
        for (var pass = 0; pass < 2 && !chosen; pass++) {
          curBot = pass === 0 && !(ov.type === "caption" || ov.type === "title") ? botM + band : botM;
          for (var ci = 0; ci < cands.length && !chosen; ci++) {
            var cx = cands[ci][0], cy = cands[ci][1], bb = bbAt(cx, cy, size);
            if (!inFrame(bb)) continue;
            var ok = clearOfHeads(bb);
            for (var pi = 0; ok && pi < placed.length; pi++) { var pp = placed[pi]; if (pp.start < end + 0.25 && pp.end + 0.25 > ov.t0 && overlap(bb, pp.bb, 10)) ok = false; }
            if (ok) chosen = { cx: cx, cy: cy, bb: bb };
          }
        }
        curBot = botM;
        var failed = false;
        if (!chosen) { // nothing collision-free: keep the first in-frame candidate and flag it for QC
          failed = true;
          for (var cj = 0; cj < cands.length && !chosen; cj++) { var bb2 = bbAt(cands[cj][0], cands[cj][1], size); if (inFrame(bb2)) chosen = { cx: cands[cj][0], cy: cands[cj][1], bb: bb2 }; }
          if (!chosen) chosen = { cx: D.W / 2, cy: D.H / 2, bb: bbAt(D.W / 2, D.H / 2, size) };
        }
        var tip = null;
        if (ov.type === "bubble" && focus) { var hc = [(focus.x0 + focus.x1) / 2, focus.y0 + (focus.y1 - focus.y0) * 0.45]; tip = [Math.max(-size.w, Math.min(size.w, hc[0] - chosen.cx)), hc[1] - chosen.cy]; }
        placed.push({ start: ov.t0, end: end, bb: chosen.bb });
        boxes[it.idx] = { cx: chosen.cx, cy: chosen.cy, size: size, tip: tip, bb: chosen.bb, failed: failed };
      });
      byShot.set(shot, boxes);
    });
    var out = { u: u, byShot: byShot, sig: sig };
    if (layoutCache) layoutCache.set(spec, out);
    return out;
  }

  // ------------------------------------------------------------------ timelines for cast
  function poseAt(ch, lt) {
    var cur = POSES[ch.pose] || POSES.idle, keys = (ch.gestures || []).slice().sort(function (a, b) { return a.t - b.t; });
    var seq = [], prev = ch.pose || "idle";
    keys.forEach(function (g) { seq.push({ t: g.t, pose: g.pose }); if (g.hold !== undefined) seq.push({ t: g.t + g.hold, pose: prev, ret: true }); if (g.hold === undefined) prev = g.pose; });
    seq.sort(function (a, b) { return a.t - b.t; });
    var from = POSES[ch.pose] || POSES.idle, fromName = ch.pose || "idle";
    var result = null;
    for (var i = 0; i < seq.length; i++) {
      var g = seq[i]; if (lt < g.t) break;
      var tgt = POSES[g.pose] || POSES.idle, k = ease((lt - g.t) / 0.45);
      if (k < 1) { result = blend(from, tgt, k, fromName); break; }
      from = tgt; fromName = g.pose;
    }
    return result || from;
  }
  function blend(a, b, k) { var p = {}; ["ba1", "ba2", "fa1", "fa2"].forEach(function (key) { p[key] = lerp(a[key], b[key], k); }); p.both_front = k > 0.5 ? !!b.both_front : !!a.both_front; return p; }
  function exprAt(ch, lt) {
    var name = ch.expr || "neutral"; (ch.expressions || []).slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (e) { if (lt >= e.t) name = e.expr; });
    return name;
  }

  // ------------------------------------------------------------------ frame
  function shotAt(spec, t) {
    for (var i = 0; i < spec.shots.length; i++) if (t >= spec.shots[i].t0 && t < spec.shots[i].t1) return i;
    return t < spec.shots[0].t0 ? 0 : spec.shots.length - 1;
  }

  function drawShot(c, spec, shot, t, lay) {
    var D = dims(spec), W = D.W, H = D.H, lt = t - shot.t0, dur = Math.max(0.001, shot.t1 - shot.t0);
    var zoom = shot.zoom || [1.0, 1.12], z = lerp(zoom[0], zoom[1], ease(lt / dur));
    var fx = W / 2, fy = H * (D.portrait ? 0.62 : 0.58), k = D.portrait ? H / DH : 1;
    var moodName = MOOD_IDS.indexOf(shot.mood) >= 0 ? shot.mood : "dusk", m = MOODS[moodName === "interior" ? "day" : moodName];
    var w = world(spec.seed || 1, W, H);
    function cam(depth) { var zz = 1 + (z - 1) * depth; c.translate(fx, fy); c.scale(zz, zz); c.translate(-fx - lt * 5 * depth, -fy); }
    function base() { if (D.portrait) { c.translate(W / 2 - (DW / 2) * k, 0); c.scale(k, k); } }
    // background: parallax layers around the frame focus
    var env = { m: mdl(m), w: w, t: t, lt: lt, dur: dur, mood: moodName, layer: function (depth, fn) { c.save(); cam(depth); base(); fn(); c.restore(); } };
    function mdl(mm) { var o = {}; for (var kk in mm) o[kk] = mm[kk]; return o; }
    c.save(); (SETS[shot.set] || SETS.plain)(c, env); c.restore();
    // cast + props
    var placed = placeCast(spec, shot);
    c.save(); cam(1.0);
    shot.cast.forEach(function (ch, i) {
      var pl = placed[i], d = resolveLook(ch.archetype, ch.look), seed = i + Math.floor(pl.x) % 7;
      c.save(); c.translate(pl.x, pl.y); c.scale(pl.s, pl.s);
      c.save(); c.scale(1, 0.16); circ(c, 0, 0, 110); c.set_source_rgba(0, 0, 0, 0.22); c.fill(); c.restore();
      var exName = exprAt(ch, lt), ex = {}, src = EXPR[exName] || EXPR.neutral, kk;
      for (kk in src) ex[kk] = src[kk];
      var blink = ((t + seed * 1.37) % 3.6) < 0.13;
      var talking = (ch.talk || []).some(function (r) { return lt >= r[0] && lt <= r[1]; });
      if (talking && Math.floor(lt * 8) % 2 === 0) ex.mouth_o = true;
      // one-shot gestures nudge the hat for a hat tip
      var pose = poseAt(ch, lt);
      var tipK = 0; (ch.gestures || []).forEach(function (g) { if (g.pose === "hat_tip") { var a = ease((lt - g.t) / 0.45) * (g.hold === undefined ? 1 : 1 - ease((lt - g.t - g.hold) / 0.45)); tipK = Math.max(tipK, a); } });
      if (tipK > 0) { ex.hat_rot = -0.13 * tipK; ex.hat_dy = 4 * tipK; ex.smile = Math.max(ex.smile || 0, 5 * tipK); }
      character(c, d, t, pose, ex, blink, !!ch.flip, seed);
      c.restore();
    });
    (shot.props || []).forEach(function (p) { if (PROPS[p]) { c.save(); if (D.portrait) { c.translate(W / 2 - (DW / 2) * k, 0); c.scale(k, k); } PROPS[p](c, { t: t, lt: lt, dur: dur, portrait: D.portrait }); c.restore(); } });
    c.restore();
    var wc = MOODS[moodName === "interior" ? "day" : moodName].dust; dustDraw(c, w, W, H, t, wc); vignette(c, W, H, 0.6);
    // overlays follow the camera loosely so tags stay attached
    var boxes = lay.byShot.get(shot) || [];
    c.save(); cam(0.85);
    (shot.overlays || []).forEach(function (ov, idx) { if (boxes[idx]) drawOverlay(c, ov, lt, { cx: boxes[idx].cx, cy: boxes[idx].cy, size: boxes[idx].size, tip: boxes[idx].tip }, lay.u, W); });
    c.restore();
  }

  function drawFrame(ctx, spec, t) {
    var D = dims(spec), c = new Cr(ctx), W = D.W, H = D.H;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); ctx.beginPath();
    var lay = layoutSpec(c, spec), si = shotAt(spec, t), shot = spec.shots[si], dur = spec.duration;
    drawShot(c, spec, shot, t, lay);
    var f = 0, last = si === spec.shots.length - 1, first = si === 0;
    if (!first && shot.transition !== "cut") f = Math.max(f, 1 - ease((t - shot.t0) / 0.3));
    if (!last && spec.shots[si + 1].transition !== "cut") f = Math.max(f, ease((t - (shot.t1 - 0.25)) / 0.25));
    f = Math.max(f, 1 - ease(t / (spec.fadeIn === undefined ? 0.6 : spec.fadeIn)), ease((t - (dur - (spec.fadeOut === undefined ? 0.8 : spec.fadeOut))) / (spec.fadeOut === undefined ? 0.8 : spec.fadeOut)));
    if (f > 0) { ctx.fillStyle = "rgba(0,0,0," + clamp(f) + ")"; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  /** Frame-space boxes of everything that must not collide at time t (for QC and tests). */
  function collectBoxes(ctx, spec, t) {
    var c = new Cr(ctx), lay = layoutSpec(c, spec), si = shotAt(spec, t), shot = spec.shots[si], cam = camOf(spec, shot);
    var lt = t - shot.t0, p = clamp(lt / cam.dur), pl = placeCast(spec, shot);
    var heads = shot.cast.map(function (ch, i) { return { id: "head:" + (ch.id || i), box: cam.proj(headBox(pl[i], ch), 1.0, p) }; });
    shot.cast.forEach(function (ch, i) { armBoxes(pl[i], ch, poseAt(ch, lt)).forEach(function (b, k) { heads.push({ id: "arm" + (k ? "R" : "L") + ":" + (ch.id || i), box: cam.proj(b, 1.0, p) }); }); });
    var ovs = [], boxes = lay.byShot.get(shot) || [];
    (shot.overlays || []).forEach(function (ov, idx) {
      var b = boxes[idx]; if (!b) return; var end = ov.t1 === undefined ? cam.dur : ov.t1;
      if (lt >= ov.t0 && lt <= end) ovs.push({ id: ov.type + ":" + idx, type: ov.type, box: cam.proj({ x0: b.cx - b.size.w / 2, x1: b.cx + b.size.w / 2, y0: b.cy - b.size.h / 2, y1: b.cy + b.size.h / 2 }, 0.85, p), failed: b.failed });
    });
    return { heads: heads, overlays: ovs, shot: si };
  }

  var api = { drawFrame: drawFrame, collectBoxes: collectBoxes, overlap: overlap, ARCHETYPES: Object.keys(ARCHETYPES), POSES: Object.keys(POSES), EXPRESSIONS: Object.keys(EXPR), SETS: SET_IDS, MOODS: MOOD_IDS, PROPS: PROP_IDS, OVERLAYS: OV_TYPES, HAIRS: HAIRS, DESIGN: [DW, DH], dims: dims };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CutoutKit = api;
})(typeof window !== "undefined" ? window : globalThis);
