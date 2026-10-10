import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getLook, type VideoProject, type PlanVisuals, type VisualAsset } from "@videosaas/contracts";
import { config } from "../config.ts";
import { query } from "../db/database.ts";
import { boss, QUEUES } from "../jobs/queues.ts";
import { readMedia, saveMedia } from "../media.ts";
import { getProject, updateProjectVisuals } from "../projects/store.ts";
import { googleVisualProvider, validateVideo, VisualProviderTerminalError, type VisualProvider } from "./visual-provider.ts";
import { currentClips, digest, IMAGE_RESERVE, materialBeats, VIDEO_RESERVE, visualDir, visualFingerprint, visualStatus, totalReserved } from "./visual-state.ts";
import { projectLook } from "./preview.ts";
export { currentClips, visualStatus } from "./visual-state.ts";

export const VISUAL_LEASE_MS = 300_000;
export class VisualWorkerBusy extends Error {}
const pending = (v: PlanVisuals) => v.stylePending || Object.values(v.shots).some(s => s.pending);

export async function enqueueVisuals(id: string, budgetUsd: number, deps = dependencies) {
  if (!config.geminiApiKey) throw new Error("Material generation needs GEMINI_API_KEY on the backend.");
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > config.visualMaxBudgetUsd) throw new Error(`Choose a project reservation ceiling up to $${config.visualMaxBudgetUsd}.`);
  return deps.update(id, async p => {
    const status = visualStatus(p), existing = p.planVisuals;
    if (!status.required) throw new Error("This style does not need generated scenes.");
    if (["queued", "generating", "ready"].includes(status.status)) return existing;
    if (existing && [existing, ...(existing.history ?? [])].some(pending)) throw new Error("A provider submission was interrupted. Reconcile its operation/billing before restarting; automatic resubmission could charge twice.");
    if (existing?.worker && existing.worker.expiresAt > (deps.now ?? Date.now)()) throw new VisualWorkerBusy("Wait for the active generation worker to stop.");
    const previous = status.status === "failed" ? existing : undefined;
    if (Object.values(previous?.shots ?? {}).some(s => s.terminalError)) throw new Error("A provider operation failed permanently. Operator reconciliation is required before replacing it.");
    const remaining = materialBeats(p).reduce((n,b) => n + (previous?.shots[b.id]?.clip ? 0 : (previous?.shots[b.id]?.operation ? 0 : VIDEO_RESERVE) + (previous?.shots[b.id]?.keyframe ? 0 : IMAGE_RESERVE) + (p.brief?.look === "paper-cut" && !previous?.shots[b.id]?.assemblySheet ? IMAGE_RESERVE : 0)), previous?.styleKey ? 0 : IMAGE_RESERVE);
    if (totalReserved(existing) + remaining > budgetUsd + 0.001) throw new Error(`This project needs a cumulative reservation of $${(totalReserved(existing) + remaining).toFixed(2)}. Increase the ceiling.`);
    const look = getLook(p.brief?.look), runId = randomUUID();
    const { history: oldHistory, ...archived } = existing ?? {};
    const history = previous ? previous.history : [...(oldHistory ?? []), ...(existing ? [archived as Omit<PlanVisuals, "history">] : [])];
    const state: PlanVisuals = { ...previous, runId, fingerprint: visualFingerprint(p), look: look.id, recipeVersion: look.version, status: "queued", budgetUsd, reservedUsd: previous?.reservedUsd ?? 0,
      imageModel: previous?.imageModel ?? config.visualImageModel, videoModel: previous?.videoModel ?? config.visualVideoModel, shots: previous?.shots ?? {}, history, worker: undefined, error: undefined, updatedAt: new Date().toISOString() };
    await deps.enqueue(id, runId);
    return state;
  });
}

export type VisualDependencies = {
  get: (id: string) => Promise<VideoProject | null>;
  update: typeof updateProjectVisuals;
  read: typeof readMedia;
  save: typeof saveMedia;
  wait: (ms: number) => Promise<void>;
  palette: (p: VideoProject) => Promise<string>;
  enqueue: (id: string, runId: string) => Promise<unknown>;
  references: (names: string[]) => Promise<Buffer[]>;
  now?: () => number;
  signal?: AbortSignal;
};
const referencesDir = fileURLToPath(new URL("../../style-library/references/", import.meta.url));
const dependencies: VisualDependencies = {
  get: getProject, update: updateProjectVisuals, read: readMedia, save: saveMedia,
  wait: ms => new Promise(r => setTimeout(r, ms)), palette: async p => (await projectLook(p)).themeCss,
  references: names => Promise.all(names.map(name => readFile(join(referencesDir, name)).then(bytes => sharp(bytes).png().toBuffer()))),
  enqueue: (projectId, runId) => boss.send(QUEUES.visuals, { projectId, runId }, { db: { executeSql: (sql, values) => query(sql, values) } })
};

export async function produceVisuals(id: string, runId: string, provider?: VisualProvider, deps = dependencies) {
  const now = deps.now ?? Date.now, token = randomUUID();
  deps.signal?.throwIfAborted();
  const claimed = await deps.update(id, p => {
    const v = p.planVisuals;
    if (!v || v.runId !== runId || v.status === "ready") return v;
    if (v.worker && v.worker.expiresAt > now()) throw new VisualWorkerBusy("Material generation is already running.");
    return { ...v, worker: { token, expiresAt: now() + VISUAL_LEASE_MS } };
  });
  if (!claimed?.planVisuals || claimed.planVisuals.worker?.token !== token) return;
  const project = claimed;
  let state: PlanVisuals = claimed.planVisuals;
  const checkpoint = async (mutate: (v: PlanVisuals) => void, result = false) => {
    const saved = await deps.update(id, p => {
      if (p.planVisuals?.runId !== runId || p.planVisuals.worker?.token !== token) throw new VisualWorkerBusy("Material generation ownership changed.");
      // Persist accepted results even if an edit/queue cancellation happened in flight.
      // The next submission checkpoint will stop; the receipt remains reconcilable.
      if (!result) {
        deps.signal?.throwIfAborted();
        if (p.planVisuals.fingerprint !== visualFingerprint(p)) throw new Error("The storyboard changed during generation. Generate scenes for the updated storyboard.");
      }
      const v = structuredClone(p.planVisuals); mutate(v);
      v.worker = v.status === "ready" ? undefined : { token, expiresAt: now() + VISUAL_LEASE_MS };
      v.updatedAt = new Date().toISOString(); return v;
    });
    if (!saved?.planVisuals) throw new Error("Project no longer exists.");
    state = saved.planVisuals;
  };
  const reserve = (v: PlanVisuals, amount: number) => { if (totalReserved(v) + amount > v.budgetUsd + 0.001) throw new Error("Generation budget reached."); v.reservedUsd = Math.round((v.reservedUsd + amount) * 100) / 100; };
  const load = async (a: VisualAsset) => { const bytes = await deps.read(join(visualDir(id), a.file)); if (!bytes || digest(bytes) !== a.sha256) throw new Error("A saved material asset is missing or corrupt."); return bytes; };
  const save = async (bytes: Buffer, mime: VisualAsset["mime"]): Promise<VisualAsset> => {
    const sha256 = digest(bytes), file = `${sha256}.${mime === "image/png" ? "png" : "mp4"}`;
    const duration = mime === "video/mp4" ? await validateVideo(bytes) : undefined;
    await deps.save(join(visualDir(id), file), bytes); return { file, sha256, mime, ...(duration ? { duration } : {}) };
  };
  try {
    await checkpoint(v => { v.status = "generating"; v.error = undefined; });
    const api = provider ?? googleVisualProvider(state.imageModel, state.videoModel);
    const look = getLook(state.look), r = look.instructions;
    const aspect = project.beatPlan?.canvas === "9:16" ? "9:16" : "16:9";
    const palette = await deps.palette(project);
    const direction = `${r.image}\n${r.composition}\nAvoid: ${r.negative}\nBrand palette (use these colors, no lettering): ${palette}\nNo letters, words, watermarks, UI or logos. Leave negative space for native text overlays.${project.beatPlan?.canvas === "1:1" ? " All subjects must fit inside the centered square crop." : ""}`;
    if (!state.styleKey) {
      const refs = await deps.references(look.referenceAssets);
      await checkpoint(v => { if (v.stylePending) throw new Error("Style-key submission interrupted; reconcile provider billing before retrying."); reserve(v, IMAGE_RESERVE); v.stylePending = true; });
      const image = await api.image(`Create ONE finished film frame establishing the ${look.name} material world, not a mood board. Use references for material and craft only. Topic: ${project.brief?.productName ?? project.name}. ${direction}`, refs, aspect);
      const asset = await save(image, "image/png"); await checkpoint(v => { v.styleKey = asset; v.stylePending = false; }, true);
    }
    const style = await load(state.styleKey!);
    for (const beat of materialBeats(project)) {
      await checkpoint(v => { v.shots[beat.id] ??= { beatId: beat.id }; });
      if (state.shots[beat.id]!.clip) { await load(state.shots[beat.id]!.clip!); continue; }
      const scene = `Scene subject/action: ${beat.keyword}. ${beat.line ?? ""}. ${beat.generation?.keyframe_prompt ?? ""}. ${beat.kind === "ui" ? "Build a supporting material environment with empty center for a real product screenshot added later. Do not invent a screen." : "Show a concrete visual metaphor of the action, with foreground subject and complete environment."}`;
      if (!state.shots[beat.id]!.keyframe) {
        await checkpoint(v => { const s = v.shots[beat.id]!; if (s.pending) throw new Error("Image submission interrupted; reconcile provider billing before retrying."); reserve(v, IMAGE_RESERVE); s.pending = "image"; });
        const image = await api.image(`${r.image}\nMatch the attached style key exactly: materials, character construction, lighting and palette. ${scene}\n${direction}`, [style], aspect);
        const asset = await save(image, "image/png"); await checkpoint(v => { v.shots[beat.id]!.keyframe = asset; delete v.shots[beat.id]!.pending; }, true);
      }
      if (!state.shots[beat.id]!.operation) {
        const finalFrame = await load(state.shots[beat.id]!.keyframe!);
        if (look.id === "paper-cut" && !state.shots[beat.id]!.assemblySheet) {
          await checkpoint(v => { const s = v.shots[beat.id]!; if (s.pending) throw new Error("Assembly submission interrupted; reconcile provider billing before retrying."); reserve(v, IMAGE_RESERVE); s.pending = "assembly"; });
          const sheet = await api.image(`Create a 3 by 3 planning sheet of nine equally sized panels, no gutters, no labels or numbers. Match the attached finished paper scene exactly. Read left-to-right, top-to-bottom: 1 near-empty background; 2 background pieces; 3 ground; 4 environment; 5 background silhouettes; 6 props; 7 hero parts entering; 8 one action; 9 the exact completed reference scene. Pieces slide in from outside, far-to-near; keep paper texture and hard shadows throughout. ${direction}`, [finalFrame], aspect);
          const asset = await save(sheet, "image/png"); await checkpoint(v => { v.shots[beat.id]!.assemblySheet = asset; delete v.shots[beat.id]!.pending; }, true);
        }
        if (look.id === "paper-cut" && !state.shots[beat.id]!.startFrame) {
          const sheet = await load(state.shots[beat.id]!.assemblySheet!);
          const { width, height } = await sharp(sheet).metadata();
          if (!width || !height || width < 90 || height < 90) throw new Error("Assembly sheet is too small to contain nine usable panels.");
          const first = await sharp(sheet).extract({ left: 1, top: 1, width: Math.floor(width / 3) - 2, height: Math.floor(height / 3) - 2 }).resize(width, height).png().toBuffer();
          const asset = await save(first, "image/png"); await checkpoint(v => { v.shots[beat.id]!.startFrame = asset; }, true);
        }
        const image = state.shots[beat.id]!.startFrame ? await load(state.shots[beat.id]!.startFrame!) : finalFrame;
        await checkpoint(v => { const s = v.shots[beat.id]!; if (s.pending) throw new Error("Video submission interrupted; reconcile provider billing before retrying."); reserve(v, VIDEO_RESERVE); s.pending = "video"; });
        const operation = await api.submit(`${r.image}\n${scene}\nAnimate this exact material world. ${r.motion}\n${r.composition}\nMaintain identity, construction and palette. Continuous single shot; no cuts, no speech or lettering.${look.id === "paper-cut" ? " Assemble background, floor, environment, silhouettes, props, then hero parts into the supplied final frame. Never show a grid or planning sheet." : ""}`, image, aspect, r.negative, look.id === "paper-cut" ? finalFrame : undefined);
        await checkpoint(v => { v.shots[beat.id]!.operation = operation; delete v.shots[beat.id]!.pending; }, true);
      }
      if (state.shots[beat.id]!.terminalError) throw new Error(state.shots[beat.id]!.terminalError);
      let bytes: Buffer | null = null;
      for (let i = 0; i < 120; i++) {
        await checkpoint(() => {}); // stops promptly if the plan changed
        try { bytes = await api.poll(state.shots[beat.id]!.operation!); }
        catch (error) {
          if (error instanceof VisualProviderTerminalError) await checkpoint(v => { v.shots[beat.id]!.terminalError = error.message; }, true);
          throw error;
        }
        if (bytes) break;
        await deps.wait(10_000);
      }
      if (!bytes) throw new Error("Video is still processing. Retry resumes the saved operation without another charge.");
      const asset = await save(bytes, "video/mp4"); await checkpoint(v => { v.shots[beat.id]!.clip = asset; }, true);
    }
    await checkpoint(v => { v.status = "ready"; });
  } catch (error) {
    // Keep paid submissions and reservations even on failure; never blindly submit again.
    await deps.update(id, p => p.planVisuals?.runId === runId && p.planVisuals.worker?.token === token ? { ...p.planVisuals, worker: undefined, status: "failed", error: error instanceof Error ? error.message : "Material generation failed.", updatedAt: new Date().toISOString() } : p.planVisuals);
    throw error;
  }
}
export async function startVisualConsumers() {
  await boss.work<{ projectId: string; runId: string }>(QUEUES.visuals, { batchSize: 1 }, async jobs => { for (const job of jobs) await produceVisuals(job.data.projectId, job.data.runId, undefined, { ...dependencies, signal: job.signal }); });
  await boss.work<{ projectId: string; runId: string }>(QUEUES.visualsDead, { batchSize: 1 }, async jobs => {
    for (const { data } of jobs) await updateProjectVisuals(data.projectId, p => p.planVisuals?.runId === data.runId && p.planVisuals.status !== "ready" && (!p.planVisuals.worker || p.planVisuals.worker.expiresAt <= Date.now()) ? { ...p.planVisuals, worker: undefined, status: "failed", error: p.planVisuals.error ?? "Generation worker interrupted. Retry to resume saved operations." } : p.planVisuals);
  });
}
