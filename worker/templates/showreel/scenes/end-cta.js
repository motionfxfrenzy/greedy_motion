  S["end-cta"] = (c) => {
    const rec = product.recap.slice(0, 3);
    c.el.appendChild(el("div", "abs", `<div id="${c.id}cam" class="endcam"><div class="recap">${rec.map((r, i) => `<div class="tick" id="${c.id}t${i}"><i>✓</i><span class="head">${r}</span></div>`).join("")}</div><div style="position:absolute;left:0;top:640px;width:1920px;display:flex;justify-content:center"><div id="${c.id}cta" class="ctabtn head">${product.cta}</div></div><div class="ctalogo">${mark(c, c.id + "m", 84)}<span class="head">${brand.name}</span><span class="mono" style="color:var(--mut);margin-left:18px">${brand.url}</span></div></div>`, "left:0;top:0;width:1920px;height:1080px"));
    baseline(...rec.map((_, i) => `#${c.id}t${i}`), `#${c.id}cta`, `#${c.id}cam`);
    rec.forEach((_, i) => { const t = c.at(0.1 + i * 0.35); tl.fromTo(`#${c.id}t${i}`, { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.45, ease: E.out }, t); c.sfx("pop", t + 0.05, 0.4); });
    pop(`#${c.id}cta`, c.at(0.1 + rec.length * 0.35 + 0.1), 0.55); c.sfx("chime", c.at(0.1 + rec.length * 0.35 + 0.1), 0.4);
    tl.fromTo(`#${c.id}cam`, { scale: 1 }, { scale: 1.04, duration: c.D, ease: "none" }, c.at(0.1));
  };
