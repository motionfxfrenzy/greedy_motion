  // NEW: three feature cards
  S["trio-cards"] = (c) => {
    const f = product.features.slice(0, 3), numbered = c.v.numbered;
    c.el.appendChild(el("div", "abs", `<div class="kicker mono" style="top:150px" id="${c.id}k">${product.trioKicker}</div><div class="trio">${f.map((x, i) => `<div class="card3 c${i}">${numbered ? `<div class="num3">${i + 1}</div>` : `<div class="ic3" style="background:${i === 1 ? pal.accent2 : pal.accent}">${x.glyph}</div>`}<div class="t3 head">${x.title}</div><div class="d3">${x.detail}</div><div class="bar" style="width:70%"></div><div class="bar" style="width:45%"></div></div>`).join("")}</div>`, "left:0;top:0;width:1920px;height:1080px"));
    baseline(...$$(".card3", c.el));
    tl.fromTo(`#${c.id}k`, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: E.soft }, c.at(0.05));
    $$(".card3", c.el).forEach((cd, i) => {
      const t = c.at(0.15 + i * P.stagger * 3);
      if (c.v.style === "slide") { tl.fromTo(cd, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, t); tl.fromTo(cd, { y: 110 }, { y: 0, duration: 0.6, ease: E.out }, t); }
      else { pop(cd, t, 0.55); }
      c.sfx("pop", t + 0.05, 0.45);
    });
    tl.fromTo($(".trio", c.el), { scale: 1 }, { scale: 1.04, duration: c.D, ease: "none" }, c.at(0.2));
    // after they land, each card takes a turn to lift and glow: the hold is never a still
    const cardsAll = $$(".card3", c.el), tl0 = c.at(0.15 + 3 * P.stagger * 3 + 0.7), slot = Math.max(0.3, (c.D - (tl0 - c.sc.t) - 0.15) / 3);
    cardsAll.forEach((cd, i) => { const t = tl0 + i * slot; tl.fromTo(cd, { y: 0, scale: 1 }, { y: -22, scale: 1.035, duration: 0.2, ease: E.out }, t); tl.fromTo(cd, { y: -22, scale: 1.035 }, { y: 0, scale: 1, duration: 0.25, ease: E.io }, t + slot * 0.8); });
  };
