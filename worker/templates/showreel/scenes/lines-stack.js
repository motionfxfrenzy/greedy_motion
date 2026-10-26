  // a stack of big lines, one after another; the last keeps pushing
  S["lines-stack"] = (c) => {
    const lines = c.v.lines, n = lines.length, step = (c.D - 0.2) / n;
    lines.forEach((ln, i) => {
      const size = letterFit(ln.map((x) => x[0]).join(" "), 1600, P.bigType + 20, 0.5);
      c.el.appendChild(el("div", "line5 abs", `<span class="big" style="font-size:${size}px">${ln.map(([w, a]) => `<span class="w ${a ? "acc" : ""}">${w}</span>`).join(" ")}</span>`, `opacity:0;left:0;top:396px;width:1920px;height:270px;overflow:hidden;text-align:center;z-index:7`));
    });
    const L = $$(".line5", c.el); baseline(...L.map((l) => $(".big", l)), ...$$(".w", c.el));
    L.forEach((l, i) => {
      const t = c.at(0.05 + i * step) - 0.08, last = i === n - 1, big = $(".big", l);
      show(l, t); if (!last) hide(l, t + step + 0.36);
      tl.fromTo(big, { y: 280 }, { y: 0, duration: i ? 0.34 : 0.45, ease: i ? E.io : E.out }, t);
      $$(".w", l).forEach((w, j) => tl.fromTo(w, { y: 70 * (j + 1) }, { y: 0, duration: 0.45, ease: E.out }, t + 0.1 + j * P.stagger));
      if (!last) tl.fromTo(big, { y: 0 }, { y: -280, duration: 0.34, ease: E.io }, t + step);       // leaves in the same move that brings the next line in: one pushes the other
      else tl.fromTo(big, { scale: 1 }, { scale: 1.1, duration: Math.max(0.4, c.sc.t + c.D - t), ease: "none" }, t + 0.1);
      c.sfx("pop", t + 0.1, 0.55);
    });
  };
