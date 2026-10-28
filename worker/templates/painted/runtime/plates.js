/*
 * Plates: a shot whose picture is an anidoodle film (hand-drawn doodle animation, plain Canvas 2D) instead of a painted scene.
 *   shot = { place: "plate", plate: "<film>", fit: "cover" | "contain", focus: [x, y], from?: frame, to?: frame, loop?: true, plateLook?: "plate" | <engine look> }
 * Each film page (dist/<film>.html?adapter=1) lives in a hidden same-origin iframe and exposes window.FILM: ready (promise), mount(), seek(frame)
 * (synchronous), meta {W, H, fps, frames}. The shot's progress (0..1) maps onto frames from..to; the frame's canvas is drawn into the scene fitted to the picture.
 * The maths (plateFrame, fitRect) is pure and shared with the Node tests; the loader runs in the page only.
 */
(function () {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** The film frame shown at shot progress p (0..1): from..to spread over the shot, held on the last frame; with `loop` the range repeats at the film's own speed. */
  function plateFrame(p, meta, shot = {}) {
    const last = Math.max(0, (meta.frames ?? 1) - 1);
    const from = clamp(Math.round(shot.from ?? 0), 0, last), to = clamp(Math.round(shot.to ?? last), 0, last);
    const q = clamp(Number.isFinite(p) ? p : 0, 0, 1);
    if (shot.loop && shot.seconds > 0) {                                                       // seconds = the shot's length, so a loop runs at the film's fps
      const n = Math.abs(to - from) + 1, f = Math.floor(q * shot.seconds * (meta.fps || 30)) % n;
      return from <= to ? from + f : from - f;
    }
    return Math.round(from + (to - from) * q);
  }

  /** Where a plate (sw x sh) goes in a picture (dw x dh). cover: the plate fills the picture, cropped around `focus` (0..1 of the plate). contain: the whole plate, centred. */
  function fitRect(sw, sh, dw, dh, mode = "cover", focus = [0.5, 0.5]) {
    const at = (i) => (Array.isArray(focus) && Number.isFinite(focus[i]) ? clamp(focus[i], 0, 1) : 0.5), fx = at(0), fy = at(1);
    if (mode === "contain") {
      const s = Math.min(dw / sw, dh / sh), w = sw * s, h = sh * s;
      return { sx: 0, sy: 0, sw, sh, dx: (dw - w) / 2, dy: (dh - h) / 2, dw: w, dh: h };
    }
    const s = Math.max(dw / sw, dh / sh), cw = dw / s, ch = dh / s;                              // the part of the plate that fills the picture
    return { sx: clamp(fx * sw - cw / 2, 0, sw - cw), sy: clamp(fy * sh - ch / 2, 0, sh - ch), sw: cw, sh: ch, dx: 0, dy: 0, dw, dh };
  }

  /** A film's own FILM.meta (durationFrames, W, H, fps) as the plate maths wants it. A film without a frame count counts as one still. */
  const metaOf = (m = {}) => ({ W: m.W, H: m.H, fps: m.fps || 30, frames: Math.max(1, Math.round(m.durationFrames ?? m.frames ?? 1)), title: m.title });

  globalThis.PaintedPlates = { plateFrame, fitRect, metaOf };
  if (typeof document === "undefined") return;

  const loaded = new Map();                                                                     // name -> { FILM, canvas, meta, last, bar }
  const BASE = "/plates/";

  /** Loads each distinct plate once (hidden same-origin iframe) and waits until it can be driven frame by frame. Call before initShort / the first frame. */
  globalThis.PaintedPlates.prepare = async function (names, base = BASE) {
    await Promise.all([...new Set(names)].filter((n) => !loaded.has(n)).map((name) => {
      const job = (async () => {
        const f = document.createElement("iframe"); f.style.cssText = "position:fixed;left:-99999px;top:0;width:1080px;height:1080px;border:0;visibility:hidden"; f.setAttribute("aria-hidden", "true");
        document.body.appendChild(f);
        await new Promise((res, rej) => { f.onload = res; f.onerror = () => rej(new Error("plate page failed: " + name)); f.src = `${base}${encodeURIComponent(name)}.html?adapter=1`; });
        const FILM = f.contentWindow.FILM; if (!FILM) throw new Error(`plate "${name}": the page has no window.FILM`);
        await FILM.ready; FILM.mount();
        const canvas = f.contentDocument.querySelector("canvas"); if (!canvas) throw new Error(`plate "${name}": no canvas`);
        return { FILM, canvas, meta: globalThis.PaintedPlates.metaOf(FILM.meta), last: -1, bar: null };
      })();
      loaded.set(name, job);
      return job.then((v) => loaded.set(name, v), (e) => { loaded.delete(name); throw e; });
    }));
  };

  /** The colour of a plate's border (from the first frame drawn: the paper of a draw-in film), for the bars of a "contain" fit. */
  function barColour(g, canvas) {
    const t = document.createElement("canvas"); t.width = 1; t.height = 1; const c = t.getContext("2d"); c.drawImage(canvas, 0, 0, canvas.width, 6, 0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`;
  }

  /** Draws the shot's plate onto g (the scene canvas, W x FH): the picture fills 0..H, the rest is the bar colour. */
  globalThis.PaintedPlates.draw = function (g, W, H, FH, shot, p, seconds) {
    const pl = loaded.get(shot.plate); if (!pl || pl instanceof Promise) throw new Error(`plate "${shot.plate}" was not prepared`);
    const n = plateFrame(p, pl.meta, { ...shot, seconds });
    if (n !== pl.last) { pl.FILM.seek(n); pl.last = n; }
    if (!pl.bar) pl.bar = barColour(g, pl.canvas);
    const r = fitRect(pl.canvas.width, pl.canvas.height, W, H, shot.fit, shot.focus);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = pl.bar; g.fillRect(0, 0, W, FH); g.restore();
    g.drawImage(pl.canvas, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    return n;
  };
})();
