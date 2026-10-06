/* gm-feature-explainer engine.
   Builds the whole film from the composition variables:
     - slot content  (product_name, problem_chips, beats JSON, CTA, brand tokens …)
     - the clock     (`timing` JSON, written by tools/timing.py from the voiceover transcript)
   Deterministic by construction: no text measurement, no clocks, no Math.random, finite tweens,
   every animated property repeated in from AND to, every hidden element set at t=0.
   Card geometry is a fixed grid, so every cursor target is a computed constant, never a measured rect. */
(function () {
  "use strict";
  var FPS = 30;
  var TYPE_CPS = 24; // typing speed; tools/pipeline.py mix uses the same constant for the typing SFX
  var EXIT = 0.32;   // a scene's exit (the J-cut window): starts on the outgoing line's last stressed word, ends on the cut (pipeline.py EXIT)
  var snap = function (t) { return Math.round(t * FPS) / FPS; };
  var HF = window.__hyperframes;
  var V = HF && HF.getVariables ? HF.getVariables() : {};
  var J = function (s, d) { if (s && typeof s === "object") return s; try { return JSON.parse(s); } catch (e) { return d; } };
  var L = function (s) { return String(s || "").split("|").map(function (x) { return x.trim(); }).filter(Boolean); };
  var T = J(V.timing, null);
  var BEATS = J(V.beats, []);
  var root = document.querySelector('[data-composition-id="main"]') || document.getElementById("root");
  if (!root || !document.getElementById("stage")) { window.__fxTimeline = gsap.timeline({ paused: true }); return; }
  root.setAttribute("data-font-ui", V.font_ui || "hanken");
  root.setAttribute("data-font-display", V.font_display || "space");
  var stage = document.getElementById("stage");
  var cursor = document.getElementById("cursor");
  var tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
  var LOG = { actions: [], scenes: [], warnings: [] };
  window.__fx = LOG;

  // ---------- helpers ----------
  function px(n) { return Math.round(n) + "px"; }
  function mk(tag, cls, parent, css, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) for (var k in css) e.style[k] = typeof css[k] === "number" ? px(css[k]) : css[k];
    if (text != null) e.textContent = text;
    (parent || stage).appendChild(e);
    return e;
  }
  // "one element per clause": a beat's screen assembles in a waterfall (cut-the-curve §6) while its first clause is
  // spoken, instead of arriving complete and waiting. Kinds register their content blocks with cas(el).
  var CAS = null;
  function cas(el) { if (CAS) CAS.push(el); return el; }
  function hideAt0(els) { tl.set(els, { autoAlpha: 0 }, 0); }
  function windowed(el, a, b) { tl.set(el, { autoAlpha: 0 }, 0); tl.set(el, { autoAlpha: 1 }, snap(a)); if (b != null) tl.set(el, { autoAlpha: 0 }, snap(b)); }
  function appear(el, t, from, dur, ease) { // entrance: autoAlpha + y/scale, all props in from AND to
    var f = Object.assign({ autoAlpha: 0, y: 0, x: 0, scale: 1 }, from || {});
    tl.fromTo(el, f, { autoAlpha: 1, y: 0, x: 0, scale: 1, duration: dur || 0.32, ease: ease || "power3.out" }, snap(t));
  }
  function btnW(label) { return Math.round(String(label).length * 14.5 + 76); } // char-count estimate: deterministic, never measured
  var TICK = '<svg viewBox="0 0 24 22"><path d="M3 11.5l6 6L21 4" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------- cursor (one global protagonist; tip at (21.6, 13) inside its 104px box) ----------
  var TIPX = 21.6, TIPY = 13;
  var cur = { x: 960 - TIPX, y: 1220, free: 0 };
  tl.set(cursor, { x: cur.x, y: cur.y, scale: 1, transformOrigin: "21% 13%" }, 0);
  function cursorTo(tx, ty, t0, t1, ease) {
    var nx = tx - TIPX, ny = ty - TIPY, d = Math.max(0.2, t1 - t0);
    tl.fromTo(cursor, { x: cur.x, y: cur.y }, { x: nx, y: ny, duration: d, ease: ease || "power2.inOut" }, snap(t0));
    cur.x = nx; cur.y = ny; cur.free = t0 + d;
  }
  function press(t) {
    tl.fromTo(cursor, { scale: 1 }, { scale: 0.84, duration: 0.1, ease: "power2.in" }, snap(t));
    tl.fromTo(cursor, { scale: 0.84 }, { scale: 1, duration: 0.22, ease: "power2.out" }, snap(t + 0.1));
  }
  function pressTarget(el, t) {
    tl.fromTo(el, { scale: 1 }, { scale: 0.94, duration: 0.08, ease: "power2.in" }, snap(t));
    tl.fromTo(el, { scale: 0.94 }, { scale: 1, duration: 0.2, ease: "back.out(1.6)" }, snap(t + 0.08));
  }
  // travel so the tip lands LEAD seconds before the verb; never start before the cursor is free
  var LEAD = 0.16;
  function travelTo(gx, gy, tv, earliest) {
    var arrive = tv - LEAD;
    var start = Math.max(earliest, cur.free + 0.05, arrive - 0.9);
    if (arrive - start < 0.3) { LOG.warnings.push("cursor travel compressed before t=" + tv.toFixed(2)); start = arrive - 0.3; }
    cursorTo(gx, gy, start, arrive, "power2.inOut");
  }
  function driftAside(t, dx, dy) { // after the action: move off the result, never sit on it, never wobble
    if (cur.y + TIPY > 700) dy = -Math.abs(dy); // stay clear of the keyword slab along the bottom
    cursorTo(cur.x + TIPX + dx, cur.y + TIPY + dy, t, t + 0.6, "power2.out");
  }

  // ---------- typing (clip-path reveal + caret riding the edge; percentage-based, no measurement) ----------
  function typeInto(parent, text, t, cls, css) {
    var wrap = mk("div", "type-wrap", parent, css || {});
    var span = mk("span", "type-txt " + (cls || ""), wrap, null, text);
    var caret = mk("div", "caret", wrap, { left: "0%" });
    var dur = Math.max(0.5, text.length / TYPE_CPS);
    tl.set(span, { clipPath: "inset(0% 100% 0% 0%)" }, 0);
    hideAt0(caret);
    tl.set(caret, { autoAlpha: 1 }, snap(t));
    tl.fromTo(span, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: dur, ease: "none" }, snap(t));
    tl.fromTo(caret, { left: "0%" }, { left: "100%", duration: dur, ease: "none" }, snap(t));
    tl.set(caret, { autoAlpha: 0 }, snap(t + dur + 0.25));
    return dur;
  }

  // ---------- chrome shared by every card ----------
  var NAV = L(V.app_nav), STEPS = L(V.app_steps);
  function chrome(card, s) {
    var top = mk("div", "topbar", card);
    var br = mk("div", "brandrow", top);
    if (V.mark_src) { var im = mk("img", null, br); im.src = V.mark_src; im.alt = ""; }
    mk("span", null, br, null, V.product_name || "");
    if (s.chrome === "stepper" && STEPS.length) {
      var st = mk("div", "steps", top);
      STEPS.forEach(function (name, k) {
        if (k) mk("div", "step-sep", st);
        var cls = "step" + (k < (s.step || 0) ? " done" : k === (s.step || 0) ? " on" : "");
        var d = mk("div", cls, st); var b = mk("b", null, d, null, k < (s.step || 0) ? "✓" : String(k + 1)); mk("span", null, d, null, name);
      });
    }
    var pill = null;
    if (s.status) pill = mk("div", "status", top, null, s.status);
    var mx = 70;
    if (s.chrome === "sidebar" && NAV.length) {
      var side = mk("div", "side", card);
      NAV.forEach(function (n, k) { mk("div", "nav" + (k === (s.nav || 0) ? " on" : ""), side, { top: 34 + k * 66 }, n); });
      mx = 270 + 64;
    }
    return { mx: mx, my: 88 + 44, mw: 1500 - mx - 70, mh: 840 - 88 - 44 - 44, pill: pill, top: top };
  }

  // ---------- body kinds: each returns {target:{x,y} card-local, act(tv, end)} ----------
  var KINDS = {};

  KINDS.tiles = function (card, s, g, beat) {
    cas(mk("div", "h1", card, { left: g.mx, top: g.my }, s.title || ""));
    if (s.subtitle) cas(mk("div", "sub", card, { left: g.mx, top: g.my + 62 }, s.subtitle));
    var tiles = s.tiles || [], n = Math.max(1, tiles.length), gap = 28;
    var w = (g.mw - gap * (n - 1)) / n, top = g.my + 128, h = s.compact ? 300 : 400;
    var els = tiles.map(function (t, k) {
      var x = g.mx + k * (w + gap);
      var tile = mk("div", "tile", card, { left: x, top: top, width: w, height: h });
      var th = mk("div", "thumb", tile, t.img ? { backgroundImage: "url(" + t.img + ")" } : { background: t.color || "" });
      if (t.thumb_text) mk("div", "tt", th, { top: (h * 0.52 - 36) / 2, textAlign: "center", left: 0, right: 0 }, t.thumb_text);
      mk("div", "tt", tile, { top: h * 0.52 + 18 }, t.title || "");
      if (t.desc) mk("div", "td", tile, { top: h * 0.52 + 60, whiteSpace: "normal" }, t.desc);
      if (t.meta) mk("div", "tm", tile, { top: h - 46 }, t.meta);
      cas(tile);
      return { el: tile, x: x, w: w };
    });
    var btn = null;
    if (s.button) { var bw = btnW(s.button); btn = mk("div", "btn", card, { left: g.mx + g.mw - bw, top: 840 - 44 - 64 - 10, width: bw }, s.button); tl.set(btn, { opacity: 0.4 }, 0); }
    var k = Math.min(beat.target || 0, els.length - 1), T0 = els[k];
    var ring = mk("div", "ring", card, { left: T0.x - 7, top: top - 7, width: T0.w + 14, height: h + 14 });
    var tick = mk("div", "tick", card, { left: T0.x + T0.w - 64, top: top + 18 }); tick.innerHTML = TICK;
    hideAt0([ring, tick]);
    return {
      target: { x: T0.x + T0.w / 2, y: top + h * 0.3 },
      act: function (tv) {
        pressTarget(T0.el, tv);
        appear(ring, tv, { scale: 1.04 }, 0.24, "back.out(1.5)");
        appear(tick, tv + 0.06, { scale: 0.4 }, 0.26, "back.out(1.8)");
        if (btn) tl.fromTo(btn, { opacity: 0.4 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, snap(tv + 0.1));
        return tv + 0.4;
      }
    };
  };

  KINDS.rows = function (card, s, g, beat) {
    cas(mk("div", "h1", card, { left: g.mx, top: g.my }, s.title || ""));
    if (s.subtitle) cas(mk("div", "sub", card, { left: g.mx, top: g.my + 62 }, s.subtitle));
    var y = g.my + 128, btn = null, bw = s.button ? btnW(s.button) : 0;
    if (s.field != null) {
      var f = cas(mk("div", "field-in", card, { left: g.mx, top: y, width: g.mw - (bw ? bw + 24 : 0) }));
      mk("div", "ph", f, null, s.field);
    }
    if (s.button) btn = cas(mk("div", "btn", card, { left: g.mx + g.mw - bw, top: y + 4, width: bw }, s.button));
    var ry = y + (s.field != null || s.button ? 104 : 0), rh = 88, gap = 14;
    var rows = (s.rows || []).map(function (r, k) {
      var row = mk("div", "row", card, { left: g.mx, top: ry + k * (rh + gap), width: g.mw, height: rh });
      mk("div", "tag", row, { top: r.sub ? 22 : 33 }, r.tag || "");
      if (r.swatch) mk("div", "sw", row, { left: 190, top: 27, background: r.swatch });
      var lx = r.swatch ? 244 : 190;
      mk("div", "rt", row, { top: r.sub ? 12 : 27, left: lx }, r.text || "");
      if (r.sub) mk("div", "rs", row, { top: 48, left: lx }, r.sub);
      var badge = r.badge ? mk("div", "badge", row, { top: 24 }, r.badge) : null;
      if (badge) badge.setAttribute("data-layout-allow-overlap", "");
      return { el: row, y: ry + k * (rh + gap), badge: badge, r: r };
    });
    var act = beat.action;
    var streams = !(act === "select" || act === "toggle") && !rows.some(function (r) { return r.r.badge_after; });
    if (!streams) rows.forEach(function (r) { cas(r.el); });
    if (act === "select" || act === "toggle") {
      var k = Math.min(beat.target || 0, rows.length - 1), R = rows[k];
      var ring = mk("div", "ring", card, { left: g.mx - 6, top: R.y - 6, width: g.mw + 12, height: rh + 12, borderRadius: "22px" });
      var tick = mk("div", "tick", card, { left: g.mx + g.mw - 70, top: R.y + 21 }); tick.innerHTML = TICK;
      hideAt0([ring, tick]);
      if (R.badge) tl.set(R.badge, { autoAlpha: 1 }, 0);
      if (R.r.badge_after) { R.after = mk("div", "badge", R.el, { top: 24, right: "96px", background: "var(--color_field)", color: "#fff" }, R.r.badge_after); hideAt0(R.after); }
      return {
        target: { x: g.mx + g.mw * 0.42, y: R.y + rh / 2 },
        act: function (tv) {
          pressTarget(R.el, tv);
          appear(ring, tv, { scale: 1.02 }, 0.24, "back.out(1.5)");
          if (R.badge) tl.fromTo(R.badge, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.12, ease: "none" }, snap(tv));
          if (R.after) appear(R.after, tv + 0.1, { scale: 0.6 }, 0.26, "back.out(1.8)");
          appear(tick, tv + 0.06, { scale: 0.4 }, 0.26, "back.out(1.8)");
          return tv + 0.4;
        }
      };
    }
    // click the button, variant A: the rows already exist and change state (badge -> badge_after), one after another
    if (rows.some(function (r) { return r.r.badge_after; })) {
      var after = rows.map(function (r) {
        if (!r.r.badge_after || !r.badge) return null;
        var b2 = mk("div", "badge", r.el, { top: 24, background: "var(--color_field)", color: "#fff" }, r.r.badge_after);
        b2.setAttribute("data-layout-allow-overlap", "");
        hideAt0(b2); return b2;
      });
      return {
        target: btn ? { x: g.mx + g.mw - bw / 2, y: y + 36 } : { x: g.mx + 200, y: y + 36 },
        act: function (tv) {
          if (btn) pressTarget(btn, tv);
          rows.forEach(function (r, k) {
            if (!after[k]) return;
            var t = tv + 0.15 + k * 0.15;
            tl.fromTo(r.badge, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.1, ease: "none" }, snap(t));
            appear(after[k], t, { scale: 0.6 }, 0.26, "back.out(1.8)");
          });
          return tv + 0.4 + rows.length * 0.15;
        }
      };
    }
    // click the button, variant B: the rows are the result and stream in
    hideAt0(rows.map(function (r) { return r.el; }));
    return {
      target: btn ? { x: g.mx + g.mw - bw / 2, y: y + 36 } : { x: g.mx + 200, y: y + 36 },
      act: function (tv) {
        if (btn) pressTarget(btn, tv);
        rows.forEach(function (r, k) { appear(r.el, tv + 0.18 + k * 0.14, { y: 26 }, 0.3, "power3.out"); });
        return tv + 0.3 + rows.length * 0.14;
      }
    };
  };

  KINDS.toggles = function (card, s, g, beat) {
    cas(mk("div", "h1", card, { left: g.mx, top: g.my }, s.title || ""));
    if (s.subtitle) cas(mk("div", "sub", card, { left: g.mx, top: g.my + 62 }, s.subtitle));
    var y = g.my + 128;
    if (s.kit) {
      var kit = cas(mk("div", "kit", card, { left: g.mx, top: y, width: g.mw, height: 104 }));
      if (s.kit.swatch) mk("div", "sw", kit, { position: "absolute", left: 26, top: 26, width: 52, height: 52, borderRadius: "14px", background: s.kit.swatch });
      mk("div", "sl", kit, { position: "absolute", left: 100, top: 16, font: "700 28px/36px var(--ui)", whiteSpace: "nowrap" }, s.kit.name || "");
      mk("div", "ss", kit, { position: "absolute", left: 100, top: 54, font: "400 22px/30px var(--ui)", color: "var(--color_body)", whiteSpace: "nowrap" }, s.kit.meta || "");
      if (s.kit.button) { var kb = btnW(s.kit.button); mk("div", "btn ghost", kit, { left: g.mw - kb - 24, top: 18, width: kb }, s.kit.button); }
      y += 132;
    }
    var rh = 96, tgt = null;
    (s.rows || []).forEach(function (r, k) {
      var ry = y + k * rh;
      var set = cas(mk("div", "set", card, { left: g.mx, top: ry, width: g.mw, height: rh }));
      mk("div", "sl", set, { top: r.sub ? 14 : 30 }, r.label || "");
      if (r.sub) mk("div", "ss", set, { top: 52 }, r.sub);
      if (r.options) {
        var seg = mk("div", "seg", set, { right: 0, top: 20 });
        r.options.forEach(function (o, j) { mk("span", j === (r.sel || 0) ? "on" : "", seg, null, o); });
      } else {
        var tog = mk("div", "tog", set, { right: 0, top: 22 });
        var on = mk("div", "on", tog), knob = mk("div", "knob", tog);
        var isT = k === (beat.target || 0) && beat.action === "toggle";
        tl.set(on, { autoAlpha: r.on ? 1 : 0 }, 0); tl.set(knob, { x: r.on ? 40 : 0 }, 0);
        if (isT) tgt = { on: on, knob: knob, tog: tog, x: g.mx + g.mw - 46, y: ry + 48, was: !!r.on };
      }
    });
    if (!tgt) LOG.warnings.push("toggles: target row has no toggle");
    return {
      target: tgt ? { x: tgt.x, y: tgt.y } : { x: g.mx + g.mw - 46, y: y + 48 },
      act: function (tv) {
        if (!tgt) return tv;
        var a = tgt.was ? 1 : 0, b = 1 - a;
        tl.fromTo(tgt.knob, { x: a ? 40 : 0 }, { x: b ? 40 : 0, duration: 0.18, ease: "power2.out" }, snap(tv));
        tl.fromTo(tgt.on, { autoAlpha: a }, { autoAlpha: b, duration: 0.18, ease: "power2.out" }, snap(tv));
        return tv + 0.3;
      }
    };
  };

  function previewFrame(card, x, y, w, h, kicker, headline) {
    var fr = cas(mk("div", "frame", card, { left: x, top: y, width: w, height: h }));
    var inn = mk("div", "inner", fr);
    var ih = h - 44;
    if (kicker) mk("div", "fk", inn, { top: ih * 0.34 }, kicker);
    var fh = headline != null ? mk("div", "fh", inn, { top: ih * 0.34 + 38 }, headline) : null;
    return { fr: fr, inn: inn, fh: fh, ih: ih };
  }

  KINDS.editor = function (card, s, g, beat) {
    // the side panel keeps >= 410 px (a 24-char headline at 25 px); the preview takes the rest, 16:9
    var fw = Math.min(820, g.mw - 440), fh = Math.round(fw * 0.5625), pw = g.mw - fw - 30;
    var pv = previewFrame(card, g.mx, g.my, fw, fh, s.kicker, s.from || "");
    var segs = s.scenes || [];
    var sw = (fw - 12 * (segs.length - 1)) / Math.max(1, segs.length);
    segs.forEach(function (n, k) { var e = cas(mk("div", "seg-tl", card, { left: g.mx + k * (sw + 12), top: g.my + fh + 26, width: sw }, n)); if (k === (s.open || 0)) { e.style.borderColor = "var(--color_bright)"; e.style.color = "var(--color_ink)"; } });
    var px0 = g.mx + fw + 30;
    var panel = cas(mk("div", "panel", card, { left: px0, top: g.my, width: pw, height: g.mh }));
    mk("div", "sl", panel, { position: "absolute", left: 30, top: 26, font: "700 27px/34px var(--ui)", whiteSpace: "nowrap" }, s.panel_title || "");
    mk("div", "ss", panel, { position: "absolute", left: 30, top: 92, font: "700 21px/28px var(--ui)", color: "var(--color_body)", whiteSpace: "nowrap" }, s.field_label || "");
    var fld = mk("div", "field-in", panel, { left: 30, top: 128, width: pw - 60 });
    var old = mk("div", "ph", fld, null, s.from || "");
    var focus = mk("div", "focus", panel, { left: 26, top: 124, width: pw - 52, height: 80 });
    hideAt0(focus);
    (s.notes || []).forEach(function (n, k) { mk("div", "ss", panel, { position: "absolute", left: 30, top: 236 + k * 44, font: "400 22px/30px var(--ui)", color: "var(--color_body)", whiteSpace: "nowrap" }, n); });
    // the preview's new headline, typed in sync with the field
    var nh = mk("div", "fh", pv.inn, { top: pv.ih * 0.34 + 38 });
    var nspan = mk("span", null, nh, { display: "inline-block" }, s.to || "");
    tl.set(nspan, { clipPath: "inset(0% 100% 0% 0%)" }, 0);
    var tgt = { x: px0 + 30 + 70, y: g.my + 128 + 36 };
    return {
      target: tgt,
      act: function (tv) {
        appear(focus, tv, { scale: 1.02 }, 0.18, "power2.out");
        tl.fromTo(old, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.1, ease: "none" }, snap(tv + 0.08));
        if (pv.fh) tl.fromTo(pv.fh, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.1, ease: "none" }, snap(tv + 0.08));
        var d = typeInto(fld, s.to || "", tv + 0.12, null, null);
        tl.fromTo(nspan, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease: "none" }, snap(tv + 0.12));
        LOG.typing = LOG.typing || []; LOG.typing.push({ t: tv + 0.12, d: d });
        return tv + 0.12 + d;
      }
    };
  };

  KINDS.stages = function (card, s, g, beat, pill) {
    var fw = Math.min(820, g.mw - 440), fh = Math.round(fw * 0.5625), pw = g.mw - fw - 30;
    previewFrame(card, g.mx, g.my, fw, fh, s.kicker, s.headline || "");
    var px0 = g.mx + fw + 30;
    var panel = cas(mk("div", "panel", card, { left: px0, top: g.my, width: pw, height: g.mh }));
    var t1 = mk("div", "sl", panel, { position: "absolute", left: 30, top: 26, font: "700 28px/34px var(--ui)", whiteSpace: "nowrap" }, s.panel_title || "");
    if (s.panel_note) mk("div", "ss", panel, { position: "absolute", left: 30, top: 66, font: "400 20px/28px var(--ui)", color: "var(--color_body)", whiteSpace: "nowrap" }, s.panel_note);
    var stages = (s.stages || []).map(function (name, k) {
      var r = mk("div", "stage-row", panel, { top: 118 + k * 62 });
      var dot = mk("div", "dot", r), ok = mk("div", "ok", r); ok.innerHTML = TICK.replace('viewBox="0 0 24 22"', 'viewBox="-4 -4 32 30"');
      mk("span", "lbl", r, null, name);
      hideAt0(ok);
      return { r: r, ok: ok };
    });
    var ci = s.counter_stage == null ? 1 : s.counter_stage, cnt = null, bar = null;
    if (s.counter && stages[ci]) {
      cnt = mk("div", "cnt", stages[ci].r, null, "0 / " + s.counter.to + " " + (s.counter.unit || ""));
      var b = mk("div", "bar", panel, { left: 72, top: 118 + ci * 62 + 46, width: pw - 102 });
      bar = mk("i", null, b); tl.set(bar, { scaleX: 0 }, 0);
    }
    var bw = pw - 60, btn = mk("div", "btn", panel, { left: 30, top: g.mh - 94, width: bw }, s.button || "");
    var tgt = { x: px0 + 30 + bw / 2, y: g.my + g.mh - 94 + 32 };
    return {
      target: tgt,
      act: function (tv, end) {
        pressTarget(btn, tv);
        tl.set(btn, { autoAlpha: 0 }, snap(tv + 0.4)); // a dimmed button fails contrast; the submitted control leaves
        var t = tv + 0.35;
        stages.forEach(function (st, k) {
          if (k === ci && cnt) {
            var cEnd = Math.min(t + 0.15 + (s.counter.dur || 2.0), end - 1.2);
            var o = { v: 0 }, to = s.counter.to, unit = s.counter.unit || "";
            tl.fromTo(o, { v: 0 }, { v: to, duration: Math.max(0.6, cEnd - t - 0.15), ease: "power1.inOut",
              onUpdate: function () { cnt.textContent = Math.round(o.v) + " / " + to + " " + unit; } }, snap(t + 0.15));
            tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: Math.max(0.6, cEnd - t - 0.15), ease: "power1.inOut" }, snap(t + 0.15));
            t = cEnd;
          }
          if (t < end - 0.35) appear(st.ok, t, { scale: 0.4 }, 0.22, "back.out(1.8)");
          t += k === ci ? 0.1 : 0.3;
        });
        LOG.count = { start: tv + 0.5, to: s.counter && s.counter.to };
        return t;
      }
    };
  };

  KINDS.player = function (card, s, g, beat) {
    var fw = Math.min(900, g.mw - 430), fh = Math.round(fw * 0.5625), pw = g.mw - fw - 30;
    var pv = previewFrame(card, g.mx, g.my, fw, fh, s.kicker, null);
    if (s.headline) mk("div", "fh", pv.inn, { top: 44, font: "700 36px/44px var(--display)" }, s.headline);
    var shot = mk("div", "abs", pv.inn, { left: 150, top: 116, width: fw - 44 - 300, height: fh - 216, borderRadius: "14px", background: "var(--color_subtle)", border: "2px solid var(--color_line)", boxSizing: "border-box" });
    for (var i = 0; i < 4; i++) mk("div", "abs", shot, { left: 30, top: 34 + i * 58, width: [380, 260, 320, 200][i], height: 22, borderRadius: "11px", background: i ? "var(--color_line)" : "var(--color_softink)", opacity: i ? 1 : 0.8 });
    var segs = s.segments || [], tw = fw, sw = (tw - 10 * (segs.length - 1)) / Math.max(1, segs.length), ty = g.my + fh + 36;
    segs.forEach(function (n, k) { cas(mk("div", "seg-tl", card, { left: g.mx + k * (sw + 10), top: ty, width: sw }, n)); });
    var ph = mk("div", "abs", card, { left: g.mx + (s.playhead || 0.42) * tw, top: ty - 16, width: 4, height: 92, background: "var(--color_ink)", borderRadius: "2px" });
    var pin = mk("div", "pin", card, { left: g.mx + (s.playhead || 0.42) * tw - 16, top: ty - 58 }, "1");
    var sel = mk("div", "sel", pv.inn, { left: 140, top: 106, width: fw - 44 - 280, height: fh - 196 });
    mk("span", null, sel, null, s.sel_label || "");
    hideAt0([pin, sel]);
    var px0 = g.mx + fw + 30;
    var panel = cas(mk("div", "panel", card, { left: px0, top: g.my, width: pw, height: g.mh }));
    mk("div", "sl", panel, { position: "absolute", left: 28, top: 24, font: "700 27px/34px var(--ui)", whiteSpace: "nowrap" }, s.panel_title || "");
    var fld = mk("div", "field-in", panel, { left: 28, top: 80, width: pw - 56 });
    var phd = mk("div", "ph", fld, { color: "var(--color_body)" }, s.placeholder || "");
    var bw = btnW(s.button || "Add"), btn = mk("div", "btn", panel, { left: pw - 28 - bw, top: 172, width: bw }, s.button || "");
    tl.set(btn, { opacity: 0.4 }, 0);
    var tgt = { x: g.mx + 22 + 150 + (fw - 344) / 2, y: g.my + 22 + 116 + (fh - 216) / 2 };
    return {
      target: tgt,
      act: function (tv, end) {
        appear(sel, tv, { scale: 1.03 }, 0.22, "back.out(1.5)");
        appear(pin, tv + 0.05, { y: -40 }, 0.32, "back.out(1.6)");
        tl.fromTo(phd, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.1, ease: "none" }, snap(tv + 0.3));
        var txt = s.comment || "";
        var room = end - (tv + 0.35) - 0.4;
        if (txt.length / TYPE_CPS > room) { LOG.warnings.push("player: comment too long for the beat; trimmed reveal speed"); }
        var d = typeInto(fld, txt, tv + 0.35, null, null);
        LOG.typing = LOG.typing || []; LOG.typing.push({ t: tv + 0.35, d: d });
        tl.fromTo(btn, { opacity: 0.4 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, snap(tv + 0.35 + d));
        return tv + 0.35 + d;
      }
    };
  };

  // ---------- acts ----------
  var W = 1920, H = 1080;
  if (!T) { LOG.warnings.push("no timing variable"); }

  // Pacing law (v1.1): nothing settles. Every scene carries a camera move from its entry to its cut (a push about the
  // action target, plus parallax on the field and shapes), content arrives on words, and the exit starts on the
  // outgoing line's last stressed word (a J-cut) so the next scene is already moving when its line starts.
  // The one sanctioned still: the comma between the reveal shapes landing and the name (timing.stillness, <= 0.9 s).

  // ACT 1 — problem: a persona (mascot / initials) ringed by the jobs that pile up, one job per spoken word
  (function () {
    var P = T.problem, R = T.reveal.start, g = mk("div", "grp", stage);
    g.setAttribute("data-layout-allow-overflow", "");
    windowed(g, 0, R);
    var pers = mk("div", "persona", g, { left: 560, top: 300, width: 800, height: 533 });
    if (V.mascot_src) { var im = mk("img", null, pers, { width: "100%", height: "auto" }); im.src = V.mascot_src; im.alt = ""; }
    else { var av = mk("div", "avatar", pers, { left: 250, top: 120, width: 300, height: 300, background: "var(--color_field)", fontSize: "120px" }, V.persona_initials || "You"); }
    // the persona arrives in flight and keeps travelling with the current's opposite (it is being chased by the work)
    // (entry eases into the drift's own speed: a power3.out that settles to zero reads as a hold before the drift)
    tl.fromTo(pers, { x: -700, autoAlpha: 1 }, { x: -170, autoAlpha: 1, duration: 0.6, ease: "power2.out" }, snap(P.start + 0.05));
    tl.fromTo(pers, { x: -170 }, { x: 90, duration: Math.max(0.5, R - 0.36 - (P.start + 0.65)), ease: "none" }, snap(P.start + 0.65));
    var chips = L(V.problem_chips);
    var SL = [[230, 230], [1180, 190], [150, 760], [1210, 790], [700, 110], [720, 900]];
    var ctr = [];
    var els = chips.map(function (c, k) {
      var w = Math.round(c.length * 16.5 + 70), p = SL[k % SL.length], x = Math.min(W - w - 60, p[0]);
      var e = mk("div", "pchip", g, { left: x, top: p[1], width: w });
      e.textContent = c; hideAt0(e);
      ctr.push([960 - (x + w / 2), 540 - (p[1] + 38)]);
      var t = (P.chips && P.chips[k] != null) ? P.chips[k] : P.start + 0.8 + k * 0.6;
      appear(e, t, { scale: 0.6, y: 30 }, 0.32, "back.out(1.6)");
      return e;
    });
    ctr.push([0, 0]);
    // camera with intent: a continuous push + drift while the jobs pile up (never a settle)
    tl.fromTo(g, { scale: 1, x: 0, transformOrigin: "50% 50%" }, { scale: 1.14, x: -50, transformOrigin: "50% 50%", duration: Math.max(0.5, R - 0.36 - P.start), ease: "none" }, snap(P.start));
    // collapse into the reveal: everything converges on the centre and shrinks (Z pull) — the shapes take over
    var all = els.concat([pers]);
    all.forEach(function (e, k) {
      var sx = k < els.length ? 0 : 90;
      tl.fromTo(e, { x: sx, y: 0, scale: 1 }, { x: sx + ctr[k][0] * 0.8, y: ctr[k][1] * 0.8, scale: 0.25, duration: 0.36, ease: "power3.in" }, snap(R - 0.36));
    });
    tl.fromTo(g, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.16, ease: "power2.in" }, snap(R - 0.16));
    LOG.scenes.push({ id: "problem", start: P.start, end: R });
  })();

  // shapes + lockup builder (reveal and CTA)
  function lockup(parent, top) {
    var lk = mk("div", "lockup", parent, { top: top, height: 140 });
    if (V.mark_src) { var im = mk("img", null, lk); im.src = V.mark_src; im.alt = ""; }
    var wd = mk("div", "word", lk), name = V.product_name || "", acc = V.wordmark_accent || "";
    var i = acc ? name.lastIndexOf(acc) : -1;
    if (i >= 0) { wd.appendChild(document.createTextNode(name.slice(0, i))); mk("em", null, wd, null, acc); wd.appendChild(document.createTextNode(name.slice(i + acc.length))); }
    else wd.textContent = name;
    return lk;
  }
  function drift(el, t0, t1, to) { // parallax under the camera: linear, finite, carries the camera (not a wobble)
    if (t1 - t0 < 0.2) return;
    var from = {}; for (var k in to) from[k] = 0;
    tl.fromTo(el, from, Object.assign({ duration: t1 - t0, ease: "none" }, to), snap(t0));
  }

  // ACT 2 — reveal: brand shapes wipe in from the edges; a held comma; the mark and name land; the positioning line
  (function () {
    var Rv = T.reveal, B1 = T.beats.length ? T.beats[0].start : Rv.end;
    var g = mk("div", "grp", stage); g.setAttribute("data-layout-allow-overflow", "");
    windowed(g, Rv.start, B1);
    var s1 = mk("div", "shape", g, { left: -300, top: 240, width: 600, height: 600 });
    var s2 = mk("div", "shape", g, { left: 1700, top: -160, width: 440, height: 440, background: "var(--color_field)" });
    var s3 = mk("div", "shape", g, { left: 1380, top: 900, width: 320, height: 320 });
    tl.fromTo(s1, { x: -420 }, { x: 0, duration: 0.55, ease: "power3.out" }, snap(Rv.start));
    tl.fromTo(s2, { x: 380 }, { x: 0, duration: 0.55, ease: "power3.out" }, snap(Rv.start + 0.04));
    tl.fromTo(s3, { y: 300 }, { y: 0, duration: 0.55, ease: "power3.out" }, snap(Rv.start + 0.08));
    // the declared stillness (timing.stillness) runs from the shapes landing to the name; then the camera moves on
    var dz = Math.max(Rv.start + 0.65, Rv.name_t - 0.9);
    drift(s1, dz, B1, { x: -90, y: 30 });
    drift(s2, dz, B1, { x: -170, y: 50 });
    drift(s3, dz, B1, { x: -130, y: -40 });
    var lk = lockup(g, 400); hideAt0(lk);
    tl.fromTo(lk, { autoAlpha: 0, scale: 1.25 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: "expo.out" }, snap(Rv.name_t));
    var pl = mk("div", "posline", g, { top: 600 }, V.positioning_line || ""); hideAt0(pl);
    var pt = Rv.pos_t != null ? Rv.pos_t : Rv.name_t + 0.55;
    appear(pl, pt, { y: 24 }, 0.32, "power3.out");
    // camera with intent: a continuous push on the lockup until the cut
    tl.fromTo(lk, { scale: 1 }, { scale: 1.09, duration: Math.max(0.5, B1 - (Rv.name_t + 0.5)), ease: "none" }, snap(Rv.name_t + 0.5));
    tl.fromTo(pl, { scale: 1 }, { scale: 1.05, duration: Math.max(0.5, B1 - (pt + 0.32)), ease: "none" }, snap(pt + 0.32));
    // whip LEFT into the tour (the film's current), starting on the last stressed word
    tl.fromTo(g, { x: 0 }, { x: -600, duration: EXIT, ease: "power3.in" }, snap(B1 - EXIT));
    LOG.scenes.push({ id: "reveal", start: Rv.start, end: B1, stillness: T.stillness || null });
  })();

  // kinetic keyword (optional slot `keyword` per beat): big type on a white slab along the bottom, word-by-word
  // waterfall entry on its spoken word, the last word in the brand colour ("Make it **move.**"). Stays to the cut.
  function keyword(g, text, t) {
    var ws = String(text || "").split(/\s+/).filter(Boolean);
    if (!ws.length || t == null) return;
    var slab = mk("div", "kw", g); slab.setAttribute("data-layout-allow-overlap", "");
    var spans = ws.map(function (w, j) { var e = mk("span", j === ws.length - 1 ? "em" : "", slab, null, w); return e; });
    hideAt0(slab); hideAt0(spans);
    tl.set(slab, { autoAlpha: 1 }, snap(t));
    tl.fromTo(slab, { x: -120 }, { x: 0, duration: 0.34, ease: "power4.out" }, snap(t));
    var dt = 0.07;
    spans.forEach(function (e, j) {
      var tj = t + 0.04 + j * dt; dt *= 0.84;
      tl.set(e, { autoAlpha: 1 }, snap(tj));
      tl.fromTo(e, { y: j === ws.length - 1 ? 80 : 56 }, { y: 0, duration: j === ws.length - 1 ? 0.24 : 0.18, ease: "power4.out" }, snap(tj));
    });
    LOG.keywords = LOG.keywords || []; LOG.keywords.push({ text: text, t: t });
  }

  // ACT 3 — the tour: one sentence, one screen, one demonstrated action on the verb
  var FIELDS = [ // over-wide so the parallax drift never exposes an edge
    { left: -240, top: 0, width: 2400, height: 1080 },
    { left: 640, top: 0, width: 1520, height: 1080 },
    { left: -240, top: 0, width: 2400, height: 600 }
  ];
  T.beats.forEach(function (bt, i) {
    var beat = BEATS[i] || {}, s = beat.screen || {};
    var S = bt.start, E = bt.end, tv = bt.verb_t;
    var g = mk("div", "grp", stage); g.setAttribute("data-layout-allow-overflow", "");
    windowed(g, S, E);
    var fld = mk("div", "field", g, FIELDS[i % FIELDS.length]);
    var shp = mk("div", "shape", g, i % 2 ? { left: -180, top: 760, width: 420, height: 420 } : { left: 1690, top: -200, width: 460, height: 460 });
    var chip = mk("div", "chip", g); mk("i", null, chip); mk("span", null, chip, null, beat.chip || "");
    var card = mk("div", "card", g);
    var gm = chrome(card, s);
    CAS = [];
    var kind = KINDS[s.kind] || KINDS.rows;
    var body = kind(card, s, gm, beat);
    var casc = CAS; CAS = null;
    var gx = 210 + body.target.x, gy = 150 + body.target.y;
    // entry from the right, already in flight; card trails the field for depth
    tl.fromTo(g, { x: 900 }, { x: 0, duration: 0.5, ease: "power3.out" }, snap(S));
    tl.fromTo(card, { x: 260 }, { x: 0, duration: 0.5, ease: "power3.out" }, snap(S));
    tl.fromTo(shp, { y: i % 2 ? 240 : -240 }, { y: 0, duration: 0.6, ease: "power3.out" }, snap(S + 0.05));
    // the screen assembles while the first clause is spoken (waterfall entry), finished >= 0.45 s before the verb
    var c0 = S + 0.2, c1 = Math.min(tv - 0.45, c0 + 0.1 * Math.max(1, casc.length - 1));
    var step = casc.length > 1 && c1 > c0 ? (c1 - c0) / (casc.length - 1) : 0;
    casc.forEach(function (el, k) {
      var t = c0 + k * step;
      tl.set(el, { autoAlpha: 0 }, 0); tl.set(el, { autoAlpha: 1 }, snap(t));
      tl.fromTo(el, { y: 44 }, { y: 0, duration: 0.3, ease: "power4.out" }, snap(t));
    });
    // camera with intent, from entry to cut: a push centred on the action target (its aim holds) + parallax drift
    var ox = (body.target.x / 1500 * 100).toFixed(2) + "% " + (body.target.y / 840 * 100).toFixed(2) + "%";
    tl.fromTo(card, { scale: 1, transformOrigin: ox }, { scale: 1.07, transformOrigin: ox, duration: Math.max(0.5, E - (S + 0.5)), ease: "none" }, snap(S + 0.5));
    drift(fld, S + 0.5, E, { x: -110 });
    drift(shp, S + 0.7, E, { x: -180, y: i % 2 ? -60 : 60 });
    keyword(g, beat.keyword, bt.kw_t);
    // exit LEFT, accelerating into the cut; it starts on the last stressed word (J-cut, timing.json cuts)
    if (i < T.beats.length - 1 || T.cta) tl.fromTo(g, { x: 0 }, { x: -600, duration: EXIT, ease: "power3.in" }, snap(E - EXIT));
    // cursor: enters from below on the first beat, otherwise hands off across the seam
    travelTo(gx, gy, tv, i === 0 ? S + 0.1 : S - 0.3);
    press(tv);
    var done = body.act(tv, E - EXIT);
    if (done + 0.1 < E - 0.9) driftAside(Math.max(tv + 0.45, cur.free), 150, 110);
    LOG.actions.push({ beat: i + 1, chip: beat.chip, verb: beat.verb, action: beat.action, t: tv, x: Math.round(gx), y: Math.round(gy), start: S, end: E });
    LOG.scenes.push({ id: "beat" + (i + 1), start: S, end: E });
  });

  // ACT 4 — CTA: the people (mascot / initials) arrive on the opener's words, collapse into the lockup on the name,
  // the cursor presses the CTA; the camera keeps pushing through the tail
  (function () {
    var C = T.cta, g = mk("div", "grp", stage); g.setAttribute("data-layout-allow-overflow", "");
    windowed(g, C.start, null);
    var sa = mk("div", "shape", g, { left: -260, top: 660, width: 620, height: 620 });
    var sb = mk("div", "shape", g, { left: 1580, top: -240, width: 500, height: 500, background: "var(--color_field)" });
    var cl = mk("div", "grp", g); cl.setAttribute("data-layout-allow-overflow", "");
    var ini = L(V.avatars), cols = ["var(--color_field)", "var(--color_bright)", "var(--color_softink)", "var(--color_ink)"];
    var SL = [[330, 230, 150], [1430, 210, 170], [250, 700, 130], [1500, 690, 150], [720, 120, 110], [1120, 880, 120], [620, 860, 100], [1240, 110, 96]];
    var parts = ini.map(function (s, k) {
      var p = SL[k % SL.length];
      return mk("div", "avatar", cl, { left: p[0], top: p[1], width: p[2], height: p[2], background: cols[k % cols.length], fontSize: px(p[2] * 0.36) }, s);
    });
    var masc = null;
    if (V.mascot_src) { masc = mk("img", "persona", cl, { left: 660, top: 330, width: 600, height: 400 }); masc.src = V.mascot_src; masc.alt = ""; }
    tl.fromTo(cl, { x: 900 }, { x: 0, duration: 0.5, ease: "power3.out" }, snap(C.start));
    tl.fromTo(sa, { x: 700 }, { x: 0, duration: 0.55, ease: "power3.out" }, snap(C.start));
    tl.fromTo(sb, { x: 600 }, { x: 0, duration: 0.55, ease: "power3.out" }, snap(C.start + 0.04));
    drift(sa, C.start + 0.6, T.total, { x: -120, y: -40 });
    drift(sb, C.start + 0.6, T.total, { x: -200, y: 60 });
    // the people arrive on the opener's words (two per word), never all at once
    var Wd = (C.words && C.words.length) ? C.words : [C.start + 0.3, C.start + 0.6, C.start + 0.9];
    parts.forEach(function (p, k) {
      var t = Math.max(C.start + 0.1, Wd[k % Wd.length] + Math.floor(k / Wd.length) * 0.12);
      t = Math.min(t, C.name_t - 0.5);
      hideAt0(p);
      appear(p, t, { scale: 0.4 }, 0.3, "back.out(1.6)");
    });
    if (masc) tl.fromTo(masc, { scale: 1 }, { scale: 1.08, duration: Math.max(0.3, C.name_t - 0.3 - (C.start + 0.5)), ease: "none" }, snap(C.start + 0.5));
    var allp = masc ? parts.concat([masc]) : parts;
    // collapse into the lockup on the product's name
    tl.fromTo(allp, { scale: 1, autoAlpha: 1 }, { scale: 0.2, autoAlpha: 0, duration: 0.34, ease: "power3.in", stagger: 0.02 }, snap(C.name_t - 0.3));
    var fin = mk("div", "grp", g); fin.setAttribute("data-layout-allow-overflow", "");
    var lk = lockup(fin, 340); hideAt0(lk);
    tl.fromTo(lk, { autoAlpha: 0, scale: 1.25 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: "expo.out" }, snap(C.name_t));
    var lbl = V.cta_label || "", bw = Math.round(lbl.length * 20 + 108);
    var pill = mk("div", "cta", fin, { left: (W - bw) / 2, top: 560, width: bw }, lbl); hideAt0(pill);
    appear(pill, C.name_t + 0.4, { y: 40 }, 0.36, "power3.out");
    if (V.cta_url) { var u = mk("div", "url", fin, { top: 690 }, V.cta_url); hideAt0(u); appear(u, C.name_t + 0.55, { y: 24 }, 0.36, "power3.out"); }
    if (V.disclaimer) { var n = mk("div", "note", g, null, V.disclaimer); hideAt0(n); appear(n, C.start + 0.6, { y: 10 }, 0.3); }
    var gx = W / 2 + bw / 2 - 46, gy = 618; // aim at the pill's right end so the label stays readable
    // camera: a continuous push on the end card about the pill's press point (the cursor's aim holds), to the last frame
    tl.fromTo(fin, { scale: 1, transformOrigin: gx + "px " + gy + "px" }, { scale: 1.1, transformOrigin: gx + "px " + gy + "px", duration: Math.max(0.5, T.total - (C.name_t + 0.5)), ease: "none" }, snap(C.name_t + 0.5));
    travelTo(gx, gy, C.verb_t, C.name_t + 0.3);
    press(C.verb_t); pressTarget(pill, C.verb_t);
    var ring = mk("div", "ring", fin, { left: (W - bw) / 2 - 10, top: 550, width: bw + 20, height: 112, borderRadius: "9999px" }); hideAt0(ring);
    tl.fromTo(ring, { autoAlpha: 0.9, scale: 1 }, { autoAlpha: 0, scale: 1.18, duration: 0.6, ease: "power2.out" }, snap(C.verb_t));
    cursorTo(cur.x + TIPX + 420, H + 160, C.verb_t + 0.5, C.verb_t + 1.1, "power2.in");
    LOG.actions.push({ beat: "cta", verb: V.cta_verb || "", action: "click", t: C.verb_t, x: gx, y: gy });
    LOG.scenes.push({ id: "cta", start: C.start, end: T.total });
  })();

  tl.set({}, {}, T.total);
  window.__fxTimeline = tl;
})();
