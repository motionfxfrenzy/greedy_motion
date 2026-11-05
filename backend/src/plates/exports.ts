import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { engineDigest as computeEngineDigest } from "@videosaas/plate-engine";
import type { VideoProject } from "@videosaas/contracts";
import { pool } from "../db/database.ts";
import { boss, QUEUES } from "../jobs/queues.ts";
import { kickPlateWorkers } from "../jobs/worker-launcher.ts";
import { readMedia } from "../media.ts";
import { planAudioDir } from "../plan/audio.ts";
import { objectSize, putObject } from "../storage.ts";
import { bundleDigest, canonicalJson, fontSetDigest, paramsDigest } from "./digest.ts";
import {
  ASSEMBLER_VERSION, FPS, buildSubtitleCues, buildTimeline, defaultSubtitlesFor, exportSignature, sceneSfxCues, sceneTransitionCues, sizeForAspect, takeFor,
  type Aspect, type PlateSfxCue, type PlateSubtitles
} from "./model.ts";
import { getRevision, listVariants, readProjectState, type VariantRow } from "./store.ts";

/**
 * Legacy schema 1 export manifest (kept readable by the worker so any job already in flight drains cleanly).
 */
export type ExportManifestV1 = {
  schema: 1; assembler: number; projectId: string; aspect: Aspect; width: number; height: number; fps: number; totalFrames: number; watermark: boolean;
  scenes: { index: number; variantId: string; sig: string; clipKey: string | null; frames: number; startFrame: number; voice: { key: string; seconds: number } | null }[];
  music: { key: string } | null;
  voiceOn: boolean; subtitles: PlateSubtitles;
  cues: { scene: number; start: number; end: number; text: string }[];
  sfx: { scene: number; name: PlateSfxCue["name"]; offset: number; volume: number; mediaStart?: number }[];
};

export type FrozenSceneEntry = {
  index: number;
  variantId: string;
  gen: number;
  rev: number;
  sig: string;
  bundleDigest: string;
  bundleKey: string;
  bundleSha: string;
  paramsDigest: string;
  params: Record<string, unknown>;
  frames: number;
  bundleFrames: number;
  startFrame: number;
  clipKey: string | null;
  voice: { key: string; digest: string; seconds: number } | null;
};

/**
 * The frozen export manifest (schema 2): ONE immutable document that pins the exact revisions the user previewed
 * (`variantId`, `gen`, `rev`, `bundleDigest`, `bundleKey`, `paramsDigest`, `params`, frames, startFrame), audio keys
 * with their SHA-256 digests, subtitle settings, cues, sound effects, aspect, size, fps, watermark, `engineDigest`,
 * `fontSetDigest`, and the film signature. Stored immutably under a content-addressed key (SHA-256 of canonical JSON).
 */
export type ExportManifest = {
  schema: 2;
  assembler: number;
  projectId: string;
  aspect: Aspect;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  watermark: boolean;
  engineDigest: string;
  fontSetDigest: string;
  signature: string;
  timing: { frames: number[]; starts: number[]; totalFrames: number };
  scenes: FrozenSceneEntry[];
  music: { key: string; digest: string } | null;
  voiceOn: boolean;
  subtitles: PlateSubtitles;
  cues: { scene: number; start: number; end: number; text: string }[];
  sfx: { scene: number; name: PlateSfxCue["name"]; offset: number; volume: number; mediaStart?: number }[];
};

export class NotDrawn extends Error {
  state: "drawing" | "missing" | "failed";
  code: string;
  sceneIndex?: number;
  constructor(message: string, state: "drawing" | "missing" | "failed", extra?: { code?: string; sceneIndex?: number }) {
    super(message);
    this.state = state;
    this.code = extra?.code ?? (state === "failed" ? "author_failed" : state);
    if (extra?.sceneIndex !== undefined) this.sceneIndex = extra.sceneIndex;
  }
}

const sha256Hex = (input: string | Buffer): string => createHash("sha256").update(input).digest("hex");

export type ExportStorage = {
  objectSize: typeof objectSize;
  putObject: typeof putObject;
};

const defaultStorage: ExportStorage = { objectSize, putObject };

async function stageAudio(projectId: string, file: string | undefined, storage: ExportStorage = defaultStorage): Promise<{ key: string; digest: string } | null> {
  if (!file) return null;
  const bytes = await readMedia(join(planAudioDir(projectId), file));
  if (!bytes) return null;
  const digest = sha256Hex(bytes);
  const key = `plates/${projectId}/audio/${digest.slice(0, 20)}${extname(file) || ".mp3"}`;
  if ((await storage.objectSize("uploads", key)) !== bytes.length) {
    await storage.putObject("uploads", key, bytes, extname(file) === ".wav" ? "audio/wav" : "audio/mpeg");
  }
  return { key, digest };
}

function formatFailedSceneMessage(v: VariantRow): string {
  const label = v.keyword ? `Scene ${v.scene_index + 1} (${v.keyword})` : `Scene ${v.scene_index + 1}`;
  const detail = v.error?.message ?? "could not be authored.";
  return detail.toLowerCase().includes(`scene ${v.scene_index + 1}`) ? detail : `${label}: ${detail}`;
}

/**
 * Waits (bounded) for any in-progress scene authoring (`queued` or `authoring`) of `aspect` to finish before freezing
 * the manifest. Reports progress via `onProgress`. If any scene fails authoring or exhausts its repair budget, throws
 * `NotDrawn` naming the scene so the caller fails the render without charge.
 */
export async function waitForAuthoring(
  projectId: string,
  aspect: Aspect,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    expectedScenes?: number;
    onProgress?: (info: { done: number; total: number }) => Promise<void> | void;
  } = {}
): Promise<VariantRow[]> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const pollMs = options.pollMs ?? 500;
  const started = Date.now();
  let lastDone = -1;

  for (;;) {
    const all = (await listVariants(projectId)).filter((v) => v.aspect === aspect).sort((a, b) => a.scene_index - b.scene_index);
    const total = options.expectedScenes ?? all.length;
    if (!total || all.length < total) {
      throw new NotDrawn("This ratio has not been drawn yet.", "missing");
    }

    const failed = all.find((v) => v.state === "failed");
    if (failed) {
      throw new NotDrawn(formatFailedSceneMessage(failed), "failed", {
        code: failed.error?.code ?? "author_failed",
        sceneIndex: failed.scene_index
      });
    }

    const readyCount = all.filter((v) => v.state !== "queued" && v.state !== "authoring" && Boolean(v.bundle_key)).length;
    if (readyCount === all.length) {
      return all;
    }

    if (readyCount !== lastDone) {
      lastDone = readyCount;
      await options.onProgress?.({ done: readyCount, total: all.length });
    }

    if (Date.now() - started >= timeoutMs) {
      const pending = all.find((v) => v.state === "queued" || v.state === "authoring" || !v.bundle_key) ?? all[0]!;
      const label = pending.keyword ? `Scene ${pending.scene_index + 1} (${pending.keyword})` : `Scene ${pending.scene_index + 1}`;
      throw new NotDrawn(`${label} timed out while being authored.`, "failed", {
        code: "author_timeout",
        sceneIndex: pending.scene_index
      });
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Freezes and stores the schema 2 export manifest for one ratio under a content-addressed key.
 * Never mutates an already-stored manifest.
 */
export async function buildExport(
  project: VideoProject,
  aspect: Aspect,
  watermark: boolean,
  options: { pending?: boolean; storage?: ExportStorage } = {}
): Promise<{ manifest: ExportManifest; manifestKey: string; manifestDigest: string; signature: string; durationSeconds: number }> {
  const storage = options.storage ?? defaultStorage;
  const beats = project.brief?.scriptBeats ?? [];
  const variants = (await listVariants(project.id)).filter((v) => v.aspect === aspect);
  const byIndex = new Map(variants.map((v) => [v.scene_index, v]));
  const ordered = beats.map((_, i) => byIndex.get(i));
  if (!beats.length || ordered.some((v) => !v)) throw new NotDrawn("This ratio has not been drawn yet.", "missing");
  const failed = ordered.find((v) => v!.state === "failed");
  if (failed) {
    throw new NotDrawn(formatFailedSceneMessage(failed), "failed", {
      code: failed.error?.code ?? "author_failed",
      sceneIndex: failed.scene_index
    });
  }
  if (ordered.some((v) => v!.state === "queued" || v!.state === "authoring" || !v!.bundle_key)) {
    throw new NotDrawn("This ratio is still being drawn.", "drawing");
  }

  const state = await readProjectState(project.id);
  const subtitles = { ...defaultSubtitlesFor(project), ...(state.subtitles ?? {}) };
  const takes = beats.map((_, i) => takeFor(project, i));
  const timeline = buildTimeline(ordered.map((v) => v!.frames), takes.map((t) => t?.seconds));
  const startsSec = timeline.starts.map((f) => f / FPS), durSec = timeline.frames.map((f) => f / FPS);
  const cues = buildSubtitleCues(
    ordered.map((v, i) => ({ index: i, keyword: v!.keyword, state: "drawn" as const, seconds: durSec[i]!, frames: timeline.frames[i]!, sig: v!.signature })),
    beats,
    durSec,
    startsSec,
    subtitles.mode
  );
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
  const stagedVoices = subtitles.voice !== false ? await Promise.all(takes.map((t) => stageAudio(project.id, t?.file, storage))) : takes.map(() => null);
  const stagedMusic = subtitles.music !== false ? await stageAudio(project.id, project.planAudio?.music?.file, storage) : null;

  const revisions = await Promise.all(ordered.map((v) => getRevision(v!.id, v!.rev)));
  const resolvedFontSetDigest = fontSetDigest();
  const firstManifestEngine = ordered.map((v) => (typeof v!.bundle_manifest?.engineDigest === "string" ? v!.bundle_manifest.engineDigest : null)).find(Boolean);
  const resolvedEngineDigest = firstManifestEngine ?? computeEngineDigest();

  const scenes: FrozenSceneEntry[] = ordered.map((v, i) => {
    const row = v!;
    const revRow = revisions[i];
    const params = revRow?.params ?? (row.repairs > 0 ? { __repair: row.repairs } : {});
    const pDigest = revRow?.params_digest ?? paramsDigest(params);
    const bKey = revRow?.bundle_key ?? row.bundle_key!;
    const bundleSha = typeof row.bundle_manifest?.bundleSha === "string" ? row.bundle_manifest.bundleSha : "";
    const rowEngineDigest = typeof row.bundle_manifest?.engineDigest === "string" ? row.bundle_manifest.engineDigest : resolvedEngineDigest;
    const bDigest =
      row.bundle_digest ??
      revRow?.bundle_digest ??
      bundleDigest({ manifest: row.bundle_manifest, bundleSha, params, engineDigest: rowEngineDigest, fontSetDigest: resolvedFontSetDigest });
    const bundleFrames = typeof row.bundle_manifest?.frames === "number" ? Number(row.bundle_manifest.frames) : row.frames;
    const voice = stagedVoices[i]
      ? { key: stagedVoices[i]!.key, digest: stagedVoices[i]!.digest, seconds: takes[i]!.seconds ?? 0 }
      : null;

    return {
      index: i,
      variantId: row.id,
      gen: row.gen,
      rev: row.rev,
      sig: row.signature,
      bundleDigest: bDigest,
      bundleKey: bKey,
      bundleSha,
      paramsDigest: pDigest,
      params,
      frames: timeline.frames[i]!,
      bundleFrames,
      startFrame: timeline.starts[i]!,
      clipKey: row.clip_key ?? null,
      voice
    };
  });

  const signature = exportSignature({
    aspect,
    clips: scenes.map((s) => ({ sig: s.sig, clipKey: `${s.bundleDigest}:${s.paramsDigest}` })),
    timelineFrames: timeline.frames,
    subtitles,
    audio: {
      voice: scenes.map((s) => (s.voice ? `${s.voice.key}:${s.voice.digest}` : null)),
      music: stagedMusic ? `${stagedMusic.key}:${stagedMusic.digest}` : null,
      voiceOn: subtitles.voice !== false,
      engineDigest: resolvedEngineDigest,
      fontSetDigest: resolvedFontSetDigest
    },
    cues: { cues, sfx },
    watermark
  });

  const manifest: ExportManifest = {
    schema: 2,
    assembler: ASSEMBLER_VERSION,
    projectId: project.id,
    aspect,
    width: size.w,
    height: size.h,
    fps: FPS,
    totalFrames: timeline.totalFrames,
    watermark,
    engineDigest: resolvedEngineDigest,
    fontSetDigest: resolvedFontSetDigest,
    signature,
    timing: {
      frames: timeline.frames,
      starts: timeline.starts,
      totalFrames: timeline.totalFrames
    },
    scenes,
    music: stagedMusic ? { key: stagedMusic.key, digest: stagedMusic.digest } : null,
    voiceOn: subtitles.voice !== false,
    subtitles,
    cues,
    sfx
  };

  const canonical = canonicalJson(manifest);
  const canonicalBytes = Buffer.from(canonical, "utf8");
  const manifestDigest = sha256Hex(canonicalBytes);
  const manifestKey = `plates/${project.id}/manifests/${manifestDigest}/manifest.json`;
  if ((await storage.objectSize("uploads", manifestKey)) !== canonicalBytes.length) {
    await storage.putObject("uploads", manifestKey, canonicalBytes, "application/json");
  }
  return {
    manifest,
    manifestKey,
    manifestDigest,
    signature,
    durationSeconds: Math.round((timeline.totalFrames / FPS) * 10) / 10
  };
}

export type ExportRow = { id: string; project_id: string; aspect: Aspect; signature: string; state: "queued" | "assembling" | "ready" | "failed"; stage: string | null; progress: number; manifest_key: string; output_key: string | null; duration_seconds: string | null; error: { message: string } | null; updated_at: Date; enqueued_at: Date | null };

/**
 * Companion export of one ratio. Idempotent: the same film (same signature) returns the same row; a finished one is served as
 * is, a failed one is queued again, the queue message commits with the row. Never calls `requestDraws` or enqueues `plate-render`:
 * the worker verifies and draws any missing clips directly from the frozen manifest.
 */
export async function requestExport(project: VideoProject, aspect: Aspect, watermark: boolean, options?: { storage?: ExportStorage }): Promise<ExportRow> {
  const built = await buildExport(project, aspect, watermark, options);
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
      if (row.state === "failed") row = (await client.query<ExportRow>("update app.plate_exports set state = 'queued', error = null, stage = null, progress = 0, manifest_key = $2, updated_at = now() where id = $1 returning *", [row.id, built.manifestKey])).rows[0]!;
      else if (row.state === "ready" || row.state === "assembling" || (row.enqueued_at && Date.now() - row.enqueued_at.getTime() < 60_000)) { await client.query("commit"); return row; }
    }
    await client.query("update app.plate_exports set enqueued_at = now() where id = $1", [row.id]);
    await boss.send(QUEUES.plateExport, { exportId: row.id }, { db: { executeSql: (text: string, values?: unknown[]) => client.query(text, values) } });
    await client.query("commit");
    void kickPlateWorkers();
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
