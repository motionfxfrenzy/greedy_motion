  // NEW: the product at the centre, its parts orbiting and settling on a ring
  S["hub-orbit"] = (c) => {
    const sats = product.features.map((x) => x.title).concat(product.integrations).slice(0, 9);
    c.el.appendChild(el("div", "abs", `<div class="hubname head" id="${c.id}h">${brand.name}</div><div class="hubsub mono" id="${c.id}s">${product.hubSub}</div><div id="${c.id}ring" class="ringwrap"></div>`, "left:0;top:0;width:1920px;height:1080px"));
    const ring = $(`#${c.id}ring`); baseline(`#${c.id}h`, `#${c.id}ring`);
    sats.forEach((s, i) => { const d = el("div", "sat", s); decor(d); d.style.background = i % 3 === 0 ? pal.accent : i % 3 === 1 ? pal.panel2 : pal.text; d.style.color = i % 3 === 0 ? pal.ink : i % 3 === 1 ? pal.text : pal.bg; ring.appendChild(d); });
    const sa = $$(".sat", ring); baseline(...sa);
    sa.forEach((d, i) => { const a = (i / sa.length) * Math.PI * 2 - Math.PI / 2, rx = 640, ry = 330, x = Math.cos(a) * rx, y = Math.sin(a) * ry; tl.fromTo(d, { x: x * 1.9, y: y * 1.9, scale: 0.4, opacity: 0 }, { x, y, scale: 1, opacity: 1, duration: 0.7, ease: E.out }, c.at(0.15 + i * P.stagger * 1.4)); });
    tl.fromTo(`#${c.id}h`, { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.5, ease: SP }, c.at(0.05));
    tl.fromTo(`#${c.id}s`, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: E.soft }, c.at(0.3));
    tl.fromTo(`#${c.id}ring`, { rotation: 0 }, { rotation: 14, duration: c.D, ease: "none" }, c.at(0.1));       // the whole ring keeps turning: a camera, not a wobble
    c.sfx("pop", c.at(0.1), 0.4); c.sfx("chime", c.at(0.9), 0.3);
  };
