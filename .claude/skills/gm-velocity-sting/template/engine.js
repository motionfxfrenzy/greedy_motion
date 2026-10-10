// gm-velocity-sting engine. Readable source; scripts/build-format.mjs inlines it minified into index.html
// (the HyperFrames bundler drops local <script src>, and `check` caps a composition at 300 lines).
(function () {
  // ================= values (HyperFrames variables; defaults are the Greedy Motion build) =================
  const HF = window.__hyperframes;
  // Outside the HyperFrames runtime (a plain browser, the seam verifier) fall back to the declared defaults.
  const declared = (() => { try { return JSON.parse(document.documentElement.getAttribute("data-composition-variables") || "[]"); } catch (e) { return []; } })();
  const V = Object.assign(Object.fromEntries(declared.map((d) => [d.id, d.default])), (HF && HF.getVariables && HF.getVariables()) || {});
  const str = (k) => (V[k] == null ? "" : String(V[k]).trim());
  const num = (k, d) => (Number.isFinite(Number(V[k])) ? Number(V[k]) : d);
  const list = (k) => { try { const v = typeof V[k] === "string" ? JSON.parse(V[k]) : V[k]; return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const text = (sel, v) => { const el = $(sel); if (el) el.textContent = v; return el; };

  // ================= brand inks: picked from the theme tokens for contrast, never literals =================
  const root = document.documentElement, CS = getComputedStyle(root);
  const tok = (n) => CS.getPropertyValue(n).trim();
  function rgb(s) {
    const c = document.createElement("canvas").getContext("2d"); c.fillStyle = "rgba(0, 0, 0, 0)"; c.fillStyle = s || "rgba(0, 0, 0, 0)";
    const h = c.fillStyle; if (h[0] === "#") return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const m = h.match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
  }
  const lum = (n) => { const a = rgb(tok(n)).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const best = (cands, on) => cands.reduce((r, n) => (ratio(n, on) > ratio(r, on) ? n : r), cands[0]);
  const firstOk = (cands, on, min) => cands.find((n) => ratio(n, on) >= min) || null;
  root.style.setProperty("--on-accent", `var(${best(["--bg", "--fg", "--surface"], "--accent")})`);
  root.style.setProperty("--accent-ink", `var(${firstOk(["--accent", "--brand"], "--bg", 3) || "--fg"})`);
  root.style.setProperty("--muted-ink", `var(${firstOk(["--muted"], "--surface", 4.5) || "--fg"})`);

  // ================= fill the slots =================
  const W1 = str("brand_word_1"), W2 = str("brand_word_2");
  $$(".bw1").forEach((e) => (e.textContent = W1));
  $$(".bw2").forEach((e) => (e.textContent = W2));
  // A one-word brand stays whole: the counter-bounce already has two parts (the mark and the wordmark).
  if (!W2) $$(".bw2").forEach((e) => e.remove());
  const wmChars = (W1 + W2).length;
  root.style.setProperty("--wm-size", Math.min(132, Math.floor(860 / Math.max(1, wmChars * 0.6 + (W2 ? 0.24 : 0)))) + "px");
  const LOGO = str("logo");
  $$(".brand-mark").forEach((m) => {
    if (LOGO) { const img = document.createElement("img"); img.src = LOGO; img.alt = ""; m.appendChild(img); }
    else { const d = document.createElement("div"); d.className = "mono"; d.textContent = (W1 || W2 || "•").charAt(0).toUpperCase(); m.appendChild(d); }
  });
  text("#b-title", str("b_title"));
  text("#b-sub", str("b_sub"));
  text("#b-opt1", str("b_option_1"));
  text("#b-opt2", str("b_option_2"));
  text("#b-div", str("b_divider"));
  text("#c-div", str("b_divider"));
  text("#b-label", str("b_field_label"));
  text("#c-label", str("b_field_label"));
  text("#b-field", str("b_placeholder"));
  text("#c-ph", str("b_placeholder"));
  text("#b-cta", str("b_cta"));
  text("#c-cta", str("b_cta"));
  ["#b-opt1", "#b-opt2", "#b-div"].forEach((s) => { if (!$(s).textContent) $(s).remove(); });
  text("#d-label", str("d_label"));
  text("#d-of", str("d_of"));
  const D_FROM = num("d_from", 0), D_TO = num("d_to", 100);
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const digits = fmt(D_TO).length;
  $("#d-num").style.fontSize = Math.min(260, Math.floor(740 / (digits * 0.62))) + "px";
  const STEPS = list("d_steps").map(String).slice(0, 4);
  STEPS.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "d-st" + (i === 0 ? " done" : i === 1 ? " now" : "");
    row.id = "d-st" + i;
    const b = document.createElement("b"); b.id = "d-st" + i + "b";
    // The tick is always in the DOM and only its opacity changes, so any seek order shows the right state.
    if (i === 0) b.textContent = "✓"; else { const tick = document.createElement("i"); tick.textContent = "✓"; tick.style.cssText = "font-style:normal;opacity:0"; b.appendChild(tick); }
    row.appendChild(b); row.appendChild(document.createTextNode(s));
    $("#d-steps").appendChild(row);
  });
  const ROWS = list("e_rows").map(String).slice(0, 5);
  const EXTRA = str("e_extra");
  const ROW_STEP = 104;
  const rowEls = ROWS.map((r, i) => {
    const el = document.createElement("div"); el.className = "e-row"; el.id = "e-r" + i; el.textContent = r; el.style.top = i * ROW_STEP + "px";
    el.setAttribute("data-layout-allow-overlap", ""); $("#e-list").appendChild(el); return el;
  });
  if (EXTRA) {
    const sep = document.createElement("div"); sep.className = "e-sep"; sep.style.top = ROWS.length * ROW_STEP + 20 + "px"; $("#e-list").appendChild(sep);
    const el = document.createElement("div"); el.className = "e-row"; el.id = "e-r" + ROWS.length; el.textContent = EXTRA; el.style.top = ROWS.length * ROW_STEP + 44 + "px";
    el.setAttribute("data-layout-allow-overlap", ""); $("#e-list").appendChild(el); rowEls.push(el);
  }
  text("#e-foot", str("e_foot"));
  text("#f-h1", str("f_title"));
  text("#f-sub", str("f_sub"));
  text("#f-btn", str("f_create"));
  text("#f-btn2", str("f_secondary"));
  if (!str("f_secondary")) $("#f-btn2").remove();
  text("#f-mh", str("f_menu_title"));
  const MENU = list("f_menu_rows").slice(0, 4);
  MENU.forEach((r, i) => {
    const row = document.createElement("div"); row.className = "f-row"; row.id = "f-r" + i; row.style.top = i * 116 + "px";
    row.innerHTML = (i === 1 ? '<div id="f-hover" class="f-hover"></div><div id="f-sel" class="f-sel"></div>' : "") +
      '<span class="rd">' + (i === 1 ? '<span id="f-rd-on" class="f-rd-on">✓</span>' : "") + '</span><span class="nm"></span><span class="mt"></span>';
    row.querySelector(".nm").textContent = String((r && r.name) || "");
    row.querySelector(".mt").textContent = String((r && r.meta) || "");
    $("#f-rows").appendChild(row);
  });
  text("#f-needs", str("f_needs"));
  text("#g-line", str("g_line"));

  // ================= the one ease family (references/craft.md). Functions, never GSAP names. =================
  const EO = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)); // arriving
  const EI = (p) => (p <= 0 ? 0 : Math.pow(2, 10 * (p - 1))); // leaving
  const SPRING = (p) => Math.exp(-p / 0.279) * Math.sin((2 * Math.PI * p) / 0.5); // counter-bounce, 1 s tween = seconds

  const FPS = 30;
  const F = (n) => (n - 1) / FPS;
  const SEAM = 0.36;
  const XE = (cutFrame) => F(cutFrame) - 1 / FPS - SEAM; // exits end on the last outgoing frame
  const L = 160;

  const tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
  // Discrete changes still need both states so reverse/direct seeks can restore them.
  const flip = (target, from, to, time) => tl.fromTo(target, from, { ...to, duration: 0, immediateRender: false }, time);
  const exitXY = (sel, axis, dir, cutFrame, blur) => tl.fromTo(sel, { [axis]: 0, filter: "blur(0px)" }, { [axis]: dir * L, filter: `blur(${blur}px)`, duration: SEAM, ease: EI }, XE(cutFrame));
  const entryXY = (sel, axis, dir, cutFrame, blur) => tl.fromTo(sel, { [axis]: -dir * L, filter: `blur(${blur}px)` }, { [axis]: 0, filter: "blur(0px)", duration: SEAM, ease: EO }, F(cutFrame));
  const exitZ = (sel, to, cutFrame, blur) => tl.fromTo(sel, { scale: 1, filter: "blur(0px)" }, { scale: to, filter: `blur(${blur}px)`, duration: SEAM, ease: EI }, XE(cutFrame));
  const entryZ = (sel, from, cutFrame, blur) => tl.fromTo(sel, { scale: from, filter: `blur(${blur}px)` }, { scale: 1, filter: "blur(0px)", duration: SEAM, ease: EO }, F(cutFrame));
  const arrive = (el, t, dy, dur) => tl.fromTo(el, { opacity: 0, y: dy }, { opacity: 1, y: 0, duration: dur, ease: EO }, t);

  // ================= A · lockup (f1–f40) =================
  tl.fromTo("#a-cam", { scale: 0.9 }, { scale: 1, duration: 0.6, ease: EO }, 0);
  tl.fromTo("#a-mark", { y: 0 }, { y: 19, duration: 1, ease: SPRING }, 0); // +A
  tl.fromTo("#a-word", { y: 0 }, { y: -19, duration: 1, ease: SPRING }, 0); // −A
  exitXY("#a-cam", "y", +1, 41, 10);

  // ================= B · entry surface (f41–f79) =================
  entryXY("#b-cam", "y", +1, 41, 10);
  const bRows = $$("#sc-b .b-row");
  gsap.set(bRows, { opacity: 0 });
  const B_AT = [0.14, 0.26, 0.37, 0.47, 0.56, 0.64, 0.71]; // shrinking gaps: a wave, not a queue
  bRows.forEach((r, i) => arrive(r, F(41) + B_AT[i + (7 - bRows.length)], 40, 0.3));
  flip("#b-field", { borderColor: "var(--border)" }, { borderColor: "var(--accent)" }, F(74)); // focus
  exitXY("#b-cam", "x", -1, 80, 10);

  // ================= C · closer, typing (f80–f124) =================
  entryXY("#c-cam", "x", -1, 80, 10);
  // Stamped, uneven typing between f84 and f104 for any length: weights from a fixed pattern, so the same
  // value always types the same way and some frames land two characters at once.
  const TYPED = str("c_typed");
  const PAT = [1, 1.6, 0.4, 1.2, 1, 0.3, 1.4, 0.9, 1.1, 0.5, 1.3, 0.8];
  const w = Array.from(TYPED, (_, i) => PAT[i % PAT.length]);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  gsap.set("#c-typed", { textContent: "" });
  flip("#c-ph", { opacity: 1 }, { opacity: 0 }, F(84));
  Array.from(TYPED).forEach((_, i) => { acc += w[i]; flip("#c-typed", { textContent: TYPED.slice(0, i) }, { textContent: TYPED.slice(0, i + 1) }, F(84 + Math.round((20 * acc) / total))); });
  flip("#c-cta", { attr: { class: "c-cta" }, scale: 1 }, { attr: { class: "c-cta pressed" }, scale: 0.96 }, F(112)); // the press ignites the exit
  flip("#c-cta", { scale: 0.96 }, { scale: 0.98 }, F(114));
  exitXY("#c-cam", "y", -1, 125, 10);

  // ================= D · one number (f125–f169) =================
  entryXY("#d-cam", "y", -1, 125, 10);
  // Odometer: 32 stamped values, eased toward the target with uneven steps; the last frame shows the target.
  const JIT = [0, 0.6, -0.4, 0.3, -0.7, 0.5, -0.2, 0.8, -0.5, 0.2];
  const ODO = [];
  for (let i = 0; i < 32; i++) {
    const t = i / 31, e = 1 - Math.pow(1 - t, 2.2);
    const v = i === 31 ? D_TO : D_FROM + (D_TO - D_FROM) * Math.min(1, Math.max(0, e + JIT[i % JIT.length] * 0.012 * (1 - t)));
    ODO.push(i ? Math.max(ODO[i - 1], v) : D_FROM);
  }
  gsap.set("#d-num", { textContent: fmt(D_FROM) });
  gsap.set("#d-fill", { scaleX: D_TO ? Math.max(0, D_FROM / D_TO) : 0 });
  ODO.forEach((v, i) => {
    const previous = i ? ODO[i - 1] : D_FROM;
    flip("#d-num", { textContent: fmt(previous) }, { textContent: fmt(v) }, F(125 + i));
    flip("#d-fill", { scaleX: i ? (D_TO ? previous / D_TO : 1) : (D_TO ? Math.max(0, D_FROM / D_TO) : 0) }, { scaleX: D_TO ? v / D_TO : 1 }, F(125 + i));
  });
  if (STEPS.length > 1) {
    // Explicit from -> to for every state change (a bare tl.set does not restore text or classes when the playhead jumps back).
    tl.fromTo("#d-st1b > i", { opacity: 0 }, { opacity: 1, duration: 0, immediateRender: false }, F(158));
    tl.fromTo("#d-st1", { attr: { class: "d-st now" } }, { attr: { class: "d-st done" }, duration: 0, immediateRender: false }, F(160));
    if (STEPS.length > 2) tl.fromTo("#d-st2", { attr: { class: "d-st" } }, { attr: { class: "d-st now" }, duration: 0, immediateRender: false }, F(160));
  }
  exitXY("#d-cam", "x", +1, 170, 10);

  // ================= E · navigation (f170–f226) =================
  entryXY("#e-cam", "x", +1, 170, 10);
  // Each row slides in from just past its own width (xPercent), pre-rolled so they are mid-slide on f170.
  const E_AT = [-0.14, -0.1, -0.04, -0.01, 0.03, 0.06];
  rowEls.forEach((el, i) => tl.fromTo(el, { xPercent: -100, x: -24 }, { xPercent: 0, x: 0, duration: 0.42, ease: EO }, F(170) + E_AT[i]));
  gsap.set(rowEls, { xPercent: -100, x: -24 });
  // The highlight climbs from the bottom row to the first (chosen) row: a decision, so it is stamped.
  const path = rowEls.map((_, i) => rowEls.length - 1 - i);
  // Spread to f202 and closed by a press on the chosen row (f209): the beat carries information up to the exit
  // instead of holding (pacing gate: no hold > 0.6 s).
  const H_F = [186, 189, 192, 196, 199, 202].slice(-path.length);
  path.forEach((r, k) => { flip(rowEls[r], { attr: { class: "e-row" } }, { attr: { class: "e-row on" } }, F(H_F[k])); if (k) flip(rowEls[path[k - 1]], { attr: { class: "e-row on" } }, { attr: { class: "e-row" } }, F(H_F[k])); });
  gsap.set("#e-foot", { opacity: 0 });
  arrive("#e-foot", F(204), 40, 0.45);
  tl.fromTo(rowEls[0], { scale: 1 }, { scale: 0.94, duration: 0.1, ease: EI }, F(209));
  tl.fromTo(rowEls[0], { scale: 0.94 }, { scale: 1, duration: 0.2, ease: EO }, F(209) + 0.1);
  gsap.set("#e-cam", { transformOrigin: "335px 324px" });
  exitZ("#e-cam", 1.25, 227, 18); // push through

  // ================= F · the one action (f227–f319) =================
  entryZ("#f-cam", 0.8, 227, 18);
  const TIP = { x: 27, y: 13 };
  const BTN = { x: 90 + 82, y: 378 }; // inside the create button for any label ≥ 4 characters
  const ROW1 = { x: 380, y: 406 };
  gsap.set("#cursor", { x: BTN.x - TIP.x, y: 1180, transformOrigin: "21% 10%" });
  tl.fromTo("#cursor", { x: BTN.x - TIP.x, y: 1180 }, { x: BTN.x - TIP.x, y: BTN.y - TIP.y, duration: 0.6, ease: EO }, F(234));
  tl.fromTo("#cursor", { scale: 1 }, { scale: 0.84, duration: 0.1, ease: EI }, F(256));
  tl.fromTo("#cursor", { scale: 0.84 }, { scale: 1, duration: 0.22, ease: EO }, F(256) + 0.1);
  tl.fromTo("#f-btn", { scale: 1 }, { scale: 0.94, duration: 0.1, ease: EI }, F(256));
  tl.fromTo("#f-btn", { scale: 0.94 }, { scale: 1, duration: 0.22, ease: EO }, F(256) + 0.1);
  gsap.set("#f-menu", { opacity: 0, transformOrigin: "0px 0px" });
  tl.fromTo("#f-menu", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.36, ease: EO }, F(256));
  const fRows = $$("#f-rows .f-row");
  gsap.set(fRows, { opacity: 0 });
  [256, 258, 259, 260].forEach((f, i) => fRows[i] && arrive(fRows[i], F(f), 34, 0.3));
  tl.fromTo("#f-page", { y: 0 }, { y: -40, duration: 0.12, ease: EI }, F(262));
  tl.fromTo("#f-page", { y: -40 }, { y: -300, duration: 0.6, ease: EO }, F(262) + 0.12);
  tl.fromTo("#cursor", { x: BTN.x - TIP.x, y: BTN.y - TIP.y }, { x: ROW1.x - TIP.x, y: ROW1.y - TIP.y, duration: 0.5, ease: EO }, F(266));
  gsap.set(["#f-hover", "#f-sel", "#f-rd-on", "#f-needs"], { opacity: 0 });
  flip("#f-hover", { opacity: 0 }, { opacity: 1 }, F(279));
  tl.fromTo("#cursor", { scale: 1 }, { scale: 0.84, duration: 0.1, ease: EI }, F(286));
  tl.fromTo("#cursor", { scale: 0.84 }, { scale: 1, duration: 0.22, ease: EO }, F(286) + 0.1);
  flip(["#f-sel", "#f-rd-on"], { opacity: 0 }, { opacity: 1 }, F(286));
  flip("#f-hover", { opacity: 1 }, { opacity: 0 }, F(286));
  // The cursor leaves soon after the choice and the next step arrives under it, so F never settles before the
  // pull-back (pacing gate).
  tl.fromTo("#cursor", { y: ROW1.y - TIP.y }, { y: 1240, duration: 0.4, ease: EI }, F(290));
  arrive("#f-needs", F(295), 40, 0.45);
  exitZ("#f-cam", 0.8, 320, 18); // pull back

  // ================= G · endcard (f320–f358) =================
  entryZ("#g-cam", 1.25, 320, 18);
  const TG = F(320);
  tl.fromTo("#g-mark", { y: 0 }, { y: 19, duration: 1, ease: SPRING }, TG);
  tl.fromTo("#g-w1", { y: 0 }, { y: -19, duration: 1, ease: SPRING }, TG);
  if (W2) tl.fromTo("#g-w2", { y: 0 }, { y: -19, duration: 1, ease: SPRING }, TG + 2 / FPS);
  if (str("g_line")) { gsap.set("#g-line", { opacity: 0 }); arrive("#g-line", F(332), 36, 0.4); }

  // ================= scene windows: hard cuts just below each frame time (references/ledger.json) =================
  const SC = ["#sc-a", "#sc-b", "#sc-c", "#sc-d", "#sc-e", "#sc-f", "#sc-g"];
  const CUTS = [1.333, 2.633, 4.133, 5.633, 7.533, 10.633];
  gsap.set(SC.slice(1), { autoAlpha: 0 });
  CUTS.forEach((c, i) => { flip(SC[i], { autoAlpha: 1 }, { autoAlpha: 0 }, c); flip(SC[i + 1], { autoAlpha: 0 }, { autoAlpha: 1 }, c); });

  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
})();
