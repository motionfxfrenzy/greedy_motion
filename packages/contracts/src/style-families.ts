/**
 * A style family splits one broad visual style into the kinds of film it is used for. "Clean" is a graphic treatment (crisp
 * geometry, bold type) that carries very different films: product UI, 3D and cinematic scenes, typography, data and diagrams.
 * A family is a look plus a direction: picking it keeps the same renderer and gives the director and the examples a clear
 * focus. Every template is filed under one family of its look (gallery.ts `familyOf`); a look without families is its own family.
 * Light on purpose: the browser imports it (package export `@videosaas/contracts/style-families`).
 */
export type StyleFamily = { id: string; look: string; name: string; description: string; direction: string };

export const styleFamilies: readonly StyleFamily[] = [
  {
    id: "clean-ui", look: "clean", name: "Clean · Product UI",
    description: "Your real screens, cursor actions, zooms into one control and callouts, on crisp layout.",
    direction: "Style family: product UI. Lead with the product's own screens: a cursor performs each action, the camera pushes into one control at a time, callouts name what changed; type supports the screen and never competes with it."
  },
  {
    id: "clean-3d", look: "clean", name: "Clean · 3D & cinematic",
    description: "Depth, light and camera moves: slow pushes, parallax layers, objects that turn and settle.",
    direction: "Style family: 3D and cinematic. Think in depth and light: slow camera pushes and orbits, parallax layers, objects that rotate and settle, soft shadows and glow. Few words, large type, long confident moves; no dense UI."
  },
  {
    id: "clean-type", look: "clean", name: "Clean · Typography & showreel",
    description: "Words are the picture: kinetic type, hard beat cuts, shapes and rhythm.",
    direction: "Style family: typography and showreel. This is a dynamic-typography film, NOT a product explainer: no hook, feature, proof and call-to-action arc, no screenshots, no product-UI language. Every beat is one typographic scene built from the product's real words: its names, categories, models and claims. Beats are short (1.5 to 3 seconds), so use the top of the beat range and keep each key phrase to 1 to 3 words (at most 20 characters). Each beat is presented by one of the style's scenes (listed below); choose them to fit what each beat says. Close on the brand name. Write in the brand's voice with concrete names (models, features, categories) taken from the site facts; never filler like 'built for you'. Voiceover, if any, is a terse rhythm under the cuts."
  },
  {
    id: "clean-data", look: "clean", name: "Clean · Data & diagrams",
    description: "Charts, formulas, flows and maps drawn on, one idea per scene.",
    direction: "Style family: data and diagrams. Draw the idea: charts that grow, lines that trace, flows and maps that build node by node, formulas that transform. One idea per scene, labelled plainly, with the key number or conclusion held on screen."
  }
];

export const getStyleFamily = (id: string | null | undefined) => styleFamilies.find((family) => family.id === id);
export const isStyleFamily = (id: unknown): id is string => typeof id === "string" && styleFamilies.some((family) => family.id === id);
/** The families of one look (empty for a look that is a single style). */
export const familiesOfLook = (look: string) => styleFamilies.filter((family) => family.look === look);
/** The line the director reads when a family is chosen. */
export const familyDirection = (id: string | null | undefined) => getStyleFamily(id)?.direction ?? "";
