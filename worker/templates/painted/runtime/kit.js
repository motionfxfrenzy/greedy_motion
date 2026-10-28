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
