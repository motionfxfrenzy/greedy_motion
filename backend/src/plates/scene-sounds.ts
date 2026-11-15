import type { VideoProject } from "@videosaas/contracts";
import { templatePack } from "../plan/template-packs.ts";
import { getObject } from "../storage.ts";
import { parseSceneSounds, type SceneSound } from "./model.ts";

/**
 * A template pack's scene sounds (TemplatePack.sceneSounds): each scene module exports `sounds: [{ kind, frame }]`, read from
 * its stored source (`source_key`, content-addressed, so the parse is cached for good). The plate status passes them to the
 * preview and the export mixes them as `foley-<kind>` (model.ts sceneSoundCues). Other projects never read a source.
 */
const cache = new Map<string, SceneSound[] | null>();
const CACHE_MAX = 600;

type SourceRow = { id: string; source_key: string | null; frames: number };
export type SoundLoader = (key: string) => Promise<string | null>;
const defaultLoader: SoundLoader = async (key) => (await getObject("uploads", key))?.toString("utf8") ?? null;

async function soundsOfSource(key: string, load: SoundLoader): Promise<SceneSound[] | null> {
  if (cache.has(key)) return cache.get(key)!;
  const code = await load(key).catch(() => undefined);
  if (code === undefined) return null; // a storage error is not cached: the next poll tries again
  const sounds = code === null ? null : parseSceneSounds(code, Number.POSITIVE_INFINITY);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, sounds);
  return sounds;
}

export const projectHasSceneSounds = (project: Pick<VideoProject, "brief"> | null | undefined) => Boolean(templatePack(project?.brief?.styleExample)?.sceneSounds);

/** Scene sounds per variant row id (only rows whose module exports a list; frames outside the row's scene are dropped). */
export async function sceneSoundsByRow(project: Pick<VideoProject, "brief"> | null | undefined, rows: readonly SourceRow[], load: SoundLoader = defaultLoader): Promise<Map<string, SceneSound[]>> {
  const out = new Map<string, SceneSound[]>();
  if (!projectHasSceneSounds(project)) return out;
  await Promise.all(rows.map(async (row) => {
    if (!row.source_key) return;
    const sounds = await soundsOfSource(row.source_key, load);
    if (sounds) out.set(row.id, sounds.filter((s) => s.frame < row.frames));
  }));
  return out;
}
