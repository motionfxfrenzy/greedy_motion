// PERSONALITIES: how a brand "feels" becomes numbers. Each personality sets the ground (dark/light), tempo, scene count and length,
// easing and spring, fonts, which scene modules it may use (weighted pools for the opening, the middle and the ending), which transitions
// it may use, how loud each sound is, and the music prompt. Start values come from docs/MOTION_PERSONALITIES.md. Add a personality by
// adding a key here; nothing else needs to change.
import { rgbToHsl, hexToRgb } from "./palette.mjs";

export const PERSONALITIES = {
  bold: {
    scenes: [7, 9], mode: "dark", bpm: 120, sceneScale: 0.85, drift: 0.07, transitionSec: 0.5, deep: true, endFlood: true,
    fonts: { head: "Space Grotesk", body: "Inter", mono: "JetBrains Mono" },
    P: { ease: { out: "power4.out", io: "power3.inOut", in: "power3.in", soft: "power2.out" }, spring: 0.5, stagger: 0.05, blur: 16, bigType: 200, bg: "glow-grid", hud: true, frame: false, track: "-0.035em", headWeight: 700 },
    open: { "hook-type": 3, "hook-kinetic": 3, "pill-cycle": 2 }, mid: { "app-fill": 2, "field-3d": 3, "wall-zoom": 3, "lines-stack": 2, "lines-climb": 2, "stat-hero": 2, "trio-cards": 1, "hub-orbit": 1, "rapid-fire": 4, "reskin-proof": 2 }, end: { "end-burst": 2, "end-sting": 2 },
    transitions: { "whip-x": 3, "whip-y": 3, "zoom-through": 2, "flood": 1, "cover-wipe": 1 }, endTransition: "cut",
    sfx: { pop: 0.55, whoosh: 0.75, impact: 0.8, chime: 0.45, click: 0.7, typing: 0.4 },
    music: { bpm: 120, brightness: 0.75, density: 0.65, prompt: "Modern electronic product-launch anthem, instrumental, driving four-on-the-floor kick, bright plucky synth arpeggio, tight bass, clean snare on 2 and 4, builds energy with risers and then a big confident drop, polished and uplifting, no vocals" }
  },
  calm: {
    scenes: [7, 8], mode: "light", bpm: 90, sceneScale: 0.72, drift: 0.09, transitionSec: 0.9, soft: true, endFlood: false,
    fonts: { head: "Newsreader", body: "Hanken Grotesk", mono: "DM Mono" },
    P: { ease: { out: "power2.out", io: "sine.inOut", in: "power2.in", soft: "sine.out" }, spring: 0.85, stagger: 0.09, blur: 6, bigType: 170, bg: "soft-gradient", hud: false, frame: true, track: "-0.02em", headWeight: 400 },
    open: { "hook-type": 3, "hook-kinetic": 2, "pill-cycle": 1 }, mid: { "app-fill": 3, "trio-cards": 3, "split-compare": 3, "hub-orbit": 2, "stat-hero": 2, "wall-zoom": 1, "lines-climb": 1, "reskin-proof": 1 }, end: { "end-calm": 2 },
    transitions: { "push": 3, "iris": 3, "cover-wipe": 1 }, endTransition: "iris",
    sfx: { pop: 0.28, whoosh: 0.3, impact: 0.0, chime: 0.4, click: 0.4, typing: 0.25 },
    music: { bpm: 90, brightness: 0.5, density: 0.35, prompt: "Calm, warm, minimal instrumental for a premium brand film: soft pads, gentle piano, light airy pulse, spacious, uplifting but unhurried, gentle swell to a resolved ending, no vocals, no drums beyond a soft pulse" }
  },
  explainer: {
    scenes: [7, 9], mode: "light", bpm: 100, sceneScale: 0.7, drift: 0.08, transitionSec: 0.6, endFlood: false,
    fonts: { head: "Hanken Grotesk", body: "Inter", mono: "IBM Plex Mono" },
    P: { ease: { out: "power3.out", io: "power2.inOut", in: "power2.in", soft: "power2.out" }, spring: 0.65, stagger: 0.07, blur: 8, bigType: 180, bg: "dots", hud: true, frame: true, track: "-0.03em", headWeight: 700 },
    open: { "hook-kinetic": 3, "hook-type": 2, "pill-cycle": 3 }, mid: { "chat-demo": 3, "step-path": 4, "trio-cards": 3, "split-compare": 3, "app-fill": 2, "stat-hero": 1, "rapid-fire": 2, "reskin-proof": 2 }, end: { "end-cta": 2, "end-calm": 1 },
    transitions: { "push": 4, "whip-x": 2, "iris": 2 }, endTransition: "push",
    sfx: { pop: 0.4, whoosh: 0.4, impact: 0.0, chime: 0.4, click: 0.55, typing: 0.35 },
    music: { bpm: 100, brightness: 0.6, density: 0.45, prompt: "Light, friendly, clear instrumental groove for a product explainer: soft kick, bright marimba and pluck melody, clean claps, steady and confident, never busy, no vocals" }
  },
  playful: {
    scenes: [6, 8], mode: "light", bpm: 120, sceneScale: 0.9, drift: 0.06, transitionSec: 0.5, endFlood: true,
    fonts: { head: "Fredoka", body: "Quicksand", mono: "DM Mono" },
    P: { ease: { out: "back.out(1.6)", io: "power2.inOut", in: "power2.in", soft: "power2.out" }, spring: 0.4, stagger: 0.06, blur: 8, bigType: 190, bg: "dots", hud: false, frame: false, track: "-0.01em", headWeight: 700 },
    open: { "hook-kinetic": 3, "hook-type": 3, "pill-cycle": 3 }, mid: { "trio-cards": 3, "hub-orbit": 3, "stat-hero": 2, "wall-zoom": 1, "split-compare": 2, "app-fill": 1, "rapid-fire": 3, "lines-climb": 1 }, end: { "end-burst": 2, "end-calm": 1 },
    transitions: { "iris": 3, "flood": 2, "whip-y": 2 }, endTransition: "flood",
    sfx: { pop: 0.6, whoosh: 0.5, impact: 0.4, chime: 0.55, click: 0.6, typing: 0.35 },
    music: { bpm: 120, brightness: 0.8, density: 0.6, prompt: "Bright, bouncy, joyful instrumental for a friendly product film: playful pluck bass, handclaps, glockenspiel hook, upbeat and light, no vocals" }
  },
  premium: {
    scenes: [5, 6], mode: "dark", bpm: 90, sceneScale: 0.95, drift: 0.04, transitionSec: 1.0, deep: true, endFlood: false,
    fonts: { head: "Playfair Display", body: "Inter", mono: "DM Mono" },
    P: { ease: { out: "power2.out", io: "sine.inOut", in: "power2.in", soft: "sine.out" }, spring: 0.9, stagger: 0.1, blur: 6, bigType: 160, bg: "soft-gradient", hud: false, frame: true, track: "0em", headWeight: 400 },
    open: { "hook-kinetic": 3, "hook-type": 2 }, mid: { "app-fill": 3, "split-compare": 2, "stat-hero": 3, "trio-cards": 2, "lines-climb": 2 }, end: { "end-calm": 2, "end-sting": 1 },
    transitions: { "push": 3, "iris": 3 }, endTransition: "iris",
    sfx: { pop: 0.22, whoosh: 0.25, impact: 0.0, chime: 0.4, click: 0.3, typing: 0.2 },
    music: { bpm: 90, brightness: 0.4, density: 0.3, prompt: "Slow, warm, cinematic instrumental for a luxury brand film: deep soft pads, a single low piano line, distant strings, long reverb, restrained, no vocals" }
  }
};

/** Pick a personality when the caller did not: an explicit word in the brief wins, then the purpose, then the brand colour. */
export function inferPersonality({ brand, hint = "", purpose = "" }) {
  const t = `${hint} ${purpose}`.toLowerCase();
  for (const k of Object.keys(PERSONALITIES)) if (new RegExp(`\\b${k}\\b`).test(t)) return k;
  if (/explain|how it works|tutorial|walk.?through/.test(t)) return "explainer";
  if (/luxur|elegan|upscale|boutique/.test(t)) return "premium";
  if (/fun|friendly|kids|cheer/.test(t)) return "playful";
  if (/calm|soft|gentle|wellness|mindful|serene/.test(t)) return "calm";
  if (/bold|energ|loud|disrupt|launch/.test(t)) return "bold";
  const [, s, l] = rgbToHsl(hexToRgb(brand.primary));
  if (l > 0.7 && s < 0.55) return "calm";
  if (l < 0.28) return "premium";
  if (s > 0.75 && l > 0.45 && l < 0.65) return "playful";
  return "bold";
}

