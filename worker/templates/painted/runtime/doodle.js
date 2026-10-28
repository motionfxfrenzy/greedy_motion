/*
 * Doodle scenes: the same shot description the painted scenes draw (place, time, weather, season, room, people, props, framing),
 * drawn as an animated hand drawing instead: flat marker fills laid in passes, a heavy ink contour that grows along each edge and
 * re-wobbles every third frame ("boil"), the scenery first, then props, then people. Positions come from the same layout solver
 * (PaintedLayout.compose), the palettes from the same TIMES and WEATHER tables, so the director and the rule layer do not change:
 * only the rendering layer does. The mark-making is a MEDIUM (spec.doodle: marker, pencil, crayon, woodcut, chalk, flat).
 * Own code, Canvas 2D only; no anidoodle source is copied (the look follows its marker-comic films).
 */
(function () {
  const { mix } = window.PaintedKit, clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const INK = "#15122a";
  const lum = (c) => { const n = parseInt(c.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

  // ---- the media: how marks are made. fill: flat | wash | hatch | none. tone(c) maps every colour into the medium's palette.
  const MEDIA = {
    marker:  { paper: "#fbf9f3", line: INK, lw: 1, fill: "flat", jitter: 1.6, tone: (c) => c },
    flat:    { paper: "#fbf9f3", line: null, lw: 0, fill: "flat", jitter: 0.8, tone: (c) => mix(c, "#ffffff", 0.06) },
    crayon:  { paper: "#f6efe0", line: "#3a2a22", lw: 1.25, fill: "hatch", jitter: 3.2, tone: (c) => mix(c, "#f6efe0", 0.12) },
    pencil:  { paper: "#f7f4ec", line: "#3d3437", lw: 0.7, fill: "wash", jitter: 2.4, tone: (c) => mix(mix(c, "#8a8a90", 0.4), "#f7f4ec", 0.22) },
    woodcut: { paper: "#e9dcbc", line: "#1b120c", lw: 1.5, fill: "hatch", jitter: 2.0, tone: (c) => { const l = lum(c), n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, red = r > g * 1.5 && r > b * 1.6; return l < 0.3 ? "#1b120c" : l < 0.55 ? (red ? "#b5472f" : "#4a3a2a") : l < 0.78 ? (red ? "#b5472f" : "#c9a572") : "#e9dcbc"; } },   // skin and stone are tan; only real reds take the red ink
    chalk:   { paper: "#20302d", line: "#f4f4ee", lw: 0.8, fill: "wash", jitter: 2.2, tone: (c) => mix(c, "#f4f4ee", 0.35) },
    broken:       { paper: "#f6efe0", line: "#4a3a2e", lw: 1.1, fill: "broken", contour: "own", jitter: 2.6, tone: (c) => c },   // broken colour in crayon: every shape is laid in short strokes of neighbouring tints over a soft base, outlined in a darker crayon of its own colour
    ballpoint:    { paper: "#f6f4ee", line: "#27358a", lw: 0.5, fill: "hatch", hatchColor: "#4a5ab0", hatchBase: 0.93, hatchGap: 12, hatchW: 1.5, jitter: 2.2, tone: (c) => c },
    charcoal:     { paper: "#eeebe4", line: "#262626", lw: 0.9, fill: "wash", jitter: 3.2, tone: (c) => { const g = Math.round(255 * (0.14 + 0.7 * lum(c))).toString(16).padStart(2, "0"); return "#" + g + g + g; } },
    cyanotype:    { paper: "#0d3b7e", line: "#eaf3ff", lw: 0.8, fill: "flat", jitter: 1.8, tone: (c) => mix("#0a2f66", "#a9d0ff", lum(c)) },
    sumie:        { paper: "#f2ecdc", line: "#151515", lw: 1.1, fill: "flat", jitter: 3.4, tone: (c) => { const l = lum(c); return l < 0.3 ? "#1a1a1a" : l < 0.55 ? "#8d8b84" : "#f2ecdc"; } },
    pixel:        { paper: "#fbf9f3", line: INK, lw: 1.2, fill: "flat", jitter: 0, pixel: 6, tone: (c) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) / 64) * 64).map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("") },
    riso:         { paper: "#f5efe2", line: "#243a9a", lw: 0.9, fill: "flat", jitter: 1.6, tone: (c) => { const l = lum(c); return l < 0.25 ? "#243a9a" : l < 0.5 ? "#e8456a" : l < 0.75 ? "#f5a93b" : "#f5efe2"; } },
    scratchboard: { paper: "#101014", line: "#f6f3ea", lw: 1, fill: "hatch", hatchColor: "#f6f3ea", hatchBase: 0.3, hatchGap: 9, hatchW: 1.8, jitter: 1.8, tone: (c) => mix("#17171c", "#f1efe6", 0.22 + 0.72 * lum(c)) },
    engraving:    { paper: "#f4f0e8", line: "#1b1b1b", lw: 0.6, fill: "hatch", hatchColor: "#1b1b1b", hatchBase: 1, hatchGap: 9, hatchW: 1.5, jitter: 1, tone: (c) => c },
  };

  // ---- geometry
  let seedN = 0; const S = () => 100 + 17 * ++seedN;
  const rng = (seed) => { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const wob = (pts, amp, seed) => { const r = rng(seed); return pts.map(([x, y]) => [x + (r() - 0.5) * amp * 2, y + (r() - 0.5) * amp * 2]); };
  const spline = (pts, closed, per = 5) => {
    const n = pts.length, out = [], at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    for (let i = 0; i < (closed ? n : n - 1); i++) for (let k = 0; k < per; k++) { const t = k / per, a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2); out.push([0, 1].map((q) => 0.5 * (2 * b[q] + (-a[q] + c[q]) * t + (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t * t + (-a[q] + 3 * b[q] - 3 * c[q] + d[q]) * t * t * t))); }
    if (!closed) out.push(pts[n - 1]); return out;
  };
  const cut = (pts, q) => { if (q >= 1) return pts; const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); const want = cum[cum.length - 1] * Math.max(0, q), out = [pts[0]];
    for (let i = 1; i < pts.length; i++) { if (cum[i] <= want) { out.push(pts[i]); continue; } const f = (want - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]); break; } return out.length > 1 ? out : [pts[0], pts[0]]; };
  const ell = (cx, cy, rx, ry, n = 9) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
  const rot = ([x, y], cx, cy, a) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];

  // ---- items: filled shapes with a contour, open strokes, limbs (ink outline with a coloured core)
  const poly = (pts, fill, o = {}) => ({ pts: o.flat ? pts : spline(pts, true, 5), fill, line: "ink", w: 6, seed: S(), ...o });
  const blob = (cx, cy, rx, ry, fill, o = {}) => poly(ell(cx, cy, rx, ry, 9), fill, o);
  const stroke = (pts, color, w, o = {}) => ({ pts: o.flat ? pts : spline(pts, false, 5), line: color, w, open: true, seed: S(), ...o });
  const limb = (pts, color, w, o = {}) => ({ pts: spline(pts, false, 5), line: "ink", w: w + 10, core: color, open: true, seed: S(), ...o });
  const rect = (x0, y0, x1, y1, fill, o = {}) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill, { flat: true, line: null, ...o });
  const cast = (cx, cy, rx, ry) => blob(cx, cy, rx, ry, "rgba(18,16,34,0.22)", { line: null, plain: true });

  /** Draws items. Item k starts at t0 + k*step and takes dur seconds (fill laid in passes, then the contour grows). done: all complete. */
  function drawItems(g, M, items, t, t0, step, dur, done, zoom = 1) {
    const boil = Math.floor(t * 10), lwScale = Math.pow(zoom, -0.45), jScale = Math.pow(zoom, -0.55);
    items.forEach((it, k) => {
      const p = done ? 1 : clamp((t - t0 - k * step) / dur); if (p <= 0) return;
      const wide = it.line === null || it.flat ? it.pts : wob(it.pts, (it.feat ? Math.min(.18, M.jitter) : M.jitter) * jScale, it.seed * 7 + boil), pf = clamp(p / 0.6), pl = clamp((p - 0.35) / 0.65);
      const tone = (c) => (typeof c === "string" && c[0] === "#" ? M.tone(c) : c);
      const skinTone = it.feat ? tone(it.skinC || "#d9a47a") : null, featColor = it.feat ? (lum(skinTone) > 0.22 ? "#1c1824" : "#f1ece0") : null;     // face features: dark on light skin, light on dark skin, in every medium
      const fillMode = it.plain || it.feat ? "flat" : M.fill, fill = it.fill === "FEAT" ? featColor : it.fill === "WHITE" ? "#ffffff" : it.fill && tone(it.fill);
      if (fill && pf > 0 && fillMode !== "none") {
        g.save();
        if (pf < 1) wipe(g, it.pts, pf, it.seed);
        g.beginPath(); wide.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
        // every fill is OPAQUE (a translucent fill lets the shapes behind show through and the picture turns to mush): a wash is a lighter solid, hatching is lines on a solid
        if (fillMode === "wash") { g.fillStyle = typeof fill === "string" && fill[0] === "#" ? mix(fill, M.paper, 0.4) : fill; g.fill(); }
        else if (fillMode === "broken") { g.fillStyle = typeof fill === "string" && fill[0] === "#" ? mix(fill, M.paper, 0.3) : fill; g.fill(); if (typeof fill === "string" && fill[0] === "#") { g.clip(); dabs(g, wide, fill, it.seed); } }
        else if (fillMode === "hatch") { g.fillStyle = typeof fill === "string" && fill[0] === "#" ? mix(fill, M.paper, M.hatchBase ?? 0.18) : fill; g.fill(); g.clip(); hatch(g, wide, fill, it.seed, M); }
        else { g.fillStyle = fill; g.fill(); }
        if (it.shade && typeof fill === "string" && fill[0] === "#") {
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; wide.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
          g.clip();
          if (it.light !== false) { g.fillStyle = mix(fill, "#fff6dc", 0.2); g.beginPath(); g.ellipse(x0 + (x1 - x0) * 0.34, y0 + (y1 - y0) * 0.32, (x1 - x0) * 0.42, (y1 - y0) * 0.38, -0.3, 0, Math.PI * 2); g.fill(); }
          g.fillStyle = mix(fill, "#15122a", typeof it.shade === "number" ? it.shade : 0.2);
          g.beginPath(); g.ellipse(x0 + (x1 - x0) * 0.72, y0 + (y1 - y0) * 0.68, (x1 - x0) * 0.56, (y1 - y0) * 0.54, 0.2, 0, Math.PI * 2); g.fill();
        }
        g.restore();
      }
      // a style with no contour (flat) still draws limbs (their coloured core) and small ink strokes (mouth, brows); it only skips the outline of a filled shape
      const ink = it.line === "ink" && !it.feat, noContour = ink && !(M.lw > 0), small = noContour && it.open && !it.core;
      const lineC = it.feat ? featColor : ink && M.contour === "own" && fill ? (typeof fill === "string" && fill[0] === "#" ? mix(fill, "#2a1a12", 0.55) : M.line) : ink ? (M.lw > 0 ? M.line : small ? "#2b2735" : null) : it.line ? tone(it.line) : null;
      if ((lineC || it.core) && pl > 0) {
        const w = it.feat ? (it.open ? (it.w || 4) * 0.85 * lwScale : Math.min(it.w || 2, 1.6) * lwScale) : it.core ? (it.w || 6) * (ink && M.lw > 0 ? M.lw : 1) : Math.max(it.plain && M.lw > 0 ? 3.2 * lwScale : 0, (it.w || 5.2) * (ink ? (M.lw > 0 ? M.lw : small ? 0.6 : 0) : 1) * (ink ? lwScale : 1));
        const path = it.open ? wide : [...wide, wide[0]], seg = cut(path, pl);
        g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); seg.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        if (lineC && w > 0) { g.strokeStyle = lineC; g.lineWidth = w; g.stroke(); }
        if (it.core) { const rim = 9 * (M.lw > 0 ? M.lw : 0) * Math.pow(zoom, -0.7); g.strokeStyle = tone(it.core); g.lineWidth = Math.max(2, (it.w || 6) - rim); g.stroke(); }
      }
    });
  }
  /** Marker passes: the fill is revealed in ragged parallel strips, back and forth. */
  function wipe(g, pts, pf, seed) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const rows = Math.max(3, Math.min(14, Math.round((y1 - y0) / 60))), r = rng(seed), rh = (y1 - y0) / rows; g.beginPath();
    for (let i = 0; i < rows; i++) { const a = clamp(pf * 1.25 - (i / rows) * 0.25 + (r() - 0.5) * 0.1), w = (x1 - x0 + 80) * a; if (i % 2) g.rect(x1 + 40 - w, y0 + i * rh - 1, w, rh + 2); else g.rect(x0 - 40, y0 + i * rh - 1, w, rh + 2); }
    g.clip();
  }
  /** Broken colour in crayon: short thick strokes in neighbouring tints (warmer, cooler, lighter, darker) laid at one slant, with gaps where the base shows through. */
  function dabs(g, pts, color, seed) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const area = (x1 - x0) * (y1 - y0), len = clamp(Math.sqrt(area) / 10, 14, 64), th = len * 0.24, n = Math.min(240, Math.round(area / (len * th * 1.1))), r = rng(seed * 31 + 7);
    const tints = [mix(color, "#ffd27a", 0.32), mix(color, "#6aa0ff", 0.28), mix(color, "#ffffff", 0.3), mix(color, "#3a2a40", 0.22), color];
    g.lineCap = "round"; g.lineWidth = th;
    for (let i = 0; i < n; i++) { const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), a = -0.6 + (r() - 0.5) * 0.5, l = len * (0.6 + r() * 0.7); g.strokeStyle = tints[Math.floor(r() * tints.length)]; g.beginPath(); g.moveTo(x - Math.cos(a) * l / 2, y - Math.sin(a) * l / 2); g.lineTo(x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2); g.stroke(); }
  }
  function hatch(g, pts, color, seed, M = {}) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    g.strokeStyle = M.hatchColor || mix(color, "#000000", 0.22); g.lineWidth = M.hatchW || 2.5; const r = rng(seed), gap = M.hatchGap || 16;
    for (let d = x0 - (y1 - y0); d < x1; d += gap + r() * gap * 0.3) { g.beginPath(); g.moveTo(d, y1); g.lineTo(d + (y1 - y0), y0); g.stroke(); }
  }

  /** Continuous rain: n drops, each with its own random column, speed, length and phase, falling and wrapping on its own, so the screen is always evenly rained on (no sweeping band). */
  function rain(n, t, W, H, slant, color, w = 4, depth = 1, seed = 7) {
    const out = [], span = H * depth + 160;
    for (let i = 0; i < n; i++) {
      const r = rng(seed * 1000 + i * 7919), x0 = r() * (W + span * slant), y0 = r() * span, sp = 1500 + r() * 900, len = 40 + r() * 50, yy = (y0 + t * sp) % span - 80, x = x0 - yy * slant - span * slant * 0.5;
      out.push(stroke([[x, yy], [x - len * slant, yy + len]], color, w, { line: color }));
    }
    return out;
  }
  /** A custom place (the oracle's frame-wide recipe in frame fractions): fills, rects, ellipses, polygons, lines, trees, clouds as doodle shapes. Translucent layers (a < 0.6) are skipped: a doodle is opaque. */
  function placeItems(rc, W, H, FH, tint) {
    const out = [], X = (u) => u * W, Y = (v) => v * H, lw = 5;
    for (const L of rc.layers || []) {
      if (L.a !== undefined && L.a < 0.6) continue;
      const c = tint(L.color || "#888888"), low = L.y !== undefined && L.h !== undefined && L.y + L.h >= 0.95 ? 60 + (FH - H) : 0;
      if (L.op === "fill" && (L.stops || []).length) { const y1 = Y(L.y1 ?? 1), n = Math.min(3, L.stops.length); for (let i = 0; i < n; i++) out.push(rect(-40, (y1 * i) / n - (i ? 0 : 40), W + 40, (y1 * (i + 1)) / n + 2, tint(L.stops[Math.round((i / Math.max(1, n - 1)) * (L.stops.length - 1))]), { line: null })); }
      else if (L.op === "rect") out.push(poly([[X(L.x), Y(L.y)], [X(L.x + L.w), Y(L.y)], [X(L.x + L.w), Y(L.y + L.h) + low], [X(L.x), Y(L.y + L.h) + low]], c, { flat: true, line: L.w > 0.9 ? null : "ink", w: lw }));
      else if (L.op === "ellipse") out.push(blob(X(L.x), Y(L.y), Math.max(2, L.rx * W), Math.max(2, L.ry * H), c, { w: lw }));
      else if (L.op === "poly" && (L.points || []).length > 2) out.push(poly(L.points.map(([u, v]) => [X(u), Y(v)]), c, { flat: true, w: lw }));
      else if (L.op === "line") out.push(stroke([[X(L.x1), Y(L.y1)], [X(L.x2), Y(L.y2)]], c, Math.max(4, (L.width || 0.01) * W), { line: c }));
      else if (L.op === "tree") { const h = (L.h ?? 0.3) * H, x = X(L.x), y = Y(L.y); out.push(rect(x - h * 0.04, y - h * 0.5, x + h * 0.04, y, tint("#6a4a2c"), { line: "ink", w: lw }), blob(x, y - h * 0.68, h * 0.28, h * 0.3, tint("#4f8a3a"))); }
      else if (L.op === "clouds") out.push(blob(X(L.x ?? 0.5), Y(L.y ?? 0.2), W * 0.14, H * 0.03, tint("#f4f6fa")), blob(X((L.x ?? 0.5) + 0.08), Y((L.y ?? 0.2) + 0.01), W * 0.1, H * 0.025, tint("#dfe6ee")));
    }
    return out;
  }

  /** The polylines of a mark drawn on the ground, in local -1..1 space (the ground is squashed to an oval when drawn). */
  function markShape(shape) {
    const circle = (r, n = 36) => Array.from({ length: n + 1 }, (_, i) => [Math.cos((i / n) * Math.PI * 2 - 1.57) * r, Math.sin((i / n) * Math.PI * 2 - 1.57) * r]);
    if (shape === "heart") return [Array.from({ length: 41 }, (_, i) => { const a = (i / 40) * Math.PI * 2; return [0.9 * Math.pow(Math.sin(a), 3), -(0.72 * Math.cos(a) - 0.28 * Math.cos(2 * a) - 0.11 * Math.cos(3 * a) - 0.05 * Math.cos(4 * a))]; })];
    if (shape === "star") return [Array.from({ length: 11 }, (_, i) => { const a = (i / 10) * Math.PI * 2 * 2 - 1.57, k = i % 2 ? 0.4 : 1; return [Math.cos(a / 2 * 2) * k * 0.9, Math.sin(a / 2 * 2) * k * 0.9]; })];
    if (shape === "spiral") return [Array.from({ length: 60 }, (_, i) => { const a = (i / 59) * Math.PI * 5, r = 0.1 + (i / 59) * 0.85; return [Math.cos(a) * r, Math.sin(a) * r]; })];
    if (shape === "circle") return [circle(0.8)];
    return [circle(0.5), ...Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2 - 1.57; return [[Math.cos(a) * 0.68, Math.sin(a) * 0.68], [Math.cos(a) * 0.98, Math.sin(a) * 0.98]]; })];   // a sun: a ring, then eight rays
  }

  /** A custom object (the oracle's recipe in local 0..1 space) drawn as doodle shapes inside its box (px, py = base centre; pw, ph = size). */
  function recipeItems(rc, px, py, pw, ph, tint, snowy, describe = "") {
    const whiteThing = /\b(white|snow|ice|paper|sail|cloud|cream|milk|string|thread)\b/i.test(describe);
    const X = (u) => px - pw / 2 + u * pw, Y = (v) => py - ph + v * ph, lw = clamp(Math.min(pw, ph) / 60, 2, 5), out = [];
    for (const L of rc.layers || []) {
      let col = L.color || "#888888"; if (!snowy && !whiteThing && /^#[ef][0-9a-f][ef][0-9a-f][ef][0-9a-f]$/i.test(col)) col = "#a9acb2";   // an object does not wear snow when it is not winter (white things, like string or a sail, stay white)
      const c = tint(col);
      if (L.op === "rect") out.push(poly([[X(L.x), Y(L.y)], [X(L.x + L.w), Y(L.y)], [X(L.x + L.w), Y(L.y + L.h)], [X(L.x), Y(L.y + L.h)]], c, { flat: true, w: lw }));
      else if (L.op === "ellipse") out.push(blob(X(L.x), Y(L.y), Math.max(2, L.rx * pw), Math.max(2, L.ry * ph), c, { w: lw }));
      else if (L.op === "poly" && (L.points || []).length > 2) out.push(poly(L.points.map(([u, v]) => [X(u), Y(v)]), c, { flat: true, w: lw }));
      else if (L.op === "line") out.push(stroke([[X(L.x1), Y(L.y1)], [X(L.x2), Y(L.y2)]], c, Math.max(3, (L.width || 0.02) * pw), { line: c }));
    }
    return out;
  }

  // ---- the scene
  const BASE = (shot) => shot.place === "custom" && shot.recipe && shot.recipe.floor_y ? Math.min(0.95, Math.max(0.6, shot.recipe.floor_y)) : ({ meadow: 0.82, hills: 0.78, lake: 0.9, sea: 0.92, forest: 0.92, city: 0.96, street: 0.94, village: 0.86, mountains: 0.84, desert: 0.84, field: 0.84, shore: 0.9, road: 0.86, sky: 0.9, river: 0.88, interior: 0.9, custom: 0.88 }[shot.place] ?? 0.88);

  /** Layered swells, far to near: each row is a band with its own crest line; rough water gets foam caps and spray. */
  function waves(Y0, FH, W, base, crest, rough, t, rows, foam) {
    const it = [rect(-40, Y0, W + 40, FH + 40, base)], deep = mix(base, "#06182a", 0.45);
    for (let r = 0; r < rows; r++) {
      const k = (r + 1) / rows, y = Y0 + (FH - Y0) * Math.pow(k, 1.35) * 0.9 - 10, a = (4 + rough * 44) * (0.35 + 1.3 * k), per = 110 + r * 12, ph = t * (2.2 + rough * 1.6) + r * 1.7, pts = [], tops = [];
      for (let x = -40; x <= W + 40; x += 30) { const yy = y + Math.sin(x / per + ph) * a + Math.sin(x / 47 - t * 4 + r) * a * 0.3; pts.push([x, yy]); tops.push([x, yy, Math.sin(x / per + ph)]); }
      it.push(poly([...pts, [W + 40, FH + 40], [-40, FH + 40]], mix(base, deep, (r % 2 ? 0.2 : 0.05) + 0.4 * k), { flat: true, line: null }));
      it.push(stroke(pts, crest, 4 + r * 1.1));
      if (foam && rough > 0.3) for (const [x, yy, sn] of tops) if (sn > 0.55 && ((x / 30) | 0) % 2 === 0) it.push(stroke([[x - 8, yy - 3], [x + 22, yy - 6]], "#f3f8fb", 6 + r * 0.8));
      if (foam && rough > 0.6) for (let q = 0; q < 5; q++) { const x = ((q * 211 + r * 97 + t * 90) % (W + 80)) - 40, yy = y + Math.sin(x / per + ph) * a - 10 - ((t * 60 + q * 17) % 26); it.push(blob(x, yy, 5, 5, "#ffffff", { line: null, flat: true })); }
    }
    return it;
  }
  const ridge = (y, amp, color, seed, W, FH, kind = "soft") => { const r = rng(seed), pts = [[-40, FH + 40]]; for (let x = -40; x <= W + 40; x += 64) pts.push([x, y + (kind === "peaks" ? (r() - 0.25) * amp * 2.1 : (Math.sin(x / 180 + seed) * 0.65 + (r() - 0.5) * 0.5) * amp)]); pts.push([W + 40, FH + 40]); return poly(pts, color, { flat: kind === "peaks", shade: 0.14 }); };

  function house(x, y, w, h, wall, roof, lit, style) {
    const shWall = mix(wall, "#1c1824", 0.16), doorC = "#6e4228", winC = lit ? "#ffe89e" : "#8fa8bc", winRim = "#4a3322";
    if (style === "shop") {
      const awningA = "#d84a38", awningB = "#fbf6e8";
      const stripes = [];
      const nStripes = 6, awW = w * 0.96, awX0 = x - awW / 2, awY0 = y - h * 0.62, awY1 = y - h * 0.46;
      for (let i = 0; i < nStripes; i++) {
        const sx0 = awX0 + (i / nStripes) * awW, sx1 = awX0 + ((i + 1) / nStripes) * awW;
        stripes.push(poly([[sx0, awY0], [sx1, awY0], [sx1 + (i - 2.5) * 2, awY1], [sx0 + (i - 2.5) * 2, awY1]], i % 2 === 0 ? awningA : awningB, { flat: true, w: 3.2 }));
      }
      return [
        cast(x, y + 6, w * 0.6, Math.max(10, h * 0.1)),
        // Main building facade
        poly([[x - w / 2, y], [x + w / 2, y], [x + w / 2, y - h], [x - w / 2, y - h]], wall, { flat: true, shade: 0.12 }),
        poly([[x + w * 0.24, y], [x + w / 2, y], [x + w / 2, y - h], [x + w * 0.24, y - h]], shWall, { flat: true, line: null }),
        // Cornice & pitched town roof
        poly([[x - w * 0.54, y - h], [x + w * 0.54, y - h], [x + w * 0.44, y - h * 1.32], [x - w * 0.44, y - h * 1.32]], roof, { flat: true, shade: 0.16 }),
        rect(x - w * 0.54, y - h * 1.04, x + w * 0.54, y - h * 0.96, mix(roof, "#1a120e", 0.25), { line: "ink", w: 3.8 }),
        // Upper floor windows
        rect(x - w * 0.34, y - h * 0.88, x - w * 0.08, y - h * 0.7, winC, { line: "ink", w: 3.5 }),
        rect(x + w * 0.08, y - h * 0.88, x + w * 0.34, y - h * 0.7, winC, { line: "ink", w: 3.5 }),
        // Shop door on left
        rect(x - w * 0.4, y - h * 0.46, x - w * 0.18, y, doorC, { line: "ink", w: 4 }),
        rect(x - w * 0.36, y - h * 0.42, x - w * 0.22, y - h * 0.24, winC, { line: "ink", w: 2.8 }),
        // Wide shop display window on right with warm loaves visible inside
        rect(x - w * 0.1, y - h * 0.42, x + w * 0.4, y - h * 0.12, "#ffe89e", { line: "ink", w: 4 }),
        blob(x + w * 0.04, y - h * 0.17, w * 0.07, h * 0.045, "#d88a38", { w: 2.5 }),
        blob(x + w * 0.18, y - h * 0.17, w * 0.07, h * 0.045, "#d88a38", { w: 2.5 }),
        blob(x + w * 0.31, y - h * 0.17, w * 0.06, h * 0.04, "#c97a2b", { w: 2.5 }),
        // Striped shop awning
        ...stripes,
      ];
    }
    return [
      cast(x, y + 6, w * 0.58, Math.max(10, h * 0.11)),
      poly([[x - w * 0.34, y - h * 0.95], [x - w * 0.2, y - h * 0.95], [x - w * 0.2, y - h * 1.38], [x - w * 0.34, y - h * 1.38]], mix(roof, "#3a251c", 0.25), { flat: true, w: 4 }),
      poly([[x - w / 2, y], [x + w / 2, y], [x + w / 2, y - h], [x - w / 2, y - h]], wall, { flat: true, shade: 0.14 }),
      poly([[x + w * 0.18, y], [x + w / 2, y], [x + w / 2, y - h], [x + w * 0.18, y - h]], shWall, { flat: true, line: null }),
      poly([[x - w / 2 - 16, y - h + 6], [x + w / 2 + 16, y - h + 6], [x, y - h - h * 0.58]], roof, { flat: true, shade: 0.18 }),
      stroke([[x - w * 0.32, y - h * 1.15], [x + w * 0.32, y - h * 1.15]], mix(roof, "#1a120e", 0.3), 4),
      poly([[x - w * 0.18, y + 4], [x + w * 0.06, y + 4], [x + w * 0.02, y], [x - w * 0.14, y]], "#8a8278", { flat: true, w: 3 }),
      poly([[x - w * 0.13, y], [x + w * 0.03, y], [x + w * 0.03, y - h * 0.52], [x - w * 0.13, y - h * 0.52]], doorC, { flat: true, w: 4.5 }),
      blob(x - w * 0.01, y - h * 0.26, 3.5, 3.5, "#e6c268", { w: 2 }),
      poly([[x + w * 0.16, y - h * 0.44], [x + w * 0.38, y - h * 0.44], [x + w * 0.38, y - h * 0.74], [x + w * 0.16, y - h * 0.74]], winC, { flat: true, w: 4.5 }),
      stroke([[x + w * 0.27, y - h * 0.44], [x + w * 0.27, y - h * 0.74]], winRim, 3, { flat: true }),
      stroke([[x + w * 0.16, y - h * 0.59], [x + w * 0.38, y - h * 0.59]], winRim, 3, { flat: true }),
    ];
  }

  const FRUITS = { lemon: "#f4d22a", orange: "#f28a24", apple: "#d93a2c", cherry: "#b3122f", plum: "#6d3a8e", pear: "#c9d640", peach: "#f6a074", fig: "#7a3d6a" };
  /** Ripe fruit hanging in a tree's crown (on a fixed pattern, so it does not move between frames). */
  function fruitsOn(px, cy, ph, fruit, t) {
    const c = FRUITS[fruit] ?? "#f4d22a", spots = [[-0.26, -0.04], [0.04, -0.16], [0.27, -0.02], [-0.12, 0.1], [0.16, 0.12], [-0.33, 0.14], [0.02, 0.02], [0.34, 0.15], [-0.2, -0.17]], r = Math.max(7, ph * 0.034);
    return spots.flatMap(([dx, dy], i) => { const x = px + dx * ph, y = cy + dy * ph + Math.sin(t * 1.6 + i) * ph * 0.004;
      return [blob(x, y, r * 1.25, r, c, { w: 3.2 }), blob(x - r * 0.35, y - r * 0.3, r * 0.3, r * 0.22, "#ffffff", { w: 0.5, line: null })]; });
  }
  const FRUIT_ONE = /\b(lemon|orange|apple|cherry|plum|pear|peach|fig)\b/i;
  const fruitKind = (p) => p.kind === "custom" && !/\btree\b/i.test(p.describe ?? "") && FRUIT_ONE.test(`${p.describe ?? ""} ${p.id ?? ""}`) ? FRUIT_ONE.exec(`${p.describe ?? ""} ${p.id ?? ""}`)[1].toLowerCase() : null;
  const COMMON_PROP = [
    ["hat", /\b(hat|cap|bonnet|beret)\b/i],
    ["fence", /\b(fence|railing|paling)\b/i],
    ["chair", /\b(armchair|chair|bench|stool|seat)\b/i],
    ["can", /\b(watering\s*can)\b/i],
    ["burlap", /\b(burlap|cloth\s+wrap|trunk\s+wrap)\b/i],
    ["cane", /\b(walking\s+cane|wooden\s+cane|\bcane\b|walking\s+stick)\b/i],
    ["shelf", /\b(shelf|shelves|bookcase|cupboard)\b/i],
    ["book", /\b(book|notebook|journal|diary|bible)\b/i],
    ["letter", /\b(letter|envelope|paper\s+note|scroll|map)\b/i],
    ["basket", /\b(basket|crate|hamper|bucket|pail)\b/i],
    ["flowerpot", /\b(flower\s*pot|potted\s+plant|planter)\b/i],
    ["clock", /\b(clock|pocket\s*watch|hourglass|compass)\b/i],
    ["cup", /\b(teacup|mug|cup\s+of|teapot|kettle|bowl)\b/i],
    ["campfire", /\b(campfire|bonfire|fire\s+pit)\b/i],
    ["well", /\b(stone\s+well|water\s+well|\bwell\b)\b/i],
    ["signpost", /\b(signpost|wooden\s+sign|milestone)\b/i],
    ["bicycle", /\b(bicycle|bike)\b/i],
    ["loaves", /\b(loaf|loaves|bread|roll|rolls|pastry|pastries)\b/i],
  ];
  const commonKind = (p) => {
    if (p.kind !== "custom") return null;
    const text = `${p.describe ?? ""} ${p.id ?? ""}`;
    if (/\btree\b/i.test(text) && !/\bburlap\b/i.test(text)) return "tree";
    for (const [k, re] of COMMON_PROP) if (re.test(text)) return k;
    return null;
  };
  /** One piece of fruit: an oval in its colour, a highlight and a small leaf. */
  function fruitItem(x, y, r, name) {
    const c = FRUITS[name] ?? "#f4d22a";
    return [blob(x, y, r * 1.25, r, c, { w: 3.4, shade: 0.12 }), blob(x - r * 0.4, y - r * 0.32, r * 0.3, r * 0.22, "#ffffff", { w: 0.5, line: null }), stroke([[x + r * 0.9, y - r * 0.5], [x + r * 1.5, y - r * 0.95]], "#3d752c", 4), blob(x + r * 1.45, y - r * 0.95, r * 0.5, r * 0.28, "#5aa83a", { w: 2.5 })];
  }
  function commonPropItems(kind, px, py, pw, ph, tint, t, p) {
    if (kind === "tree") {
      if (ph < 95) return [cast(px, py + 2, 18, 5), stroke([[px, py], [px - 3, py - ph * 0.42], [px + 2, py - ph * 0.85]], "#3d752c", 6.5), blob(px - 18, py - ph * 0.62, 22, 12, "#529938", { w: 3.5 }), blob(px + 20, py - ph * 0.78, 24, 13, "#6fc048", { w: 3.5 })];
      const f = p.fruit || (/\b(ripe|fruit)\b/i.test(p.describe ?? "") && FRUIT_ONE.test(`${p.describe ?? ""} ${p.id ?? ""}`) ? FRUIT_ONE.exec(`${p.describe ?? ""} ${p.id ?? ""}`)[1].toLowerCase() : null);
      return tree(px, py, Math.max(ph, 80), tint("#4f8a3a"), tint("#6a4a2c"), t, 1, f);
    }
    if (kind === "hat") {                                                      // a hat: a brim and a rounded crown with a band, in the colour the words give it
      const text = `${p.describe ?? ""} ${p.id ?? ""}`, col = /straw|yellow|wheat|sun/i.test(text) ? "#dcbf68" : /green/i.test(text) ? "#4f7a46" : /red/i.test(text) ? "#b03a2e" : /grey|gray/i.test(text) ? "#8a8f96" : "#6d4a2e";
      const w = Math.max(pw, 46), h = Math.max(ph, 30), wide = /wide|straw/i.test(text) ? 1.25 : 1;
      return [cast(px, py + 2, w * 0.5, 4), blob(px, py - h * 0.14, w * 0.62 * wide, h * 0.16, tint(col), { w: 3.6, shade: 0.12 }), blob(px, py - h * 0.5, w * 0.34, h * 0.4, tint(col), { w: 3.6, shade: 0.16 }), rect(px - w * 0.33, py - h * 0.33, px + w * 0.33, py - h * 0.2, tint(mix(col, "#1c1410", 0.45)), { line: "ink", w: 2.6 })];
    }
    if (kind === "fence") {
      const w = Math.max(pw, 120), h = Math.max(ph, 54), x0 = px - w / 2, wood = tint("#8c6747"), dark = tint("#63462d"), it = [cast(px, py + 3, w * 0.52, 6)];
      for (const ry of [0.34, 0.72]) it.push(rect(x0, py - h * (ry + 0.1), x0 + w, py - h * ry, dark, { line: "ink", w: 4 }));
      for (let i = 0; i < 4; i++) { const x = x0 + (i / 3) * (w - 16); it.push(poly([[x, py], [x, py - h * 0.92], [x + 8, py - h], [x + 16, py - h * 0.92], [x + 16, py]], wood, { flat: true, w: 4, shade: 0.15 })); }
      return it;
    }
    if (kind === "chair") {
      const w = Math.max(pw, 90), h = Math.max(ph, 95), wood = tint("#6b462a"), cushion = tint("#a8583b"), blanket = tint("#d9b26f");
      return [
        cast(px, py + 4, w * 0.55, 8),
        rect(px - w * 0.38, py - h * 0.45, px - w * 0.28, py, wood, { line: "ink", w: 4 }),
        rect(px + w * 0.28, py - h * 0.45, px + w * 0.38, py, wood, { line: "ink", w: 4 }),
        poly([[px - w * 0.36, py - h * 0.42], [px + w * 0.36, py - h * 0.42], [px + w * 0.32, py - h * 0.98], [px - w * 0.32, py - h * 0.98]], cushion, { flat: true, w: 4.5, shade: 0.18 }),
        poly([[px - w * 0.18, py - h * 0.99], [px + w * 0.24, py - h * 0.99], [px + w * 0.2, py - h * 0.68], [px - w * 0.14, py - h * 0.72]], blanket, { flat: true, w: 3.5 }),
        rect(px - w * 0.42, py - h * 0.48, px + w * 0.42, py - h * 0.34, cushion, { line: "ink", w: 4.5, shade: 0.15 }),
        rect(px - w * 0.46, py - h * 0.62, px - w * 0.32, py - h * 0.36, wood, { line: "ink", w: 4 }),
        rect(px + w * 0.32, py - h * 0.62, px + w * 0.46, py - h * 0.36, wood, { line: "ink", w: 4 }),
      ];
    }
    if (kind === "can") {
      const w = Math.max(pw, 44), h = Math.max(ph, 36), c = tint("#48825a"), dark = tint("#2f593c");
      return [
        cast(px, py + 2, w * 0.5, 5),
        stroke([[px - w * 0.22, py - h * 0.75], [px - w * 0.48, py - h * 0.55], [px - w * 0.22, py - h * 0.22]], dark, 4.5),
        poly([[px + w * 0.2, py - h * 0.35], [px + w * 0.62, py - h * 0.78], [px + w * 0.56, py - h * 0.86], [px + w * 0.16, py - h * 0.52]], c, { flat: true, w: 3.8 }),
        blob(px + w * 0.62, py - h * 0.82, 7, 10, tint("#d4b46a"), { w: 3 }),
        rect(px - w * 0.26, py - h * 0.78, px + w * 0.24, py, c, { line: "ink", w: 4.2, shade: 0.18 }),
      ];
    }
    if (kind === "burlap") {
      const w = Math.max(pw, 36), h = Math.max(ph, 48), cloth = tint("#b58e58"), cord = tint("#5c4024");
      return [
        poly([[px - w * 0.42, py], [px - w * 0.36, py - h * 0.75], [px + w * 0.36, py - h * 0.75], [px + w * 0.42, py]], cloth, { flat: true, w: 4, shade: 0.18 }),
        stroke([[px - w * 0.38, py - h * 0.52], [px + w * 0.38, py - h * 0.48]], cord, 3.8),
        stroke([[px - w * 0.4, py - h * 0.26], [px + w * 0.4, py - h * 0.22]], cord, 3.8),
      ];
    }
    if (kind === "cane") return [stroke([[px, py - Math.max(ph, 65)], [px + 10, py - Math.max(ph, 65)], [px + 6, py]], tint("#7a4e2d"), 6)];
    if (kind === "shelf") {
      const w = Math.max(pw, 80), h = Math.max(ph, 48), y0 = py - h * 0.6, wood = tint("#7a5436");
      return [
        rect(px - w / 2, y0, px + w / 2, y0 + 10, wood, { line: "ink", w: 4 }),
        blob(px - w * 0.22, y0 - 8, 10, 8, tint("#e8dfd1"), { w: 3 }),
        blob(px + w * 0.14, y0 - 9, 11, 9, tint("#6898b8"), { w: 3 }),
      ];
    }
    if (kind === "book") {
      const w = Math.max(pw, 40), h = Math.max(ph, 28), cover = tint("#9a382d"), pages = tint("#f5eedc");
      return [
        cast(px, py + 2, w * 0.55, 4),
        poly([[px - w * 0.48, py], [px, py - h * 0.18], [px + w * 0.48, py], [px + w * 0.44, py - h * 0.85], [px, py - h * 0.96], [px - w * 0.44, py - h * 0.85]], cover, { flat: true, w: 4 }),
        poly([[px - w * 0.42, py - h * 0.08], [px, py - h * 0.24], [px + w * 0.42, py - h * 0.08], [px + w * 0.38, py - h * 0.82], [px, py - h * 0.9], [px - w * 0.38, py - h * 0.82]], pages, { flat: true, w: 3.5 }),
        stroke([[px, py - h * 0.22], [px, py - h * 0.88]], tint("#7a6e5d"), 3),
      ];
    }
    if (kind === "letter") {
      const w = Math.max(pw, 38), h = Math.max(ph, 26), paper = tint("#f7f1e1");
      return [
        cast(px, py + 2, w * 0.5, 4),
        rect(px - w / 2, py - h, px + w / 2, py, paper, { line: "ink", w: 3.8, shade: 0.08 }),
        stroke([[px - w * 0.46, py - h * 0.96], [px, py - h * 0.42], [px + w * 0.46, py - h * 0.96]], tint("#b8ac96"), 3.2, { flat: true }),
        blob(px, py - h * 0.45, 5, 5, "#b8322a", { w: 2 }),
      ];
    }
    if (kind === "basket") {
      const w = Math.max(pw, 54), h = Math.max(ph, 42), straw = tint("#c49655"), rim = tint("#8c6432");
      return [
        cast(px, py + 3, w * 0.48, 6),
        stroke([[px - w * 0.36, py - h * 0.65], [px, py - h * 1.15], [px + w * 0.36, py - h * 0.65]], rim, 4.5),
        poly([[px - w * 0.36, py], [px + w * 0.36, py], [px + w * 0.48, py - h * 0.68], [px - w * 0.48, py - h * 0.68]], straw, { flat: true, w: 4.2, shade: 0.18 }),
        rect(px - w * 0.5, py - h * 0.76, px + w * 0.5, py - h * 0.62, rim, { line: "ink", w: 3.8 }),
      ];
    }
    if (kind === "flowerpot") {
      const w = Math.max(pw, 38), h = Math.max(ph, 52), clay = tint("#b85d38");
      return [
        cast(px, py + 2, w * 0.46, 5),
        poly([[px - w * 0.3, py], [px + w * 0.3, py], [px + w * 0.42, py - h * 0.54], [px - w * 0.42, py - h * 0.54]], clay, { flat: true, w: 4, shade: 0.2 }),
        rect(px - w * 0.46, py - h * 0.64, px + w * 0.46, py - h * 0.5, clay, { line: "ink", w: 3.8 }),
        stroke([[px, py - h * 0.62], [px, py - h * 0.92]], "#3d752c", 4.5),
        blob(px - 10, py - h * 0.78, 10, 6, "#5aa83a", { w: 3 }),
        blob(px + 10, py - h * 0.82, 10, 6, "#5aa83a", { w: 3 }),
        blob(px, py - h * 0.95, 9, 9, "#ffd84d", { w: 3 }),
      ];
    }
    if (kind === "clock") {
      const r = Math.max(pw, ph, 36) * 0.48, cy = py - r, brass = tint("#d4a84a");
      return [
        cast(px, py + 2, r * 0.9, 5),
        blob(px, cy, r, r, brass, { w: 4.2, shade: 0.16 }),
        blob(px, cy, r * 0.78, r * 0.78, "#fbf6e8", { w: 3 }),
        stroke([[px, cy - r * 0.5], [px, cy], [px + r * 0.35, cy + r * 0.15]], "#1c1824", 3.2, { flat: true }),
      ];
    }
    if (kind === "cup") {
      const w = Math.max(pw, 30), h = Math.max(ph, 26), cer = tint("#e8dfd1");
      return [
        cast(px, py + 2, w * 0.5, 4),
        stroke([[px + w * 0.32, py - h * 0.72], [px + w * 0.56, py - h * 0.52], [px + w * 0.3, py - h * 0.28]], cer, 4),
        poly([[px - w * 0.34, py], [px + w * 0.34, py], [px + w * 0.42, py - h * 0.82], [px - w * 0.42, py - h * 0.82]], cer, { flat: true, w: 3.8, shade: 0.15 }),
      ];
    }
    if (kind === "campfire") {
      const w = Math.max(pw, 64), h = Math.max(ph, 52), sw = Math.sin(t * 8) * 4;
      return [
        blob(px, py - h * 0.35, w * 0.9, h * 0.85, "rgba(255,168,60,0.26)", { line: null, plain: true }),
        poly([[px - w * 0.42, py], [px + w * 0.42, py - h * 0.18], [px + w * 0.36, py - h * 0.28], [px - w * 0.46, py - h * 0.1]], tint("#5a3822"), { flat: true, w: 4 }),
        poly([[px + w * 0.42, py], [px - w * 0.42, py - h * 0.18], [px - w * 0.36, py - h * 0.28], [px + w * 0.46, py - h * 0.1]], tint("#472b19"), { flat: true, w: 4 }),
        blob(px + sw * 0.5, py - h * 0.48, w * 0.28, h * 0.44, "#f05a1a", { w: 4 }),
        blob(px - sw * 0.4, py - h * 0.42, w * 0.18, h * 0.3, "#ffae2b", { w: 3 }),
        blob(px, py - h * 0.34, w * 0.1, h * 0.18, "#fff29c", { line: null, plain: true }),
      ];
    }
    if (kind === "well") {
      const w = Math.max(pw, 86), h = Math.max(ph, 92), stone = tint("#7e8288"), roof = tint("#6b422e");
      return [
        cast(px, py + 4, w * 0.55, 8),
        rect(px - w * 0.36, py - h * 0.88, px - w * 0.28, py - h * 0.38, tint("#5a3a24"), { line: "ink", w: 4 }),
        rect(px + w * 0.28, py - h * 0.88, px + w * 0.36, py - h * 0.38, tint("#5a3a24"), { line: "ink", w: 4 }),
        poly([[px - w * 0.48, py - h * 0.84], [px + w * 0.48, py - h * 0.84], [px, py - h * 1.08]], roof, { flat: true, w: 4.5, shade: 0.18 }),
        rect(px - w * 0.42, py - h * 0.42, px + w * 0.42, py, stone, { line: "ink", w: 4.5, shade: 0.2 }),
        stroke([[px - w * 0.42, py - h * 0.22], [px + w * 0.42, py - h * 0.22]], tint("#54585e"), 3.5, { flat: true }),
      ];
    }
    if (kind === "signpost") {
      const w = Math.max(pw, 64), h = Math.max(ph, 88), wood = tint("#8a6240");
      return [
        cast(px, py + 3, 22, 6),
        rect(px - 6, py - h, px + 6, py, tint("#5c3f26"), { line: "ink", w: 4 }),
        poly([[px - w * 0.35, py - h * 0.84], [px + w * 0.42, py - h * 0.84], [px + w * 0.54, py - h * 0.74], [px + w * 0.42, py - h * 0.64], [px - w * 0.35, py - h * 0.64]], wood, { flat: true, w: 4, shade: 0.14 }),
      ];
    }
    if (kind === "bicycle") {
      const w = Math.max(pw, 110), h = Math.max(ph, 76), r = Math.min(w * 0.22, h * 0.34);
      const wx1 = px - w * 0.3, wx2 = px + w * 0.3, wy = py - r;
      const frameCol = tint("#c84232"), metal = tint("#3a404d"), basketCol = tint("#c49655");
      return [
        cast(px, py + 3, w * 0.55, 6),
        blob(wx1, wy, r, r, "rgba(0,0,0,0)", { w: 5 }),
        blob(wx2, wy, r, r, "rgba(0,0,0,0)", { w: 5 }),
        blob(wx1, wy, 4, 4, metal, { w: 2 }),
        blob(wx2, wy, 4, 4, metal, { w: 2 }),
        stroke([[wx1, wy], [px - w * 0.05, wy - r * 0.95], [px + w * 0.2, wy - r * 0.95], [wx2, wy]], frameCol, 5),
        stroke([[wx1, wy], [px + w * 0.02, wy - r * 0.1], [px + w * 0.2, wy - r * 0.95]], frameCol, 4.5),
        stroke([[px - w * 0.05, wy - r * 0.95], [px + w * 0.02, wy - r * 0.1]], frameCol, 4.5),
        stroke([[wx2, wy], [px + w * 0.18, wy - r * 1.45], [px + w * 0.08, wy - r * 1.48]], metal, 4.5),
        poly([[px - w * 0.14, wy - r * 1.05], [px + w * 0.02, wy - r * 1.05], [px, wy - r * 1.18], [px - w * 0.12, wy - r * 1.18]], tint("#4a3322"), { flat: true, w: 3.5 }),
        poly([[px + w * 0.2, wy - r * 0.85], [px + w * 0.38, wy - r * 0.85], [px + w * 0.42, wy - r * 1.32], [px + w * 0.18, wy - r * 1.32]], basketCol, { flat: true, w: 3.5, shade: 0.15 }),
      ];
    }
    if (kind === "loaves") {
      const w = Math.max(pw, 64), h = Math.max(ph, 24), crust = tint("#d68835"), warm = tint("#f0b65b");
      return [
        rect(px - w * 0.48, py - h * 0.22, px + w * 0.48, py, tint("#7a5230"), { line: "ink", w: 3.5 }),
        blob(px - w * 0.24, py - h * 0.48, w * 0.2, h * 0.38, crust, { w: 3.5, shade: 0.15 }),
        blob(px + w * 0.18, py - h * 0.48, w * 0.2, h * 0.38, warm, { w: 3.5, shade: 0.15 }),
      ];
    }
    return [];
  }
  function tree(px, py, ph, crownC, trunkC, t, seed = 1, fruit = null) {
    const sw = Math.sin(t * 1.3 + px * 0.01) * ph * 0.018, tw = Math.max(12, ph * 0.065), cy = py - ph * 0.68;
    const darkC = mix(crownC, "#182c1c", 0.26), lightC = mix(crownC, "#e8f48c", 0.22), barkD = mix(trunkC, "#1e140e", 0.3);
    return [
      cast(px, py + 4, ph * 0.26, Math.max(8, ph * 0.055)),
      poly([[px - tw * 1.15, py], [px - tw * 0.55, py - ph * 0.48], [px + tw * 0.55, py - ph * 0.48], [px + tw * 1.15, py]], trunkC, { flat: true, shade: 0.22, w: 4.5 }),
      stroke([[px - tw * 0.2, py - ph * 0.42], [px - ph * 0.12 + sw * 0.5, py - ph * 0.58]], trunkC, Math.max(5, tw * 0.55)),
      stroke([[px + tw * 0.2, py - ph * 0.4], [px + ph * 0.13 + sw * 0.5, py - ph * 0.56]], barkD, Math.max(5, tw * 0.5)),
      blob(px - ph * 0.16 + sw * 0.7, cy + ph * 0.05, ph * 0.21, ph * 0.19, darkC, { w: 4.5 }),
      blob(px + ph * 0.17 + sw * 0.7, cy + ph * 0.06, ph * 0.2, ph * 0.18, darkC, { w: 4.5 }),
      blob(px + sw, cy - ph * 0.02, ph * 0.27, ph * 0.25, crownC, { shade: 0.16, w: 5 }),
      blob(px - ph * 0.08 + sw * 1.1, cy - ph * 0.09, ph * 0.18, ph * 0.16, lightC, { line: null }),
      stroke([[px - ph * 0.18 + sw, cy - ph * 0.14], [px - ph * 0.05 + sw, cy - ph * 0.22], [px + ph * 0.1 + sw, cy - ph * 0.15]], mix(lightC, "#ffffff", 0.25), 4),
      ...(fruit ? fruitsOn(px + sw, cy, ph, fruit, t) : []),
    ];
  }

  function rock(px, py, pw, ph, tint) {
    const base = tint("#7e6248"), dark = tint("#523d2c"), light = tint("#bfa07a"), mid = tint("#997a5c");
    return [
      cast(px, py + ph * 0.14, pw * 0.54, Math.max(8, ph * 0.14)),
      poly([[px - pw * 0.5, py + ph * 0.12], [px - pw * 0.42, py - ph * 0.48], [px - pw * 0.22, py - ph * 0.86], [px + pw * 0.24, py - ph * 0.84], [px + pw * 0.44, py - ph * 0.42], [px + pw * 0.5, py + ph * 0.12]], base, { flat: true, w: 5 }),
      poly([[px + pw * 0.08, py - ph * 0.84], [px + pw * 0.24, py - ph * 0.84], [px + pw * 0.44, py - ph * 0.42], [px + pw * 0.5, py + ph * 0.12], [px + pw * 0.12, py + ph * 0.12], [px + pw * 0.18, py - ph * 0.44]], dark, { flat: true, line: null }),
      poly([[px - pw * 0.22, py - ph * 0.86], [px + pw * 0.24, py - ph * 0.84], [px + pw * 0.18, py - ph * 0.56], [px - pw * 0.26, py - ph * 0.58]], light, { flat: true, line: null }),
      poly([[px - pw * 0.42, py - ph * 0.48], [px - pw * 0.26, py - ph * 0.58], [px + pw * 0.18, py - ph * 0.56], [px + pw * 0.12, py + ph * 0.12], [px - pw * 0.5, py + ph * 0.12]], mid, { flat: true, line: null }),
      stroke([[px - pw * 0.26, py - ph * 0.56], [px + pw * 0.16, py - ph * 0.54], [px + pw * 0.36, py - ph * 0.22]], dark, 4, { flat: true }),
      stroke([[px - pw * 0.2, py - ph * 0.82], [px + pw * 0.18, py - ph * 0.8]], mix(light, "#ffffff", 0.3), 4, { flat: true }),
    ];
  }

  function lampPost(px, py, ph, indoors, tint) {
    if (indoors) return [
      cast(px, py + 4, 28, 8),
      rect(px - 22, py - ph * 0.5, px + 22, py, tint("#4a4a58"), { line: "ink", w: 4.5, shade: 0.2 }),
      blob(px, py - ph * 0.62, ph * 0.2, ph * 0.2, "#ffd84a", { w: 5 }),
      blob(px, py - ph * 0.62, ph * 0.09, ph * 0.09, "#fff7cc", { w: 3 }),
    ];
    const topY = py - ph, r = Math.max(18, ph * 0.095), iron = tint("#2f323d");
    return [
      cast(px, py + 4, 24, 7),
      poly([[px - 13, py], [px - 8, py - ph * 0.18], [px + 8, py - ph * 0.18], [px + 13, py]], iron, { flat: true, w: 4 }),
      rect(px - 5, topY + r * 0.8, px + 5, py - ph * 0.16, iron, { line: "ink", w: 4 }),
      poly([[px - 14, topY + r * 0.9], [px + 14, topY + r * 0.9], [px + 9, topY + r * 1.2], [px - 9, topY + r * 1.2]], iron, { flat: true, w: 3.5 }),
      blob(px, topY, r * 1.65, r * 1.65, "rgba(255,222,115,0.28)", { line: null, plain: true }),
      blob(px, topY, r, r * 1.08, "#ffde59", { w: 4.5 }),
      blob(px - r * 0.22, topY - r * 0.2, r * 0.38, r * 0.42, "#fff8d6", { line: null, plain: true }),
      poly([[px - r * 1.15, topY - r * 0.72], [px + r * 1.15, topY - r * 0.72], [px, topY - r * 1.45]], iron, { flat: true, w: 4 }),
    ];
  }

  function lighthouse(cx, by, h, w, lit, tint) {
    const wb = Math.max(w, h * 0.22), wt = wb * 0.62, it = [], edge = (u) => lerp(wb, wt, u) / 2;
    const seg = (u0, u1, c) => poly([[cx - edge(u0), by - h * 0.86 * u0], [cx + edge(u0), by - h * 0.86 * u0], [cx + edge(u1), by - h * 0.86 * u1], [cx - edge(u1), by - h * 0.86 * u1]], tint(c), { flat: true, w: 5 });
    [[0, 0.25, "#f6f1e6"], [0.25, 0.5, "#d8402e"], [0.5, 0.75, "#f6f1e6"], [0.75, 1, "#d8402e"]].forEach(([a, b, c]) => it.push(seg(a, b, c)));
    it.push(poly([[cx - edge(1) * 1.25, by - h * 0.86], [cx + edge(1) * 1.25, by - h * 0.86], [cx + edge(1) * 1.25, by - h * 0.9], [cx - edge(1) * 1.25, by - h * 0.9]], tint("#2b2a3a"), { flat: true }));
    it.push(poly([[cx - edge(1) * 0.8, by - h * 0.9], [cx + edge(1) * 0.8, by - h * 0.9], [cx + edge(1) * 0.8, by - h * 0.99], [cx - edge(1) * 0.8, by - h * 0.99]], lit ? "#ffd84a" : "#9aa3b5", { flat: true }));
    it.push(poly([[cx - edge(1) * 1.1, by - h * 0.99], [cx + edge(1) * 1.1, by - h * 0.99], [cx, by - h * 1.08]], tint("#d8402e"), { flat: true }));
    it.push(poly([[cx - edge(0) * 0.25, by], [cx + edge(0) * 0.25, by], [cx + edge(0) * 0.25, by - h * 0.12], [cx - edge(0) * 0.25, by - h * 0.12]], tint("#5a3a24"), { flat: true, w: 4 }));
    return it;
  }
  /** A fishing boat: back (mast, sails, hull) and front (the near plank and a line of foam) so a crew standing in it is hidden to the knees. */
  function boat(x, y, s, rotA, tint, lit) {
    const T = (p) => rot([x + p[0] * s, y + p[1] * s], x, y, rotA);
    const sail = lit ? "#fff0b8" : "#f6f1e6", sail2 = lit ? "#f6dc8a" : "#e8dfc8";
    const back = [stroke([T([0, -20]), T([0, -200])], tint("#5a3a24"), 12), poly([T([8, -194]), T([112, -56]), T([8, -44])], tint(sail)), poly([T([-8, -178]), T([-86, -56]), T([-8, -44])], tint(sail2)),
      poly([T([-135, -24]), T([135, -24]), T([100, 36]), T([-100, 36])], tint("#a8683a"))];
    const front = [poly([T([-128, -8]), T([128, -8]), T([98, 34]), T([-98, 34])], tint("#8a5230"), { flat: true }), stroke([T([-132, -10]), T([132, -10])], tint("#5a3a24"), 7),
      stroke([T([-150, 40]), T([-80, 46]), T([0, 40]), T([80, 46]), T([150, 40])], "#f3f8fb", 8)];
    return { back, front };
  }

  // ---- people (front view, the library's colours): pose is arms and legs, mood is the mouth, extras are glasses, hat, cane, scarf
  const ARMS = { stand: [[0.03, 0.14, 0.04, 0.27]], walk: null, climb: null, hold: [[0.04, 0.13, -0.02, 0.19]], hug: [[0.06, 0.1, -0.08, 0.16]], pray: [[0.06, 0.1, -0.03, 0.1]], cross: [[0.02, 0.15, -0.1, 0.1]], open: [[0.14, 0.04, 0.28, 0.06]], shrug: [[0.1, 0.1, 0.14, 0.02]], hip: [[0.13, 0.1, 0.07, 0.2]], cheer: [[0.1, -0.08, 0.12, -0.25]], reach: [[0.09, 0.06, 0.18, 0.02]], wave: [[0.13, -0.05, 0.16, -0.2]], point: [[0.15, 0.05, 0.3, 0.03]], sit: [[0.03, 0.14, 0.04, 0.27]], kneel: [[0.03, 0.14, 0.04, 0.27]] };
  const armFor = (pose, side, t) => {
    if (pose === "walk" || pose === "climb") { const s = Math.sin(t * 6) * side; return [0.03, 0.14, 0.04 + 0.05 * s, 0.26]; }
    const a = ARMS[pose] || ARMS.stand, one = ["reach", "wave", "point"].includes(pose);
    if (one && side < 0) return ARMS.stand[0];
    const [ex, ey, hx, hy] = a[0]; return [ex, ey, hx + (pose === "wave" ? Math.sin(t * 9) * 0.04 : 0), hy];
  };
  // Reusable right-facing silhouette designed by Gemini Argon; mirrored for left views.
  const PROFILE = {"outline":[[-0.85,0.1],[-0.97,-0.35],[-0.72,-0.82],[-0.2,-1.03],[0.4,-0.97],[0.86,-0.62],[0.99,-0.2],[1.0,0.02],[1.1,0.14],[1.2,0.3],[1.05,0.4],[1.03,0.5],[0.99,0.62],[0.93,0.8],[0.72,1.04],[0.3,1.08],[-0.2,0.98],[-0.62,0.62]],"hair":[[-0.97,0.2],[-1.02,-0.5],[-0.62,-1.02],[0.1,-1.14],[0.72,-1.02],[0.97,-0.58],[0.9,-0.42],[0.5,-0.58],[0.1,-0.5],[-0.2,-0.2],[-0.36,0.18],[-0.6,0.5]],"beard":[[0.8,0.45],[0.95,0.7],[0.78,1.12],[0.35,1.25],[-0.15,1.05],[-0.22,0.65],[0.25,0.62],[0.6,0.42]],"eye":[0.55,-0.1],"ear":[-0.3,0.2],"mouth":[[0.97,0.56],[0.8,0.68],[0.58,0.64]],"bodyWidth":0.65};   // friendly profile: a round head, a small nose, a clear eye and a smile
  function person(s, X, Y, h, t, tint, o = {}) {
    const it = [], bodyScale = { slim: 0.85, average: 1, stocky: 1.22 }[s.build] ?? 1, hs = s.age === "child" ? 1.3 : 1, pose = o.pose || s.pose || "stand";
    const profile = ["left", "right"].includes(s.facing), dir = s.facing === "left" ? -1 : 1;
    const bob = Math.sin(t * 3 + X * 0.01) * h * 0.004; const Q = ([x, y]) => [X + x * h * (profile ? PROFILE.bodyWidth : 1), Y + bob + y * h];
    const top = tint(s.top || "#3a6a4a"), bottom = tint(s.bottom || "#2f3a55"), skin = tint(s.skin || "#d9a47a"), hairC = tint(s.hairColor || "#2a1d17");
    const seated = pose === "sit" || pose === "kneel", gsit = pose === "sit" && s.ground && o.seat === undefined, seat = o.seat ?? (pose === "kneel" ? 0.26 : gsit ? 0.07 : 0.1), hipY = seated ? -seat : -0.44, sy = seated ? 0.44 - seat : 0;   // seat: hip height above the feet in standing heights (a bench is about 0.27)
    const walk = Math.sin(t * 6), shY = -0.74 + sy, headY = -0.88 + sy;
    it.push(cast(X, Y + h * 0.01, h * (profile ? 0.13 : 0.17) * bodyScale, Math.max(5, h * 0.032)));
    // legs or dress (in profile, the far leg and shoe draw before the near leg and shoe)
    const legOrder = profile ? (dir > 0 ? [-1, 1] : [1, -1]) : [-1, 1];
    if (s.dress) it.push(poly([Q([-0.1 * bodyScale, hipY]), Q([0.1 * bodyScale, hipY]), Q([0.16, -0.04]), Q([-0.16, -0.04])], bottom, { flat: true, shade: 0.16 }));
    else if (pose === "kneel") {                                              // kneeling: the thighs go straight down to the ground, the knees rest on it, the shoes show behind them
      for (const sd of legOrder) it.push(limb([Q([sd * 0.05, hipY]), Q([sd * 0.062, -0.13]), Q([sd * 0.07, -0.05])], bottom, h * 0.075));
    }
    else if (gsit) {                                                           // sitting on the ground, cross-legged: knees out to the sides and low, the shins crossing in front
      for (const sd of legOrder) it.push(limb([Q([sd * 0.05, hipY]), Q([sd * 0.17, -0.05]), Q([-sd * 0.035, -0.04])], bottom, h * 0.075));
    }
    else if (seated) {                                                         // seated on a seat, seen from the front: thighs come toward us (knees apart and lower), the lower legs hang straight down to the shoes
      const lw2 = h * 0.082, kn = hipY + (seat > 0.2 ? 0.07 : 0.02), fy = seat > 0.2 ? -0.05 : -0.03;
      for (const sd of legOrder) it.push(limb([Q([sd * 0.055, hipY]), Q([sd * 0.115, kn]), Q([sd * 0.105, fy])], bottom, lw2));
    }
    else { const a = pose === "walk" || pose === "climb" ? walk : 0; for (const sd of legOrder) it.push(limb([Q([sd * 0.05, hipY]), Q([sd * 0.05 + sd * a * 0.03, -0.22]), Q([sd * 0.06 + sd * a * 0.08, -0.034 - Math.max(0, sd * a) * 0.03])], bottom, h * 0.07)); }
    { const a = pose === "walk" || pose === "climb" ? walk : 0, feet = gsit ? [[-0.06, -0.014], [0.06, -0.014]] : pose === "kneel" ? [[-0.07, -0.012], [0.07, -0.012]] : seated ? [[-0.105, -0.012], [0.105, -0.012]] : [[-0.06 - a * 0.08, -Math.max(0, -a) * 0.03], [0.06 + a * 0.08, -Math.max(0, a) * 0.03]];
      for (const i of (profile && dir < 0 ? [1, 0] : [0, 1])) { const [fx, fy] = feet[i], sd = profile ? dir : i ? 1 : -1; it.push(blob(...Q([fx + (profile ? sd * 0.014 : 0), fy - 0.014]), h * (profile ? 0.05 : 0.043), h * 0.027, tint("#2a211e"), { w: 3, shade: 0.06 })); } }   // the end of the leg is the shoe: one dark rounded oval, as wide as the leg, so no leg shows below it
    // neck, far arm (in profile, behind the torso: facing right = left arm is far; facing left = right arm is far), torso, near arm
    const bs = bodyScale, hem = seated ? hipY - 0.025 : hipY, aw = h * 0.044;     // a seated person's coat ends above the thighs, so the legs show
    const armPart = (side, far = false) => {
      const [ex, ey, hx, hy] = armFor(s.gesture && (seated || pose === "stand") ? s.gesture : pose, side, t), sh = Q([profile ? (far ? dir * 0.045 : -dir * 0.03) * bs : side * 0.092 * bs, shY + (far ? 0.028 : 0.036)]);
      let el = Q([side * (0.092 * bs + ex), shY + 0.032 + ey]), hd = Q([side * (0.092 * bs + hx), shY + 0.032 + hy]);
      if (profile && ["hold", "reach", "point"].includes(pose)) { el = Q([dir * (far ? .18 : .14), shY + (far ? .21 : .24)]); hd = Q([dir * (far ? .33 : .3), shY + (far ? .13 : .16)]); }
      else if (profile) { el = Q([dir * (far ? .07 : -.01) + (pose === "walk" || pose === "climb" ? Math.sin(t * 6) * side * 0.04 : 0), shY + .16]); hd = Q([dir * (far ? .09 : .01) + (pose === "walk" || pose === "climb" ? Math.sin(t * 6) * side * 0.07 : 0), shY + .29]); }
      const extra = [];
      if (o.reachTo && side === 1) { const dx = o.reachTo[0] - sh[0], dy = o.reachTo[1] - sh[1]; hd = [sh[0] + dx * 0.68, sh[1] + dy * 0.68]; el = [sh[0] + dx * 0.34 + h * 0.03, sh[1] + dy * 0.3 + h * 0.02]; extra.push(stroke([hd, o.reachTo], "#8a5a34", Math.max(6, h * 0.02), { line: "#5a3a24" })); }   // a stick from the hand to the ground
      const sleeveC = far ? mix(top, "#15122a", 0.2) : top, handC = far ? mix(skin, "#15122a", 0.14) : skin;
      return { hd, items: [...extra, limb([sh, el, hd], sleeveC, aw), blob(hd[0], hd[1], h * 0.021, h * 0.021, handC, { w: 3.5, plain: true })] };
    };
    const leftFar = profile && dir > 0, rightFar = profile && dir < 0;
    const leftArm = armPart(-1, leftFar), rightArm = armPart(1, rightFar), hands = [leftArm.hd, rightArm.hd];
    if (leftFar) it.push(...leftArm.items);
    if (rightFar) it.push(...rightArm.items);
    it.push(poly([Q([-0.032, shY + 0.01]), Q([0.032, shY + 0.01]), Q([0.03, headY + 0.05]), Q([-0.03, headY + 0.05])], mix(skin, "#1c1824", 0.14), { flat: true, plain: true, w: 3.5 }));
    it.push(poly([Q([-0.105 * bs, shY]), Q([0, shY - 0.03]), Q([0.105 * bs, shY]), Q([0.098 * bs, hem]), Q([-0.098 * bs, hem])], top, { shade: 0.16 }));
    it.push(stroke([Q([-0.045 * bs, shY - 0.012]), Q([0, shY + 0.022]), Q([0.045 * bs, shY - 0.012])], mix(top, "#15122a", 0.42), 3.2));   // collar
    if (s.facing === "back") it.push(stroke([Q([0, shY + 0.02]), Q([0, hem - 0.02])], mix(top, "#15122a", 0.28), 3));
    if (!leftFar) it.push(...leftArm.items);
    if (!rightFar) it.push(...rightArm.items);
    // head
    const hr = 0.075 * hs, hc = Q([0, headY]), back = s.facing === "back";   // a doodle person shows a face unless the director turned them away
    if (profile) {
      const R = h * hr, P = ([x,y]) => [hc[0] + dir * x * R, hc[1] + (y + 0.12) * R];   // the profile head sits a little lower, so no long neck shows
      it.push(poly(PROFILE.outline.map(P), skin, {plain:true, shade:0.12}), poly(PROFILE.hair.map(P), s.hair === "hood" ? top : hairC, {shade:0.15}));
      if (s.hair === "long") it.push(poly([[-.8,-.4],[-.35,-.3],[-.2,1.5],[-.95,1.5]].map(P),hairC));
      if (s.hair === "bun") { const b=P([-.7,-.9]); it.push(blob(b[0],b[1],R*.35,R*.35,hairC)); }
      if (s.hair === "beard") it.push(poly(PROFILE.beard.map(P),hairC));
      const eye=P(PROFILE.eye), ear=P(PROFILE.ear);
      const cheek = P([0.5, 0.38]), brow = [P([0.3, -0.38]), P([0.66, -0.4])];
      it.push(blob(ear[0],ear[1],R*.16,R*.22,skin,{plain:true,w:2}), blob(cheek[0],cheek[1],R*.2,R*.13,"rgba(226,120,120,.4)",{w:0.5,line:null}), blob(eye[0],eye[1],R*.13,R*.15,"#15122a",{feat:true,skinC:s.skin,w:1}), blob(eye[0]+dir*R*.04,eye[1]-R*.05,R*.045,R*.045,"#ffffff",{w:0.5,line:null}), stroke(brow,"#15122a",2.4,{feat:true,skinC:s.skin}), stroke(PROFILE.mouth.map(P),"#15122a",2.8,{feat:true,skinC:s.skin}));
      if ((s.extras||[]).includes("glasses")) it.push(blob(eye[0],eye[1],R*.25,R*.24,"rgba(255,255,255,.15)",{w:2}));
    } else {
    if (!back) { const R = h * hr; it.push(blob(hc[0] - R * 0.96, hc[1] + R * 0.04, R * 0.17, R * 0.22, mix(skin, "#1c1824", 0.08), { plain: true, w: 3 }), blob(hc[0] + R * 0.96, hc[1] + R * 0.04, R * 0.17, R * 0.22, mix(skin, "#1c1824", 0.08), { plain: true, w: 3 })); }
    it.push(blob(hc[0], hc[1], h * hr, h * hr * 1.08, skin, { plain: true, shade: 0.11 }));
    const style = s.hair || "short", top0 = hc[1] - h * hr * 0.2, hairPts = { short: [[-1, 0.2], [-1, -0.6], [0, -1.15], [1, -0.6], [1, 0.2], [0.6, -0.25], [-0.6, -0.25]], long: [[-1.12, 1.4], [-1.14, -0.5], [0, -1.18], [1.14, -0.5], [1.12, 1.4], [0.82, 0.25], [0.76, -0.32], [0, -0.46], [-0.76, -0.32], [-0.82, 0.25]], bun: [[-1, 0.1], [-1, -0.6], [0, -1.15], [1, -0.6], [1, 0.1], [0.5, -0.3], [-0.5, -0.3]], beard: [[-1, 0.1], [-1, -0.6], [0, -1.15], [1, -0.6], [1, 0.1], [0.5, -0.35], [-0.5, -0.35]], hood: [[-1.2, 1.1], [-1.2, -0.5], [0, -1.3], [1.2, -0.5], [1.2, 1.1], [0.62, 0.45], [-0.62, 0.45]] }[style] || null;
    if (back) it.push(blob(hc[0], hc[1], h * hr * 1.02, h * hr * 1.1, style === "hood" ? top : hairC, { shade: 0.16 }));
    if (back) { const R = h * hr; it.push(stroke([[hc[0] - R * 0.5, hc[1] - R * 0.55], [hc[0] - R * 0.2, hc[1] - R * 0.2], [hc[0] - R * 0.35, hc[1] + R * 0.35]], mix(style === "hood" ? top : hairC, "#000000", 0.3), 3, { line: mix(style === "hood" ? top : hairC, "#000000", 0.3) }), stroke([[hc[0] + R * 0.1, hc[1] - R * 0.7], [hc[0] + R * 0.3, hc[1] - R * 0.2], [hc[0] + R * 0.15, hc[1] + R * 0.4]], mix(style === "hood" ? top : hairC, "#000000", 0.3), 3, { line: mix(style === "hood" ? top : hairC, "#000000", 0.3) })); }   // the back of a head has hair, not a blank disc
    else if (hairPts) it.push(poly(hairPts.map(([x, y]) => [hc[0] + x * h * hr, hc[1] + y * h * hr * 0.9 - h * hr * 0.1]), style === "hood" ? top : hairC, { shade: 0.15 }));
    if (style === "bun") it.push(blob(hc[0], hc[1] - h * hr * 1.25, h * hr * 0.42, h * hr * 0.42, hairC, { w: 4 }));
    if (style === "beard" && !back) it.push(poly([[hc[0] - h * hr * 0.9, hc[1] + h * hr * 0.1], [hc[0] + h * hr * 0.9, hc[1] + h * hr * 0.1], [hc[0] + h * hr * 0.7, hc[1] + h * hr * 1.3], [hc[0], hc[1] + h * hr * 1.7], [hc[0] - h * hr * 0.7, hc[1] + h * hr * 1.3]], hairC));
    if (!back) {
      // A friendly doodle face, the same construction in every medium: two solid dots for eyes with a tiny highlight, short soft brows, a small nose, one clear mouth line, a blush.
      // Everything scales with the head (R), is placed on a grid (eyes at -0.05R, nose at +0.2R, mouth at +0.5R) and is drawn as "feature" items (dark on light skin, light on dark).
      const faceFrom = it.length, R = h * hr, mood = s.mood || "neutral", ey = hc[1] - R * 0.05, ex = R * 0.38, my = hc[1] + R * 0.5, er = Math.max(3, R * 0.13);
      const lift = mood === "surprised" ? 1.3 : 1, brow = mood === "worried" || mood === "sad" ? 1 : mood === "skeptical" ? -1 : 0;      // brows: inner ends up for worried/sad, one raised for skeptical
      it.push(blob(hc[0] - ex, ey, er, er * 1.15, "#15122a", { w: 1 }), blob(hc[0] + ex, ey, er, er * 1.15, "#15122a", { w: 1 }));
      if (er > 6) it.push(blob(hc[0] - ex + er * 0.35, ey - er * 0.35, er * 0.38, er * 0.38, "#ffffff", { w: 0.5, line: null }), blob(hc[0] + ex + er * 0.35, ey - er * 0.35, er * 0.38, er * 0.38, "#ffffff", { w: 0.5, line: null }));   // a highlight only when the eye is big enough to carry one
      const by = ey - R * 0.3 * lift, bl = R * 0.26, tiny = R < 24;   // a small head gets eyes and a mouth only: brows and a nose would turn into a black smudge
      if (!tiny) it.push(stroke([[hc[0] - ex - bl, by + (brow === 1 ? R * 0.07 : brow === -1 ? R * 0.02 : R * 0.02)], [hc[0] - ex, by - R * 0.04], [hc[0] - ex + bl, by + (brow === 1 ? -R * 0.04 : R * 0.03)]], "#15122a", 3.4),
        stroke([[hc[0] + ex - bl, by + (brow === 1 ? -R * 0.04 : R * 0.03)], [hc[0] + ex, by - R * 0.04 - (brow === -1 ? R * 0.1 : 0)], [hc[0] + ex + bl, by + (brow === 1 ? R * 0.07 : R * 0.02)]], "#15122a", 3.4));
      if (!tiny) it.push(stroke([[hc[0] - R * 0.05, hc[1] + R * 0.12], [hc[0], hc[1] + R * 0.24], [hc[0] + R * 0.1, hc[1] + R * 0.2]], "#15122a", 2.6));                  // the nose
      const mw = R * 0.34, mouths = { smile: [[-1, 0], [-0.5, 0.45], [0.5, 0.45], [1, 0]], laugh: "open", sad: [[-1, 0.4], [-0.4, 0], [0.4, 0], [1, 0.4]], worried: [[-1, 0.25], [-0.3, 0], [0.4, 0.2], [1, 0]], surprised: "o", skeptical: [[-1, 0.15], [0.2, 0.05], [1, -0.2]], neutral: [[-0.8, 0.12], [0, 0.2], [0.8, 0.12]] };
      const m = mouths[mood] ?? mouths.neutral;
      if (m === "open") it.push(poly([[hc[0] - mw * 1.1, my - R * 0.04], [hc[0] + mw * 1.1, my - R * 0.04], [hc[0] + mw * 0.8, my + R * 0.3], [hc[0], my + R * 0.4], [hc[0] - mw * 0.8, my + R * 0.3]], "#15122a", { flat: true, w: 1 }));
      else if (m === "o") it.push(blob(hc[0], my + R * 0.1, R * 0.12, R * 0.16, "#15122a", { w: 1 }));
      else it.push(stroke(m.map(([x, y]) => [hc[0] + x * mw, my + y * R * 0.3]), "#15122a", 3.6));
      for (let i = faceFrom; i < it.length; i++) { const f = it[i]; if (f.fill === "#ffffff") f.fill = "WHITE"; else if (f.fill === "#15122a") f.fill = "FEAT"; else if (f.fill) continue; f.feat = true; f.skinC = s.skin || "#d9a47a"; f.line = f.line === null ? null : "FEAT"; }
      if (!tiny) it.push(blob(hc[0] - R * 0.62, hc[1] + R * 0.32, R * 0.2, R * 0.12, "rgba(230,110,110,0.32)", { line: null }), blob(hc[0] + R * 0.62, hc[1] + R * 0.32, R * 0.2, R * 0.12, "rgba(230,110,110,0.32)", { line: null }));   // a blush
    }
    }
    for (const ex of s.extras || []) {
      if (ex === "glasses" && !back && !profile) { const gl = { w: 1.6, feat: true, skinC: s.skin || "#d9a47a" }; it.push(blob(hc[0] - h * hr * 0.42, hc[1] - h * hr * 0.1, h * hr * 0.3, h * hr * 0.3, "rgba(255,255,255,0.15)", gl), blob(hc[0] + h * hr * 0.42, hc[1] - h * hr * 0.1, h * hr * 0.3, h * hr * 0.3, "rgba(255,255,255,0.15)", gl)); }   // thin frames, never dark lenses
      if (ex === "hat") it.push(poly([[hc[0] - h * hr * 1.5, hc[1] - h * hr * 0.55], [hc[0] + h * hr * 1.5, hc[1] - h * hr * 0.55], [hc[0] + h * hr * 0.9, hc[1] - h * hr * 0.6], [hc[0] + h * hr * 0.8, hc[1] - h * hr * 1.5], [hc[0] - h * hr * 0.8, hc[1] - h * hr * 1.5], [hc[0] - h * hr * 0.9, hc[1] - h * hr * 0.6]], tint("#6a4a3a"), { flat: true }));
      if (ex === "scarf") it.push(poly([Q([-0.08, shY - 0.01]), Q([0.08, shY - 0.01]), Q([0.07, shY + 0.04]), Q([-0.07, shY + 0.04])], tint("#b8402e"), { flat: true }));
      if (ex === "cane") it.push(stroke([Q([0.2, -0.45]), Q([0.21, 0])], tint("#8a5a34"), 10));
    }
    return { items: it, hands, head: [Y - h * 1.02, Y - h * 0.55, Y - h * 0.76, Y + h * 0.02] };
  }

  // ---- interiors. The lighthouse stair is data: the keeper's feet are computed from the same tread list that draws it, so he always stands on a tread.
  const STAIR = (W, H) => ({ n: 9, x0: W * 0.12, y0: H * 0.9, run: W * 0.075, rise: H * 0.066, tw: W * 0.25 });
  const onStair = (W, H, u) => { const q = STAIR(W, H), i = Math.floor(clamp(u, 0, q.n - 1)), f = clamp(u, 0, q.n - 1) - i; return [q.x0 + q.tw / 2 + (i + f) * q.run, q.y0 - (i + f) * q.rise - Math.sin(Math.PI * f) * H * 0.012]; };
  function room(shot, W, H, FH, tint, T, Wt, t, flashes) {
    const kind = shot.room || "cabin", it = [], lh = kind === "lighthouse", night = T.amt > 0.3;
    if (kind === "lantern") {                                           // the lamp room: glass all round, the sea and sky beyond, the great lamp on its stand, an iron rail
      const sky = Wt.rain ? "#2a3048" : night ? "#10163a" : "#8dbbe6", sea = Wt.rain ? "#1f3a4d" : night ? "#1d2d5c" : "#4a8fb0", hzL = H * 0.5;
      it.push(rect(-40, -40, W + 40, hzL, tint(sky), { line: null }), rect(-40, hzL, W + 40, FH + 40, tint(sea), { line: null }));
      if (night && !Wt.rain) it.push(blob(W * 0.2, H * 0.18, 40, 40, "#f4efcf", { w: 4 }));
      for (let r = 0; r < 4; r++) it.push(stroke([[-40, hzL + 50 + r * 70], [W * 0.3, hzL + 45 + r * 70 + Math.sin(t * 3 + r) * 6], [W * 0.7, hzL + 55 + r * 70], [W + 40, hzL + 50 + r * 70]], tint("#6f86c9"), 5, { line: tint("#6f86c9") }));
      if (Wt.rain) it.push(...rain(46, t, W, H * 0.8, 0.42, "rgba(235,240,255,0.7)", 4, 1, 3));      if (Wt.bolts) for (const f of flashes || []) if (t - f >= 0 && t - f < 0.14) it.push(rect(-40, -40, W + 40, H * 0.75, "rgba(255,255,255,0.4)", { line: null }));
      for (const fx of [0.0, 0.34, 0.66, 1.0]) it.push(rect(W * fx - 14, -40, W * fx + 14, H * 0.74, tint("#2a2a34"), { line: "ink", w: 4 }));          // the glazing bars
      it.push(rect(-40, H * 0.4, W + 40, H * 0.425, tint("#2a2a34"), { line: "ink", w: 4 }), rect(-40, H * 0.74, W + 40, FH + 40, tint("#4a4c60"), { line: "ink", w: 6 }), rect(-40, H * 0.72, W + 40, H * 0.745, tint("#2a2a34"), { line: null }));
      return it;
    }
    const wall = { cabin: "#8a6048", kitchen: "#c9b48a", bedroom: "#a8a0c0", workshop: "#7a6a58", lighthouse: "#8a8ca6", church: "#b8a890", shop: "#a8785a" }[kind] || "#8a6048", floorTop = H * 0.74;
    it.push(rect(-40, -40, W + 40, FH + 40, tint(wall)));
    if (lh) {
      it.push(rect(-40, -40, W * 0.12, FH, tint("#5a5d78"), { line: null }), rect(W * 0.88, -40, W + 40, FH, tint("#5a5d78"), { line: null }));        // the curve of the round wall
      for (let r = 0; r < 14; r++) for (let k = 0; k < 4; k++) { const x = -40 + k * 290 + (r % 2) * 145; it.push(stroke([[x, 50 + r * 150], [x + 130, 50 + r * 150]], tint("#5a5d78"), 4), stroke([[x + 65, 50 + r * 150], [x + 65, 50 + (r + 1) * 150]], tint("#5a5d78"), 4)); }
    }
    const out = Wt.rain ? "#3d4357" : night ? "#14183a" : "#bfe3f2", wx = W * 0.66, wy = H * 0.12, ww = W * 0.22, wh = H * 0.24;
    it.push(poly([[wx, wy + wh], [wx, wy + ww / 2], [wx + ww * 0.1, wy + ww * 0.12], [wx + ww / 2, wy], [wx + ww * 0.9, wy + ww * 0.12], [wx + ww, wy + ww / 2], [wx + ww, wy + wh]], tint(out), { flat: false, w: 8 }));
    if (night && !Wt.rain) it.push(blob(wx + ww * 0.6, wy + wh * 0.4, 30, 30, "#fff3b8", { w: 4 }));
    if (Wt.rain) it.push(...rain(10, t, ww - 30, wh - 80, 0.1, "rgba(235,240,255,0.8)", 3, 1, 5).map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [wx + 20 + x, wy + 40 + y]) })));   // the rain is outside the glass    if (Wt.bolts) for (const f of flashes || []) if (t - f >= 0 && t - f < 0.14) it.push(rect(wx, wy, wx + ww, wy + wh, "rgba(255,255,255,0.55)", { line: null }));
    it.push(rect(-40, floorTop, W + 40, FH + 40, tint(lh ? "#4a4c60" : "#6a4630"), { line: "ink", w: 5 }));
    if (lh) {
      const q = STAIR(W, H);
      it.push(rect(W * 0.04, H * 0.2, W * 0.09, floorTop, tint("#6a6d88"), { line: "ink", w: 5 }));                                            // the central column
      for (let i = 0; i < q.n; i++) { const x = q.x0 + i * q.run, y = q.y0 - i * q.rise; it.push(poly([[x, y], [x + q.tw, y], [x + q.tw, y + H * 0.028], [x, y + H * 0.028]], tint(i % 2 ? "#8a5a34" : "#a8693a"), { flat: true, w: 5 }), poly([[x, y + H * 0.028], [x + q.tw, y + H * 0.028], [x + q.tw, y + q.rise], [x, y + q.rise]], tint("#5a3a24"), { flat: true, line: null })); }
      it.push(stroke([[q.x0 + q.tw, q.y0 - H * 0.1], [q.x0 + (q.n - 1) * q.run + q.tw, q.y0 - (q.n - 1) * q.rise - H * 0.1]], tint("#3a2c24"), 9));   // the handrail
    } else {
      it.push(poly([[W * 0.08, floorTop], [W * 0.38, floorTop], [W * 0.38, H * 0.55], [W * 0.08, H * 0.55]], tint("#6a4630"), { flat: true }), blob(W * 0.23, H * 0.64, 40 + Math.sin(t * 9) * 4, 54, "#ffb347", { w: 4 }));
    }
    return it;
  }

  // ---- the whole shot
  function draw(k, shot) {
    seedN = 0; const g = k.g, W = k.W, H = k.H, FH = k.FH || H, t = k.t;
    const M = MEDIA[(window.DoodleScenes.medium && MEDIA[window.DoodleScenes.medium]) ? window.DoodleScenes.medium : "marker"];
    const { TIMES, WEATHER } = window.PaintedScenes, T = TIMES[shot.time] || TIMES.day, Wo = WEATHER[shot.weather] || WEATHER.clear, indoors = shot.place === "interior", Wt = indoors ? WEATHER.clear : Wo;   // weather never falls inside a room: Wo is only what the window shows
    const season = shot.season, gray = (Wt.gray || 0) + (season === "winter" ? 0.18 : 0), snowy = shot.weather === "snow" || shot.weather === "blizzard" || season === "winter", dry = shot.ground === "dry";
    const tint = (c) => mix(mix(c, "#8e98a4", gray * 0.45), T.shade, Math.min(0.6, T.amt * 0.5));
    const gc = (day) => (snowy ? "#e9eff4" : dry ? mix(day, "#c9a566", 0.78) : season === "autumn" ? mix(day, "#c9843a", 0.55) : day);
    const place = BASE(shot) && shot.place in { meadow: 1, hills: 1, lake: 1, sea: 1, forest: 1, city: 1, street: 1, village: 1, mountains: 1, desert: 1, field: 1, shore: 1, road: 1, sky: 1, river: 1, interior: 1, custom: 1 } ? shot.place : "meadow";
    const hasProp = (kind) => (shot.props || []).some((p) => p.kind === kind), cont = Boolean(shot.continues);
    // drawing in is a CHOICE: "opening" (the default, a continuous film): only the opening shot draws itself in from blank paper, every later shot is complete from its first frame; "each": every shot draws itself in again at every transition; "all": every NEW scene draws in (a continuing scene does not); "none": never
    const mode = window.DoodleScenes.drawIn || "opening", sceneDone = mode === "none" || (mode === "opening" && !shot.first) || (mode === "all" && cont), propsDone = sceneDone;   // "each": never done at the start of a shot, so it draws in every time
    const hz = { sea: 0.6, lake: 0.58, shore: 0.52, river: 0.56, village: 0.55, meadow: 0.56, hills: 0.52, field: 0.56, forest: 0.5, mountains: 0.45, desert: 0.58, road: 0.55, city: 0.62, street: 0.56, sky: 0.9, custom: 0.58, interior: 0.6 }[place] * H;
    const scene = [], fx = []; let sunAt = null, glow = null;
    // sky
    if (!indoors) {
      const stops = T.sky.map((c) => mix(c, "#9aa6b2", gray * 0.65)), n = 10;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), si = u * (stops.length - 1), i0 = Math.floor(si), col = mix(stops[i0], stops[Math.min(stops.length - 1, i0 + 1)], si - i0);
        scene.push(rect(-40, (hz * i) / n - 40 * (i === 0), W + 40, (hz * (i + 1)) / n + 4, col));
      }
      if (T.stars && !Wt.rain && !Wt.fog) for (let i = 0; i < Math.min(26, T.stars / 3); i++) scene.push(blob(((i * 191 + 37) % W), ((i * 97 + 53) % (hz * 0.82)), 4 + (i % 3) * 1.5, 4 + (i % 3) * 1.5, "#fff5c0", { line: null, flat: true }));
      if (T.sun && !Wt.rain && !Wt.fog && !hasProp("sun")) { const sx = T.sun.x * W, sy = Math.min(T.sun.y * H, hz - H * 0.05); sunAt = [sx, sy]; scene.push(...(Wt.clouds ? [] : [blob(sx, sy, W * 0.24, W * 0.24, "rgba(255,222,140,0.22)", { line: null, plain: true }), blob(sx, sy, W * 0.15, W * 0.15, "rgba(255,232,165,0.34)", { line: null, plain: true })]), blob(sx, sy, W * 0.082, W * 0.082, T.sun.color === "#fffbe0" ? "#ffe47a" : mix(T.sun.color, "#f58f3d", 0.5), { w: 5.5, shade: 0.1 })); }
      if (T.moon && !Wt.rain && !Wt.fog && !hasProp("moon")) { sunAt = [W * 0.74, H * 0.27]; scene.push(...(Wt.clouds ? [] : [blob(W * 0.74, H * 0.27, W * 0.16, W * 0.16, "rgba(244,239,207,0.16)", { line: null, plain: true })]), blob(W * 0.74, H * 0.27, W * 0.058, W * 0.058, "#f4efcf", { w: 4.5, shade: 0.12 })); }
      const cloudN = Wt.clouds ? Math.min(Wt.bolts ? 11 : 5, Wt.clouds) : (!T.stars && !Wt.fog ? 2 : 0);
      for (let i = 0; i < cloudN; i++) { const big = Wt.bolts ? 1.5 : Wt.clouds ? 1 : 0.72, x = ((i * 293 + 110 + t * 12) % (W + 320)) - 160, y = hz * (0.14 + 0.55 * ((i * 7 + 3) % 11) / 11), c = Wt.rain ? "#4a5068" : "#fbfcfe", d = Wt.rain ? "#2d3144" : "#dde6f0"; const puffs = [[x, y, 138 * big, 48 * big, i % 2 ? c : d], [x - 92 * big, y + 18 * big, 92 * big, 38 * big, d], [x + 94 * big, y + 14 * big, 100 * big, 40 * big, c]];
        scene.push(...puffs.map(([px, py, rx, ry, col]) => blob(px, py, rx, ry, tint(col), { w: 4.5 })), ...puffs.map(([px, py, rx, ry, col]) => blob(px, py - 3, rx - 5, ry - 5, tint(col), { line: null })), stroke([[x - 82 * big, y - 26 * big], [x, y - 46 * big], [x + 82 * big, y - 24 * big]], Wt.rain ? "#7a84a0" : "#ffffff", 5.5, { line: Wt.rain ? "#7a84a0" : "#ffffff" })); }
    }
    // place
    const rough = (place === "sea" || place === "lake") ? Wt.rough || 0 : 0;
    const meadowFoliage = (yTop, baseCol) => {
      const midCol = tint(gc(mix(baseCol, "#88bd42", 0.34))), nearCol = tint(gc(baseCol)), darkGrass = tint(gc(mix(baseCol, "#254f22", 0.36)));
      scene.push(
        poly([[-40, yTop], [W * 0.35, yTop - 10], [W * 0.72, yTop + 6], [W + 40, yTop - 4], [W + 40, FH + 40], [-40, FH + 40]], midCol, { w: 4.5 }),
        poly([[-40, yTop + H * 0.08], [W * 0.28, yTop + H * 0.065], [W * 0.68, yTop + H * 0.09], [W + 40, yTop + H * 0.07], [W + 40, FH + 40], [-40, FH + 40]], nearCol, { w: 4.5 }),
        poly([[-40, yTop + H * 0.22], [W * 0.42, yTop + H * 0.2], [W + 40, yTop + H * 0.23], [W + 40, FH + 40], [-40, FH + 40]], tint(gc(mix(baseCol, "#3d7a28", 0.22))), { line: null })
      );
      if (place === "road" || place === "river" || (place === "hills" && shot.path === true)) {     // hills and meadows are walked on the ground; a road or path is drawn only when the words name one (lint sets path: true then)
        const isRiv = place === "river", pCol = tint(isRiv ? "#4892b8" : place === "hills" ? "#d6be8c" : "#9e9589"), bankC = tint(isRiv ? "#7a6648" : "#b8a682");
        scene.push(
          poly([[W * 0.43, yTop + 4], [W * 0.57, yTop + 4], [W * 0.84, FH + 40], [W * 0.16, FH + 40]], bankC, { flat: true, line: null }),
          poly([[W * 0.45, yTop + 4], [W * 0.55, yTop + 4], [W * 0.78, FH + 40], [W * 0.22, FH + 40]], pCol, { flat: true, w: 4.5 })
        );
        if (isRiv) for (let i = 0; i < 5; i++) { const ry = yTop + 45 + i * 75; scene.push(stroke([[W * 0.42 - i * 14, ry], [W * 0.5, ry + 8], [W * 0.58 + i * 14, ry]], "#d8f0f8", 4.5, { line: "#d8f0f8" })); }
      }
      for (let i = 0; i < 14; i++) {
        const x = (i * 179 + 48) % (W - 40) + 20, u = ((i * 97 + 19) % 100) / 100, y = yTop + 45 + u * (H * 0.34), sc = 0.65 + u * 0.55;
        scene.push(
          stroke([[x - 10 * sc, y], [x - 4 * sc, y - 18 * sc], [x + 1 * sc, y]], darkGrass, 4 * sc, { line: darkGrass }),
          stroke([[x + 2 * sc, y], [x + 10 * sc, y - 21 * sc], [x + 15 * sc, y]], darkGrass, 4 * sc, { line: darkGrass })
        );
        if (!snowy && !dry && season !== "autumn" && i % 2 === 0) {
          const fc = ["#ffe866", "#ff9eb5", "#fff9d2", "#a8d8ff"][((i / 2) | 0) % 4];
          scene.push(blob(x + 3 * sc, y - 22 * sc, 6.5 * sc, 6.5 * sc, tint(fc), { line: null, plain: true }), blob(x + 3 * sc, y - 22 * sc, 2.5 * sc, 2.5 * sc, "#e89a24", { line: null, plain: true }));
        }
      }
    };
    switch (place) {
      case "sea": scene.push(ridge(hz - 8, 14, tint("#5a7a98"), 4, W, hz + 30), ...waves(hz, FH, W, tint("#3a86a8"), tint("#bfe6f0"), rough, t, 7, true)); if (sunAt && !Wt.rain) for (let i = 0; i < 6; i++) scene.push(stroke([[sunAt[0] - 70 + i * 6, hz + 30 + i * 40], [sunAt[0] + 70 - i * 6, hz + 34 + i * 40]], "rgba(255,235,160,0.7)", 8, { line: "rgba(255,235,160,0.7)" })); break;
      case "lake": scene.push(ridge(hz - 30, 40, tint("#4f6f7e"), 7, W, hz + 20), ridge(hz - 8, 20, tint("#33593f"), 9, W, hz + 20), ...waves(hz, FH, W, tint("#4a8fa8"), tint("#bfe6f0"), rough * 0.5, t, 5)); if (sunAt && !Wt.rain) for (let i = 0; i < 5; i++) scene.push(stroke([[sunAt[0] - 60 + i * 6, hz + 30 + i * 36], [sunAt[0] + 60 - i * 6, hz + 34 + i * 36]], "rgba(255,235,160,0.7)", 8, { line: "rgba(255,235,160,0.7)" })); break;
      case "shore": scene.push(ridge(hz - 18, 24, tint("#6888a4"), 6, W, hz + 20), ...waves(hz, hz + H * 0.26, W, tint("#4aa9b2"), tint("#bfe6f0"), rough * 0.5 + 0.08, t, 4), poly([[-40, hz + H * 0.24], [W * 0.3, hz + H * 0.215], [W * 0.7, hz + H * 0.235], [W + 40, hz + H * 0.22], [W + 40, FH + 40], [-40, FH + 40]], snowy ? "#e6edf2" : tint("#e0cfa0"), { shade: 0.12 }), stroke([[-40, hz + H * 0.235], [W * 0.25, hz + H * 0.215], [W * 0.5, hz + H * 0.235], [W * 0.75, hz + H * 0.215], [W + 40, hz + H * 0.23]], "#f3f8fb", 9, { line: "#f3f8fb" }));
        for (let i = 0; i < 9; i++) { const x = (i * 131 + 40) % W, y = hz + H * 0.3 + ((i * 197) % (H * 0.3)); scene.push(stroke([[x - 40, y], [x, y - 10], [x + 50, y]], snowy ? "#cfdbe4" : tint("#c9b47e"), 6, { line: snowy ? "#cfdbe4" : tint("#c9b47e") }), blob(x + 18, y + 6, 8, 5, tint("#9c8c74"), { w: 3 })); } if (sunAt && !Wt.rain) for (let i = 0; i < 4; i++) scene.push(stroke([[sunAt[0] - 50 + i * 6, hz + 18 + i * 30], [sunAt[0] + 50 - i * 6, hz + 22 + i * 30]], "rgba(255,235,160,0.7)", 8, { line: "rgba(255,235,160,0.7)" })); break;
      case "mountains": scene.push(ridge(hz, 130, tint("#8aa0bf"), 5, W, FH, "peaks"), ridge(hz + H * 0.1, 80, tint("#566b88"), 8, W, FH, "peaks")); meadowFoliage(hz + H * 0.19, "#5c8a58"); break;
      case "desert": scene.push(ridge(hz, 50, tint("#d9a860"), 3, W, FH), ridge(hz + H * 0.08, 40, tint("#c9944f"), 6, W, FH), poly([[-40, hz + H * 0.16], [W * 0.45, hz + H * 0.14], [W + 40, hz + H * 0.17], [W + 40, FH + 40], [-40, FH + 40]], tint("#bf8642"), { shade: 0.15 })); break;
      case "city": for (let i = 0; i < 12; i++) { const x = i * (W / 11), h = 160 + ((i * 97) % 200) * 1.2, bx = x + W / 11 + 6; scene.push(rect(x, hz - h, bx, FH, tint(["#2a2f5a", "#343a6a", "#242a50"][i % 3]), { line: "ink", w: 4, shade: 0.15 })); for (let wy = hz - h + 24; wy < hz + 20; wy += 42) if ((i + wy) % 3 === 0) scene.push(rect(x + 14, wy, bx - 18, wy + 18, T.amt > 0.3 ? "#ffe28a" : "#7082a8", { line: null })); } scene.push(rect(-40, hz + H * 0.14, W + 40, FH + 40, tint("#3a3f6a"), { line: "ink", w: 4 })); break;
      case "street": {
        const curbY = hz + H * 0.16, walkY = hz + H * 0.06;
        // Background row of neighbouring shops & town buildings lining the sidewalk facing the street
        const rowShops = [
          [W * 0.12, walkY + 12, W * 0.25, H * 0.22, "#d8b894", "#6e3b2e"],
          [W * 0.37, walkY + 12, W * 0.25, H * 0.25, "#e2c9a6", "#4f3a4b"],
          [W * 0.63, walkY + 12, W * 0.26, H * 0.23, "#c9a882", "#7a3f31"],
          [W * 0.88, walkY + 12, W * 0.24, H * 0.21, "#d4b499", "#3f4e5e"]
        ];
        for (const [sx, sy, sw, sh, wl, rf] of rowShops) {
          scene.push(...house(sx, sy, sw, sh, tint(snowy ? mix(wl, "#e8eff5", 0.35) : wl), tint(rf), T.amt > 0.25, "shop"));
        }
        // Stone sidewalk in front of the shops + curb + cobbled street road in foreground
        scene.push(
          rect(-40, walkY, W + 40, curbY, snowy ? "#dce6ee" : tint("#b8aea0"), { line: "ink", w: 4 }),
          rect(-40, curbY, W + 40, FH + 40, snowy ? "#c8d4de" : tint("#7a756c"), { line: "ink", w: 4.5 }),
          stroke([[-40, curbY + 6], [W + 40, curbY + 6]], tint("#54504a"), 4, { flat: true })
        );
        // Cobblestone courses across the street
        for (let r = 0; r < 5; r++) {
          const cy = curbY + 42 + r * (H * 0.062);
          for (let c = 0; c < 8; c++) {
            const cx = ((c * 145 + r * 68) % (W - 40)) + 20;
            scene.push(blob(cx, cy, 13 + (r % 2) * 3, 4.5, snowy ? "#e6eef5" : tint("#656058"), { w: 1.8 }));
          }
        }
        break;
      }
      case "forest": scene.push(ridge(hz, 30, tint("#3b5a3a"), 5, W, FH)); meadowFoliage(hz + H * 0.1, "#4e8034"); for (let i = 0; i < 6; i++) { const tx = 55 + i * 165; scene.push(poly([[tx - 6, hz - 240], [tx + 34, hz - 240], [tx + 42, hz + H * 0.18], [tx - 14, hz + H * 0.18]], tint("#4a3525"), { flat: true, shade: 0.24, w: 4.5 }), blob(tx + 14, hz - 230, 85, 65, tint(gc("#386b2c")), { w: 4.5 })); } break;
      case "interior": scene.push(...room(shot, W, H, FH, tint, T, Wo, t, shot.flashes)); break;
      case "custom": if (shot.recipe && (shot.recipe.layers || []).length) { scene.push(...placeItems(shot.recipe, W, H, FH, tint)); break; }   // the oracle drew this place: draw it
      // falls through to a meadow when there is no recipe
      default:
        scene.push(
          ridge(hz - 34, 42, tint(place === "hills" ? "#7b93b8" : "#88a88e"), 11, W, FH),
          ridge(hz - 10, 32, tint(gc(place === "hills" ? "#688e5e" : "#759c58")), 2, W, FH)
        );
        for (let i = 0; i < 7; i++) { const bx = (i * 165 + 40) % (W + 40) - 20; scene.push(blob(bx, hz + 8, 52 + (i % 3) * 18, 24 + (i % 2) * 8, tint(gc("#4d7c38")), { w: 3.5 })); }
        meadowFoliage(hz + 14, place === "field" ? "#c9a43a" : "#58a531");
        if (place === "village" && !hasProp("house")) scene.push(...house(W * 0.26, hz + 44, 280, 200, tint("#c2a684"), tint("#7a3f31"), T.amt > 0.3), ...house(W * 0.76, hz + 28, 240, 170, tint("#b59876"), tint("#6a4234"), T.amt > 0.3), ...tree(W * 0.52, hz + 24, 210, tint(gc("#4f8a3a")), tint("#6a4a2c"), t, 5));
    }
    // props, drawn far to near
    const boatP = (shot.props || []).find((p) => p.kind === "boat"), isAboard = (s) => boatP && !s.on && (s.aboard !== undefined ? Boolean(s.aboard) : Math.abs((s.x ?? 0.5) - (boatP.x ?? 0.5)) < 0.18);   // the relationship layer decides; near-ness is the fallback
    const aspect = H / W, needsLand = (place === "sea" || place === "lake") && ((shot.subjects || []).some((s) => !s.on && !isAboard(s)) || (shot.props || []).some((p) => ["lighthouse", "cross", "house", "tree", "lamp"].includes(p.kind) && !p.on && !p.dressing));
    const baseF = needsLand ? 0.86 : BASE(shot), world = window.PaintedLayout.compose(shot, { base: baseF, place, needsLand, aspect }), props = [], boatNode = world.props.find((n) => n.prop.kind === "boat");
    const detailNode = shot.detailOf && world.props.find(n => n.prop.id === shot.detailOf), peopleHere = (shot.subjects || []).some(s => ["hold", "reach"].includes(s.gesture || s.pose));
    // a fruit that is picked or handed over is seen at the hands of the people, not zoomed on the ground
    const detail = shot.portraitOf ? window.PaintedLayout.portraitCamera(world.subjects.find(n => n.subject.who === shot.portraitOf)) : detailNode && fruitKind(detailNode.prop) && peopleHere ? window.PaintedLayout.handoverCamera(world.subjects, aspect) : shot.detailOf && window.PaintedLayout.detailCamera(detailNode, world.subjects, aspect);
    const zoom = detail ? detail.scale : 1;
    if (detail) { g.translate(detail.x * W, detail.y * H); g.scale(detail.scale, detail.scale); }
    window.PaintedScenes.frameBounds = detail ? null : world.frameBounds;
    const aboard = (s) => boatNode && isAboard(s);
    if (needsLand && !world.props.some((n) => n.prop.kind === "rock" && !n.prop.dressing)) props.push(poly([[-40, H * 0.8], [W * 0.5, H * 0.78], [W + 40, H * 0.8], [W + 40, FH + 40], [-40, FH + 40]], snowy ? "#e6edf2" : place === "lake" ? tint(gc("#7ab050")) : tint("#6b6a66"), { shade: 0.14 }));   // a lake has a bank to stand on; open sea has rock
    let lampPos = null, beamPos = null, markTip = null; const boatFront = [], anchors = new Map(), handsByPerson = new Map(), pondAt = [], marks = [], fruitProps = [], heldProps = [];
    for (const node of [...world.props].sort((a, b) => (b.depth || 0) - (a.depth || 0))) {
      const p = node.prop, px = node.x * W, py = node.y * H; let ph = node.h * H, pw = node.w * W;
      anchors.set(p, [px, py - ph * .25]);
      if (p.kind === "rock") props.push(...rock(px, py, pw, ph, tint));
      else if (p.kind === "lighthouse") { props.push(cast(px, py + 6, pw * 0.65, 14), ...lighthouse(px, py, ph * 1.05, pw, T.amt > 0.3, tint)); lampPos = [px, py - ph * 1.05 * 0.945]; beamPos = lampPos; }
      else if (p.kind === "house") {
        // On a street, the row of shops is already drawn behind the sidewalk; only draw an explicit foreground house if not redundant, and style it as a shop on streets
        if (place === "street") continue;
        props.push(...house(px, py, pw, ph * 0.7, tint("#a08a70"), tint("#6a3f31"), T.amt > 0.3, p.style));
      }
      else if (p.kind === "tree") props.push(...tree(px, py, ph, tint(gc("#4f8a3a")), tint("#6a4a2c"), t, 1, p.fruit));
      else if (p.kind === "lamp" && indoors) { props.push(...lampPost(px, py, ph, true, tint)); lampPos = [px, py - ph * 0.62]; }
      else if (p.kind === "lamp") { props.push(...lampPost(px, py, ph, false, tint)); lampPos = lampPos || [px, py - ph]; }
      else if (p.kind === "boat") { const bt = boat(px, py - (place === "shore" ? H * 0.09 : 0) + Math.sin(t * 2.2 + px) * rough * 26, pw / 340 * (place === "shore" ? 0.8 : 1), Math.sin(t * 1.7 + px) * 0.2 * rough, tint, T.amt > 0.3 && (hasProp("lighthouse") || hasProp("beam"))); props.push(...bt.back); boatFront.push(...bt.front); }
      else if (p.heldBy) heldProps.push({ p, px, py, pw, ph });                            // something a person holds: drawn after the people, in their hand
      else if (fruitKind(p)) fruitProps.push({ p, kind: fruitKind(p), px, py, ph });     // a piece of fruit: drawn after the people, in a hand if someone holds or reaches
      else if (commonKind(p)) props.push(...commonPropItems(commonKind(p), px, py, pw, ph, tint, t, p));
      else if (p.kind === "custom" && p.recipe && p.recipe.space === "object") {
        if (!detail && !p.dressing && ph < H * 0.05) { const grow = (H * 0.05) / ph; pw *= grow; ph *= grow; }                      // a small thing (a toy, a spool) is drawn big enough to read
        const descId = `${p.describe ?? ""} ${p.id ?? ""}`, airborne = !p.on && /\b(kite|balloon|airship|drone|bird|lantern)\b/i.test(descId);
        const ay = airborne ? Math.min(py - H * 0.34, hz - H * 0.08) + Math.sin(t * 2 + px * 0.01) * 7 : py;
        anchors.set(p, [px, ay - ph * (airborne ? .1 : .25)]);
        const floaty = !airborne && (p.on || ["lake", "sea", "river", "shore"].includes(place) || world.props.some((n) => n.prop.kind === "pond")) && /\b(boat|ship|raft|canoe|duck|float\w*|buoy)\b/i.test(descId);
        if (floaty) {                                                           // a floating thing is ON the water, bobbing, never on the bank; a toy is drawn big enough to read
          const pn = p.on ? world.props.find((n) => n.prop.id === p.on) : world.props.find((n) => n.prop.kind === "pond"), sc = Math.max(1, (H * 0.07) / ph), fh = ph * sc, fw = pw * sc, fy = (pn ? pn.y * H - 2 : hz + H * (place === "shore" ? 0.12 : 0.09)) + Math.sin(t * 2.2 + px) * 4; const fx = pn && !p.on ? pn.x * W + (px > pn.x * W ? 1 : -1) * Math.min(Math.abs(px - pn.x * W), pn.w * W * 0.22) : px;
          props.push(
            blob(fx, fy + 4, fw * 0.72, Math.max(5, fh * 0.12), "rgba(255,255,255,0.45)", { line: null, plain: true }),
            blob(fx, fy + 5, fw * 0.45, Math.max(4, fh * 0.09), "rgba(22,42,60,0.28)", { line: null, plain: true }),
            ...recipeItems(p.recipe, fx, fy, fw, fh, tint, snowy, p.describe || ""),
            stroke([[fx - fw * 0.62, fy + 4], [fx - fw * 0.2, fy + 9], [fx + fw * 0.2, fy + 4], [fx + fw * 0.62, fy + 9]], "#f3f8fb", 4.5, { line: "#f3f8fb" })
          );
          anchors.set(p, [fx, fy - fh * .25]);
        } else {
          if (!p.on && !airborne) props.push(cast(px, py + 3, pw * 0.46, Math.max(6, ph * 0.08)));
          props.push(...recipeItems(p.recipe, px, ay, pw, ph, tint, snowy, p.describe || ""));
        }
      }
      else if (p.kind === "pond") {
        const rx = pw / 2, ry = Math.max(16, rx * 0.22); pondAt.push({ x: px, y: py, rx, ry });
        props.push(
          blob(px, py + 3, rx * 1.13, ry * 1.28, snowy ? "#b8c7d4" : tint("#6e583f"), { w: 4.5 }),
          blob(px, py, rx * 1.05, ry * 1.14, snowy ? "#9fb6c6" : tint("#2b627c"), { w: 4.5 }),
          blob(px, py + 1, rx * 0.98, ry * 0.98, snowy ? "#dcebf5" : tint("#48a3b8"), { line: null }),
          blob(px - rx * 0.14, py - ry * 0.12, rx * 0.64, ry * 0.56, snowy ? "#eef6fc" : tint("#6cc2d4"), { line: null }),
          stroke([[px - rx * 0.55, py - ry * 0.22], [px - rx * 0.15, py - ry * 0.36], [px + rx * 0.22, py - ry * 0.2]], "#f3f8fb", 5, { line: "#f3f8fb" }),
          stroke([[px - rx * 0.32, py + ry * 0.28], [px + rx * 0.08, py + ry * 0.38], [px + rx * 0.44, py + ry * 0.22]], "rgba(243,248,251,0.75)", 4, { line: "rgba(243,248,251,0.75)" }),
          blob(px - rx * 0.88, py + ry * 0.68, 12, 7, tint("#7c7265"), { w: 3.5 }),
          blob(px - rx * 0.78, py + ry * 0.82, 8, 5, tint("#968b7c"), { w: 3 }),
          blob(px + rx * 0.84, py + ry * 0.64, 11, 6, tint("#7c7265"), { w: 3.5 }),
          stroke([[px - rx * 1.02, py + ry * 0.55], [px - rx * 0.96, py - ry * 0.2]], tint("#3f7830"), 5),
          stroke([[px - rx * 0.95, py + ry * 0.62], [px - rx * 0.86, py - ry * 0.08]], tint("#4f8a3a"), 4.5),
          stroke([[px + rx * 0.96, py + ry * 0.5], [px + rx * 1.04, py - ry * 0.15]], tint("#3f7830"), 5)
        );
      }
      else if (p.kind === "groundmark") {                                         // drawn in the ground during the shot; the stick tip (markTip) is where the drawer's hand goes
        const pwm = Math.max(pw, W * 0.5), my0 = py + H * 0.075, q = p.done ? 1 : clamp((k.p - 0.1) / 0.7), segs = markShape(p.shape || "sun").map((sg) => sg.map(([u, v]) => [px + u * pwm / 2, my0 + v * pwm * 0.2]));
        const lens = segs.map((sg) => sg.slice(1).reduce((a, b, i) => a + Math.hypot(b[0] - sg[i][0], b[1] - sg[i][1]), 0)), total = lens.reduce((a, b) => a + b, 0); let left = q * total;
        const groove = snowy ? "#6f8aa2" : "#6a4a30", rim = snowy ? "#ffffff" : "#a88a64";
        segs.forEach((sg, i) => { if (left <= 0) return; if (p.done) { marks.push(stroke(sg.map(([x, y]) => [x, y + 3]), rim, 9, { line: rim, flat: true }), stroke(sg, groove, 7, { line: groove, flat: true })); left -= lens[i]; return; } const part = cut(sg, Math.min(1, left / (lens[i] || 1))); left -= lens[i];
          marks.push(stroke(part.length > 1 ? part.map(([x, y]) => [x, y + 3]) : [part[0], part[0]], rim, 9, { line: rim, flat: true }), stroke(part.length > 1 ? part : [part[0], part[0]], groove, 7, { line: groove, flat: true })); markTip = part.at(-1); });
        if (!markTip && !p.done) markTip = segs[0][0];
      }
      else if (p.kind === "table") props.push(cast(px, py + 4, pw * 0.48, 10), rect(px - pw * 0.42, py - ph * 0.85, px - pw * 0.36, py, tint("#5a3a24"), { line: "ink", w: 4 }), rect(px + pw * 0.36, py - ph * 0.85, px + pw * 0.42, py, tint("#5a3a24"), { line: "ink", w: 4 }), rect(px - pw * 0.44, py - ph * 0.86, px + pw * 0.44, py - ph * 0.72, tint("#6a4630"), { line: "ink", w: 4 }), rect(px - pw / 2, py - ph, px + pw / 2, py - ph * 0.84, tint("#96643c"), { line: "ink", w: 5, shade: 0.15 }));
      else if (p.kind === "jar") {
        const bw = ph * 0.36, bh = ph * 0.46, cy = py - bh;
        props.push(
          cast(px, py + 2, bw * 0.9, 5),
          blob(px, cy, bw, bh, "#b55228", { w: 4.5, shade: 0.22 }),
          poly([[px - bw * 0.56, py - ph * 0.92], [px + bw * 0.56, py - ph * 0.92], [px + bw * 0.46, py - ph * 0.78], [px - bw * 0.46, py - ph * 0.78]], "#8a3a18", { flat: true, w: 4 }),
          blob(px, py - ph * 0.94, bw * 0.62, Math.max(4, ph * 0.07), "#c9683a", { w: 4 }),
          blob(px, py - ph * 0.94, bw * 0.42, Math.max(2.5, ph * 0.04), "#4a1e0c", { line: null, plain: true }),
          stroke([[px - bw * 0.75, cy - bh * 0.08], [px, cy + bh * 0.06], [px + bw * 0.75, cy - bh * 0.08]], "#e6b87a", 3.5),
          stroke([[px - bw * 0.68, cy + bh * 0.14], [px, cy + bh * 0.26], [px + bw * 0.68, cy + bh * 0.14]], "#6b2810", 3)
        );
      }
      else if (p.kind === "cross") props.push(cast(px, py + 3, ph * 0.2, 6), rect(px - 8, py - ph, px + 8, py, tint("#4a362b"), { line: "ink", w: 4.5, shade: 0.2 }), rect(px - ph * 0.22, py - ph * 0.75, px + ph * 0.22, py - ph * 0.66, tint("#4a362b"), { line: "ink", w: 4.5 }));
      else if (p.kind === "sprout") props.push(cast(px, py + 2, 16, 5), stroke([[px, py], [px - 3, py - ph * 0.38], [px, py - ph * 0.72]], "#3d752c", 7), blob(px - 18, py - ph * 0.64, 22, 12, "#529938", { w: 3.5 }), blob(px + 20, py - ph * 0.72, 24, 13, "#6fc048", { w: 3.5 }));
      else if (p.kind === "heart") props.push(blob(px, (p.y ?? 0.5) * H, 80, 70, "#e0405a", { w: 6, shade: 0.16 }));
      else if (p.kind === "moon") props.push(blob(px, (p.y ?? 0.22) * H, 64, 64, "#f4efcf", { w: 5, shade: 0.12 }));
      else if (p.kind === "sun") props.push(blob(px, (p.y ?? 0.35) * H, 80, 80, "#ffd23c", { w: 6, shade: 0.12 }));
      else if (p.kind === "beam") { lampPos = lampPos || [px, hz - 40]; beamPos = beamPos || [px, hz - 40]; }
    }
    // people
    const drawerIx = markTip ? Math.max(0, (shot.subjects || []).findIndex((s) => s.pose === "point" || s.pose === "reach")) : -1;   // who draws the mark: the first person pointing or reaching
    const people = [], heads = []; window.PaintedScenes.heads = []; window.PaintedScenes.foci = []; window.PaintedScenes.actionBands = [];
    (shot.subjects || []).forEach((s, i) => {
      const n = world.subjects[i], h = n.h * H;
      if (aboard(s)) { const bs = boatNode.w * W / 340 * (place === "shore" ? 0.8 : 1), bx = boatNode.x * W, by = boatNode.y * H - (place === "shore" ? H * 0.09 : 0), bob = Math.sin(t * 2.2 + bx) * rough * 26, a = Math.sin(t * 1.7 + bx) * 0.2 * rough, fx0 = (i % 2 ? 46 : -46) * bs,
          fig = person(s, bx + fx0 * Math.cos(a), by + bob + 6 * bs + fx0 * Math.sin(a), Math.min(h, 190 * bs), t, tint, { pose: rough > 0.6 ? "hold" : s.pose });
        people.push(...fig.items); handsByPerson.set(s.who, fig.hands); window.PaintedScenes.heads.push(fig.head.map((y) => y / H)); return; }
      const climbing = s.pose === "climb" && indoors && shot.room === "lighthouse", q = STAIR(W, H), u = clamp(t / 3.2) * (q.n - 1), stairAt = onStair(W, H, u);
      // Someone walking goes somewhere: across the frame (seen from the side), or down the path towards the camera (front) or away from it (back), growing or shrinking as they go
      const wq = (k.p ?? 0) - 0.5, side = ["left", "right"].includes(s.facing), wk = s.pose === "walk" && !climbing ? (side ? { x: (s.facing === "left" ? -1 : 1) * wq * 0.4 * W, y: 0, s: 1 } : s.facing === "back" ? { x: 0, y: -wq * 0.09 * H, s: 1 - wq * 0.3 } : { x: 0, y: wq * 0.09 * H, s: 1 + wq * 0.3 }) : { x: 0, y: 0, s: 1 };
      const cx = (climbing ? stairAt[0] : n.x * W) + wk.x, cy = (climbing ? stairAt[1] : n.y * H) + wk.y;
      const onSeat = s.pose === "sit" && s.on && !climbing, drawing = markTip && i === drawerIx, fig = person(s, cx, onSeat ? cy + 0.33 * h : cy, climbing ? H * 0.27 : h * wk.s, climbing ? t * 1.6 : t, tint, { pose: climbing ? "climb" : undefined, seat: onSeat ? 0.33 : undefined, reachTo: drawing ? markTip : undefined }); people.push(...fig.items); window.PaintedScenes.heads.push(fig.head.map((y) => y / H)); handsByPerson.set(s.who, fig.hands);
    });
    for (const hp of heldProps) {                                                              // held things sit in the hand of the one who holds them (the ground if that hand is not drawn)
      const holder = (shot.subjects || []).findIndex((s) => s.who === hp.p.heldBy.who), hand = holder >= 0 ? handsByPerson.get(hp.p.heldBy.who)?.[hp.p.heldBy.hand === "left" ? 0 : 1] : null;
      const hh = holder >= 0 ? world.subjects[holder].h * H : H * 0.3, sz = Math.max(H * 0.04, hh * 0.15), kind = commonKind(hp.p), fk = fruitKind(hp.p);
      if (fk) people.push(...fruitItem(hand ? hand[0] : hp.px, (hand ? hand[1] : hp.py) - sz * 0.3, sz * 0.45, fk));
      else if (kind) people.push(...commonPropItems(kind, hand ? hand[0] : hp.px, (hand ? hand[1] + sz * 0.45 : hp.py), sz * 1.5, sz, tint, t, hp.p));
      else if (hp.p.recipe) people.push(...recipeItems(hp.p.recipe, hand ? hand[0] : hp.px, hand ? hand[1] + sz * 0.5 : hp.py, sz * 1.3, sz * 1.3, tint, snowy, hp.p.describe || ""));
    }
    for (const f of fruitProps) {                                                              // fruit: in the hand of the one who holds it (else reaches), else on the ground
      const holder = (shot.subjects || []).find((s) => (s.gesture || s.pose) === "hold" && handsByPerson.get(s.who)) ?? (shot.subjects || []).find((s) => (s.gesture || s.pose) === "reach" && handsByPerson.get(s.who)), hand = holder && handsByPerson.get(holder.who)[1];
      const hh = holder ? world.subjects[(shot.subjects || []).indexOf(holder)].h * H : 0, r = Math.max(9, holder ? hh * 0.055 : H * 0.012);
      if (hand) people.push(...fruitItem(hand[0], hand[1] - r * 0.4, r, f.kind));
      else people.push(cast(f.px, f.py + 3, r * 2, Math.max(4, r * 0.4)), ...fruitItem(f.px, f.py - r, r, f.kind));
    }
    // Explicit ownership: never guess a rope from the first person in a hold pose.
    for (const [prop, end] of anchors) if (prop.tether) {
      const hands = handsByPerson.get(prop.tether.who), hand = hands?.[prop.tether.hand === "left" ? 0 : 1];
      if (!hand) throw new Error(`Missing tether hand for ${prop.tether.who}`);
      window.PaintedScenes.actionBands.push([Math.min(hand[1], end[1]) / H - .02, Math.max(hand[1], end[1]) / H + .03]);
      people.push(stroke([hand, [(hand[0] + end[0]) / 2, (hand[1] + end[1]) / 2 + H * .025], end], "#f6edd9", Math.max(2, W * .003), { line: "#493c31" }));
    }
    if (!indoors && ["dawn", "morning", "day"].includes(shot.time) && ["sea", "shore", "lake"].includes(place) && !Wt.rain) for (let i = 0; i < 3; i++) { const x = ((i * 330 + 140 + t * 60) % (W + 200)) - 100, y = H * (0.2 + 0.07 * i) + Math.sin(t * 2 + i) * 14, f = Math.sin(t * 7 + i) * 10; fx.push(stroke([[x - 36, y - 10 - f], [x, y], [x + 36, y - 10 - f]], "#ffffff", 6, { line: M.line || INK })); }
    if (lampPos && T.amt > 0.3 && (sceneDone || t > 1.2)) glow = lampPos;
    // weather over everything (never drawn in: it moves on its own)
    const rainN = Wt.rain ? Math.min(90, Math.round(Wt.rain / 4)) : 0;
    fx.push(...rain(rainN, t, W, H, Wt.slant ? 0.42 : 0.3, "rgba(235,240,255,0.7)", 4, 1.1, 11));
    for (let i = 0; i < Math.min(60, (Wt.snow || 0) / 6); i++) { const x = ((i * 173 + t * 40 * (Wt.wind || 0.5)) % W), y = ((i * 307 + t * 160) % (H + 40)); fx.push(blob(x, y, 7, 7, "#ffffff", { line: null, flat: true })); }
    if (Wt.fog) fx.push(rect(-40, hz * 0.7, W + 40, FH + 40, `rgba(223,230,234,${0.45 * Wt.fog})`, { line: null }));
    // draw: scenery is always complete from the first frame so the sky/ground are never half-blank; props and people draw in when requested
    drawItems(g, M, scene, t, 0, 0.03, 0.4, true, zoom);
    const beamK = sceneDone ? 1 : clamp((t - 1.0) / 0.4);
    if (beamPos && T.amt > 0.3 && beamK > 0) { const a = Math.PI * (0.5 + Math.sin(t * 1.1) * 0.45), len = 1700, sp = 0.12; for (const d of [0]) g.save(), (g.fillStyle = `rgba(255,224,110,${0.42 * beamK})`, g.beginPath(), g.moveTo(beamPos[0], beamPos[1]), g.lineTo(beamPos[0] + Math.cos(a + d - sp) * len, beamPos[1] + Math.sin(a + d - sp) * len), g.lineTo(beamPos[0] + Math.cos(a + d + sp) * len, beamPos[1] + Math.sin(a + d + sp) * len), g.closePath(), g.fill()), g.restore(); }
    if (glow) { const gr = g.createRadialGradient(glow[0], glow[1], 4, glow[0], glow[1], 260); gr.addColorStop(0, "rgba(255,236,150,0.55)"); gr.addColorStop(1, "rgba(255,236,150,0)"); g.fillStyle = gr; g.fillRect(glow[0] - 260, glow[1] - 260, 520, 520); }
    drawItems(g, M, marks, t, 0, 0, 1, true, zoom);
    drawItems(g, M, props, t, 0, 0.012, 0.18, propsDone, zoom);
    drawItems(g, M, people, t, 0.04, 0.008, 0.16, sceneDone, zoom);
    drawItems(g, M, boatFront, t, 0.04, 0.008, 0.16, sceneDone, zoom);
    drawItems(g, M, fx, t, 0, 0, 1, true, zoom);
    if (!M.pixel) {
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      const vg = g.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.38, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(24,18,12,0.14)");
      g.fillStyle = vg; g.fillRect(0, 0, W, FH); g.restore();
    }
    if (Wt.bolts) for (const f of shot.flashes || []) { const d = t - f; if (d >= 0 && d < 0.14) { g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(0, 0, W, FH); g.strokeStyle = M.line || INK; g.lineWidth = 18; g.lineCap = "round"; g.lineJoin = "round"; const bx = W * (0.3 + ((f * 37) % 5) / 8); g.beginPath(); g.moveTo(bx, 0); [[bx - 60, H * 0.14], [bx + 20, H * 0.17], [bx - 90, H * 0.34], [bx - 10, H * 0.37], [bx - 120, H * 0.55]].forEach(([x, y]) => g.lineTo(x, y)); g.stroke(); g.strokeStyle = "#fff6b0"; g.lineWidth = 8; g.stroke(); } }
    if (M.pixel) {                                                              // pixel art: the finished picture snapped to a coarse grid
      const s = M.pixel, w = Math.ceil(W / s), h = Math.ceil(FH / s), c = (window.DoodleScenes._px ??= document.createElement("canvas")); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const cg = c.getContext("2d"); cg.imageSmoothingEnabled = true; cg.setTransform(1, 0, 0, 1, 0, 0); cg.clearRect(0, 0, w, h); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); cg.drawImage(g.canvas, 0, 0, W, FH, 0, 0, w, h); g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, w, h, 0, 0, W, FH); g.restore();
    }
    window.PaintedScenes.jarState = null;
  }
  window.DoodleScenes = { draw, MEDIA, medium: "marker", paper: (m) => (MEDIA[m] || MEDIA.marker).paper };
})();
