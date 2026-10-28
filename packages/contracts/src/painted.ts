// Story films: a script becomes a narrated, hand-drawn or painted film (worker/templates/painted). The person picks a
// template; each template names the look it is drawn in, and the app routes it to the right drawing engine. Nobody picks an
// engine: "doodle" looks draw on a canvas and run on any worker, "oil" looks use the painter and need a GPU worker.

export type PaintedEngine = "doodle" | "oil";

export type PaintedLook = {
  /** `<engine>:<medium>`; the medium is the engine's own name for the look (worker/templates/painted/runtime). */
  id: string;
  engine: PaintedEngine;
  medium: string;
  name: string;
  /** One line on how it looks. */
  blurb: string;
  /** The example script the template starts with (the narrator reads it word for word). */
  script: string;
};

const parkBench = "Heavy snow covers a stone park bench where an old man sits in a thick gray coat.\nA young boy walks up to the bench and drops a small wooden toy boat onto a frozen puddle.\nThe old man picks up the stuck boat and points toward the wide frozen pond across the park.\nHe hands the boat back to the boy and draws a sun in the snow with his walking stick.\nThe boy nods, tucks the toy into his red pocket, and runs home through the falling flakes.";
const lemonTree = "A girl and her grandfather climb a windy hill with a small lemon sapling.\nThey dig a hole together and set the roots into the dark soil.\nThe girl waters the sapling while the old man holds his hat against the wind.\nSeasons pass, and the tree grows tall while the grandfather grows older.\nOne evening he picks a lemon and puts it gently in her palm.";
const lighthouse = "A storm rolls over the sea and the old lighthouse keeper climbs the stair to light the lamp.\nHe cranks the great lens until a beam of light sweeps across the black water.\nFar out, a small fishing boat turns toward the light.\nThe waves calm, and the keeper pours a cup of tea as the sun comes up.";
const market = "At dawn a baker opens her little shop on a cobbled street and sets out the warm loaves.\nA boy with a bicycle stops to smell the bread and counts his coins.\nShe smiles, wraps a roll in paper and slips it into his basket for free.\nHe rides away whistling while the street slowly wakes up.";
const pond = "Two ducklings wait at the edge of a quiet pond while their mother paddles ahead.\nThe smaller one dips a foot in the water and pulls it back.\nA gentle breeze pushes a lily pad toward the shore and he hops aboard.\nHe floats out across the pond and catches up with his family, proud and dripping.";
const train = "A girl waits on an empty platform with a suitcase and a paper ticket.\nThe night train rolls in, steam curling around her boots.\nA conductor in a red cap helps her up the steps and points to a window seat.\nShe waves at the lights of the town as the train carries her away.";
const garden = "On a rooftop in the city, an old woman waters her tiny garden of tomatoes and herbs.\nA neighbour's boy peeks over the wall and asks what the green leaves are.\nShe hands him a seed and shows him how to press it into the soil.\nA month later two small sprouts stand side by side on both roofs.";
const camp = "Two friends pitch a small tent in a clearing as the sun sinks behind the pines.\nThey gather sticks and light a campfire that crackles in the dusk.\nOne of them tells a story while the other roasts a marshmallow.\nStars fill the sky and they fall asleep to the sound of an owl.";

const doodle = (medium: string, name: string, blurb: string, script: string): PaintedLook => ({ id: `doodle:${medium}`, engine: "doodle", medium, name, blurb, script });
const oil = (medium: string, name: string, blurb: string, script: string): PaintedLook => ({ id: `oil:${medium}`, engine: "oil", medium, name, blurb, script });

/** Every look, in the order the picker shows them. */
export const paintedLooks: readonly PaintedLook[] = [
  doodle("marker", "Marker", "Bold felt-tip outlines with bright, flat colour.", parkBench),
  doodle("flat", "Flat colour", "Clean cut-paper shapes with no outlines.", lemonTree),
  doodle("pencil", "Pencil", "Soft graphite lines and light shading on paper.", garden),
  doodle("crayon", "Crayon", "Waxy, textured strokes like a child's drawing.", pond),
  doodle("broken", "Broken colour", "Loose, overlapping patches of colour with a broken edge.", market),
  doodle("woodcut", "Woodcut", "Heavy carved lines and earthy ink.", lighthouse),
  doodle("chalk", "Chalkboard", "White and coloured chalk on a dark board.", camp),
  doodle("ballpoint", "Ballpoint pen", "Fine blue pen hatching, like a margin sketch.", train),
  doodle("charcoal", "Charcoal", "Smudged black strokes with deep shadows.", lighthouse),
  doodle("cyanotype", "Cyanotype", "White line work on deep blueprint blue.", train),
  doodle("sumie", "Sumi-e ink", "Brush-and-ink washes with calm empty space.", pond),
  doodle("pixel", "Pixel art", "Chunky retro game pixels.", camp),
  doodle("riso", "Risograph", "Two-colour print with grainy, misregistered layers.", market),
  doodle("scratchboard", "Scratchboard", "White lines scratched out of black.", parkBench),
  doodle("engraving", "Engraving", "Fine crosshatched lines like an old print.", lemonTree),
  oil("oil", "Oil painting", "Thick brush strokes and rich, layered colour.", lemonTree),
  oil("watercolor", "Watercolour", "Soft washes that bleed into the paper.", garden),
  oil("pastel", "Pastel", "Chalky, soft-edged strokes with a warm glow.", market),
  oil("gouache", "Gouache", "Matte, opaque colour with a flat, graphic finish.", pond),
  oil("ink", "Ink wash", "Dark ink lines with grey washes.", lighthouse)
];

export const paintedLookById = (id: unknown): PaintedLook | undefined => paintedLooks.find((look) => look.id === id);

/** How a doodle film is drawn: the scene is drawn once and carries on, or every shot draws itself in again. */
export const paintedDrawModes = ["opening", "each"] as const;
export type PaintedDrawMode = (typeof paintedDrawModes)[number];

export const PAINTED_SCRIPT_MIN = 20;
export const PAINTED_SCRIPT_MAX = 1500;

/** The narration's length decides the film's length: about 2.5 spoken words a second, plus a second of air per line. */
export function paintedSeconds(script: string): number {
  const text = script.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const lines = text.split(/\n+/).filter((line) => line.trim()).length;
  return Math.min(120, Math.max(15, Math.ceil(words / 2.5 + lines)));
}
