// FOLEY: the sounds of things happening in a film, made in code. Every sound is a pure function of (kind, options, seed): the same hit twice is
// never the same twice (a seeded jitter in pitch, weight and timing), and a film is the same on every machine. No generator, no network.
//
//   hit(kind, { surface, weight, seed, ... })  -> Float32Array (mono, SR)      one occurrence of a sound
//   bed(kind, seconds, seed)                   -> Float32Array (mono, SR)      a constant ambience, built to the length it is needed
//   KINDS / BEDS                                                                  the vocabulary, with how loud each sits (peak, dBFS)
export const SR = 44100;
const TAU = Math.PI * 2, db = (x) => 10 ** (x / 20);

// ---------------------------------------------------------------------------- primitives
export const rng = (seed) => { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const zeros = (s) => new Float32Array(Math.max(1, Math.round(s * SR)));
const white = (r, n) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; };
const pink = (r, n) => { const o = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; for (let i = 0; i < n; i++) { const w = r() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; o[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; } return o; };
const brown = (r, n) => { const o = new Float32Array(n); let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * (r() * 2 - 1)) / 1.02; o[i] = l * 3.5; } return o; };
/** one-pole low pass / high pass */
const lp = (x, fc) => { const a = 1 - Math.exp(-TAU * fc / SR), o = new Float32Array(x.length); let y = 0; for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); o[i] = y; } return o; };
const hp = (x, fc) => { const l = lp(x, fc), o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] - l[i]; return o; };
/** RBJ band pass (constant 0 dB peak gain) */
const bp = (x, f, q) => { const w = TAU * Math.min(f, SR * 0.45) / SR, al = Math.sin(w) / (2 * q), b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al, o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; o[i] = y; } return o; };
const env = (n, f) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = f(i / SR); return o; };
const mul = (x, e) => { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] * (e[i] ?? 0); return o; };
const dec = (n, tau, attack = 0.001) => env(n, (t) => (1 - Math.exp(-t / attack)) * Math.exp(-t / tau));
const sine = (n, f, ph = 0) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = Math.sin(TAU * f * i / SR + ph); return o; };
/** a sine whose frequency glides f0 -> f1 over the sound */
const glide = (n, f0, f1) => { const o = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const f = f0 + (f1 - f0) * (i / n); ph += TAU * f / SR; o[i] = Math.sin(ph); } return o; };
const add = (dst, src, at = 0, g = 1) => { const s0 = Math.round(at * SR); for (let i = 0; i < src.length; i++) { const j = s0 + i; if (j >= 0 && j < dst.length) dst[j] += src[i] * g; } return dst; };
const peak = (x) => { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; };
const fit = (x, dBpeak) => { const p = peak(x) || 1, g = db(dBpeak) / p, o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] * g; return o; };
const fades = (x, a = 0.004, b = 0.02) => { const na = Math.round(a * SR), nb = Math.round(b * SR); for (let i = 0; i < na && i < x.length; i++) x[i] *= i / na; for (let i = 0; i < nb && i < x.length; i++) x[x.length - 1 - i] *= i / nb; return x; };
const jit = (r, v, k) => v * (1 + (r() * 2 - 1) * k);

// ---------------------------------------------------------------------------- footsteps: heel, then toe, on a surface
// each surface: [body Hz, body decay s, click band Hz, click decay s, ring Hz, ring decay s, ring level, brightness]
const SURFACES = {
  wood: { body: 105, bodyT: 0.05, click: [1400, 0.012], ring: [[230, 0.09, 0.9], [360, 0.06, 0.5]], bright: 0.6 },
  stone: { body: 140, bodyT: 0.03, click: [3200, 0.006], ring: [[520, 0.04, 0.3], [2900, 0.05, 0.25]], bright: 1 },
  pavement: { body: 125, bodyT: 0.035, click: [2500, 0.008], ring: [[420, 0.05, 0.3]], bright: 0.85 },
  tile: { body: 150, bodyT: 0.03, click: [3800, 0.005], ring: [[1100, 0.07, 0.4], [3300, 0.06, 0.3]], bright: 1.1 },
  carpet: { body: 80, bodyT: 0.06, click: [600, 0.02], ring: [], bright: 0.2 },
  dirt: { body: 90, bodyT: 0.05, click: [900, 0.025], ring: [], bright: 0.3, grit: 0.25 },
  grass: { body: 75, bodyT: 0.06, click: [1800, 0.05], ring: [], bright: 0.25, swish: true },
  sand: { body: 70, bodyT: 0.06, click: [2600, 0.07], ring: [], bright: 0.3, swish: true },
  gravel: { body: 95, bodyT: 0.04, click: [2800, 0.01], ring: [], bright: 0.8, grit: 1 },
  puddle: { body: 100, bodyT: 0.04, click: [1200, 0.02], ring: [], bright: 0.4, splash: true },
};
export const surfaceOf = (s) => (s && SURFACES[s] ? s : /board|plank|deck|pier|wood/.test(s ?? "") ? "wood" : /stone|cobble|flag/.test(s ?? "") ? "stone" : /tile/.test(s ?? "") ? "tile" : /earth|dirt|mud|path/.test(s ?? "") ? "dirt" : /sand|beach/.test(s ?? "") ? "sand" : /grass|lawn|field/.test(s ?? "") ? "grass" : /gravel/.test(s ?? "") ? "gravel" : /wet|puddle|rain/.test(s ?? "") ? "puddle" : /rug|carpet|mat/.test(s ?? "") ? "carpet" : "pavement");
const stepOne = (r, S, weight, kind) => {
  const n = Math.round(0.34 * SR), o = zeros(0.34), k = S.bright;
  const one = (at, g, toe) => {
    const c = white(r, n), body = mul(sine(n, jit(r, S.body * (toe ? 1.25 : 1), 0.08)), dec(n, S.bodyT)), clk = mul(bp(c, jit(r, S.click[0] * (toe ? 1.3 : 1), 0.12), 0.9), dec(n, S.click[1] * (toe ? 1.4 : 1)));
    const part = new Float32Array(n); add(part, body, 0, 0.9 * weight); add(part, clk, 0, 0.8 * k * (toe ? 0.6 : 1));
    for (const [f, t, lv] of S.ring) add(part, mul(bp(c, jit(r, f, 0.04), 14), dec(n, t)), 0, lv * 2.2 * k * (toe ? 0.5 : 1));
    if (S.grit) { const grains = Math.round(14 * S.grit * (toe ? 0.6 : 1)); for (let i = 0; i < grains; i++) { const gn = Math.round((0.002 + r() * 0.004) * SR), gt = r() * 0.09, gg = (0.15 + r() * 0.35) * S.grit; add(part, mul(hp(white(r, gn), 1500 + r() * 2500), dec(gn, 0.0012)), gt, gg); } }
    if (S.swish) add(part, mul(bp(white(r, n), 2400, 0.7), env(n, (t) => Math.sin(Math.PI * Math.min(1, t / 0.16)) ** 2)), 0, 0.22);
    if (S.splash) { add(part, mul(lp(white(r, n), 3200), dec(n, 0.07, 0.004)), 0, 0.7); for (let i = 0; i < 2; i++) { const bn = Math.round(0.05 * SR); add(part, mul(glide(bn, 300 + r() * 200, 900 + r() * 400), dec(bn, 0.02)), 0.02 + r() * 0.1, 0.3); } }
    add(o, part, at, g);
  };
  one(0, 1, false); one(jit(r, 0.062, 0.2), 0.45, true);
  return fades(o, 0.001, 0.02);
};

// ---------------------------------------------------------------------------- the vocabulary
// hit(kind, opts): a function (r, opts) -> Float32Array; `level` is where its peak sits (dBFS) before the mix places it
const modes = (r, n, list, strike) => { const o = new Float32Array(n); for (const [f, t, a] of list) add(o, mul(bp(strike, jit(r, f, 0.003), 40), dec(n, t)), 0, a * 14); return o; };
export const KINDS = {
  footstep: { level: -17, make: (r, { surface = "pavement", weight = 0.7 }) => stepOne(r, SURFACES[surfaceOf(surface)], weight) },
  /* a door: creak of the hinge, then the latch; phase "open", "close" or both */
  door: { level: -17, make: (r, { phase = "both", heavy = 0.6 }) => { const o = zeros(1.9), parts = phase === "both" ? ["open", "close"] : [phase];
    parts.forEach((ph, i) => { const at = i * (phase === "both" ? 1.1 : 0), n = Math.round(0.8 * SR), f0 = jit(r, 190, 0.1), sw = 80 * (ph === "open" ? 1 : -1);
      let creak = new Float32Array(n), p = 0; for (let j = 0; j < n; j++) { const t = j / SR, f = f0 + sw * (t / 0.8) + 14 * Math.sin(TAU * 9 * t); p += TAU * f / SR; creak[j] = (Math.sin(p) + 0.6 * Math.sin(2 * p + 1) + 0.35 * Math.sign(Math.sin(3 * p))) * (0.6 + 0.4 * Math.sin(TAU * 23 * t + r())); }
      creak = bp(creak, 700, 0.8); add(o, mul(creak, env(n, (t) => Math.sin(Math.PI * Math.min(1, t / 0.8)) ** 1.5)), at, 0.25);
      const ln = Math.round(0.25 * SR); add(o, mul(bp(white(r, ln), 2100, 3), dec(ln, 0.012)), at + (ph === "open" ? 0.02 : 0.5), 0.9); add(o, mul(sine(ln, 90), dec(ln, 0.06)), at + (ph === "open" ? 0.02 : 0.5), 0.6 * heavy);
      if (ph === "close") { const tn = Math.round(0.4 * SR); add(o, mul(lp(white(r, tn), 600), dec(tn, 0.07)), at + 0.46, 0.9 * heavy); add(o, mul(sine(tn, 62), dec(tn, 0.12)), at + 0.46, 0.9 * heavy); } });
    return fades(o, 0.002, 0.06); } },
  /* the little bell over a shop door: a few quick strikes of a small bright bell */
  shopbell: { level: -19, make: (r) => { const o = zeros(2.2), f = jit(r, 2350, 0.05); [0, 0.07, 0.15, 0.24].forEach((at, i) => { const n = Math.round(1.6 * SR), s = zeros(1.6); for (const [m, t, a] of [[1, 0.9, 1], [2.76, 0.5, 0.5], [5.4, 0.3, 0.3], [8.9, 0.15, 0.15]]) add(s, mul(sine(n, f * m * jit(r, 1, 0.004)), dec(n, t)), 0, a); add(o, s, at, 0.9 - i * 0.13); }); return fades(o, 0.001, 0.2); } },
  /* a church / tower bell: a low hum, the strike, and the partials of a cast bell */
  bell: { level: -13, make: (r, { note = 196 }) => { const n = Math.round(4.2 * SR), o = zeros(4.2), f = note; for (const [m, t, a] of [[0.5, 3.4, 0.6], [1, 3.2, 1], [1.19, 2.6, 0.55], [1.5, 2.2, 0.4], [2, 1.9, 0.45], [2.51, 1.4, 0.25], [3.01, 1.1, 0.2], [4.1, 0.7, 0.12]]) add(o, mul(sine(n, f * m * jit(r, 1, 0.0015), r() * 6), dec(n, t, 0.002)), 0, a);
    add(o, mul(bp(white(r, n), 1800, 1.2), dec(n, 0.02)), 0, 0.35); return fades(o, 0.001, 0.4); } },
  /* a cup or plate set on a table, a ceramic lamp on stone: a short tick and a ring */
  ceramic: { level: -22, make: (r, { size = 1 }) => { const n = Math.round(0.5 * SR), o = zeros(0.5), c = white(r, n); add(o, mul(hp(c, 1200), dec(n, 0.005)), 0, 0.8); add(o, modes(r, n, [[2250 / size, 0.07, 1], [3600 / size, 0.045, 0.6], [1180 / size, 0.1, 0.5]], c), 0, 1); add(o, mul(lp(c, 400), dec(n, 0.02)), 0, 0.5); return fades(o, 0.0005, 0.05); } },
  glass: { level: -22, make: (r) => { const n = Math.round(1.1 * SR), o = zeros(1.1), c = white(r, n); add(o, modes(r, n, [[3100, 0.45, 1], [4650, 0.3, 0.6], [7200, 0.16, 0.35], [2300, 0.5, 0.4]], c), 0, 1); add(o, mul(hp(c, 3000), dec(n, 0.004)), 0, 0.5); return fades(o, 0.0005, 0.15); } },
  /* a box, a crate, a bag set down: a dull thump and a rattle of what is inside */
  thud: { level: -20, make: (r, { weight = 0.7 }) => { const n = Math.round(0.45 * SR), o = zeros(0.45), c = white(r, n); add(o, mul(sine(n, jit(r, 105, 0.08)), dec(n, 0.07)), 0, 0.9 * weight); add(o, mul(lp(c, 520), dec(n, 0.035)), 0, 0.9); add(o, mul(bp(c, 1500, 1.5), dec(n, 0.025)), 0.012, 0.25); return fades(o, 0.001, 0.05); } },
  /* a hard small thing set on wood or stone: a tap */
  tap: { level: -24, make: (r) => { const n = Math.round(0.25 * SR), o = zeros(0.25), c = white(r, n); add(o, mul(bp(c, jit(r, 1300, 0.1), 5), dec(n, 0.02)), 0, 1); add(o, mul(sine(n, jit(r, 420, 0.08)), dec(n, 0.03)), 0, 0.5); return fades(o, 0.0005, 0.04); } },
  knock: { level: -15, make: (r) => { const o = zeros(0.9); for (const at of [0, 0.19, 0.4]) { const n = Math.round(0.14 * SR), c = white(r, n); add(o, mul(sine(n, jit(r, 140, 0.05)), dec(n, 0.035)), at, 0.9); add(o, mul(bp(c, 900, 2), dec(n, 0.012)), at, 0.6); } return fades(o, 0.001, 0.06); } },
  /* cloth, a scarf, a net, a sleeve: a soft rustle */
  cloth: { level: -27, make: (r, { seconds = 0.5 }) => { const n = Math.round(seconds * SR); return fades(mul(bp(pink(r, n), jit(r, 1900, 0.2), 0.6), env(n, (t) => (0.5 + 0.5 * Math.sin(TAU * 7 * t + r())) * Math.sin(Math.PI * Math.min(1, t / seconds)) ** 1.2)), 0.01, 0.1); } },
  paper: { level: -26, make: (r, { seconds = 0.6 }) => { const n = Math.round(seconds * SR), o = zeros(seconds); for (let i = 0; i < 18; i++) { const gn = Math.round((0.004 + r() * 0.012) * SR); add(o, mul(hp(white(r, gn), 2500), dec(gn, 0.004)), r() * seconds * 0.9, 0.2 + r() * 0.5); } return fades(o, 0.002, 0.05); } },
  /* a flame taking: a match scraped, then a soft breath of fire (or a lighter) */
  strike: { level: -21, make: (r, { lighter = false }) => { const o = zeros(1.4), sn = Math.round(0.22 * SR); add(o, mul(hp(white(r, sn), 2200), env(sn, (t) => Math.min(1, t / 0.05) * Math.exp(-t / 0.2))), 0, 0.7);
    if (lighter) { const cn = Math.round(0.03 * SR); add(o, mul(hp(white(r, cn), 3500), dec(cn, 0.004)), 0.05, 0.9); }
    const fn = Math.round(1 * SR); add(o, mul(lp(pink(r, fn), 520), env(fn, (t) => (1 - Math.exp(-t / 0.05)) * Math.exp(-t / 0.35))), 0.2, 0.8); for (let i = 0; i < 10; i++) { const gn = Math.round(0.003 * SR); add(o, mul(hp(white(r, gn), 2500), dec(gn, 0.0008)), 0.3 + r() * 0.8, 0.12 + r() * 0.2); } return fades(o, 0.002, 0.2); } },
  /* a switch / latch: two small clicks */
  click: { level: -25, make: (r) => { const o = zeros(0.3), n = Math.round(0.03 * SR); for (const at of [0, 0.11]) add(o, mul(bp(white(r, n), 3000, 2), dec(n, 0.004)), at, 0.9); return o; } },
  thunder: { level: -11, make: (r) => { const n = Math.round(5 * SR), o = zeros(5), rumble = lp(brown(r, n), 160); add(o, mul(rumble, env(n, (t) => (1 - Math.exp(-t / 0.12)) * Math.exp(-t / 1.6) * (0.75 + 0.25 * Math.sin(TAU * 1.3 * t)))), 0, 3.2); add(o, mul(bp(white(r, n), 1800, 0.5), env(n, (t) => Math.exp(-t / 0.08) * (r() > 0.2 ? 1 : 0.3))), 0, 0.5); add(o, mul(lp(white(r, n), 700), env(n, (t) => Math.exp(-t / 0.7) * (0.5 + 0.5 * Math.sin(TAU * 4 * t)))), 0.1, 0.55); return fades(o, 0.002, 0.8); } },
  /* a heavy knock, something hit, a roof taking a branch */
  impact: { level: -13, make: (r) => { const n = Math.round(1.6 * SR), o = zeros(1.6), c = white(r, n); add(o, mul(sine(n, 62), dec(n, 0.22)), 0, 1); add(o, mul(lp(c, 500), dec(n, 0.12)), 0, 0.9); add(o, mul(bp(c, 1700, 0.8), dec(n, 0.025)), 0, 0.7); for (let i = 0; i < 12; i++) { const gn = Math.round(0.006 * SR); add(o, mul(bp(white(r, gn), 900 + r() * 2000, 2), dec(gn, 0.003)), 0.08 + r() * 0.7, 0.1 + r() * 0.25); } return fades(o, 0.001, 0.25); } },
  splash: { level: -19, make: (r) => { const n = Math.round(1 * SR), o = zeros(1), c = white(r, n); add(o, mul(lp(c, 4200), dec(n, 0.18, 0.006)), 0, 0.9); for (let i = 0; i < 6; i++) { const bn = Math.round(0.08 * SR); add(o, mul(glide(bn, 350 + r() * 300, 1000 + r() * 700), dec(bn, 0.03)), 0.04 + r() * 0.45, 0.18); } return fades(o, 0.002, 0.2); } },
  /* a short, soft cloth or kite flutter / flap in the wind */
  flutter: { level: -27, make: (r, { seconds = 1.2 }) => { const n = Math.round(seconds * SR); return fades(mul(bp(white(r, n), 1600, 0.8), env(n, (t) => (0.35 + 0.65 * Math.abs(Math.sin(TAU * 11 * t + 0.4 * Math.sin(TAU * 1.7 * t)))) * Math.sin(Math.PI * Math.min(1, t / seconds)))), 0.01, 0.15); } },
  whoosh: { level: -23, make: (r, { seconds = 0.9 }) => { const n = Math.round(seconds * SR); return fades(mul(bp(pink(r, n), 900, 0.7), env(n, (t) => Math.sin(Math.PI * Math.min(1, t / seconds)) ** 2)), 0.01, 0.2); } },
  /* a car horn: two short blasts of a two-tone horn */
  horn: { level: -17, make: (r) => { const o = zeros(1), f = jit(r, 410, 0.04); for (const at of [0, 0.26]) { const n = Math.round(0.2 * SR), t = zeros(0.2); for (let i = 0; i < n; i++) { const tt = i / SR; t[i] = (Math.sign(Math.sin(TAU * f * tt)) * 0.5 + Math.sin(TAU * f * 1.26 * tt) * 0.5 + Math.sin(TAU * f * 0.5 * tt) * 0.2) * Math.min(1, tt / 0.012) * Math.min(1, (0.2 - tt) / 0.03); } add(o, lp(t, 1900), at, 0.6); } return o; } },
  /* a bicycle bell: a bright ring, shaken */
  cyclebell: { level: -19, make: (r) => { const n = Math.round(1.1 * SR), o = zeros(1.1); const f = jit(r, 2700, 0.04); for (const [m, t, a] of [[1, 0.5, 1], [2.4, 0.3, 0.5], [3.7, 0.16, 0.3]]) add(o, mul(sine(n, f * m), dec(n, t)), 0, a); return fades(mul(o, env(n, (t) => 0.7 + 0.3 * Math.sin(TAU * 36 * t))), 0.001, 0.2); } },
  /* a vehicle going past: a tram or a car, from one side of the picture to the other */
  passby: { level: -21, make: (r, { seconds = 3.5, tram = false }) => { const n = Math.round(seconds * SR), o = zeros(seconds), sw = (t) => Math.sin(Math.PI * Math.min(1, t / seconds)) ** 2;
    add(o, mul(lp(brown(r, n), tram ? 200 : 320), env(n, (t) => sw(t))), 0, tram ? 3 : 2.4); add(o, mul(bp(pink(r, n), tram ? 900 : 1400, 0.6), env(n, (t) => sw(t) ** 1.5)), 0, 0.5);
    if (tram) for (let t = 0.3; t < seconds - 0.3; t += 0.22 + r() * 0.03) { const cn = Math.round(0.02 * SR); add(o, mul(bp(white(r, cn), 2400, 2), dec(cn, 0.004)), t, 0.35 * sw(t)); }
    return fades(o, 0.02, 0.3); } },
  /* a coin, a key: a metal jingle */
  coin: { level: -23, make: (r) => { const n = Math.round(0.9 * SR), o = zeros(0.9); for (const [f, at] of [[3800, 0], [5200, 0.07], [4300, 0.15]]) add(o, mul(sine(n, jit(r, f, 0.05)), dec(n, jit(r, 0.18, 0.2))), at + r() * 0.02, 0.5); return fades(o, 0.0005, 0.2); } },
  /* a sheet of sound made of the clack of a wooden wheel, a cart rolling */
  cart: { level: -27, make: (r, { seconds = 2 }) => { const o = zeros(seconds); for (let t = 0; t < seconds - 0.1; t += 0.12 + r() * 0.02) { const n = Math.round(0.05 * SR); add(o, mul(bp(white(r, n), 700, 3), dec(n, 0.012)), t, 0.4 + r() * 0.3); } add(o, mul(lp(brown(r, o.length), 250), env(o.length, () => 1)), 0, 1.2); return fades(o, 0.05, 0.2); } },
  /* a stick or tool dragged through sand, gravel or earth: a gritty hiss that swells and fades */
  scrape: { level: -25, make: (r, { seconds = 1 }) => { const n = Math.round(seconds * SR), o = mul(bp(white(r, n), 2600, 0.5), env(n, (t) => Math.sin(Math.PI * Math.min(1, t / seconds)) ** 1.3 * (0.6 + 0.4 * Math.sin(TAU * 17 * t + r())))); for (let i = 0; i < Math.round(seconds * 25); i++) { const gn = Math.round(0.003 * SR); add(o, mul(hp(white(r, gn), 2000), dec(gn, 0.0008)), r() * seconds, 0.25 + r() * 0.3); } return fades(o, 0.01, 0.15); } },
  /* a small piece of wood dropped and clattering on the ground: a few bouncing knocks that shorten */
  clatter: { level: -23, make: (r) => { const o = zeros(1); let at = 0, g = 1, gap = 0.17; for (let i = 0; i < 6; i++) { const n = Math.round(0.12 * SR), c = white(r, n); add(o, mul(bp(c, jit(r, 1100 - i * 40, 0.06), 4), dec(n, 0.022)), at, g); add(o, mul(sine(n, jit(r, 320, 0.05)), dec(n, 0.03)), at, g * 0.5); at += gap; gap *= 0.62; g *= 0.62; } return fades(o, 0.0005, 0.1); } },
  /* a ball bouncing and settling: hollow thumps that come closer and softer */
  bounce: { level: -19, make: (r) => { const o = zeros(1.2); let at = 0, g = 1, gap = 0.36; for (let i = 0; i < 4; i++) { const n = Math.round(0.2 * SR), f = jit(r, 190, 0.06); add(o, mul(glide(n, f * 1.3, f * 0.8), dec(n, 0.055)), at, g); add(o, mul(lp(white(r, n), 900), dec(n, 0.012)), at, g * 0.6); at += gap; gap *= 0.62; g *= 0.55; } return fades(o, 0.0005, 0.1); } },
  /* a small voice-less crowd reaction is not faked: laughter and cheers need people */
};

// ---------------------------------------------------------------------------- beds: a constant ambience of a place or weather, built to the length needed
const slow = (r, n, hz, depth = 0.5) => { const ph = r() * TAU, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = 1 - depth + depth * (0.5 + 0.5 * Math.sin(TAU * hz * i / SR + ph + 0.8 * Math.sin(TAU * hz * 0.37 * i / SR))); return o; };
const drops = (r, n, perSec, band, g) => { const o = new Float32Array(n), count = Math.round(perSec * n / SR); for (let i = 0; i < count; i++) { const gn = Math.round((0.002 + r() * 0.004) * SR), at = Math.floor(r() * (n - gn)), t = mul(bp(white(r, gn), band[0] + r() * (band[1] - band[0]), 2), dec(gn, 0.0012)), a = g * (0.3 + 0.7 * r()); for (let j = 0; j < gn; j++) o[at + j] += t[j] * a; } return o; };
export const BEDS = {
  rain: { level: -22, make: (r, n) => { const o = mul(bp(pink(r, n), 4200, 0.35), slow(r, n, 0.13, 0.25)); add(o, drops(r, n, 90, [2500, 7000], 0.9), 0, 0.5); add(o, mul(lp(brown(r, n), 220), slow(r, n, 0.08, 0.3)), 0, 0.5); return o; } },
  wind: { level: -24, make: (r, n) => mul(bp(pink(r, n), 520, 0.4), slow(r, n, 0.11, 0.7)) },
  water: { level: -25, make: (r, n) => { const o = mul(lp(brown(r, n), 380), slow(r, n, 0.17, 0.55)); add(o, mul(bp(pink(r, n), 1700, 1.2), slow(r, n, 0.31, 0.9)), 0, 0.12); add(o, drops(r, n, 6, [500, 1400], 1), 0, 0.9); return o; } },
  /* a city's low traffic roar: nothing in it that could be taken for a single car */
  traffic: { level: -25, make: (r, n) => { const o = mul(lp(brown(r, n), 240), slow(r, n, 0.06, 0.4)); add(o, mul(bp(pink(r, n), 800, 0.5), slow(r, n, 0.05, 0.6)), 0, 0.25); return o; } },
  /* many people talking, none intelligible: syllable-rate swells through vowel-like bands */
  crowd: { level: -25, make: (r, n) => { const o = new Float32Array(n); for (let v = 0; v < 7; v++) { const f1 = 350 + r() * 450, f2 = 1100 + r() * 900, s = pink(r, n), m = slow(r, n, 2.5 + r() * 3, 0.9), t = new Float32Array(n); add(t, bp(s, f1, 3), 0, 1); add(t, bp(s, f2, 4), 0, 0.5); add(o, mul(t, m), 0, 0.5); } return mul(o, slow(r, n, 0.05, 0.3)); } },
  room: { level: -30, make: (r, n) => { const o = mul(lp(pink(r, n), 600), slow(r, n, 0.04, 0.2)); add(o, sine(n, 50), 0, 0.012); return o; } },
  birds: { level: -27, make: (r, n) => { const o = zeros(n / SR); for (let k = 0; k < Math.round(n / SR * 0.9); k++) { const at = r() * (n / SR - 0.5), reps = 1 + Math.floor(r() * 4), f = 2600 + r() * 2200; for (let i = 0; i < reps; i++) { const cn = Math.round(0.07 * SR); add(o, mul(glide(cn, f, f * (0.8 + r() * 0.5)), env(cn, (t) => Math.sin(Math.PI * Math.min(1, t / 0.07)) ** 2)), at + i * 0.09, 0.5); } } return o; } },
  night: { level: -28, make: (r, n) => { const o = new Float32Array(n), f = 4200 + r() * 600; for (let i = 0; i < n; i++) { const t = i / SR; o[i] = Math.sin(TAU * f * t) * Math.max(0, Math.sin(TAU * 38 * t)) ** 2 * (0.5 + 0.5 * Math.sin(TAU * 3.1 * t)); } add(o, mul(lp(brown(r, n), 200), slow(r, n, 0.05, 0.3)), 0, 0.4); return o; } },
  fire: { level: -26, make: (r, n) => { const o = mul(lp(pink(r, n), 400), slow(r, n, 0.3, 0.5)); add(o, drops(r, n, 22, [1800, 5000], 1), 0, 0.8); return o; } },
  /* the hum of lamps and wires in a night street */
  hum: { level: -34, make: (r, n) => { const o = sine(n, 100); add(o, sine(n, 200), 0, 0.4); add(o, mul(lp(pink(r, n), 800), slow(r, n, 0.07, 0.3)), 0, 0.3); return o; } },
};

export const hit = (kind, opts = {}) => { const k = KINDS[kind]; if (!k) throw new Error(`foley: unknown sound "${kind}" (known: ${Object.keys(KINDS).join(", ")})`); const r = rng((opts.seed ?? 1) * 2654435761 + kind.length * 97); return fit(k.make(r, opts), k.level + (opts.gainDb ?? 0)); };
export const bed = (kind, seconds, seed = 1) => { const k = BEDS[kind]; if (!k) throw new Error(`foley: unknown bed "${kind}" (known: ${Object.keys(BEDS).join(", ")})`); const n = Math.round(seconds * SR), r = rng(seed * 40503 + kind.length * 31), x = k.make(r, n), fade = Math.min(1.2, seconds / 3), a = Math.round(fade * SR); const p = peak(x) || 1, g = db(k.level) / p; for (let i = 0; i < n; i++) { const f = Math.min(1, i / a, (n - 1 - i) / a); x[i] *= g * f; } return x; };
/** what bed a text names (the sound brief's ambience ids and prompts), or undefined */
export const bedOf = (text) => { const t = (text ?? "").toLowerCase(); const hits = [["rain", /rain|drizzle|pitter|downpour|storm/], ["wind", /wind|breeze|gust/], ["water", /water|lap|river|sea|harbou?r|wave|canal|shore|pier/], ["crowd", /crowd|market|chatter|murmur|people|voices|bustle|plaza/], ["traffic", /traffic|street|city|urban|road|cars|tram|rumble/], ["birds", /bird|dawn chorus|morning song/], ["night", /cricket|night|insect/], ["fire", /fire|crackle|hearth|stove|candle|flame/], ["hum", /hum|wire|lamp buzz|neon/], ["room", /room|indoor|interior|hush|quiet|kettle/]]; for (const [k, re] of hits) if (re.test(t)) return k; return undefined; };
/** what sound a thing set down or picked up makes, from its name and tags */
export const contactOf = (text) => { const t = (text ?? "").toLowerCase(); if (/cup|mug|bowl|plate|saucer|teapot|lamp|diya|jar|pot|vase|ceramic|clay/.test(t)) return "ceramic"; if (/glass|bottle|jar lid|goblet/.test(t)) return "glass"; if (/box|crate|bag|basket|sack|parcel|package|case|bucket|bread|cake/.test(t)) return "thud"; if (/net|cloth|scarf|coat|blanket|kite|flag|towel|sheet|shawl|rope/.test(t)) return "cloth"; if (/book|paper|letter|map|card|ticket|newspaper|note/.test(t)) return "paper"; if (/coin|key|bell|spoon|tool/.test(t)) return "coin"; return "tap"; };
