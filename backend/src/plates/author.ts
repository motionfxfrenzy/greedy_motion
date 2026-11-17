import { templatePack, withPackKit } from "../plan/template-packs.ts";
import { filmPropsFor } from "./film-props.ts";
import type { Job } from "pg-boss";
import { bundleScene, plateNameOf } from "@videosaas/plate-engine";
import { callModel, ladder, supportsPromptCacheGate, type ModelMessage } from "../models/providers.ts";
import { routeFor } from "../models/routes.ts";
import { config } from "../config.ts";
import { QUEUES, sendOnce } from "../jobs/queues.ts";
import { getProject } from "../projects/store.ts";
import { getObject, putObject, type Bucket } from "../storage.ts";
import { desiredVariants, isPlateLook } from "./inputs.ts";
import { isComputedVariantSignature, primaryAspect, takeFor } from "./model.ts";
import { plateCacheGate } from "./cache-gate.ts";
import { POLICY_REPAIR_MAX, buildAuthorMessages, checkScene, moduleFrom } from "./prompt.ts";
import { ASSET_WAIT_MS, MAX_CHECK_RETRIES, checkFailureRetryable, ensurePackAssets, packAssetsInput, readAssetIndex, sceneAssetState, scenePictures, wireSceneAssets } from "./pack-assets.ts";
import { objectSize } from "../storage.ts";
import { FPS } from "./model.ts";
import { bundleKeyFor, claimAuthor, commitBundle, failVariant, getVariant, isVariantCompatibleWithDesired, manifestKeyFor, newOwner, noteAuthorCall, noteAuthorProgress, noteModelStart, primarySource, releaseAuthor, renewAuthor, saveDraft, sourceKeyFor, type AuthorProgressPatch } from "./store.ts";

/**
 * Authoring consumer (`plate-author`): turns one variant into an immutable source + self-contained bundle in object storage and
 * hands it to the worker queue. The model request and the bundling run with NO database transaction open.
 *
 * Failure categories (never mixed):
 *  - the model's module is invalid or does not bundle  -> a repair call, within one budget (PLATE_MAX_AUTHOR_CALLS);
 *  - the model service or storage fails                 -> the same row is retried by pg-boss; the repair budget is untouched;
 *  - the budget is used up                              -> the variant fails with the last error in words.
 */
export const LEASE_SECONDS = 60;
export const MAX_AUTHOR_MODEL_STARTS = config.plates.maxModelStartsPerGen;
const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));

const CUT_OFF_MESSAGE = "CUT OFF: the module was longer than the output limit. Write a MUCH MORE COMPACT module (under 200 lines): fewer, simpler elements, reuse small helper functions, loops instead of repeated calls.";
const CUTOFF_MAX_TOKENS = 128_000;

// Active in-flight author controllers aborted on SIGTERM/SIGINT so an in-flight Anthropic stream is cancelled immediately on shutdown.
const activeAuthorControllers = new Set<{ abort: () => void; release: () => Promise<void> }>();
export async function abortActiveAuthorsForShutdown(): Promise<void> {
  const entries = [...activeAuthorControllers];
  activeAuthorControllers.clear();
  for (const e of entries) e.abort();
  await Promise.allSettled(entries.map((e) => e.release()));
}
process.on("SIGTERM", () => { void abortActiveAuthorsForShutdown(); });
process.on("SIGINT", () => { void abortActiveAuthorsForShutdown(); });
/** A few quick retries of one storage call, so a blip does not even reach the queue's retry. */
async function retrying<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (error) { if (attempt >= tries) throw error; await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1))); }
  }
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export type ContentAddressedStorage = {
  getObject: (bucket: Bucket, key: string) => Promise<Buffer | null>;
  putObject: (bucket: Bucket, key: string, body: Buffer | string, contentType?: string) => Promise<void>;
};

const defaultContentStorage: ContentAddressedStorage = { getObject, putObject };

/**
 * Writes an object under a content-addressed key without ever overwriting an existing object with different bytes.
 * If the key already exists with identical bytes, reuses it without calling `putObject`.
 * If the key already exists with different bytes, throws a permanent `content_address_collision` error.
 */
export async function putContentAddressedObject(
  bucket: Bucket,
  key: string,
  body: Buffer | string,
  contentType: string,
  storage: ContentAddressedStorage = defaultContentStorage
): Promise<{ reused: boolean; size: number }> {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const existing = await storage.getObject(bucket, key);
  if (existing !== null) {
    if (Buffer.compare(existing, bytes) === 0) {
      return { reused: true, size: bytes.length };
    }
    throw Object.assign(
      new Error(`Refusing to overwrite existing content-addressed key "${key}" with different bytes.`),
      { code: "content_address_collision" }
    );
  }
  await storage.putObject(bucket, key, bytes, contentType);
  return { reused: false, size: bytes.length };
}

export const AUTHOR_PROGRESS_THROTTLE_MS = 2000;

/**
 * Throttles live authoring progress writes to at most one per `intervalMs` (default 2000 ms) plus one final write on `flush()`.
 * Accepts an injectable `now` clock for deterministic testing and never throws into the caller.
 */
export function createProgressThrottle(options: {
  write: (p: AuthorProgressPatch) => unknown;
  now?: () => number;
  intervalMs?: number;
  authorStartedAt?: number;
}) {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? AUTHOR_PROGRESS_THROTTLE_MS;
  let lastWriteAt = -Infinity;
  let latest: { chars: number; lines: number; tokens: number } = { chars: 0, lines: 0, tokens: 0 };
  let lastWritten: { chars: number; lines: number; tokens: number } | null = null;
  let pendingStart = options.authorStartedAt;

  const fire = (p: { chars: number; lines: number; tokens: number }, at: number): Promise<void> => {
    lastWriteAt = at;
    lastWritten = { chars: p.chars, lines: p.lines, tokens: p.tokens };
    const patch: AuthorProgressPatch = {
      chars: p.chars,
      lines: p.lines,
      tokens: p.tokens,
      progressAt: at,
      ...(pendingStart !== undefined ? { authorStartedAt: pendingStart } : {})
    };
    pendingStart = undefined;
    try {
      return Promise.resolve(options.write(patch)).then(() => undefined, () => undefined);
    } catch {
      return Promise.resolve(undefined);
    }
  };

  return {
    reset() {
      const at = now();
      latest = { chars: 0, lines: 0, tokens: 0 };
      return fire(latest, at);
    },
    onProgress(p: { chars: number; lines: number; tokens: number }) {
      latest = { chars: p.chars, lines: p.lines, tokens: p.tokens };
      const at = now();
      if (at - lastWriteAt >= intervalMs) {
        void fire(latest, at);
      }
    },
    flush() {
      const at = now();
      if (
        !lastWritten ||
        lastWritten.chars !== latest.chars ||
        lastWritten.lines !== latest.lines ||
        lastWritten.tokens !== latest.tokens ||
        pendingStart !== undefined
      ) {
        return fire(latest, at);
      }
      return Promise.resolve(undefined);
    }
  };
}

/**
 * The scene module a template writes itself (TemplatePack.sceneCode) for one beat, or undefined when the template's scenes are
 * written by the model. Authoring uses it in place of a model call (no model start, no author call counted).
 */
export function packSceneModule(project: Parameters<typeof packAssetsInput>[0], pack: ReturnType<typeof templatePack>, sceneIndex: number, frames: number, assetNames: string[]): string | undefined {
  if (!pack?.sceneCode) return undefined;
  return pack.sceneCode({
    ...packAssetsInput(project),
    beatIndex: sceneIndex,
    frames,
    fps: FPS,
    beatWords: (takeFor(project, sceneIndex)?.words ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end })),
    assetNames
  });
}

export type AuthorMessage = { variantId: string; gen: number; /** How many times this scene has waited for its template pictures. */ pictureWaits?: number };

/** Seconds between looks while a scene waits for its template's pictures (pack-assets.ts). */
export const PICTURE_WAIT_SECONDS = 5;
const failedPicturesGraceMs = 3 * 60 * 1000;

export async function handleAuthor(job: Job<AuthorMessage>) {
  const { variantId, gen } = job.data ?? ({} as AuthorMessage);
  if (typeof variantId !== "string" || !Number.isInteger(gen)) return;
  const owner = newOwner();
  const row = await claimAuthor(variantId, gen, owner, LEASE_SECONDS, config.plates.projectAuthorCap);
  if (!row) {
    // Held by a live owner or at the project cap: re-enqueue AFTER this pg-boss handler returns (so the active singletonKey is released first).
    const current = await getVariant(variantId);
    if (current && current.gen === gen && (current.state === "queued" || (current.state === "authoring" && current.author_until && current.author_until < new Date(Date.now() + 5_000)))) {
      await sendOnce(null, QUEUES.plateAuthor, { variantId, gen }, `${variantId}:${gen}`, { startAfter: 4 });
      setTimeout(() => {
        void sendOnce(null, QUEUES.plateAuthor, { variantId, gen }, `${variantId}:${gen}`, { startAfter: 2 }).catch(() => undefined);
      }, 600).unref?.();
    }
    return;
  }
  const started = Date.now();
  const lost = new AbortController();
  const shutdownCtrl = new AbortController();
  const signals = [lost.signal, shutdownCtrl.signal, ...(job.signal ? [job.signal] : [])];
  const signal = AbortSignal.any(signals);
  const shutdownEntry = {
    abort: () => shutdownCtrl.abort(new Error("process_shutdown")),
    release: () => releaseAuthor(row.id, row.gen, owner, "retrying").catch(() => undefined)
  };
  activeAuthorControllers.add(shutdownEntry);
  const lease = setInterval(() => { void renewAuthor(row.id, row.gen, owner, LEASE_SECONDS).then((ok) => { if (!ok) lost.abort(new Error("authoring superseded")); }).catch(() => undefined); }, Math.max(5_000, Math.floor((LEASE_SECONDS * 1000) / 3)));
  lease.unref();
  try {
    const project = await getProject(row.project_id);
    const look = project?.brief?.look;
    const beats = project?.brief?.scriptBeats ?? [];
    if (!project || !look || !beats[row.scene_index]) { await failVariant(row.id, row.gen, owner, { code: "project_changed", message: "The storyboard changed while this scene was waiting. Draw the scenes again." }); return; }
    if (isPlateLook(look) && isComputedVariantSignature(row.signature)) {
      const desired = await desiredVariants(project, [row.aspect]);
      const d = desired.find((item) => item.index === row.scene_index && item.aspect === row.aspect);
      if (!d || !isVariantCompatibleWithDesired(row, d)) {
        await failVariant(row.id, row.gen, owner, { code: "project_changed", message: "The storyboard changed while this scene was waiting. Draw the scenes again." });
        log("info", "plate_author_superseded_by_project_revision", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, gen: row.gen });
        return;
      }
    }

    // A template with pictures (TemplatePack.assets): the scene is bundled once its pictures exist (never waiting for depth maps).
    const pack = templatePack(project.brief?.styleExample);
    const pictures = scenePictures(project, pack, row.scene_index);
    if (pictures.names.length) {
      const state = await sceneAssetState(row.project_id, pictures.names, { getObject, putObject, objectSize });
      const waits = Number(job.data?.pictureWaits ?? 0);
      if (state.state === "failed") {
        // A step that failed only because the picture check could not run is run again (capped); wait for it instead of failing the scene.
        const failedIndex = await readAssetIndex(row.project_id, { getObject, putObject, objectSize }).catch(() => null);
        if (checkFailureRetryable(failedIndex) || (failedIndex?.checkFailures && Date.now() - Date.parse(failedIndex.updatedAt) <= 60_000 && failedIndex.checkFailures <= MAX_CHECK_RETRIES)) {
          if (checkFailureRetryable(failedIndex)) await ensurePackAssets(project, { retryFailed: false }).catch(() => undefined);
          await releaseAuthor(row.id, row.gen, owner, "waiting for pictures");
          setTimeout(() => {
            void sendOnce(null, QUEUES.plateAuthor, { variantId, gen, pictureWaits: waits + 1 }, `${variantId}:${gen}`, { startAfter: PICTURE_WAIT_SECONDS }).catch(() => undefined);
          }, 600).unref?.();
          return;
        }
        const index = await getObject("uploads", `plates/${row.project_id}/assets/index.json`).then((b) => (b ? JSON.parse(b.toString("utf8")) as { updatedAt?: string } : null)).catch(() => null);
        if (!index?.updatedAt || Date.now() - Date.parse(index.updatedAt) > failedPicturesGraceMs || waits * PICTURE_WAIT_SECONDS * 1000 > ASSET_WAIT_MS) {
          await failVariant(row.id, row.gen, owner, { code: "assets_failed", message: "The pictures for this scene could not be made. Press Draw to try again.", detail: state.message.slice(0, 800) });
          return;
        }
      }
      if (state.state === "wait" || state.state === "failed") {
        if (waits * PICTURE_WAIT_SECONDS * 1000 > ASSET_WAIT_MS) {
          await failVariant(row.id, row.gen, owner, { code: "assets_timeout", message: "The pictures for this scene took too long. Press Draw to try again.", detail: state.state === "wait" ? state.reason : state.message });
          return;
        }
        if (waits === 0) await ensurePackAssets(project, { retryFailed: false }).catch((error) => log("warn", "pack_assets_enqueue_failed", { projectId: row.project_id, message: message(error).slice(0, 200) }));
        await releaseAuthor(row.id, row.gen, owner, "waiting for pictures");
        setTimeout(() => {
          void sendOnce(null, QUEUES.plateAuthor, { variantId, gen, pictureWaits: waits + 1 }, `${variantId}:${gen}`, { startAfter: PICTURE_WAIT_SECONDS }).catch(() => undefined);
        }, 600).unref?.();
        return;
      }
    }

    // Other ratios follow the primary one's authored scene (same characters and palette), so they wait for it.
    const primary = primaryAspect(project);
    let reference: string | undefined;
    if (row.aspect !== primary) {
      const p = await primarySource(row.project_id, row.scene_index, primary);
      if (!p.ready) {
        await releaseAuthor(row.id, row.gen, owner, "waiting for the first ratio");
        await sendOnce(null, QUEUES.plateAuthor, { variantId, gen }, `${variantId}:${gen}`, { startAfter: 10 });
        return;
      }
      if (p.key) reference = (await getObject("uploads", p.key))?.toString("utf8");
    }
    let revise: { notes: string; code: string } | undefined;
    if (row.revise) {
      const code = row.revise.codeKey ? (await getObject("uploads", row.revise.codeKey))?.toString("utf8") : undefined;
      revise = { notes: row.revise.notes, code: code ?? "" };
    }

    // The film's recurring props: planned and drawn once for the whole film (plates/film-props.ts), read by every scene; null when none recur.
    const filmProps = pack?.filmProps ? await filmPropsFor(project, pack).catch((error) => { log("warn", "film_props_failed", { projectId: row.project_id, message: message(error).slice(0, 300) }); return null; }) : null;
    let lastError = row.repair?.error;
    let previous = row.repair?.previousKey ? (await getObject("uploads", row.repair.previousKey))?.toString("utf8") : undefined;
    let used = row.authored;
    let modelStarts = Number(row.timings?.modelStarts ?? 0);
    const maxStarts = config.plates.maxModelStartsPerGen;
    let draft = row.draft_source ?? undefined;
    // A pack that writes its own scene module (TemplatePack.sceneCode): no model call for this beat.
    const packCode = packSceneModule(project, pack, row.scene_index, row.frames, pictures.names);
    if (packCode) draft = packCode;
    let recordStartOnCall = !(typeof row.timings?.authorStartedAt === "number" && row.timings.authorStartedAt > 0);
    const plateName = plateNameOf(look)!;
    // Scene policy (style kit helpers, no letters drawn): one repair round per row at most, then the scene is accepted as written.
    let policyRepairs = 0;
    // Cut-off ladder (output limit hit): 0 = normal call; 1 = same model at the biggest limit; 2 = effort "high" at the biggest limit. Other errors keep the single repair.
    let cutOffs = 0;
    let cutOffLimit = 2;
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      if (!draft && used >= config.plates.maxAuthorCalls) {
        await failVariant(row.id, row.gen, owner, { code: "author_exhausted", message: `This scene could not be drawn after ${used} attempts. Press Draw to try again.`, detail: String(lastError ?? "").slice(0, 800) });
        log("warn", "plate_author_exhausted", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, calls: used });
        return;
      }
      const t0 = Date.now();
      let code: string;
      let reusedDraft = false;
      if (draft) {
        // A module an earlier attempt of this row already obtained (restart, bundling, storage or queue failed after the model answered): no new model call.
        code = draft;
        draft = undefined;
        reusedDraft = true;
      } else {
        if (modelStarts >= maxStarts) {
          await failVariant(row.id, row.gen, owner, {
            code: "author_max_starts",
            message: "Writing this scene was interrupted too many times. Press Draw to try again.",
            detail: `Model starts reached limit (${maxStarts}).`
          });
          log("warn", "plate_author_max_starts_reached", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, gen: row.gen, modelStarts });
          return;
        }
        try {
          const startedInfo = await noteModelStart(row.id, row.gen, owner);
          modelStarts = startedInfo.modelStarts;
          if (modelStarts > maxStarts) {
            await failVariant(row.id, row.gen, owner, {
              code: "author_max_starts",
              message: "Writing this scene was interrupted too many times. Press Draw to try again.",
              detail: `Model starts reached limit (${maxStarts}).`
            });
            return;
          }
          // Prompt-cache gate: the first scene of a film writes the cache; the others wait only until its stream starts (bounded, never rejects).
          // Per-step routing (MODEL_SCENE_WRITER / MODEL_SCENE_REPAIR) or immutable per-variant tier route snapshot:
          // when a variant carries a frozen routeSnapshot (Standard gemini-3.8-flash vs Premium claude-opus-5-5), use it without reading global process.env.
          const step: "sceneRepair" | "sceneWriter" = lastError ? "sceneRepair" : "sceneWriter";
          const routeSnap = row.timings?.routeSnapshot;
          const baseRoute =
            routeSnap && (lastError ? routeSnap.repair : routeSnap.writer)
              ? { ...(lastError ? routeSnap.repair : routeSnap.writer), step }
              : routeFor(step);
          const tiers = ladder(baseRoute);
          cutOffLimit = tiers.length - 1;
          const tierRoute = tiers[Math.min(cutOffs, cutOffLimit)]!;
          const request = await buildAuthorMessages({
            look,
            plateName,
            film: project.brief?.text ?? "",
            beats,
            aspect: row.aspect,
            index: row.scene_index,
            frames: row.frames,
            ...(project.brief?.styleExample ? { styleExample: project.brief.styleExample } : {}),
            ...(project.brief?.scriptNotes ? { scriptNotes: project.brief.scriptNotes } : {}),
            ...(pictures.names.length ? { assetNames: pictures.names } : {}),
            ...(filmProps ? { filmProps } : {}),
            ...(templatePack(project.brief?.styleExample)?.sceneSounds ? { words: (takeFor(project, row.scene_index)?.words ?? []).map((w) => ({ text: w.text, start: w.start })) } : {}),
            ...(routeSnap ? { modelKey: `${tierRoute.provider}:${tierRoute.model}` } : {}),
            ...(reference ? { reference } : {}),
            ...(revise && !lastError ? { revise } : {}),
            ...(lastError ? { error: lastError, previous: previous ?? "" } : {})
          });
          const throttle = createProgressThrottle({
            write: (p) => noteAuthorProgress(row.id, row.gen, owner, p),
            ...(recordStartOnCall ? { authorStartedAt: started } : {})
          });
          recordStartOnCall = false;
          await throttle.reset();
          // The cache gate only helps providers whose prompt cache is explicit (Anthropic); Gemini's implicit cache is not gated.
          const gate = config.plates.cacheGate && request.cacheKey && supportsPromptCacheGate(tierRoute.provider) ? await plateCacheGate.acquire(request.cacheKey, signal) : null;
          let reply: Awaited<ReturnType<typeof callModel>>;
          try {
            const tier = cutOffs === 0 ? "normal" : cutOffs === 1 ? "max-tokens-128k" : "effort-high";
            if (cutOffs > 0) log("info", "plate_author_cutoff_retry", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, gen: row.gen, path: tier, cutOffs, provider: tierRoute.provider, model: tierRoute.model, maxTokens: tierRoute.maxTokens });
            // Text parts keep their cache mark; image parts (a template pack's pictures) pass through as images.
            const messages: ModelMessage[] = request.messages.map((m: { role: string; content: unknown }) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant", content: typeof m.content === "string" ? m.content : (m.content as { type: string; text?: string; mime?: string; base64?: string; cache_control?: unknown }[]).map((part) => part.type === "image" ? { type: "image" as const, mime: part.mime ?? "image/png", base64: part.base64 ?? "" } : ({ type: "text" as const, text: part.text ?? "", ...(part.cache_control ? { cache: true } : {}) })) }));
            reply = await callModel({ step, route: tierRoute, system: request.system, messages, stream: true, errorPrefix: "Scene authoring failed", includeErrorDetail: true, timeoutMs: cutOffs === 0 ? 300_000 : 900_000, signal, onStart: () => gate?.started(), onProgress: (p) => throttle.onProgress(p), stopErrors: { max_tokens: CUT_OFF_MESSAGE } });
          } finally {
            gate?.done();
          }
          await throttle.flush();
          const rawText = reply.text;
          // Persist the reply immediately as soon as the stream completes (before moduleFrom/bundleScene) so a restart never re-pays for it.
          await saveDraft(row.id, row.gen, owner, rawText).catch(() => undefined);
          code = moduleFrom(rawText);
          if (code !== rawText) {
            await saveDraft(row.id, row.gen, owner, code).catch(() => undefined);
          }
        } catch (error) {
          if (message(error).startsWith("CUT OFF:") && cutOffs < cutOffLimit) {
            // Cut off by the output limit: retrying with the same settings would be cut off again, so climb the ladder instead (see cutOffs).
            cutOffs += 1;
            used += 1;
            await noteAuthorCall(row.id, row.gen, owner, { authorMs: Date.now() - t0 });
            continue;
          }
          if (!(error as { repairable?: boolean }).repairable) throw error; // model service / network: retried by the queue, same row
          await saveDraft(row.id, row.gen, owner, null).catch(() => undefined);
          used += 1;
          await noteAuthorCall(row.id, row.gen, owner, { authorMs: Date.now() - t0 });
          lastError = message(error);
          continue;
        }
      }
      if (reusedDraft) {
        try {
          code = moduleFrom(code);
        } catch (error) {
          if (!(error as { repairable?: boolean }).repairable) throw error;
          if (packCode) {
            await failVariant(row.id, row.gen, owner, { code: "pack_scene_invalid", message: "This template's scene could not be built. Press Draw to try again.", detail: message(error).slice(0, 800) });
            return;
          }
          await saveDraft(row.id, row.gen, owner, null).catch(() => undefined);
          lastError = message(error);
          continue;
        }
      } else {
        used += 1;
        await noteAuthorCall(row.id, row.gen, owner, { authorMs: Date.now() - t0 });
      }
      // A template drawn from its cast kit (template-packs.ts) does not use the plate's kit helpers: only the no-text rule applies,
      // and the module must not declare K itself (the kit is added at bundling).
      const packed = Boolean(pack?.scenes || pack?.sceneCode);
      const fullCheck = checkScene(plateName, code);
      const declaresKit = packed && /\b(?:const|let|var)\s+K\s*=/.test(code);
      // A pack's own scene rules (history-reel: the shot size named in the VISUAL must match the camera and the puppet size).
      const packIssues = packed && !(packCode && code === packCode) ? pack?.sceneIssues?.(code, project.brief?.scriptBeats?.[row.scene_index], { filmProps, beatIndex: row.scene_index }) ?? [] : [];
      const policyCheck = !packed ? fullCheck : {
        ...fullCheck,
        ok: fullCheck.noText.ok && !declaresKit && packIssues.length === 0,
        issues: fullCheck.issues.filter((issue) => issue.kind !== "kit-use"),
        message: [declaresKit ? "Do not declare K: the cast kit is already in scope." : "", ...packIssues, fullCheck.noText.message ?? ""].filter(Boolean).join("\n")
      };
      if (!policyCheck.ok && !(packCode && code === packCode)) {
        if (policyRepairs < POLICY_REPAIR_MAX && used < config.plates.maxAuthorCalls) {
          policyRepairs += 1;
          // Drop the stored module so a reused draft that fails the check is never reused again.
          await saveDraft(row.id, row.gen, owner, null).catch(() => undefined);
          lastError = policyCheck.message;
          previous = code;
          continue;
        }
        if (!policyCheck.noText.ok) {
          // The engine draws no text: words still drawn after the one repair are never accepted.
          const names = policyCheck.issues.filter((i) => i.kind !== "kit-use").map((i) => `${i.kind}${"name" in i && i.name ? `:${i.name}` : ""}`).join(", ");
          await failVariant(row.id, row.gen, owner, { code: "author_text_drawn", message: "This scene drew words into the picture, which the editor does not allow. Press Draw to try again.", detail: names.slice(0, 800) });
          log("warn", "plate_text_drawn", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, gen: row.gen, plateName, issues: names });
          return;
        }
        log("info", "plate_policy_unmet", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, gen: row.gen, plateName, issues: policyCheck.issues });
      }
      let bundle: Awaited<ReturnType<typeof bundleScene>>;
      try {
        bundle = await bundleScene({ look, code: wireSceneAssets(withPackKit(code, pack, filmProps?.code), pictures.names, pictures.all), frames: row.frames, aspect: row.aspect });
        // The picture NAMES this scene reads (resolved to files whenever it is loaded, never baked into the bundle).
        if (pictures.names.length) bundle.manifest = { ...bundle.manifest, assetNames: pictures.names } as typeof bundle.manifest;
      } catch (error) {
        if (!(error as { repairable?: boolean }).repairable) throw error;
        if (packCode && code === packCode) {
          // The template's own scene code does not build: a model cannot repair it, so the scene fails with the reason.
          await failVariant(row.id, row.gen, owner, { code: "pack_scene_invalid", message: "This template's scene could not be built. Press Draw to try again.", detail: message(error).slice(0, 800) });
          log("warn", "plate_pack_scene_invalid", { variantId, projectId: row.project_id, scene: row.scene_index, message: message(error).slice(0, 300) });
          return;
        }
        await saveDraft(row.id, row.gen, owner, null).catch(() => undefined);
        lastError = message(error);
        previous = code;
        continue;
      }
      const sourceKey = sourceKeyFor(row, bundle.manifest.sourceSha);
      const bundleKey = bundleKeyFor(row, bundle.manifest.bundleSha);
      const manifestKey = manifestKeyFor(row, bundle.manifest.bundleSha);
      const t1 = Date.now();
      let committed: boolean;
      try {
        await retrying(() => putContentAddressedObject("uploads", sourceKey, code, "text/plain"));
        await retrying(() => putContentAddressedObject("uploads", bundleKey, bundle.html, "text/html"));
        await retrying(() => putContentAddressedObject("uploads", manifestKey, JSON.stringify(bundle.manifest), "application/json"));
        committed = await commitBundle(row, owner, { sourceKey, bundleKey, manifest: bundle.manifest, timings: { bundleMs: Date.now() - t1, authorTotalMs: Date.now() - started } });
      } catch (error) {
        // Storage or the database failed after the model answered: keep the module, so the retry costs no model call.
        await saveDraft(row.id, row.gen, owner, code).catch(() => undefined);
        throw error;
      }
      log("info", committed ? "plate_bundled" : "plate_author_superseded", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, gen: row.gen, modelCalls: used, reusedDraft, seconds: Math.round((Date.now() - started) / 100) / 10 });
      return;
    }
  } catch (error) {
    if (lost.signal.aborted) { log("info", "plate_author_dropped", { variantId, gen }); return; }
    if (shutdownCtrl.signal.aborted) {
      await releaseAuthor(row.id, row.gen, owner, "retrying").catch(() => undefined);
      log("info", "plate_author_deferred_shutdown", { variantId, gen });
      throw error;
    }
    const final = (job.retryCount ?? 0) >= 2;
    log("warn", "plate_author_interrupted", { variantId, gen, final, message: message(error).slice(0, 300) });
    if (final) await failVariant(row.id, row.gen, owner, { code: "author_unavailable", message: "The drawing service could not be reached for this scene. Press Draw to try again." });
    else await releaseAuthor(row.id, row.gen, owner, "retrying").catch(() => undefined);
    if (!final) throw error;
  } finally {
    activeAuthorControllers.delete(shutdownEntry);
    clearInterval(lease);
  }
}

/** Last stop for a plate-author message that exhausted its retries: no row stays queued forever. */
export async function handleAuthorDead(job: Job<AuthorMessage>) {
  const { variantId, gen } = job.data ?? ({} as AuthorMessage);
  if (typeof variantId === "string" && Number.isInteger(gen)) await failVariant(variantId, gen, null, { code: "author_unavailable", message: "This scene could not be drawn. Press Draw to try again." });
}

