  // the app window filling up: rows, statuses flipping, a counter
  S["app-fill"] = (c) => {
    const rowsN = 6, stat = product.stat;
    const w = el("div", "abs", `<div class="cmp bigwin" id="${c.id}w" style="width:1560px;height:860px;left:180px;top:110px;border-radius:40px;opacity:1"><div class="win" style="width:1560px;height:860px;border:0;border-radius:0;box-shadow:none;font-size:44px">${SIDE(1)}<div class="main" style="padding:44px 52px;gap:22px;flex-direction:row"><div style="flex:1;display:flex;flex-direction:column;gap:18px;min-width:0"><div class="ttl" style="font-size:54px"><b>${product.windowTitle}</b><span class="chip" style="font-size:26px">${product.liveLabel}</span></div>${ROWS.slice(0, rowsN).map((x, i) => `<div class="row r${i}" style="font-size:25px;padding:14px 22px"><span class="mut">${x.date}</span><span>${x.label}</span><span class="amt">${x.amount}</span><span class="st"><span class="sa chip alt" style="font-size:22px">${product.pending}</span><span class="sb chip" style="font-size:22px;opacity:0">${x.ok}</span></span></div>`).join("")}</div><div style="flex:none;width:520px;display:flex;flex-direction:column;gap:20px"><div class="stat" style="padding:34px;gap:6px"><div class="bignum mono" id="${c.id}num">0</div><div style="font-size:34px;color:var(--mut)">${stat.label}</div><div class="prog" style="margin-top:22px"><div class="progf" id="${c.id}pf"></div></div></div><div class="stat" style="padding:30px;gap:14px"><div style="font-size:30px;color:var(--mut)">${product.nextLabel}</div><div class="head" style="font-size:38px">${product.nextFlow}</div><div class="bar" style="width:80%"></div><div class="bar" style="width:55%"></div></div></div></div></div></div>`, "left:0;top:0;width:1920px;height:1080px");
    c.el.appendChild(decor(w)); const W = `#${c.id}w`; baseline(W);
    if (c.v.fromPill) tl.fromTo(W, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: E.out }, c.at(0.05));
    else tl.fromTo(W, { y: 160, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: E.out }, c.at(0.05));
    const t = c.at(0.35);
    for (let i = 0; i < rowsN; i++) {
      const row = `#${c.id}w .r${i}`, tt = t + i * P.stagger * 1.1;
      tl.fromTo(row, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.26, ease: E.out }, tt);
      const flip = t + 0.35 + i * P.stagger * 1.3;
      tl.fromTo(`${row} .sa`, { opacity: 1 }, { opacity: 0, duration: 0, ease: "none" }, flip);
      tl.fromTo(`${row} .sb`, { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.28, ease: SP }, flip);
    }
    const num = { v: 0 }, numEl = $(`#${c.id}num`);
    tl.fromTo(num, { v: 0 }, { v: stat.n, duration: Math.min(1.1, c.D * 0.5), ease: E.soft, onUpdate: () => { numEl.textContent = Math.round(num.v).toLocaleString("en-US") + (stat.suffix || ""); } }, t + 0.1);
    tl.fromTo(`#${c.id}pf`, { scaleX: 0 }, { scaleX: 1, duration: Math.min(1.1, c.D * 0.5), ease: E.soft }, t + 0.1);
    tl.fromTo(W, { scale: 1 }, { scale: 1.07, duration: c.D, ease: "none" }, c.at(0.5));
    c.sfx("pop", t + 0.4, 0.3); c.sfx("pop", t + 0.8, 0.3);
  };
