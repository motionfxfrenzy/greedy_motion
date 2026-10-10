  // NEW: a short conversation: ask, answer streams, an action chip
  S["chat-demo"] = (c) => {
    const ch = product.chat;
    c.el.appendChild(el("div", "abs", `<div class="chatwin" id="${c.id}w"><div class="bubble user" id="${c.id}u">${ch.user}</div><div class="bubble bot" id="${c.id}b"><span id="${c.id}bt" class="btxt">${ch.reply}</span></div><div class="actions" id="${c.id}ac">${ch.actions.map((a, i) => `<span class="act ${i ? "ghost" : ""}">${a}</span>`).join("")}</div></div>`, "left:0;top:0;width:1920px;height:1080px"));
    baseline(`#${c.id}u`, `#${c.id}b`, `#${c.id}ac`, `#${c.id}w`);
    pop(`#${c.id}u`, c.at(0.1), 0.45);
    show(`#${c.id}b`, c.at(c.D * 0.3)); tl.fromTo(`#${c.id}b`, { y: 40, scale: 0.92 }, { y: 0, scale: 1, duration: 0.45, ease: SP }, c.at(c.D * 0.3));
    tl.fromTo(`#${c.id}bt`, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: Math.min(1.1, c.D * 0.4), ease: `steps(${ch.reply.length})` }, c.at(c.D * 0.3 + 0.2));
    pop(`#${c.id}ac`, c.at(c.D * 0.3 + Math.min(1.1, c.D * 0.4) + 0.3), 0.45);
    tl.fromTo(`#${c.id}w`, { scale: 1 }, { scale: 1.05, duration: c.D, ease: "none" }, c.at(0.1));
    c.sfx("pop", c.at(0.1), 0.5); c.sfx("click", c.at(c.D * 0.3), 0.5);
    $(`#${c.id}b`).style.opacity = "0";
  };
