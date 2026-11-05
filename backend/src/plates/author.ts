import type { Job } from "pg-boss";
import { bundleScene, plateNameOf } from "@videosaas/plate-engine";
import { anthropicMessage, responseText } from "../anthropic.ts";
import { config } from "../config.ts";
import { boss, QUEUES } from "../jobs/queues.ts";
import { getProject } from "../projects/store.ts";
import { getObject, putObject, type Bucket } from "../storage.ts";
import { primaryAspect } from "./model.ts";
import { buildAuthorMessages, moduleFrom } from "./prompt.ts";
import { bundleKeyFor, claimAuthor, commitBundle, failVariant, getVariant, manifestKeyFor, newOwner, noteAuthorCall, primarySource, releaseAuthor, renewAuthor, saveDraft, sourceKeyFor } from "./store.ts";

/**
 * Authoring consumer (`plate-author`): turns one variant into an immutable source + self-contained bundle in object storage and
 * hands it to the worker queue. The model request and the bundling run with NO database transaction open.
 *
 * Failure categories (never mixed):
 *  - the model's module is invalid or does not bundle  -> a repair call, within one budget (PLATE_MAX_AUTHOR_CALLS);
 *  - the model service or storage fails                 -> the same row is retried by pg-boss; the repair budget is untouched;
 *  - the budget is used up                              -> the variant fails with the last error in words.
 */
const LEASE_SECONDS = 90;
const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));
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

export type AuthorMessage = { variantId: string; gen: number };

export async function handleAuthor(job: Job<AuthorMessage>) {
  const { variantId, gen } = job.data ?? ({} as AuthorMessage);
  if (typeof variantId !== "string" || !Number.isInteger(gen)) return;
  const owner = newOwner();
  const row = await claimAuthor(variantId, gen, owner, LEASE_SECONDS, config.plates.projectAuthorCap);
  if (!row) {
    // Held by a live owner or at the project cap: look again shortly, without spending a retry. Superseded or done: drop it.
    const current = await getVariant(variantId);
    if (current && current.gen === gen && (current.state === "queued" || (current.state === "authoring" && current.author_until && current.author_until < new Date(Date.now() + 5_000)))) {
      await boss.send(QUEUES.plateAuthor, { variantId, gen }, { startAfter: 8 });
    }
    return;
  }
  const started = Date.now();
  const lost = new AbortController();
  const signal = AbortSignal.any([job.signal, lost.signal]);
  const lease = setInterval(() => { void renewAuthor(row.id, row.gen, owner, LEASE_SECONDS).then((ok) => { if (!ok) lost.abort(new Error("authoring superseded")); }).catch(() => undefined); }, 25_000);
  lease.unref();
  try {
    const project = await getProject(row.project_id);
    const look = project?.brief?.look;
    const beats = project?.brief?.scriptBeats ?? [];
    if (!project || !look || !beats[row.scene_index]) { await failVariant(row.id, row.gen, owner, { code: "project_changed", message: "The storyboard changed while this scene was waiting. Draw the scenes again." }); return; }

    // Other ratios follow the primary one's authored scene (same characters and palette), so they wait for it.
    const primary = primaryAspect(project);
    let reference: string | undefined;
    if (row.aspect !== primary) {
      const p = await primarySource(row.project_id, row.scene_index, primary);
      if (!p.ready) { await releaseAuthor(row.id, row.gen, owner, "waiting for the first ratio"); await boss.send(QUEUES.plateAuthor, { variantId, gen }, { startAfter: 10 }); return; }
      if (p.key) reference = (await getObject("uploads", p.key))?.toString("utf8");
    }
    let revise: { notes: string; code: string } | undefined;
    if (row.revise) {
      const code = row.revise.codeKey ? (await getObject("uploads", row.revise.codeKey))?.toString("utf8") : undefined;
      revise = code ? { notes: row.revise.notes, code } : undefined;
    }

    let lastError = row.repair?.error;
    let previous = row.repair?.previousKey ? (await getObject("uploads", row.repair.previousKey))?.toString("utf8") : undefined;
    let used = row.authored;
    let draft = row.draft_source ?? undefined;
    const plateName = plateNameOf(look)!;
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      if (used >= config.plates.maxAuthorCalls) {
        await failVariant(row.id, row.gen, owner, { code: "author_exhausted", message: `This scene could not be drawn after ${used} attempts. Press Draw to try again.`, detail: String(lastError ?? "").slice(0, 800) });
        log("warn", "plate_author_exhausted", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, calls: used });
        return;
      }
      const t0 = Date.now();
      let code: string;
      if (draft) {
        // A module an earlier attempt of this row already obtained (storage or the queue failed after the model answered): no new model call.
        code = draft;
        draft = undefined;
      } else try {
        const request = await buildAuthorMessages({ look, plateName, film: project.brief?.text ?? "", beats, aspect: row.aspect, index: row.scene_index, frames: row.frames, ...(reference ? { reference } : {}), ...(revise && !lastError ? { revise } : {}), ...(lastError ? { error: lastError, previous: previous ?? "" } : {}) });
        const reply = await anthropicMessage({ model: config.plateModel, max_tokens: 24_000, system: request.system, messages: request.messages }, { errorPrefix: "Scene authoring failed", includeErrorDetail: true, timeoutMs: 300_000, signal, stopErrors: { max_tokens: "CUT OFF: the module was longer than the output limit. Write a MUCH MORE COMPACT module (under 200 lines): fewer, simpler elements, reuse small helper functions, loops instead of repeated calls." } });
        code = moduleFrom(responseText(reply));
      } catch (error) {
        if (!(error as { repairable?: boolean }).repairable) throw error; // model service / network: retried by the queue, same row
        used += 1;
        await noteAuthorCall(row.id, row.gen, owner, { authorMs: Date.now() - t0 });
        lastError = message(error);
        continue;
      }
      if (code !== row.draft_source) {
        used += 1;
        await noteAuthorCall(row.id, row.gen, owner, { authorMs: Date.now() - t0 });
      }
      let bundle: Awaited<ReturnType<typeof bundleScene>>;
      try {
        bundle = await bundleScene({ look, code, frames: row.frames, aspect: row.aspect });
      } catch (error) {
        if (!(error as { repairable?: boolean }).repairable) throw error;
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
      log("info", committed ? "plate_bundled" : "plate_author_superseded", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, gen: row.gen, modelCalls: used, seconds: Math.round((Date.now() - started) / 100) / 10 });
      return;
    }
  } catch (error) {
    if (lost.signal.aborted) { log("info", "plate_author_dropped", { variantId, gen }); return; }
    const final = (job.retryCount ?? 0) >= 2;
    log("warn", "plate_author_interrupted", { variantId, gen, final, message: message(error).slice(0, 300) });
    if (final) await failVariant(row.id, row.gen, owner, { code: "author_unavailable", message: "The drawing service could not be reached for this scene. Press Draw to try again." });
    else await releaseAuthor(row.id, row.gen, owner, "retrying").catch(() => undefined);
    if (!final) throw error;
  } finally {
    clearInterval(lease);
  }
}

/** Last stop for a plate-author message that exhausted its retries: no row stays queued forever. */
export async function handleAuthorDead(job: Job<AuthorMessage>) {
  const { variantId, gen } = job.data ?? ({} as AuthorMessage);
  if (typeof variantId === "string" && Number.isInteger(gen)) await failVariant(variantId, gen, null, { code: "author_unavailable", message: "This scene could not be drawn. Press Draw to try again." });
}

