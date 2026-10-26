  // HOOK 2: the pain, kinetic type, a kicker above it
  S["hook-kinetic"] = (c) => {
    const [a, b] = product.hook;
    const size = letterFit(a.length > b.length ? a : b, 1500, P.bigType, 0.5);
    c.el.appendChild(el("div", "abs", `${c.v.kicker ? `<div class="kicker mono" id="${c.id}k">${product.kicker}</div>` : ""}<div class="mask" style="top:410px;height:${size * 1.15}px"><span class="big" id="${c.id}a" style="font-size:${size}px">${a}</span></div><div class="mask" style="top:${410 + size * 1.22}px;height:${size * 1.15}px"><span class="big acc" id="${c.id}b" style="font-size:${size}px">${b}</span></div>`, "left:0;top:0;width:1920px;height:1080px"));
    baseline(`#${c.id}a`, `#${c.id}b`);
    rise(`#${c.id}a`, c.at(0.1), 0.5, size * 1.3); rise(`#${c.id}b`, c.at(0.1 + P.stagger * 3), 0.5, size * 1.5);
    if (c.v.kicker) tl.fromTo(`#${c.id}k`, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: E.soft }, c.at(0.05));
    tl.fromTo(`#${c.id}a`, { scale: 1 }, { scale: 1.04, duration: c.D, ease: "none" }, c.at(0.1));
    // a bar draws under the second line once it has landed, then the first line lifts slightly: motion through the whole hold
    c.el.appendChild(el("div", "abs", "", `left:${960 - size * (b.length * 0.5) * 0.5}px;top:${410 + size * 2.38}px;width:${size * b.length * 0.5}px;height:12px;border-radius:6px;background:var(--accent);transform-origin:0 50%;z-index:6`)); const ul = c.el.lastChild; baseline(ul);
    tl.fromTo(ul, { scaleX: 0 }, { scaleX: 1, duration: Math.min(0.6, c.D * 0.3), ease: E.out }, c.at(0.55));
    c.sfx("pop", c.at(0.1), 0.5);
  };
