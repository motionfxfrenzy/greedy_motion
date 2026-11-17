// Storyboard previews (TemplatePack.storyboardPreviews = "cast"): while the storyboard builds, the image model paints ONLY the pack's real sets for
// the places in the plan (the same specs, keys and digest the Animation step computes later, so Animation finds them stored and neither draws nor charges
// them again). Each storyboard card is then the beat's set with our kit's puppets drawn on top IN THE BROWSER (frontend/lib/storyboard-preview): no model
// call, no charge, and an edited beat re-poses at once. Nothing here draws a character.
// Charging: the sets are charged by the pack's asset step (one material charge per picture, 30% margin, idempotent per picture); the previews add nothing.
import type { ScriptBeat, ScriptBrief, VideoProject } from "@videosaas/contracts";
import { materialCostMillitokensV2 } from "@videosaas/contracts";
import type { AssetSpec, TemplatePack } from "../plan/template-packs.ts";
import {
  IMAGE_USD, applyAssetNotes, assetHash, assetKeyFor, generatePackAssets, loadShotPlan, packSpecs, readAssetIndex, readAssetNotes, sceneAssetNames,
  type AssetIndex, type AssetStorage, type PackAssetDeps
} from "./pack-assets.ts";

/** The set picture the page shows is a JPEG this wide (about 40 KB), sent as a data URL; the full 2K picture stays in storage. */
export const PREVIEW_SET_WIDTH = 540;

/** The material price of one set picture in millitokens (2K picture, v2 step billing, 30% margin floor). */
export const setMilli = () => materialCostMillitokensV2(IMAGE_USD["2K"]);

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

export type PreviewPlan = {
  /** The pack's asset specs for this script (the exact list Animation will compute). */
  specs: AssetSpec[];
  /** Per wanted beat: the set it stands in and that set's content hash. */
  items: { index: number; set: string; setHash: string }[];
};

export async function planPreviews(
  project: VideoProject, pack: TemplatePack, brief: ScriptBrief, beats: ScriptBeat[], notes: unknown, wanted: number[],
  storage: Pick<AssetStorage, "getObject" | "putObject">
): Promise<PreviewPlan> {
  const synthetic = projectForPreviews(project, brief, beats, notes);
  const plan = await loadShotPlan(synthetic, pack, storage);
  const specs = applyAssetNotes(packSpecs(synthetic, pack, plan), await readAssetNotes(project.id, storage));
  const byName = new Map(specs.map((s) => [s.name, s]));
  const items = wanted.flatMap((index) => {
    if (!beats[index]) return [];
    const set = sceneAssetNames(pack, specs, index, beats as never).find((n) => byName.has(n) && !n.startsWith("depth-"));
    const spec = set ? byName.get(set) : undefined;
    return set && spec ? [{ index, set, setHash: setHashOf(spec, byName) }] : [];
  });
  return { specs, items };
}

export type PreviewDeps = AssetStorage & {
  /** The set picture made small for the page (a JPEG of at most `PREVIEW_SET_WIDTH` px). */
  small: (data: Buffer) => Promise<Buffer>;
  /** Draws or reuses the sets (the pack's real asset step, with its material charge). */
  sets: (specs: AssetSpec[]) => Promise<AssetIndex>;
  /** Whether the person can pay `neededMilli` for the sets (null = no gate: not on step billing). Checked once before any set is painted, so nothing is half-paid. */
  afford?: (neededMilli: number) => Promise<{ ok: boolean; remainingMilli: number }>;
  /** Poll interval while waiting for a set that is still being drawn. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type PreviewEvent =
  /** Which set each beat stands in (sent first, at once). */
  | { plan: { index: number; set: string }[] }
  /** A set picture is ready: `image` is a data URL. Every card of that place can now be drawn. */
  | { set: string; image: string; cached: boolean }
  /** A set could not be made or paid for: its cards keep their key phrase. */
  | { setError: string; set: string }
  /** The sets cannot be painted because the balance is short: the page says so (and offers the top-up) instead of leaving cards that look unfinished without a reason. Tokens, not millitokens. */
  | { notice: { code: "insufficient_tokens"; message: string; needed: number; remaining: number } };

export const noTokensNotice = (neededMilli: number, remainingMilli: number): Extract<PreviewEvent, { notice: unknown }> => {
  const needed = Math.round(neededMilli) / 1000, remaining = Math.round(Math.max(0, remainingMilli)) / 1000;
  return { notice: { code: "insufficient_tokens", needed, remaining, message: `Sets need ${needed} tokens and you have ${remaining}. Add tokens to paint the real sets; until then the cards show their key phrase.` } };
};

export type PreviewStats = { cached: number; drawn: number; failed: number; setsFailed: string | null; stopped: "tokens" | null };

const dataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const isInsufficient = (error: unknown) => (error as Error)?.name === "InsufficientTokens" || (error as { needed?: number })?.needed !== undefined;

/**
 * Makes sure the sets of `plan.items` exist and streams each to the page as `{ set, image }` the moment it is stored. A set already stored is sent
 * at once and costs nothing. Never throws for one set: a set that cannot be made sends `{ setError }` and its cards keep their key phrase.
 */
export async function runStoryboardSets(
  projectId: string, plan: PreviewPlan, deps: PreviewDeps, send: (event: PreviewEvent) => void, signal?: AbortSignal
): Promise<PreviewStats> {
  const stats: PreviewStats = { cached: 0, drawn: 0, failed: 0, setsFailed: null, stopped: null };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  send({ plan: plan.items.map((i) => ({ index: i.index, set: i.set })) });

  const wanted = new Map<string, string>(); // set name -> hash
  for (const item of plan.items) wanted.set(item.set, item.setHash);
  const sent = new Set<string>();
  const deliver = async (name: string, key: string, cached: boolean): Promise<boolean> => {
    if (sent.has(name)) return true;
    const full = await deps.getObject("uploads", key).catch(() => null);
    if (!full) return false;
    sent.add(name);
    send({ set: name, image: dataUrl(await deps.small(full)), cached });
    if (cached) stats.cached += 1; else stats.drawn += 1;
    return true;
  };

  // 1. sets already stored: shown at once, free
  for (const [name, hash] of wanted) {
    const key = assetKeyFor(projectId, hash);
    if ((await deps.objectSize("uploads", key)) !== null) await deliver(name, key, true);
  }
  if (sent.size === wanted.size) return stats;

  // 1b. the rest cost tokens: with a short balance nothing is painted (and nothing half-paid); the page is told why
  if (deps.afford) {
    const needed = (wanted.size - sent.size) * setMilli(), balance = await deps.afford(needed).catch(() => null);
    if (balance && !balance.ok) { stats.stopped = "tokens"; send(noTokensNotice(needed, balance.remainingMilli)); return stats; }
  }

  // 2. the rest through the pack's real asset step; each set is sent as its record lands in the index
  let done = false, error: string | null = null;
  const run = deps.sets(plan.specs).then(() => undefined, (e) => { error = String((e as Error)?.message ?? e).slice(0, 300); stats.setsFailed = error; if (isInsufficient(e)) stats.stopped = "tokens"; }).finally(() => { done = true; });
  for (;;) {
    if (signal?.aborted) break;
    const index = await readAssetIndex(projectId, deps);
    for (const [name, hash] of wanted) {
      const record = index?.assets[name];
      if (!sent.has(name) && record && record.hash === hash) await deliver(name, record.key, false);
    }
    if (sent.size === wanted.size) break;
    if (done) break;
    await sleep(deps.pollMs ?? 700);
  }
  await run;
  // a set that never landed (the step failed or stopped): its cards keep their key phrase
  if (stats.stopped === "tokens" && sent.size < wanted.size) send(noTokensNotice((wanted.size - sent.size) * setMilli(), 0));
  for (const name of wanted.keys()) if (!sent.has(name)) { stats.failed += 1; send({ setError: error ?? "The set picture is not ready.", set: name }); }
  return stats;
}

/** Production dependencies: object storage and the pack's asset step with its material charge. */
export async function livePreviewDeps(project: VideoProject, userId?: string | null): Promise<PreviewDeps> {
  const { liveDeps } = await import("./pack-assets.ts");
  const assetDeps: PackAssetDeps = await liveDeps(project);
  const sharp = (await import("sharp")).default;
  const stepBilling = (await import("../billing/step-billing.ts")).stepBillingOnForProject(project);
  return {
    getObject: assetDeps.getObject, putObject: assetDeps.putObject, objectSize: assetDeps.objectSize,
    small: (data) => sharp(data).resize({ width: PREVIEW_SET_WIDTH, withoutEnlargement: true }).jpeg({ quality: 76, mozjpeg: true }).toBuffer(),
    ...(userId && stepBilling ? { afford: async (neededMilli: number) => { const { tokenSummary } = await import("../tokens/store.ts"); const remainingMilli = Math.round((await tokenSummary(userId, 0)).remaining * 1000); return { ok: remainingMilli >= neededMilli, remainingMilli }; } } : {}),
    sets: (specs) => generatePackAssets(project.id, specs, assetDeps)
  };
}

export type PreviewQuote = { sets: number; setMilli: number; milli: number; tokens: number };

/**
 * What the storyboard step costs before anything is drawn: only the sets not stored yet (a stored one is free). Animation would draw the same sets
 * later, so this is not an extra cost, it is paid earlier. The cast drawn on the cards costs nothing.
 */
export async function quoteStoryboardPreviews(project: VideoProject, brief: ScriptBrief, beats: ScriptBeat[], wanted?: number[]): Promise<PreviewQuote | null> {
  const { templatePack } = await import("../plan/template-packs.ts");
  const pack = templatePack(brief.styleExample);
  if (pack?.storyboardPreviews !== "cast" || !pack.assets || !beats.length) return null;
  const { getObject, putObject, objectSize } = await import("../storage.ts");
  const plan = await planPreviews(project, pack, brief, beats, brief.scriptNotes ?? null, wanted ?? beats.map((_, i) => i), { getObject, putObject });
  const hashes = new Map(plan.items.map((item) => [item.set, item.setHash]));
  const missing = (await Promise.all([...hashes].map(async ([, hash]) => (await objectSize("uploads", assetKeyFor(project.id, hash))) === null))).filter(Boolean).length;
  const milli = missing * setMilli();
  return { sets: missing, setMilli: milli, milli, tokens: Math.round(milli) / 1000 };
}
