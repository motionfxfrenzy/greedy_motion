// SOUND PLAN: where each effect goes, derived from the scene plan so every hit sits on a boundary or an on-screen event.
// SYNC = seconds from the start of an effect file to its audible peak; placing a file at (event - SYNC) lands the peak on the event.

const SYNC = { pop: 0.094, whoosh: 0.155, impact: 0.024, chime: 0.407, click: 0.024, typing: 0 };
const SFX_FILE = { pop: "pop.mp3", whoosh: "whoosh-short.mp3", impact: "impact-bass-1.mp3", chime: "chime.mp3", click: "click.mp3", typing: "typing.mp3" };
const SFX_LEN = { pop: 0.72, whoosh: 0.57, impact: 2.12, chime: 2.5, click: 0.37, typing: 1.5 };
export function planSfx(scenes, kit, T) {
  const hits = [], add = (name, t, mult = 1) => { const vol = (kit[name] ?? 0) * mult; if (vol > 0.02 && t > 0.02 && t < T - 0.1) hits.push({ name, t, vol: Math.round(vol * 100) / 100 }); };
  scenes.forEach((s, i) => {
    if (i > 0) add("whoosh", s.t - SYNC.whoosh * 0 - 0.0, 1);                                           // the hit is the boundary; the file is placed by its own peak below
    const m = s.module, d = s.d;
    if (m === "hook-type") { add("typing", s.t + 0.1, 1); add("click", s.t + 0.1 + Math.min(d * 0.5, 2.2) + 0.45, 1); }
    else if (m === "hook-kinetic" || m === "stat-hero" || m === "wall-zoom") add("pop", s.t + (m === "wall-zoom" ? d * 0.45 : 0.1), 1);
    else if (m === "trio-cards") [0, 1, 2].forEach((k) => add("pop", s.t + 0.2 + k * 0.25, 0.9));
    else if (m === "lines-stack") (s.variant.lines || []).forEach((_, k) => add("pop", s.t + 0.05 + k * ((d - 0.2) / s.variant.lines.length) + 0.1, 1));
    else if (m === "app-fill") { add("pop", s.t + 0.75, 0.6); add("pop", s.t + 1.15, 0.6); }
    else if (m === "hub-orbit") { add("pop", s.t + 0.15, 1); add("chime", s.t + 0.9, 0.6); }
    else if (m === "field-3d") { add("pop", s.t + 0.4, 1); add("pop", s.t + 0.8, 1); }
    else if (m === "step-path") [0, 1, 2, 3].forEach((k) => add("pop", s.t + 0.15 + k * (d - 0.4) / 4, 0.9));
    else if (m === "chat-demo") { add("pop", s.t + 0.1, 1); add("click", s.t + d * 0.3, 0.8); }
    else if (m === "split-compare") add("whoosh", s.t + d * 0.35 - 0.1, 0.8);
    else if (m === "pill-cycle") { add("pop", s.t + 0.1, 1); [1, 2, 3, 4].forEach((k) => add("pop", s.t + 0.3 + k * 0.28, 0.5)); }
    else if (m === "rapid-fire") { const n = Math.max(3, Math.min(6, Math.round(d / 0.7))); for (let k = 0; k < n; k++) add("pop", s.t + k * (d / n) + 0.04, 0.8); }
    else if (m === "reskin-proof") [0, 1, 2, 3].forEach((k) => add("pop", s.t + 0.3 + k * ((d - 0.6) / 4), 0.7));
    else if (m === "lines-climb") [0, 1, 2].forEach((k) => add("pop", s.t + 0.1 + k * ((d - 0.9) / 3) * 0.9, 0.9));
    else if (m === "end-sting") { add("impact", s.t + 0.2, 0.7); add("chime", s.t + 0.55, 1); add("typing", s.t + 0.65, 0.7); add("pop", s.t + 1.3, 0.8); }
    else if (m === "end-burst") { add("impact", s.t, 1); add("chime", s.t + 0.4, 1); add("pop", s.t + 1.5, 1); }
    else if (m === "end-calm") { add("chime", s.t + 0.3, 1); add("pop", s.t + 1.4, 0.7); }
    else if (m === "end-cta") { [0, 1, 2].forEach((k) => add("pop", s.t + 0.15 + k * 0.35, 0.9)); add("chime", s.t + 1.3, 1); }
  });
  return hits.map((h) => { const start = Math.max(0, +(h.t - SYNC[h.name]).toFixed(3)); return { ...h, file: SFX_FILE[h.name], start, dur: SFX_LEN[h.name] }; });
}

