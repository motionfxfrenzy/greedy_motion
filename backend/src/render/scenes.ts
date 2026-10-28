// Scene drawing: a storyboard film's scenes are drawn in the background while the person is still in the Preview, so
// "Render final video" only joins them. Each scene is drawn by the render worker as a time range of the film page itself
// (worker/src/scenes.mjs adds a clock that plays only that range), so a clip holds exactly the frames the full render
// would: the same frames, motion, feel and clock, with each cut's crossfade inside the clip of the scene it cuts to.
// The soundtrack is mixed ahead the same way (the film page at 1 fps with its pictures hidden).
//
//   Preview opens / a fix lands ─▶ scheduleDraw (2 s debounce) ─▶ build the film page ─▶ one app.scene_clips row per
//   signature ─▶ render-scene ─▶ worker ─▶ clip + live thumbnails ─▶ pg_notify ─▶ /v1/projects/:id/scenes/events
//
// A clip's signature covers everything that can change its pixels: its own frame and motion, the previous scene's (its
// opening crossfade), the page around the frames (engine, fonts, theme, watermark), its frame range and the film's length.
// So fixing a scene redraws that scene and the one after it (which opens on it), and nothing else.
import { createHash, randomUUID } from "node:crypto";
import { access, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { boss, QUEUES } from "../jobs/queues.ts";
import { kickWorkers } from "../jobs/worker-launcher.ts";
import { getProject } from "../projects/store.ts";
import { uploadDirectory } from "../storage.ts";
import { tierFor } from "../billing/service.ts";
import { PLANS } from "../tokens/plan.ts";
import { filmFrames } from "../plan/frame-film.ts";
import { filmScenes, motionSignature } from "../plan/frame-motion.ts";
import { projectTiming } from "../plan/preview.ts";
import { planReadiness } from "../plan/readiness.ts";
import { buildPlanRenderProject } from "../plan/render-project.ts";

/** Bump when the worker draws clips differently (its clock, encode or HyperFrames version): every clip is redrawn. */
const CLIP_VERSION = 1;
export const SCENE_FPS = 30;
const DEBOUNCE_MS = 2000;
/** Clips of a project nobody has opened for this long are deleted with their files. */
const KEEP_DAYS = 7;

export type ClipState = "queued" | "drawing" | "drawn" | "failed";
/** The browser view of one clip. */
export type SceneClipView = { id: string; kind: "scene" | "soundtrack"; index: number; state: ClipState; framesDone: number; framesTotal: number; thumbFrame: number | null; error?: string };

type Planned = { kind: "scene" | "soundtrack"; index: number; signature: string; from: number; to: number };

const sha = (...parts: (string | Buffer)[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\u0000");
  return hash.digest("hex");
};

/** A digest of every file in a folder (names and bytes), so a font, logo or script changed under the same name changes it. */
async function folderDigest(dir: string, prefix = ""): Promise<string> {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const parts: string[] = [];
  for (const entry of entries) {
    const name = `${prefix}${entry.name}`;
    parts.push(entry.isDirectory() ? await folderDigest(join(dir, entry.name), `${name}/`) : sha(name, await readFile(join(dir, entry.name))));
  }
  return sha(...parts);
}

/** HyperFrames' frame count for a length (it rounds to the nearest frame when within a hair of one). */
export function framesFor(seconds: number, fps = SCENE_FPS) {
  const raw = seconds * fps;
  const near = Math.round(raw);
  return Math.abs(raw - near) <= 1e-6 ? near : Math.ceil(raw);
}

const AUDIO_TAG = /<audio\b[^>]*><\/audio>/g;
const FILM_DATA = /<script id="ff-data" type="application\/json">([\s\S]*?)<\/script>/;

/**
 * The clips a film page is made of: one per scene, on whole frames that tile the film exactly (scene i holds frames
 * [round(start_i × fps), round(start_i+1 × fps)), the last one runs to the film's end), plus the soundtrack.
 */
export async function planClips(pageDir: string, html: string): Promise<Planned[]> {
  const match = FILM_DATA.exec(html);
  if (!match) throw new Error("This film has no approved frames to draw.");
  const data = JSON.parse(match[1]!) as { beats: Array<{ start: number; end: number; svg: string; motion: unknown }> } & Record<string, unknown>;
  const { beats, ...look } = data;
  // Everything on the page except the frames and the soundtrack: engine, frame-film script, fonts, theme, watermark.
  const chrome = sha(html.replace(match[0], "").replace(AUDIO_TAG, ""), JSON.stringify(look), await folderDigest(pageDir));
  const total = framesFor(beats[beats.length - 1]!.end);
  const starts = beats.map((beat, i) => (i === 0 ? 0 : Math.round(beat.start * SCENE_FPS)));
  const scene = (beat: (typeof beats)[number] | undefined) => (beat ? sha(beat.svg, JSON.stringify(beat.motion), String(beat.start), String(beat.end)) : "");
  const planned: Planned[] = beats.map((beat, i) => {
    const from = starts[i]!;
    const to = i + 1 < beats.length ? starts[i + 1]! : total;
    return { kind: "scene", index: i, from, to, signature: sha(`clip-v${CLIP_VERSION}`, chrome, scene(beats[i - 1]), scene(beat), `${from}-${to}/${total}@${SCENE_FPS}`) };
  });
  // The soundtrack: the audio tags and the bytes of every file they play.
  const tags = html.match(AUDIO_TAG) ?? [];
  const files = await Promise.all([...new Set(tags.map((tag) => /src="([^"]+)"/.exec(tag)?.[1]).filter((src): src is string => Boolean(src)))].sort()
    .map(async (src) => sha(src, await readFile(join(pageDir, src)).catch(() => Buffer.from("missing")))));
  planned.push({ kind: "soundtrack", index: beats.length, from: 0, to: total, signature: sha(`soundtrack-v${CLIP_VERSION}`, ...tags, ...files, String(total)) });
  return planned;
}

type ClipRow = { id: string; kind: "scene" | "soundtrack"; scene_index: number; state: ClipState; frames_done: number | null; frames_total: number; thumb_frame: number | null; error: { message?: string } | null };
const CLIP_COLUMNS = "id, kind, scene_index, state, frames_done, frames_total, thumb_frame, error";

const toView = (row: ClipRow): SceneClipView => ({
  id: row.id, kind: row.kind, index: row.scene_index, state: row.state,
  framesDone: row.state === "drawn" ? row.frames_total : row.frames_done ?? 0, framesTotal: row.frames_total, thumbFrame: row.thumb_frame,
  ...(row.state === "failed" ? { error: row.error?.message ?? "This scene could not be drawn." } : {})
});

/** The clips the project's film is made of right now, scenes in order, then the soundtrack. */
export async function currentClips(projectId: string): Promise<SceneClipView[]> {
  const { rows } = await pool.query<ClipRow>(`select ${CLIP_COLUMNS} from app.scene_clips where project_id = $1 and current order by kind, scene_index`, [projectId]);
  return rows.map(toView);
}

/** One clip's latest drawn frame (a small JPEG), or null. */
export async function clipThumb(projectId: string, clipId: string) {
  const { rows } = await pool.query<{ thumb: Buffer | null; thumb_frame: number | null }>("select thumb, thumb_frame from app.scene_clips where id = $1 and project_id = $2", [clipId, projectId]);
  return rows[0]?.thumb ? { image: rows[0].thumb, frame: rows[0].thumb_frame } : null;
}

/** Where a drawn clip lives: a file under the renders dir, or a key in the outputs bucket. */
export async function clipOutput(projectId: string, clipId: string) {
  const { rows } = await pool.query<{ output: { file?: string; key?: string } | null }>("select output from app.scene_clips where id = $1 and project_id = $2 and state = 'drawn'", [clipId, projectId]);
  return rows[0]?.output ?? null;
}

const pagesDir = (projectId: string) => join(config.renderOutputDir, "scenes", projectId, "pages");

/**
 * Builds the film page exactly as the final render would (render-project.ts, same watermark) into a folder named by its
 * content, so an unchanged film reuses the folder it was drawn from.
 */
async function buildPage(projectId: string, watermark: boolean) {
  const project = await getProject(projectId);
  if (!project?.beatPlan) return null;
  if (!planReadiness(project).ok) return null;
  const timing = projectTiming(project);
  const frames = timing ? filmFrames(project, timing) : null;
  if (!timing || !frames) return null;
  // Drawn only once every scene's motion has been directed (the Preview's animate step): never direct it from here.
  const directed = new Set((project.filmMotion ?? []).map((entry) => entry.signature));
  if (filmScenes(project, timing, frames).some((scene) => !directed.has(motionSignature(scene)))) return null;
  const building = join(pagesDir(projectId), `.build-${randomUUID()}`);
  try {
    await buildPlanRenderProject(project, building, { watermark });
    const html = await readFile(join(building, "index.html"), "utf8");
    const hash = sha(html, await readFile(join(building, "variables.json"), "utf8"), await folderDigest(building)).slice(0, 24);
    const dir = join(pagesDir(projectId), hash);
    if (await access(dir).then(() => true, () => false)) await rm(building, { recursive: true, force: true });
    else await rename(building, dir);
    const planned = await planClips(dir, html);
    // Object storage: the worker has no shared disk; it reads the page from the uploads bucket.
    const prefix = `scenes/${projectId}/pages/${hash}`;
    if (config.storageDriver === "r2") await uploadDirectory(dir, prefix);
    return { planned, page: config.storageDriver === "r2" ? { prefix } : { dir: `/renders/scenes/${projectId}/pages/${hash}` } };
  } catch (error) {
    await rm(building, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Makes the project's current clips exist: unchanged ones are kept as they are (drawn or drawing), new or failed ones
 * are queued, and clips the film no longer uses stop being current (the worker drops one still drawing). Returns the
 * current clips, or null when the film cannot be drawn yet (no directed motion, or it would not pass Render's checks).
 */
export async function ensureClips(projectId: string, watermark: boolean): Promise<SceneClipView[] | null> {
  const built = await buildPage(projectId, watermark);
  if (!built) return null;
  const queue: string[] = [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const clip of built.planned) {
      const input = { page: built.page, fps: clip.kind === "soundtrack" ? 1 : SCENE_FPS, from: clip.from, to: clip.to };
      const { rows } = await client.query<{ id: string; state: ClipState }>(
        `insert into app.scene_clips (id, project_id, kind, scene_index, signature, frames_total, render_input)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (project_id, signature) do update
           set current = true, used_at = now(), scene_index = excluded.scene_index,
               render_input = case when app.scene_clips.state in ('drawn', 'drawing') then app.scene_clips.render_input else excluded.render_input end,
               state = case when app.scene_clips.state = 'failed' then 'queued' else app.scene_clips.state end,
               error = case when app.scene_clips.state = 'failed' then null else app.scene_clips.error end,
               updated_at = now()
         returning id, state`,
        [randomUUID(), projectId, clip.kind, clip.index, clip.signature, clip.to - clip.from, input]
      );
      if (rows[0]!.state === "queued") queue.push(rows[0]!.id);
    }
    await client.query("update app.scene_clips set current = false, updated_at = now() where project_id = $1 and current and not (signature = any($2))", [projectId, built.planned.map((clip) => clip.signature)]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // Scenes first, in film order (the soundtrack is quick); a clip already waiting keeps its single message.
  // A send that fails leaves its row queued; the next call (Preview opening, a fix) sends it again, so one failure must not stop the rest.
  for (const id of queue) {
    await boss.send(QUEUES.scene, { clipId: id }, { singletonKey: id }).catch(() => boss.send(QUEUES.scene, { clipId: id }, { singletonKey: id })).catch((error) => console.error(JSON.stringify({ level: "error", event: "scene_send_failed", clipId: id, message: error instanceof Error ? error.message : String(error) })));
  }
  if (queue.length) void kickWorkers(true);
  return currentClips(projectId);
}

const timers = new Map<string, NodeJS.Timeout>();

/**
 * Draws the project's scenes once the Preview has settled: called when it opens and after every fix, and debounced so a
 * burst of changes queues one round. Free to the person (tokens are taken only by the final render). Never throws.
 */
export function scheduleDraw(projectId: string, ownerId: string) {
  clearTimeout(timers.get(projectId));
  timers.set(projectId, setTimeout(() => {
    timers.delete(projectId);
    void (async () => {
      const watermark = PLANS[await tierFor(ownerId)].watermark;
      const clips = await ensureClips(projectId, watermark);
      console.log(JSON.stringify({ level: "info", event: "scenes_scheduled", projectId, clips: clips?.length ?? 0, queued: clips?.filter((clip) => clip.state === "queued").length ?? 0 }));
    })().catch((error) => console.error(JSON.stringify({ level: "error", event: "scenes_schedule_failed", projectId, message: error instanceof Error ? error.message : String(error) })));
  }, DEBOUNCE_MS));
}

/**
 * The final render's join plan: the current clips, in order, if the film being rendered is the one drawn (or drawing).
 * The worker waits for any still drawing, then joins them; null sends the render down the full-film path.
 */
export async function joinPlan(projectId: string, watermark: boolean) {
  const clips = await ensureClips(projectId, watermark);
  if (!clips?.length) return null;
  const scenes = clips.filter((clip) => clip.kind === "scene");
  const soundtrack = clips.find((clip) => clip.kind === "soundtrack");
  if (!soundtrack || !scenes.length) return null;
  return { projectId, scenes: scenes.map((clip) => clip.id), soundtrack: soundtrack.id, totalFrames: scenes.reduce((sum, clip) => sum + clip.framesTotal, 0), fps: SCENE_FPS };
}

/**
 * Housekeeping: deletes the clips (rows and files) of projects nobody has opened for KEEP_DAYS, and clips a project
 * stopped using a day ago. Drawn files in the outputs bucket are left to the bucket's lifecycle rule.
 */
export async function sweepClips() {
  const stale = await pool.query<{ project_id: string }>(
    `delete from app.scene_clips where project_id in (
       select project_id from app.scene_clips group by project_id having max(used_at) < now() - make_interval(days => $1))
     returning project_id`, [KEEP_DAYS]);
  for (const projectId of new Set(stale.rows.map((row) => row.project_id))) await rm(join(config.renderOutputDir, "scenes", projectId), { recursive: true, force: true });
  const dropped = await pool.query<{ project_id: string; output: { file?: string } | null }>(
    "delete from app.scene_clips where not current and state <> 'drawing' and used_at < now() - interval '1 day' returning project_id, output");
  for (const row of dropped.rows) if (row.output?.file) await rm(join(config.renderOutputDir, row.output.file), { force: true });
  // Page folders no clip points at any more.
  for (const projectId of new Set(dropped.rows.map((row) => row.project_id))) {
    const { rows } = await pool.query<{ page: string }>("select distinct render_input->'page'->>'dir' as page from app.scene_clips where project_id = $1", [projectId]);
    const used = new Set(rows.map((row) => row.page?.split("/").pop()));
    for (const name of await readdir(pagesDir(projectId)).catch(() => [])) {
      const dir = join(pagesDir(projectId), name);
      const old = await stat(dir).then((info) => Date.now() - info.mtimeMs > 3_600_000, () => false);
      if (!used.has(name) && old) await rm(dir, { recursive: true, force: true });
    }
  }
  return stale.rowCount ?? 0;
}

export function startClipSweep(everyMs = 3_600_000) {
  const timer = setInterval(() => void sweepClips().catch((error) => console.warn(JSON.stringify({ level: "warn", event: "scene_sweep_failed", message: error instanceof Error ? error.message : String(error) }))), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
