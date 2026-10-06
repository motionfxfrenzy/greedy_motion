// Theme catalog shared by the frontend picker, backend validation, and the worker CSS generator.
// Sources (HyperFrames v0.8.111, Apache-2.0):
//   - "theme-pack": themes/*.css — copied token-for-token.
//   - "frame-preset": skills/hyperframes-creative/frame-presets/<id>/FRAME.md — each preset's palette and
//     typography mapped onto the 18-token contract (themes/CONTRACT.md).
// After editing, regenerate CSS with `npm run themes:build` and previews with `npm run themes:previews`.

export type ThemeTokens = {
  bg: string; fg: string; muted: string; surface: string; border: string;
  brand: string; accent: string; accent2: string;
  fontDisplay: string; fontBody: string; fontMono: string;
  radius: string; space1: string; space2: string; space3: string;
  durBeat: string; easeStandard: string; easeEmphasis: string;
};

export type Theme = {
  id: string;
  name: string;
  description: string;
  mode: "light" | "dark";
  source: "theme-pack" | "frame-preset" | "brand";
  tokens: ThemeTokens;
};

const mono = '"JetBrains Mono", "SFMono-Regular", Consolas, monospace';
const motion = { space1: "1.2cqmin", space2: "2.4cqmin", space3: "4cqmin", durBeat: "0.4s", easeStandard: "cubic-bezier(0.215, 0.61, 0.355, 1)", easeEmphasis: "cubic-bezier(0.19, 1, 0.22, 1)" };

export const themes: readonly Theme[] = [
  {
    id: "neutral", name: "Neutral", mode: "light", source: "theme-pack",
    description: "Cool grey canvas, blue accents, Inter throughout. Calm and corporate.",
    tokens: { bg: "#f3f4f6", fg: "#111318", muted: "#626873", surface: "#fcfcfd", border: "#d7dbe2", brand: "#1d4ed8", accent: "#0284c7", accent2: "#60a5fa",
      fontDisplay: 'Inter, "Helvetica Neue", Arial, sans-serif', fontBody: 'Inter, "Helvetica Neue", Arial, sans-serif', fontMono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      radius: "2.4cqmin", space1: "1.2cqmin", space2: "2.4cqmin", space3: "4cqmin", durBeat: "0.4s", easeStandard: "cubic-bezier(0.215, 0.61, 0.355, 1)", easeEmphasis: "cubic-bezier(0.19, 1, 0.22, 1)" }
  },
  {
    id: "bold", name: "Bold", mode: "dark", source: "theme-pack",
    description: "Near-black stage, hot pink and violet, condensed display type. Loud launch energy.",
    tokens: { bg: "#080611", fg: "#fff8ff", muted: "#b6a9ca", surface: "#1b1230", border: "#493668", brand: "#ff3d81", accent: "#7c5cff", accent2: "#00d4ff",
      fontDisplay: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', fontBody: 'Inter, "Helvetica Neue", Arial, sans-serif', fontMono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      radius: "1.4cqmin", space1: "1.2cqmin", space2: "2.6cqmin", space3: "4.6cqmin", durBeat: "0.32s", easeStandard: "cubic-bezier(0.16, 1, 0.3, 1)", easeEmphasis: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
  },
  {
    id: "editorial", name: "Editorial", mode: "light", source: "theme-pack",
    description: "Warm parchment, deep teal, classic serifs. Considered and literary.",
    tokens: { bg: "#e9e1d2", fg: "#202725", muted: "#6c746f", surface: "#f8f1e5", border: "#c9bfad", brand: "#246b63", accent: "#31776f", accent2: "#8a6549",
      fontDisplay: 'Georgia, "Times New Roman", serif', fontBody: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif', fontMono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      radius: "0.9cqmin", space1: "1.1cqmin", space2: "2.2cqmin", space3: "3.8cqmin", durBeat: "0.48s", easeStandard: "cubic-bezier(0.22, 0.61, 0.36, 1)", easeEmphasis: "cubic-bezier(0.16, 1, 0.3, 1)" }
  },
  {
    id: "biennale-yellow", name: "Biennale Yellow", mode: "light", source: "frame-preset",
    description: "Warm parchment, one deep indigo ink, solar-yellow highlights. Art-fair poster.",
    tokens: { bg: "#E9E5DB", fg: "#1B2566", muted: "#4A5185", surface: "#DCD6C4", border: "#C2BBA4", brand: "#1B2566", accent: "#E26B4A", accent2: "#F1EE2E",
      fontDisplay: '"Instrument Serif", Georgia, serif', fontBody: "Archivo, Arial, sans-serif", fontMono: mono, radius: "0", ...motion }
  },
  {
    id: "blockframe", name: "BlockFrame", mode: "light", source: "frame-preset",
    description: "Neo-brutalist: hard black outlines on off-white with candy pastels.",
    tokens: { bg: "#FFFDF5", fg: "#000000", muted: "#333333", surface: "#C0F7FE", border: "#000000", brand: "#000000", accent: "#FE90E8", accent2: "#99E885",
      fontDisplay: '"Space Grotesk", Arial, sans-serif', fontBody: "Inter, Arial, sans-serif", fontMono: mono, radius: "0", ...motion }
  },
  {
    id: "blue-professional", name: "Blue Professional", mode: "light", source: "frame-preset",
    description: "Warm cream canvas with a single saturated cobalt. Clean B2B.",
    tokens: { bg: "#fdfae7", fg: "#111111", muted: "#5f5f5f", surface: "#F3F1E8", border: "#C6C9F2", brand: "#1e2bfa", accent: "#1e2bfa", accent2: "#059669",
      fontDisplay: '"Space Grotesk", Arial, sans-serif', fontBody: "Inter, Arial, sans-serif", fontMono: mono, radius: "1.6cqmin", ...motion }
  },
  {
    id: "bold-poster", name: "Bold Poster", mode: "light", source: "frame-preset",
    description: "White, brown-black ink and tomato red with a swashy display face.",
    tokens: { bg: "#FFFFFF", fg: "#1C1410", muted: "#5C5550", surface: "#F5F2EF", border: "#1C1410", brand: "#D8000F", accent: "#D8000F", accent2: "#1C1410",
      fontDisplay: "Shrikhand, Georgia, serif", fontBody: '"Space Grotesk", Arial, sans-serif', fontMono: mono, radius: "0", ...motion }
  },
  {
    id: "broadside", name: "Broadside", mode: "dark", source: "frame-preset",
    description: "Ink-black with fire orange and heavy Barlow. Newsroom urgency.",
    tokens: { bg: "#111111", fg: "#F0ECE5", muted: "#9A9A92", surface: "#1A1A18", border: "#33332F", brand: "#E85D26", accent: "#E85D26", accent2: "#F0ECE5",
      fontDisplay: "Barlow, Arial, sans-serif", fontBody: "Barlow, Arial, sans-serif", fontMono: '"IBM Plex Mono", Consolas, monospace', radius: "0", ...motion }
  },
  {
    id: "capsule", name: "Capsule", mode: "light", source: "frame-preset",
    description: "Pill shapes, ink outlines and a playful pastel set with Bodoni headlines.",
    tokens: { bg: "#F5F5F0", fg: "#1A1A1A", muted: "#555555", surface: "#FFFFFF", border: "#1E1E1E", brand: "#7A3FD1", accent: "#A06CE8", accent2: "#C4D94E",
      fontDisplay: '"Bodoni Moda", Georgia, serif', fontBody: '"Space Grotesk", Arial, sans-serif', fontMono: mono, radius: "3.2cqmin", ...motion }
  },
  {
    id: "cartesian", name: "Cartesian", mode: "light", source: "frame-preset",
    description: "Warm stone tones, hairline rules, Playfair Display. Gallery quiet.",
    tokens: { bg: "#EDE8E0", fg: "#1A1A1A", muted: "#5A5A5A", surface: "#E2DBD1", border: "#B8B0A4", brand: "#1A1A1A", accent: "#8A8178", accent2: "#B8B0A4",
      fontDisplay: '"Playfair Display", Georgia, serif', fontBody: "Inter, Arial, sans-serif", fontMono: mono, radius: "0", ...motion }
  },
  {
    id: "cobalt-grid", name: "Cobalt Grid", mode: "light", source: "frame-preset",
    description: "Cream graph paper with electric cobalt as the only ink.",
    tokens: { bg: "#F0EBDE", fg: "#1F2BE0", muted: "#3F49D6", surface: "#E6E0CE", border: "#C3C1DA", brand: "#1F2BE0", accent: "#1F2BE0", accent2: "#5560E5",
      fontDisplay: "Newsreader, Georgia, serif", fontBody: '"Hanken Grotesk", Arial, sans-serif', fontMono: '"DM Mono", Consolas, monospace', radius: "0", ...motion }
  },
  {
    id: "code-editorial", name: "Code Editorial", mode: "light", source: "frame-preset",
    description: "Warm cream paper, terracotta coral, Garamond with mono details. Developer-tool feel.",
    tokens: { bg: "#FAF9F5", fg: "#141413", muted: "#5E5D59", surface: "#EFE9DE", border: "#DDD3C3", brand: "#B05E43", accent: "#CC785C", accent2: "#181715",
      fontDisplay: '"EB Garamond", Georgia, serif', fontBody: "Inter, Arial, sans-serif", fontMono: mono, radius: "1.2cqmin", ...motion }
  },
  {
    id: "coral", name: "Coral", mode: "light", source: "frame-preset",
    description: "Coral fire, ink black and warm cream with tall Bebas Neue headlines.",
    tokens: { bg: "#F5F0E8", fg: "#1A1A1A", muted: "#5E5E5E", surface: "#FFFFFF", border: "#E8E0D4", brand: "#D44A4A", accent: "#E85D5D", accent2: "#1A1A1A",
      fontDisplay: '"Bebas Neue", Impact, sans-serif', fontBody: "Inter, Arial, sans-serif", fontMono: mono, radius: "0", ...motion }
  },
  {
    id: "creative-mode", name: "Creative Mode", mode: "light", source: "frame-preset",
    description: "Cream canvas, thick ink borders, green, pink and yellow pops. Maker energy.",
    tokens: { bg: "#EFE9D9", fg: "#0F0F0F", muted: "#3F3F3F", surface: "#E4DCC4", border: "#0F0F0F", brand: "#136636", accent: "#F06CA8", accent2: "#F5C518",
      fontDisplay: '"Archivo Black", Arial, sans-serif', fontBody: '"Space Grotesk", Arial, sans-serif', fontMono: mono, radius: "0", ...motion }
  },
  {
    id: "daisy-days", name: "Daisy Days", mode: "light", source: "frame-preset",
    description: "Sunny-garden pastels with rounded Fredoka type. Friendly consumer apps.",
    tokens: { bg: "#F5F0E6", fg: "#2D2D2D", muted: "#5E5E5E", surface: "#FFFFFF", border: "#F7C8D4", brand: "#D64541", accent: "#7ECDC0", accent2: "#D4A5E8",
      fontDisplay: "Fredoka, Arial, sans-serif", fontBody: "Quicksand, Arial, sans-serif", fontMono: mono, radius: "3.2cqmin", ...motion }
  },
  {
    id: "editorial-forest", name: "Editorial Forest", mode: "dark", source: "frame-preset",
    description: "Deep forest green, blush pink and cream in Source Serif. Premium magazine.",
    tokens: { bg: "#2e4a2a", fg: "#efe7d4", muted: "#CFC6AE", surface: "#243a21", border: "#4A6B45", brand: "#e89cb1", accent: "#e89cb1", accent2: "#efe7d4",
      fontDisplay: '"Source Serif 4", Georgia, serif', fontBody: '"Source Serif 4", Georgia, serif', fontMono: mono, radius: "0.8cqmin", ...motion }
  }
];

export const themeIds = themes.map((theme) => theme.id);
export const defaultThemeId = "neutral";

export function findTheme(id: string) {
  return themes.find((theme) => theme.id === id);
}

/** Serializes a theme as a HyperFrames theme pack: one :root block defining all 18 contract tokens. */
export function themeToCss(theme: Theme) {
  const t = theme.tokens;
  const lines = [
    ["--bg", t.bg], ["--fg", t.fg], ["--muted", t.muted], ["--surface", t.surface], ["--border", t.border],
    ["--brand", t.brand], ["--accent", t.accent], ["--accent-2", t.accent2],
    ["--font-display", t.fontDisplay], ["--font-body", t.fontBody], ["--font-mono", t.fontMono],
    ["--radius", t.radius], ["--space-1", t.space1], ["--space-2", t.space2], ["--space-3", t.space3],
    ["--dur-beat", t.durBeat], ["--ease-standard", t.easeStandard], ["--ease-emphasis", t.easeEmphasis]
  ];
  return `/* ${theme.name} — generated from packages/contracts/src/themes.ts (${theme.source}). Do not edit. */\n:root {\n${lines.map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}\n`;
}
