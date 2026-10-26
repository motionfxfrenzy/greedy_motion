  S["end-calm"] = (c) => {
    c.el.appendChild(el("div", "abs", `<div id="${c.id}bloom" class="bloom"></div><div id="${c.id}cam" class="endcam"><div style="position:absolute;left:0;top:210px;width:1920px;display:flex;justify-content:center">${mark(c, c.id + "m", 220)}</div><div class="mask nm" style="top:470px;height:190px"><span class="head nmt endc" style="font-size:150px">${nameChars(brand.name)}</span></div><div class="mask" style="left:0;top:680px;width:1920px;height:90px;text-align:center"><div id="${c.id}tag" class="head tag endc" style="font-weight:400">${brand.tagline}</div></div><div id="${c.id}url" class="urlpill soft">${brand.url}</div></div>`, "left:0;top:0;width:1920px;height:1080px"));
    baseline(`#${c.id}m`, `#${c.id}url`, `#${c.id}cam`, ...$$(".ch", c.el), `#${c.id}tag`, `#${c.id}bloom`);
    const t0 = c.at(0.0);
    tl.fromTo(`#${c.id}bloom`, { scale: 0.2, opacity: 0.0 }, { scale: 1.4, opacity: 0.55, duration: 1.4, ease: E.soft }, t0);
    tl.fromTo(`#${c.id}m`, { opacity: 0, y: 50, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.9, ease: E.out }, t0 + 0.1);
    $$(".ch", c.el).forEach((ch, i) => tl.fromTo(ch, { y: 190 }, { y: 0, duration: 0.8, ease: E.out }, t0 + 0.45 + i * 0.05));
    tl.fromTo(`#${c.id}tag`, { y: 100 }, { y: 0, duration: 0.8, ease: E.out }, t0 + 1.0);
    tl.fromTo(`#${c.id}url`, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7, ease: E.out }, t0 + 1.4);
    tl.fromTo(`#${c.id}cam`, { scale: 1 }, { scale: 1.04, duration: Math.max(1, c.D - 0.1), ease: "none" }, t0);
    c.sfx("chime", t0 + 0.3, 0.45); c.sfx("pop", t0 + 1.4, 0.3);
  };
