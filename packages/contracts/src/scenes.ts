/**
 * The scene list of each visual style: the scenes the render engine can draw for it, in the style's own language. The director
 * picks one per beat (`beat.scene`) so every film is built from the style's real scenes, in the order its story needs, instead of
 * the engine guessing. Colours and fonts always come from the brand kit; the scene decides how the words and shapes are presented.
 * Light on purpose: the browser imports it. Engine ids must match worker/templates/beat-plan/engine.js (`pick(b, [...ids], i)`).
 */
export type SceneDef = { id: string; label: string; idea: string; phrase: string };

const typography: SceneDef[] = [
  { id: "wall", label: "Type wall", idea: "A tilted wall of the film's own words scrolling in opposite directions; the beat's word sits in the accent row, then the wall dims and the word swells.", phrase: "one category, product or vocabulary word (up to 14 characters)" },
  { id: "glitch", label: "Glitch slam", idea: "One huge phrase sliced into strips that jitter and lock, with an accent rule and a dot.", phrase: "a single punchy claim, 1 to 3 words" },
  { id: "stack", label: "Word stack", idea: "The phrase one word per line, one word per hard cut, with a shape snapping in.", phrase: "a 2 to 4 word phrase" },
  { id: "outline", label: "Outline fill", idea: "The phrase in outline, filled by a sweep, framed by rules and a slate like a reel.", phrase: "the proof, a spec or the one thing to remember, 1 to 2 words" },
  { id: "marquee", label: "Marquee", idea: "One huge line that scrolls across the frame in two rows, solid over outline.", phrase: "a short phrase of up to 3 words that can repeat like a ticker" },
  { id: "counter", label: "Counter", idea: "A giant number that counts up, with its unit and a caption.", phrase: "must start with a number and unit, e.g. '7000 mAh' or '120 W'" }
];
const sketch: SceneDef[] = [
  { id: "ring", label: "Circle and arrow", idea: "Hand-drawn type on notebook paper with one thing circled and an arrow pointing at it.", phrase: "an idea or claim to single out" },
  { id: "screen", label: "Sketched screen", idea: "A product screen drawn stroke by stroke: window, sidebar, chart and a tick.", phrase: "what the product shows or does" },
  { id: "box", label: "Boxed note", idea: "A boxed note with underlines, like a margin annotation.", phrase: "a short statement worth underlining" }
];
const doodle: SceneDef[] = [
  { id: "bulb", label: "Light bulb", idea: "A hatched light bulb with rays and a star.", phrase: "an idea, insight or answer" },
  { id: "loop", label: "Looping arrow", idea: "A looping arrow climbing past stars.", phrase: "a journey, path or improvement" },
  { id: "checklist", label: "Checklist", idea: "Three checkboxes ticking off.", phrase: "benefits, steps or what is included" },
  { id: "chart", label: "Rising chart", idea: "Hatched bars and a trend arrow rising.", phrase: "growth, results or a comparison" }
];
const hairline: SceneDef[] = [
  { id: "plates", label: "Layered plates", idea: "Fine-line isometric plates that lift apart and settle.", phrase: "what the product is made of or shows" },
  { id: "cube", label: "Exploding cube", idea: "An isometric cube whose faces separate and close.", phrase: "how parts fit together" },
  { id: "bars", label: "Isometric bars", idea: "A row of isometric bars rising in turn.", phrase: "growth or a comparison" },
  { id: "rings", label: "Stacked rings", idea: "Stacked rings floating apart.", phrase: "layers, levels or tiers" }
];
const vox: SceneDef[] = [
  { id: "cutouts", label: "Cut-paper cutouts", idea: "Two taped cut-paper subjects with a marker ring and arrow, on a flat colour field with halftone.", phrase: "introduce the subject" },
  { id: "data", label: "Data card", idea: "A taped data card with bars growing and a marker trend line.", phrase: "a statistic or trend" },
  { id: "scale", label: "Scale comparison", idea: "One small block beside a tower that keeps growing.", phrase: "before and after, small versus large" }
];

/** The scenes of a style, or an empty list for a style whose scenes the director does not choose (it keeps the engine's own layouts). */
export function scenesFor(look: string | null | undefined, family?: string | null): readonly SceneDef[] {
  if (family === "clean-type" && (!look || look === "clean")) return typography;
  if (look === "sketch") return sketch;
  if (look && look.startsWith("doodle")) return doodle;
  if (look === "hairline") return hairline;
  if (look === "vox-collage") return vox;
  return [];
}
export const sceneIds: readonly string[] = [...new Set([typography, sketch, doodle, hairline, vox].flat().map((scene) => scene.id))];
export const sceneLabel = (look: string | null | undefined, family: string | null | undefined, id: string | null | undefined) => scenesFor(look, family).find((scene) => scene.id === id)?.label;
/** The brief the director reads: the scenes it may assign and the rules for using them. */
export function sceneDirection(look: string | null | undefined, family?: string | null): string {
  const list = scenesFor(look, family);
  if (!list.length) return "";
  return [
    "SCENES FOR THIS STYLE: give every beat a `scene` id from this list (never invent one; use an empty string only if none fits). The scene decides how the beat is presented; the brand kit decides the colours and fonts.",
    ...list.map((scene) => `- ${scene.id} (${scene.label}): ${scene.idea} Phrase: ${scene.phrase}.`),
    "Choose the scene whose idea fits what the beat says. Order them for this story, not as a fixed rotation; the same scene may return later, but never twice in a row and no more than twice in a film, and use at least three different scenes in any film of five beats or more. Write each key phrase for its scene."
  ].join("\n");
}
