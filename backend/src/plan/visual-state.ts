import { createHash } from "node:crypto";
import { join } from "node:path";
import { getLook, type VideoProject, type VisualStatus } from "@videosaas/contracts";
import { config } from "../config.ts";
import { readMedia } from "../media.ts";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const visualDir = (id: string) => join(config.projectsDir, id, "visuals");
export const materialBeats = (p: VideoProject) => getLook(p.brief?.look).renderMode === "generated" ? (p.beatPlan?.beats.filter(b => b.kind !== "title" && b.role !== "cta") ?? []) : [];
export const visualFingerprint = (p: VideoProject) => {
  const look = getLook(p.brief?.look);
  return digest(JSON.stringify({
  recipe: { id: look.id, version: look.version, instructions: look.instructions, references: look.referenceAssets }, canvas: p.beatPlan?.canvas,
  subject: p.brief?.productName ?? p.name, theme: p.brief?.theme ?? p.request.theme,
  brandId: p.brief?.brandId ?? p.request.brandId, brand: p.visualBrandSignature,
  beats: materialBeats(p).map(b => ({ id: b.id, kind: b.kind, keyword: b.keyword, line: b.line, prompt: b.generation?.keyframe_prompt }))
}));
};
export const totalReserved = (v: VideoProject["planVisuals"]) => (v?.reservedUsd ?? 0) + (v?.history ?? []).reduce((sum, run) => sum + run.reservedUsd, 0);
// Conservative request reservations, not metered billing. No automatic re-submission after an ambiguous request.
export const IMAGE_RESERVE = 0.25;
export const VIDEO_RESERVE = 1.60;
export function visualStatus(p: VideoProject): VisualStatus {
  const beats = materialBeats(p), v = p.planVisuals;
  const current = v?.fingerprint === visualFingerprint(p);
  return { required: beats.length > 0, available: Boolean(config.geminiApiKey), status: !v ? "not-started" : current ? v.status : "stale", total: beats.length,
    ready: current ? beats.filter(b => v?.shots[b.id]?.clip).length : 0,
    estimateUsd: Math.ceil((IMAGE_RESERVE + beats.length * (IMAGE_RESERVE + VIDEO_RESERVE + (p.brief?.look === "paper-cut" ? IMAGE_RESERVE : 0))) * 100) / 100,
    reservedUsd: totalReserved(v), maxBudgetUsd: config.visualMaxBudgetUsd, error: current ? v?.error : undefined, runId: v?.runId };
}
export function currentClips(p: VideoProject) {
  if (p.planVisuals?.fingerprint !== visualFingerprint(p)) return {};
  return Object.fromEntries(materialBeats(p).flatMap(b => p.planVisuals?.shots[b.id]?.clip ? [[b.id, p.planVisuals.shots[b.id]!.clip!]] : []));
}

export async function verifyVisualAssets(p: VideoProject, read = readMedia) {
  for (const clip of Object.values(currentClips(p))) {
    const bytes = await read(join(visualDir(p.id), clip.file));
    if (!bytes || digest(bytes) !== clip.sha256) throw new Error("A generated scene is missing or corrupt; restore it before previewing or rendering.");
  }
}
export function requireReadyVisuals(p: VideoProject) {
  const status = visualStatus(p);
  if (status.required && (status.status !== "ready" || status.ready !== status.total)) throw new Error("Material scenes must be current and complete before export.");
}

/** Close the gap between loading a project snapshot and resolving its live brand files. */
export function requireCurrentPalette(p: VideoProject, brand: { colors: unknown; mode?: string } | null) {
  if (!materialBeats(p).length || !Object.keys(currentClips(p)).length) return;
  const signature = brand ? digest(JSON.stringify({ colors: brand.colors, mode: brand.mode })) : undefined;
  if (signature !== p.visualBrandSignature) throw new Error("The brand palette changed. Refresh the storyboard and regenerate material scenes before export.");
}
