// Shared style contract. Runtime rendering data is inlined by the engine build.
// Edit the catalog and run npm run styles:build; see docs/STYLE_LIBRARY.md.
import catalog from "./style-library/catalog.json" with { type: "json" };

export type LookId = "clean" | "sketch" | "hairline" | "doodle" | "doodle-crosshatch" | "doodle-zigzag" | "vox-collage" | "paper-diorama" | "paper" | "paper-cutout" | "paper-stop-motion" | "paper-collage" | "origami" | "paper-cut" | "clay-goofy" | "clay-clean" | "clay-puppet" | "claymation" | `illus-${string}`;
export type Look = {
  id: LookId;
  name: string;
  group: string;
  description: string;
  libraries: string[];
  available: boolean;
  version: number;
  renderer: string;
  renderMode: "native" | "generated";
  preview: { src: string; kind: "image" | "video"; label: string };
  source: string;
  referenceAssets: string[];
  fillStyle?: string;
  instructions: {
    image: string;
    motion: string;
    composition: string;
    negative: string;
    requiredAssets: string[];
    acceptance: string[];
  };
};
export const looks = catalog as Look[];
export const lookIds = looks.filter((look) => look.available).map((look) => look.id);
export const DEFAULT_LOOK: LookId = "clean";
/** All visual looks from the received packs now have a local graphic treatment. */
export const plannedLooks: readonly string[] = [];
export function isLook(value: unknown): value is LookId {
  return typeof value === "string" && looks.some((look) => look.id === value && look.available);
}
export function getLook(value: unknown): Look {
  return looks.find((look) => look.id === value && look.available) ?? looks[0]!;
}
/** Only the chosen recipe goes into the director request; raw vendor instructions never do. */
export function lookDirection(value: unknown): string {
  const look = getLook(value);
  const rule = look.instructions;
  return [
    `STYLE: ${look.name} (${look.id}, recipe v${look.version}).`,
    `Visual treatment: ${rule.image}`,
    `Motion: ${rule.motion}`,
    rule.composition,
    rule.negative,
    `Required references for generated shots: ${rule.requiredAssets.join("; ")}.`,
    look.renderMode === "generated"
      ? "Every non-title scene will receive generated material footage using this recipe and a shared style key. Describe concrete subjects, actions and environments. Keep real product screenshots and all readable text as separate native overlays; never ask image/video generation to draw product UI or lettering."
      : "Apply this drawing treatment to every beat; use the supplied screenshots unchanged."
  ].join("\n");
}
