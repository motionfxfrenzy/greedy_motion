  // the tilted 3D field of screens and drifting icons
  S["field-3d"] = (c) => {
    const root = el("div", "abs f3", `<div class="zin" id="${c.id}z"><div class="plane" id="${c.id}p"></div></div>`, "left:0;top:0;width:1920px;height:1080px;perspective:2200px;perspective-origin:50% 46%");
    c.el.appendChild(root); const plane = $(`#${c.id}p`);
    for (let i = 0; i < 12; i++) { const w = winOf(i, 300 + i), col = i % 4, rw = Math.floor(i / 4); w.style.cssText = `width:1000px;height:640px;font-size:38px;left:${(col - 1.5) * 1180}px;top:${(rw - 1) * 780 - 320}px`; plane.appendChild(w); }
    const icons = product.icons.slice(0, 8);
    icons.forEach(([g, col], i) => { const d = el("div", "icon", g, `background:${col === "A" ? pal.accent : col === "B" ? pal.accent2 : pal.text};color:${pal.ink}`); decor(d); d.dataset.i = i; plane.appendChild(d); });
    const flip = c.v.dir === "l" ? -1 : 1;
    baseline(`#${c.id}p`);
    tl.fromTo(`#${c.id}p`, { rotationX: 62, rotationZ: -34 * flip, x: 620 * flip, y: 260, z: -160 }, { rotationX: 62, rotationZ: -34 * flip, x: -760 * flip, y: -140, z: 0, duration: c.D + 0.3, ease: E.io }, c.at(-0.1));
    $$(".icon", plane).forEach((ic, i) => { const x0 = -1500 + i * 520, y0 = -520 + (i % 3) * 380, z = 180 + (i % 4) * 90; tl.fromTo(ic, { x: x0, y: y0, z, rotationZ: 34 * flip, rotationX: -62, opacity: 0, scale: 0.4 }, { x: x0, y: y0, z, rotationZ: 34 * flip, rotationX: -62, opacity: 1, scale: 1, duration: 0.45, ease: SP }, c.at(0.2 + i * 0.04)); });
    // the headline sits OUTSIDE the tilted plane
    const [h1, h2] = c.v.lines;
    const side = c.v.textSide === "r" ? "right:110px;text-align:right" : "left:110px";
    c.el.appendChild(el("div", "abs scrim " + (c.v.textSide === "r" ? "r" : "l"), "", "z-index:5"));
    c.el.appendChild(el("div", "mask", `<span class="big" id="${c.id}h1" style="font-size:118px">${h1}</span>`, `${side};top:668px;width:1000px;height:130px`));
    c.el.appendChild(el("div", "mask", `<span class="big acc" id="${c.id}h2" style="font-size:118px">${h2}</span>`, `${side};top:818px;width:1000px;height:130px`));
    baseline(`#${c.id}h1`, `#${c.id}h2`); rise(`#${c.id}h1`, c.at(0.4), 0.45, 140); rise(`#${c.id}h2`, c.at(0.4 + 0.4), 0.45, 140);
    c.sfx("pop", c.at(0.4), 0.5); c.sfx("pop", c.at(0.8), 0.5);
  };
