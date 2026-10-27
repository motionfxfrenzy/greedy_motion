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
    var leaves = Array.prototype.filter.call(svg.querySelectorAll(LEAVES), function (el) { return !el.closest("defs,clipPath,marker,pattern,mask"); });
    // The full-frame background rectangles are the ground, not content: they never animate.
    // Pointers and markers sit on top: a triangle drawn before the range bracket would hide behind it.
    Array.prototype.forEach.call(svg.querySelectorAll(":scope > polygon"), function (el) { svg.appendChild(el); });
    var vb = (svg.getAttribute("viewBox") || "0 0 1280 720").split(/[\s,]+/).map(Number);
    var isGround = function (el) { return el.tagName === "rect" && Number(el.getAttribute("width")) >= vb[2] * 0.95 && Number(el.getAttribute("height")) >= vb[3] * 0.95; };
    var content = leaves.filter(function (el) { return !isGround(el); });
    // One ground for the whole film (the first frame's): later frames' opaque backgrounds would cover the outgoing scene
    // the instant a cut starts, so its elements could never be seen fading. Without them, cuts truly crossfade.
    if (i > 0) leaves.filter(isGround).forEach(function (el) { gsap.set(el, { opacity: 0 }); });
    // Elements the scene's motion moves arrive by that motion, not by the cut's glide or draw-on.
    var moving = new Set((beat.motion || []).filter(entrance).map(function (m) { return m.id; }));
    var own = content.filter(function (el) { return !moving.has(el.id); });
    return { layer: layer, svg: svg, leaves: own, all: content, motion: beat.motion || [], start: beat.start, end: beat.end, index: i };
  });

  function center(el) {
    try { var b = el.getBBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } catch (e) { return { x: 0, y: 0 }; }
  }
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

  // Draw-on for an element arriving at time t (stagger handled by the caller).
  function enter(el, t) {
    var tag = el.tagName;
    var stroked = (tag === "line" || tag === "polyline" || tag === "path") && (el.getAttribute("fill") === "none" || tag === "line");
    if (stroked && el.getTotalLength) {
      var len = el.getTotalLength() || 1;
      tl.fromTo(el, { attr: { "stroke-dasharray": len, "stroke-dashoffset": len } }, { attr: { "stroke-dashoffset": 0 }, duration: F.draw, ease: EXPLAINER ? smooth : "power2.inOut", immediateRender: true }, t);
    } else if (tag === "text") {
      tl.fromTo(el, { opacity: 0, y: EXPLAINER ? 10 : 14 }, { opacity: 1, y: 0, duration: F.text, ease: F.textEase, immediateRender: true }, t);
    } else {
      tl.fromTo(el, { opacity: 0, scale: EXPLAINER ? 0.96 : 0.92, svgOrigin: center(el).x + " " + center(el).y }, { opacity: 1, scale: 1, duration: F.shape, ease: F.shapeEase, immediateRender: true }, t);
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
  // The scene's directed motion (frame-motion.ts): the frame is the end state; each entry runs on its words.
  function play(frame) {
    var t0 = frame.start;
    frame.motion.forEach(function (m) {
      var at = t0 + m.start, span = Math.max(F.minSpan, m.end - m.start);
      if (m.kind === "move") {
        var el = byId(frame, m.id);
        if (!el) return;
        var from = Object.assign({}, m.from), shift = null;
        // Explainer: something new (not carried over) is not on screen until its move begins, and fades in as it moves;
        // new words never start before the old ones have cleared.
        if (EXPLAINER && frame.index > 0 && entrance(m)) {
          if (el.tagName === "text" || el.querySelector && el.querySelector("text")) at = Math.max(at, t0 + 0.45);
          if (from.opacity === undefined) {
            tl.set(el, { opacity: 0 }, t0);
            tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: Math.min(0.6, span), ease: smooth, immediateRender: false }, at);
          }
        }
        if (from.transform) {
          var tr = /translate\(\s*(-?[\d.]+)[\s,]*(-?[\d.]+)?\s*\)/.exec(from.transform);
          if (tr) shift = { x: Number(tr[1]), y: Number(tr[2] || 0) };
          delete from.transform;
        }
        var to = drawn(el, Object.keys(from));
        Object.keys(to).forEach(function (name) { if (to[name] === null) { delete to[name]; delete from[name]; } });
        // Explainer: a hop is a smooth glide then a short dwell on the box it checks, never a teleport.
        var hops = EXPLAINER && m.steps && shift ? m.steps : 0;
        var ease = EXPLAINER ? smooth : m.steps ? "steps(" + m.steps + ")" : "power2.inOut";
        if (Object.keys(from).length) {
          tl.set(el, { attr: from }, t0);
          tl.fromTo(el, { attr: from }, { attr: to, duration: span, ease: ease, immediateRender: false }, at);
        }
        if (shift && hops) {
          tl.set(el, { x: shift.x, y: shift.y }, t0);
          var each = span / hops;
          for (var h = 1; h <= hops; h++) tl.fromTo(el, { x: shift.x * (1 - (h - 1) / hops), y: shift.y * (1 - (h - 1) / hops) }, { x: shift.x * (1 - h / hops), y: shift.y * (1 - h / hops), duration: each * (1 - F.hold), ease: smooth, immediateRender: false }, at + (h - 1) * each);
        } else if (shift) {
          tl.set(el, { x: shift.x, y: shift.y }, t0);
          tl.fromTo(el, { x: shift.x, y: shift.y }, { x: 0, y: 0, duration: span, ease: ease, immediateRender: false }, at);
        }
      } else if (m.kind === "sweep") {
        var list = m.ids.map(function (id) { return byId(frame, id); }).filter(Boolean);
        var gap = span / Math.max(1, list.length);
        list.forEach(function (el, k) {
          var back = drawn(el, Object.keys(m.flash));
          var when = at + k * gap;
          // Explainer: like Manim's Indicate, the element swells a little as it takes the colour, then settles.
          var swell = EXPLAINER ? Math.max(0.3, Math.min(F.flash, gap)) : Math.min(F.flash, gap * 0.5);
          var rest = {};
          Object.keys(back).forEach(function (name) { if (back[name] !== null) rest[name] = back[name]; });
          tl.fromTo(el, { attr: rest }, { attr: m.flash, duration: swell, ease: EXPLAINER ? smooth : "power1.out", immediateRender: false }, when);
          if (EXPLAINER) tl.fromTo(el, { scale: 1, svgOrigin: center(el).x + " " + center(el).y }, { scale: 1.08, svgOrigin: center(el).x + " " + center(el).y, duration: swell / 2, ease: smooth, yoyo: true, repeat: 1, immediateRender: false }, when);
          if (!m.stay) {
            Object.keys(back).forEach(function (name) { if (back[name] === null) delete back[name]; });
            if (Object.keys(back).length) tl.fromTo(el, { attr: m.flash }, { immediateRender: false, attr: back, duration: EXPLAINER ? swell : Math.min(0.25, gap * 0.6), ease: EXPLAINER ? smooth : "power1.inOut" }, when + Math.max(EXPLAINER ? swell : gap * 0.6, 0.12));
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
      used.add(a);
      if (b.tagName === "g") {
        groups.push([a, b]);
        var la = leavesOf(a), lb = leavesOf(b);
        lb.forEach(function (leaf) {
          var match = la.find(function (x) { return !used.has(x) && x.tagName === leaf.tagName; });
          if (match) { used.add(match); pairs.push([match, leaf]); }
        });
      } else {
        pairs.push([a, b]);
      }
    });
    return any ? { pairs: pairs, groups: groups } : null;
  }

  // The older matching (by kind, size and position), for frames drawn before shared ids existed.
  function heuristicCut(prev, frame, t, room) {
    var pairs = match(prev.all, frame.all);
    var carriedEls = pairs.map(function (p) { return p[1]; });
    frame.motion = frame.motion.filter(function (m) {
      if (m.kind !== "move") return true;
      var target = byId(frame, m.id);
      return !target || !carriedEls.some(function (el) { return el === target || target.contains(el); });
    });
    play(frame);
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
    if (i > 0 && i + 1 < frames.length) tl.set(frame.layer, { display: "none" }, frames[i + 1].start + Math.max(MOVE, F.fadeOut) + 0.1);
    var room = Math.min(F.room, Math.max(0.3, (frame.end - frame.start) * 0.35));

    if (i === 0) {
      play(frame);
      var gap = stagger(frame.leaves.length, room);
      frame.leaves.forEach(function (el, k) { enter(el, t + 0.15 + k * gap); });
      return;
    }

    var prev = frames[i - 1];
    var byIdPairs = pairById(prev, frame);
    if (!byIdPairs) return heuristicCut(prev, frame, t, room);
    var pairs = byIdPairs.pairs, groups = byIdPairs.groups;
    // What carries over is already on screen: its own "appear" move (or its group's) would hide it.
    var carriedEls = pairs.map(function (p) { return p[1]; }).concat(groups.map(function (g) { return g[1]; }));
    frame.motion = frame.motion.filter(function (m) {
      if (m.kind !== "move") return true;
      var target = byId(frame, m.id);
      return !target || !carriedEls.some(function (el) { return el === target || target.contains(el); });
    });
    play(frame);
    var paired = new Set(pairs.map(function (p) { return p[1]; }));
    var left = new Set(pairs.map(function (p) { return p[0]; }));
    var continuity = pairs.some(function (p) { return !isSlot(p[1]); });
    // Shared objects transform into their new state (Manim's Transform); their old copies hand over at the cut.
    groups.forEach(function (g) {
      var a = g[0], b = g[1], ta = a.getAttribute("transform") || "translate(0 0)", tb = b.getAttribute("transform") || "translate(0 0)";
      if (ta !== tb && numbers(ta) === numbers(tb)) tl.fromTo(b, { attr: { transform: ta } }, { attr: { transform: tb }, duration: MOVE, ease: F.ease, immediateRender: false }, t);
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
    var out = EXPLAINER ? 0.5 : 0.3;
    prev.all.forEach(function (a) { if (!left.has(a)) tl.fromTo(a, { opacity: 1 }, { opacity: 0, duration: out, ease: EXPLAINER ? smooth : "power1.out", immediateRender: false }, t); });
    var fresh = frame.leaves.filter(function (b) { return !paired.has(b); });
    var arrive = t + out + (continuity ? 0.05 : 0.15);
    var gap2 = stagger(fresh.length, room);
    fresh.forEach(function (el, k) { enter(el, arrive + k * gap2); });
  });
  // Geometry (getBBox) was measured above while every layer was laid out; now only the timeline shows them.
  frames.forEach(function (frame) { gsap.set(frame.layer, { display: "none" }); });
})();
