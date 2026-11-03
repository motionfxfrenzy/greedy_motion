import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import type { VideoProject } from "@videosaas/contracts";
import { pool } from "../db/database.ts";
import { boss, QUEUES } from "../jobs/queues.ts";
import { kickWorkers } from "../jobs/worker-launcher.ts";
import { readMedia } from "../media.ts";
import { planAudioDir } from "../plan/audio.ts";
import { objectSize, putObject } from "../storage.ts";
import {
  ASSEMBLER_VERSION, FPS, buildSubtitleCues, buildTimeline, defaultSubtitlesFor, exportSignature, sceneSfxCues, sceneTransitionCues, sizeForAspect, takeFor,
  type Aspect, type PlateSfxCue, type PlateSubtitles
} from "./model.ts";
import { listVariants, readProjectState } from "./store.ts";

/**
 * The export manifest: ONE document that tells the worker how to assemble the film, so the worker needs no project data, no
 * API disk and no model. The timeline (integer frames), the subtitle cues, the sound-effect cues and the audio files all
 * come from the same code that drives the preview. Audio is copied once into the uploads bucket under its content hash.
 */
export type ExportManifest = {
  schema: 1; assembler: number; projectId: string; aspect: Aspect; width: number; height: number; fps: number; totalFrames: number; watermark: boolean;
  scenes: { index: number; variantId: string; sig: string; clipKey: string | null; frames: number; startFrame: number; voice: { key: string; seconds: number } | null }[];
  music: { key: string } | null;
  voiceOn: boolean; subtitles: PlateSubtitles;
  cues: { scene: number; start: number; end: number; text: string }[];
  sfx: { scene: number; name: PlateSfxCue["name"]; offset: number; volume: number; mediaStart?: number }[];
};

export class NotDrawn extends Error {
  state: "drawing" | "missing" | "failed";
  constructor(message: string, state: "drawing" | "missing" | "failed") { super(message); this.state = state; }
}

const audioKey = (projectId: string, bytes: Buffer, file: string) => `plates/${projectId}/audio/${createHash("sha256").update(bytes).digest("hex").slice(0, 20)}${extname(file) || ".mp3"}`;

async function stageAudio(projectId: string, file: string | undefined): Promise<string | null> {
  if (!file) return null;
  const bytes = await readMedia(join(planAudioDir(projectId), file));
  if (!bytes) return null;
  const key = audioKey(projectId, bytes, file);
  if ((await objectSize("uploads", key)) !== bytes.length) await putObject("uploads", key, bytes, extname(file) === ".wav" ? "audio/wav" : "audio/mpeg");
  return key;
}

/** Builds (and stores) the manifest for one ratio. Throws NotDrawn while any scene of that ratio is not drawn. */
export async function buildExport(project: VideoProject, aspect: Aspect, watermark: boolean, options: { pending?: boolean } = {}): Promise<{ manifest: ExportManifest; manifestKey: string; signature: string; durationSeconds: number }> {
  const beats = project.brief?.scriptBeats ?? [];
  const variants = (await listVariants(project.id)).filter((v) => v.aspect === aspect);
  const byIndex = new Map(variants.map((v) => [v.scene_index, v]));
  const ordered = beats.map((_, i) => byIndex.get(i));
  if (!beats.length || ordered.some((v) => !v)) throw new NotDrawn("This ratio has not been drawn yet.", "missing");
  if (ordered.some((v) => v!.state === "failed")) throw new NotDrawn("A scene of this ratio could not be drawn.", "failed");
  // The billed final render may start while scenes are still being drawn: the worker resolves each clip when it is drawn.
  if (!options.pending && ordered.some((v) => v!.state !== "drawn" || !v!.clip_key)) throw new NotDrawn("This ratio is still being drawn.", "drawing");

  const state = await readProjectState(project.id);
  const subtitles = { ...defaultSubtitlesFor(project), ...(state.subtitles ?? {}) };
  const takes = beats.map((_, i) => takeFor(project, i));
  const timeline = buildTimeline(ordered.map((v) => v!.frames), takes.map((t) => t?.seconds));
  const startsSec = timeline.starts.map((f) => f / FPS), durSec = timeline.frames.map((f) => f / FPS);
  const cues = buildSubtitleCues(ordered.map((v, i) => ({ index: i, keyword: v!.keyword, state: "drawn" as const, seconds: durSec[i]!, frames: timeline.frames[i]!, sig: v!.signature })), beats, durSec, startsSec, subtitles.mode);
  const planBeats = project.beatPlan?.beats ?? [];
  const sfx: ExportManifest["sfx"] = [];
  beats.forEach((beat, i) => {
    const plan = planBeats[i];
    const sceneCues = [
      ...(subtitles.sfx !== false ? sceneSfxCues({ role: plan?.role, sfx: plan?.sfx, keyword: beat.keyword ?? plan?.keyword, visual: beat.visual, line: beat.line ?? plan?.line, transition_out: plan?.transition_out }, takes[i]?.words, durSec[i]!, i) : []),
      ...(subtitles.transitions === true ? sceneTransitionCues(durSec[i]!, i, beats.length) : [])
    ];
    for (const cue of sceneCues) sfx.push({ scene: i, name: cue.name, offset: cue.offset, volume: cue.volume, ...(cue.mediaStart ? { mediaStart: cue.mediaStart } : {}) });
  });

  const size = sizeForAspect(aspect);
  const voiceKeys = subtitles.voice !== false ? await Promise.all(takes.map((t) => stageAudio(project.id, t?.file))) : takes.map(() => null);
  const musicKey = subtitles.music !== false ? await stageAudio(project.id, project.planAudio?.music?.file) : null;
  const manifest: ExportManifest = {
    schema: 1, assembler: ASSEMBLER_VERSION, projectId: project.id, aspect, width: size.w, height: size.h, fps: FPS, totalFrames: timeline.totalFrames, watermark,
    scenes: ordered.map((v, i) => ({ index: i, variantId: v!.id, sig: v!.signature, clipKey: v!.clip_key ?? null, frames: timeline.frames[i]!, startFrame: timeline.starts[i]!, voice: voiceKeys[i] ? { key: voiceKeys[i]!, seconds: takes[i]!.seconds ?? 0 } : null })),
    music: musicKey ? { key: musicKey } : null, voiceOn: subtitles.voice !== false, subtitles, cues, sfx
  };
  const signature = exportSignature({
    aspect, clips: ordered.map((v) => ({ sig: v!.signature, clipKey: v!.clip_key ?? "pending" })), timelineFrames: timeline.frames, subtitles,
    audio: { voice: manifest.scenes.map((s) => s.voice?.key ?? null), music: musicKey, voiceOn: manifest.voiceOn }, cues: { cues, sfx }, watermark
  });
  const manifestKey = `plates/${project.id}/exports/${signature.replace(/[^a-z0-9]/gi, "_")}/manifest.json`;
  await putObject("uploads", manifestKey, JSON.stringify(manifest), "application/json");
  return { manifest, manifestKey, signature, durationSeconds: Math.round((timeline.totalFrames / FPS) * 10) / 10 };
}

export type ExportRow = { id: string; project_id: string; aspect: Aspect; signature: string; state: "queued" | "assembling" | "ready" | "failed"; stage: string | null; progress: number; manifest_key: string; output_key: string | null; duration_seconds: string | null; error: { message: string } | null; updated_at: Date; enqueued_at: Date | null };

/**
 * Companion export of one ratio. Idempotent: the same film (same signature) returns the same row; a finished one is served as
 * is, a failed one is queued again, the queue message commits with the row.
 */
export async function requestExport(project: VideoProject, aspect: Aspect, watermark: boolean): Promise<ExportRow> {
  const built = await buildExport(project, aspect, watermark);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<ExportRow>(
      `insert into app.plate_exports (project_id, aspect, signature, manifest_key, duration_seconds) values ($1, $2, $3, $4, $5)
       on conflict (project_id, aspect, signature) do nothing returning *`,
      [project.id, aspect, built.signature, built.manifestKey, built.durationSeconds]
    );
    let row = inserted.rows[0];
    if (!row) {
      row = (await client.query<ExportRow>("select * from app.plate_exports where project_id = $1 and aspect = $2 and signature = $3 for update", [project.id, aspect, built.signature])).rows[0]!;
      if (row.state === "failed") row = (await client.query<ExportRow>("update app.plate_exports set state = 'queued', error = null, stage = null, progress = 0, updated_at = now() where id = $1 returning *", [row.id])).rows[0]!;
      else if (row.state === "ready" || row.state === "assembling" || (row.enqueued_at && Date.now() - row.enqueued_at.getTime() < 60_000)) { await client.query("commit"); return row; }
    }
    await client.query("update app.plate_exports set enqueued_at = now() where id = $1", [row.id]);
    await boss.send(QUEUES.plateExport, { exportId: row.id }, { db: { executeSql: (text: string, values?: unknown[]) => client.query(text, values) } });
    await client.query("commit");
    void kickWorkers(true);
    return row;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function currentExport(projectId: string, aspect: Aspect): Promise<ExportRow | null> {
  const { rows } = await pool.query<ExportRow>("select * from app.plate_exports where project_id = $1 and aspect = $2 order by created_at desc limit 1", [projectId, aspect]);
  return rows[0] ?? null;
}
export async function getExport(id: string): Promise<ExportRow | null> {
  const { rows } = await pool.query<ExportRow>("select * from app.plate_exports where id = $1", [id]);
  return rows[0] ?? null;
}
