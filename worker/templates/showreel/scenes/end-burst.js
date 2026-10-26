  S["end-burst"] = (c) => {
    c.el.appendChild(el("div", "abs", `<div id="${c.id}flood" class="flood"></div><div id="${c.id}shards" class="shards"></div><div id="${c.id}cam" class="endcam"><div style="position:absolute;left:0;top:200px;width:1920px;display:flex;justify-content:center">${mark(c, c.id + "m", 280)}</div><div class="mask nm" style="top:510px;height:210px"><span class="head nmt endc">${nameChars(brand.name)}</span></div><div class="mask" style="left:0;top:742px;width:1920px;height:90px;text-align:center"><div id="${c.id}tag" class="head tag endc">${brand.tagline}</div></div><div id="${c.id}url" class="urlpill">${brand.url}</div></div><div id="${c.id}flash" class="flash"></div>`, "left:0;top:0;width:1920px;height:1080px"));
    const R = mulberry(plan.seed ^ 0x5eed), PAL = [pal.accent, "#ffffff", pal.accent2, pal.flash2, pal.accent, pal.ink], sh = $(`#${c.id}shards`), shards = [];
    for (let i = 0; i < 44; i++) { const a = R() * Math.PI * 2, dist = 380 + R() * 900, size = 60 + R() * 220, d = el("div", "shard", "", `width:${size}px;height:${size * (0.6 + R() * 0.6)}px;background:${PAL[Math.floor(R() * PAL.length)]};clip-path:polygon(${(R() * 40).toFixed(0)}% 0,100% ${(R() * 60).toFixed(0)}%,${(30 + R() * 50).toFixed(0)}% 100%)`); sh.appendChild(d); shards.push({ d, a, dist, rot: (R() - 0.5) * 720, delay: R() * 0.06 }); }
    baseline(`#${c.id}m`, `#${c.id}url`, `#${c.id}cam`, ...$$(".ch", c.el), `#${c.id}tag`, ...shards.map((s) => s.d));
    const t0 = c.at(0.0);
    tl.fromTo(`#${c.id}flash`, { opacity: 0.8 }, { opacity: 0, duration: 0.3, ease: E.soft }, t0);
    tl.fromTo(`#${c.id}flood`, { clipPath: "circle(0px at 960px 540px)" }, { clipPath: "circle(1130px at 960px 540px)", duration: 0.4, ease: E.soft }, t0);
    shards.forEach(({ d, a, dist, rot, delay }) => { const x = Math.cos(a) * dist, y = Math.sin(a) * dist; tl.fromTo(d, { x: 960, y: 540, scale: 0.15, rotation: 0, opacity: 1 }, { x: 960 + x, y: 540 + y, scale: 1, rotation: rot, opacity: 1, duration: 1.3, ease: "power4.out" }, t0 + delay); tl.fromTo(d, { opacity: 1 }, { opacity: 0, duration: 0.5, ease: E.in }, t0 + 1.1 + delay); });
    tl.fromTo(`#${c.id}m`, { opacity: 0, scale: 0.2, rotation: -14 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.7, ease: SP }, t0 + 0.25);
    $$(".ch", c.el).forEach((ch, i) => tl.fromTo(ch, { y: 230 }, { y: 0, duration: 0.55, ease: E.out }, t0 + 0.6 + i * 0.045));
    tl.fromTo(`#${c.id}tag`, { y: 110 }, { y: 0, duration: 0.55, ease: E.out }, t0 + 1.15);
    tl.fromTo(`#${c.id}url`, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: SP }, t0 + 1.5);
    tl.fromTo(`#${c.id}cam`, { scale: 1 }, { scale: 1.06, duration: Math.max(1, c.D - 0.3), ease: "none" }, t0 + 0.3);
    c.sfx("impact", t0 - 0.024, 0.75); c.sfx("chime", t0 + 0.4, 0.45); c.sfx("pop", t0 + 1.5, 0.5);
  };
