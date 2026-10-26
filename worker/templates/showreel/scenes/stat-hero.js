  // NEW: one giant number, a label, a bar that fills
  S["stat-hero"] = (c) => {
    const st = product.stat, size = letterFit(String(st.n.toLocaleString("en-US")) + (st.suffix || ""), 1500, 320, 0.62);
    c.el.appendChild(el("div", "abs", `<div class="kicker mono" id="${c.id}k" style="top:230px">${st.kicker}</div><div class="mask" style="top:300px;height:${size * 1.1}px;left:0;width:1920px;text-align:center"><span class="big mono2" id="${c.id}n" style="font-size:${size}px;display:block;text-align:center;position:relative">0</span></div><div class="mask" style="top:${300 + size * 1.18}px;height:90px;left:0;width:1920px;text-align:center"><span class="big acc" id="${c.id}l" style="font-size:64px;display:block;text-align:center;position:relative">${st.label}</span></div><div class="statbar"><i id="${c.id}f"></i></div>`, "left:0;top:0;width:1920px;height:1080px"));
    baseline(`#${c.id}n`, `#${c.id}l`);
    rise(`#${c.id}n`, c.at(0.05), 0.5, size * 1.2); rise(`#${c.id}l`, c.at(0.35), 0.45, 100);
    tl.fromTo(`#${c.id}k`, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: E.soft }, c.at(0.05));
    const num = { v: 0 }, ne = $(`#${c.id}n`);
    tl.fromTo(num, { v: 0 }, { v: st.n, duration: Math.min(1.2, c.D * 0.6), ease: E.soft, onUpdate: () => { ne.textContent = Math.round(num.v).toLocaleString("en-US") + (st.suffix || ""); } }, c.at(0.1));
    tl.fromTo(`#${c.id}f`, { scaleX: 0 }, { scaleX: 1, duration: Math.min(1.2, c.D * 0.6), ease: E.soft }, c.at(0.1));
    tl.fromTo(`#${c.id}n`, { scale: 1 }, { scale: 1.05, duration: c.D, ease: "none" }, c.at(0.1));
    c.sfx("pop", c.at(0.35), 0.5);
  };
