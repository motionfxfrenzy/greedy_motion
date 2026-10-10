  // HOOK: the product's own action. A request typed into a composer.
  S["hook-type"] = (c) => {
    const text = product.prompt, n = text.length, CH = 32.4, glow = c.v.glow;
    c.el.appendChild(el("div", "abs", `<div id="${c.id}glow" class="glowbox ${glow ? "" : "off"}"><div class="glowin"></div></div><div id="${c.id}cmp" class="cmp"><div class="typedwrap"><span class="typed mono" id="${c.id}typed">${text}</span><span class="caret" id="${c.id}caret"></span></div><div class="send" id="${c.id}send">↑</div></div>`, "left:0;top:0;width:1920px;height:1080px"));
    const cmp = `#${c.id}cmp`, typed = `#${c.id}typed`, caret = `#${c.id}caret`, send = `#${c.id}send`, gl = `#${c.id}glow`;
    $(typed).style.fontSize = Math.min(54, Math.floor(980 / (n * 0.6))) + "px";
    const cw = Math.min(54, Math.floor(980 / (n * 0.6))) * 0.6;
    baseline(cmp, send, caret, gl);
    const t0 = c.at(0.1), tType = Math.min(c.D * 0.5, n * 0.045), tSend = t0 + tType + 0.25;
    tl.fromTo(cmp, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: SP }, t0);
    if (glow) { tl.fromTo(gl, { opacity: 0 }, { opacity: 0.95, duration: 0.3, ease: E.soft }, t0); tl.fromTo(`${gl} .glowin`, { rotation: 0 }, { rotation: 360, duration: c.D + 0.8, ease: "none" }, t0); }
    tl.fromTo(typed, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: tType, ease: `steps(${n})` }, t0 + 0.2);
    show(caret, t0 + 0.2); tl.fromTo(caret, { x: 0 }, { x: n * cw, duration: tType, ease: `steps(${n})` }, t0 + 0.2); hide(caret, t0 + 0.2 + tType + 0.05);
    tl.fromTo(send, { scale: 1 }, { scale: 0.86, duration: 0.08, ease: E.soft }, tSend - 0.08);
    tl.fromTo(send, { scale: 0.86 }, { scale: 1, duration: 0.4, ease: SP }, tSend);
    c.sfx("typing", c.at(0.1), 0.4); c.sfx("click", tSend - 0.02, 0.7);
    // the pill grows toward the next scene's window (shared element) when the scene is long enough
    if (c.v.grow) { tl.fromTo(cmp, { scale: 1 }, { scale: c.v.grow, duration: Math.max(0.3, c.D - (tSend - c.sc.t) - 0.1), ease: E.io }, tSend + 0.1); }
  };
