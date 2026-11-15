import { templatePack } from "../plan/template-packs.ts";
import { engineDigest, isSupportedStyle, plateNameOf, styleDigest } from "@videosaas/plate-engine";
import type { ScriptBeat, VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
import { FPS, buildTimeline, followsAudio, framesForSeconds, primaryAspect, secondsFor, sizeForAspect, takeFor, variantSignature, type Aspect } from "./model.ts";
import { promptDigest } from "./prompt.ts";
import type { Desired } from "./store.ts";

/** A project whose chosen look is a plate style this deployment can draw (the engine package ships it AND the pipeline is on). */
export const isPlateLook = (look: string | undefined): boolean => Boolean(config.plates.enabled && look && isSupportedStyle(look));

/** The story context shared by every scene and ratio: the film brief and the scenes' keywords (who and what recurs). */
export const filmBrief = (project: VideoProject) => project.brief?.text ?? "";
export const castKeywords = (beats: ScriptBeat[]) => beats.map((b) => b.keyword);

/** The scenes' lengths in whole frames (voiceover-driven when a take exists), the same for every ratio. */
export function sceneFrames(project: VideoProject): { seconds: number; frames: number }[] {
  const follow = followsAudio(project);
  const beats = project.brief?.scriptBeats ?? [];
  const pacing = templatePack(project.brief?.styleExample)?.pacing;
  if (pacing) return packSceneSeconds(beats, (i) => takeFor(project, i)?.seconds, pacing, follow).map((seconds) => ({ seconds, frames: framesForSeconds(seconds) }));
  return beats.map((beat, i) => {
    const seconds = secondsFor(beat, takeFor(project, i)?.seconds, follow);
    return { seconds, frames: framesForSeconds(seconds) };
  });
}

/**
 * A template's own scene pacing (TemplatePack.pacing): a voiced scene lasts its line plus a short gap, whole frames, never rounded
 * up to the half second and never held to the usual 3 s floor, so short lines ("It cried.") cut on like the reference films.
 * Longer gaps only around the title beat (its keyword is the term in capitals) and before the last line; the last scene lands with `tail`.
 * A scene without a measured take keeps the usual estimate.
 */
export function packSceneSeconds(beats: ScriptBeat[], take: (index: number) => number | undefined, pacing: NonNullable<ReturnType<typeof templatePack>>["pacing"] & object, follow = false): number[] {
  const last = beats.length - 1;
  const title = beats.findIndex((beat) => /^[A-Z0-9][A-Z0-9' -]*[A-Z]$/.test(beat.keyword.trim()));
  return beats.map((beat, i) => {
    const voiced = take(i);
    if (!(voiced && voiced > 0)) return secondsFor(beat, voiced, follow);
    const gap = i === last ? pacing.tail : i === title || i === title - 1 ? pacing.long : i === last - 1 ? pacing.beforeLast : pacing.gap;
    return Math.max(i === title ? pacing.titleMin : pacing.min, Math.round((voiced + gap) * FPS) / FPS);
  });
}

/** The plate film's rendered length in seconds (whole-frame timeline over the script beats and voiceover takes), or null when there are no script beats. */
export function plateFilmSeconds(project: VideoProject): number | null {
  const scriptBeats = project.brief?.scriptBeats ?? [];
  if (!scriptBeats.length) return null;
  const frames = sceneFrames(project).map((s) => s.frames);
  const voice = scriptBeats.map((_, i) => takeFor(project, i)?.seconds);
  return buildTimeline(frames, voice).totalFrames / FPS;
}

/** What every (scene, ratio) variant must be right now, with its full dependency signature and per-scene content signature. */
export async function desiredVariants(
  project: VideoProject,
  aspects: Aspect[],
  storedRows?: readonly { scene_index: number; aspect: Aspect; keyword: string; signature: string }[]
): Promise<Desired[]> {
  const look = project.brief!.look!;
  const styleFamily = project.brief?.styleFamily ?? null;
  const styleExample = project.brief?.styleExample ?? null;
  const beats = project.brief?.scriptBeats ?? [];
  const film = filmBrief(project), keywords = castKeywords(beats);
  // A template's cast kit, scene direction and pictures are part of the prompt: a change to them redraws that template's scenes only.
  const packScenes = templatePack(styleExample)?.scenes?.();
  const digests = { engineDigest: engineDigest(), styleDigest: styleDigest(look), promptDigest: `${await promptDigest(plateNameOf(look))}${packScenes ? `:${packScenes.hash}` : ""}` };
  const frames = sceneFrames(project);

  const oldKeywordsByIdx = new Map<number, string>();
  if (storedRows && storedRows.length > 0) {
    const sorted = [...storedRows].sort((a, b) => a.scene_index - b.scene_index);
    for (const r of sorted) {
      if (!oldKeywordsByIdx.has(r.scene_index) && r.keyword) {
        oldKeywordsByIdx.set(r.scene_index, r.keyword);
      }
    }
  }
  const oldKeywords = [...oldKeywordsByIdx.entries()].sort((a, b) => a[0] - b[0]).map(([, kw]) => kw);

  return aspects.flatMap((aspect) =>
    beats.map((beat, index) => {
      const size = sizeForAspect(aspect);
      const frameCount = frames[index]!.frames;
      const signature = variantSignature({
        look,
        styleFamily,
        styleExample,
        ...digests,
        film,
        castKeywords: keywords,
        beat,
        frames: frameCount,
        aspect
      });
      const contentSignature = variantSignature({
        look,
        styleFamily,
        styleExample,
        ...digests,
        film,
        castKeywords: [],
        beat,
        frames: frameCount,
        aspect
      });
      const legacySet = new Set<string>();
      if (oldKeywords.length > 0) {
        const legacySig = variantSignature({
          look,
          styleFamily,
          styleExample,
          ...digests,
          film,
          castKeywords: oldKeywords,
          beat,
          frames: frameCount,
          aspect
        });
        if (legacySig !== signature) legacySet.add(legacySig);
      }
      return {
        index,
        aspect,
        keyword: beat.keyword,
        frames: frameCount,
        width: size.w,
        height: size.h,
        signature,
        contentSignature,
        ...(legacySet.size > 0 ? { legacySignatures: [...legacySet] } : {})
      };
    })
  );
}

/** Ratios to keep drawn: the primary one first, then the ones the person selected. */
export function wantedAspects(project: VideoProject, selected: Aspect[] | undefined): Aspect[] {
  const primary = primaryAspect(project);
  return [primary, ...(selected ?? []).filter((a) => a !== primary)];
}

export const plateName = (look: string) => plateNameOf(look)!;
export { FPS };
