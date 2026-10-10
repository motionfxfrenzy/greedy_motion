// SHOWREEL ENGINE (runs inside the HyperFrames page). The planner (compose.mjs) decides WHAT: a personality, a palette, which scene
// modules in which order, which transition between each pair, the copy and the sound. This file knows HOW: every scene module builds its
// DOM and adds its tweens to ONE paused GSAP timeline, every transition moves two scene wrappers past each other.
// Rules it keeps (docs/SKILL_DELIVERY.md, shared-craft.md): nothing is random (seeded generator only), every animated property is in
// both the from and the to, springs are closed-form, every moving element has an identity baseline, no crossfades, no idle wobble.
(() => {
  const plan = JSON.parse(document.getElementById("plan").textContent);
  const { pal, P, brand, product } = plan;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const mulberry = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
  const spring = (zeta = 0.5, rest = 0.02) => { const w = Math.log(1 / rest) / Math.max(zeta, 1e-3); return (p) => { if (p <= 0) return 0; if (p >= 1) return 1; const wd = w * Math.sqrt(1 - zeta * zeta); return 1 - Math.exp(-zeta * w * p) * (Math.cos(wd * p) + ((zeta * w) / wd) * Math.sin(wd * p)); }; };
  const E = P.ease, SP = spring(P.spring);
  const tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
  // Entrance tweens only apply their "from" state when they start, so before that an element would sit at its final place, fully visible.
  // Record every fromTo; build.js then applies each element's EARLIEST from state at time 0 (and keeps it there until that tween runs).
  const rec = [], _fromTo = tl.fromTo.bind(tl);
  tl.fromTo = (target, from, to, pos) => { rec.push({ target, from, pos: typeof pos === "number" ? pos : 0 }); return _fromTo(target, from, to, pos); };
  const show = (el, t) => tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0, ease: "none" }, t);
  const hide = (el, t) => tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0, ease: "none" }, t);
  const el = (tag, cls, html, css) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; if (css) d.style.cssText = css; return d; };
  const allow = (root) => { [root, ...root.querySelectorAll("*")].forEach((e) => { e.setAttribute("data-layout-allow-overlap", ""); e.setAttribute("data-layout-allow-occlusion", ""); e.setAttribute("data-layout-allow-overflow", ""); }); return root; };
  const decor = (root) => { root.setAttribute("data-text-role", "decorative"); return allow(root); };
  const rise = (target, t, d = 0.5, dist = 120, ease = E.out) => tl.fromTo(target, { y: dist }, { y: 0, duration: d, ease }, t);
  const pop = (target, t, d = 0.45) => { tl.fromTo(target, { opacity: 0 }, { opacity: 1, duration: Math.min(0.14, d), ease: "none" }, t); tl.fromTo(target, { scale: 0.5 }, { scale: 1, duration: d, ease: SP }, t); };
  const baseline = (...sel) => gsap.set(sel.flat(), { x: 0, y: 0, scale: 1, rotation: 0 });
  const lumOf = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const inkFor = (hex) => (lumOf(hex) > 0.18 ? "#0a0f0d" : "#ffffff");
  const letterFit = (text, maxW, base, k = 0.54) => Math.round(Math.min(base, maxW / Math.max(1, text.length * k)));

  /* ---------------------------------------------------------------- the faux product screens */
  const SIDE = (on) => `<div class="side"><i class="logo"></i>${[0, 1, 2, 3, 4, 5].map((n) => `<i class="${n === on ? "on" : ""}"></i>`).join("")}</div>`;
  const ROWS = product.rows;
  const winHTML = (kind, seed) => {
    const r = mulberry(seed);
    if (kind === "rec") return SIDE(1) + `<div class="main"><div class="ttl"><b>${product.windowTitle}</b><span class="chip">${product.liveLabel}</span></div>${ROWS.slice(0, 6).map((x, i) => `<div class="row"><span class="mut">${x.date}</span><span>${x.label}</span><span class="amt">${x.amount}</span><span><span class="chip ${i % 3 === 2 ? "alt" : ""}">${i % 3 === 2 ? x.alt : x.ok}</span></span></div>`).join("")}</div>`;
    if (kind === "dash") return SIDE(0) + `<div class="main"><div class="ttl"><b>${product.dashTitle}</b><span class="chip">${product.period}</span></div><div style="display:flex;gap:3%;height:24%">${[0, 1, 2].map(() => `<div class="stat"><div class="bar"></div><b>${Math.round(40 + r() * 400)}k</b><div class="bar"></div></div>`).join("")}</div><div class="bars">${Array.from({ length: 14 }, (_, i) => `<i class="${i === 9 ? "hot" : ""}" style="height:${25 + r() * 70}%"></i>`).join("")}</div></div>`;
    if (kind === "inv") return SIDE(2) + `<div class="main"><div class="ttl"><b>${product.listTitle}</b><span class="chip alt">${product.listBadge}</span></div>${Array.from({ length: 6 }, () => `<div class="inv"><span class="av"></span><span class="bar"></span><span class="bar s"></span><span class="chip">${product.ok}</span></div>`).join("")}</div>`;
    const pts = Array.from({ length: 12 }, (_, i) => `${i * 9.1},${70 - (15 + i * 3.2 + r() * 14)}`).join(" ");
    return SIDE(3) + `<div class="main"><div class="ttl"><b>${product.reportTitle}</b><span class="chip">Q3</span></div><div class="stat" style="flex:1"><svg viewBox="0 0 100 70" preserveAspectRatio="none" style="width:100%;height:100%"><polyline points="${pts}" fill="none" stroke="${pal.accent}" stroke-width="1.6" vector-effect="non-scaling-stroke"/><polyline points="${pts.split(" ").map((p) => { const [x, y] = p.split(","); return `${x},${(Number(y) * 0.8 + 12).toFixed(1)}`; }).join(" ")}" fill="none" stroke="${pal.accent2}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg></div></div>`;
  };
  const KINDS = ["rec", "dash", "inv", "rep"];
  const mkWin = (kind, seed) => { const d = el("div", "win", winHTML(kind, seed)); return decor(d); };
  const mkShot = (src) => { const d = el("div", "win shot", `<img src="${src}" alt="">`); return decor(d); };      // a real screenshot instead of a mock screen
  const winOf = (i, seed) => (product.screens.length ? mkShot(product.screens[i % product.screens.length]) : mkWin(KINDS[i % 4], seed));

  const S = {}, TR = {};
  const blur = (px) => `blur(${px}px)`;
  const mark = (c, id, size, extra = "") => `<div id="${id}" class="markbox" style="width:${size}px;height:${size}px;border-radius:${size * 0.25}px;font-size:${size * 0.68}px;${extra}">${brand.mark}</div>`;
  const nameChars = (n) => [...n].map((ch) => `<span class="ch">${ch === " " ? "&nbsp;" : ch}</span>`).join("");

