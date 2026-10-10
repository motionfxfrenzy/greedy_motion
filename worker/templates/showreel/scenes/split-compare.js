  // NEW: before / after, a divider wipes across
  S["split-compare"] = (c) => {
    const B = product.before, A = product.after;
    c.el.appendChild(el("div", "abs", `<div class="cmpwrap"><div class="pane before"><div class="pk mono">${B.kicker}</div>${B.items.map((x, i) => `<div class="pi" style="--r:${(i % 2 ? 1 : -1) * 1.6}deg">${x}</div>`).join("")}</div><div class="pane after" id="${c.id}a"><div class="pk mono">${A.kicker}</div>${A.items.map((x) => `<div class="pi ok">${x}</div>`).join("")}</div><div class="divider" id="${c.id}d"></div></div>`, "left:0;top:0;width:1920px;height:1080px"));
    allow(c.el.lastChild); baseline(`#${c.id}d`);
    const dur = Math.min(0.9, c.D * 0.4);
    tl.fromTo(`#${c.id}a`, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: dur, ease: E.io }, c.at(c.D * 0.35));
    tl.fromTo(`#${c.id}d`, { x: 0 }, { x: 1560, duration: dur, ease: E.io }, c.at(c.D * 0.35));
    $$(".before .pi", c.el).forEach((p, i) => tl.fromTo(p, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.35, ease: E.out }, c.at(0.1 + i * P.stagger * 1.5)));
    $$(".after .pi", c.el).forEach((p, i) => tl.fromTo(p, { y: 30 }, { y: 0, duration: 0.4, ease: E.out }, c.at(c.D * 0.35 + 0.1 + i * P.stagger)));
    hide($(".pane.before", c.el), c.at(c.D * 0.35) + dur + 0.02);                         // once the wipe is done the old pane is gone, not hidden underneath
    c.sfx("whoosh", c.at(c.D * 0.35) - 0.1, 0.5);
  };
