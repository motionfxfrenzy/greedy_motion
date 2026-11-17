// Storyboard previews (TemplatePack.storyboardPreviews = "image"): while the storyboard builds, a film gets one picture per scene.
// 1. The pack's REAL asset step runs first for the places in the plan (the empty sets, same specs, same keys, same digest the Animation step
//    computes later), so Animation finds them stored and neither draws nor charges them again.
// 2. Then one still per beat from the image model, with two references: the beat's set and the pack's cast sheet. The picture is cached by
//    its content hash (set + beat's VISUAL + cast + prompt rules), so an edited beat redraws only its own picture.
// Charging: one material charge per picture (the per-picture rule, 30% margin), taken after the picture is stored and idempotent per
// (project, content hash): a picture that failed was never charged, one shown again is never charged twice.
import { createHash } from "node:crypto";
import type { Aspect, ScriptBeat, ScriptBrief, VideoProject } from "@videosaas/contracts";
import { materialCostMillitokensV2 } from "@videosaas/contracts";
import { config } from "../config.ts";
import type { AssetSpec, TemplatePack } from "../plan/template-packs.ts";
import {
  IMAGE_USD, applyAssetNotes, assetHash, generatePackAssets, loadShotPlan, packSpecs, readAssetIndex, readAssetNotes, sceneAssetNames,
  type AssetIndex, type AssetStorage, type GeneratedImage, type PackAssetDeps
} from "./pack-assets.ts";

export const PREVIEW_VERSION = 1;
export const PREVIEW_PARALLEL = 4;
/** The picture the page shows is a small JPEG (about 25 KB) sent as a data URL; the full 1K picture stays in storage. */
export const PREVIEW_SMALL_WIDTH = 360;

export const previewKey = (projectId: string, hash: string) => `plates/${projectId}/previews/${hash}.jpg`;
export const previewSmallKey = (projectId: string, hash: string) => `plates/${projectId}/previews/${hash}.small.jpg`;

/** The beat's VISUAL without its leading `[place]` tag: the action to draw. */
export const visualAction = (beat: Pick<ScriptBeat, "visual" | "keyword">): string =>
  (beat.visual ?? "").replace(/^\s*\[[^\]]*\]\s*/, "").trim() || (beat.keyword ?? "").trim();

export function previewPrompt(beat: Pick<ScriptBeat, "visual" | "keyword">, direction: string): string {
  return [
    "Draw ONE finished still frame of a cartoon history film, in the exact place of the first reference picture, with the cast of the second reference sheet.",
    `WHAT HAPPENS IN THIS SHOT: ${visualAction(beat)}`,
    direction,
    "Compose it like a film frame: one clear action, the characters acting it out with their whole bodies, camera at eye level.",
    "NO TEXT: no words, letters, numbers, labels, signs, speech bubbles or captions anywhere in the picture. No watermark."
  ].join("\n\n");
}

/** Content hash of one preview picture: everything that changes how it looks. */
export function previewHash(input: { prompt: string; aspect: Aspect; setHash: string; castDigest: string; model?: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([PREVIEW_VERSION, input.model ?? config.visualImageModel, input.prompt, input.aspect, "1K", input.setHash, input.castDigest]))
    .digest("hex")
    .slice(0, 32);
}

/** The material price of one preview picture in millitokens (1K picture, v2 step billing, 30% margin floor). */
export const previewMilli = () => materialCostMillitokensV2(IMAGE_USD["1K"]);
export const setMilli = () => materialCostMillitokensV2(IMAGE_USD["2K"]);

export type PreviewPlan = {
  specs: AssetSpec[];
  aspect: Aspect;
  /** Per wanted beat: its set, the set's content hash and the picture's own hash and keys. */
  items: { index: number; set: string; setHash: string; hash: string; key: string; smallKey: string; prompt: string }[];
};

/** The project as the Animation step will see it once the storyboard is saved: the request's brief with its beats and notes. */
export function projectForPreviews(project: VideoProject, brief: ScriptBrief, beats: ScriptBeat[], notes: unknown): VideoProject {
  return { ...project, brief: { ...brief, scriptBeats: beats, ...(notes ? { scriptNotes: notes } : {}) } } as VideoProject;
}

/** Content hash of a set spec (sets have no references, so it is the same hash generatePackAssets stores the picture under). */
export function setHashOf(spec: AssetSpec, byName: Map<string, AssetSpec>, memo = new Map<string, string>()): string {
  const known = memo.get(spec.name);
  if (known) return known;
  const refs = (spec.refs ?? []).map((r) => setHashOf(byName.get(r)!, byName, memo));
  const hash = assetHash(spec, refs);
  memo.set(spec.name, hash);
  return hash;
}

export async function planPreviews(
  project: VideoProject, pack: TemplatePack, brief: ScriptBrief, beats: ScriptBeat[], notes: unknown, wanted: number[],
  storage: Pick<AssetStorage, "getObject" | "putObject">
): Promise<PreviewPlan> {
  const synthetic = projectForPreviews(project, brief, beats, notes);
  const plan = await loadShotPlan(synthetic, pack, storage);
  const specs = applyAssetNotes(packSpecs(synthetic, pack, plan), await readAssetNotes(project.id, storage));
  const byName = new Map(specs.map((s) => [s.name, s]));
  const castDigest = createHash("sha256").update(pack.previewCast!()).digest("hex").slice(0, 16);
  const direction = pack.previewDirection ?? "";
  const items = wanted.flatMap((index) => {
    const beat = beats[index];
    if (!beat) return [];
    const set = sceneAssetNames(pack, specs, index, beats as never).find((n) => byName.get(n)?.name === n && !n.startsWith("depth-"));
    const spec = set ? byName.get(set) : undefined;
    if (!set || !spec) return [];
    const prompt = previewPrompt(beat, direction);
    const setHash = setHashOf(spec, byName);
    const hash = previewHash({ prompt, aspect: brief.aspect, setHash, castDigest });
    return [{ index, set, setHash, hash, key: previewKey(project.id, hash), smallKey: previewSmallKey(project.id, hash), prompt }];
  });
  return { specs, aspect: brief.aspect, items };
}

export type PreviewDeps = AssetStorage & {
  /** One picture from the image model (refs: the set picture, then the cast sheet). */
  image: (prompt: string, refs: { name: string; data: Buffer; mime: string }[], spec: AssetSpec) => Promise<GeneratedImage>;
  /** A reference picture made smaller for the model (a JPEG of at most `width` px). */
  shrink: (data: Buffer, width: number) => Promise<Buffer>;
  /** The stored full picture (JPEG). */
  normalise: (image: GeneratedImage) => Promise<{ data: Buffer; mime: string }>;
  /** The small picture the page shows. */
  small: (data: Buffer) => Promise<Buffer>;
  /** Takes the material charge for one picture; `ref` is unique per (project, content hash). Throws InsufficientTokens. Absent = nothing charged. */
  charge?: (usd: number, ref: string) => Promise<void>;
  /** Draws or reuses the sets (the pack's real asset step). */
  sets: (specs: AssetSpec[]) => Promise<AssetIndex>;
  parallel?: number;
  /** Poll interval while waiting for a set that is still being drawn. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type PreviewEvent =
  | { index: number; image: string; cached: boolean }
  | { index: number; error: string };

export type PreviewStats = { cached: number; drawn: number; failed: number; setsFailed: string | null; usd: number; stopped: "tokens" | null };

const dataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const isInsufficient = (error: unknown) => (error as Error)?.name === "InsufficientTokens" || (error as { needed?: number })?.needed !== undefined;

/**
 * Runs the previews for `plan.items`, streaming each as `send({ index, image })` (a data URL) the moment it is ready. A picture that cannot
 * be made or paid for sends `{ index, error }` and the caller shows the key-phrase card. Never throws for a single picture.
 */
export async function runStoryboardPreviews(
  projectId: string, pack: TemplatePack, plan: PreviewPlan, deps: PreviewDeps, send: (event: PreviewEvent) => void, signal?: AbortSignal
): Promise<PreviewStats> {
  const stats: PreviewStats = { cached: 0, drawn: 0, failed: 0, setsFailed: null, usd: 0, stopped: null };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cast = pack.previewCast!();
  let castRef: Promise<Buffer> | null = null;
  const paid = async (item: PreviewPlan["items"][number]): Promise<boolean> => {
    if (!deps.charge) return true;
    try { await deps.charge(IMAGE_USD["1K"], `${projectId}:${item.hash}`); return true; }
    catch (error) { if (isInsufficient(error)) { stats.stopped = "tokens"; send({ index: item.index, error: "Not enough tokens for the preview." }); return false; } throw error; }
  };

  // 1. pictures already stored: shown at once (and charged if they never were: the charge is idempotent per picture)
  const todo: PreviewPlan["items"] = [];
  for (const item of plan.items) {
    const small = await deps.getObject("uploads", item.smallKey).catch(() => null);
    if (small && (await deps.objectSize("uploads", item.key)) !== null) {
      if (!(await paid(item))) continue;
      stats.cached += 1;
      send({ index: item.index, image: dataUrl(small), cached: true });
    } else todo.push(item);
  }
  if (!todo.length || stats.stopped) return stats;

  // 2. the sets first (the pack's real asset step); previews start as each set lands
  let setsDone = false, setsError: string | null = null;
  const setsRun = deps.sets(plan.specs).then(() => undefined, (error) => { setsError = String((error as Error)?.message ?? error).slice(0, 300); stats.setsFailed = setsError; }).finally(() => { setsDone = true; });
  const setRecord = async (name: string, hash: string) => {
    for (;;) {
      if (signal?.aborted) return null;
      const index = await readAssetIndex(projectId, deps);
      const record = index?.assets[name];
      if (record && record.hash === hash) return record;
      if (setsDone) return null;
      await sleep(deps.pollMs ?? 700);
    }
  };

  // 3. one still per beat, four at a time
  const queue = [...todo];
  const worker = async () => {
    for (let item = queue.shift(); item && !signal?.aborted && !stats.stopped; item = queue.shift()) {
      try {
        const record = await setRecord(item.set, item.setHash);
        if (!record) { stats.failed += 1; send({ index: item.index, error: setsError ?? "The set picture is not ready." }); continue; }
        const setBytes = await deps.getObject("uploads", record.key);
        if (!setBytes) throw new Error("The set picture is missing from storage.");
        castRef ??= deps.shrink(cast, 1024);
        const refs = [
          { name: "set (the place)", data: await deps.shrink(setBytes, 1024), mime: "image/jpeg" },
          { name: "cast sheet (the characters)", data: await castRef, mime: "image/jpeg" }
        ];
        const picture = await deps.image(item.prompt, refs, { name: `preview-${item.index}`, prompt: item.prompt, aspect: plan.aspect as "9:16", size: "1K", noText: true } as AssetSpec);
        const stored = await deps.normalise(picture);
        const small = await deps.small(stored.data);
        await deps.putObject("uploads", item.key, stored.data, stored.mime);
        await deps.putObject("uploads", item.smallKey, small, "image/jpeg");
        stats.usd += IMAGE_USD["1K"];
        // charged only now: a picture that failed above was never charged, so there is nothing to refund
        if (!(await paid(item))) continue;
        stats.drawn += 1;
        send({ index: item.index, image: dataUrl(small), cached: false });
      } catch (error) {
        if (signal?.aborted) return;
        stats.failed += 1;
        send({ index: item.index, error: String((error as Error)?.message ?? error).slice(0, 200) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.parallel ?? PREVIEW_PARALLEL, queue.length) }, worker));
  await setsRun;
  return stats;
}

/** Production dependencies: Gemini images, object storage, the pack's asset step with its material charge, and the per-picture charge. */
export async function livePreviewDeps(project: VideoProject, userId: string | null): Promise<PreviewDeps> {
  const { liveDeps } = await import("./pack-assets.ts");
  const assetDeps: PackAssetDeps = await liveDeps(project);
  const { geminiImage, toJpeg } = await import("./pack-assets-gemini.ts");
  const sharp = (await import("sharp")).default;
  const { stepBillingOnForProject } = await import("../billing/step-billing.ts");
  let charge: PreviewDeps["charge"];
  if (userId && stepBillingOnForProject(project)) {
    const { spendTokens } = await import("../tokens/store.ts");
    charge = async (usd, ref) => { await spendTokens(userId, materialCostMillitokensV2(usd), "material", `storyboard-preview:${ref}`, project.id); };
  }
  return {
    getObject: assetDeps.getObject, putObject: assetDeps.putObject, objectSize: assetDeps.objectSize,
    image: (prompt, refs, spec) => geminiImage(prompt, refs, spec),
    shrink: (data, width) => sharp(data).resize({ width, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer(),
    normalise: toJpeg,
    small: (data) => sharp(data).resize({ width: PREVIEW_SMALL_WIDTH, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer(),
    ...(charge ? { charge } : {}),
    sets: (specs) => generatePackAssets(project.id, specs, assetDeps)
  };
}

export type PreviewQuote = { previews: number; sets: number; previewMilli: number; setMilli: number; milli: number; tokens: number };

/**
 * What the storyboard previews will cost, before anything is drawn: only pictures not stored yet are counted (a stored one is free). The sets
 * are paid by the pack's asset step either way (Animation would draw them later), so they are listed apart from the previews.
 */
export async function quoteStoryboardPreviews(project: VideoProject, brief: ScriptBrief, beats: ScriptBeat[], wanted?: number[]): Promise<PreviewQuote | null> {
  const { templatePack } = await import("../plan/template-packs.ts");
  const pack = templatePack(brief.styleExample);
  if (pack?.storyboardPreviews !== "image" || !pack.assets || !pack.previewCast || !beats.length) return null;
  const { getObject, putObject, objectSize } = await import("../storage.ts");
  const { assetKeyFor } = await import("./pack-assets.ts");
  const plan = await planPreviews(project, pack, brief, beats, brief.scriptNotes ?? null, wanted ?? beats.map((_, i) => i), { getObject, putObject });
  const byName = new Map(plan.specs.map((spec) => [spec.name, spec]));
  const missingPreviews = (await Promise.all(plan.items.map(async (item) => (await objectSize("uploads", item.smallKey)) === null && (await objectSize("uploads", item.key)) === null))).filter(Boolean).length;
  const setNames = [...new Set(plan.items.map((item) => item.set))];
  const missingSets = (await Promise.all(setNames.map(async (name) => (await objectSize("uploads", assetKeyFor(project.id, setHashOf(byName.get(name)!, byName)))) === null))).filter(Boolean).length;
  const previewMilliTotal = missingPreviews * previewMilli(), setMilliTotal = missingSets * setMilli();
  const milli = previewMilliTotal + setMilliTotal;
  return { previews: missingPreviews, sets: missingSets, previewMilli: previewMilliTotal, setMilli: setMilliTotal, milli, tokens: Math.round(milli) / 1000 };
}
