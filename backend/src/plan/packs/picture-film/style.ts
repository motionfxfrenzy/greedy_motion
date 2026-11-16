// The picture film's look and narrator, ported from experiments/tarantula-reference/test/style.mjs (the run that made gum-test.mp4).
// The reference and the test were 16:9; the gallery entry is 9:16, so the frame and composition lines adapt to the film's aspect.

/** The drawing style every image prompt starts with. Unchanged from the test except the frame line and the composition rule. */
export function drawingStyle(aspect: string): string {
  const frame = aspect === "9:16"
    ? "Hand-drawn cartoon explainer illustration, vertical 9:16 portrait frame. Compose for the tall frame: the subject large in the middle third, the ground in the lower third, open sky or wall space above it (labels go there); keep the bottom 15% plain."
    : aspect === "1:1"
      ? "Hand-drawn cartoon explainer illustration, square 1:1 frame. The subject large and centred, open space above it for labels."
      : "Hand-drawn cartoon explainer illustration, 16:9.";
  return `${frame}
Clean confident dark-brown/black outlines of even weight, flat colour fills with only soft simple shading, warm limited palette: grass green, soft sky blue, tan soil, dark brown soil, cream walls, white; bright red and bright green only for annotations.
People are stick figures: thin black stick body and limbs, a large perfectly round white head (about a quarter of the body height) with a black outline, no nose, no ears, two round eyes with small black pupils, simple brows and mouth; clothing is only a few props (hat, lab coat, glasses, cap). Animals and important objects are drawn with more detail and texture than the people, semi-realistic but still cartoon.
Backgrounds are simple and uncluttered with lots of empty space, eye-level or straight side-on views; underground is shown as a clean side-on cross-section.
Any words in the picture are hand-lettered capitals in dark ink, short (1-3 words), placed in empty space, never on top of the subject. Never write any other text: no titles, captions, colour names, codes, dates, headlines, brand names or labels that were not asked for. Annotations: red arrows pointing at the thing, green check marks, red question marks, thought bubbles.
No borders, no frames, no gradients, no photo textures, no 3D render look, no watermark, no logos.`;
}

/** The reference narrator (ANALYSIS.md: calm, curious, ~185 wpm, no gap over 0.43 s). Fits the 200-character voice-direction limit. */
export const VOICE_DIRECTION = "Calm, curious, quietly amused male explainer, General American. Brisk, about 185 words a minute, never rushed. Stress the key noun in each line; questions lift a little.";
