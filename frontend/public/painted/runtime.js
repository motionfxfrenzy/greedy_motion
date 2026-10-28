// --- kit.js ---
/*
 * The painted-short drawing kit: flat, simple shapes on a 2D canvas, drawn back to front. The paint pass (paint.js) turns the
 * flat picture into brush strokes afterwards, so nothing here is detailed. Positions are fractions of the frame (x 0 left to 1
 * right, y 0 top to 1 bottom); sizes are fractions of the frame height unless noted. Every motion is a function of k.t
 * (seconds into the shot), so a frame is a pure function of its time.
 */
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function hex(c) { const m = /^#?([0-9a-f]{6})$/i.exec(c); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const rgb = (a) => "#" + a.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return rgb([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]); };
  const alpha = (c, a) => { const x = hex(c); return "rgba(" + x[0] + "," + x[1] + "," + x[2] + "," + a + ")"; };
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function make(g, W, H, t, p, seed, FH = H) {      // H is the frame; FH is the (taller) canvas, so what sits at the frame's bottom continues below it
    const u = H / 1920;
    const X = (x) => x * W, Y = (y) => y * H;
    const R = (salt) => rng(seed + (salt | 0) * 7919);
    const k = { g, W, H, FH, u, t, p, X, Y, mix, alpha, hex, clamp, lerp, rng: R, TAU };

    k.sky = ({ stops = ["#9cc4e8", "#f6ecc8"], y0 = 0, y1 = 1 } = {}) => {
      const gr = g.createLinearGradient(0, Y(y0), 0, Y(y1));
      stops.forEach((c, i) => gr.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
      g.fillStyle = gr; g.fillRect(0, 0, W, FH);
    };
    k.glow = ({ x, y, r = 0.15, color = "#ffd98a", a = 0.5 }) => {
      const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * H);
      gr.addColorStop(0, alpha(color, a)); gr.addColorStop(1, alpha(color, 0));
      g.fillStyle = gr; g.fillRect(0, 0, W, FH);
    };
    k.sun = ({ x = 0.5, y = 0.3, r = 0.07, color = "#fff2c0", glow = "#ffd08a", glowSize = 0.5, glowAlpha = 0.5 } = {}) => {
      k.glow({ x, y, r: glowSize, color: glow, a: glowAlpha });
      g.fillStyle = color; g.beginPath(); g.arc(X(x), Y(y), r * H, 0, TAU); g.fill();
    };
    k.moon = ({ x = 0.7, y = 0.2, r = 0.045, color = "#f3f0d8" } = {}) => {
      k.glow({ x, y, r: r * 7, color: "#aab6ff", a: 0.35 });
      g.fillStyle = color; g.beginPath(); g.arc(X(x), Y(y), r * H, 0, TAU); g.fill();
    };
    k.stars = ({ n = 80, y1 = 0.5, color = "#fff6d0" } = {}) => {
      const r = R(11);
      for (let i = 0; i < n; i++) {
        const x = r(), y = r() * y1, s = (0.6 + r() * 1.6) * u * 2.2, tw = 0.6 + 0.4 * Math.sin(t * (1 + r() * 2) + r() * 6);
        g.fillStyle = alpha(color, 0.5 + 0.5 * tw); g.fillRect(X(x), Y(y), s, s);
      }
    };
    k.clouds = ({ y = 0.2, band = 0.12, n = 5, size = 0.14, color = "#ffffff", shade = "#dde6ea", drift = 0.01, seed: sd = 1 } = {}) => {
      const r = rng(seed + sd * 131);
      for (let i = 0; i < n; i++) {
        const bx = ((r() + t * drift + 10) % 1.4) - 0.2, by = y + (r() - 0.5) * band, s = size * (0.7 + r() * 0.6);
        for (let j = 0; j < 5; j++) {
          const ox = (j - 2) * s * 0.28 * H / W * 1.1, oy = -Math.abs(j - 2) * s * 0.05, rr = s * (0.16 + 0.08 * (1 - Math.abs(j - 2) / 2));
          g.fillStyle = shade; g.beginPath(); g.ellipse(X(bx + ox), Y(by + oy) + rr * H * 0.28, rr * H * 1.05, rr * H * 0.62, 0, 0, TAU); g.fill();
          g.fillStyle = color; g.beginPath(); g.ellipse(X(bx + ox), Y(by + oy), rr * H * 1.05, rr * H * 0.62, 0, 0, TAU); g.fill();
        }
      }
    };
    k.rays = ({ x = 0.5, y = 0, angle = 1.57, spread = 0.6, n = 8, a = 0.25, width = 0.05, color = "#fff1b8" } = {}) => {
      const r = R(21);
      for (let i = 0; i < n; i++) {
        const ang = angle - spread / 2 + (spread * (i + r() * 0.6)) / n, len = 1.6 * H, wd = width * H * (0.6 + r() * 0.8) * (0.85 + 0.15 * Math.sin(t * 0.7 + i));
        g.save(); g.translate(X(x), Y(y)); g.rotate(ang - Math.PI / 2);
        const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, alpha(color, a)); gr.addColorStop(1, alpha(color, 0));
        g.fillStyle = gr; g.beginPath(); g.moveTo(-wd * 0.1, 0); g.lineTo(wd * 0.1, 0); g.lineTo(wd, len); g.lineTo(-wd, len); g.closePath(); g.fill(); g.restore();
      }
    };
    k.haze = ({ y = 0.55, h = 0.12, color = "#dfe6ea", a = 0.4 } = {}) => {
      const gr = g.createLinearGradient(0, Y(y - h), 0, Y(y + h)); gr.addColorStop(0, alpha(color, 0)); gr.addColorStop(0.5, alpha(color, a)); gr.addColorStop(1, alpha(color, 0));
      g.fillStyle = gr; g.fillRect(0, Y(y - h), W, Y(2 * h));
    };
    k.ridge = ({ y = 0.55, amp = 0.04, freq = 3, color = "#5f8a58", shape = "soft", seed: sd = 1, snow = null } = {}) => {
      const r = rng(seed + sd * 977), ph = [r() * 6, r() * 6, r() * 6];
      const yAt = (x) => {
        const s1 = Math.sin(x * freq * TAU / 1 + ph[0]), s2 = Math.sin(x * freq * 2.3 * TAU + ph[1]) * 0.5, s3 = Math.sin(x * freq * 5.1 * TAU + ph[2]) * 0.2;
        if (shape === "peaks") return y - amp * (Math.abs(s1) * 1.2 + Math.abs(s2) * 0.5 + 0.2 * s3);
        if (shape === "rocky") return y - amp * (Math.abs(s1) + 0.5 * Math.abs(s2) + 0.35 * s3);
        return y - amp * (0.5 * s1 + 0.25 * s2 + 0.1 * s3);
      };
      g.fillStyle = color; g.beginPath(); g.moveTo(0, FH);
      for (let i = 0; i <= 90; i++) { const x = i / 90; let yy = yAt(x); g.lineTo(X(x), Y(yy)); }
      g.lineTo(W, FH); g.closePath(); g.fill();
      if (shape === "pines") {
        const rr = rng(seed + sd * 31);
        for (let i = 0; i < 70; i++) {
          const x = i / 69 + (rr() - 0.5) * 0.012, yy = yAt(x), hh = (0.03 + rr() * 0.025), ww = hh * 0.34 * H / W;
          g.beginPath(); g.moveTo(X(x), Y(yy - hh)); g.lineTo(X(x + ww), Y(yy + 0.004)); g.lineTo(X(x - ww), Y(yy + 0.004)); g.closePath(); g.fill();
        }
      }
      if (snow) {
        g.fillStyle = snow;
        for (let i = 0; i < 90; i++) { const x = i / 90, yy = yAt(x), top = yAt(x) ; if (yy < y - amp * 0.7) { g.fillRect(X(x), Y(yy), W / 90 + 1, amp * H * 0.18); } }
      }
    };
    k.ground = ({ y = 0.62, color = "#58a531", far = "#9cc54a", stripes = 14, flowers = 0, flower = "#fff7e0" } = {}) => {
      const gr = g.createLinearGradient(0, Y(y), 0, FH); gr.addColorStop(0, far); gr.addColorStop(1, color);
      g.fillStyle = gr; g.fillRect(0, Y(y), W, FH - Y(y));
      if (stripes) {
        for (let i = 0; i < stripes; i++) {
          const a = Math.pow(i / stripes, 1.7), b = Math.pow((i + 1) / stripes, 1.7);
          if (i % 2) { g.fillStyle = alpha("#000000", 0.05); g.fillRect(0, Y(y) + a * (FH - Y(y)), W, (b - a) * (FH - Y(y))); }
        }
      }
      if (flowers) {
        const r = R(33);
        for (let i = 0; i < flowers; i++) {
          const d = Math.pow(r(), 0.7), yy = y + d * (1 - y), s = (0.0025 + d * 0.0065) * H * (0.6 + r());
          g.fillStyle = flower; g.beginPath(); g.ellipse(X(r()), Y(yy), s * 1.3, s * 0.8, 0, 0, TAU); g.fill();
        }
      }
    };
    k.water = ({ y0 = 0.6, y1 = 1, color = "#6aa3b8", deep = "#2b5a74", glint = "#fff6d8", glints = 60 } = {}) => {
      const gr = g.createLinearGradient(0, Y(y0), 0, Y(y1)); gr.addColorStop(0, color); gr.addColorStop(1, deep);
      g.fillStyle = gr; g.fillRect(0, Y(y0), W, (y1 >= 1 ? FH : Y(y1)) - Y(y0));
      const r = R(41);
      for (let i = 0; i < glints; i++) {
        const d = Math.pow(r(), 0.8), yy = y0 + d * (y1 - y0), w = (0.01 + d * 0.05) * W * (0.5 + r()), x = (r() + Math.sin(t * (0.6 + r()) + i) * 0.01 + 1) % 1;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * (1.1 + r()) + r() * 6)); g.fillStyle = alpha(glint, 0.45 * tw); g.fillRect(X(x), Y(yy), w, Math.max(1, 0.0035 * H));
      }
    };
    k.path = ({ x = 0.5, y = 1, near = 0.3, far = 0.03, color = "#d9bf8a", bend = 0.1, horizon = 0.62 } = {}) => {
      g.fillStyle = color; g.beginPath();
      g.moveTo(X(x - near / 2), Y(y)); g.bezierCurveTo(X(x - near / 2 + bend), Y(lerp(y, horizon, 0.5)), X(x - far / 2 + bend), Y(lerp(y, horizon, 0.8)), X(x - far / 2 + bend * 0.4), Y(horizon));
      g.lineTo(X(x + far / 2 + bend * 0.4), Y(horizon)); g.bezierCurveTo(X(x + far / 2 + bend), Y(lerp(y, horizon, 0.8)), X(x + near / 2 + bend), Y(lerp(y, horizon, 0.5)), X(x + near / 2), Y(y)); g.closePath(); g.fill();
      if (y >= 0.99) g.fillRect(X(x - near / 2), Y(y) - 1, X(near), FH - Y(y) + 1);                                   // the path carries on below the frame
    };
    k.tree = ({ x = 0.5, y = 0.7, h = 0.25, kind = "round", crown = "#4f8a3a", trunk = "#4a3524" } = {}) => {
      const sway = Math.sin(t * 0.8 + x * 9) * 0.004 * H, th = h * H;
      g.fillStyle = trunk; g.fillRect(X(x) - th * 0.03, Y(y) - th * 0.45, th * 0.06, th * 0.45);
      g.fillStyle = crown;
      if (kind === "pine") { for (let i = 0; i < 3; i++) { const yy = Y(y) - th * (0.28 + i * 0.22), ww = th * (0.3 - i * 0.07); g.beginPath(); g.moveTo(X(x) + sway * (i + 1) / 3, yy - th * 0.3); g.lineTo(X(x) + ww, yy + th * 0.1); g.lineTo(X(x) - ww, yy + th * 0.1); g.closePath(); g.fill(); } }
      else if (kind === "bare") { g.strokeStyle = trunk; g.lineWidth = th * 0.03; g.lineCap = "round"; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(X(x), Y(y) - th * 0.4); g.lineTo(X(x) + (i - 2) * th * 0.18 + sway, Y(y) - th * (0.8 + (i % 2) * 0.12)); g.stroke(); } }
      else { for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU, cx = X(x) + Math.cos(a) * th * 0.16 + sway, cy = Y(y) - th * 0.62 + Math.sin(a) * th * 0.12; g.beginPath(); g.arc(cx, cy, th * 0.22, 0, TAU); g.fill(); } g.beginPath(); g.arc(X(x) + sway, Y(y) - th * 0.64, th * 0.26, 0, TAU); g.fill(); }
    };
    k.trees = ({ n = 6, y = 0.68, h = 0.3, x0 = 0, x1 = 1, kind = "round", crown = "#4f8a3a", trunk = "#4a3524" } = {}) => {
      const r = R(55);
      for (let i = 0; i < n; i++) k.tree({ x: lerp(x0, x1, (i + 0.5 + (r() - 0.5) * 0.5) / n), y: y + (r() - 0.5) * 0.02, h: h * (0.8 + r() * 0.4), kind, crown: mix(crown, "#000000", r() * 0.15), trunk });
    };
    k.trunks = ({ n = 8, color = "#3b2b22", light = "#7a5b3c", width = 0.06, x0 = 0, x1 = 1 } = {}) => {
      const r = R(66);
      for (let i = 0; i < n; i++) { const x = lerp(x0, x1, (i + r() * 0.7) / n), w = width * W * (0.6 + r() * 0.9); g.fillStyle = color; g.fillRect(X(x), 0, w, FH); g.fillStyle = alpha(light, 0.6); g.fillRect(X(x) + w * 0.65, 0, w * 0.18, H); }
    };
    k.foliage = ({ side = "left", depth = 0.28, color = "#315a2c", light = "#8cbf4a", y0 = 0, y1 = 0.7 } = {}) => {
      const r = R(77), dir = side === "left" ? 1 : -1, x0 = side === "left" ? 0 : W;
      for (let i = 0; i < 48; i++) {
        const yy = lerp(y0, y1, r()), xx = x0 + dir * r() * depth * W * (1 - (yy - y0) / (y1 - y0) * 0.7), s = (0.02 + r() * 0.035) * H;
        g.fillStyle = r() > 0.55 ? light : color; g.beginPath(); g.ellipse(xx + Math.sin(t * 0.9 + i) * 0.003 * H, Y(yy), s * 1.2, s, r() * 3, 0, TAU); g.fill();
      }
    };
    k.house = ({ x = 0.5, y = 0.75, w = 0.26, h = 0.24, wall = "#8a7866", roof = "#4b3a30", window = "#f6d98a", lit = false, floors = 1 } = {}) => {
      const bw = w * W, bh = h * H;
      g.fillStyle = wall; g.fillRect(X(x) - bw / 2, Y(y) - bh, bw, bh);
      g.fillStyle = roof; g.beginPath(); g.moveTo(X(x) - bw * 0.58, Y(y) - bh); g.lineTo(X(x), Y(y) - bh - bw * 0.36); g.lineTo(X(x) + bw * 0.58, Y(y) - bh); g.closePath(); g.fill();
      for (let f = 0; f < floors; f++) for (let c = 0; c < 2; c++) { g.fillStyle = lit ? window : mix(wall, "#000000", 0.25); g.fillRect(X(x) - bw * 0.3 + c * bw * 0.36, Y(y) - bh * (0.88 - f * 0.46), bw * 0.24, bh * 0.28 / floors * 1.1); }
      g.fillStyle = mix(wall, "#000000", 0.4); g.fillRect(X(x) - bw * 0.07, Y(y) - bh * 0.34, bw * 0.14, bh * 0.34);
    };
    k.city = ({ y = 0.7, h = 0.4, color = "#14163a", lit = 0.3, litColor = "#ffd98a", n = 20 } = {}) => {
      const r = R(88);
      for (let i = 0; i < n; i++) {
        const bw = (0.5 / n + r() * 0.04) * W * 1.6, bx = (i / n) * W - bw * 0.2, bh = (0.12 + r() * h) * H;
        g.fillStyle = mix(color, "#ffffff", r() * 0.08); g.fillRect(bx, Y(y) - bh, bw, bh + (FH - Y(y)));
        for (let wy = Y(y) - bh + bw * 0.12; wy < Y(y) - bw * 0.1; wy += bw * 0.3) for (let wx = bx + bw * 0.12; wx < bx + bw - bw * 0.2; wx += bw * 0.25) if (r() < lit) { g.fillStyle = litColor; g.fillRect(wx, wy, bw * 0.12, bw * 0.16); }
      }
    };
    k.lamp = ({ x = 0.5, y = 0.8, h = 0.26, light = "#ffd98a" } = {}) => {
      g.fillStyle = "#2a2a33"; g.fillRect(X(x) - 0.004 * H, Y(y) - h * H, 0.008 * H, h * H); g.fillStyle = light; g.beginPath(); g.arc(X(x), Y(y) - h * H, 0.012 * H, 0, TAU); g.fill();
      k.glow({ x, y: y - h, r: 0.16, color: light, a: 0.4 });
    };
    /** Heave of the sea under a boat: calm is a slow rock, a storm throws it up the swells and rolls it hard. */
    k.waveAt = (x, rough = 1, phase = 0) => rough * 0.04 * (1 + 0.9 * Math.max(0, rough - 0.5)) * (Math.sin(x * 8 - t * 1.7 + phase) + 0.55 * Math.sin(x * 15 - t * 2.6 + 1.3 + phase));   // fraction of H; negative is a crest
    k.boatMotion = (rough = 0, x = 0.5) => ({ dy: k.waveAt(x, rough) + Math.sin(t * 1.2) * 0.004, rot: Math.sin(t * 0.9) * 0.03 + rough * (0.2 * Math.sin(t * 1.7 + 0.4) + 0.1 * Math.sin(t * 2.9 + 1)) });
    /** Rolling swells across the frame, with whitecaps on the crests. */
    k.swell = ({ y = 0.74, rough = 1, color = "#1d3f5c", crest = "#e8f2f6", layer = 0, a = 0.9 } = {}) => {
      const steps = 56, ph = layer * 2.1;
      g.fillStyle = alpha(color, a); g.beginPath(); g.moveTo(0, FH);
      for (let i = 0; i <= steps; i++) { const x = i / steps; g.lineTo(X(x), Y(y + k.waveAt(x, rough, ph))); }
      g.lineTo(W, FH); g.closePath(); g.fill();
      g.strokeStyle = alpha(crest, 0.7 * a); g.lineWidth = Math.max(3, 0.008 * H * (1 + rough)); g.lineCap = "round";
      for (let i = 0; i < steps; i++) { const x0 = i / steps, x1 = (i + 1) / steps, w0 = k.waveAt(x0, rough, ph), w1 = k.waveAt(x1, rough, ph); if (w0 < -0.018 * rough && w1 < -0.018 * rough) { g.beginPath(); g.moveTo(X(x0), Y(y + w0)); g.lineTo(X(x1), Y(y + w1)); g.stroke(); } }
    };
    /** Lightning: a jagged bolt and a flash that lights everything, at the shot's flash times (seconds into the shot). */
    k.lightning = ({ flashes = [] } = {}) => {
      let a = 0;
      flashes.forEach((f, idx) => {
        const d = t - f; if (d < 0) return;
        a = Math.max(a, d < 0.07 ? 0.9 : d < 0.12 ? 0.25 : d < 0.19 ? 0.7 : 0.55 * Math.exp(-(d - 0.19) * 9));
        if (d < 0.2) {
          const r = R(60 + idx), bx0 = 0.2 + 0.6 * r(); let bx = bx0, by = 0;
          const pts = [[bx, by]]; while (by < 0.56) { by += 0.04 + r() * 0.05; bx += (r() - 0.5) * 0.09; pts.push([bx, by]); }
          for (const [wd, al] of [[0.012, 0.35], [0.004, 1]]) { g.strokeStyle = alpha("#f4f8ff", al); g.lineWidth = wd * H; g.lineJoin = "round"; g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(X(px), Y(py)) : g.moveTo(X(px), Y(py)))); g.stroke(); }
        }
      });
      if (a > 0) { g.fillStyle = "rgba(215,225,255," + (a * 0.55).toFixed(3) + ")"; g.fillRect(0, 0, W, FH); }
    };
    k.boat = ({ x = 0.5, y = 0.7, s = 0.16, color = "#7a4b2e", sail = "#f3ecd8", rough = 0, rim = null } = {}) => {
      const m = k.boatMotion(rough, x), bob = m.dy * H, w = s * H;
      g.save(); g.translate(X(x), Y(y) + bob); g.rotate(m.rot);
      g.fillStyle = color; g.beginPath(); g.moveTo(-w * 0.5, 0); g.lineTo(w * 0.5, 0); g.lineTo(w * 0.35, w * 0.18); g.lineTo(-w * 0.35, w * 0.18); g.closePath(); g.fill();
      if (rim) { g.strokeStyle = alpha(rim, 0.75); g.lineWidth = Math.max(2, w * 0.025); g.lineJoin = "round"; g.beginPath(); g.moveTo(-w * 0.5, 0); g.lineTo(w * 0.5, 0); g.lineTo(w * 0.35, w * 0.18); g.lineTo(-w * 0.35, w * 0.18); g.closePath(); g.stroke(); }   // at night the hull is outlined in pale light so it reads on dark water
      g.fillStyle = "#4a3524"; g.fillRect(-w * 0.015, -w * 0.9, w * 0.03, w * 0.9);
      g.fillStyle = sail; g.beginPath(); g.moveTo(w * 0.03, -w * 0.88); g.lineTo(w * 0.42, -w * 0.1); g.lineTo(w * 0.03, -w * 0.1); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-w * 0.03, -w * 0.8); g.lineTo(-w * 0.32, -w * 0.1); g.lineTo(-w * 0.03, -w * 0.1); g.closePath(); g.fill(); g.restore();
    };
    // A reusable support, with a broad level crown matching layout.js's surface.
    k.rock = ({ x = 0.5, y = 0.84, w = 0.5, h = 0.16, color = "#777e82", light = "#b6b39c", dark = "#46545e", rim = null, foam = 0 } = {}) => {
      const polygon = (points, fill) => { g.fillStyle = fill; g.beginPath(); points.forEach(([a,b],i) => { const xx=X(x+(a-0.5)*w), yy=Y(y-h+b*h); i ? g.lineTo(xx,yy) : g.moveTo(xx,yy); }); g.closePath(); g.fill(); };
      polygon([[0,.84],[.07,.62],[.17,.48],[.26,.2],[.74,.2],[.84,.42],[.9,.65],[1,.87],[.85,1],[.14,.98]], dark);
      polygon([[.07,.62],[.26,.2],[.74,.2],[.83,.43],[.6,.55],[.38,.46],[.21,.73]], color);
      polygon([[.26,.2],[.74,.2],[.79,.3],[.65,.36],[.32,.33],[.19,.45]], light);
      polygon([[.21,.73],[.38,.46],[.6,.55],[.51,.87],[.32,.96]], mix(color, light, .28));
      polygon([[.6,.55],[.83,.43],[.9,.65],[.77,.77],[.51,.87]], mix(color, dark, .35));
      polygon([[.04,.83],[.21,.73],[.32,.96],[.14,.98]], mix(color, dark, .18));
      polygon([[.77,.77],[.9,.65],[1,.87],[.85,1],[.64,.95]], color);
      g.strokeStyle = alpha(light, .6); g.lineWidth = Math.max(1, H*h*.025);
      for (const [ax,ay,bx,by] of [[.22,.59,.38,.52],[.4,.68,.55,.72],[.63,.83,.8,.76]]) { g.beginPath(); g.moveTo(X(x+(ax-.5)*w),Y(y-h+ay*h)); g.lineTo(X(x+(bx-.5)*w),Y(y-h+by*h)); g.stroke(); }
      // A rock in the dark has to read against the water: a pale rim along its crest, and surf breaking round its foot (more the wilder the sea).
      if (rim) { g.strokeStyle = alpha(rim, .7); g.lineWidth = Math.max(2, H*h*.045); g.lineJoin = "round"; g.beginPath(); [[.07,.62],[.17,.48],[.26,.2],[.74,.2],[.84,.42],[.9,.65]].forEach(([a,b],i) => { const xx=X(x+(a-0.5)*w), yy=Y(y-h+b*h); i ? g.lineTo(xx,yy) : g.moveTo(xx,yy); }); g.stroke(); }
      if (foam > 0) for (let i = 0; i <= 14; i++) {
        const u = i / 14, sway = Math.sin(t * (1.1 + foam) + i * 1.7), fx = x + (u - .5) * w * 1.12, fy = y - h * (.02 + .05 * Math.abs(Math.sin(i * 2.3))) + sway * h * .035 * foam;
        g.fillStyle = alpha("#eef6fa", Math.min(.85, .45 + .3 * foam)); g.beginPath(); g.ellipse(X(fx), Y(fy), (X(x + w * .045) - X(x)) * (.8 + .4 * Math.abs(Math.sin(i * 3.1))), H * h * (.045 + .03 * foam), 0, 0, Math.PI * 2); g.fill();
      }
    };
    k.lighthouse = ({ x = 0.7, y = 0.7, h = 0.34, body = "#f1ece0", stripe = "#c0463d", light = "#ffe9a0" } = {}) => {
      const th = h * H, bw = th * 0.2;
      g.fillStyle = body; g.beginPath(); g.moveTo(X(x) - bw * 0.6, Y(y)); g.lineTo(X(x) - bw * 0.36, Y(y) - th); g.lineTo(X(x) + bw * 0.36, Y(y) - th); g.lineTo(X(x) + bw * 0.6, Y(y)); g.closePath(); g.fill();
      g.fillStyle = stripe; for (let i = 0; i < 3; i++) { const a = i * 0.28 + 0.08; g.fillRect(X(x) - bw * (0.55 - a * 0.2), Y(y) - th * (a + 0.12), bw * (1.1 - a * 0.4), th * 0.09); }
      g.fillStyle = "#2a2a33"; g.fillRect(X(x) - bw * 0.5, Y(y) - th - bw * 0.2, bw, bw * 0.2);
      g.fillStyle = light; g.fillRect(X(x) - bw * 0.3, Y(y) - th - bw * 0.62, bw * 0.6, bw * 0.42);
      g.fillStyle = stripe; g.beginPath(); g.moveTo(X(x) - bw * 0.42, Y(y) - th - bw * 0.62); g.lineTo(X(x), Y(y) - th - bw * 1.05); g.lineTo(X(x) + bw * 0.42, Y(y) - th - bw * 0.62); g.closePath(); g.fill();
      k.glow({ x, y: y - h - 0.02, r: 0.2, color: light, a: 0.45 });
    };
    /** A seedling: a thin stem with two leaves, swaying a little. h is its height as a fraction of the frame. */
    k.groundmark = ({ x = 0.5, y = 0.8, w = 0.3, shape = "sun", color = "#7f95a8" } = {}) => {            // a shape drawn in the ground, finished (the doodle engine draws it being made)
      const cx = X(x), cy = Y(y), rx = (w * W) / 2, ry = rx * 0.4; g.strokeStyle = color; g.lineWidth = Math.max(3, 0.005 * H); g.lineCap = "round";
      g.beginPath(); g.ellipse(cx, cy, rx * 0.5, ry * 0.5, 0, 0, TAU); g.stroke();
      if (shape === "sun") for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.beginPath(); g.moveTo(cx + Math.cos(a) * rx * 0.65, cy + Math.sin(a) * ry * 0.65); g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); g.stroke(); }
    };
    k.pond = ({ x = 0.5, y = 0.8, w = 0.4, h = 0.06, ice = false, color = "#4a9ab8", rim = "#2f6a84" } = {}) => {   // a small pond or puddle: a flat oval of water (ice when frozen) with a rim and a glint
      const cx = X(x), cy = Y(y), rx = (w * W) / 2, ry = Math.max(6, rx * 0.2);
      g.fillStyle = ice ? "#9fb6c6" : rim; g.beginPath(); g.ellipse(cx, cy, rx * 1.06, ry * 1.12, 0, 0, TAU); g.fill();
      g.fillStyle = ice ? "#dcebf5" : color; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill();
      g.strokeStyle = "rgba(255,255,255,0.65)"; g.lineWidth = Math.max(2, 0.003 * H); g.beginPath(); g.moveTo(cx - rx * 0.5, cy - ry * 0.2); g.lineTo(cx - rx * 0.1, cy - ry * 0.35); g.stroke();
    };
    k.sprout = ({ x = 0.5, y = 0.8, h = 0.08, color = "#5cb338", dark = "#2f7a2a" } = {}) => {
      const th = h * H, sw = Math.sin(t * 1.4) * th * 0.06, top = [X(x) + sw, Y(y) - th];
      g.strokeStyle = dark; g.lineWidth = Math.max(3, th * 0.07); g.lineCap = "round"; g.beginPath(); g.moveTo(X(x), Y(y)); g.quadraticCurveTo(X(x) - sw * 0.5, Y(y) - th * 0.5, top[0], top[1]); g.stroke();
      for (const side of [-1, 1]) { g.fillStyle = side < 0 ? dark : color; g.beginPath(); g.ellipse(top[0] + side * th * 0.22, top[1] + th * 0.08 - side * th * 0.02, th * 0.24, th * 0.11, side * -0.5, 0, TAU); g.fill(); }
    };
    // ---- indoors ----
    k.room = ({ wall = "#7a5238", floor = "#5a3a26", y = 0.78 } = {}) => {
      const gr = g.createLinearGradient(0, 0, 0, Y(y)); gr.addColorStop(0, mix(wall, "#000000", 0.25)); gr.addColorStop(1, wall); g.fillStyle = gr; g.fillRect(0, 0, W, Y(y));
      g.fillStyle = floor; g.fillRect(0, Y(y), W, FH - Y(y));
      g.fillStyle = mix(floor, "#000000", 0.3); for (let i = 1; i < 9; i++) g.fillRect(0, Y(y) + ((FH - Y(y)) * i * i) / 81, W, Math.max(2, 0.003 * H));
      g.fillStyle = mix(wall, "#000000", 0.4); g.fillRect(0, Y(y) - 0.02 * H, W, 0.02 * H);                         // skirting board
    };
    k.window = ({ x = 0.25, y = 0.35, w = 0.2, h = 0.22, night = true, snow = false } = {}) => {
      const pw = w * W, ph = h * H, x0 = X(x) - pw / 2, y0 = Y(y) - ph / 2, fr = Math.max(4, 0.012 * H);
      const gr = g.createLinearGradient(0, y0, 0, y0 + ph); const sky = night ? ["#0a0e2c", "#303a78"] : ["#8dbbe6", "#f3efd0"]; gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]);
      g.fillStyle = gr; g.fillRect(x0, y0, pw, ph);
      if (snow) { g.fillStyle = "rgba(255,255,255,.85)"; const r = R(97); for (let i = 0; i < 40; i++) { g.fillRect(x0 + r() * pw, y0 + ((r() + t * (0.1 + r() * 0.2)) % 1) * ph, 3, 3); } }
      g.fillStyle = "#3a2618"; g.fillRect(x0 - fr, y0 - fr, pw + 2 * fr, fr); g.fillRect(x0 - fr, y0 + ph, pw + 2 * fr, fr * 1.4); g.fillRect(x0 - fr, y0, fr, ph); g.fillRect(x0 + pw, y0, fr, ph); g.fillRect(x0 + pw / 2 - fr / 2, y0, fr, ph); g.fillRect(x0, y0 + ph / 2 - fr / 2, pw, fr);
    };
    k.fireplace = ({ x = 0.76, y = 0.8, h = 0.26 } = {}) => {
      const th = h * H, w = th * 0.95, cx = X(x), top = Y(y) - th;
      k.glow({ x, y: y - h * 0.3, r: 0.45, color: "#ff9a3c", a: 0.55 + 0.1 * Math.sin(t * 7) });
      g.fillStyle = "#6d6258"; g.fillRect(cx - w / 2, top, w, th);                                                   // stone surround
      g.fillStyle = "#3a332d"; g.fillRect(cx - w / 2 - th * 0.05, top - th * 0.07, w + th * 0.1, th * 0.08);          // mantel
      g.fillStyle = "#17100c"; g.fillRect(cx - w * 0.32, top + th * 0.28, w * 0.64, th * 0.72);                       // opening
      for (let i = 0; i < 5; i++) { const fx = cx + (i - 2) * w * 0.11, fl = th * (0.3 + 0.12 * Math.sin(t * (5 + i) + i * 1.7)) * (1 - Math.abs(i - 2) * 0.15); for (const [c, s] of [["#e8530f", 1], ["#ff9a1f", 0.7], ["#ffe27a", 0.4]]) { g.fillStyle = c; g.beginPath(); g.ellipse(fx, Y(y) - fl * s * 0.5, w * 0.06 * s + 2, fl * s * 0.55, 0, 0, TAU); g.fill(); } }
      g.fillStyle = "#2a1a10"; g.fillRect(cx - w * 0.3, Y(y) - th * 0.07, w * 0.6, th * 0.07);                        // logs
    };
    k.table = ({ x = 0.5, y = 0.86, w = 0.3, h = 0.082, bread = true } = {}) => {
      const th = h / 0.082, tw = w * W, cx = X(x), ty = Y(y) - 0.07 * th * H;
      g.fillStyle = "#4a2f1d"; g.fillRect(cx - tw * 0.42, ty, tw * 0.05, 0.07 * th * H); g.fillRect(cx + tw * 0.37, ty, tw * 0.05, 0.07 * th * H);
      g.fillStyle = "#7a5030"; g.fillRect(cx - tw / 2, ty - 0.012 * th * H, tw, 0.016 * th * H);
      if (bread) { g.fillStyle = "#c98a45"; g.beginPath(); g.ellipse(cx, ty - 0.03 * th * H, tw * 0.1, 0.022 * th * H, 0, 0, TAU); g.fill(); g.strokeStyle = "#8a5a28"; g.lineWidth = 2; for (const d of [-0.04, 0, 0.04]) { g.beginPath(); g.moveTo(cx + tw * d - 4, ty - 0.045 * th * H); g.lineTo(cx + tw * d + 4, ty - 0.02 * th * H); g.stroke(); } }
    };
    /** A clay jar with a neck and rim. */
    k.jar = ({ x = 0.5, y = 0.8, h = 0.1, color = "#b4622f", dark = "#7a3d1c" } = {}) => {
      const th = h * H, w = th * 0.8, cx = X(x), by = Y(y);
      g.fillStyle = color; g.beginPath(); g.moveTo(cx - w * 0.3, by - th); g.lineTo(cx + w * 0.3, by - th); g.lineTo(cx + w * 0.22, by - th * 0.82);
      g.bezierCurveTo(cx + w * 0.75, by - th * 0.7, cx + w * 0.62, by - th * 0.1, cx + w * 0.3, by); g.lineTo(cx - w * 0.3, by);
      g.bezierCurveTo(cx - w * 0.62, by - th * 0.1, cx - w * 0.75, by - th * 0.7, cx - w * 0.22, by - th * 0.82); g.closePath(); g.fill();
      g.fillStyle = dark; g.fillRect(cx - w * 0.34, by - th * 1.04, w * 0.68, th * 0.07);
      g.strokeStyle = dark; g.lineWidth = Math.max(2, th * 0.03); g.beginPath(); g.moveTo(cx - w * 0.55, by - th * 0.52); g.quadraticCurveTo(cx, by - th * 0.42, cx + w * 0.55, by - th * 0.52); g.stroke();
    };
    /** Blowing sand: short streaks racing across the frame. */
    k.sand = ({ n = 140, color = "#e2b877" } = {}) => {
      const r = R(95); g.lineCap = "round";
      for (let i = 0; i < n; i++) { const sp = 0.5 + r() * 0.9, x0 = ((r() + t * sp) % 1.3) - 0.15, y0 = r(), len = (0.04 + r() * 0.12) * W; g.strokeStyle = alpha(color, 0.25 + r() * 0.4); g.lineWidth = Math.max(1.5, (0.002 + r() * 0.004) * H); g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x0) - len, Y(y0) + len * 0.12); g.stroke(); }
    };
    // ---- houses in styles ----
    k.building = ({ style = "cottage", x = 0.5, y = 0.75, w, h, wall, roof, lit = false } = {}) => {
      const S = {
        cottage: { w: 0.26, h: 0.24, wall: "#8a7866", roof: "#4b3a30", floors: 1 }, tower: { w: 0.13, h: 0.44, wall: "#7d7a86", roof: "#3c3447", floors: 3 },
        cabin: { w: 0.32, h: 0.17, wall: "#7a5636", roof: "#3a2a1c", floors: 1 }, barn: { w: 0.36, h: 0.22, wall: "#9a3a2e", roof: "#4a2a22", floors: 1 },
        shop: { w: 0.26, h: 0.26, wall: "#a8896a", roof: "#5a3a2c", floors: 2 }, church: { w: 0.24, h: 0.26, wall: "#d8d0c0", roof: "#5a4a44", floors: 1 }
      }, d = S[style] || S.cottage, ww = w ?? d.w, hh = h ?? d.h, bw = ww * W, bh = hh * H, cx = X(x), by = Y(y);
      k.house({ x, y, w: ww, h: hh, wall: wall ?? d.wall, roof: roof ?? d.roof, lit, floors: d.floors });
      if (style === "cabin") { g.strokeStyle = mix(wall ?? d.wall, "#000000", 0.3); g.lineWidth = Math.max(2, bh * 0.03); for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(cx - bw / 2, by - (bh * i) / 5); g.lineTo(cx + bw / 2, by - (bh * i) / 5); g.stroke(); } }
      if (style === "barn") { g.strokeStyle = "#f1e8d8"; g.lineWidth = Math.max(3, bh * 0.04); const dw = bw * 0.3, dh = bh * 0.62; g.strokeRect(cx - dw / 2, by - dh, dw, dh); g.beginPath(); g.moveTo(cx - dw / 2, by - dh); g.lineTo(cx + dw / 2, by); g.moveTo(cx + dw / 2, by - dh); g.lineTo(cx - dw / 2, by); g.stroke(); }
      if (style === "shop") { for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? "#f4efe4" : "#b8402f"; g.fillRect(cx - bw * 0.5 + (bw * i) / 6, by - bh * 0.5, bw / 6, bh * 0.09); } g.fillStyle = "#3a2a1c"; g.fillRect(cx - bw * 0.16, by - bh * 0.96, bw * 0.32, bh * 0.1); }
      if (style === "church") { const sw = bw * 0.26, sh = bh * 0.7; g.fillStyle = wall ?? d.wall; g.fillRect(cx - sw / 2, by - bh - sh, sw, sh); g.fillStyle = d.roof; g.beginPath(); g.moveTo(cx - sw * 0.66, by - bh - sh); g.lineTo(cx, by - bh - sh - sw * 1.3); g.lineTo(cx + sw * 0.66, by - bh - sh); g.closePath(); g.fill(); g.fillStyle = "#3a2c24"; const cy0 = by - bh - sh - sw * 1.3; g.fillRect(cx - 2, cy0 - sw * 0.5, 4, sw * 0.5); g.fillRect(cx - sw * 0.16, cy0 - sw * 0.36, sw * 0.32, 4); }
    };
    // ---- furnished rooms ----
    k.furnish = (kind, { x = 0.5, y = 0.8, s = 1, night = true } = {}) => {
      const cx = X(x), by = Y(y), u2 = H * 0.001 * s;
      const box = (dx, dy, w, h, c) => { g.fillStyle = c; g.fillRect(cx + dx * u2, by + dy * u2, w * u2, h * u2); };
      if (kind === "bed") { box(-160, -90, 320, 90, "#6b4a2e"); box(-160, -170, 40, 170, "#4a3220"); box(-150, -120, 300, 40, "#c9d4e6"); box(-150, -150, 110, 50, "#f2eee6"); }
      else if (kind === "stove") { box(-60, -190, 120, 190, "#2a2a30"); box(-6, -300, 12, 110, "#3a3a42"); box(-40, -150, 80, 70, "#12100f"); k.glow({ x, y: y - 0.08 * s, r: 0.18 * s, color: "#ff9a3c", a: 0.35 + 0.08 * Math.sin(t * 6) }); }
      else if (kind === "shelves") { for (let i = 0; i < 3; i++) { box(-150, -380 + i * 110, 300, 10, "#5a3a22"); for (let j = 0; j < 5; j++) box(-135 + j * 56 + ((i * 17 + j * 11) % 9), -380 + i * 110 - 50 - ((j * 13) % 22), 34, 50 + ((j * 13) % 22), ["#b4622f", "#d8c49a", "#7a8a5a", "#9a4a3a", "#c8a24a"][(i + j) % 5]); } }
      else if (kind === "workbench") { box(-230, -150, 460, 24, "#6a4a2a"); box(-210, -126, 24, 126, "#4a3220"); box(186, -126, 24, 126, "#4a3220"); box(-120, -190, 70, 40, "#9a9aa4"); box(40, -178, 30, 28, "#b4622f"); }
      else if (kind === "pews") { for (let i = 2; i >= 0; i--) { const sc = 1 - i * 0.18, w = 380 * sc * u2, px = cx - w / 2, py = by - i * 70 * u2; g.fillStyle = "#5a3a22"; g.fillRect(px, py - 110 * sc * u2, w, 70 * sc * u2); g.fillStyle = "#3e2616"; g.fillRect(px, py - 40 * sc * u2, w, 40 * sc * u2); } }
      else if (kind === "counter") { box(-250, -150, 500, 150, "#6a4a2a"); box(-250, -160, 500, 14, "#8a6a42"); box(-80, -230, 50, 70, "#c9a24a"); box(20, -210, 40, 50, "#9a4a3a"); }
      else if (kind === "candles") { for (let i = 0; i < 3; i++) { box(-90 + i * 90, -60, 14, 60, "#efe6c8"); k.glow({ x: x + (-90 + i * 90) * u2 / W, y: y - 0.07 * s, r: 0.05 * s, color: "#ffd98a", a: 0.7 + 0.15 * Math.sin(t * 9 + i) }); } }
    };
    k.roomOf = ({ room = "cabin", includeTable = true, wall = "#8a6048", floor = "#6a4630", night = true, snow = false } = {}) => {
      const R2 = { kitchen: { wall: "#9a7a58", floor: "#5a4430" }, bedroom: { wall: "#7a6a8a", floor: "#5a4636" }, workshop: { wall: "#6a5a48", floor: "#4a3a2c" }, lighthouse: { wall: "#6c6a72", floor: "#4a4850" }, lantern: { wall: "#3a4058", floor: "#4a4850" }, church: { wall: "#8a8070", floor: "#5a4a3c" }, shop: { wall: "#8a6a4a", floor: "#5a3e2a" } }[room];
      const wl = (R2 || { wall }).wall, fl = (R2 || { floor }).floor;
      k.room({ wall: wl, floor: fl, y: 0.78 });
      if (room === "lantern") {                                                      // the lamp room: glass all round, the great lamp, the sea beyond
        g.fillStyle = night ? "#10163a" : "#8dbbe6"; g.fillRect(0, 0, W, Y(0.62)); g.fillStyle = night ? "#1d2d5c" : "#4a8fb0"; g.fillRect(0, Y(0.62), W, Y(0.16));
        g.strokeStyle = "#2a2a34"; g.lineWidth = Math.max(8, 0.016 * H); for (const fx of [0.02, 0.34, 0.66, 0.98]) { g.beginPath(); g.moveTo(X(fx), 0); g.lineTo(X(fx), Y(0.78)); g.stroke(); } g.beginPath(); g.moveTo(0, Y(0.62)); g.lineTo(W, Y(0.62)); g.stroke();
        k.glow({ x: 0.5, y: 0.5, r: 0.45, color: "#ffd36a", a: 0.6 + 0.08 * Math.sin(t * 3) });
      } else if (room === "lighthouse") {                                           // round stone tower: brick courses, a spiral stair, a round window, the lamp's glow
        g.strokeStyle = mix(wl, "#000000", 0.35); g.lineWidth = Math.max(2, 0.003 * H); const ssh = (k.stairShift || 0) * H; for (let i = 1; i < 14; i++) { const by = (Y(0.78) * i / 14 + ssh) % Y(0.78); g.beginPath(); g.moveTo(0, by); g.lineTo(W, by); g.stroke(); }
        g.fillStyle = mix(wl, "#000000", 0.22); g.fillRect(0, 0, W * 0.09, Y(0.78)); g.fillRect(W * 0.91, 0, W * 0.09, Y(0.78));
        g.fillStyle = "#4a3a2a"; for (let i = -4; i < 24; i++) { const sx = X(0.32) + i * W * 0.045, sy = Y(0.76) - i * H * 0.06 + ssh; if (sy > Y(0.76) + 1) continue; g.fillRect(sx, sy, W * 0.12, H * 0.018); g.fillStyle = "#2e2418"; g.fillRect(sx, sy + H * 0.018, W * 0.12, H * 0.012); g.fillStyle = "#4a3a2a"; }
        g.fillStyle = night ? "#0a0e2c" : "#8dbbe6"; g.beginPath(); g.arc(X(0.2), Y(0.3) + ssh, W * 0.08, 0, TAU); g.fill(); g.strokeStyle = "#3a2618"; g.lineWidth = Math.max(5, 0.012 * H); g.stroke();
        k.glow({ x: 0.5, y: 0.04, r: 0.4, color: "#ffd36a", a: 0.55 + 0.08 * Math.sin(t * 3) });
      } else if (room === "church") {
        k.window({ x: 0.5, y: 0.3, w: 0.22, h: 0.34, night, snow }); g.fillStyle = "rgba(200,60,60,.35)"; g.fillRect(X(0.39), Y(0.15), W * 0.11, H * 0.17); g.fillStyle = "rgba(60,90,200,.35)"; g.fillRect(X(0.5), Y(0.32), W * 0.11, H * 0.17);
        k.furnish("pews", { x: 0.5, y: 0.9 }); k.furnish("candles", { x: 0.82, y: 0.78 });
      } else {
        k.window({ x: 0.2, y: 0.34, w: room === "workshop" ? 0.14 : 0.2, h: 0.22, night, snow });
        if (room === "kitchen") { k.furnish("stove", { x: 0.78, y: 0.8 }); k.furnish("shelves", { x: 0.5, y: 0.7, s: 0.8 }); }
        else if (room === "bedroom") { k.furnish("bed", { x: 0.7, y: 0.86 }); }
        else if (room === "workshop" && includeTable) { k.furnish("workbench", { x: 0.68, y: 0.86 }); }
        else if (room === "shop") { k.furnish("counter", { x: 0.62, y: 0.86 }); k.furnish("shelves", { x: 0.2, y: 0.7, s: 0.8 }); }
        else if (room !== "workshop") k.fireplace({ x: 0.78, y: 0.8, h: 0.27 });
      }
    };
    // ---- recipes: scenes and objects described as data (by an AI) in the engine's own terms ----
    const RC = (v, d, lo = -2, hi = 3) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const CLR = (c, d = "#888888") => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : d);
    const NAMED = { room: (a) => k.room(a), window: (a) => k.window(a), fireplace: (a) => k.fireplace(a), table: (a) => k.table(a), building: (a) => k.building(a), tree: (a) => k.tree(a), lamp: (a) => k.lamp(a), lighthouse: (a) => k.lighthouse(a), boat: (a) => k.boat(a), jar: (a) => k.jar(a), sprout: (a) => k.sprout(a), cross: (a) => k.cross(a), heart: (a) => k.heart(a), moon: (a) => k.moon(a), sun: (a) => k.sun(a), stars: (a) => k.stars(a), clouds: (a) => k.clouds(a), ridge: (a) => k.ridge(a), ground: (a) => k.ground(a), water: (a) => k.water(a), path: (a) => k.path(a), city: (a) => k.city(a), trunks: (a) => k.trunks(a), haze: (a) => k.haze(a), furnish: (a) => k.furnish(a.kind, a), sky: (a) => k.sky(a) };
    k.recipe = (layers = [], { extend = true } = {}) => {
      for (const L of (layers || []).slice(0, 90)) {
        try {
          const a = L || {}, fl = a.flicker ? 1 + a.flicker * Math.sin(t * 7 + (a.x || 0) * 9) : 1, col = CLR(a.color);
          if (a.op === "fill") { const st = (a.stops || [col]).map((c) => CLR(c)), y0 = RC(a.y0, 0), y1 = RC(a.y1, 1), gr = g.createLinearGradient(0, Y(y0), 0, Y(y1)); st.forEach((c, i) => gr.addColorStop(st.length > 1 ? i / (st.length - 1) : 0, c)); g.fillStyle = gr; g.fillRect(0, Y(y0), W, (extend && y1 >= 1 ? FH : Y(y1)) - Y(y0)); }
          else if (a.op === "rect") { const ry = RC(a.y, 0), rh = RC(a.h, 0.1); g.fillStyle = alpha(col, RC(a.a, 1, 0, 1) * fl); g.fillRect(X(RC(a.x, 0)), Y(ry), RC(a.w, 0.1) * W, extend && ry + rh >= 0.98 ? FH - Y(ry) : rh * H); }   // a shape that reaches the bottom of the frame carries on below it
          else if (a.op === "ellipse") { g.fillStyle = alpha(col, RC(a.a, 1, 0, 1) * fl); g.beginPath(); g.ellipse(X(RC(a.x, 0.5)), Y(RC(a.y, 0.5)), RC(a.rx, 0.05) * W, RC(a.ry, 0.05) * H, 0, 0, TAU); g.fill(); }
          else if (a.op === "poly") { const pts = (a.points || []).slice(0, 40).filter((p) => Array.isArray(p) && p.length >= 2); if (pts.length >= 3) { g.fillStyle = alpha(col, RC(a.a, 1, 0, 1) * fl); g.beginPath(); pts.forEach(([px, py], i) => { const yy = extend && py >= 0.98 ? FH / H : py; i ? g.lineTo(X(RC(px, 0)), Y(RC(yy, 0, -2, 4))) : g.moveTo(X(RC(px, 0)), Y(RC(yy, 0, -2, 4))); }); g.closePath(); g.fill(); } }
          else if (a.op === "line") { g.strokeStyle = col; g.lineWidth = Math.max(1, RC(a.width, 0.004, 0, 0.1) * H); g.lineCap = "round"; g.beginPath(); g.moveTo(X(RC(a.x1, 0)), Y(RC(a.y1, 0))); g.lineTo(X(RC(a.x2, 1)), Y(RC(a.y2, 1))); g.stroke(); }
          else if (a.op === "glow") k.glow({ x: RC(a.x, 0.5), y: RC(a.y, 0.5), r: RC(a.r, 0.15, 0, 1), color: col, a: RC(a.a, 0.5, 0, 1) * fl });
          else if (a.op === "rays") k.rays({ x: RC(a.x, 0.5), y: RC(a.y, 0), angle: RC(a.angle, 1.57, -7, 7), spread: RC(a.spread, 0.6, 0, 3), n: Math.round(RC(a.n, 7, 1, 14)), a: RC(a.a, 0.2, 0, 1), width: RC(a.width, 0.05, 0, 0.3), color: col });
          else if (NAMED[a.op]) { const args = { ...a }; delete args.op; for (const key of Object.keys(args)) if (typeof args[key] === "string" && /^#[0-9a-f]{6}$/i.test(args[key])) args[key] = CLR(args[key]); NAMED[a.op](args); }
        } catch (e) { /* one bad layer never stops the picture */ }
      }
    };
    k.cross = ({ x = 0.5, y = 0.7, h = 0.2, color = "#3a2c24" } = {}) => { g.fillStyle = color; const th = h * H; g.fillRect(X(x) - th * 0.035, Y(y) - th, th * 0.07, th); g.fillRect(X(x) - th * 0.2, Y(y) - th * 0.78, th * 0.4, th * 0.07); };
    k.heart = ({ x = 0.5, y = 0.5, s = 0.1, color = "#d9534f" } = {}) => {
      const sz = s * H, cx = X(x), cy = Y(y) + Math.sin(t * 2) * 0.004 * H; g.fillStyle = color; g.beginPath();
      g.moveTo(cx, cy + sz * 0.35); g.bezierCurveTo(cx - sz * 0.7, cy - sz * 0.05, cx - sz * 0.35, cy - sz * 0.6, cx, cy - sz * 0.22); g.bezierCurveTo(cx + sz * 0.35, cy - sz * 0.6, cx + sz * 0.7, cy - sz * 0.05, cx, cy + sz * 0.35); g.fill();
    };
    k.rain = ({ n = 200, a = 0.5, slant = 0.1, color = "#dfe8f0" } = {}) => {
      const r = R(91); g.strokeStyle = alpha(color, a); g.lineWidth = Math.max(1, 0.0022 * H); g.lineCap = "round"; g.beginPath();
      for (let i = 0; i < n; i++) { const sp = 0.9 + r() * 0.6, y0 = ((r() + t * sp * 1.2) % 1.1) - 0.05, x0 = (r() + y0 * slant) % 1; g.moveTo(X(x0), Y(y0)); g.lineTo(X(x0 + slant * 0.04), Y(y0 + 0.035)); }
      g.stroke();
    };
    k.snow = ({ n = 160, a = 0.85, color = "#ffffff", wind = 0 } = {}) => {
      const r = R(92); g.fillStyle = alpha(color, a);
      for (let i = 0; i < n; i++) { const sp = 0.12 + r() * (0.2 + wind * 0.3), y0 = (r() + t * sp) % 1, x0 = (r() + Math.sin(t * 0.7 + i) * 0.02 + t * wind * (0.18 + r() * 0.3) + 10) % 1; g.beginPath(); g.arc(X(x0), Y(y0), (0.002 + r() * 0.004) * H, 0, TAU); g.fill(); }
    };
    /** Fog: a veil over everything drawn so far; it swallows the far distance and softens the near. */
    k.fog = ({ a = 0.7, color = "#dfe6ea", y = 0.55 } = {}) => {
      const gr = g.createLinearGradient(0, 0, 0, FH); gr.addColorStop(0, alpha(color, a * 0.85)); gr.addColorStop(clamp(y, 0.1, 0.9), alpha(color, a)); gr.addColorStop(1, alpha(color, a * 0.7));
      g.fillStyle = gr; g.fillRect(0, 0, W, FH);
      const r = R(77); for (let i = 0; i < 6; i++) { const cx = ((r() + t * 0.01 * (1 + r()) + 1) % 1.4) - 0.2, cy = y + (r() - 0.5) * 0.3; g.fillStyle = alpha(color, a * 0.25); g.beginPath(); g.ellipse(X(cx), Y(cy), W * (0.3 + r() * 0.3), H * 0.06, 0, 0, TAU); g.fill(); }
    };
    /** Falling autumn leaves. */
    k.leaves = ({ n = 36 } = {}) => {
      const r = R(93), cols = ["#c8651b", "#d9902a", "#a8321e", "#e0b23a"];
      for (let i = 0; i < n; i++) {
        const sp = 0.05 + r() * 0.08, y0 = (r() + t * sp) % 1, x0 = (r() + Math.sin(t * 0.8 + i) * 0.05 + t * 0.02 + 10) % 1, s = (0.006 + r() * 0.008) * H, c = cols[i % 4];
        g.save(); g.translate(X(x0), Y(y0)); g.rotate(t * (0.6 + r()) + i); g.fillStyle = c; g.beginPath(); g.ellipse(0, 0, s, s * 0.55, 0, 0, TAU); g.fill(); g.restore();
      }
    };
    k.motes = ({ n = 30, y0 = 0.3, y1 = 0.9, color = "#fff4b8" } = {}) => {
      const r = R(93);
      for (let i = 0; i < n; i++) { const bx = r(), by = lerp(y0, y1, r()), ph = r() * 6, tw = 0.5 + 0.5 * Math.sin(t * (1 + r()) + ph); g.fillStyle = alpha(color, 0.25 + 0.6 * tw); g.beginPath(); g.arc(X(bx + Math.sin(t * 0.5 + ph) * 0.015), Y(by + Math.cos(t * 0.4 + ph) * 0.012), (0.0025 + r() * 0.004) * H, 0, TAU); g.fill(); }
    };

    // ---- people: faceless on purpose, so they read at any size ----
    k.person = (opts = {}) => {
      if (opts.rim && !opts._rim) {
        const d = Math.max(2, 0.0035 * H);
        for (const [ox, oy] of [[-d, 0], [d, 0], [0, -d], [d * 0.7, -d * 0.7], [-d * 0.7, -d * 0.7], [0, d * 0.6]]) { g.save(); g.translate(ox, oy); k.person({ ...opts, rim: null, silhouette: opts.rim, _rim: true }); g.restore(); }
        return k.person({ ...opts, rim: null, _rim: true });
      }
      return drawPerson(opts);
    };
    const drawPerson = ({ x = 0.5, y = 0.85, h = 0.25, pose = "stand", facing = "front", hair = "short", skin = "#d9a47a", hairColor = "#2a1d17", top = "#4a6fa5", bottom = "#2f3a55", robe = false, build = 1, headScale = 1, stoop = 0, dress = false, mood = "neutral", extras = [], silhouette = null, rim = null, dx = 0, walk = 1.2, flip = false } = {}) => {
      const th = h * H, cx = X(x + dx * p) , cyFoot = Y(y), fl = flip ? -1 : 1;
      const col = (c) => silhouette || c, sk = col(skin), hc = col(hairColor), tc = col(top), bc = col(bottom);
      const head = th * 0.13 * headScale, neck = cyFoot - th * (0.82 - stoop), hipY = cyFoot - th * 0.46, shY = cyFoot - th * (0.74 - stoop), sw = th * 0.17 * build;   // build widens the shoulders, a child has a bigger head, the old stoop
      const stepPh = t * walk * TAU * 0.5, bob = pose === "walk" || pose === "climb" ? Math.abs(Math.sin(stepPh)) * th * 0.012 : 0;
      const drop = pose === "kneel" ? th * 0.22 : 0;                       // kneeling: the whole body comes down so the knee meets the ground
      g.save(); g.translate(cx, -bob + drop); g.lineCap = "round"; g.lineJoin = "round";
      const limb = (x0, y0, x1, y1, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
      const kneel = pose === "kneel", sit = pose === "sit";
      const baseY = kneel ? cyFoot : cyFoot, hip = kneel ? hipY : sit ? hipY + th * 0.1 : hipY;
      // rim light behind the figure
      // legs
      if (!robe) {
        if (pose === "climb") { const a = Math.sin(stepPh); limb(0, hip, th * 0.05, baseY - Math.max(0, a) * th * 0.11, th * 0.075, bc); limb(0, hip, -th * 0.05, baseY - Math.max(0, -a) * th * 0.11, th * 0.075, bc); }   // up a stair: each knee lifts in turn
        else if (pose === "walk") { const a = Math.sin(stepPh) * th * 0.11; limb(0, hip, a, baseY, th * 0.075, bc); limb(0, hip, -a, baseY, th * 0.075, bc); }
        else if (kneel) { const gy = cyFoot - drop; limb(th * 0.02 * fl, hip, th * 0.07 * fl, gy - th * 0.02, th * 0.085, bc); limb(th * 0.07 * fl, gy - th * 0.02, -th * 0.16 * fl, gy - th * 0.02, th * 0.075, bc); limb(-th * 0.02 * fl, hip, th * 0.2 * fl, gy - th * 0.1, th * 0.08, bc); limb(th * 0.2 * fl, gy - th * 0.1, th * 0.2 * fl, gy - th * 0.02, th * 0.07, bc); }
        else if (sit) { limb(0, hip, th * 0.2 * fl, hip + th * 0.02, th * 0.08, bc); limb(th * 0.2 * fl, hip + th * 0.02, th * 0.22 * fl, baseY, th * 0.075, bc); }
        else { limb(-th * 0.05, hip, -th * 0.06, baseY, th * 0.08, bc); limb(th * 0.05, hip, th * 0.06, baseY, th * 0.08, bc); }
      }
      const drawTorso = () => {
        g.fillStyle = tc; g.beginPath();
        const tw = ["left", "right"].includes(facing) ? sw * 0.72 : sw;
        if (robe) { const hemY = kneel ? cyFoot - drop : cyFoot - th * 0.02, sway = pose === "walk" || pose === "climb" ? Math.sin(stepPh) * th * 0.03 : 0; g.moveTo(-tw * 0.6, shY); g.lineTo(tw * 0.6, shY); g.lineTo(tw * 1.25 + sway, hemY); g.lineTo(-tw * 1.25 + sway, hemY); }
        else if (dress && !kneel && !sit) { const hemY = hip + th * 0.2, sway = pose === "walk" || pose === "climb" ? Math.sin(stepPh) * th * 0.02 : 0; g.moveTo(-tw * 0.62, shY); g.lineTo(tw * 0.62, shY); g.lineTo(tw * 1.0 + sway, hemY); g.lineTo(-tw * 1.0 + sway, hemY); }   // a dress or skirt to the knee, legs below it
        else { g.moveTo(-tw * 0.62, shY); g.lineTo(tw * 0.62, shY); g.lineTo(tw * 0.45, hip + th * 0.03); g.lineTo(-tw * 0.45, hip + th * 0.03); }
        g.closePath(); g.fill();
      };
      // arms: in side profile, the far arm is drawn behind the torso and the near arm in front
      const armW = th * 0.065, shl = -sw * 0.6, shr = sw * 0.6, sy = shY + th * 0.03, prof = ["left", "right"].includes(facing), pDir = facing === "left" ? -1 : 1;
      const farSide = prof ? (pDir > 0 ? -1 : 1) : 0, armQueue = { far: [], near: [] };
      const A = (side, ex, ey, mx, my) => {
        const isFar = side === farSide, s = prof ? pDir * (isFar ? 0.04 : -0.03) * sw : (side < 0 ? shl : shr);
        const ex2 = prof && ["hold", "reach", "point"].includes(pose) ? pDir * th * (isFar ? 0.24 : 0.21) : ex;
        const mx2 = prof && ["hold", "reach", "point"].includes(pose) ? pDir * th * (isFar ? 0.13 : 0.1) : mx;
        const tcArm = isFar && !silhouette ? mix(tc, "#15122a", 0.2) : tc;
        armQueue[isFar ? "far" : "near"].push(() => { limb(s, sy, mx2, my, armW, tcArm); limb(mx2, my, ex2, ey, armW * 0.9, sk); });
      };
      switch (pose) {
        case "open": A(-1, -th * 0.42, sy - th * 0.04, -th * 0.28, sy + th * 0.02); A(1, th * 0.42, sy - th * 0.04, th * 0.28, sy + th * 0.02); break;
        case "reach": A(-1, -th * 0.06, sy + th * 0.28, -th * 0.12, sy + th * 0.12); A(1, th * 0.2, sy - th * 0.42, th * 0.13, sy - th * 0.14); break;
        case "pray": A(-1, -th * 0.02, sy + th * 0.02, -th * 0.12, sy + th * 0.14); A(1, th * 0.02, sy + th * 0.02, th * 0.12, sy + th * 0.14); break;
        case "hold": A(-1, -th * 0.03, sy + th * 0.34, -th * 0.12, sy + th * 0.2); A(1, th * 0.05, sy + th * 0.3, th * 0.13, sy + th * 0.18); break;
        case "wave": A(-1, -th * 0.05, sy + th * 0.34, -th * 0.12, sy + th * 0.2); A(1, th * 0.2, sy - th * 0.3 + Math.sin(t * 6) * th * 0.04, th * 0.16, sy - th * 0.05); break;
        case "cheer": A(-1, -th * 0.25, sy - th * 0.36, -th * 0.18, sy - th * 0.12); A(1, th * 0.25, sy - th * 0.36, th * 0.18, sy - th * 0.12); break;
        case "hug": A(-1, th * 0.2 * fl, sy + th * 0.12, -th * 0.12, sy + th * 0.1); A(1, th * 0.28 * fl, sy + th * 0.08, th * 0.14, sy + th * 0.1); break;
        case "walk": case "climb": { const sw2 = Math.sin(stepPh) * th * 0.1; A(-1, -th * 0.05 - sw2, sy + th * 0.3, -th * 0.1, sy + th * 0.16); A(1, th * 0.05 + sw2, sy + th * 0.3, th * 0.1, sy + th * 0.16); break; }
        case "cross": A(-1, th * 0.09, sy + th * 0.15, -th * 0.13, sy + th * 0.17); A(1, -th * 0.09, sy + th * 0.12, th * 0.13, sy + th * 0.15); break;               // arms folded across the chest
        case "point": A(-1, -th * 0.07, sy + th * 0.32, -th * 0.12, sy + th * 0.18); A(1, th * 0.46, sy + th * 0.03, th * 0.22, sy + th * 0.05); break;                  // one arm out, pointing
        case "shrug": A(-1, -th * 0.2, sy + th * 0.08, -th * 0.16, sy + th * 0.2); A(1, th * 0.2, sy + th * 0.08, th * 0.16, sy + th * 0.2); break;                     // elbows in, palms up
        case "hip": A(-1, -th * 0.1, sy + th * 0.27, -th * 0.22, sy + th * 0.17); A(1, th * 0.1, sy + th * 0.27, th * 0.22, sy + th * 0.17); break;                      // hands on hips
        default: A(-1, -th * 0.07, sy + th * 0.32, -th * 0.12, sy + th * 0.18); A(1, th * 0.07, sy + th * 0.32, th * 0.12, sy + th * 0.18);
      }
      armQueue.far.forEach((fn) => fn());
      drawTorso();
      armQueue.near.forEach((fn) => fn());
      if (extras.includes("cane") && !silhouette) { limb(th * 0.2 * fl, baseY, th * 0.14 * fl, hip + th * 0.02, th * 0.025, "#5a4030"); limb(th * 0.14 * fl, hip + th * 0.02, th * 0.1 * fl, hip + th * 0.02, th * 0.03, "#5a4030"); }
      if (extras.includes("scarf") && !silhouette) { g.fillStyle = "#b5483a"; g.beginPath(); g.ellipse(0, shY - th * 0.005, sw * 0.62, th * 0.03, 0, 0, TAU); g.fill(); g.fillRect(sw * 0.12 * fl, shY, th * 0.04, th * 0.12); }
      // head, hair, neck
      limb(0, shY, 0, neck + head * 0.4, th * 0.05, sk);
      g.fillStyle = sk; g.beginPath(); g.ellipse(0, neck, head * 0.92, head * 1.08, 0, 0, TAU); g.fill();
      g.fillStyle = hc;
      if (facing === "back") { g.beginPath(); g.ellipse(0, neck - head * 0.05, head * 0.98, head * 1.12, 0, 0, TAU); g.fill(); }
      if (hair === "long") { g.beginPath(); g.ellipse(0, neck - head * 0.3, head * 1.0, head * 0.78, 0, Math.PI, TAU); g.fill(); g.fillRect(-head, neck - head * 0.3, head * 0.38, head * 2.5); g.fillRect(head * 0.62, neck - head * 0.3, head * 0.38, head * 2.5); }
      else if (hair === "bun") { g.beginPath(); g.ellipse(0, neck - head * 0.3, head, head * 0.74, 0, Math.PI, TAU); g.fill(); g.beginPath(); g.arc(0, neck - head * 1.28, head * 0.38, 0, TAU); g.fill(); }
      else if (hair === "hood") { g.fillStyle = tc; g.beginPath(); g.ellipse(0, neck - head * 0.05, head * 1.15, head * 1.25, 0, 0, TAU); g.fill(); g.fillStyle = sk; if (facing !== "back") { g.beginPath(); g.ellipse(0, neck + head * 0.1, head * 0.7, head * 0.85, 0, 0, TAU); g.fill(); } }
      else if (hair === "beard") { g.beginPath(); g.ellipse(0, neck - head * 0.3, head, head * 0.7, 0, Math.PI, TAU); g.fill(); if (facing !== "back") { g.beginPath(); g.ellipse(0, neck + head * 0.55, head * 0.78, head * 0.7, 0, 0, Math.PI); g.fill(); } }
      else if (hair !== "bald") { g.beginPath(); g.ellipse(0, neck - head * 0.3, head, head * 0.72, 0, Math.PI, TAU); g.fill(); }
      if (extras.includes("hat") && !silhouette && hair !== "hood") { g.fillStyle = "#5a4632"; g.beginPath(); g.ellipse(0, neck - head * 0.62, head * 1.35, head * 0.2, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(0, neck - head * 0.78, head * 0.82, head * 0.52, 0, Math.PI, TAU); g.fill(); }
      // a face: eyes, brows and a mouth that say what this person feels (only seen from the front; a silhouette has none)
      if (facing !== "back" && !silhouette && hair !== "hood") {
        const ink = "#2a1d17", ey = neck - head * 0.08, ex = head * 0.36, lw = Math.max(1.5, head * 0.1);
        g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = "round"; g.lineWidth = lw;
        const blink = Math.sin(t * 0.9 + head) > 0.985 ? 0.15 : 1;                       // an occasional blink keeps a held shot alive
        for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(sd * ex, ey, head * 0.1, head * 0.115 * blink * (mood === "surprised" ? 1.5 : mood === "laugh" ? 0.5 : 1), 0, 0, TAU); g.fill(); }
        const brow = (sd, lift, tilt) => { g.beginPath(); g.moveTo(sd * ex - head * 0.18, ey - head * (0.27 + lift) + sd * tilt * head); g.lineTo(sd * ex + head * 0.18, ey - head * (0.27 + lift) - sd * tilt * head); g.stroke(); };
        const my = neck + head * 0.5;
        // a mouth on a beard has to show: dark ink vanishes on a dark beard, so it is drawn light there (and dark on a pale one)
        if (hair === "beard") { const n = parseInt(hc.slice(1), 16), lum = (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; g.strokeStyle = g.fillStyle = lum < 0.5 ? "#f1e2d4" : "#2a1d17"; }
        if (mood === "smile") { brow(-1, 0, 0); brow(1, 0, 0); g.beginPath(); g.arc(0, my - head * 0.18, head * 0.3, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
        else if (mood === "laugh") { brow(-1, 0.05, 0.05); brow(1, 0.05, 0.05); g.beginPath(); g.ellipse(0, my, head * 0.32, head * 0.22, 0, 0, Math.PI); g.fill(); }
        else if (mood === "skeptical") { brow(-1, 0.02, -0.06); brow(1, 0.12, 0); g.beginPath(); g.moveTo(-head * 0.28, my + head * 0.03); g.lineTo(head * 0.28, my - head * 0.06); g.stroke(); }
        else if (mood === "worried") { brow(-1, 0.1, 0.1); brow(1, 0.1, 0.1); g.beginPath(); g.arc(0, my + head * 0.22, head * 0.24, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); }
        else if (mood === "sad") { brow(-1, 0.08, 0.12); brow(1, 0.08, 0.12); g.beginPath(); g.arc(0, my + head * 0.25, head * 0.26, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke(); }
        else if (mood === "surprised") { brow(-1, 0.16, 0); brow(1, 0.16, 0); g.beginPath(); g.ellipse(0, my + head * 0.04, head * 0.13, head * 0.17, 0, 0, TAU); g.fill(); }
        else { brow(-1, 0, 0); brow(1, 0, 0); g.beginPath(); g.moveTo(-head * 0.2, my); g.lineTo(head * 0.2, my); g.stroke(); }
        if (extras.includes("glasses")) { g.lineWidth = Math.max(1.5, head * 0.07); for (const sd of [-1, 1]) { g.beginPath(); g.arc(sd * ex, ey, head * 0.24, 0, TAU); g.stroke(); } g.beginPath(); g.moveTo(-ex + head * 0.24, ey); g.lineTo(ex - head * 0.24, ey); g.stroke(); }
      }
      g.restore();
    };
    return k;
  }
  window.PaintedKit = { make, rng, hashStr, mix, alpha, clamp, lerp };
})();

// --- layout.js ---
/* Shared, pure layout solver. Browser and Node tests use the same geometry. */
(function () {
  const number = (v, fallback, lo, hi) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  function geometry(p, base, place, needsLand, aspect) {
    const heights = { rock: 0.16, lighthouse: 0.34, lamp: 0.26, house: 0.2, tree: 0.34, table: 0.082, jar: 0.1, sprout: 0.1, cross: 0.24, custom: 0.22 };
    const h = number(p.h, heights[p.kind] ?? 0.2, 0.02, p.kind === "lighthouse" ? 0.4 : 0.65);
    const w = number(p.w, p.kind === "rock" ? 0.5 : p.kind === "table" ? 0.3 : p.kind === "lighthouse" ? h * 0.24 * aspect : 0.3, 0.03, 0.95);
    const offsets = { lamp: 0.02, house: 0.1, tree: 0.04, table: 0.04, jar: 0.03, sprout: 0.03, cross: 0.04 };
    let y = base - (offsets[p.kind] ?? 0);
    if (p.kind === "lighthouse") y = needsLand ? 0.84 : place === "sea" ? 0.64 : base - 0.2;
    if (p.kind === "boat") y = ["sea", "lake"].includes(place) ? 0.72 : base - 0.2;
    if (p.kind === "rock" && ["sea", "lake"].includes(place)) y = 0.84;
    // Only root placement uses x. Attached objects use a fraction of their support's usable width.
    return { prop: p, x: number(p.x, 0.5, 0.03, 0.97), y, w, h };
  }
  function layout(props, { base = 0.88, place = "meadow", needsLand = false, aspect = 16 / 9, project } = {}) {
    const byId = new Map(props.filter(p => p.id).map(p => [p.id, p]));
    const done = new Map(), active = new Set(), out = [];
    function solve(p) {
      if (done.has(p)) return done.get(p);
      if (active.has(p)) throw new Error(`Cyclic support: ${p.id}`);
      active.add(p);
      let target;
      if (p.on) {
        const parent = byId.get(p.on);
        if (!parent) throw new Error(`Missing support: ${p.on}`);
        target = solve(parent);
      }
      const node = project ? project(p, target) : geometry(p, base, place, needsLand, aspect);
      if (target) {
        // an object the director put something on but gave no surface (a sapling "on" a tree): the thing sits at the top middle of its box rather than the film aborting
        const s = target.surface ?? { x: target.x, y: target.y - target.h * 0.9, w: target.w * 0.5 };
        // Keep the child's footprint on the usable surface, including at either edge.
        if (project && node.w > s.w * .9) { const fit = s.w * .9 / node.w; node.w *= fit; node.h *= fit; }
        const reach = project ? Math.max(0, s.w - node.w) : s.w;
        node.x = s.x + number(p.offset, 0, -0.5, 0.5) * reach;
        node.y = s.y;
      }
      const s = p.surface ?? p.recipe?.surface;
      if (p.kind === "pond") node.surface = { x: node.x, y: node.y - node.h * 0.15, w: node.w * 0.5 };
      else if (p.kind === "rock") node.surface = { x: node.x, y: node.y - node.h * 0.8, w: node.w * 0.48 };
      else if (p.kind === "table") node.surface = { x: node.x, y: node.y - node.h, w: node.w * 0.9 };
      else if (s) node.surface = { x: node.x + (number(s.x, 0.5, 0, 1) - 0.5) * node.w, y: node.y - node.h + number(s.y, 0, 0, 1) * node.h, w: number(s.w, 0.6, 0.01, 1) * node.w };
      active.delete(p); done.set(p, node); out.push(node); return node;
    }
    props.forEach(solve);
    return out;
  }
  // Approximate physical dimensions in metres, not independent fractions of the image.
  // These are art-direction defaults; explicit dimensions override them for unusual subjects.
  const DIMENSIONS = {
    table: { height: .78, width: 1.4 }, pond: { height: .3, width: 5 }, groundmark: { height: .02, width: 1.4 }, jar: { height: .28, width: .22 },
    lamp: { height: 3, width: .6 }, lighthouse: { height: 18, width: 4.32 },
    house: { height: 3.5, width: 4.5 }, tree: { height: 5, width: 3 },
    rock: { height: 2, width: 12 }, sprout: { height: .18, width: .2 },
    cross: { height: 2, width: .8 }, boat: { height: 3.3, width: 3.8 },
    custom: { height: 1, width: .7 }
  };
  const FRAMING = { wide: .26, medium: .38, close: .52 };
  const personHeight = s => number(s.heightM, s.age === "child" ? 1.1 : 1.7, .3, 3);
  const depthOf = p => number(p.depth, 0, 0, 1);
  const perspective = depth => 1 / (1 + depth * .9);
  function compose(shot, options = {}) {
    const props = shot.props || [], people = shot.subjects || [], aspect = options.aspect || 16 / 9;
    const byId = new Map(props.filter(p => p.id).map(p => [p.id, p]));
    const dimensions = new Map(), resolving = new Set();
    function measure(p) {
      if (dimensions.has(p)) return dimensions.get(p);
      if (resolving.has(p)) throw new Error(`Cyclic support: ${p.id}`);
      resolving.add(p);
      let d = DIMENSIONS[p.kind];
      if (!d || (p.kind === "custom" && p.recipe?.space !== "object" && !p.dimensions)) { resolving.delete(p); return null; }
      d = { ...d };
      if (p.kind === "custom" && p.on && byId.has(p.on)) {
        const parent = byId.get(p.on), pd = measure(parent);
        if (pd) {
          // Migrate legacy custom assets using their size ratio to the parent, not raw screen size.
          d.height = pd.height * number(p.h / parent.h, .35, .05, 1.5);
          d.width = pd.width * number(p.w / parent.w, .45, .05, .9);
        }
      }
      const fixed = p.dimensions || {};
      d.height = number(fixed.height, d.height, .01, 1000);
      d.width = number(fixed.width, d.width, .01, 1000);
      dimensions.set(p, d); resolving.delete(p); return d;
    }
    props.forEach(measure);
    // Fit a complete support chain and its people, not just the tallest individual object.
    const elevation = new Map(), depths = new Map(), active = new Set();
    function ground(p) {
      if (elevation.has(p)) return elevation.get(p);
      if (active.has(p)) throw new Error(`Cyclic support: ${p.id}`);
      active.add(p);
      const parent = p.on ? byId.get(p.on) : null;
      let y = 0, depth = depthOf(p);
      if (parent) {
        const pd = measure(parent), surf = parent.surface ?? parent.recipe?.surface;
        y = ground(parent) + (pd?.height || 0) * (1 - number(surf?.y, parent.kind === "rock" ? .2 : 0, 0, 1));
        depth = depths.get(parent);
      }
      active.delete(p); depths.set(p, depth); elevation.set(p, y); return y;
    }
    let tallest = 1.7, widest = 1;
    for (const p of props) {
      const d = measure(p); if (!d || p.dressing) continue;                                // set dressing is background: it never decides how the shot is framed
      const y = ground(p), f = perspective(depths.get(p));
      tallest = Math.max(tallest, (y + d.height * (p.kind === "lighthouse" ? 1.21 : p.kind === "house" ? 1.25 : 1)) * f);
      widest = Math.max(widest, d.width * f);
    }
    for (const p of people) {
      const parent = byId.get(p.on), pd = parent && measure(parent), surface = parent?.surface ?? parent?.recipe?.surface;
      const top = parent ? ground(parent) + (pd?.height || 0) * (1 - number(surface?.y, parent.kind === "rock" ? .2 : 0, 0, 1)) : 0;
      tallest = Math.max(tallest, (top + personHeight(p)) * perspective(parent ? depths.get(parent) : depthOf(p)));
    }
    const requested = FRAMING[shot.framing] || (shot.place === "interior" ? .38 : .30);
    const unit = Math.min(requested / 1.7, .64 / tallest, .86 / (widest * aspect));
    const floor = number(options.base, .9, .5, .98);
    const floorAt = depth => floor - (shot.place === "interior" ? .1 : .13) * depth;
    const nodes = layout(props, { ...options, project: (p, parent) => {
      const d = measure(p);
      if (!d) return geometry(p, floor, options.place || shot.place, options.needsLand, aspect);
      const depth = parent?.depth ?? depthOf(p), u = unit * perspective(depth);
      // a boat floats: on a shore its whole hull (0.18 of its width deep) sits in the water, its keel at the waterline where the sand begins
      const water = p.kind === "boat" ? { shore: .765, sea: .88, lake: .88 }[options.place || shot.place] : undefined;
      return { prop: p, x: number(p.x, .5, .03, .97), y: water !== undefined ? water - .18 * d.width * u : floorAt(depth), w: d.width * u * aspect, h: d.height * u, depth, unit: u };
    } });
    const solved = new Map(nodes.filter(n => n.prop.id).map(n => [n.prop.id, n]));
    const subjects = people.map((p, i) => {
      let parent = solved.get(p.on);
      // someone sits "on" a chair that has no declared surface: the seat is the middle of its box, about half way up; someone "on" a thing that is not there stands on the ground
      if (parent && !parent.surface) parent = { ...parent, surface: { x: parent.x, y: parent.y - parent.h * 0.42, w: parent.w * 0.6 } };
      if (p.on && !parent?.surface) p = { ...p, on: undefined };
      const depth = parent?.depth ?? depthOf(p), h = personHeight(p) * unit * perspective(depth);
      const x = parent ? parent.surface.x + number(p.offset, 0, -.5, .5) * Math.max(0, parent.surface.w - h * .3 * aspect) : number(p.x, people.length > 1 ? .3 + i * .4 / (people.length - 1) : .5, .03, .97);
      return { subject: p, x, y: parent ? parent.surface.y : floorAt(depth), h, depth };
    });
    // People never stand in each other: when a closer framing makes them wider than the gap the director left, they are moved apart (nobody sits in a lap, nobody is behind someone's shoulder).
    const loose = subjects.filter(n => !n.subject.on).sort((a, b) => a.x - b.x);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < loose.length; i++) {
        const a = loose[i - 1], b = loose[i], need = (a.h + b.h) * .5 * .27 * aspect * .95, gap = b.x - a.x;
        // Seen from the side (both in profile) two people standing or sitting beside each other may overlap, the one behind a little higher: that is how a side view looks. From the front they must not.
        const side = ["left", "right"].includes(a.subject.facing) && ["left", "right"].includes(b.subject.facing);
        if (gap < need && side) { if (pass === 0 && gap < need * .8) b.y -= .008; continue; }
        if (gap < need) { const push = (need - gap) / 2; a.x -= push; b.x += push; }
      }
      for (const n of loose) n.x = Math.min(.9, Math.max(.1, n.x));
    }
    // someone standing never overlaps someone seated in a chair (front view): the standing one steps aside
    for (const sit of subjects.filter(n => n.subject.on)) for (const n of loose) {
      const need = (sit.h + n.h) * .5 * .27 * aspect * .95, gap = n.x - sit.x;
      if (Math.abs(gap) < need && !(["left", "right"].includes(n.subject.facing) && ["left", "right"].includes(sit.subject.facing))) n.x = Math.min(.9, Math.max(.1, sit.x + (gap >= 0 ? 1 : -1) * need));
    }
    const bounds = nodes.filter(n => n.unit && !n.prop.dressing).map(n => [n.y - n.h * (n.prop.kind === "lighthouse" ? 1.21 : n.prop.kind === "house" ? 1.25 : 1), n.y]);
    bounds.push(...subjects.map(n => [n.y - n.h * (["wave", "cheer", "reach"].includes(n.subject.pose) ? 1.25 : 1.02), n.y]));
    const frameBounds = bounds.length ? { top: Math.min(...bounds.map(b => b[0])), bottom: Math.max(...bounds.map(b => b[1])) } : null;
    return { props: nodes, subjects, unit, floorAt, frameBounds };
  }
  function frameLift(bounds, scale = 1, translateY = 0) {
    if (!bounds) return .05;
    const top = bounds.top * scale + translateY, bottom = bounds.bottom * scale + translateY;
    return Math.max(0, Math.min(.27, (top + bottom) / 2 - .56, top - .08));
  }
  function detailCamera(node, subjects = [], aspect = 1.78) {
    if (!node || ![node.x, node.y, node.w, node.h].every(Number.isFinite) || node.w <= 0 || node.h <= 0) return null;
    // A small thing near people (a seedling at their feet, a hole being dug) is shown WITH them, from their chest down to the object, never zoomed alone onto the ground between two pairs of legs.
    const near = (subjects || []).filter(n => n && [n.x, n.y, n.h].every(Number.isFinite) && n.h > 0).sort((a, b) => Math.abs(a.x - node.x) - Math.abs(b.x - node.x))[0];
    if (near && node.h < near.h * .5) {
      const pw = near.h * .27 * aspect, x0 = Math.min(node.x - node.w / 2, near.x - pw / 2), x1 = Math.max(node.x + node.w / 2, near.x + pw / 2);
      const y0 = Math.min(node.y - node.h, near.y - near.h * .78), y1 = Math.max(node.y, near.y) + .02;
      const scale = Math.max(1, Math.min(3.2, .8 / (x1 - x0), .62 / (y1 - y0)));
      return { scale, x: .5 - (x0 + x1) / 2 * scale, y: .44 - (y0 + y1) / 2 * scale };
    }
    const scale = Math.max(1, Math.min(6, .62 / node.w, .42 / node.h));
    return { scale, x: .5 - node.x * scale, y: .46 - (node.y - node.h / 2) * scale };
  }
  /** A handover or a picking is seen at the hands: the camera sits between the people at chest height, close enough to read the hands, never down at the ground or up the legs. */
  function handoverCamera(nodes, aspect = 1.78) {
    const ns = (nodes || []).filter(n => n && [n.x, n.y, n.h].every(Number.isFinite) && n.h > 0);
    if (!ns.length) return null;
    const xs = ns.map(n => n.x), span = Math.max(...xs) - Math.min(...xs), hMax = Math.max(...ns.map(n => n.h)), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = ns.reduce((a, n) => a + (n.y - n.h * .62), 0) / ns.length;
    const scale = Math.max(1, Math.min(2.6, .8 / (span + hMax * .3 * aspect), .66 / (hMax * .75)));
    return { scale, x: .5 - cx * scale, y: .46 - cy * scale };
  }
  function portraitCamera(node) {
    if (!node || !Number.isFinite(node.h) || node.h <= 0) return null;
    const scale = Math.max(1, Math.min(5, .65 / (node.h * .55)));
    return { scale, x: .5 - node.x * scale, y: .45 - (node.y - node.h * .77) * scale };
  }
  globalThis.PaintedLayout = { layout, compose, frameLift, detailCamera, handoverCamera, portraitCamera, DIMENSIONS, FRAMING };

})();

// --- plates.js ---
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

// --- scenes.js ---
/*
 * Scenes from words: a shot is described by what is in it (place, time of day, weather, who is there, what stands in the
 * picture), never by code. This file is the only place that knows how to draw each of those. The director fills the
 * description from the line being spoken; an unknown value falls back to a sensible default, so a shot always draws.
 */
(function () {
  const { mix, lerp } = window.PaintedKit;

  const TIMES = {
    dawn:    { sky: ["#3b4a8a", "#c8758a", "#f6c27a"], sun: { x: 0.5, y: 0.6, color: "#fff0c0", glow: "#ffb878", a: 0.6 }, shade: "#4b3f74", amt: 0.38, back: true, rim: "#ffc48a" },
    morning: { sky: ["#8dbbe6", "#f8edc8"], sun: { x: 0.72, y: 0.3, color: "#fff4cc", glow: "#ffe0a0", a: 0.45 }, shade: "#e8c27a", amt: 0.1 },
    day:     { sky: ["#4f84c4", "#a8cdea", "#f7efd0"], sun: { x: 0.5, y: 0.27, color: "#fffbe0", glow: "#fff0b0", a: 0.45 }, shade: "#ffffff", amt: 0 },
    sunset:  { sky: ["#3b3a78", "#b04f6f", "#f08a4b", "#f7c873"], sun: { x: 0.5, y: 0.54, color: "#ffe9a8", glow: "#ffb067", a: 0.6 }, shade: "#4a2f5a", amt: 0.42, back: true, rim: "#ffb36b" },
    dusk:    { sky: ["#232a5c", "#6a4f86", "#d98a78"], sun: null, shade: "#1f2347", amt: 0.58, back: true, rim: "#c98fb0", stars: 30 },
    night:   { sky: ["#0a0e2c", "#252a60", "#4a4a80"], sun: null, shade: "#0b0f2e", amt: 0.78, back: true, rim: "#9db6f0", stars: 90, moon: true }
  };
  const WEATHER = { clear: { clouds: 0 }, cloudy: { clouds: 8, gray: 0.35 }, rain: { clouds: 9, gray: 0.5, rain: 240, haze: 0.3, rough: 0.35 }, sandstorm: { clouds: 0, gray: 0, fog: 0.8, fogColor: "#c98f4c", sand: true, wind: 1 }, blizzard: { clouds: 9, gray: 0.55, snow: 620, wind: 1, whiteout: 0.6, bolts: false, haze: 0.5, shake: true }, storm: { clouds: 11, gray: 0.6, rain: 380, haze: 0.25, rough: 1, bolts: true, slant: 0.3 }, fog: { clouds: 4, gray: 0.3, haze: 0.8, fog: 1 }, snow: { clouds: 8, gray: 0.3, snow: 170 } };
  // what a person's age and build do to the drawing (the library in people.json sets age, build and dress; the painter only draws them)
  const bodyOf = (s) => ({ build: { slim: 0.85, average: 1, stocky: 1.22 }[s.build] ?? 1, headScale: s.age === "child" ? 1.3 : 1, stoop: s.age === "old" ? 0.04 : 0, dress: Boolean(s.dress) });
  const SIZES = { tiny: 0.09, small: 0.17, medium: 0.27, large: 0.45, huge: 0.62 };
  const BASE = { meadow: 0.82, hills: 0.78, lake: 0.9, sea: 0.92, forest: 0.92, city: 0.96, street: 0.94, village: 0.86, mountains: 0.84, desert: 0.84, field: 0.84, shore: 0.9, road: 0.86, sky: 0.9, river: 0.88, interior: 0.9, custom: 0.88 };

  const place0 = (shot) => shot.place === "interior" && shot.room === "lighthouse";
  function draw(k, shot) {
    const indoors = shot.place === "interior" || (shot.place === "custom" && Boolean(shot.recipe && shot.recipe.indoors));
    const T = TIMES[shot.time] || TIMES.day, Wt = indoors ? WEATHER.clear : WEATHER[shot.weather] || WEATHER.clear, place = BASE[shot.place] ? shot.place : "meadow";
    // climbing the lighthouse stair: the camera follows him. Once his feet reach mid-frame he stays there and the stair and wall scroll down (k.stairShift in kit.room)
    const climbU = 0.5 + 6 * k.p, climbStep = Math.floor(climbU), climbFr = climbU - climbStep, climbWorldY = 0.76 - 0.06 * (climbStep + climbFr * climbFr * (3 - 2 * climbFr));
    const climbShift = place0(shot) && (shot.subjects || []).some((s) => s.pose === "climb") ? Math.max(0, 0.62 - climbWorldY) : 0;
    k.stairShift = climbShift;
    const season = shot.season, gray = (Wt.gray || 0) + (season === "winter" ? 0.22 : 0), tint = (c, extra) => mix(mix(c, "#8e98a4", gray * 0.6), T.shade, Math.min(0.92, T.amt + (extra || 0)));
    const sky = T.sky.map((c) => mix(c, "#9aa6b2", gray * 0.7));
    if (!indoors) k.sky({ stops: sky });
    if (T.stars && !indoors && !Wt.fog) k.stars({ n: T.stars, y1: 0.5 });
    const hasProp = (kind) => (shot.props || []).some((p) => p.kind === kind);   // a moon or sun the director placed replaces the sky's own: never two
    if (!indoors && T.sun && !Wt.rain && !Wt.fog && !hasProp("sun")) k.sun({ x: T.sun.x, y: T.sun.y, r: 0.065, color: T.sun.color, glow: T.sun.glow, glowSize: 0.5, glowAlpha: T.sun.a * (1 - gray) });
    if (!indoors && T.moon && !Wt.rain && !Wt.fog && !hasProp("moon")) k.moon({ x: 0.72, y: 0.27 });
    if (!indoors && Wt.clouds > 0 && (!T.stars || Wt.clouds > 3)) k.clouds({ y: 0.2, band: 0.16, n: Wt.clouds, size: 0.15, color: tint("#ffffff", 0.05), shade: tint("#d6dee6", 0.1), drift: 0.012, seed: 3 });
    const sun = T.sun || { x: 0.5, y: 0.5 };
    const ground = (y, a, b, o) => k.ground({ y, color: tint(a), far: tint(b), stripes: place === "desert" ? 0 : 14, flowers: snowy || dry || season === "autumn" ? 0 : ((o && o.flowers) || 0) * (season === "spring" ? 2.2 : 1), flower: tint("#fff7e0") });
    const snowy = shot.weather === "snow" || shot.weather === "blizzard" || season === "winter";   // winter: the ground is white even when no snow is falling
    const dry = shot.ground === "dry";                                  // drought, dust, barren: the green of the grass and hills turns to ochre and sand
    const gc = (day) => (snowy ? "#e9eff4" : dry ? mix(day, "#c9a566", 0.78) : season === "autumn" ? mix(day, "#c9843a", 0.6) : day);

    switch (place) {
      case "meadow": k.ridge({ y: 0.56, amp: 0.035, freq: 3, color: tint(gc("#7fa05a")), shape: "soft", seed: 2 }); ground(0.6, gc("#58a531"), gc("#9cc54a"), { flowers: 70 }); break;
      case "hills": k.ridge({ y: 0.5, amp: 0.035, freq: 1.4, color: tint("#7d93b4"), shape: "soft", seed: 3 }); k.ridge({ y: 0.56, amp: 0.04, freq: 4, color: tint(gc("#5c8a58")), shape: "soft", seed: 6 }); ground(0.62, gc("#7caa42"), gc("#b8cf62"), { flowers: 30 }); if (shot.path === true) k.path({ x: 0.5, near: 0.34, far: 0.03, color: tint("#d9bf8a"), bend: 0.12, horizon: 0.62 }); break;
      case "lake": k.ridge({ y: 0.5, amp: 0.03, freq: 1.6, color: tint("#4f6f7e"), shape: "soft", seed: 7 }); k.ridge({ y: 0.57, amp: 0.03, freq: 6, color: tint("#33593f"), shape: "pines", seed: 9 }); k.water({ y0: 0.58, y1: 1, color: tint("#6aa3b8"), deep: tint("#2b5a74"), glint: mix("#fff6d8", T.shade, T.amt * 0.5), glints: 70 }); k.foliage({ side: "left", color: tint("#315a2c"), light: tint("#8cbf4a") }); break;
      case "sea": k.ridge({ y: 0.6, amp: 0.012, freq: 2, color: tint("#5a7a98"), shape: "soft", seed: 4 }); k.water({ y0: 0.6, y1: 1, color: tint("#5b9ab8"), deep: tint("#1f4a6e"), glint: mix("#fff3cc", T.shade, T.amt * 0.4), glints: 110 }); break;
      case "forest": k.rays({ x: 0.72, y: -0.05, angle: 1.7, spread: 0.55, n: 7, a: T.amt > 0.5 ? 0.08 : 0.26, width: 0.05 }); k.trunks({ n: 9, color: tint("#3b2b22"), light: tint("#7a5b3c"), width: 0.06 }); ground(0.8, gc("#5a8a3a"), gc("#9bbd52"), { flowers: 30 }); k.motes({ n: 40, y0: 0.2, y1: 0.85, color: "#fff4b8" }); break;
      case "city": k.city({ y: 0.72, h: 0.38, color: tint("#2a2f5a"), lit: T.amt > 0.4 ? 0.38 : 0.1, litColor: "#ffd98a", n: 22 }); k.ground({ y: 0.84, color: tint("#3a3f6a"), far: tint("#4a4f7a"), stripes: 4 }); break;
      case "street": if (!(shot.props || []).some((p) => p.kind === "house")) k.house({ x: 0.26, y: 0.8, w: 0.3, h: 0.3, wall: tint("#8a7866"), roof: tint("#4b3a30"), lit: T.amt > 0.3, floors: 2 }); if (!(shot.props || []).some((p) => p.kind === "house")) k.house({ x: 0.76, y: 0.8, w: 0.26, h: 0.25, wall: tint("#7a6a5a"), roof: tint("#44352d"), lit: T.amt > 0.3 }); ground(0.8, "#566070", "#6a7488", { flowers: 0 }); break;
      case "village": k.ridge({ y: 0.55, amp: 0.04, freq: 3, color: tint(gc("#6a9a58")), shape: "soft", seed: 12 }); if (!(shot.props || []).some((p) => p.kind === "house")) k.house({ x: 0.3, y: 0.7, w: 0.2, h: 0.17, wall: tint("#b59a7a"), roof: tint("#8a4a36"), lit: T.amt > 0.3 }); if (!(shot.props || []).some((p) => p.kind === "house")) k.house({ x: 0.68, y: 0.72, w: 0.22, h: 0.18, wall: tint("#c7ad8c"), roof: tint("#7a3f31"), lit: T.amt > 0.3 }); ground(0.7, gc("#6ba540"), gc("#a4c860"), { flowers: 25 }); k.path({ x: 0.5, near: 0.3, far: 0.05, color: tint("#d9bf8a"), bend: -0.08, horizon: 0.7 }); break;
      case "mountains": k.ridge({ y: 0.4, amp: 0.1, freq: 2.2, color: tint("#8aa0bf"), shape: "peaks", seed: 5, snow: tint("#f4f7fb") }); k.ridge({ y: 0.55, amp: 0.07, freq: 3, color: tint("#566b88"), shape: "rocky", seed: 8 }); k.ridge({ y: 0.66, amp: 0.03, freq: 5, color: tint("#2f5a3f"), shape: "pines", seed: 9 }); ground(0.74, gc("#4f7f3f"), gc("#86aa55"), {}); break;
      case "desert": k.ridge({ y: 0.58, amp: 0.05, freq: 2, color: tint("#d9a860"), shape: "soft", seed: 3 }); k.ridge({ y: 0.66, amp: 0.04, freq: 2.6, color: tint("#c9944f"), shape: "soft", seed: 6 }); k.ground({ y: 0.72, color: tint("#c28a47"), far: tint("#e0b66c"), stripes: 0 }); break;
      case "field": k.ridge({ y: 0.56, amp: 0.02, freq: 2, color: tint("#9aa860"), shape: "soft", seed: 5 }); k.ground({ y: 0.58, color: tint(gc("#c9a43a")), far: tint(gc("#e2c460")), stripes: 22, flowers: 0 }); break;
      case "shore": k.water({ y0: 0.52, y1: 0.78, color: tint("#6aaec4"), deep: tint("#3a7a98"), glint: "#ffffff", glints: 60 }); k.ground({ y: 0.76, color: snowy ? tint("#e6edf2") : tint("#e0cfa0"), far: snowy ? tint("#f2f6f9") : tint("#efe2bd"), stripes: 0 }); break;
      case "interior": {                                               // inside a building: a furnished room, a window on the weather outside
        const out = shot.weather === "snow" || shot.weather === "blizzard";
        k.roomOf({ room: shot.room || "cabin", includeTable: !hasProp("table"), wall: mix("#8a6048", "#2a1a14", T.amt * 0.25), floor: mix("#6a4630", "#2a1a14", T.amt * 0.25), night: T.amt > 0.3, snow: out }); break;
      }
      case "custom": k.recipe(shot.recipe && shot.recipe.layers); break;                // a place the vocabulary lacks, drawn from an AI-made recipe
      case "river": k.ridge({ y: 0.55, amp: 0.04, freq: 2.5, color: tint(gc("#6f9a5a")), shape: "soft", seed: 14 }); ground(0.58, gc("#6ba540"), gc("#a4c860"), { flowers: 20 });
        k.path({ x: 0.5, near: 0.86, far: 0.075, color: tint(dry ? "#d9bf8a" : "#cdbb8a"), bend: -0.16, horizon: 0.58 });                      // the banks
        k.path({ x: 0.5, near: 0.7, far: 0.05, color: tint("#4f8fb5"), bend: -0.16, horizon: 0.58 });                                           // the water
        k.path({ x: 0.5, near: 0.5, far: 0.03, color: tint("#7fb8d4"), bend: -0.16, horizon: 0.58 }); break;
      case "road": k.ridge({ y: 0.55, amp: 0.04, freq: 3, color: tint("#7a9a6a"), shape: "soft", seed: 13 }); ground(0.6, gc("#6ba540"), gc("#a4c860"), { flowers: 20 }); k.path({ x: 0.5, near: 0.7, far: 0.04, color: tint("#9a9288"), bend: 0.05, horizon: 0.6 }); break;
      default: k.ridge({ y: 0.82, amp: 0.02, freq: 2, color: tint("#5f8a58"), shape: "soft", seed: 2 }); ground(0.84, gc("#58a531"), gc("#9cc54a"), { flowers: 30 });
    }
    const fogColor = Wt.fogColor ? mix(Wt.fogColor, T.shade, T.amt * 0.45) : T.amt > 0.3 ? mix("#8f98b0", T.shade, T.amt * 0.5) : "#dfe6ea";
    if (Wt.fog) k.fog({ a: 0.78 * Wt.fog, color: fogColor, y: 0.6 });                     // thick fog: the far city and hills are gone
    if (Wt.haze) k.haze({ y: 0.58, h: 0.14, color: tint("#e4ebee"), a: Wt.haze });

    // the sea and lakes have no ground to stand on: anything that stands gets a stretch of rock in front
    const STANDS = ["lighthouse", "cross", "house", "tree", "lamp"];
    const onWater = place === "sea" || place === "lake", boat = onWater ? (shot.props || []).find((p) => p.kind === "boat") : null;
    const rough = onWater ? Wt.rough || 0 : 0;                                  // how wild the water is: the weather decides
    if (rough > 0.2) { k.swell({ y: 0.64, rough, layer: 0, color: tint("#5d83a0"), a: 0.8 }); k.swell({ y: 0.7, rough, layer: 2, color: tint("#35597a"), a: 0.85 }); if (rough > 0.6) k.swell({ y: 0.67, rough, layer: 3, color: tint("#2a4a68"), a: 0.9 }); }
    // one more swell, drawn BEHIND the props: a wave in front would be filled to the bottom of the frame and bury the hull, the rock and the tower
    if (rough > 0.2 && boat) k.swell({ y: 0.8, rough, layer: 1, color: tint("#1c3b57"), a: 0.95 });
    const aboard = (s) => !s.on && boat && (s.aboard !== undefined ? Boolean(s.aboard) : Math.abs((s.x ?? 0.5) - (boat.x ?? 0.5)) < 0.18);   // the relationship layer says who is aboard (spec "aboard"); near-ness is only the fallback
    const needsLand = (place === "sea" || place === "lake") && ((shot.subjects || []).some((s) => !s.on && !aboard(s)) || (shot.props || []).some((p) => STANDS.includes(p.kind) && !p.on));
    if (needsLand) k.ground({ y: 0.8, color: tint("#6b6a66"), far: tint("#8a8984"), stripes: 0 });
    const base = needsLand ? 0.86 : place === "custom" ? ((shot.recipe && shot.recipe.floor_y) || 0.88) : BASE[place], groundY = needsLand ? 0.86 : shot.place === "sea" ? 0.64 : base;
    // props
    const world = window.PaintedLayout.compose(shot, { base, place, needsLand, aspect: k.H / k.W });
    const layout = world.props;
    window.PaintedScenes.objects = layout;
    window.PaintedScenes.frameBounds = world.frameBounds;
    const rockTint = (c) => tint(c, T.amt > 0.3 ? -0.5 : 0);                       // at night a rock stays brown, as if lit by the lamp, so it reads against the dark water
    // far things first, near things last, whatever order the director listed them in (the sort is stable, so a support is still drawn before what stands on it)
    for (const node of [...layout].sort((a, b) => (b.depth || 0) - (a.depth || 0))) {
      const prop = node.prop, px = node.x, py = node.y;
      if (prop.kind === "rock") k.rock({ x: px, y: py, w: node.w, h: node.h, color: rockTint("#8a6445"), light: rockTint("#c49c6c"), dark: rockTint("#4f3626"), rim: T.amt > 0.3 ? mix("#d8e2f4", T.shade, 0.15) : null, foam: onWater ? 0.35 + 0.65 * rough : 0 });
      else if (prop.kind === "lamp") k.lamp({ x: px, y: py, h: node.h });
      else if (prop.kind === "house") k.building({ style: prop.style, x: px, y: py, w: node.w, h: node.h, wall: prop.style ? undefined : tint("#a08a70"), roof: prop.style ? undefined : tint("#6a3f31"), lit: T.amt > 0.3 });
      else if (prop.kind === "custom") {
        const recipe = prop.recipe;
        if (recipe?.space === "object") {
          const g = k.g; g.save(); g.translate(k.X(px - node.w / 2), k.Y(py - node.h)); g.scale(node.w, node.h);
          k.recipe(recipe.layers, { extend: false }); g.restore();
        } else if (prop.on) throw new Error("Attached custom objects require a local-space recipe; regenerate this asset");
        else k.recipe(recipe && recipe.layers); // legacy full-frame recipes stay readable
      }
      else if (prop.kind === "tree") k.tree({ x: px, y: py, h: node.h, kind: prop.style || "round", crown: tint(gc("#4f8a3a")) });
      else if (prop.kind === "boat") k.boat({ x: px, y: py, s: node.w * k.W / k.H, rough, rim: T.amt > 0.3 ? mix("#d8e2f4", T.shade, 0.15) : null });
      else if (prop.kind === "beam") { if ((shot.props || []).some((q) => q.kind === "lighthouse")) continue;  const by = place === "sea" || place === "lake" ? 0.6 : 0.55; k.rays({ x: px, y: by, angle: -1.57, spread: 1.2, n: 7, a: 0.12, width: 0.035, color: "#ffd36a" }); k.glow({ x: px, y: by, r: 0.2, color: "#ffc850", a: 0.7 }); k.sun({ x: px, y: by, r: 0.018, color: "#fff6c8", glow: "#ffd36a", glowSize: 0.12, glowAlpha: 0.9 }); }
      else if (prop.kind === "lighthouse") { k.lighthouse({ x: px, y: py, h: node.h });
        if (T.amt > 0.3) { const ly = (py) - node.h - 0.03; k.rays({ x: px, y: ly, angle: px < 0.5 ? 0.0 : Math.PI, spread: 0.45, n: 5, a: 0.3, width: 0.05, color: "#ffe9a0" }); } }
      else if (prop.kind === "table") k.table({ x: px, y: py, w: node.w, h: node.h, bread: prop.bread ?? !(prop.id && (shot.props || []).some(p => p.on === prop.id)) });
      else if (prop.kind === "jar") { if (prop.on || !(shot.subjects || []).length) k.jar({ x: px, y: py, h: node.h }); }   // with people, it is drawn in their hands, below
      else if (prop.kind === "groundmark") k.groundmark({ x: px, y: py, w: Math.max(node.w, 0.18), shape: prop.shape || "sun" });
      else if (prop.kind === "pond") k.pond({ x: px, y: py, w: node.w, h: node.h, ice: Boolean(snowy) });
      else if (prop.kind === "sprout") k.sprout({ x: px, y: py, h: node.h });
      else if (prop.kind === "cross") k.cross({ x: px, y: py, h: node.h, color: tint("#3a2c24") });
      else if (prop.kind === "heart") k.heart({ x: px, y: prop.y ?? 0.5, s: prop.s ?? 0.12 });
      else if (prop.kind === "moon") k.moon({ x: px, y: prop.y ?? 0.22 });
      else if (prop.kind === "sun") k.sun({ x: px, y: prop.y ?? 0.35, r: 0.07, color: "#fff2c0", glow: "#ffd08a", glowSize: 0.55, glowAlpha: 0.55 });
    }
    if (Wt.fog) k.fog({ a: 0.32 * Wt.fog, color: fogColor, y: 0.6 });                      // near things are softened too
    // people
    window.PaintedScenes.heldJar = (shot.props || []).find((p) => p.kind === "jar" && !p.on) || null;
    const people = shot.subjects || [];
    window.PaintedScenes.heads = []; window.PaintedScenes.foci = [];
    const n = people.length;
    people.forEach((s, i) => {
      const person = world.subjects[i], { h, x } = person;
      if (aboard(s)) {                                         // someone in a boat stands in it, rides its heave and roll, and holds on when it is rough
        const vessel = layout.find(n => n.prop === boat), bs = vessel.w * k.W / k.H, bx = vessel.x, by = vessel.y, ph = Math.min(h, bs * 0.62), fx = bx - bs * 0.34, fy = by + 0.006, m = k.boatMotion(rough, bx);
        window.PaintedScenes.heads.push([by - ph, by - ph * 0.55, by - ph * 0.76]); window.PaintedScenes.foci.push(by - ph * 0.5);
        const g = k.g; g.save(); g.translate(k.X(bx), k.Y(by) + m.dy * k.H); g.rotate(m.rot); g.translate(-k.X(bx), -k.Y(by));
        const lean = rough * 0.2 * Math.sin(k.t * 2.3 + 0.8); g.translate(k.X(fx), k.Y(fy)); g.rotate(lean); g.translate(-k.X(fx), -k.Y(fy));
        k.person({ ...bodyOf(s), x: fx, y: fy, h: ph, pose: rough > 0.6 ? "hold" : s.pose || "stand", facing: s.facing || "back", hair: s.hair || "short", robe: false, top: s.top || "#7a4b2a", bottom: s.bottom || "#2f3a55", skin: s.skin || "#d9a47a", hairColor: s.hairColor || "#2a1d17", silhouette: T.back ? mix("#0b0b18", T.shade, 0.35) : null, rim: null, dx: 0, walk: 0 });
        g.restore();
        return;
      }
      // climbing the lighthouse stair: the person travels up the steps over the shot (the stair is drawn in kit.room), hopping from tread to tread
      const climbing = s.pose === "climb" && shot.place === "interior" && shot.room === "lighthouse", cu = climbU, step = Math.floor(cu), fr = cu - step, hop = fr * fr * (3 - 2 * fr);
      const standY = climbing ? 0.76 - 0.06 * (step + hop) + climbShift : person.y, standX = climbing ? 0.32 + 0.045 * cu + 0.06 : x;
      window.PaintedScenes.heads.push([standY - h * 1.02, standY - h * 0.55, standY - h * 0.76]); window.PaintedScenes.foci.push(standY - h * 0.5);
      // By default people are lit: their own colours, dimmed by the hour, with a rim of the hour's light (the lamp, the moon, the sun low behind them).
      const lit = (c) => mix(c, T.shade, Math.min(0.55, T.amt * 0.6)), litOn = !indoors && T.amt > 0.2;
      // "people": "silhouette" (the film's or the shot's choice) cuts outdoor figures out in black against a bright or night sky; a person's own "silhouette": true/false beats both
      const asSilhouette = s.silhouette === true || (s.silhouette !== false && shot.people === "silhouette" && !indoors && Boolean(T.back));
      k.person({
        ...bodyOf(s), x: standX, y: standY, h, pose: s.pose || "stand", facing: s.facing || (s.mood && s.mood !== "neutral" ? "front" : "back"), hair: s.hair || (i % 2 ? "bun" : "short"), robe: Boolean(s.robe), flip: Boolean(s.flip) || (n > 1 && i === n - 1 && (s.pose === "hug")),
        top: lit(s.top || ["#f3efe6", "#2a3f7a", "#8a3b32", "#3a6a4a"][i % 4]), bottom: lit(s.bottom || "#2f3a55"), skin: lit(s.skin || ["#d9a47a", "#b8825a", "#e8bd96", "#8a5a3a"][i % 4]), hairColor: lit(s.hairColor || ["#2a1d17", "#5a3a22", "#1c1c20", "#7a5a3a"][i % 4]), mood: s.mood || "neutral", extras: s.extras || [],
        silhouette: asSilhouette ? mix("#0b0b18", T.shade, 0.35) : null, rim: !asSilhouette && litOn && T.rim ? T.rim : null, dx: s.dx ?? 0, walk: s.walk ?? 1.2
      });
    });
    if (Wt.fog) k.fog({ a: 0.12 * Wt.fog, color: fogColor, y: 0.7 });
    if (Wt.sand) k.sand({ n: 150, color: mix("#e2b877", T.shade, T.amt * 0.4) });
    if (season === "autumn" && ["forest", "meadow", "hills", "street", "village", "road", "river"].includes(place) && !indoors) k.leaves({ n: 36 });
    window.PaintedScenes.jarState = null;
    if (window.PaintedScenes.heldJar && people.length) {
      const ys = world.subjects.map(p => p.h), xs = world.subjects.map(p => p.x);
      const stand = () => world.subjects[0].y, jh = layout.find(n => n.prop === window.PaintedScenes.heldJar)?.h || ys[0] * .165, clay = { color: "#8c3a1b", dark: "#3d1a0c" };
      const HANDS_BUSY = ["hug", "sit", "kneel", "pray", "wave", "cheer"];                                      // poses that need both hands: nobody holds a jar through them
      if (people.some((s2) => HANDS_BUSY.includes(s2.pose))) { k.jar({ x: Math.min(0.9, Math.max(...xs) + ys[0] * 0.32), y: stand(ys[0]) + 0.005, h: jh, ...clay }); window.PaintedScenes.jarState = "on the ground beside them"; }
      else if (people.length > 1) { k.jar({ x: (xs[0] + xs[1]) / 2, y: stand(ys[0]) - ys[0] * 0.38, h: jh, ...clay }); window.PaintedScenes.jarState = "lifted between them"; }   // two people lift it between them
      else { k.jar({ x: xs[0] + ys[0] * 0.28, y: stand(ys[0]) - ys[0] * 0.3, h: jh, ...clay }); window.PaintedScenes.jarState = "carried at the hip"; }
    }
    if (Wt.rain) k.rain({ n: Wt.rain, a: Wt.bolts ? 0.6 : 0.5, slant: Wt.slant ?? 0.1 });
    if (Wt.bolts) k.lightning({ flashes: shot.flashes || [] });
    if (Wt.snow) k.snow({ n: Wt.snow, wind: Wt.wind || 0 });
    else if (season === "winter" && Wt.rain && !indoors) k.snow({ n: 90, a: 0.9, wind: 0.4 });   // winter: the rain is mixed with sleet, so the season shows over water and ground alike
    if (Wt.whiteout) { const g = k.g, gr = g.createLinearGradient(0, 0, 0, k.H); gr.addColorStop(0, "rgba(235,240,248," + Wt.whiteout * 0.55 + ")"); gr.addColorStop(1, "rgba(235,240,248," + Wt.whiteout * 0.8 + ")"); g.fillStyle = gr; g.fillRect(0, 0, k.W, k.H); k.snow({ n: 220, a: 0.9, wind: 1.4 }); }   // a blizzard whites the world out
  }
  window.PaintedScenes = { draw, TIMES, WEATHER, SIZES, PLACES: Object.keys(BASE) };
})();

// --- doodle.js ---
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

  function house(x, y, w, h, wall, roof, lit) {
    const shWall = mix(wall, "#1c1824", 0.16), doorC = "#6e4228", winC = lit ? "#ffe89e" : "#8fa8bc", winRim = "#4a3322";
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
      if (place === "road" || place === "street" || place === "river" || (place === "hills" && shot.path === true)) {     // hills and meadows are walked on the ground; a road or path is drawn only when the words name one (lint sets path: true then)
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
    let lampPos = null, markTip = null; const boatFront = [], anchors = new Map(), handsByPerson = new Map(), pondAt = [], marks = [], fruitProps = [], heldProps = [];
    for (const node of [...world.props].sort((a, b) => (b.depth || 0) - (a.depth || 0))) {
      const p = node.prop, px = node.x * W, py = node.y * H; let ph = node.h * H, pw = node.w * W;
      anchors.set(p, [px, py - ph * .25]);
      if (p.kind === "rock") props.push(...rock(px, py, pw, ph, tint));
      else if (p.kind === "lighthouse") { props.push(cast(px, py + 6, pw * 0.65, 14), ...lighthouse(px, py, ph * 1.05, pw, T.amt > 0.3, tint)); lampPos = [px, py - ph * 1.05 * 0.945]; }
      else if (p.kind === "house") props.push(...house(px, py, pw, ph * 0.7, tint("#a08a70"), tint("#6a3f31"), T.amt > 0.3));
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
      else if (p.kind === "beam") lampPos = lampPos || [px, hz - 40];
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
    if (lampPos && T.amt > 0.3 && beamK > 0) { const a = Math.PI * (0.5 + Math.sin(t * 1.1) * 0.45), len = 1700, sp = 0.12; for (const d of [0]) g.save(), (g.fillStyle = `rgba(255,224,110,${0.42 * beamK})`, g.beginPath(), g.moveTo(lampPos[0], lampPos[1]), g.lineTo(lampPos[0] + Math.cos(a + d - sp) * len, lampPos[1] + Math.sin(a + d - sp) * len), g.lineTo(lampPos[0] + Math.cos(a + d + sp) * len, lampPos[1] + Math.sin(a + d + sp) * len), g.closePath(), g.fill()), g.restore(); }
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

// --- paint.js ---
/*
 * The paint pass: turns the kit's flat drawing into a painting, on the GPU (or on SwiftShader when there is none: slower, same picture).
 *
 *   "strokes"  (oil, pastel)  thousands of brush strokes laid in layers, big to small. Each stroke takes its colour from the drawing under it,
 *                              runs along the nearest edge (so shapes keep their outline) or swirls where the picture is flat, and has bristle
 *                              streaks and thick-paint lighting. A share of the strokes is laid again on every drawing: that is the shimmer.
 *   "wash"     (watercolour, gouache, ink)  the drawing, softened and pooled at the edges, with pigment granulation, optional inked outlines and posterised bands.
 *
 * Then, for every mode: paper, grain, grade, vignette and bloom. Each drawing is a pure function of (picture, look, drawing number).
 */
(function () {
  const LOOKS = {
    oil:        { mode: "strokes", brush: 11, length: 2.8, layers: 3, swirl: 0.7, curve: 0.9, bristle: 0.75, impasto: 0.6, jitter: [0.2, 0.22, 0.35], respect: 0.85, boil: 0.5, paper: 0.6, grain: 0.5, saturation: 1.18, contrast: 1.06, warmth: 0.2, vignette: 0.35, bloom: 0.3 },
    pastel:     { mode: "strokes", brush: 9, length: 4.2, layers: 2, swirl: 0.15, curve: 0.3, bristle: 1.0, impasto: 0.1, jitter: [0.08, 0.2, 0.2], respect: 0.6, boil: 0.45, paper: 1.0, grain: 1.0, saturation: 1.05, contrast: 1.02, warmth: 0.2, vignette: 0.2, bloom: 0.1 },
    watercolor: { mode: "wash", brush: 12, wash: 0.85, bleed: 0.8, outline: 0.0, ink: "#2a2a3a", paper: 0.9, paperColor: "#f6f1e4", grain: 0.5, saturation: 1.0, contrast: 0.98, warmth: 0.1, vignette: 0.25, bloom: 0.2, boil: 0.35 },
    ink:        { mode: "wash", brush: 6, wash: 0.2, bleed: 0.1, outline: 0.95, ink: "#14141c", posterize: 6, paper: 0.7, paperColor: "#f3ecd8", grain: 0.5, saturation: 0.95, contrast: 1.15, warmth: 0.1, vignette: 0.2, bloom: 0.0, boil: 0.5 },
    gouache:    { mode: "wash", brush: 6, wash: 0.25, bleed: 0.12, outline: 0.0, posterize: 7, paper: 0.55, paperColor: "#f7f0e0", grain: 0.35, saturation: 1.1, contrast: 1.08, warmth: 0.15, vignette: 0.15, bloom: 0.05, boil: 0.25 }
  };
  const resolve = (look) => { const base = LOOKS[typeof look === "string" ? look : look && look.base] || LOOKS.oil; return Object.assign({}, base, typeof look === "object" ? look : {}); };

  const NOISE = `
  float h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 7.1; a *= .5; } return s; }
  vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1e-10; return vec3(abs(q.z + (q.w - q.y) / (6.*d + e)), d / (q.x + e), q.x); }
  vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1., 2./3., 1./3., 3.); vec3 p = abs(fract(c.xxx + K.xyz) * 6. - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0., 1.), c.y); }
  float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }`;

  const STROKE_VS = `#version 300 es
  precision highp float;
  ${NOISE}
  layout(location=0) in vec2 corner;      // -1..1
  layout(location=1) in vec3 inst;        // stroke centre in px, and a fixed random
  uniform sampler2D src; uniform vec2 res; uniform float brush, len, swirl, curve, respect, boil, drawing, lodBias, jitterPos;
  out vec2 vUv; out vec3 vCol; out float vRand; out float vAng;
  void main(){
    float id = inst.z;
    float fresh = step(h11(id * 91.7), boil);                  // this stroke is laid again on every drawing
    float r = fresh > .5 ? h11(id * 17.3 + drawing * 7.13) : id;
    vec2 c = inst.xy + (vec2(h11(r*5.1), h11(r*9.7)) - .5) * brush * jitterPos * (fresh > .5 ? 1.0 : 0.25);
    vec2 uv = c / res;
    float lod = max(0., log2(brush) - 0.5 + lodBias);
    vec3 col = textureLod(src, uv, lod).rgb;
    float d = brush * .9;
    float lx0 = luma(textureLod(src, vec2((c.x-d)/res.x, uv.y), lod).rgb), lx1 = luma(textureLod(src, vec2((c.x+d)/res.x, uv.y), lod).rgb);
    float ly0 = luma(textureLod(src, vec2(uv.x, (c.y-d)/res.y), lod).rgb), ly1 = luma(textureLod(src, vec2(uv.x, (c.y+d)/res.y), lod).rgb);
    vec2 g = vec2(lx1 - lx0, ly1 - ly0);
    float m = length(g);
    float edgeA = atan(g.y, g.x) + 1.5708;                          // along the edge
    vec2 q = (c - res * vec2(.5, .42)) / res.y;
    float flowA = atan(q.y, q.x) + 1.5708 + (fbm(c / (brush * 14.) + vec2(.0, drawing * .0)) - .5) * 4. * curve;   // swirl around the centre, bent by noise
    float wEdge = smoothstep(.015, .09, m) * respect;
    float a = mix(mix(edgeA, flowA, swirl), edgeA, wEdge) + (h11(r*3.3) - .5) * .5 * (1. - wEdge * .6);
    float L = brush * len * mix(1., .45, smoothstep(.02, .16, m) * respect) * (.7 + .6 * h11(r*2.2));
    float Wd = brush * (.85 + .3 * h11(r*8.8));
    vec2 p = c + mat2(cos(a), sin(a), -sin(a), cos(a)) * (corner * vec2(L * .5, Wd * .5));
    gl_Position = vec4(p / res * 2. - 1., 0., 1.); gl_Position.y *= -1.;
    vUv = corner; vCol = col; vRand = r; vAng = a;
  }`;
  const STROKE_FS = `#version 300 es
  precision highp float;
  ${NOISE}
  in vec2 vUv; in vec3 vCol; in float vRand; in float vAng;
  uniform float bristle, impasto, sat, valj, huej, layerAlpha;
  out vec4 o;
  void main(){
    float along = abs(vUv.x), across = abs(vUv.y);
    float endSoft = smoothstep(1.0, .7, along);
    float edgeSoft = smoothstep(1.0, .55, across);
    float streakId = floor((vUv.y * .5 + .5) * 9.);
    float br = h21(vec2(streakId, vRand * 311.));
    float dry = step(.62, br) * smoothstep(.45, 1., along) * bristle;
    float a = endSoft * edgeSoft * (1. - dry * .9) * layerAlpha;
    if (a < .02) discard;
    vec3 hsv = rgb2hsv(vCol);
    hsv.x += (h11(vRand * 3.1) - .5) * huej; hsv.y = clamp(hsv.y * (1. + (h11(vRand * 7.7) - .5) * sat), 0., 1.); hsv.z = clamp(hsv.z * (1. + (h11(vRand * 5.5) - .5) * valj), 0., 1.);
    vec3 c = hsv2rgb(hsv);
    float ridge = (br - .5) * bristle;                               // bristle ridges catch the light
    float lit = dot(vec2(cos(vAng), sin(vAng)), vec2(.6, -.8)) * (vUv.y) * .5;
    c *= 1. + impasto * (ridge * .5 + lit * .5);
    o = vec4(c * a, a);
  }`;
  const QUAD_VS = `#version 300 es
  layout(location=0) in vec2 corner; out vec2 uv;
  void main(){ uv = corner * .5 + .5; gl_Position = vec4(corner, 0., 1.); }`;
  const BASE_FS = `#version 300 es
  precision highp float; in vec2 uv; uniform sampler2D src; uniform float lod; out vec4 o;
  void main(){ o = vec4(textureLod(src, vec2(uv.x, 1. - uv.y), lod).rgb, 1.); }`;
  // wash: softened, pooled edges, granulation, posterised bands, inked outlines
  const WASH_FS = `#version 300 es
  precision highp float;
  ${NOISE}
  in vec2 uv; uniform sampler2D src; uniform vec2 res; uniform float brush, wash, bleed, outline, posterize, drawing, boil; uniform vec3 inkColor;
  out vec4 o;
  vec3 S(vec2 p, float lod){ return textureLod(src, vec2(p.x, 1. - p.y), lod).rgb; }
  void main(){
    vec2 px = 1. / res; float u = res.y / 1920.;
    float seed = drawing * boil;
    vec2 warp = (vec2(fbm(uv * res / (brush * 9.) + seed), fbm(uv * res / (brush * 9.) + 31.7 + seed)) - .5) * bleed * brush * 3. * u * px;
    vec2 p = uv + warp;
    float lod = log2(brush * u * .9 + 1.);
    vec3 soft = S(p, lod), sharp = S(p, 0.6);
    vec3 c = mix(sharp, soft, wash);
    float e = length(vec2(luma(S(p + vec2(px.x * brush * u, 0.), lod)) - luma(S(p - vec2(px.x * brush * u, 0.), lod)), luma(S(p + vec2(0., px.y * brush * u), lod)) - luma(S(p - vec2(0., px.y * brush * u), lod))));
    c *= 1. - smoothstep(.01, .12, e) * wash * .25;                           // pigment pools at the edges
    if (posterize > 0.) c = floor(c * posterize + .5) / posterize;
    if (outline > 0.) { float l = smoothstep(.03, .16, length(vec2(luma(S(uv + vec2(px.x*2., 0.), .5)) - luma(S(uv - vec2(px.x*2., 0.), .5)), luma(S(uv + vec2(0., px.y*2.), .5)) - luma(S(uv - vec2(0., px.y*2.), .5))))); float wob = fbm(uv * res / 40. + seed); c = mix(c, inkColor, l * outline * (.65 + .35 * wob)); }
    o = vec4(c, 1.);
  }`;
  const POST_FS = `#version 300 es
  precision highp float;
  ${NOISE}
  in vec2 uv; uniform sampler2D tex; uniform sampler2D src; uniform vec2 res; uniform float paper, grain, sat, contrast, warmth, vignette, bloom, drawing, wetPaper; uniform vec3 paperColor;
  out vec4 o;
  void main(){
    vec2 p = uv * res / (res.y / 1920.);
    vec3 c = texture(tex, uv).rgb;
    float tooth = fbm(p / 5.) * .6 + fbm(p / 22.) * .4;                       // paper tooth: pigment sits in the dips
    float weave = (sin(p.x * .9) * sin(p.y * .9)) * .5 + .5;
    c = mix(c, c * (.82 + .3 * tooth), paper * .5);
    c = mix(c, c * (.94 + .1 * weave), paper * .25);
    if (wetPaper > 0.) c = mix(paperColor, c, mix(1., clamp(.55 + c.r * .0 + (1. - luma(c)) * 1.2, 0., 1.), 0.)); 
    float g = h21(p + drawing * 13.7) - .5; c += g * grain * .07;
    vec3 hsv = rgb2hsv(c); hsv.y *= sat; c = hsv2rgb(hsv);
    c = (c - .5) * contrast + .5; c += vec3(warmth * .05, warmth * .015, -warmth * .04);
    vec3 bl = textureLod(src, vec2(uv.x, 1. - uv.y), 5.).rgb; c += max(bl - .72, 0.) * bloom * 1.4;
    float v = smoothstep(.95, .25, length((uv - .5) * vec2(res.x / res.y, 1.) * .9)); c *= mix(1., v, vignette);
    o = vec4(clamp(c, 0., 1.), 1.);
  }`;

  function Painter(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    const W = canvas.width, H = canvas.height;
    const compile = (vs, fs) => { const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + "\n" + s.split("\n").map((l, i) => (i + 1) + ": " + l).join("\n").slice(0, 3000)); return sh; }; const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr)); return pr; };
    const strokeP = compile(STROKE_VS, STROKE_FS), baseP = compile(QUAD_VS, BASE_FS), washP = compile(QUAD_VS, WASH_FS), postP = compile(QUAD_VS, POST_FS);
    const U = (pr) => new Proxy({}, { get: (_, n) => gl.getUniformLocation(pr, n) });
    const us = U(strokeP), ub = U(baseP), uw = U(washP), up = U(postP);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const srcTex = gl.createTexture();
    const fbTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fbTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const instBuf = gl.createBuffer();
    const cache = new Map();                                               // layer -> instance data (same for every drawing; boil is in the shader)
    function instances(layer, brush) {
      const key = layer + ":" + brush;
      if (cache.has(key)) return cache.get(key);
      const stepX = brush * 0.8, stepY = brush * 0.55, cols = Math.ceil(W / stepX) + 2, rows = Math.ceil(H / stepY) + 2, data = new Float32Array(cols * rows * 3);
      let s = 1234567 + layer * 99991; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      let n = 0; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { data[n++] = (i + rnd()) * stepX - stepX; data[n++] = (j + rnd()) * stepY - stepY; data[n++] = rnd() * 997 + layer; }
      // shuffled order: strokes overlap in no particular direction
      const order = Array.from({ length: cols * rows }, (_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const sh = new Float32Array(data.length); order.forEach((o, i) => { sh[i * 3] = data[o * 3]; sh[i * 3 + 1] = data[o * 3 + 1]; sh[i * 3 + 2] = data[o * 3 + 2]; });
      const out = { data: sh, count: cols * rows }; cache.set(key, out); return out;
    }
    const hexRgb = (c) => { const n = parseInt((c || "#000000").replace("#", ""), 16); return [(n >> 16) / 255 & 255 || ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const rgbOf = (c) => { const n = parseInt((c || "#000000").replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

    function paint(flat, lookIn, drawing) {
      const look = resolve(lookIn), u = H / 1920;
      gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, W, H); gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 0); gl.disableVertexAttribArray(1);
      if (look.mode === "strokes") {
        gl.useProgram(baseP); gl.uniform1i(ub.src, 0); gl.uniform1f(ub.lod, Math.log2(look.brush * u * 1.6)); gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(strokeP); gl.uniform1i(us.src, 0); gl.uniform2f(us.res, W, H);
        gl.uniform1f(us.len, look.length); gl.uniform1f(us.swirl, look.swirl); gl.uniform1f(us.curve, look.curve); gl.uniform1f(us.respect, look.respect); gl.uniform1f(us.boil, look.boil); gl.uniform1f(us.drawing, drawing);
        gl.uniform1f(us.bristle, look.bristle); gl.uniform1f(us.impasto, look.impasto); gl.uniform1f(us.huej, look.jitter[0]); gl.uniform1f(us.valj, look.jitter[1]); gl.uniform1f(us.sat, look.jitter[2]);
        const sizes = look.layers >= 3 ? [1.7, 1, 0.55] : look.layers === 2 ? [1.3, 0.7] : [1];
        sizes.forEach((m, layer) => {
          const brush = look.brush * u * m, inst = instances(layer, Math.round(brush * 4) / 4);
          gl.uniform1f(us.brush, brush); gl.uniform1f(us.lodBias, layer === sizes.length - 1 ? -0.8 : 0); gl.uniform1f(us.jitterPos, 0.7); gl.uniform1f(us.layerAlpha, layer === sizes.length - 1 ? 0.92 : 1);
          gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, inst.data, gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
          gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, inst.count);
        });
        gl.vertexAttribDivisor(1, 0); gl.disableVertexAttribArray(1);
      } else {
        gl.useProgram(washP); gl.uniform1i(uw.src, 0); gl.uniform2f(uw.res, W, H);
        gl.uniform1f(uw.brush, look.brush); gl.uniform1f(uw.wash, look.wash ?? 0.5); gl.uniform1f(uw.bleed, look.bleed ?? 0.3); gl.uniform1f(uw.outline, look.outline ?? 0); gl.uniform1f(uw.posterize, look.posterize ?? 0); gl.uniform1f(uw.drawing, drawing); gl.uniform1f(uw.boil, look.boil ?? 0.3); gl.uniform3fv(uw.inkColor, rgbOf(look.ink));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(postP); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTex); gl.uniform1i(up.tex, 0); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.uniform1i(up.src, 1);
      gl.uniform2f(up.res, W, H); gl.uniform1f(up.paper, look.paper ?? 0.5); gl.uniform1f(up.grain, look.grain ?? 0.4); gl.uniform1f(up.sat, look.saturation ?? 1); gl.uniform1f(up.contrast, look.contrast ?? 1); gl.uniform1f(up.warmth, look.warmth ?? 0); gl.uniform1f(up.vignette, look.vignette ?? 0.2); gl.uniform1f(up.bloom, look.bloom ?? 0); gl.uniform1f(up.drawing, drawing); gl.uniform1f(up.wetPaper, 0); gl.uniform3fv(up.paperColor, rgbOf(look.paperColor || "#f4efe2"));
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.activeTexture(gl.TEXTURE0);
    }
    return { paint, gl, renderer: (() => { const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ""; })() };
  }
  window.PaintedPaint = { Painter, LOOKS, resolve };
})();

// --- stage.js ---
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
  window.initShort = function (spec, canvasEl) {
    S = spec; const { W, H } = S; u = H / 1920;
    if (!flat) { flat = document.createElement("canvas"); fg = flat.getContext("2d"); }
    flat.width = W; flat.height = H;
    if (!avg) { avg = document.createElement("canvas"); avg.width = 1; avg.height = 1; }
    FH = H + Math.ceil(FRAME_MAX * H) + 2;                                  // the scene is drawn on a taller canvas: lifting the picture uncovers real scenery, not a stretch
    if (!scene) { scene = document.createElement("canvas"); sg = scene.getContext("2d"); }
    scene.width = W; scene.height = FH;
    if (!glc) { glc = document.createElement("canvas"); glc.width = W; glc.height = H; painter = window.PaintedPaint.Painter(glc); }
    else if (glc.width !== W || glc.height !== H) { glc.width = W; glc.height = H; }
    out = canvasEl || document.getElementById("out"); out.width = W; out.height = H; og = out.getContext("2d");
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
  /** Storyboard reference still: every stroke complete (drawIn "none"), no fade darkening, no caption box. */
  window.stillClean = function (i, at = 0.65) {
    const b = S.beats[i]; if (!b) return "";
    const prevDrawIn = S.drawIn; S.drawIn = "none";
    const t = b.t0 + (b.t1 - b.t0) * at, look = lookOf(b);
    drawBeat(i, t);
    S.drawIn = prevDrawIn;
    if (look) painter.paint(flat, look, Math.round(t * S.fps / S.twos));
    og.setTransform(1, 0, 0, 1, 0, 0);
    og.drawImage(look ? glc : flat, 0, 0);
    return out.toDataURL("image/jpeg", 0.9);
  };
})();
