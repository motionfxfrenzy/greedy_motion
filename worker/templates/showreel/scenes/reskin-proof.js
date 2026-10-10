  // NEW (benchmark A, 9.4-11.8 s): one app window re-skinned in quick succession; the accent words follow the brand colour
  S["reskin-proof"] = (c) => {
    const rs = product.reskin, brands = rs.brands.slice(0, 3).concat([{ name: brand.name, mark: brand.mark, color: pal.accent }]), n = brands.length;
    c.el.appendChild(el("div", "abs", `<div class="rsl">${rs.lines.slice(0, 3).map((l, i) => { const w = l.split(" "), last = w.pop(); return `<div class="mask rsm" style="position:relative;left:0;width:760px;height:122px;text-align:left"><span class="big" id="${c.id}l${i}" style="font-size:104px;position:relative;display:block;text-align:left">${w.join(" ")} <span class="sk">${last}</span></span></div>`; }).join("")}</div><div class="cmp bigwin rswin" id="${c.id}w"><div class="rsbar"><i></i><i></i><i></i><span class="mono">${brand.url}</span></div><div class="rsbody"><div class="rsside"><div class="rsbtn" id="${c.id}btn"></div>${[0, 1, 2, 3, 4].map(() => `<i></i>`).join("")}</div><div class="rsmain"><div class="rsmark markbox" id="${c.id}m"></div><div class="rsname head" id="${c.id}n"></div><div class="rssub"></div><div class="rscmp"><i></i><b id="${c.id}dot"></b></div></div></div></div>`, "left:0;top:0;width:1920px;height:1080px"));
    const Wn = `#${c.id}w`; baseline(Wn, ...[0, 1, 2].map((i) => `#${c.id}l${i}`));
    const mk = $(`#${c.id}m`), nm = $(`#${c.id}n`), sk = $$(".sk", c.el), btn = $(`#${c.id}btn`), dot = $(`#${c.id}dot`);
    mk.innerHTML = brands.map((b, k) => `<span class="rsmk" id="${c.id}mk${k}" style="opacity:0">${b.mark}</span>`).join(""); nm.innerHTML = brands.map((b, k) => `<span class="rsnm" id="${c.id}nm${k}" style="opacity:0">${b.name}</span>`).join("");
    tl.fromTo(Wn, { x: 260, opacity: 0, scale: 0.94 }, { x: 0, opacity: 1, scale: 1, duration: 0.5, ease: E.out }, c.at(0.05));
    [0, 1, 2].forEach((i) => tl.fromTo(`#${c.id}l${i}`, { y: 140 }, { y: 0, duration: 0.4, ease: E.out }, c.at(0.15 + i * Math.min(0.5, c.D * 0.12))));
    const t0 = c.at(0.3), per = (c.D - 0.6) / n;
    brands.forEach((b, k) => {
      const t = t0 + k * per, col = b.color, prev = k ? brands[k - 1].color : col;
      show(`#${c.id}mk${k}`, t); show(`#${c.id}nm${k}`, t); if (k) { hide(`#${c.id}mk${k - 1}`, t); hide(`#${c.id}nm${k - 1}`, t); }
      [[mk, "backgroundColor"], [btn, "backgroundColor"], [dot, "backgroundColor"]].forEach(([e, prop]) => tl.fromTo(e, { [prop]: prev }, { [prop]: col, duration: 0.14, ease: E.out }, t));
      sk.forEach((e) => tl.fromTo(e, { color: prev }, { color: col, duration: 0.14, ease: E.out }, t));
      tl.fromTo(`#${c.id}m`, { scale: 0.82 }, { scale: 1, duration: 0.4, ease: SP }, t);
      c.sfx("pop", t + 0.02, 0.35);
    });
    tl.fromTo(Wn, { scale: 1 }, { scale: 1.05, duration: c.D, ease: "none" }, c.at(0.5));
  };
