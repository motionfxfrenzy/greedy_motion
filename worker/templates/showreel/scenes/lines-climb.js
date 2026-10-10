  // NEW (benchmark B, 11.4-12.8 s): lines that climb: each new line is larger, dims the one before; optional proof badges + a real number
  S["lines-climb"] = (c) => {
    const L = product.climb.slice(0, 3), sizes = [96, 118, 150], tops = [330, 470, 630], pr = product.proof;
    c.el.appendChild(el("div", "abs", L.map((ln, i) => `<div class="mask" style="top:${tops[i]}px;height:${sizes[i] * 1.2}px"><span class="big ${i === L.length - 1 ? "acc" : ""}" id="${c.id}l${i}" style="font-size:${sizes[i]}px">${ln}</span></div>`).join("") + (pr ? `<div class="proofrow" id="${c.id}pr">${pr.badges.map((b) => `<div class="pbadge"><span class="lau">❦</span><div><b class="mono">${b.top}</b><i>${"★".repeat(b.stars)}</i><small class="mono">${b.label}</small></div><span class="lau r">❦</span></div>`).join("")}</div><div class="proofline mono" id="${c.id}pl">${pr.line}</div>` : ""), "left:0;top:0;width:1920px;height:1080px"));
    const step = (c.D - (pr ? 0.9 : 0.2)) / L.length;
    baseline(...L.map((_, i) => `#${c.id}l${i}`)); L.forEach((_, i) => {
      const t = c.at(0.05 + i * step * 0.9), id = `#${c.id}l${i}`;
      tl.fromTo(id, { y: sizes[i] * 1.4 }, { y: 0, duration: 0.45, ease: E.out }, t);
      if (i < L.length - 1) tl.fromTo(id, { opacity: 1, color: pal.text }, { opacity: 0.4, color: pal.mut, duration: 0.3, ease: E.soft }, c.at(0.05 + (i + 1) * step * 0.9));
      c.sfx("pop", t + 0.08, 0.5);
    });
    if (pr) { baseline(`#${c.id}pr`); tl.fromTo(`#${c.id}pr`, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: E.out }, c.at(c.D - 1.15)); tl.fromTo(`#${c.id}pl`, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: E.soft }, c.at(c.D - 0.8)); c.sfx("chime", c.at(c.D - 1.1), 0.4); }
    tl.fromTo(`#${c.id}l${L.length - 1}`, { scale: 1 }, { scale: 1.06, duration: Math.max(0.4, c.D - 0.5), ease: "none" }, c.at(0.5));
  };

  /* ---------------------------------------------------------------- end cards */
  const mark = (c, id, size, extra = "") => `<div id="${id}" class="markbox" style="width:${size}px;height:${size}px;border-radius:${size * 0.25}px;font-size:${size * 0.68}px;${extra}">${brand.mark}</div>`;
  const nameChars = (n) => [...n].map((ch) => `<span class="ch">${ch === " " ? "&nbsp;" : ch}</span>`).join("");
