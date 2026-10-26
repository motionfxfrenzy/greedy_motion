  // a wall of screens: land on one card, pull back to all of them
  S["wall-zoom"] = (c) => {
    const root = el("div", "abs", `<div id="${c.id}cam" style="position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0"><div id="${c.id}wall" style="position:absolute;left:0;top:0;width:3720px;height:1620px"></div></div>`, "left:0;top:0;width:1920px;height:1080px;overflow:hidden");
    c.el.appendChild(root); const wall = $(`#${c.id}wall`);
    for (let i = 0; i < 24; i++) { const w = winOf(i * 7 + Math.floor(i / 6), 500 + i); w.style.cssText = `width:560px;height:350px;font-size:24px;border-radius:18px;left:${60 + (i % 6) * 600}px;top:${60 + Math.floor(i / 6) * 390}px`; wall.appendChild(w); }
    c.el.appendChild(el("div", "abs", "", "left:0;top:0;width:1920px;height:1080px;background:radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,.35) 100%);z-index:4"));
    const cam = `#${c.id}cam`, s0 = 2.8, s1 = 0.52;
    baseline(cam);
    tl.fromTo(cam, { scale: s0, x: -60 * s0 - 600 * s0 + 960, y: -60 * s0 + 130 }, { scale: s1, x: 960 - 1860 * s1, y: 540 - 810 * s1, duration: Math.min(1.5, c.D * 0.7), ease: E.io }, c.at(0.15));
    tl.fromTo(cam, { scale: s1 }, { scale: s1 * 0.85, x: 960 - 1860 * s1 * 0.85, y: 540 - 810 * s1 * 0.85, duration: Math.max(0.2, c.D - Math.min(1.5, c.D * 0.7) - 0.15), ease: "none" }, c.at(0.15 + Math.min(1.5, c.D * 0.7)));
    c.el.appendChild(el("div", "abs", "", "left:0;top:700px;width:1920px;height:380px;background:linear-gradient(transparent,var(--bg) 78%);z-index:5"));       // a ground under the line so it reads over the wall
    const [t1, t2] = c.v.line;
    c.el.appendChild(el("div", "mask", `<span class="big" id="${c.id}t" style="font-size:112px;display:block;text-align:center;position:relative">${t1} <span class="acc">${t2}</span></span>`, `left:0;top:850px;width:1920px;height:140px;text-align:center;z-index:6`));
    baseline(`#${c.id}t`); show(`#${c.id}t`, c.at(c.D * 0.45)); tl.fromTo(`#${c.id}t`, { y: 150 }, { y: 0, duration: 0.45, ease: E.out }, c.at(c.D * 0.45)); c.sfx("pop", c.at(c.D * 0.45), 0.5);
    $(`#${c.id}t`).style.opacity = "0";
  };
