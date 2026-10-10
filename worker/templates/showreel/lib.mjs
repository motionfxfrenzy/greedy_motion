// Small shared helpers for the planner: seeded random, weighted pick, beat/frame snapping. Pure; no clock, no Math.random.
export const FPS = 30;
export const mulberry = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
export const hashSeed = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const pickW = (r, table) => { const e = Object.entries(table), total = e.reduce((a, [, w]) => a + w, 0); let x = r() * total; for (const [k, w] of e) { if ((x -= w) <= 0) return k; } return e[e.length - 1][0]; };
export const pick = (r, a) => a[Math.floor(r() * a.length)];
export const snap = (sec, beat) => Math.max(beat, Math.round(sec / beat) * beat);
export const frame = (sec) => Math.round(sec * FPS) / FPS;
