import type { Aspect } from "./beat-plan.ts";

/**
 * Which render engine a project uses, and how big its preview is.
 *
 * Product rule: HyperFrames is the default. EffectCraft is only for complex 3D-card work, and only a
 * pro user can ever land on it. Ordinary users never see an engine: they get a low-resolution preview
 * and comment to edit.
 */
export const engines = ["hyperframes", "effectcraft"] as const;
export type Engine = (typeof engines)[number];

export const previewQualities = ["draft540", "preview720", "final"] as const;
export type PreviewQuality = (typeof previewQualities)[number];

export const isPreviewQuality = (value: unknown): value is PreviewQuality => previewQualities.includes(value as PreviewQuality);

/** Longer edge of the preview box. A 16:9 composition is 960×540 / 1280×720, a 9:16 one 540×960 / 720×1280. */
const SHORT_EDGE: Record<Exclude<PreviewQuality, "final">, number> = { draft540: 540, preview720: 720 };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Pixel size for a preview of a canvas. The aspect ratio is preserved, dimensions are even (H.264),
 * and the result never exceeds the canvas: a small composition is not upscaled. `final` is the canvas.
 */
export function previewSize(canvas: { width: number; height: number }, quality: PreviewQuality): { width: number; height: number } {
  if (quality === "final") return { width: canvas.width, height: canvas.height };
  const short = Math.min(canvas.width, canvas.height);
  const target = SHORT_EDGE[quality];
  if (short <= target) return { width: canvas.width, height: canvas.height };
  const scale = target / short;
  return { width: even(canvas.width * scale), height: even(canvas.height * scale) };
}

export type EngineEntitlements = { pro: boolean };

export type EngineChoice = { engine: Engine; reason: "default" | "project" | "override" | "not-pro" };

/**
 * Pick the engine for a project. `projectEngine` is what the project asked for (set when a pro user
 * opened it in the Pro Editor, or by a format that needs 3D). A caller without the pro entitlement is
 * always routed to HyperFrames, whatever the project says.
 */
export function resolveEngine(input: { projectEngine?: Engine | undefined; entitlements: EngineEntitlements; override?: Engine | undefined }): EngineChoice {
  const wanted = input.override ?? input.projectEngine;
  if (!wanted || wanted === "hyperframes") return { engine: "hyperframes", reason: input.override ? "override" : "default" };
  if (!input.entitlements.pro) return { engine: "hyperframes", reason: "not-pro" };
  return { engine: wanted, reason: input.override ? "override" : "project" };
}

/** Whether to show engine UI (the pill, the mode switch). Simple users never see it. */
export const showsEngineUi = (entitlements: EngineEntitlements) => entitlements.pro;

export type CanvasForAspect = Record<Aspect, { width: number; height: number }>;

/**
 * The Pro Editor's copy of a project: an editable HyperFrames folder under `projects/<id>/pro/`, snapshotted from the
 * project's render folder when a pro user opens it. File bytes live in media storage, not in the project JSON; the
 * manifest records the revision a client must send back (`baseRev`) so two tabs never silently overwrite each other.
 */
export type ProPreview = { jobId: string; quality: PreviewQuality; rev: number; createdAt: string };

export type ProManifest = {
  engine: Engine;
  /** Increases by one on every accepted write. */
  rev: number;
  entry: string;
  canvas: { width: number; height: number };
  durationSeconds: number;
  /** Where the folder came from: the beat-plan engine page, or a blank composition. */
  source: "beat-plan" | "blank";
  files: Record<string, { size: number; sha256: string }>;
  openedAt: string;
  updatedAt: string;
  previews: ProPreview[];
};
