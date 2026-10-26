  /* ---------------------------------------------------------------- build the scenes, then the transitions */
  const sfxLog = [];
  plan.scenes.forEach((sc, i) => {
    const wrap = $("#sc" + i), id = "m" + i, rng = mulberry(plan.seed + i * 977);
    // every scene lives in its own camera: a slow, seeded push in (or pull out) over the whole scene, so no hold is a still image
    paintBg(wrap);
    const cam = el("div", "abs", "", "left:0;top:0;width:1920px;height:1080px"); cam.id = id + "cam0"; wrap.appendChild(cam);
    const k = sc.module.startsWith("end-") ? 0 : P.drift, o = [[50, 50], [38, 55], [62, 48], [45, 40], [55, 62]][Math.floor(rng() * 5)], dx = (rng() < 0.5 ? -1 : 1) * 26 * (k ? 1 : 0);
    if (k) { cam.style.transformOrigin = `${o[0]}% ${o[1]}%`; const from = i % 2 ? { scale: 1 + k, x: -dx } : { scale: 1, x: 0 }, to = i % 2 ? { scale: 1, x: dx } : { scale: 1 + k, x: dx }; tl.fromTo(cam, from, { ...to, duration: sc.d + 0.5, ease: "none" }, Math.max(0, sc.t - 0.25)); }
    const c = { el: cam, sc, id, D: sc.d, at: (r) => sc.t + r, v: sc.variant || {}, rng, sfx: (name, t, vol) => sfxLog.push([name, t, vol]) };
    S[sc.module](c);
  });
  baseline(...plan.scenes.map((_, i) => "#sc" + i));
  plan.scenes.forEach((sc, i) => { if (i === 0) return; const tr = plan.scenes[i].transition; TR[tr.module]($("#sc" + (i - 1)), $("#sc" + i), sc.t - tr.d / 2, tr.d); });
  {
    const first = new Map();
    for (const r of rec) for (const e of gsap.utils.toArray(r.target)) { if (!(e instanceof Element)) continue; const m = first.get(e) || {}; for (const [k, v] of Object.entries(r.from)) { if (typeof v === "object" || k === "duration" || k === "ease") continue; if (!m[k] || r.pos < m[k].t) m[k] = { t: r.pos, v }; } first.set(e, m); }
    first.forEach((m, e) => { const init = {}; for (const [k, o] of Object.entries(m)) if (o.t > 0.001) init[k] = o.v; if (Object.keys(init).length) { gsap.set(e, init); _fromTo.call(tl, e, init, { ...init, duration: 0, ease: "none" }, 0); } });
  }
  window.__sfxPlan = sfxLog;
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
  tl.seek(0);
})();

