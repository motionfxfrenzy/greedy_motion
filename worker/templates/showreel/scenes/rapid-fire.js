  // NEW (benchmark B, 6.6-9.4 s): the rapid-fire strip. One layout, a new card every beat: kicker + headline left, a tilted UI card right
  S["rapid-fire"] = (c) => {
    const items = product.rapid.slice(0, 6), n = Math.max(3, Math.min(items.length, Math.round(c.D / 0.7))), per = c.D / n, flip = c.v.flip;
    const fg = flip ? "var(--ink)" : "var(--text)", ac = flip ? "var(--ink)" : "var(--accent)";
    c.el.appendChild(el("div", "abs", "", `left:0;top:0;width:1920px;height:1080px;background:${flip ? "var(--accent)" : "transparent"};z-index:0`));
    for (let i = 0; i < n; i++) {
      const it = items[i % items.length], g = el("div", "abs rf", `<div class="rfk mono" id="${c.id}k${i}" style="color:${flip ? "var(--ink)" : "var(--mut)"}">${it.kicker}</div><div class="mask rfm" style="top:420px;height:150px"><span class="big" id="${c.id}a${i}" style="font-size:132px;color:${fg}">${it.head[0]}</span></div>${it.head[1] ? `<div class="mask rfm" style="top:566px;height:150px"><span class="big" id="${c.id}b${i}" style="font-size:132px;color:${ac};${flip ? "opacity:.72" : ""}">${it.head[1]}</span></div>` : ""}<div class="rfcard" id="${c.id}c${i}"></div>`, "left:0;top:0;width:1920px;height:1080px;opacity:0;z-index:2");
      c.el.appendChild(g);
      const card = $(`#${c.id}c${i}`), w = winOf(i + c.v.shift, 700 + i); w.style.cssText = "width:900px;height:600px;font-size:36px;left:0;top:0"; card.appendChild(w);
      baseline(card, `#${c.id}a${i}`, `#${c.id}k${i}`); if (it.head[1]) baseline(`#${c.id}b${i}`);
      // cause and effect: each item enters while the previous one leaves in the same move (headline up, card out to the left), eased the same
      // way on both so they stay a fixed distance apart and never overlap; the first item arrives with the scene, the last stays
      const t = c.at(i * per), x = Math.min(0.32, per * 0.5), enter = i ? t - x / 2 : t, exit = c.at((i + 1) * per) - x / 2;
      show(g, i ? enter : t); if (i < n - 1) hide(g, exit + x + 0.01);
      if (i) {
        tl.fromTo(`#${c.id}k${i}`, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: x * 0.7, ease: E.out }, enter + x * 0.45);       // the small label arrives after the old words have gone: it never crosses them
        tl.fromTo(`#${c.id}a${i}`, { y: 290 }, { y: 0, duration: x, ease: E.io }, enter);
        if (it.head[1]) tl.fromTo(`#${c.id}b${i}`, { y: 290 }, { y: 0, duration: x, ease: E.io }, enter + 0.04);
        tl.fromTo(card, { x: 980, rotationY: -26, rotationX: 8, filter: blur(10) }, { x: 0, rotationY: -20, rotationX: 8, filter: blur(0), duration: x, ease: E.io }, enter);
      } else {
        tl.fromTo(`#${c.id}a${i}`, { y: 170 }, { y: 0, duration: 0.34, ease: E.out }, t + 0.02);
        if (it.head[1]) tl.fromTo(`#${c.id}b${i}`, { y: 170 }, { y: 0, duration: 0.34, ease: E.out }, t + 0.1);
        tl.fromTo(card, { x: 900, rotationY: -26, rotationX: 8, filter: blur(10) }, { x: 0, rotationY: -20, rotationX: 8, filter: blur(0), duration: 0.4, ease: E.out }, t);
      }
      if (i < n - 1) {
        tl.fromTo(`#${c.id}k${i}`, { opacity: 1 }, { opacity: 0, duration: x * 0.4, ease: "none" }, exit);
        tl.fromTo(`#${c.id}a${i}`, { y: 0 }, { y: -290, duration: x, ease: E.io }, exit);
        if (it.head[1]) tl.fromTo(`#${c.id}b${i}`, { y: 0 }, { y: -290, duration: x, ease: E.io }, exit + 0.04);
        tl.fromTo(card, { x: 0, filter: blur(0) }, { x: -980, filter: blur(10), duration: x, ease: E.io }, exit);
      }
      tl.fromTo(card, { rotationY: -20 }, { rotationY: -14, duration: Math.max(0.2, per - x), ease: "none" }, t + x / 2);       // the card keeps yawing: no static hold
      const rowsIn = $$(".row, .inv, .stat", card); if (rowsIn.length) tl.fromTo(rowsIn, { opacity: 0.2 }, { opacity: 1, duration: 0.2, stagger: 0.05, ease: "none" }, t + 0.1);
      c.sfx("pop", t + 0.05, 0.5);
    }
  };
