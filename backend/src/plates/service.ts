import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { getProject } from "../projects/store.ts";
import { desiredVariants, isPlateLook, wantedAspects } from "./inputs.ts";
import { estimateFilmWithScenes, estimateScene, type SceneEtaRow } from "./eta.ts";
import {
  ASPECTS, FPS, defaultSubtitlesFor, isAspect, isComputedVariantSignature, mergeSubtitles, plateRevisionDigest, primaryAspect, type Aspect, type LiveMode, type PlateComment, type PlateScene, type PlateState, type PlateStatus, type SceneProgress, type VariantState, type PlateSubtitles, type PlateVariantView
} from "./model.ts";
import { decideLiveMode, editComments, listVariants, matchVariantsToDesired, readProjectState, recentAuthorMedians, reconcileVariants, reviseScene, writeSubtitles, type VariantRow } from "./store.ts";
import type { AnimationRouteSnapshot } from "../billing/step-billing.ts";

export { isPlateLook };
const OPEN: VariantState[] = ["queued", "authoring", "bundled", "rendering"];

async function plateProject(projectId: string) {
  const project = await getProject(projectId);
  if (!project || !isPlateLook(project.brief?.look)) throw new Error("This project's style is not a code-drawn plate style.");
  return project;
}

const clipVersion = (v: VariantRow) => (v.clip_key ? createHash("md5").update(v.clip_key).digest("hex").slice(0, 10) : null);
// In clip mode (or when a clip fallback render was requested), "bundled" (waiting for a worker) is rendering as far as the person is concerned.
const shown = (v: VariantRow, mode: LiveMode): PlateState =>
  v.state === "bundled" && (mode === "clip" || v.stage === "queued for rendering") ? "rendering" : v.state;

const isLivePlayable = (v: VariantRow, mode: LiveMode): boolean => mode === "live" && v.state === "checked";
const isPlayable = (v: VariantRow, mode: LiveMode): boolean => v.state === "drawn" || isLivePlayable(v, mode);

const toIso = (d: Date | string | null | undefined): string | null =>
  d instanceof Date ? d.toISOString() : typeof d === "string" && d ? d : null;
const authorMsOf = (v: VariantRow): number | undefined => {
  const raw = v.timings?.authorTotalMs;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
};
/** timings.playback = { mode: "clip", reason: "slow", medianMs, gen, digest } is written by submitCheckReport; honoured only for the same bundle. */
const playbackOf = (v: VariantRow): { playback: "clip"; drawMsPerFrame: number } | undefined => {
  const p = (v.timings as Record<string, any> | undefined)?.playback;
  return p && p.mode === "clip" && p.digest && p.digest === v.bundle_digest && p.gen === v.gen ? { playback: "clip", drawMsPerFrame: Math.round(Number(p.medianMs) * 10) / 10 } : undefined;
};
/** timings.retrying is set by the sweep (reconcile.ts) and cleared when a worker claims the row; shown only while the row is open. */
const retryingOf = (v: VariantRow): { attempt: number; reason: string } | undefined => {
  const r = (v.timings as Record<string, any> | undefined)?.retrying;
  return r && typeof r.reason === "string" && Number.isFinite(r.attempt) && OPEN.includes(v.state) ? { attempt: Number(r.attempt), reason: r.reason } : undefined;
};

const etaRowOf = (v: VariantRow, mode: LiveMode): SceneEtaRow => {
  const t = v.timings ?? {};
  const retrying = retryingOf(v);
  return {
    state: v.state,
    stage: v.stage,
    mode,
    playable: isPlayable(v, mode),
    createdAt: v.created_at ?? null,
    updatedAt: v.updated_at ?? null,
    ...(typeof t.authorStartedAt === "number" ? { authorStartedAt: t.authorStartedAt } : {}),
    ...(typeof t.authorTotalMs === "number" ? { authorTotalMs: t.authorTotalMs } : {}),
    ...(typeof t.bundleMs === "number" ? { bundleMs: t.bundleMs } : {}),
    ...(typeof t.writtenTokens === "number" ? { writtenTokens: t.writtenTokens } : {}),
    ...(typeof t.writtenChars === "number" ? { writtenChars: t.writtenChars } : {}),
    ...(typeof t.writtenLines === "number" ? { writtenLines: t.writtenLines } : {}),
    frames: v.frames,
    framesDone: v.frames_done,
    ...(v.authored ? { attempt: v.authored } : v.state === "authoring" ? { attempt: 1 } : {}),
    ...(retrying ? { retrying } : {})
  };
};

function viewOf(v: VariantRow, mode: LiveMode, progress?: SceneProgress): PlateVariantView {
  const createdAt = toIso((v as VariantRow & { created_at?: Date | string }).created_at);
  const updatedAt = toIso(v.updated_at);
  const authorMs = authorMsOf(v);
  return {
    state: shown(v, mode),
    sig: v.signature,
    v: clipVersion(v),
    gen: v.gen,
    rev: v.rev,
    variantId: v.id,
    bundleDigest: v.bundle_digest ?? null,
    live: isLivePlayable(v, mode),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    frames: typeof v.frames === "number" ? v.frames : null,
    framesDone: typeof v.frames_done === "number" ? v.frames_done : null,
    ...(authorMs !== undefined ? { authorMs } : {}),
    drawnAt: toIso(v.drawn_at),
    ...(progress ? { progress } : {}),
    ...(retryingOf(v) ? { retrying: retryingOf(v) } : {}),
    ...playbackOf(v),
    ...(v.stage && OPEN.includes(v.state) ? { stage: v.stage } : {}),
    ...(v.state === "failed" && v.error ? { error: v.error.message } : {})
  };
}

/** What the browser shows. Built from Postgres only. */
export async function plateStatus(projectId: string): Promise<PlateStatus> {
  const project = await getProject(projectId);
  const look = project?.brief?.look ?? null;
  const [variants, stored, recentMedians] = await Promise.all([listVariants(projectId), readProjectState(projectId), recentAuthorMedians()]);
  const now = Date.now();
  const mode: LiveMode = stored.liveMode ?? (config.plates.live ? "live" : "clip");
  const primary = project ? primaryAspect(project) : "16:9";
  const subtitles: PlateSubtitles = { ...defaultSubtitlesFor(project), ...(stored.subtitles ?? {}) };
  const mergedAspects = project
    ? wantedAspects(project, [...(project.brief?.aspects ?? []), ...(stored.subtitles?.aspects ?? [])])
    : [primary];
  subtitles.aspects = mergedAspects.length ? mergedAspects : [primary];

  const beats = project?.brief?.scriptBeats ?? [];
  const hasProjectBeats = Boolean(project && isPlateLook(look ?? undefined) && beats.length > 0);

  if (hasProjectBeats && project) {
    const desiredAll = await desiredVariants(project, [...ASPECTS], variants);
    const desiredByKey = new Map(desiredAll.map((d) => [`${d.index}:${d.aspect}`, d]));
    const revision = plateRevisionDigest({
      look,
      styleFamily: project.brief?.styleFamily ?? null,
      styleExample: project.brief?.styleExample ?? null,
      aspects: mergedAspects,
      desired: desiredAll.filter((d) => mergedAspects.includes(d.aspect))
    });

    if (variants.length === 0) {
      const { film } = estimateFilmWithScenes({
        scenes: [],
        now,
        recentMedianAuthorMs: recentMedians.authorMs,
        recentMedianTokens: recentMedians.tokens,
        cap: config.plates.projectAuthorCap,
        mode
      });
      return {
        available: true,
        look,
        mode,
        serverNow: new Date(now).toISOString(),
        revision,
        stale: false,
        needsReconcile: true,
        film,
        scenes: [],
        comments: stored.comments as PlateComment[],
        subtitles,
        running: false,
        drawnAspects: [],
        drawingAspects: []
      };
    }

    const { matched, claimedRowIds } = matchVariantsToDesired(variants, desiredAll, { allowSyntheticSignature: true });
    const sceneCount = beats.length;
    const allDisplayAspects = [...new Set<Aspect>([...mergedAspects, ...variants.map((v) => v.aspect)])];

    const primaryEtaRows: SceneEtaRow[] = Array.from({ length: sceneCount }, (_, index) => {
      const dPrimary = desiredByKey.get(`${index}:${primary}`)!;
      const mPrimary =
        matched.get(`${index}:${primary}`) ??
        allDisplayAspects.map((a) => matched.get(`${index}:${a}`)).find(Boolean);
      if (mPrimary) {
        return etaRowOf(mPrimary.row, mode);
      }
      return {
        state: "queued",
        stage: "stale",
        mode,
        playable: false,
        createdAt: null,
        updatedAt: null,
        frames: dPrimary.frames,
        framesDone: null
      };
    });

    const { film, scenes: primaryProgress } = estimateFilmWithScenes({
      scenes: primaryEtaRows,
      now,
      recentMedianAuthorMs: recentMedians.authorMs,
      recentMedianTokens: recentMedians.tokens,
      cap: config.plates.projectAuthorCap,
      mode
    });

    const scenes: PlateScene[] = Array.from({ length: sceneCount }, (_, index) => {
      const dPrimary = desiredByKey.get(`${index}:${primary}`)!;
      const mPrimary =
        matched.get(`${index}:${primary}`) ??
        allDisplayAspects.map((a) => matched.get(`${index}:${a}`)).find(Boolean);
      const sceneProgress = primaryProgress[index];

      const variantViews: Partial<Record<Aspect, PlateVariantView>> = {};
      for (const a of allDisplayAspects) {
        const dAsp = desiredByKey.get(`${index}:${a}`)!;
        const mAsp = matched.get(`${index}:${a}`);
        if (mAsp) {
          const row = mAsp.row;
          const rowProgress =
            mPrimary && row.id === mPrimary.row.id
              ? sceneProgress
              : estimateScene(etaRowOf(row, mode), {
                  now,
                  finishedScenes: primaryEtaRows,
                  recentMedianAuthorMs: recentMedians.authorMs,
                  recentMedianTokens: recentMedians.tokens,
                  cap: config.plates.projectAuthorCap,
                  mode
                });
          const needsRec = !mAsp.inPlace || (isComputedVariantSignature(row.signature) && row.signature !== dAsp.signature);
          variantViews[a] = {
            ...viewOf(row, mode, rowProgress),
            sig: isComputedVariantSignature(row.signature) ? dAsp.signature : row.signature,
            frames: dAsp.frames,
            stale: false,
            ...(needsRec ? { needsReconcile: true } : {})
          };
        } else if (mergedAspects.includes(a)) {
          variantViews[a] = {
            state: "queued",
            sig: dAsp.signature,
            v: null,
            gen: 1,
            rev: 0,
            bundleDigest: null,
            live: false,
            frames: dAsp.frames,
            framesDone: null,
            stage: "stale",
            stale: true,
            needsReconcile: true,
            ...(sceneProgress ? { progress: sceneProgress } : {})
          };
        }
      }

      if (mPrimary) {
        const v = mPrimary.row;
        const createdAt = toIso((v as VariantRow & { created_at?: Date | string }).created_at);
        const updatedAt = toIso(v.updated_at);
        const authorMs = authorMsOf(v);
        const needsRec =
          !mPrimary.inPlace ||
          (isComputedVariantSignature(v.signature) && v.signature !== dPrimary.signature) ||
          Object.values(variantViews).some((vv) => Boolean(vv?.needsReconcile));
        const anyWantedAspectStale = mergedAspects.some((a) => Boolean(variantViews[a]?.stale));
        return {
          index,
          keyword: dPrimary.keyword,
          state: shown(v, mode),
          seconds: dPrimary.frames / FPS,
          frames: dPrimary.frames,
          framesDone: typeof v.frames_done === "number" ? v.frames_done : null,
          sig: isComputedVariantSignature(v.signature) ? dPrimary.signature : v.signature,
          gen: v.gen,
          rev: v.rev,
          variantId: v.id,
          bundleDigest: v.bundle_digest ?? null,
          live: isLivePlayable(v, mode),
          stale: false,
          ...(needsRec || anyWantedAspectStale ? { needsReconcile: true } : {}),
          ...(createdAt ? { createdAt } : {}),
          ...(updatedAt ? { updatedAt } : {}),
          ...(authorMs !== undefined ? { authorMs } : {}),
          drawnAt: toIso(v.drawn_at),
          ...(sceneProgress ? { progress: sceneProgress } : {}),
          ...(retryingOf(v) ? { retrying: retryingOf(v) } : {}),
          ...playbackOf(v),
          ...(v.stage && OPEN.includes(v.state) ? { stage: v.stage } : {}),
          ...(v.state === "failed" && v.error ? { error: v.error.message } : {}),
          ...(v.authored ? { attempts: v.authored } : {}),
          variants: variantViews
        };
      }

      return {
        index,
        keyword: dPrimary.keyword,
        state: "queued",
        stage: "stale",
        stale: true,
        needsReconcile: true,
        seconds: dPrimary.frames / FPS,
        frames: dPrimary.frames,
        framesDone: null,
        sig: dPrimary.signature,
        gen: 1,
        rev: 0,
        bundleDigest: null,
        live: false,
        ...(sceneProgress ? { progress: sceneProgress } : {}),
        variants: variantViews
      };
    });

    const drawnAspects: Aspect[] = [], drawingAspects: Aspect[] = [];
    for (const aspect of ASPECTS) {
      const matchedForAspect = Array.from({ length: sceneCount }, (_, i) => matched.get(`${i}:${aspect}`)?.row);
      if (sceneCount > 0 && matchedForAspect.every((r) => Boolean(r && isPlayable(r, mode)))) {
        drawnAspects.push(aspect);
      }
      if (matchedForAspect.some((r) => Boolean(r && OPEN.includes(r.state)))) {
        drawingAspects.push(aspect);
      }
    }

    const stale = scenes.some(
      (s) => Boolean(s.stale) || mergedAspects.some((a) => Boolean(s.variants?.[a]?.stale))
    );
    const hasUnclaimedOrExtraRows = variants.some((v) => v.scene_index >= sceneCount || !claimedRowIds.has(v.id));
    const needsReconcile = stale || hasUnclaimedOrExtraRows || scenes.some((s) => Boolean(s.needsReconcile));
    const running = [...matched.values()].some(({ row }) => OPEN.includes(row.state));

    // Comments answered by a redraw (the scene's matched variant is playable again at the revision that took them) are done.
    const answered = (c: PlateComment & { fixing?: number }) => {
      const mRow = matched.get(`${c.scene}:${primary}`)?.row;
      return c.fixing !== undefined && (mRow?.rev ?? 0) >= c.fixing && Boolean(mRow && isPlayable(mRow, mode));
    };
    let comments = stored.comments as (PlateComment & { fixing?: number })[];
    if (comments.some(answered)) {
      comments = (await editComments(projectId, (all) =>
        (all as (PlateComment & { fixing?: number })[]).filter((c) => !answered(c))
      )) as typeof comments;
    }

    return {
      available: true,
      look,
      mode,
      serverNow: new Date(now).toISOString(),
      revision,
      stale,
      needsReconcile,
      film,
      scenes,
      comments,
      subtitles,
      running,
      drawnAspects,
      drawingAspects
    };
  }

  const byScene = new Map<number, Map<Aspect, VariantRow>>();
  for (const v of variants) { if (!byScene.has(v.scene_index)) byScene.set(v.scene_index, new Map()); byScene.get(v.scene_index)!.set(v.aspect, v); }
  const primaryRows = [...byScene.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m.get(primary) ?? [...m.values()][0]!);
  const primaryEtaRows = primaryRows.map((v) => etaRowOf(v, mode));
  const { film, scenes: primaryProgress } = estimateFilmWithScenes({
    scenes: primaryEtaRows,
    now,
    recentMedianAuthorMs: recentMedians.authorMs,
    recentMedianTokens: recentMedians.tokens,
    cap: config.plates.projectAuthorCap,
    mode
  });
  const scenes: PlateScene[] = primaryRows.map((v, idx) => {
    const createdAt = toIso((v as VariantRow & { created_at?: Date | string }).created_at);
    const updatedAt = toIso(v.updated_at);
    const authorMs = authorMsOf(v);
    const sceneProgress = primaryProgress[idx];
    return {
      index: v.scene_index, keyword: v.keyword, state: shown(v, mode), seconds: v.frames / v.fps, frames: v.frames,
      framesDone: typeof v.frames_done === "number" ? v.frames_done : null,
      sig: v.signature, gen: v.gen, rev: v.rev,
      variantId: v.id, bundleDigest: v.bundle_digest ?? null, live: isLivePlayable(v, mode),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(authorMs !== undefined ? { authorMs } : {}),
      drawnAt: toIso(v.drawn_at),
      ...(sceneProgress ? { progress: sceneProgress } : {}),
      ...(retryingOf(v) ? { retrying: retryingOf(v) } : {}),
      ...playbackOf(v),
      ...(v.state === "failed" && v.error ? { error: v.error.message } : {}), ...(v.authored ? { attempts: v.authored } : {}),
      variants: Object.fromEntries(
        [...byScene.get(v.scene_index)!.entries()].map(([a, row]) => {
          const rowProgress =
            row.id === v.id
              ? sceneProgress
              : estimateScene(etaRowOf(row, mode), {
                  now,
                  finishedScenes: primaryEtaRows,
                  recentMedianAuthorMs: recentMedians.authorMs,
                  recentMedianTokens: recentMedians.tokens,
                  cap: config.plates.projectAuthorCap,
                  mode
                });
          return [a, viewOf(row, mode, rowProgress)];
        })
      )
    };
  });

  const drawnAspects: Aspect[] = [], drawingAspects: Aspect[] = [];
  const count = byScene.size;
  for (const aspect of ASPECTS) {
    const rows = variants.filter((v) => v.aspect === aspect);
    if (rows.length === count && count > 0 && rows.every((v) => isPlayable(v, mode))) drawnAspects.push(aspect);
    if (rows.some((v) => OPEN.includes(v.state))) drawingAspects.push(aspect);
  }

  // Comments answered by a redraw (the scene's variant is playable again at the revision that took them) are done.
  const answered = (c: PlateComment & { fixing?: number }) => {
    const row = primaryRows.find((v) => v.scene_index === c.scene);
    return c.fixing !== undefined && (row?.rev ?? 0) >= c.fixing && Boolean(row && isPlayable(row, mode));
  };
  let comments = stored.comments as (PlateComment & { fixing?: number })[];
  if (comments.some(answered)) comments = (await editComments(projectId, (all) => (all as (PlateComment & { fixing?: number })[]).filter((c) => !answered(c)))) as typeof comments;
  return { available: isPlateLook(look ?? undefined), look, mode, serverNow: new Date(now).toISOString(), film, scenes, comments, subtitles, running: variants.some((v) => OPEN.includes(v.state)), drawnAspects, drawingAspects };
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
export async function startPlates(
  projectId: string,
  extraAspects: Aspect[] = [],
  options?: { routeSnapshot?: AnimationRouteSnapshot; reservationId?: string }
): Promise<PlateStatus> {
  const project = await plateProject(projectId);
  const beats = project.brief?.scriptBeats ?? [];
  if (!beats.length) throw new Error("Write the script and storyboard first.");
  await decideLiveMode(projectId, config.plates.live);
  const [stored, existingVariants] = await Promise.all([readProjectState(projectId), listVariants(projectId)]);
  const aspects = [...new Set([...wantedAspects(project, [...(project.brief?.aspects ?? []), ...(stored.subtitles?.aspects ?? []), ...extraAspects])])];
  const desired = await desiredVariants(project, aspects, existingVariants);
  await reconcileVariants(projectId, desired, {
    scenes: beats.length,
    ...(options?.routeSnapshot ? { routeSnapshot: options.routeSnapshot } : {}),
    ...(options?.reservationId ? { reservationId: options.reservationId } : {})
  });
  return plateStatus(projectId);
}

/** Draws one more ratio natively (its own authoring, verification and render); the ratios already drawn are untouched. */
export async function drawAspectPlates(
  projectId: string,
  aspect: Aspect,
  options?: { routeSnapshot?: AnimationRouteSnapshot; reservationId?: string }
): Promise<PlateStatus> {
  if (!isAspect(aspect)) throw new Error("Aspect must be 16:9, 9:16, or 1:1.");
  const project = await plateProject(projectId);
  const stored = await readProjectState(projectId);
  const current = { ...defaultSubtitlesFor(project), ...(stored.subtitles ?? {}) };
  await writeSubtitles(projectId, mergeSubtitles(current, { aspects: [...new Set([...(current.aspects ?? []), aspect])] }, primaryAspect(project)));
  return startPlates(projectId, [aspect], options);
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

/** Sends the scenes that have comments back to the model with the notes; every drawn or checked ratio of such a scene is redrawn. */
export async function fixPlates(
  projectId: string,
  options?: { routeSnapshot?: AnimationRouteSnapshot; reservationId?: string }
): Promise<PlateStatus> {
  await plateProject(projectId);
  const stored = await readProjectState(projectId);
  const comments = stored.comments as (PlateComment & { fixing?: number })[];
  if (!comments.length) throw new Error("Add a comment first.");
  const variants = await listVariants(projectId);
  const targets = [...new Set(comments.map((c) => c.scene))].filter((i) => variants.some((v) => v.scene_index === i));
  const blocked = targets.some((i) =>
    variants
      .filter((v) => v.scene_index === i)
      .some((v) => OPEN.includes(v.state) && !v.source_key && !v.revise?.codeKey)
  );
  if (blocked) throw new Error("Wait for the scenes that are being drawn.");
  const noted = new Set<number>();
  for (const i of targets) {
    const notes = comments.filter((c) => c.scene === i).map((c) => `- at ${c.sceneAt.toFixed(1)} s: ${c.body}`).join("\n");
    if (
      await reviseScene(projectId, i, notes, {
        ...(options?.routeSnapshot ? { routeSnapshot: options.routeSnapshot } : {}),
        ...(options?.reservationId ? { reservationId: options.reservationId } : {})
      })
    ) {
      noted.add(i);
    }
  }
  if (!noted.size) throw new Error("Wait for the scenes that are being drawn.");
  const after = await listVariants(projectId);
  const revOf = (scene: number) => Math.max(...after.filter((v) => v.scene_index === scene).map((v) => v.rev));
  await editComments(projectId, (all) => (all as (PlateComment & { fixing?: number })[]).map((c) => noted.has(c.scene) ? { ...c, fixing: revOf(c.scene) } : c));
  return plateStatus(projectId);
}
