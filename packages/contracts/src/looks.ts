// Look catalog (docs/CREATIVE_LIBRARY_PLAN.md §2C): the drawing style layered on top of the brand. A look never
// chooses colours or typefaces — those always come from the brand kit or theme tokens — it chooses how marks are
// drawn. Shared by the brief form, backend validation and the render engine (`look` variable).

export type LookId = "clean" | "sketch";

export type Look = {
  id: LookId;
  name: string;
  description: string;
  /** Libraries the engine inlines for this look (pinned in backend/package.json). */
  libraries: string[];
  /** False for looks that are designed but not built yet. */
  available: boolean;
};

export const looks: readonly Look[] = [
  { id: "clean", name: "Clean", description: "Crisp lines and smooth underlines. The default.", libraries: ["gsap"], available: true },
  { id: "sketch", name: "Sketch", description: "Hand-drawn ink: underlines, circles around what the cursor clicks. Still in your brand colours.", libraries: ["gsap", "roughjs"], available: true }
] as const;

/** Looks that need generated imagery (Nano Banana → Veo) and land with the shot-direction phase. */
export const plannedLooks = ["paper", "claymation", "vox-collage", "paper-cut"] as const;

export const lookIds = looks.map((look) => look.id);
export const DEFAULT_LOOK: LookId = "clean";

export function isLook(value: unknown): value is LookId {
  return typeof value === "string" && looks.some((look) => look.id === value && look.available);
}
