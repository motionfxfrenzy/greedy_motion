// THE ONE GENERATED PAGE. Playwright, the HTML player and (Phase 5) Hyperframes all drive this
// same page through window.FILM. Everything host-specific (DOM, clocks, asset decoding, Web
// Audio) lives HERE; the art core never sees it.
import {
  DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME,
  DRAFT_PROFILE_VERSION,
  beginFrameGeometryStats,
  getFrameGeometryStats,
  getRenderQuality,
  normalizeRenderQuality,
  renderQualityKey,
  withPenCalibrationPass,
  withRenderQuality,
  type Ctx,
  type Env,
  type FrameGeometryStats,
  type Layer,
  type PenRetraceMode,
  type ProbeRec,
  type RenderQualityMode,
  type RenderQualitySpec,
  type ScenePenCalibration
} from "../canvas-core/core";
import { Film, renderFrame, validate } from "../canvas-core/film";
import { embeddedAudio, type AudioPayload } from './audio';

declare global { interface Window { FILM: unknown; __ASSETS__?: Record<string, string>; __BAKE_SRC__?: Record<string, string>; __ANIDOODLE_SRC__?: WeakMap<object, string>; __SHAPE__?: string; __AUDIO__?: AudioPayload } }

const MAX_ENV_CACHES = 4;

// THE BAKE STORE (Env.bake).
const bakeStore = (surface: (w: number, h: number) => Layer) => {
  const loaded = new Map<string, ImageBitmap>(), fresh = new Map<string, Layer>(), stats = { hits: 0, misses: 0, kept: 0, skipped: 0 };
  let on = false;
  const keyOf = (film: object, frame: number, w: number, h: number) => { const mod = window.__ANIDOODLE_SRC__?.get(film), hash = mod ? window.__BAKE_SRC__?.[mod] : undefined; return hash ? `${hash}.${frame}.${w}x${h}` : null; };
  const bake: NonNullable<Env["bake"]> = {
    get: (film, frame, w, h) => { if (!on || getRenderQuality().mode !== "full") return undefined; const k = keyOf(film, frame, w, h), img = k ? loaded.get(k) : undefined; if (img) stats.hits++; else stats.misses++; return img; },
    put: (film, frame, layer) => {
      if (!on || getRenderQuality().mode !== "full") return;
      const { width: w, height: h } = layer.canvas, k = keyOf(film, frame, w, h); if (!k || loaded.has(k) || fresh.has(k)) return;
      const d = layer.ctx.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { stats.skipped++; return; }
      const c = surface(w, h); c.ctx.drawImage(layer.canvas, 0, 0); fresh.set(k, c); stats.kept++;
    },
  };
  const load = async (entries: Record<string, string>) => { on = true; await Promise.all(Object.entries(entries).map(async ([k, b64]) => { try { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); const img = await createImageBitmap(new Blob([u8], { type: "image/png" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" }); if (`${img.width}x${img.height}` === k.split(".").pop()) loaded.set(k, img); } catch { /* unreadable: draw it cold */ } })); return loaded.size; };
  const png64 = async (c: Layer["canvas"]) => { const blob = "convertToBlob" in c ? await (c as OffscreenCanvas).convertToBlob({ type: "image/png" }) : await new Promise<Blob>((ok) => (c as HTMLCanvasElement).toBlob((b) => ok(b!), "image/png")); const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const take = async () => { const out: Record<string, string> = {}; for (const [k, c] of fresh) out[k] = await png64(c.canvas); fresh.clear(); return out; };
  const hashes = () => [...new Set(Object.values(window.__BAKE_SRC__ ?? {}))];
  return { bake, load, take, hashes, stats };
};

export const mountFilm = (film: Film) => {
  if (window.__SHAPE__) { if (!film.reshape) throw new Error(`${film.meta.title} has one shape; ${window.__SHAPE__} is for launch template films (film.reshape)`); film = film.reshape(window.__SHAPE__); }
  const filmSound = window.__AUDIO__ ? embeddedAudio(window.__AUDIO__) : film.audio;
  const canvas = document.getElementById("film") as HTMLCanvasElement, images = new Map<string, CanvasImageSource>();
  let env: Env, ctx: Ctx, current = 0, currentScale = 1;
  let envCaches = new Map<string, Map<string, unknown>>();
  let penCalibrations = new Map<string, ScenePenCalibration>();
  let basePenScan: {
    peakPenCalls: number;
    peakFullVertices: number;
    peakBaseDraftVertices: number;
    peakArcLen: number;
    scanMs: number;
  } | null = null;
  let lastStats: FrameGeometryStats | null = null;
  const opts = film.meta.raster === "cpu" ? { willReadFrequently: true } : undefined;
  const surface = (w: number, h: number): Layer => { const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }); return { canvas: c, ctx: c.getContext("2d", opts) as unknown as Ctx } as Layer; };
  const bakes = bakeStore(surface);

  const noopGrad = { addColorStop() {} };
  const noopImgData = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  const noopFn = () => noopGrad;
  const makeNoopCtx = (): Ctx =>
    new Proxy(
      {
        fillStyle: "#000",
        strokeStyle: "#000",
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 10,
        lineDashOffset: 0,
        font: "10px sans-serif",
        textAlign: "start",
        textBaseline: "alphabetic",
        direction: "inherit",
        shadowBlur: 0,
        shadowColor: "rgba(0,0,0,0)",
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "low",
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        measureText: (t: string) => ({
          width: String(t ?? "").length * 8,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 3
        }),
        createImageData: () => noopImgData,
        getImageData: () => noopImgData,
        isPointInPath: () => false,
        isPointInStroke: () => false,
        getLineDash: () => []
      },
      {
        get(target, prop) {
          return prop in target ? (target as Record<string | symbol, unknown>)[prop] : noopFn;
        },
        set(target, prop, value) {
          (target as Record<string | symbol, unknown>)[prop] = value;
          return true;
        }
      }
    ) as unknown as Ctx;

  const calibrateScenePenBudget = (q: Readonly<RenderQualitySpec>, qKey: string): ScenePenCalibration => {
    const t0 = performance.now();
    const dur = Math.max(1, film.meta.durationFrames);
    const repFrames = [...new Set([0, Math.floor((dur - 1) / 2), dur - 1])];

    if (!basePenScan) {
      const tScan0 = performance.now();
      const noopCtx = makeNoopCtx();
      const noopSurface = (w: number, h: number): Layer => ({
        canvas: { width: w, height: h } as unknown as Layer["canvas"],
        ctx: noopCtx
      });
      const calEnv: Env = {
        W: film.meta.W,
        H: film.meta.H,
        scale: currentScale,
        cache: new Map(),
        quality: q,
        canvas: noopSurface,
        image: (n) => images.get(n),
        root: false
      };
      let peakPenCalls = 0;
      let peakFullVertices = 0;
      let peakBaseDraftVertices = 0;
      let peakArcLen = 0;

      withPenCalibrationPass(() => {
        for (let idx = 0; idx < repFrames.length; idx++) {
          const rf = repFrames[idx];
          const st = beginFrameGeometryStats(rf, q);
          renderFrame(film, noopCtx, rf, calEnv);
          if (st.penRibbonVertices > peakFullVertices) {
            peakFullVertices = st.penRibbonVertices;
          }
          if (st.baseDraftPenVertices > peakBaseDraftVertices) {
            peakBaseDraftVertices = st.baseDraftPenVertices;
          }
          if (st.penCalls > peakPenCalls) {
            peakPenCalls = st.penCalls;
          }
          // If the first two representative frames made zero Gfx.pen calls, the scene does not use Gfx.pen
          if (idx === 1 && peakPenCalls === 0) {
            break;
          }
        }
      });

      basePenScan = {
        peakPenCalls,
        peakFullVertices,
        peakBaseDraftVertices,
        peakArcLen,
        scanMs: performance.now() - tScan0
      };
    }

    const { peakPenCalls, peakFullVertices, peakBaseDraftVertices, peakArcLen } = basePenScan;

    const targetB = q.draftTargetVerticesPerFrame;
    let effRetraceMode: PenRetraceMode = q.penRetraceMode;
    let minClosed = q.minStrokeCenterPts > 0 ? q.minStrokeCenterPts : 8;
    let minOpen = q.minStrokeCenterPts > 0 ? Math.min(q.minStrokeCenterPts, 4) : 4;
    let floorDegraded = false;
    let budgetExceededByFloor = false;

    if (targetB > 0 && peakPenCalls > 0) {
      const multFor = (rm: PenRetraceMode) => (rm === "skip" ? 2 : rm === "simplified" ? 3 : 4);
      let mult = multFor(effRetraceMode);
      if (peakBaseDraftVertices > targetB && peakPenCalls * minClosed * mult > targetB * 0.85) {
        floorDegraded = true;
        if (effRetraceMode !== "skip") {
          effRetraceMode = "skip";
          mult = 2;
        }
        if (peakPenCalls * minClosed * mult > targetB * 0.85) {
          minClosed = Math.max(3, Math.floor(targetB / Math.max(1, peakPenCalls * mult)));
          minOpen = Math.max(2, Math.min(4, minClosed));
        }
        if (peakPenCalls * 4 > targetB) {
          budgetExceededByFloor = true;
        }
      }
    }

    const effectiveScaleRatio =
      targetB > 0 && peakFullVertices > 0 ? Math.min(1, targetB / peakFullVertices) : 1;
    const baseDraftScaleRatio =
      targetB > 0 && peakBaseDraftVertices > 0 ? Math.min(1, targetB / peakBaseDraftVertices) : 1;

    return {
      qualityKey: qKey,
      representativeFrames: repFrames,
      peakPenCalls,
      peakFullVertices,
      peakBaseDraftVertices,
      peakArcLen,
      draftTargetVerticesPerFrame: targetB,
      targetFramePenVertices: targetB,
      effectiveScaleRatio,
      baseDraftScaleRatio,
      effectiveMinCenterPtsClosed: minClosed,
      effectiveMinCenterPtsOpen: minOpen,
      effectiveRetraceMode: effRetraceMode,
      floorDegraded,
      budgetExceededByFloor,
      calibrationMs: performance.now() - t0,
      adaptiveScale: 1,
      adaptiveCooldownFrames: 0,
      adaptiveSwitches: 0
    };
  };

  const pruneEnvCaches = (keepKey: string) => {
    const fullKey = `${currentScale}:full:1`;
    while (envCaches.size > MAX_ENV_CACHES) {
      let victim: string | null = null;
      for (const k of envCaches.keys()) {
        if (k !== keepKey && k !== fullKey) {
          victim = k;
          break;
        }
      }
      if (!victim) break;
      envCaches.get(victim)?.clear();
      envCaches.delete(victim);
      penCalibrations.delete(victim);
    }
  };

  const envForQuality = (spec?: Partial<RenderQualitySpec> | RenderQualityMode | number | null): Env => {
    const q = normalizeRenderQuality(spec);
    const qKey = `${currentScale}:${renderQualityKey(q)}`;
    let cache = envCaches.get(qKey);
    if (!cache) {
      cache = new Map();
      envCaches.set(qKey, cache);
      pruneEnvCaches(qKey);
    }
    let penCalibration = penCalibrations.get(qKey);
    if (!penCalibration && q.mode === "draft" && (q.draftTargetVerticesPerFrame > 0 || q.budgetPolicy !== "off" || q.minStrokeCenterPts > 0)) {
      penCalibration = calibrateScenePenBudget(q, qKey);
      penCalibrations.set(qKey, penCalibration);
    }
    return {
      W: film.meta.W,
      H: film.meta.H,
      scale: currentScale,
      cache,
      quality: q,
      penCalibration,
      canvas: surface,
      image: (n) => images.get(n),
      bake: q.mode === "full" ? bakes.bake : undefined,
      root: true
    };
  };

  const mount = (scale = 1) => {
    currentScale = scale;
    canvas.width = Math.round(film.meta.W * scale);
    canvas.height = Math.round(film.meta.H * scale);
    ctx = canvas.getContext("2d", opts) as CanvasRenderingContext2D;
    envCaches = new Map();
    penCalibrations = new Map();
    basePenScan = null;
    env = envForQuality("full");
    return film.meta;
  };

  const ready = (async () => {
    const problems = validate(film); if (problems.length) throw new Error("timeline: " + problems.join("; "));
    await Promise.all(Object.entries(film.assets.images).map(async ([name, url]) => { const img = new Image(); img.src = window.__ASSETS__?.[name] ?? url; await img.decode(); images.set(name, img); }));
    mount(1); return film.meta;
  })();

  const seek = (frame: number, quality?: Partial<RenderQualitySpec> | RenderQualityMode | number | null) =>
    withRenderQuality(quality, (q) => {
      const t0 = performance.now();
      const qEnv = q.mode === "full" && !q.skipReadbackFlush ? env : envForQuality(q);
      const st = beginFrameGeometryStats(frame, q);
      const shot = renderFrame(film, ctx, frame, qEnv);
      const tAfterJs = performance.now();
      if (!q.skipReadbackFlush) {
        ctx.getImageData(0, 0, 1, 1);
      }
      const tEnd = performance.now();
      st.jsRenderFrameMs = Math.round((tAfterJs - t0) * 1000) / 1000;
      st.getImageDataFlushMs = Math.round((tEnd - tAfterJs) * 1000) / 1000;
      st.totalSeekMs = Math.round((tEnd - t0) * 1000) / 1000;
      const cal = qEnv.penCalibration;
      if (cal && q.budgetPolicy === "adaptive-hysteresis") {
        if (cal.adaptiveCooldownFrames > 0) {
          cal.adaptiveCooldownFrames--;
        } else if (st.totalSeekMs > 28 && cal.adaptiveScale > 0.35) {
          cal.adaptiveScale = Math.max(0.35, Math.round(cal.adaptiveScale * 0.65 * 1000) / 1000);
          cal.adaptiveCooldownFrames = 30;
          cal.adaptiveSwitches++;
        } else if (st.totalSeekMs < 14 && cal.adaptiveScale < 1) {
          cal.adaptiveScale = Math.min(1, Math.round(cal.adaptiveScale * 1.25 * 1000) / 1000);
          cal.adaptiveCooldownFrames = 30;
          cal.adaptiveSwitches++;
        }
        st.adaptiveSwitches = cal.adaptiveSwitches;
      }
      lastStats = { ...st };
      current = frame;
      return {
        shot,
        ms: tEnd - t0,
        quality: q.mode,
        qualityKey: renderQualityKey(q),
        profileVersion: q.profileVersion,
        draftTargetVerticesPerFrame: q.draftTargetVerticesPerFrame,
        hatchFactor: q.hatchFactor,
        stats: lastStats
      };
    });

  const hash = () => { const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
  const b64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const s = i / 255; toLin[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
  const fromLin = (l: number) => { const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };

  type BlurSpec = { samples?: number; shutter?: number; max?: number; px?: number };
  const lumaGrid = (f: number, cell: number) => {
    renderFrame(film, ctx, f, env); const w = canvas.width, h = canvas.height, d = ctx.getImageData(0, 0, w, h).data, gw = Math.floor(w / cell), gh = Math.floor(h / cell), g = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0; for (let yy = 0; yy < cell; yy += 2) for (let xx = 0; xx < cell; xx += 2) { const p = ((y * cell + yy) * w + x * cell + xx) * 4, a = d[p + 3] / 255; s += (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) * a; } g[y * gw + x] = s / ((cell * cell) / 4); }
    return { g, gw, gh };
  };
  const speedOf = (t0: number, t1: number) => {
    const cell = 8, B = 8, R = 16, A = lumaGrid(t0, cell), Z = lumaGrid(t1, cell), { gw, gh } = A, vec = new Map<number, [number, number]>();
    const cols = Math.floor((gw - 2 * R - B) / B) + 1;
    for (let by = R, row = 0; by + B + R <= gh; by += B, row++) for (let bx = R, col = 0; bx + B + R <= gw; bx += B, col++) {
      let mean = 0, v = 0; for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) mean += A.g[(by + y) * gw + bx + x]; mean /= B * B;
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) v += (A.g[(by + y) * gw + bx + x] - mean) ** 2;
      if (v / (B * B) < 12) continue;
      const sadAt = (dx: number, dy: number) => { let sad = 0; for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) sad += Math.abs(A.g[(by + y) * gw + bx + x] - Z.g[(by + y + dy) * gw + bx + x + dx]); return sad; };
      const cost = new Float64Array((2 * R + 1) ** 2); let best = Infinity;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const c = sadAt(dx, dy); cost[(dy + R) * (2 * R + 1) + dx + R] = c; if (c < best) best = c; }
      if (best / (B * B) > 4) continue;
      let mx = 0, my = 0, md = Infinity;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const c = cost[(dy + R) * (2 * R + 1) + dx + R], d = Math.hypot(dx, dy); if (c <= best * 1.1 + B * B * 0.5 && d < md) { md = d; mx = dx; my = dy; } }
      const at = (dx: number, dy: number) => (Math.abs(dx) <= R && Math.abs(dy) <= R ? cost[(dy + R) * (2 * R + 1) + dx + R] : Infinity), c0 = at(mx, my);
      const sub = (m: number, c: number, p: number) => { const d = m - 2 * c + p; return Number.isFinite(d) && d > 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / d)) : 0; };
      vec.set(row * cols + col, [mx + (mx || my ? sub(at(mx - 1, my), c0, at(mx + 1, my)) : 0), my + (mx || my ? sub(at(mx, my - 1), c0, at(mx, my + 1)) : 0)]);
    }
    const disp: number[] = [];
    for (const [key, [x, y]] of vec) { const r = Math.floor(key / cols), c = key % cols; let agree = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const nb = vec.get((r + dr) * cols + c + dc); if (nb && c + dc >= 0 && c + dc < cols && Math.hypot(nb[0] - x, nb[1] - y) <= 1.5) agree++; } if (agree >= 2) disp.push((Math.hypot(x, y) * cell) / env.scale); }
    if (!disp.length) return 0;
    disp.sort((a, b) => a - b); return disp[Math.min(disp.length - 1, Math.floor(disp.length * 0.98))];
  };
  const blur = (frame: number, spec: number | BlurSpec) => {
    const o: BlurSpec = typeof spec === "number" ? { samples: spec, shutter: 360 } : spec, sh = (o.shutter ?? 180) / 360;
    const n = Math.max(0, Math.min(film.meta.durationFrames - 1, Math.round(frame))), shot = film.shots.find((s) => n >= s.start && n < s.end);
    const stepped = (film.meta.step ?? (film.meta.onTwos ? 2 : 1)) > 1, win = (t: number) => Math.min(shot!.end - 1, Math.max(shot!.start, t));
    let samples = o.samples ?? 0, speed = NaN;
    if (shot && !stepped && samples === 0) { speed = speedOf(win(n - sh / 2), win(n + sh / 2)); samples = Math.max(1, Math.min(o.max ?? 32, Math.ceil(speed / (o.px ?? 3)))); }
    if (!shot || samples < 2 || stepped) { const r = seek(n); return { shot: r.shot, ms: r.ms, samples: 1, speed }; }
    const t0 = performance.now(), w = canvas.width, h = canvas.height, acc = new Float64Array(w * h * 4);
    for (let i = 0; i < samples; i++) {
      const t = win(n + ((i + 0.5) / samples - 0.5) * sh);
      renderFrame(film, ctx, t, env);
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let p = 0; p < d.length; p += 4) { const a = d[p + 3], k = a / 255; acc[p] += toLin[d[p]] * k; acc[p + 1] += toLin[d[p + 1]] * k; acc[p + 2] += toLin[d[p + 2]] * k; acc[p + 3] += a; }
    }
    const img = ctx.createImageData(w, h), out = img.data, inv = 1 / samples, full = 255 * samples;
    for (let p = 0; p < out.length; p += 4) {
      const A = acc[p + 3]; if (A === 0) continue;
      const c = A === full ? inv : 255 / A;
      out[p] = fromLin(acc[p] * c); out[p + 1] = fromLin(acc[p + 1] * c); out[p + 2] = fromLin(acc[p + 2] * c); out[p + 3] = Math.round(A * inv);
    }
    ctx.putImageData(img, 0, 0); current = n;
    return { shot: shot.id, ms: performance.now() - t0, samples, speed };
  };

  const probe = (frames: number[]) => {
    const out: (ProbeRec & { frame: number })[] = [], g = globalThis as { __ANIDOODLE_PROBE__?: (r: ProbeRec) => void };
    const protos = [CanvasRenderingContext2D.prototype, ...(typeof OffscreenCanvasRenderingContext2D !== "undefined" ? [OffscreenCanvasRenderingContext2D.prototype] : [])] as unknown as { fillText: (t: string, x: number, y: number, w?: number) => void }[];
    const orig = protos.map((p) => p.fillText);
    let frame = 0, recs: ProbeRec[] = [];
    protos.forEach((p, i) => { p.fillText = function (this: Ctx & { __frame?: boolean }, t: string, x: number, y: number, w?: number) {
      if ((this === ctx || this.__frame) && this.globalAlpha >= 0.1 && String(t).trim()) {
        const m = this.measureText(t), a = this.textAlign, dx = a === "center" ? -m.width / 2 : a === "right" || a === "end" ? -m.width : 0, T = this.getTransform();
        const bx = [[x + dx, y - m.actualBoundingBoxAscent], [x + dx + m.width, y - m.actualBoundingBoxAscent], [x + dx, y + m.actualBoundingBoxDescent], [x + dx + m.width, y + m.actualBoundingBoxDescent]].map(([u, v]) => [T.a * u + T.c * v + T.e, T.b * u + T.d * v + T.f]);
        recs.push({ kind: "text", label: String(t), x0: Math.min(...bx.map((q) => q[0])), y0: Math.min(...bx.map((q) => q[1])), x1: Math.max(...bx.map((q) => q[0])), y1: Math.max(...bx.map((q) => q[1])) });
      }
      return (orig[i] as (t: string, x: number, y: number, w?: number) => void).call(this, t, x, y, w);
    }; });
    g.__ANIDOODLE_PROBE__ = (r) => recs.push(r);
    try {
      for (frame of frames) {
        recs = []; seek(frame); const W = canvas.width, H = canvas.height, tol = 1.5;
        for (const r of recs) { const inter = r.x1 > 0 && r.x0 < W && r.y1 > 0 && r.y0 < H, inside = r.x0 >= -tol && r.y0 >= -tol && r.x1 <= W + tol && r.y1 <= H + tol; if (inter && !inside) out.push({ ...r, frame }); }
      }
    } finally { protos.forEach((p, i) => (p.fillText = orig[i] as never)); delete g.__ANIDOODLE_PROBE__; }
    return out;
  };
  const audio = (sr: number) => { if (!filmSound) return null; const [L, R] = filmSound(sr); if (L.length !== R.length) throw new Error("audio channels have different lengths"); const pcm = new Float32Array(L.length * 2); for (let i = 0; i < L.length; i++) { pcm[i * 2] = L[i]; pcm[i * 2 + 1] = R[i]; } return { sampleRate: sr, frames: L.length, float32: b64(new Uint8Array(pcm.buffer)) }; };
  const warm = () => film.shots.forEach((s) => { seek(s.start); seek(s.start + ((s.end - s.start) >> 1)); });

  let posterOf: { key: string; img: CanvasImageSource } | null = null;
  const poster = (frame: number, posterFrame: number, fade: number, samples: number | BlurSpec = 1) => {
    const on = typeof samples === "number" ? samples > 1 : true;
    const n = Math.round(frame), u = fade > 0 ? 1 - n / fade : n === 0 ? 1 : 0, key = `${posterFrame}/${JSON.stringify(samples)}/${canvas.width}x${canvas.height}`;
    if (u > 0 && posterOf?.key !== key) {
      on ? blur(posterFrame, samples) : seek(posterFrame);
      const c = surface(canvas.width, canvas.height); c.ctx.drawImage(canvas, 0, 0); posterOf = { key, img: c.canvas };
    }
    const r = on ? blur(n, samples) : seek(n);
    if (u > 0 && posterOf) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, u); ctx.globalCompositeOperation = "source-over"; if (u >= 1) ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(posterOf.img, 0, 0); ctx.restore(); }
    current = n; return r;
  };

  const capabilities = Object.freeze({
    draftSupported: true,
    seekAcceptsQuality: true,
    draftGeometry: true,
    profileVersion: DRAFT_PROFILE_VERSION,
    defaultDraftTargetVerticesPerFrame: DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME
  });

  const getLastFrameStats = () => lastStats ?? getFrameGeometryStats();
  const getCalibration = (q?: Partial<RenderQualitySpec> | RenderQualityMode | number | null) =>
    penCalibrations.get(`${currentScale}:${renderQualityKey(q ?? "draft")}`) ??
    ([...penCalibrations.values()][0] ?? null);

  window.FILM = {
    probe,
    meta: { ...film.meta, hasAudio: typeof film.audio === "function", shots: film.shots.map(({ id, start, end }) => ({ id, start, end })) },
    capabilities,
    ready,
    mount,
    seek,
    hash,
    audio,
    warm,
    blur,
    poster,
    quality: () => getRenderQuality(),
    cacheSize: (q?: Partial<RenderQualitySpec> | RenderQualityMode | number | null) => envCaches.get(`${currentScale}:${renderQualityKey(q)}`)?.size ?? 0,
    envCacheCount: () => envCaches.size,
    clearDraftCaches: () => {
      const fullKey = `${currentScale}:full:1`;
      for (const [k, map] of [...envCaches.entries()]) {
        if (k !== fullKey) {
          map.clear();
          envCaches.delete(k);
          penCalibrations.delete(k);
        }
      }
    },
    lastFrameStats: getLastFrameStats,
    getLastFrameStats,
    calibration: getCalibration,
    getCalibration,
    bakes: { load: bakes.load, take: bakes.take, hashes: bakes.hashes, stats: () => bakes.stats },
    png: () => canvas.toDataURL("image/png").slice(22),
    frame: () => current
  };

  ready.then(() => {
    const q = new URLSearchParams(location.search); if (q.has("adapter")) return;
    seek(Number(q.get("frame") ?? 0));
    let playing = false, ac: AudioContext | null = null, t0 = 0, f0 = 0, node: AudioBufferSourceNode | null = null;
    const stop = () => { playing = false; node?.stop(); node = null; };
    const play = () => {
      ac ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); playing = true; f0 = current >= film.meta.durationFrames - 1 ? 0 : current; t0 = ac.currentTime;
      if (filmSound) { const sr = window.__AUDIO__?.sampleRate ?? ac.sampleRate, [L, R] = filmSound(sr), buf = ac.createBuffer(2, L.length, sr); buf.getChannelData(0).set(L); buf.getChannelData(1).set(R); node = ac.createBufferSource(); node.buffer = buf; node.connect(ac.destination); node.start(0, f0 / film.meta.fps); }
      const tick = () => { if (!playing) return; const f = f0 + Math.floor((ac!.currentTime - t0) * film.meta.fps); if (f >= film.meta.durationFrames) { seek(film.meta.durationFrames - 1); stop(); return; } if (f !== current) seek(f); requestAnimationFrame(tick); }; tick();
    };
    const toggle = () => (playing ? stop() : play());
    canvas.addEventListener("click", toggle);
    addEventListener("keydown", (e) => { if (e.key === " ") { e.preventDefault(); toggle(); } if (e.key === "ArrowRight") { stop(); seek(Math.min(film.meta.durationFrames - 1, current + 1)); } if (e.key === "ArrowLeft") { stop(); seek(Math.max(0, current - 1)); } });
  });
};
