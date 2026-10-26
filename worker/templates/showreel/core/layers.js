  /* ---------------------------------------------------------------- persistent layers */
  // Every scene carries its own ground (so an incoming scene covers the outgoing one instead of showing it through);
  // the frame and the HUD live in one overlay above all scenes.
  const paintBg = (parent) => {
    if (P.bg === "glow-grid") { parent.appendChild(el("div", "abs bgfill", "", "background:radial-gradient(1100px 700px at 28% 30%,var(--glow1),transparent 70%),radial-gradient(1000px 700px at 78% 76%,var(--glow2),transparent 70%)")); parent.appendChild(el("div", "abs bgfill grid")); }
    if (P.bg === "soft-gradient") parent.appendChild(el("div", "abs bgfill", "", "background:radial-gradient(1400px 900px at 20% 15%,var(--glow1),transparent 70%),radial-gradient(1200px 900px at 85% 90%,var(--glow2),transparent 70%)"));
    if (P.bg === "dots") parent.appendChild(el("div", "abs bgfill dots"));
  };
  const stage = $("#top");
  if (P.frame) stage.appendChild(el("div", "abs frame", ""));
  if (P.hud) {
    stage.appendChild(el("div", "hud tl mono", `${brand.name.toUpperCase()}`)); stage.appendChild(el("div", "hud tr mono", `<span id="hudt">00:00</span> / ${String(Math.floor(plan.duration / 60)).padStart(2, "0")}:${String(Math.round(plan.duration % 60)).padStart(2, "0")}`));
    stage.appendChild(el("div", "hud bl mono", product.hudLeft)); stage.appendChild(el("div", "hud br mono", `${plan.bpm} BPM`));
    const clock = { t: 0 }, ht = $("#hudt");
    tl.fromTo(clock, { t: 0 }, { t: plan.duration, duration: plan.duration, ease: "none", onUpdate: () => { const s = Math.floor(clock.t); ht.textContent = `00:${String(s).padStart(2, "0")}`; } }, 0);
  }

  if (P.hud) { const last = plan.scenes[plan.scenes.length - 1].t; tl.fromTo($$(".hud"), { opacity: 1 }, { opacity: 0, duration: 0.2, ease: "none" }, Math.max(0, last - 0.1)); }     // the end card owns the frame

