// A brand's colours become a complete, readable palette for a given ground (dark or light). Pure functions, no I/O.
// The contract: every text/ground pair that a scene draws (text on bg, text on panel, ink on accent, accent text on its soft tint)
// meets WCAG contrast (4.5:1 for body, 3:1 for large), so a brand colour that is too pale or too dark is nudged, never trusted.
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const hexToRgb = (h) => { const s = h.replace("#", ""), f = s.length === 3 ? [...s].map((c) => c + c).join("") : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
export const rgbToHex = (r) => "#" + r.map((v) => Math.round(clamp(v / 255) * 255).toString(16).padStart(2, "0")).join("");
export function rgbToHsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l]; const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h * 60, s, l]; }
export function hslToRgb([h, s, l]) { h = ((h % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [(r + m) * 255, (g + m) * 255, (b + m) * 255]; }
const hsl = (h, s, l) => rgbToHex(hslToRgb([h, clamp(s), clamp(l)]));
const lum = (hex) => { const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// move a colour's lightness until it reads on `bg` at `min`
export function ensureContrast(fg, bg, min) { let [h, s, l] = rgbToHsl(hexToRgb(fg)); const dir = lum(bg) > 0.4 ? -1 : 1; let out = fg; for (let i = 0; i < 40 && contrast(out, bg) < min; i++) { l = clamp(l + dir * 0.02); out = hsl(h, s, l); } return out; }
const inkOn = (bg) => (contrast("#0a0f0d", bg) >= contrast("#ffffff", bg) ? "#0a0f0d" : "#ffffff");
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

/** brand: { primary, accent? } as hex. mode: "dark" | "light". Returns the CSS variable map the engine reads, plus the plain colours it needs in JS. */
export function buildPalette(brand, mode, opts = {}) {
  const prim = hexToRgb(brand.primary), [h, s0, l0] = rgbToHsl(prim);
  const second = brand.accent || hsl(h + 38, clamp(s0, 0.5, 0.9), mode === "dark" ? 0.6 : 0.5);   // a second brand colour when none is given: an analogous neighbour
  const [h2, s2] = rgbToHsl(hexToRgb(second));
  const sat = clamp(s0, 0.12, 1);
  let p;
  if (mode === "dark") {
    const bg = hsl(h, clamp(sat * 0.45, 0.12, 0.42), opts.deep ? 0.035 : 0.055);
    const accent = ensureContrast(hsl(h, clamp(sat, 0.55, 0.95), clamp(l0, 0.52, 0.66)), bg, 4.5), accent2 = ensureContrast(hsl(h2, clamp(s2, 0.55, 0.95), 0.58), bg, 4.5);
    p = { bg, panel: hsl(h, clamp(sat * 0.4, 0.1, 0.36), 0.095), panel2: hsl(h, clamp(sat * 0.4, 0.1, 0.36), 0.125), panel3: hsl(h, clamp(sat * 0.4, 0.1, 0.36), 0.075), line: hsl(h, clamp(sat * 0.35, 0.1, 0.3), 0.2),
      text: hsl(h, 0.35, 0.95), mut: ensureContrast(hsl(h, 0.18, 0.66), bg, 4.5), accent, accent2, shadow: "rgba(0,0,0,.55)", grid: "rgba(255,255,255,.04)" };
    p.glow1 = rgba(accent, 0.13); p.glow2 = rgba(accent2, 0.1);
    p.accentSoft = rgba(accent, 0.16); p.accent2Soft = rgba(accent2, 0.16); p.accentInk = accent; p.accent2Ink = accent2;
    p.accentD = hsl(h, 0.6, 0.22); p.accent2D = hsl(h2, 0.6, 0.22);
  } else {
    const bg = hsl(h, clamp(sat * 0.55, 0.15, 0.5), opts.soft ? 0.965 : 0.975);
    const accent = ensureContrast(hsl(h, clamp(sat, 0.5, 0.9), clamp(l0, 0.38, 0.52)), "#ffffff", 4.5), accent2 = ensureContrast(hsl(h2, clamp(s2, 0.5, 0.9), 0.46), "#ffffff", 4.5);
    p = { bg, panel: "#ffffff", panel2: hsl(h, clamp(sat * 0.5, 0.1, 0.4), 0.985), panel3: hsl(h, clamp(sat * 0.5, 0.12, 0.45), 0.945), line: hsl(h, clamp(sat * 0.4, 0.1, 0.4), 0.88),
      text: hsl(h, clamp(sat * 0.5, 0.2, 0.5), 0.12), mut: ensureContrast(hsl(h, 0.14, 0.4), bg, 4.5), accent, accent2, shadow: "rgba(30,40,70,.14)", grid: "rgba(40,50,90,.1)" };
    p.glow1 = rgba(accent, 0.2); p.glow2 = rgba(accent2, 0.16);
    p.accentSoft = rgba(accent, 0.12); p.accent2Soft = rgba(accent2, 0.12); p.accentInk = ensureContrast(accent, hsl(h, 0.4, 0.93), 4.5); p.accent2Ink = ensureContrast(accent2, hsl(h2, 0.4, 0.93), 4.5);
    p.accentD = hsl(h, 0.55, 0.32); p.accent2D = hsl(h2, 0.55, 0.32);
  }
  p.ink = inkOn(p.accent);
  // the end card: bold ends on a flood of the accent (mark in ink); calm ends on its own ground
  p.endbg = opts.endFlood ? p.accent : p.bg; p.endink = opts.endFlood ? p.ink : p.text;
  p.markbg = opts.endFlood ? "#0a0f0d" : p.accent; p.markink = opts.endFlood ? p.accent : p.ink;
  p.flash2 = hsl(h + 150, 0.7, 0.6);
  p.hue1 = hsl(h + 70, 0.9, 0.62); p.hue2 = hsl(h + 160, 0.9, 0.62); p.hue3 = hsl(h + 250, 0.9, 0.62);
  p.mode = mode;
  return p;
}
export const cssVars = (p, fonts, P) => `:root{--bg:${p.bg};--panel:${p.panel};--panel2:${p.panel2};--panel3:${p.panel3};--line:${p.line};--text:${p.text};--mut:${p.mut};--accent:${p.accent};--accent2:${p.accent2};--ink:${p.ink};--shadow:${p.shadow};--grid:${p.grid};--glow1:${p.glow1};--glow2:${p.glow2};--accent-soft:${p.accentSoft};--accent2-soft:${p.accent2Soft};--accent-ink:${p.accentInk};--accent2-ink:${p.accent2Ink};--accent-d:${p.accentD};--accent2-d:${p.accent2D};--endbg:${p.endbg};--endink:${p.endink};--markbg:${p.markbg};--markink:${p.markink};--hue1:${p.hue1};--hue2:${p.hue2};--hue3:${p.hue3};--head:"${fonts.head}";--body:"${fonts.body}";--mono:"${fonts.mono}";--track:${P.track};--headw:${P.headWeight}}`;
