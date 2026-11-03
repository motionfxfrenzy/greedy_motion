import { createHash, randomUUID } from "node:crypto";
import { getProject } from "../projects/store.ts";
import { desiredVariants, isPlateLook, wantedAspects } from "./inputs.ts";
import {
  ASPECTS, defaultSubtitlesFor, isAspect, mergeSubtitles, primaryAspect, type Aspect, type PlateComment, type PlateScene, type PlateState, type PlateStatus, type VariantState, type PlateSubtitles, type PlateVariantView
} from "./model.ts";
import { editComments, listVariants, readProjectState, reconcileVariants, reviseScene, writeSubtitles, type VariantRow } from "./store.ts";

export { isPlateLook };
const OPEN: VariantState[] = ["queued", "authoring", "bundled", "rendering"];

async function plateProject(projectId: string) {
  const project = await getProject(projectId);
  if (!project || !isPlateLook(project.brief?.look)) throw new Error("This project's style is not a code-drawn plate style.");
  return project;
}

const clipVersion = (v: VariantRow) => (v.clip_key ? createHash("md5").update(v.clip_key).digest("hex").slice(0, 10) : null);
// "bundled" (waiting for a worker) is rendering as far as the person is concerned.
const shown = (state: VariantState): PlateState => (state === "bundled" ? "rendering" : state);

function viewOf(v: VariantRow): PlateVariantView {
  return { state: shown(v.state), sig: v.signature, v: clipVersion(v), ...(v.stage && OPEN.includes(v.state) ? { stage: v.stage } : {}), ...(v.state === "failed" && v.error ? { error: v.error.message } : {}) };
}

/** What the browser shows. Built from Postgres only. */
export async function plateStatus(projectId: string): Promise<PlateStatus> {
  const project = await getProject(projectId);
  const look = project?.brief?.look ?? null;
  const [variants, stored] = await Promise.all([listVariants(projectId), readProjectState(projectId)]);
  const primary = project ? primaryAspect(project) : "16:9";
  const subtitles: PlateSubtitles = { ...defaultSubtitlesFor(project), ...(stored.subtitles ?? {}) };
  if (!subtitles.aspects?.length) subtitles.aspects = [primary];

  const byScene = new Map<number, Map<Aspect, VariantRow>>();
  for (const v of variants) { if (!byScene.has(v.scene_index)) byScene.set(v.scene_index, new Map()); byScene.get(v.scene_index)!.set(v.aspect, v); }
  const primaryRows = [...byScene.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m.get(primary) ?? [...m.values()][0]!);
  const scenes: PlateScene[] = primaryRows.map((v) => ({
    index: v.scene_index, keyword: v.keyword, state: shown(v.state), seconds: v.frames / v.fps, frames: v.frames, sig: v.signature, rev: v.rev,
    ...(v.state === "failed" && v.error ? { error: v.error.message } : {}), ...(v.authored ? { attempts: v.authored } : {}),
    variants: Object.fromEntries([...byScene.get(v.scene_index)!.entries()].map(([a, row]) => [a, viewOf(row)]))
  }));

  const drawnAspects: Aspect[] = [], drawingAspects: Aspect[] = [];
  const count = byScene.size;
  for (const aspect of ASPECTS) {
    const rows = variants.filter((v) => v.aspect === aspect);
    if (rows.length === count && count > 0 && rows.every((v) => v.state === "drawn")) drawnAspects.push(aspect);
    if (rows.some((v) => OPEN.includes(v.state))) drawingAspects.push(aspect);
  }

  // Comments answered by a redraw (the scene's variant is drawn again at the revision that took them) are done.
  const answered = (c: PlateComment & { fixing?: number }) => c.fixing !== undefined && ((primaryRows.find((v) => v.scene_index === c.scene)?.rev ?? 0) >= c.fixing) && primaryRows.find((v) => v.scene_index === c.scene)?.state === "drawn";
  let comments = stored.comments as (PlateComment & { fixing?: number })[];
  if (comments.some(answered)) comments = (await editComments(projectId, (all) => (all as (PlateComment & { fixing?: number })[]).filter((c) => !answered(c)))) as typeof comments;
  return { available: isPlateLook(look ?? undefined), look, scenes, comments, subtitles, running: variants.some((v) => OPEN.includes(v.state)), drawnAspects, drawingAspects };
}

export async function setPlateSubtitles(projectId: string, input: Record<string, unknown>): Promise<PlateSubtitles> {
  const project = await getProject(projectId);
  const stored = await readProjectState(projectId);
  const current = { ...defaultSubtitlesFor(project), ...(stored.subtitles ?? {}) };
  const next = mergeSubtitles(current, input, project ? primaryAspect(project) : "16:9");
  await writeSubtitles(projectId, next);
  return next;
}

/**
 * Makes every scene of the wanted ratios exist, once. Idempotent and cheap: a scene whose full signature is unchanged keeps
 * its drawn clip (no model call, no render); a changed scene is superseded and queued; a failed one is retried from its saved
 * bundle when it has one. Returns at once; authoring and rendering continue on the queues whatever happens to this process.
 */
export async function startPlates(projectId: string, extraAspects: Aspect[] = []): Promise<PlateStatus> {
  const project = await plateProject(projectId);
  const beats = project.brief?.scriptBeats ?? [];
  if (!beats.length) throw new Error("Write the script and storyboard first.");
  const stored = await readProjectState(projectId);
  const aspects = [...new Set([...wantedAspects(project, [...(project.brief?.aspects ?? []), ...(stored.subtitles?.aspects ?? []), ...extraAspects])])];
  const desired = await desiredVariants(project, aspects);
  await reconcileVariants(projectId, desired, { scenes: beats.length });
  return plateStatus(projectId);
}

/** Draws one more ratio natively (its own authoring, verification and render); the ratios already drawn are untouched. */
export async function drawAspectPlates(projectId: string, aspect: Aspect): Promise<PlateStatus> {
  if (!isAspect(aspect)) throw new Error("Aspect must be 16:9, 9:16, or 1:1.");
  const project = await plateProject(projectId);
  const stored = await readProjectState(projectId);
  const current = { ...defaultSubtitlesFor(project), ...(stored.subtitles ?? {}) };
  await writeSubtitles(projectId, mergeSubtitles(current, { aspects: [...new Set([...(current.aspects ?? []), aspect])] }, primaryAspect(project)));
  return startPlates(projectId, [aspect]);
}

const clockOf = (scenes: { index: number; seconds: number }[], at: number) => {
  let start = 0;
  for (const scene of scenes) { if (at < start + scene.seconds || scene === scenes[scenes.length - 1]) return { scene: scene.index, sceneAt: Math.max(0, Math.min(scene.seconds, at - start)) }; start += scene.seconds; }
  return { scene: 0, sceneAt: 0 };
};

export async function addPlateComment(projectId: string, input: { at: unknown; body: unknown }): Promise<PlateComment> {
  const project = await getProject(projectId);
  const rows = (await listVariants(projectId)).filter((v) => v.aspect === (project ? primaryAspect(project) : "16:9"));
  const scenes = rows.map((v) => ({ index: v.scene_index, seconds: v.frames / v.fps }));
  const body = typeof input.body === "string" ? input.body.trim().slice(0, 600) : "", at = Number(input.at);
  if (!body) throw new Error("Write what should change.");
  if (!scenes.length || !Number.isFinite(at) || at < 0) throw new Error("Pick a moment in the film.");
  const where = clockOf(scenes, at);
  const comment: PlateComment = { id: randomUUID().replace(/-/g, "").slice(0, 12), at: Math.round(at * 10) / 10, ...where, sceneAt: Math.round(where.sceneAt * 10) / 10, body };
  await editComments(projectId, (all) => [...all, comment].slice(-40));
  return comment;
}
export async function removePlateComment(projectId: string, id: string) { await editComments(projectId, (all) => all.filter((c) => c.id !== id)); }

/** Sends the scenes that have comments back to the model with the notes; every drawn ratio of such a scene is redrawn. */
export async function fixPlates(projectId: string): Promise<PlateStatus> {
  await plateProject(projectId);
  const stored = await readProjectState(projectId);
  const comments = stored.comments as (PlateComment & { fixing?: number })[];
  if (!comments.length) throw new Error("Add a comment first.");
  const variants = await listVariants(projectId);
  const targets = [...new Set(comments.map((c) => c.scene))].filter((i) => variants.some((v) => v.scene_index === i));
  if (targets.some((i) => variants.filter((v) => v.scene_index === i).some((v) => OPEN.includes(v.state)))) throw new Error("Wait for the scenes that are being drawn.");
  const noted = new Set<number>();
  for (const i of targets) {
    const notes = comments.filter((c) => c.scene === i).map((c) => `- at ${c.sceneAt.toFixed(1)} s: ${c.body}`).join("\n");
    if (await reviseScene(projectId, i, notes)) noted.add(i);
  }
  if (!noted.size) throw new Error("Wait for the scenes that are being drawn.");
  const after = await listVariants(projectId);
  const revOf = (scene: number) => Math.max(...after.filter((v) => v.scene_index === scene).map((v) => v.rev));
  await editComments(projectId, (all) => (all as (PlateComment & { fixing?: number })[]).map((c) => noted.has(c.scene) ? { ...c, fixing: revOf(c.scene) } : c));
  return plateStatus(projectId);
}

