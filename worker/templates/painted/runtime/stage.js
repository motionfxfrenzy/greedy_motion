/*
 * The stage: which shot is on screen at a moment, the camera, the paint pass and the captions.
 *   window.initShort(spec)      sets the film up (spec.beats were laid out by render.mjs from the voice timing)
 *   window.drawing(d)           paints drawing d (each is held `twos` frames, like hand animation) and returns it as a JPEG data URL
 *   window.still(i, at)         shot i at progress `at` (0..1) as a JPEG data URL, for contact sheets
 */
(function () {
  let S, scene, sg, FH, avg, flat, fg, glc, painter, out, og, u;
  const ease = (x) => x * x * (3 - 2 * x);

  /** Loads the plates (anidoodle films) a spec uses; await it before initShort / the first frame. */
  window.preparePlates = (spec) => window.PaintedPlates.prepare((spec.beats || []).filter((b) => b.shot.place === "plate").map((b) => b.shot.plate));
  window.initShort = function (spec) {
    S = spec; const { W, H } = S; u = H / 1920;
    flat = document.createElement("canvas"); flat.width = W; flat.height = H; fg = flat.getContext("2d");
    avg = document.createElement("canvas"); avg.width = 1; avg.height = 1;
    FH = H + Math.ceil(FRAME_MAX * H) + 2;                                  // the scene is drawn on a taller canvas: lifting the picture uncovers real scenery, not a stretch
    scene = document.createElement("canvas"); scene.width = W; scene.height = FH; sg = scene.getContext("2d");
    glc = document.createElement("canvas"); glc.width = W; glc.height = H; painter = window.PaintedPaint.Painter(glc);
    out = document.getElementById("out"); out.width = W; out.height = H; og = out.getContext("2d");
    return { renderer: painter.renderer };
  };

  /** Switches how the doodle films draw themselves while the film is open (the player's "continuous scene" checkbox): "opening" | "each" | "all" | "none". */
  window.setDrawIn = (mode) => { if (S) S.drawIn = mode; };

  /** The camera: a slow move about the frame centre. */
  function camera(g, move, p, amount) {
    const { W, H } = S, a = amount ?? 1, e = ease(Math.min(1, Math.max(0, p)));
    let s = 1, x = 0, y = 0;
    switch (move) {
      case "push": s = 1 + 0.08 * a * e; break;
      case "pull": s = 1 + 0.08 * a * (1 - e); break;
      case "pan-left": s = 1.12; x = W * 0.05 * a * (1 - 2 * e); break;
      case "pan-right": s = 1.12; x = -W * 0.05 * a * (1 - 2 * e); break;
      case "rise": s = 1.1; y = H * 0.04 * a * (1 - 2 * e); break;
      case "fall": s = 1.1; y = -H * 0.04 * a * (1 - 2 * e); break;
      case "drift": s = 1.05; x = W * 0.015 * a * Math.sin(p * 2.2); y = H * 0.008 * a * Math.cos(p * 1.7); break;
      default: s = 1;
    }
    g.setTransform(s, 0, 0, s, W / 2 - (W / 2) * s + x, H / 2 - (H / 2) * s + y);
  }

  function beatAt(t) { const b = S.beats; for (let i = 0; i < b.length; i++) if (t < b[i].t1) return i; return b.length - 1; }

  /**
   * Framing: scenes are drawn with the ground low in the picture, which leaves the action at the bottom (under a phone's buttons) and the top half empty.
   * Every shot is re-framed so the complete object group sits near the centre of the frame: the picture is moved up by as much as the
   * group needs (up to FRAME_MAX, so even a tiny figure in a wide landscape is lifted off the bottom) without cutting off tall objects or stretching the ground.
   */
  const FRAME_MAX = 0.27;
  function drawBeat(i, t) {
    const { W, H } = S, b = S.beats[i], p = Math.min(1, Math.max(0, (t - b.t0) / (b.t1 - b.t0)));
    const setup = () => {
      sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = "source-over"; sg.clearRect(0, 0, W, FH);
      camera(sg, b.move, p, b.moveAmount);
      if (["storm", "blizzard", "sandstorm"].includes(b.shot.weather)) sg.translate(Math.sin(t * 37) * W * 0.004 + Math.sin(t * 23) * W * 0.003, Math.sin(t * 41) * H * 0.003);   // the camera is being thrown about too
      window.PaintedScenes.actionBands = [];
    };
    setup(); const camT = sg.getTransform();
    if (b.shot.place === "plate") return drawPlateBeat(b, p, t);
    const k = window.PaintedKit.make(sg, W, H, t - b.t0, p, window.PaintedKit.hashStr(b.id + (b.seed ?? "")), FH);
    const paint = (shot) => {
      if (S.style === "doodle") {                                                    // the same shot, drawn as an animated doodle: paper first, no brush pass
        const prev = S.beats[i - 1], same = (a, c) => a && ["place", "time", "weather", "season", "room"].every((f) => (a[f] ?? null) === (c[f] ?? null));
        const cur = sg.getTransform(); window.DoodleScenes.medium = S.doodle || "marker"; window.DoodleScenes.drawIn = S.drawIn || "opening"; sg.setTransform(1, 0, 0, 1, 0, 0); sg.fillStyle = window.DoodleScenes.paper(S.doodle); sg.fillRect(0, 0, W, FH); sg.setTransform(cur);
        window.DoodleScenes.draw(k, { ...shot, flashes: b.flashes, first: i === 0, continues: same(prev && prev.shot, shot) });
      } else window.PaintedScenes.draw(k, { ...shot, flashes: b.flashes });
    };
    // A shot that cannot be drawn as written is drawn simpler, never a failed film: first without the links between things (on, tether, detail camera), then without the made-up objects, then as the place alone.
    const simpler = [
      (sh) => ({ ...sh, detailOf: undefined, portraitOf: undefined, subjects: (sh.subjects || []).map((x) => ({ ...x, on: undefined })), props: (sh.props || []).map((x) => ({ ...x, on: undefined, tether: undefined })) }),
      (sh) => ({ ...sh, detailOf: undefined, portraitOf: undefined, subjects: (sh.subjects || []).map((x) => ({ ...x, on: undefined })), props: (sh.props || []).filter((x) => x.kind !== "custom").map((x) => ({ ...x, on: undefined, tether: undefined })) }),
      (sh) => ({ ...sh, detailOf: undefined, portraitOf: undefined, subjects: [], props: [] }),
    ];
    try { paint(b.shot); }
    catch (e0) {
      let ok = false, shot = b.shot;
      for (const [n, make] of simpler.entries()) {
        shot = make(shot); setup();
        try { paint(shot); ok = true; const msg = `shot ${b.id}: ${e0.message}; drawn simpler (step ${n + 1})`; const ws = (window.PaintedWarnings ||= []); if (!ws.includes(msg)) ws.push(msg); break; } catch { /* the next, simpler version */ }
      }
      if (!ok) throw new Error("shot " + b.id + ": " + e0.message, { cause: e0 });
    }
    const sceneTransform = sg.getTransform();
    window.PaintedScenes.actionBands = (window.PaintedScenes.actionBands || []).map(b => b.map(y => y * sceneTransform.d + sceneTransform.f / H));
    sg.setTransform(1, 0, 0, 1, 0, 0);
    S.dyFrac = (b.shot.detailOf || b.shot.portraitOf) ? 0 : window.PaintedLayout.frameLift(window.PaintedScenes.frameBounds, sceneTransform.d, sceneTransform.f / H);
    window.PaintedScenes.heads = (window.PaintedScenes.heads || []).map(band => band.map(y => y * sceneTransform.d + sceneTransform.f / H));
    const dy = Math.round(S.dyFrac * H);
    fg.setTransform(1, 0, 0, 1, 0, 0);
    // anything the shot left unpainted below the frame gets the colour of the frame's bottom edge (a flat colour: never a stretch, never a reflection)
    { const ext = FH - H; sg.save(); sg.globalCompositeOperation = "destination-over"; const px = (avg.getContext("2d").drawImage(scene, 0, H - 6, W, 6, 0, 0, 1, 1), avg.getContext("2d").getImageData(0, 0, 1, 1).data); sg.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`; sg.fillRect(0, H - 1, W, ext + 1); sg.restore(); }
    fg.fillStyle = "#000"; fg.fillRect(0, 0, W, H); fg.drawImage(scene, 0, dy, W, H, 0, 0, W, H);
  }

  /** A plate shot: the anidoodle film frame for this moment fills the picture (the camera move still applies); nothing is lifted, no faces for the captions to dodge. */
  function drawPlateBeat(b, p, t) {
    const { W, H } = S, tr = sg.getTransform();
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, W, FH); sg.setTransform(tr);
    window.PaintedPlates.draw(sg, W, H, FH, b.shot, p, b.t1 - b.t0);
    sg.setTransform(1, 0, 0, 1, 0, 0);
    window.PaintedScenes.heads = []; window.PaintedScenes.foci = []; window.PaintedScenes.frameBounds = null; window.PaintedScenes.jarState = null; window.PaintedScenes.actionBands = []; S.dyFrac = 0;
    fg.setTransform(1, 0, 0, 1, 0, 0); fg.fillStyle = "#000"; fg.fillRect(0, 0, W, H); fg.drawImage(scene, 0, 0, W, H, 0, 0, W, H);
  }
  /** Whether the painter's brush pass runs over this beat: a plate keeps its own drawing (plateLook "plate", the default) or takes one of the engine's looks. */
  const lookOf = (b) => (S.style === "doodle" ? null : b.shot.place === "plate" ? (b.shot.plateLook && b.shot.plateLook !== "plate" ? b.shot.plateLook : null) : S.look);

  function captionAt(t) { for (const c of S.captions || []) if (t >= c.t0 && t < c.t1) return c; return null; }

  /**
   * Where the caption sits. Phones cover the top of the picture (about 14%) and the bottom (about 22%: caption, buttons, account name) with their own
   * interface, so captions live in the band between, lower-middle first. Within it the caption moves off faces first, then off faces and bodies;
   * it never goes up into the dead space or down into the interface.
   */
  const CAPTION_ROWS = [0.68, 0.74, 0.6, 0.52, 0.44];
  function captionRow(heightFrac) {
    const heads = (window.PaintedScenes && window.PaintedScenes.heads) || [], half = heightFrac / 2 + 0.02, first = S.captionY ?? CAPTION_ROWS[0];
    const rows = [first, ...CAPTION_ROWS.filter((y) => y !== first)];
    const actions = window.PaintedScenes.actionBands || [];
    const whole = (h) => [h[0], h[3] ?? h[1]];                                           // a person from the head to the feet
    for (const y of rows) if (![...heads.map(whole), ...actions].some(([a,b]) => y + half > a - (S.dyFrac || 0) && y - half < b - (S.dyFrac || 0))) return y;     // first: off every whole person
    for (const y of [...rows, .78, .36]) if (![...heads.map(h => [h[0], h[1]]), ...actions].some(([a,b]) => y + half > a - (S.dyFrac || 0) && y - half < b - (S.dyFrac || 0))) return y;
    for (const band of [(h) => [h[0], h[1]], (h) => [h[0], h[2]]])                        // faces and torsos, then faces alone
      for (const y of rows) if (!heads.some((h) => { const [a, b] = band(h); return y + half > a - (S.dyFrac || 0) && y - half < b - (S.dyFrac || 0); })) return y;
    return first;
  }

  function drawCaption(c) {
    if (!c || S.captionStyle === "none") return;
    const { W, H } = S, size = Math.round((S.captionSize ?? 0.022) * H), maxW = W * 0.84, pad = size * 0.38;
    og.font = `800 ${size}px "Liberation Sans", "Helvetica Neue", Arial, sans-serif`; og.textAlign = "center"; og.textBaseline = "middle";
    const words = c.text.split(" "), lines = []; let cur = "";
    for (const w of words) { const test = cur ? cur + " " + w : w; if (og.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur);
    const lh = size * 1.18, y0 = H * captionRow(lines.length * lh / H) - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, i) => {
      const w = og.measureText(ln).width, cy = y0 + i * lh;
      if (S.captionStyle !== "plain") { og.fillStyle = "rgba(14,14,20,0.62)"; const x = W / 2 - w / 2 - pad, y = cy - size * 0.62, rw = w + pad * 2, rh = size * 1.24, r = size * 0.22; og.beginPath(); og.moveTo(x + r, y); og.arcTo(x + rw, y, x + rw, y + rh, r); og.arcTo(x + rw, y + rh, x, y + rh, r); og.arcTo(x, y + rh, x, y, r); og.arcTo(x, y, x + rw, y, r); og.closePath(); og.fill(); }
      else { og.lineWidth = size * 0.16; og.strokeStyle = "rgba(0,0,0,0.7)"; og.strokeText(ln, W / 2, cy); }
      og.fillStyle = "#fff"; og.fillText(ln, W / 2, cy);
    });
  }

  /** Contact-sheet label: what the director asked for in this shot, on a strip above the picture. */
  function label(text) {
    const { W, H } = S, size = Math.max(10, Math.round(H * 0.017)), lines = text.split("\n");
    og.setTransform(1, 0, 0, 1, 0, 0); og.fillStyle = "rgba(0,0,0,0.78)"; og.fillRect(0, 0, W, size * 1.35 * lines.length + size * 0.4);
    og.fillStyle = "#fff"; og.font = `600 ${size}px "Liberation Sans", Arial, sans-serif`; og.textAlign = "left"; og.textBaseline = "top";
    lines.forEach((l, i) => og.fillText(l, size * 0.4, size * 0.3 + i * size * 1.35, W - size * 0.8));
  }

  /** Puts the painted frame (or `src`, the flat drawing for a draft) on the visible canvas with fades and captions. No encoding. */
  function compose(t, src) {
    const { W, H } = S;
    og.setTransform(1, 0, 0, 1, 0, 0); og.drawImage(src, 0, 0);
    const b = S.beats[beatAt(t)];
    if (b.fadeIn && t - b.t0 < b.fadeIn) { og.fillStyle = "rgba(0,0,0," + (1 - (t - b.t0) / b.fadeIn) + ")"; og.fillRect(0, 0, W, H); }
    if (b.fadeOut && b.t1 - t < b.fadeOut) { const a = (1 - (b.t1 - t) / b.fadeOut) * (S.style === "doodle" ? 0.35 : 1); og.fillStyle = `rgba(18,14,12,${a})`; og.fillRect(0, 0, W, H); }
    drawCaption(captionAt(t));
  }
  function finish(t, d, painted = true) { compose(t, painted ? glc : flat); return out.toDataURL("image/jpeg", S.jpegQuality ?? 0.92); }

  /** Live player: the frame for time t (seconds) straight onto the canvas. `draft` skips the paint pass (flat drawing, much faster). Returns the drawing number. */
  window.playerFrame = function (t, draft) {
    t = Math.min(Math.max(0, t), S.duration - 1e-3);
    const d = Math.floor((t * S.fps) / S.twos), tq = Math.min((d * S.twos) / S.fps + 1 / (2 * S.fps), S.duration - 1e-3);
    const b = S.beats[beatAt(tq)], look = lookOf(b); drawBeat(beatAt(tq), tq);
    if (!draft && look) painter.paint(flat, look, d);
    compose(tq, draft || !look ? flat : glc);
    return d;
  };

  window.drawing = function (d) {
    const t = Math.min((d * S.twos) / S.fps + 1 / (2 * S.fps), S.duration - 1e-3), i = beatAt(t);
    const look = lookOf(S.beats[i]); drawBeat(i, t); if (look) painter.paint(flat, look, d); return finish(t, d, !!look);
  };
  window.still = function (i, at, text) {
    const b = S.beats[i], t = b.t0 + (b.t1 - b.t0) * at; const look = lookOf(b); drawBeat(i, t); if (look) painter.paint(flat, look, Math.round(t * S.fps / S.twos));
    const data = finish(t, 0, !!look);
    if (!text) return data;
    label(text + (window.PaintedScenes.jarState ? "\njar: " + window.PaintedScenes.jarState : "")); return out.toDataURL("image/jpeg", 0.9);
  };
})();
