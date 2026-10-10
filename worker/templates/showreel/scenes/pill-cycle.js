  // NEW (benchmark A, 0.0-2.8 s): "Chat with [word]": a selected pill cycles words fast, resizes and recolours, lands on the claim
  S["pill-cycle"] = (c) => {
    const cy = product.cycle, words = cy.words.slice(0, 5).concat([cy.final]), n = words.length, size = 150, cw = size * 0.52, pad = 70, gap = 34;
    const pw = words.map((w) => Math.round(w.length * cw + pad * 2)), leadW = Math.round(cy.lead.length * size * 0.5), Wmax = Math.max(...pw);
    const cols = [pal.accent2, pal.hue1, pal.hue2, pal.hue3, pal.accent2, pal.accent].slice(0, n - 1).concat([pal.accent]);
    const total = (k) => leadW + gap + pw[k], leadX = (k) => Math.round(960 - total(k) / 2), pillX = (k) => leadX(k) + leadW + gap, top = 440;
    c.el.appendChild(el("div", "abs", `<div class="mask pcmask" style="left:0;top:${top}px;width:${leadW + 40}px;height:${size * 1.25}px;text-align:left"><span class="big" id="${c.id}lead" style="font-size:${size}px;left:0">${cy.lead}</span></div><div class="pc" id="${c.id}pc" style="top:${top - 4}px;height:${size * 1.25}px;width:${pw[0]}px"><div class="pcbg" id="${c.id}bg"></div><div class="pcl">${words.map((w, k) => `<span class="pcw big" id="${c.id}w${k}" style="font-size:${size}px;color:${inkFor(cols[k])}">${w}</span>`).join("")}</div><div class="pcsel" id="${c.id}sel"><i class="h a"></i><i class="h b"></i><i class="h c"></i><i class="h d"></i><span class="pctag mono" id="${c.id}tag">${pw[0]} × ${Math.round(size * 1.25)}</span></div></div>`, "left:0;top:0;width:1920px;height:1080px"));
    allow(c.el); const L = `#${c.id}lead`, PC = `#${c.id}pc`, BG = `#${c.id}bg`, SEL = `#${c.id}sel`, W = (k) => `#${c.id}w${k}`, lead = $(`#${c.id}lead`).parentElement;
    baseline(L, PC, ...words.map((_, k) => W(k)));
    const step = Math.max(0.2, Math.min(0.34, (c.D * 0.5) / n)), t0 = c.at(0.3), tEnd = t0 + (n - 1) * step;
    // the mask for the lead sits at the group's left edge; its x follows the group centre as the pill resizes
    tl.fromTo(L, { y: size * 1.4 }, { y: 0, duration: 0.5, ease: E.out }, c.at(0.05));
    tl.fromTo(lead, { x: leadX(0) }, { x: leadX(0), duration: 0, ease: "none" }, c.at(0));
    tl.fromTo(PC, { opacity: 0, scale: 0.4, x: pillX(0) }, { opacity: 1, scale: 1, x: pillX(0), duration: 0.35, ease: SP }, c.at(0.2));
    // a reel: each new word pushes the old one up and out in the same move, exactly one pill-height apart, so two words never share a place
    const H = Math.round(size * 1.25);
    words.forEach((w, k) => {
      const t = t0 + k * step, d = Math.min(0.22, step * 0.85);
      if (k === 0) { show(W(0), t0); tl.fromTo(W(0), { y: H }, { y: 0, duration: d, ease: E.io }, t0); }
      else {
        tl.fromTo(W(k - 1), { y: 0 }, { y: -H, duration: d, ease: E.io }, t); hide(W(k - 1), t + d + 0.01);
        show(W(k), t); tl.fromTo(W(k), { y: H }, { y: 0, duration: d, ease: E.io }, t);
        tl.fromTo(PC, { x: pillX(k - 1), width: pw[k - 1] }, { x: pillX(k), width: pw[k], duration: d, ease: E.io }, t);
        tl.fromTo(lead, { x: leadX(k - 1) }, { x: leadX(k), duration: d, ease: E.io }, t);
        tl.fromTo(BG, { backgroundColor: cols[k - 1] }, { backgroundColor: cols[k], duration: d, ease: "none" }, t);
        c.sfx("pop", t + 0.04, 0.22);
      }
    });
    tl.fromTo(BG, { backgroundColor: cols[0] }, { backgroundColor: cols[0], duration: 0, ease: "none" }, c.at(0));
    tl.fromTo(SEL, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: E.soft }, c.at(0.35));
    tl.fromTo(`#${c.id}pc`, { y: 0 }, { y: 0, duration: 0, ease: "none" }, c.at(0));
    tl.fromTo([lead, PC], { scale: 1 }, { scale: 1.03, duration: Math.max(0.3, c.D - 0.6), ease: "none" }, tEnd + 0.1);
    c.sfx("pop", c.at(0.1), 0.5);
  };
