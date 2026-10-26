  // NEW: numbered steps along a path with a travelling cursor
  S["step-path"] = (c) => {
    const st = product.steps.slice(0, 4), xs = [330, 760, 1190, 1620];
    c.el.appendChild(el("div", "abs", `<div class="kicker mono" style="top:170px" id="${c.id}k">${product.stepsKicker}</div><svg class="pathsvg" viewBox="0 0 1920 1080"><path id="${c.id}pth" d="M ${xs[0]} 560 C ${xs[0] + 200} 460, ${xs[1] - 200} 660, ${xs[1]} 560 S ${xs[2] - 200} 460, ${xs[2]} 560 S ${xs[3] - 200} 660, ${xs[3]} 560" fill="none" stroke="${pal.line}" stroke-width="6" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/></svg>${st.map((s, i) => `<div class="step" id="${c.id}s${i}" style="left:${xs[i] - 90}px;top:${i % 2 ? 640 : 330}px"><div class="stn">${i + 1}</div><div class="stt head">${s}</div></div>`).join("")}<div class="cursor" id="${c.id}cur"></div>`, "left:0;top:0;width:1920px;height:1080px"));
    baseline(`#${c.id}cur`, ...st.map((_, i) => `#${c.id}s${i}`));
    const dur = c.D - 0.4, per = dur / st.length;
    tl.fromTo(`#${c.id}pth`, { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: dur, ease: "none" }, c.at(0.1));
    tl.fromTo(`#${c.id}k`, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: E.soft }, c.at(0.05));
    st.forEach((_, i) => { const t = c.at(0.1 + i * per); pop(`#${c.id}s${i}`, t, 0.5); c.sfx("pop", t + 0.05, 0.45); });
    // the cursor visits each step on a smooth curve (one tween per leg, same ease family)
    xs.slice(0, st.length).forEach((x, i) => { const y = 560 + (i % 2 ? 30 : -30); const x0 = i ? xs[i - 1] : x - 300, y0 = i ? 560 + ((i - 1) % 2 ? 30 : -30) : 640; tl.fromTo(`#${c.id}cur`, { x: x0 - 40, y: y0 }, { x: x - 40, y, duration: i ? per : 0.4, ease: E.io }, i ? c.at(0.1 + i * per - per * 0.5) : c.at(0.0)); });
    show(`#${c.id}cur`, c.at(0)); $(`#${c.id}cur`).style.opacity = "0";
  };
