/*
 * Frame film: animates the script canvas's approved reference frames (one SVG per beat) on the film clock, so the render
 * shows what the person approved. Deterministic and seek-safe: everything is a tween on the engine's paused timeline.
 *
 *  - Beat 1 draws on: its elements arrive in drawing order (text rises in, strokes draw, shapes grow).
 *  - At each cut, elements that exist in both frames glide from where they were to where they are now (the pointer moves,
 *    boxes dim, the range shrinks); what is new draws on, and what is gone fades out. One continuous picture, not slides.
 *
 * Input: the JSON block #ff-data, { "feel", "beats": [{ "start", "end", "svg", "motion" }] }, svgs already cleaned on the
 * server (no scripts, links or images).
 *
 * Feel: "explainer" (films about a topic) moves the way 3Blue1Brown's Manim does: about a second per change on Manim's
 * `smooth` rate curve, cuts that crossfade rather than blink, groups that arrive with a slight lag, highlights that swell
 * and settle, a pointer that glides box to box. Nothing rushes and nothing snaps. "default" is the snappier product feel.
 */
(function () {
  var data = JSON.parse(document.getElementById("ff-data").textContent);
  var tl = window.__timelines && window.__timelines.main;
  var host = document.getElementById("frame-film");
  if (!tl || !host || !data.beats || !data.beats.length) return;

  var LEAVES = "rect,circle,ellipse,line,polyline,polygon,path,text";

  // Manim's `smooth` rate function (a sigmoid with inflection 10, normalised to 0..1): slow out, slow in, never abrupt.
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function smooth(t) { var lo = sigmoid(-5), hi = sigmoid(5); return Math.min(1, Math.max(0, (sigmoid(10 * (t - 0.5)) - lo) / (hi - lo))); }
  var EXPLAINER = data.feel === "explainer";
  var F = EXPLAINER
    ? { move: 1.0, ease: smooth, fadeOut: 0.8, enterAt: 0.25, text: 0.9, shape: 0.8, draw: 1.0, shapeEase: smooth, textEase: smooth, lag: 0.12, room: 1.8, minSpan: 0.6, flash: 0.4, hold: 0.3 }
    : { move: 0.7, ease: "power3.inOut", fadeOut: 0.3, enterAt: 0.42, text: 0.45, shape: 0.4, draw: 0.6, shapeEase: "back.out(1.6)", textEase: "power3.out", lag: 0.06, room: 1.2, minSpan: 0.2, flash: 0.18, hold: 0 };
  var MOVE = F.move; // seconds a matched element takes to reach its new place at a cut
  var NUM = { rect: ["x", "y", "width", "height", "rx", "ry"], circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"], line: ["x1", "y1", "x2", "y2"], text: ["x", "y", "font-size"] };
  var PAINT = ["fill", "stroke", "opacity", "fill-opacity", "stroke-opacity", "stroke-width"];

  // A move that brings something in (it starts somewhere else, another shape, or invisible), as opposed to a recolour of
  // something already drawn (a box turning gold), which must not hide it until the move begins.
  function entrance(m) {
    return m.kind === "move" && Object.keys(m.from || {}).some(function (name) { return !/^(fill|stroke|stroke-width|fill-opacity|stroke-opacity)$/.test(name); });
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function round3(n) { return Math.round(n * 1000) / 1000; }

  function parseTransform(str) {
    if (!str) return { hasTranslate: false, x: 0, y: 0, hasScale: false, sx: 1, sy: 1, hasRotate: false, rot: 0 };
    var tr = /translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/.exec(str);
    var sc = /scale\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/.exec(str);
    var ro = /rotate\(\s*(-?[\d.]+)/.exec(str);
    var sx = sc ? Number(sc[1]) : 1;
    var sy = sc ? Number(sc[2] !== undefined ? sc[2] : sc[1]) : 1;
    return {
      hasTranslate: Boolean(tr),
      x: tr ? Number(tr[1]) : 0,
      y: tr && tr[2] !== undefined ? Number(tr[2]) : 0,
      hasScale: Boolean(sc),
      sx: Number.isFinite(sx) ? sx : 1,
      sy: Number.isFinite(sy) ? sy : 1,
      hasRotate: Boolean(ro),
      rot: ro && Number.isFinite(Number(ro[1])) ? Number(ro[1]) : 0
    };
  }

  function center(el) {
    try { var b = el.getBBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } catch (e) { return { x: 0, y: 0 }; }
  }

  function baseInfo(el) {
    if (el.__ffBase) return el.__ffBase;
    var raw = el.getAttribute("transform");
    var parsed = parseTransform(raw);
    var lc = center(el);
    var px = 0, py = 0;
    var cur = el.parentElement;
    var svg = el.ownerSVGElement;
    while (cur && cur !== svg) {
      var pt = parseTransform(cur.getAttribute && cur.getAttribute("transform"));
      if (pt.hasTranslate) { px += pt.x; py += pt.y; }
      cur = cur.parentElement;
    }
    var wc = {
      x: px + parsed.x + lc.x * parsed.sx,
      y: py + parsed.y + lc.y * parsed.sy
    };
    el.__ffBase = {
      raw: raw,
      parsed: parsed,
      localCenter: lc,
      parentTranslate: { x: px, y: py },
      worldCenter: wc
    };
    return el.__ffBase;
  }

  function composeTransform(el, st) {
    var info = baseInfo(el);
    var base = info.parsed;
    var lc = info.localCenter;
    var x = st.x !== undefined ? st.x : base.x;
    var y = st.y !== undefined ? st.y : base.y;
    var rot = st.rot !== undefined ? st.rot : base.rot;
    var sx = st.sx !== undefined ? st.sx : base.sx;
    var sy = st.sy !== undefined ? st.sy : base.sy;
    if (
      Math.abs(x - base.x) < 1e-3 &&
      Math.abs(y - base.y) < 1e-3 &&
      Math.abs(rot - base.rot) < 1e-3 &&
      Math.abs(sx - base.sx) < 1e-3 &&
      Math.abs(sy - base.sy) < 1e-3
    ) {
      return info.raw;
    }
    var parts = [];
    if (Math.abs(x) > 1e-3 || Math.abs(y) > 1e-3 || base.hasTranslate) {
      parts.push("translate(" + round2(x) + " " + round2(y) + ")");
    }
    var hasRot = Math.abs(rot) > 1e-3 || base.hasRotate;
    var hasSc = Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3 || base.hasScale;
    if (hasRot || hasSc) {
      var pivotLocal = !base.hasTranslate && (Math.abs(lc.x) > 1e-2 || Math.abs(lc.y) > 1e-2);
      if (pivotLocal) parts.push("translate(" + round2(lc.x) + " " + round2(lc.y) + ")");
      if (hasRot) parts.push("rotate(" + round2(rot) + ")");
      if (hasSc) parts.push("scale(" + round3(sx) + (Math.abs(sx - sy) > 1e-3 ? " " + round3(sy) : "") + ")");
      if (pivotLocal) parts.push("translate(" + round2(-lc.x) + " " + round2(-lc.y) + ")");
    }
    return parts.length ? parts.join(" ") : info.raw;
  }

  function applyTransformState(el, st) {
    var attr = composeTransform(el, st);
    if (attr === null || attr === undefined || attr === "") el.removeAttribute("transform");
    else el.setAttribute("transform", attr);
  }

  function tweenTransform(el, fromSt, toSt, duration, ease, startTime, setAtTime, hops) {
    var info = baseInfo(el);
    var base = info.parsed;
    var s0 = {
      x: fromSt.x !== undefined ? fromSt.x : base.x,
      y: fromSt.y !== undefined ? fromSt.y : base.y,
      rot: fromSt.rot !== undefined ? fromSt.rot : base.rot,
      sx: fromSt.sx !== undefined ? fromSt.sx : base.sx,
      sy: fromSt.sy !== undefined ? fromSt.sy : base.sy
    };
    var s1 = {
      x: toSt && toSt.x !== undefined ? toSt.x : base.x,
      y: toSt && toSt.y !== undefined ? toSt.y : base.y,
      rot: toSt && toSt.rot !== undefined ? toSt.rot : base.rot,
      sx: toSt && toSt.sx !== undefined ? toSt.sx : base.sx,
      sy: toSt && toSt.sy !== undefined ? toSt.sy : base.sy
    };
    var lerpState = function (p) {
      applyTransformState(el, {
        x: s0.x + (s1.x - s0.x) * p,
        y: s0.y + (s1.y - s0.y) * p,
        rot: s0.rot + (s1.rot - s0.rot) * p,
        sx: s0.sx + (s1.sx - s0.sx) * p,
        sy: s0.sy + (s1.sy - s0.sy) * p
      });
    };
    var proxy = { p: 0 };
    if (typeof setAtTime === "number") {
      tl.set(proxy, { p: 0, onUpdate: function () { lerpState(0); } }, setAtTime);
    }
    if (hops && hops > 1) {
      var each = duration / hops;
      for (var h = 1; h <= hops; h++) {
        (function (pStart, pEnd, hopAt) {
          var hp = { p: pStart };
          tl.fromTo(
            hp,
            { p: pStart },
            {
              p: pEnd,
              duration: each * (1 - F.hold),
              ease: ease,
              immediateRender: false,
              onUpdate: function () { lerpState(hp.p); }
            },
            hopAt
          );
        })((h - 1) / hops, h / hops, startTime + (h - 1) * each);
      }
    } else {
      tl.fromTo(
        proxy,
        { p: 0 },
        {
          p: 1,
          duration: duration,
          ease: ease,
          immediateRender: false,
          onUpdate: function () { lerpState(proxy.p); }
        },
        startTime
      );
    }
  }

  function isInsideMoving(el, svg, movingSet) {
    var cur = el;
    while (cur && cur !== svg) {
      if (cur.id && movingSet.has(cur.id)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  // Each frame in its own layer, stacked; only the current one (and the outgoing one during a cut) is visible.
  var frames = data.beats.map(function (beat, i) {
    var layer = document.createElement("div");
    layer.className = "ff-layer";
    // Parsed as XML, not HTML: nothing in a frame can run (the server already stripped scripts, handlers and links).
    var parsed = new DOMParser().parseFromString(beat.svg, "image/svg+xml").documentElement;
    var svg = document.importNode(parsed, true);
    layer.appendChild(svg);
    host.appendChild(layer);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    var vb = (svg.getAttribute("viewBox") || "0 0 1280 720").split(/[\s,]+/).map(Number);
    // Prevent an in-SVG #subtitle or #subtitle-pill from sitting in the middle character zone (Y > 22% of frame height)
    // or colliding with the live narration subtitle pill at Y=80%. Uses pure SVG viewBox coordinates so it works even before layout.
    (function () {
      var topSlotY = vb[3] > vb[2] ? 158 : 94;
      var maxHeaderY = vb[3] * 0.22;
      var subPill = svg.querySelector("#subtitle-pill");
      var subText = svg.querySelector("#subtitle");
      if (subPill) {
        var pt = parseTransform(subPill.getAttribute("transform"));
        if (pt.hasTranslate && pt.y > maxHeaderY) {
          subPill.setAttribute("transform", "translate(" + Math.round(vb[2] / 2) + " " + topSlotY + ")");
        }
      } else if (subText && subText.tagName === "text") {
        var sy = Number(subText.getAttribute("y") || 0);
        var st = parseTransform(subText.getAttribute("transform"));
        var effectiveY = sy + (st.hasTranslate ? st.y : 0);
        if (effectiveY > maxHeaderY) {
          subText.removeAttribute("transform");
          subText.setAttribute("x", String(Math.round(vb[2] / 2)));
          subText.setAttribute("y", String(topSlotY));
        }
      }
    })();
    var leaves = Array.prototype.filter.call(svg.querySelectorAll(LEAVES), function (el) { return !el.closest("defs,clipPath,marker,pattern,mask"); });
    // Pre-cache resting transform and bounding box geometry while all layers are laid out.
    Array.prototype.forEach.call(svg.querySelectorAll("*"), function (el) {
      if (!el.closest("defs,clipPath,marker,pattern,mask")) baseInfo(el);
    });
    // The full-frame background rectangles are the ground, not content: they never animate.
    // Pointers and markers sit on top: a triangle drawn before the range bracket would hide behind it.
    Array.prototype.forEach.call(svg.querySelectorAll(":scope > polygon"), function (el) { svg.appendChild(el); });
    var isGround = function (el) { return el.tagName === "rect" && Number(el.getAttribute("width")) >= vb[2] * 0.95 && Number(el.getAttribute("height")) >= vb[3] * 0.95; };
    var content = leaves.filter(function (el) { return !isGround(el); });
    // One ground for the whole film (the first frame's): later frames' opaque backgrounds would cover the outgoing scene
    // the instant a cut starts, so its elements could never be seen fading. Without them, cuts truly crossfade.
    if (i > 0) leaves.filter(isGround).forEach(function (el) { gsap.set(el, { opacity: 0 }); });
    // Elements the scene's motion moves arrive by that motion, not by the cut's glide or draw-on.
    var moving = new Set((beat.motion || []).filter(entrance).map(function (m) { return m.id; }));
    var own = content.filter(function (el) { return !isInsideMoving(el, svg, moving); });
    return { layer: layer, svg: svg, leaves: own, all: content, motion: beat.motion || [], start: beat.start, end: beat.end, index: i };
  });
  function attrsOf(el) {
    var out = {};
    (NUM[el.tagName] || []).concat(PAINT).forEach(function (name) { var v = el.getAttribute(name); if (v !== null) out[name] = v; });
    if (el.tagName === "polygon" || el.tagName === "polyline") out.points = el.getAttribute("points");
    return out;
  }
  function numbers(s) { return (String(s).match(/-?\d*\.?\d+/g) || []).length; }
  // Two shapes are the same object only if they are roughly the same size: a long bar never turns into one small box.
  function alike(a, b) {
    try {
      var ba = a.getBBox(), bb = b.getBBox();
      var area = function (r) { return Math.max(r.width, 1) * Math.max(r.height, 1); };
      var ratio = area(ba) / area(bb);
      return ratio < 3 && ratio > 1 / 3;
    } catch (e) { return true; }
  }

  // Pairs each element of `next` with one in `prev`: same text first, then (per tag) same position in drawing order when
  // the counts agree, else the nearest one close enough. Unpaired elements enter or leave.
  function match(prev, next) {
    var pairs = [], used = new Set();
    var take = function (a, b) { pairs.push([a, b]); used.add(a); };
    next.forEach(function (b) {
      if (b.tagName !== "text") return;
      var a = prev.find(function (p) { return !used.has(p) && p.tagName === "text" && p.textContent.trim() === b.textContent.trim(); });
      if (a) take(a, b);
    });
    var tags = {};
    next.forEach(function (b) { if (b.tagName !== "text") (tags[b.tagName] = tags[b.tagName] || []).push(b); });
    Object.keys(tags).forEach(function (tag) {
      var from = prev.filter(function (p) { return p.tagName === tag && !used.has(p); });
      var to = tags[tag];
      if (from.length === to.length) { to.forEach(function (b, i) { if (alike(from[i], b)) take(from[i], b); }); return; }
      if (EXPLAINER) {
        // Explainer: a row that moves and changes length is still the same row. Pair left to right (then top to bottom)
        // whatever the distance, so it transforms into its new place, the way Manim's Transform does.
        var order = function (list) { return list.slice().sort(function (p, q) { var a = center(p), b = center(q); return Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x; }); };
        var fa = order(from), tb = order(to);
        tb.forEach(function (b, k) { var a = fa[k]; if (a && !used.has(a) && alike(a, b)) take(a, b); });
        return;
      }
      var reach = Math.max(frames[0].svg.viewBox.baseVal.width, 1) * 0.12;
      to.forEach(function (b) {
        var cb = center(b), best = null, dist = reach;
        from.forEach(function (a) { if (used.has(a) || !alike(a, b)) return; var ca = center(a), d = Math.hypot(ca.x - cb.x, ca.y - cb.y); if (d < dist) { dist = d; best = a; } });
        if (best) take(best, b);
      });
    });
    return pairs;
  }

  // Whether an SVG leaf is an unfilled stroke (line, polyline, path, circle or ellipse) that should trace on.
  function effectiveAttr(el, name) {
    var cur = el;
    var svg = el.ownerSVGElement;
    while (cur && cur !== svg && cur.getAttribute) {
      var v = cur.getAttribute(name);
      if (v !== null && v !== "") return v;
      var st = cur.getAttribute("style");
      if (st) {
        var m = new RegExp("(?:^|;)\\s*" + name + "\\s*:\\s*([^;]+)", "i").exec(st);
        if (m) return m[1].trim();
      }
      cur = cur.parentElement;
    }
    return null;
  }
  function isStroked(el) {
    if (!el || !el.getTotalLength) return false;
    var tag = el.tagName;
    if (tag === "line") return true;
    if (tag !== "path" && tag !== "polyline" && tag !== "circle" && tag !== "ellipse") return false;
    var stroke = effectiveAttr(el, "stroke");
    if (!stroke || stroke === "none" || stroke === "transparent") return false;
    var fill = effectiveAttr(el, "fill");
    var fillOp = effectiveAttr(el, "fill-opacity");
    return !fill || fill === "none" || fill === "transparent" || (fillOp !== null && Number(fillOp) === 0);
  }
  function drawStroke(el, t, d, setAt) {
    var len = 0;
    try { len = Math.ceil(el.getTotalLength()) || 0; } catch (e) { len = 0; }
    if (len < 2) return false;
    if (typeof setAt === "number") tl.set(el, { attr: { "stroke-dasharray": len, "stroke-dashoffset": len } }, setAt);
    tl.fromTo(el, { attr: { "stroke-dasharray": len, "stroke-dashoffset": len } }, { attr: { "stroke-dashoffset": 0 }, duration: d || F.draw, ease: EXPLAINER ? smooth : "power2.inOut", immediateRender: typeof setAt !== "number" }, t);
    return true;
  }

  // Draw-on for an element arriving at time t (stagger handled by the caller).
  function enter(el, t) {
    var tag = el.tagName;
    if (isStroked(el) && drawStroke(el, t, F.draw)) {
      return;
    } else if (tag === "text") {
      var infoT = baseInfo(el), baseT = infoT.parsed;
      tweenTransform(el, { x: baseT.x, y: baseT.y + (EXPLAINER ? 10 : 14), rot: baseT.rot, sx: baseT.sx, sy: baseT.sy }, baseT, F.text, F.textEase, t, t);
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: F.text, ease: F.textEase, immediateRender: true }, t);
    } else {
      var infoS = baseInfo(el), baseS = infoS.parsed, s0 = EXPLAINER ? 0.96 : 0.92;
      tweenTransform(el, { x: baseS.x, y: baseS.y, rot: baseS.rot, sx: baseS.sx * s0, sy: baseS.sy * s0 }, baseS, F.shape, F.shapeEase, t, t);
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: F.shape, ease: F.shapeEase, immediateRender: true }, t);
    }
  }
  function stagger(count, room) { return count <= 1 ? 0 : Math.min(F.lag, room / count); }

  function byId(frame, id) { return frame.svg.querySelector("#" + CSS.escape(id)); }
  function drawn(el, names) {
    var out = {};
    names.forEach(function (name) {
      var v = el.getAttribute(name);
      out[name] = v !== null ? v : name === "opacity" || name === "fill-opacity" || name === "stroke-opacity" ? "1" : null;
    });
    return out;
  }

  function resolveMoveFromState(el, fromStr) {
    var info = baseInfo(el);
    var base = info.parsed;
    var ft = parseTransform(fromStr);
    var x = base.x, y = base.y, rot = base.rot, sx = base.sx, sy = base.sy;
    if (ft.hasTranslate) {
      if (base.hasTranslate) {
        if (Math.hypot(base.x, base.y) >= 180 && Math.hypot(ft.x, ft.y) <= 90) {
          x = base.x + ft.x;
          y = base.y + ft.y;
        } else if (
          Math.hypot(info.parentTranslate.x, info.parentTranslate.y) >= 100 &&
          Math.hypot(ft.x - info.worldCenter.x, ft.y - info.worldCenter.y) < Math.hypot(ft.x - base.x, ft.y - base.y) * 0.7
        ) {
          x = ft.x - info.parentTranslate.x;
          y = ft.y - info.parentTranslate.y;
        } else {
          x = ft.x;
          y = ft.y;
        }
      } else {
        var lc = info.localCenter;
        if (
          (Math.abs(lc.x) > 100 || Math.abs(lc.y) > 100) &&
          Math.hypot(ft.x - lc.x, ft.y - lc.y) < Math.hypot(ft.x, ft.y) * 0.6
        ) {
          x = ft.x - lc.x;
          y = ft.y - lc.y;
        } else {
          x = ft.x;
          y = ft.y;
        }
      }
    }
    if (ft.hasScale) {
      sx = Math.max(0.01, ft.sx);
      sy = Math.max(0.01, ft.sy);
    }
    if (ft.hasRotate) {
      rot = ft.rot;
    }
    return { x: x, y: y, rot: rot, sx: sx, sy: sy, hasTransform: ft.hasTranslate || ft.hasScale || ft.hasRotate };
  }

  // The scene's directed motion (frame-motion.ts): the frame is the end state; each entry runs on its words.
  function play(frame, prevFrame) {
    var t0 = frame.start;
    var movesById = {};
    frame.motion.forEach(function (m) {
      if (m.kind === "move" && m.id) {
        (movesById[m.id] = movesById[m.id] || []).push(m);
      }
    });
    Object.keys(movesById).forEach(function (id) {
      movesById[id].sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
    });

    // Guard against a blank canvas at t0 when every non-title element is in frame.motion and the earliest move starts late (> 0.55s).
    var nonTitleLeaves = frame.leaves.filter(function (el) { return !isSlot(el); });
    var earliestMoveId = null, earliestMoveStart = Infinity;
    frame.motion.forEach(function (m) {
      if (m.kind === "move" && m.id && !isSlot({ id: m.id }) && (m.start || 0) < earliestMoveStart) {
        earliestMoveStart = m.start || 0;
        earliestMoveId = m.id;
      }
    });

    var seenMoveCountById = {};
    frame.motion.forEach(function (m) {
      var at = t0 + m.start, span = Math.max(F.minSpan, m.end - m.start);
      if (m.kind === "move") {
        var el = byId(frame, m.id);
        if (!el) return;
        var seqList = movesById[m.id] || [m];
        var seqIdx = seenMoveCountById[m.id] || 0;
        seenMoveCountById[m.id] = seqIdx + 1;
        var isFirstForEl = seqIdx === 0;
        var from = Object.assign({}, m.from);
        var existedInPrev = Boolean(prevFrame && named(el) && byId(prevFrame, m.id));
        // Explainer: something new (not carried over) is not on screen until its move begins, and fades in as it moves;
        // new words never start before the old ones have cleared. However, an element carried over from the previous scene
        // (or the anchor subject of an otherwise empty scene) stays visible at t0 at its starting state rather than leaving the screen blank.
        if (EXPLAINER && frame.index > 0 && isFirstForEl && entrance(m)) {
          if (el.tagName === "text" || el.querySelector && el.querySelector("text")) at = Math.max(at, t0 + 0.45);
          if (from.opacity === undefined && !existedInPrev) {
            var fadeStart = nonTitleLeaves.length === 0 && m.id === earliestMoveId && earliestMoveStart > 0.5 ? t0 + 0.15 : at;
            tl.set(el, { opacity: 0 }, t0);
            tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: Math.min(0.6, span), ease: smooth, immediateRender: false }, fadeStart);
          } else if (from.opacity === "0" && (existedInPrev || (nonTitleLeaves.length === 0 && m.id === earliestMoveId && earliestMoveStart > 0.55))) {
            if (existedInPrev) {
              delete from.opacity;
            } else {
              delete from.opacity;
              tl.set(el, { opacity: 0 }, t0);
              tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: smooth, immediateRender: false }, t0 + 0.15);
            }
          }
        }
        var rawFromTransform = from.transform;
        delete from.transform;
        var strokedTargets = isFirstForEl && entrance(m) ? leavesOf(el).filter(isStroked) : [];
        if (strokedTargets.length) {
          var sGap = strokedTargets.length > 1 ? Math.min(0.12, (span * 0.4) / strokedTargets.length) : 0;
          var sDur = Math.max(0.25, span - sGap * Math.max(0, strokedTargets.length - 1));
          strokedTargets.forEach(function (stEl, sIdx) {
            drawStroke(stEl, at + sIdx * sGap, sDur, t0);
          });
          if (strokedTargets.length === leavesOf(el).length && !rawFromTransform && from.opacity === "0") {
            delete from.opacity;
          }
        }
        var to = drawn(el, Object.keys(from));
        Object.keys(to).forEach(function (name) { if (to[name] === null) { delete to[name]; delete from[name]; } });
        var ease = EXPLAINER ? smooth : m.steps ? "steps(" + m.steps + ")" : "power2.inOut";
        if (Object.keys(from).length) {
          if (isFirstForEl) tl.set(el, { attr: from }, t0);
          tl.fromTo(el, { attr: from }, { attr: to, duration: span, ease: ease, immediateRender: false }, at);
        }
        if (rawFromTransform) {
          var info = baseInfo(el);
          var base = info.parsed;
          var fromSt = resolveMoveFromState(el, rawFromTransform);
          var toSt = { x: base.x, y: base.y, rot: base.rot, sx: base.sx, sy: base.sy };
          if (seqIdx + 1 < seqList.length && seqList[seqIdx + 1].from && seqList[seqIdx + 1].from.transform) {
            var nextSt = resolveMoveFromState(el, seqList[seqIdx + 1].from.transform);
            toSt = { x: nextSt.x, y: nextSt.y, rot: nextSt.rot, sx: base.sx, sy: base.sy };
          } else if (seqList.length > 1 && seqIdx === seqList.length - 1) {
            var earlierStartedAtBase = seqList.slice(0, seqIdx).some(function (em) {
              if (!em.from || !em.from.transform) return false;
              var es = resolveMoveFromState(el, em.from.transform);
              return Math.hypot(es.x - base.x, es.y - base.y) < 5;
            });
            if (earlierStartedAtBase && Math.hypot(fromSt.x - base.x, fromSt.y - base.y) > 20) {
              toSt = { x: fromSt.x, y: fromSt.y, rot: base.rot, sx: base.sx, sy: base.sy };
            }
          }
          var hops = EXPLAINER && m.steps ? m.steps : 0;
          tweenTransform(el, fromSt, toSt, span, hops ? smooth : ease, at, isFirstForEl ? t0 : undefined, hops);
        }
      } else if (m.kind === "sweep") {
        var list = m.ids.map(function (id) { return byId(frame, id); }).filter(Boolean);
        var gap = span / Math.max(1, list.length);
        list.forEach(function (el, k) {
          var flashAttrs = Object.assign({}, m.flash);
          var flashTr = flashAttrs.transform ? parseTransform(flashAttrs.transform) : null;
          delete flashAttrs.transform;
          var back = drawn(el, Object.keys(flashAttrs));
          var when = at + k * gap;
          // Explainer: like Manim's Indicate, the element swells a little as it takes the colour, then settles.
          var swell = EXPLAINER ? Math.max(0.3, Math.min(F.flash, gap)) : Math.min(F.flash, gap * 0.5);
          var rest = {};
          Object.keys(back).forEach(function (name) { if (back[name] !== null) rest[name] = back[name]; });
          if (Object.keys(flashAttrs).length) {
            tl.fromTo(el, { attr: rest }, { attr: flashAttrs, duration: swell, ease: EXPLAINER ? smooth : "power1.out", immediateRender: false }, when);
          }
          var infoSw = baseInfo(el), baseSw = infoSw.parsed;
          var swellFactor = flashTr && flashTr.hasScale ? flashTr.sx : EXPLAINER ? 1.08 : 1;
          if (swellFactor !== 1) {
            var peakSt = { x: baseSw.x, y: baseSw.y, rot: baseSw.rot, sx: baseSw.sx * swellFactor, sy: baseSw.sy * swellFactor };
            tweenTransform(el, baseSw, peakSt, swell / 2, smooth, when);
            if (!m.stay || !flashTr) {
              tweenTransform(el, peakSt, baseSw, swell / 2, smooth, when + swell / 2);
            }
          }
          if (!m.stay && Object.keys(flashAttrs).length) {
            Object.keys(back).forEach(function (name) { if (back[name] === null) delete back[name]; });
            if (Object.keys(back).length) tl.fromTo(el, { attr: flashAttrs }, { immediateRender: false, attr: back, duration: EXPLAINER ? swell : Math.min(0.25, gap * 0.6), ease: EXPLAINER ? smooth : "power1.inOut" }, when + Math.max(EXPLAINER ? swell : gap * 0.6, 0.12));
          }
        });
      } else if (m.kind === "count") {
        var node = byId(frame, m.id);
        if (!node) return;
        var text = node.textContent, found = /-?[\d,]*\.?\d+/.exec(text);
        if (!found) return;
        var target = Number(found[0].replace(/,/g, "")), commas = found[0].indexOf(",") >= 0, decimals = (found[0].split(".")[1] || "").length;
        var counter = { v: m.from };
        var show = function () {
          var n = decimals ? counter.v.toFixed(decimals) : String(Math.round(counter.v));
          if (commas) n = Number(n).toLocaleString("en-US");
          node.textContent = text.replace(found[0], n);
        };
        tl.set(counter, { v: m.from, onUpdate: show }, t0);
        tl.fromTo(counter, { v: m.from }, { v: target, duration: span, ease: EXPLAINER ? smooth : "power1.inOut", onUpdate: show, immediateRender: false }, at);
      }
    });
  }

  // Ids the frame artist gave on purpose (OBJECTS and text slots), not the m1, m2… added for motion.
  // Full-frame background shapes are the shared ground, never paired or faded; nor is anything inside <defs>.
  function ground(el) {
    var box = el.ownerSVGElement && el.ownerSVGElement.viewBox.baseVal;
    return el.tagName === "rect" && box && Number(el.getAttribute("width")) >= box.width * 0.95 && Number(el.getAttribute("height")) >= box.height * 0.95;
  }
  function named(el) { return el.id && !/^m\d+$/.test(el.id) && !ground(el) && !el.closest("defs,clipPath,marker,pattern,mask"); }
  function isSlot(el) { return /^(title|subtitle|caption(-\d+)?)$/.test(el.id || ""); }
  function leavesOf(el) { return el.matches(LEAVES) ? [el] : Array.prototype.slice.call(el.querySelectorAll(LEAVES)); }
  function directLeavesOfGroup(g) {
    return Array.prototype.filter.call(g.querySelectorAll(LEAVES), function (leaf) {
      var cur = leaf.parentElement;
      while (cur && cur !== g) {
        if (cur.tagName === "g" && named(cur)) return false;
        cur = cur.parentElement;
      }
      return true;
    });
  }
  function hasNestedNamedGroup(g) {
    return Array.prototype.some.call(g.querySelectorAll("g[id]"), function (child) {
      return child !== g && named(child);
    });
  }
  // Pairs elements by the ids the frames share: a shared group pairs its parts in drawing order (rect with rect, text with
  // text); a text slot pairs only if its words are unchanged (otherwise it clears and is rewritten). Null when the frames
  // carry no named ids, which leaves the older matching as a fallback.
  function pairById(prev, next) {
    var before = {}, any = false;
    Array.prototype.forEach.call(prev.svg.querySelectorAll("[id]"), function (el) { if (named(el)) { before[el.id] = el; any = true; } });
    var pairs = [], groups = [], used = new Set();
    Array.prototype.forEach.call(next.svg.querySelectorAll("[id]"), function (b) {
      if (!named(b)) return;
      any = true;
      var a = before[b.id];
      if (!a || used.has(a) || a.tagName !== b.tagName) return;
      if (isSlot(b) && a.textContent.trim() !== b.textContent.trim()) return;
      // Never pair a wide-shot full-body character with a giant close-up head (or vice versa): their areas differ > 3x.
      if (!isSlot(b) && !alike(a, b)) return;
      used.add(a);
      if (b.tagName === "g") {
        var ia = baseInfo(a), ib = baseInfo(b);
        var wrapsNamed = hasNestedNamedGroup(a) || hasNestedNamedGroup(b);
        var sameCoordMode = !wrapsNamed && ia.parsed.hasTranslate === ib.parsed.hasTranslate;
        var la = wrapsNamed ? directLeavesOfGroup(a) : leavesOf(a);
        var lb = wrapsNamed ? directLeavesOfGroup(b) : leavesOf(b);
        if (sameCoordMode) {
          groups.push([a, b, true]);
          lb.forEach(function (leaf) {
            var match = la.find(function (x) { return !used.has(x) && x.tagName === leaf.tagName && alike(x, leaf); });
            if (match) { used.add(match); pairs.push([match, leaf]); }
          });
        } else if (!wrapsNamed) {
          groups.push([a, b, false]);
          la.forEach(function (leaf) { used.add(leaf); });
        } else if (ia.parsed.hasTranslate && ib.parsed.hasTranslate) {
          lb.forEach(function (leaf) {
            var match = la.find(function (x) { return !used.has(x) && x.tagName === leaf.tagName && alike(x, leaf); });
            if (match) { used.add(match); pairs.push([match, leaf]); }
          });
        }
      } else {
        pairs.push([a, b]);
      }
    });
    return any ? { pairs: pairs, groups: groups } : null;
  }

  function isOpacityOnlyMove(m) {
    if (m.kind !== "move" || !m.from) return false;
    var keys = Object.keys(m.from);
    return keys.length === 1 && keys[0] === "opacity";
  }

  // The older matching (by kind, size and position), for frames drawn before shared ids existed.
  function heuristicCut(prev, frame, t, room) {
    var directedMoveIds = new Set(frame.motion.filter(function (m) { return m.kind === "move" && !isOpacityOnlyMove(m); }).map(function (m) { return m.id; }));
    var pairs = match(prev.all, frame.all).filter(function (p) { return !isInsideMoving(p[1], frame.svg, directedMoveIds); });
    var carriedEls = pairs.map(function (p) { return p[1]; });
    frame.motion = frame.motion.filter(function (m) {
      if (m.kind !== "move" || !isOpacityOnlyMove(m)) return true;
      var target = byId(frame, m.id);
      return !target || !carriedEls.some(function (el) { return el === target || target.contains(el); });
    });
    play(frame, prev);
    var paired = new Set(carriedEls), left = new Set(pairs.map(function (p) { return p[0]; }));
    pairs.forEach(function (pair) {
      var a = pair[0], b = pair[1], from = attrsOf(a), to = attrsOf(b), start = {}, end = {};
      Object.keys(to).forEach(function (name) {
        if (from[name] === undefined || from[name] === to[name]) return;
        if (name === "points" && numbers(from.points) !== numbers(to.points)) return;
        start[name] = from[name]; end[name] = to[name];
      });
      tl.set(a, { opacity: 0 }, t);
      if (Object.keys(end).length) tl.fromTo(b, { attr: start }, { attr: end, duration: MOVE, ease: F.ease, immediateRender: false }, t);
    });
    var out = EXPLAINER ? 0.5 : 0.3;
    prev.all.forEach(function (a) { if (!left.has(a)) tl.fromTo(a, { opacity: 1 }, { opacity: 0, duration: out, ease: EXPLAINER ? smooth : "power1.out", immediateRender: false }, t); });
    var fresh = frame.leaves.filter(function (b) { return !paired.has(b); });
    var gap = stagger(fresh.length, room);
    fresh.forEach(function (el, k) { enter(el, t + out + 0.1 + k * gap); });
  }

  frames.forEach(function (frame, i) {
    var t = frame.start;
    // Layers are switched with display, not opacity: every hidden-but-composited full-frame layer costs graphics memory,
    // and with software rendering (the render worker) too many of them made Chrome drop tiles, so parts of a scene vanished.
    tl.set(frame.layer, { display: "block" }, t);
    // The first layer carries the ground, so it stays; its content has faded or handed over by then.
    if (i === 0 && frames.length > 1) {
      var clearFirstAt = frames[1].start + Math.max(MOVE, F.fadeOut) + 0.1;
      frame.all.forEach(function (el) { tl.set(el, { opacity: 0 }, clearFirstAt); });
    }
    if (i > 0 && i + 1 < frames.length) tl.set(frame.layer, { display: "none" }, frames[i + 1].start + Math.max(MOVE, F.fadeOut) + 0.1);
    var room = Math.min(F.room, Math.max(0.3, (frame.end - frame.start) * 0.35));

    if (i === 0) {
      play(frame, null);
      var gap = stagger(frame.leaves.length, room);
      frame.leaves.forEach(function (el, k) { enter(el, t + 0.15 + k * gap); });
      return;
    }

    var prev = frames[i - 1];
    var byIdPairs = pairById(prev, frame);
    if (!byIdPairs) return heuristicCut(prev, frame, t, room);
    var directedMoveIds = new Set(frame.motion.filter(function (m) { return m.kind === "move" && !isOpacityOnlyMove(m); }).map(function (m) { return m.id; }));
    var pairs = byIdPairs.pairs.filter(function (p) { return !isInsideMoving(p[1], frame.svg, directedMoveIds); });
    var groups = byIdPairs.groups.filter(function (g) { return !isInsideMoving(g[1], frame.svg, directedMoveIds); });
    // Compute groupLeavesA and groupLeavesB ONLY from groups that survived directedMoveIds filtering!
    var survivingGroupLeavesA = [], survivingGroupLeavesB = [];
    groups.forEach(function (g) {
      if (!g[2]) {
        leavesOf(g[0]).forEach(function (leaf) { survivingGroupLeavesA.push(leaf); });
        leavesOf(g[1]).forEach(function (leaf) { survivingGroupLeavesB.push(leaf); });
      }
    });
    // Also immediately hide any same-id actor/group in prev that was NOT paired (e.g. because it has a directed move in frame or changed scale between wide/close-up)
    // so the previous scene's actor never lingers underneath the new scene's actor.
    var immediatelyHiddenPrevLeaves = [];
    Array.prototype.forEach.call(frame.svg.querySelectorAll("[id]"), function (b) {
      if (!named(b) || isSlot(b)) return;
      var oldEl = byId(prev, b.id);
      if (!oldEl) return;
      var isPairedGroup = groups.some(function (g) { return g[0] === oldEl; });
      var isPairedLeaf = pairs.some(function (p) { return p[0] === oldEl; });
      if (!isPairedGroup && !isPairedLeaf) {
        tl.set(oldEl, { opacity: 0 }, t);
        leavesOf(oldEl).forEach(function (leaf) {
          tl.set(leaf, { opacity: 0 }, t);
          immediatelyHiddenPrevLeaves.push(leaf);
        });
      }
    });
    // What carries over is already on screen: its own "appear"-only move (or its group's) would hide it, while explicit transform/geometry moves still run.
    var carriedEls = pairs.map(function (p) { return p[1]; }).concat(groups.map(function (g) { return g[1]; })).concat(survivingGroupLeavesB);
    frame.motion = frame.motion.filter(function (m) {
      if (m.kind !== "move" || !isOpacityOnlyMove(m)) return true;
      var target = byId(frame, m.id);
      return !target || !carriedEls.some(function (el) { return el === target || target.contains(el); });
    });
    play(frame, prev);
    var paired = new Set(pairs.map(function (p) { return p[1]; }).concat(survivingGroupLeavesB));
    var left = new Set(pairs.map(function (p) { return p[0]; }).concat(survivingGroupLeavesA).concat(immediatelyHiddenPrevLeaves));
    var continuity = pairs.some(function (p) { return !isSlot(p[1]); }) || groups.length > 0;
    // Shared objects transform into their new state (Manim's Transform); their old copies hand over at the cut.
    groups.forEach(function (g) {
      var a = g[0], b = g[1], sameCoordMode = g[2];
      var ia = baseInfo(a), ib = baseInfo(b);
      tl.set(a, { opacity: 0 }, t);
      if (sameCoordMode) {
        if (ia.parsed.hasTranslate || ib.parsed.hasTranslate) {
          var d = Math.hypot(ia.parsed.x - ib.parsed.x, ia.parsed.y - ib.parsed.y) + Math.abs(ia.parsed.rot - ib.parsed.rot);
          if (d > 0.5) {
            tweenTransform(b, ia.parsed, ib.parsed, MOVE, F.ease, t, t);
          }
        }
      } else {
        var dx = ia.worldCenter.x - ib.worldCenter.x;
        var dy = ia.worldCenter.y - ib.worldCenter.y;
        if (Math.hypot(dx, dy) > 0.5) {
          tweenTransform(
            b,
            { x: ib.parsed.x + dx, y: ib.parsed.y + dy, rot: ib.parsed.rot, sx: ib.parsed.sx, sy: ib.parsed.sy },
            ib.parsed,
            MOVE,
            F.ease,
            t,
            t
          );
        }
      }
    });
    pairs.forEach(function (pair) {
      var a = pair[0], b = pair[1], from = attrsOf(a), to = attrsOf(b), start = {}, end = {};
      Object.keys(to).forEach(function (name) {
        if (from[name] === undefined || from[name] === to[name]) return;
        if (name === "points" && numbers(from.points) !== numbers(to.points)) return;
        start[name] = from[name]; end[name] = to[name];
      });
      tl.set(a, { opacity: 0 }, t);
      if (Object.keys(end).length) tl.fromTo(b, { attr: start }, { attr: end, duration: MOVE, ease: F.ease, immediateRender: false }, t);
      // A number inside a carried box that changes (a counter) swaps quickly in place.
      if (b.tagName === "text" && a.textContent !== b.textContent) tl.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: EXPLAINER ? smooth : "none", immediateRender: false }, t + 0.15);
    });
    // Everything not carried leaves together; the new scene's own things arrive once it has cleared. With nothing shared
    // this is a clean cut (out, then in); with shared objects they stay put through it. Words never overlap.
    var out = EXPLAINER ? 0.38 : 0.25;
    prev.all.forEach(function (a) { if (!left.has(a)) tl.fromTo(a, { opacity: 1 }, { opacity: 0, duration: out, ease: EXPLAINER ? smooth : "power1.out", immediateRender: false }, t); });
    var fresh = frame.leaves.filter(function (b) { return !paired.has(b); });
    var arrive = t + (continuity ? 0.12 : 0.22);
    var gap2 = stagger(fresh.length, Math.min(room, 0.9));
    fresh.forEach(function (el, k) { enter(el, isSlot(el) ? t + 0.12 : arrive + k * gap2); });
  });
  // Geometry (getBBox) was measured above while every layer was laid out; now only the timeline shows them.
  frames.forEach(function (frame) { gsap.set(frame.layer, { display: "none" }); });
})();
