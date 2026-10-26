  // NEW (benchmark B, 13.0-15.0 s): a one-beat dip to black, shockwave rings, the mark pops, the wordmark is typed, tagline, URL pill
  S["end-sting"] = (c) => {
    const nameW = brand.name.length, size = Math.min(170, Math.floor(1100 / (nameW * 0.55))), cut = (() => { const m = brand.name.match(/^(.*?[a-z])([A-Z].*)$/); if (m) return [m[1], m[2]]; const w = brand.name.split(" "); if (w.length > 1) return [w.slice(0, -1).join(" ") + " ", w[w.length - 1]]; const k = Math.ceil(brand.name.length * 0.55); return [brand.name.slice(0, k), brand.name.slice(k)]; })();
    c.el.appendChild(el("div", "abs", `<div id="${c.id}rings" class="rings"><i></i><i></i><i></i></div><div id="${c.id}cam" class="endcam"><div class="lock"><div id="${c.id}m" class="markbox" style="width:${size * 1.1}px;height:${size * 1.1}px;border-radius:${size * 0.28}px;font-size:${size * 0.72}px;background:var(--accent);color:var(--ink)">${brand.mark}</div><div class="lockn head" id="${c.id}nw" style="font-size:${size}px"><span style="color:var(--text)">${cut[0]}</span><span style="color:var(--accent)">${cut[1]}</span><b class="caret2" id="${c.id}cr"></b></div></div><div class="head tag sting" id="${c.id}tag" style="color:var(--mut)">${brand.tagline}</div><div id="${c.id}url" class="urlpill soft" style="top:760px;left:660px;width:600px">${brand.url}</div></div><div id="${c.id}dip" class="dip"></div>`, "left:0;top:0;width:1920px;height:1080px"));
    baseline(`#${c.id}m`, `#${c.id}cam`, `#${c.id}tag`, `#${c.id}url`, ...$$("#" + c.id + "rings i"));
    const t0 = c.at(0), n = brand.name.length;
    tl.fromTo(`#${c.id}dip`, { opacity: 1 }, { opacity: 0, duration: 0.12, ease: "none" }, t0 + 0.16);
    $$("#" + c.id + "rings i").forEach((r, i) => tl.fromTo(r, { scale: 0.2, opacity: 0.8 }, { scale: 3.2, opacity: 0, duration: 1.1, ease: E.out }, t0 + 0.2 + i * 0.14));
    tl.fromTo(`#${c.id}m`, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.55, ease: SP }, t0 + 0.2);
    const nw = `#${c.id}nw`, cr = `#${c.id}cr`, tType = Math.max(0.3, Math.min(0.7, n * 0.06));
    tl.fromTo(nw, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: tType, ease: `steps(${n})` }, t0 + 0.65);
    show(cr, t0 + 0.65); hide(cr, t0 + 0.65 + tType + 0.25); $(cr).style.opacity = "0";
    tl.fromTo(`#${c.id}tag`, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: E.out }, t0 + 0.65 + tType + 0.1);
    tl.fromTo(`#${c.id}url`, { opacity: 0, y: 24, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: SP }, t0 + 0.65 + tType + 0.3);
    tl.fromTo(`#${c.id}cam`, { scale: 1 }, { scale: 1.04, duration: Math.max(1, c.D - 0.2), ease: "none" }, t0 + 0.2);
    c.sfx("impact", t0 + 0.2, 0.5); c.sfx("chime", t0 + 0.55, 0.45); c.sfx("typing", t0 + 0.65, 0.3); c.sfx("pop", t0 + 0.65 + tType + 0.3, 0.45);
  };
