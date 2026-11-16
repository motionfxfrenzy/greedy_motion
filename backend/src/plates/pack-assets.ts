// Pack-declared image assets (TemplatePack.assets): pictures generated once per project, stored with the plate artifacts, and read
// by that template's scenes with `env.image(name)`. Only packs that declare `assets` may use images; every other template keeps the
// "no images" rule.
//
//   startPlates / authoring -> plate-assets (backend queue) -> generatePackAssets: Gemini image per spec, in order, bounded parallel
//                                                           -> stored at plates/<project>/assets/<hash>.jpg (uploads bucket)
//                                                           -> spec.depth: plate-depth (worker queue) -> <hash>.depth.png (outputs)
//   authoring waits until the beat's pictures exist (never for depth), then bundles the scene against picture NAMES only
//   (manifest.assetNames). Whenever a scene is loaded, the names are resolved to the current files (resolveSceneAssets): the preview
//   (bundle route -> frontend/lib/live/api.ts) and the export worker (frozen export manifest -> worker/src/pack-assets.mjs) turn
//   them into data: URLs in window.__ASSETS__. A depth map that lands later, or a redrawn picture, is picked up on the next load
//   with no new authoring; caches add the pictures' digest to the bundle digest, so only scenes whose pictures changed redraw.
import { createHash } from "node:crypto";
import type { Job } from "pg-boss";
import type { VideoProject } from "@videosaas/contracts";
import { materialCostMillitokensV2 } from "@videosaas/contracts";
import { templatePack, type AssetSpec, type PackAssetsInput, type PackWord, type TemplatePack } from "../plan/template-packs.ts";
import { config } from "../config.ts";
import { primaryAspect, takeFor } from "./model.ts";

const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));

/** Keep in sync with QUEUES.plateAssets / QUEUES.plateDepth (jobs/queues.ts) and worker/src/depth.mjs. */
export const PLATE_ASSETS_QUEUE = "plate-assets";
export const PLATE_DEPTH_QUEUE = "plate-depth";
/** Bump to redraw every pack asset (changes every asset hash). */
export const PACK_ASSET_VERSION = 1;
export const ASSET_PARALLEL = Math.max(1, Number.parseInt(process.env.PACK_ASSET_PARALLEL ?? "4", 10) || 4);
/** List-price estimates per generated picture (gemini-3.1-flash-image); the real usage tokens are logged next to them. */
export const IMAGE_USD: Record<"1K" | "2K", number> = { "1K": 0.039, "2K": 0.067 };
export const TEXT_CHECK_MODEL = "gemini-2.5-flash";
/** How long a scene waits for its pictures at all before it fails with a message. */
export const ASSET_WAIT_MS = 20 * 60 * 1000;

// ------------------------------------------------------------------ names and keys

/** `set-gorge` -> `depth-gorge`; any other name -> `depth-<name>`. */
export const depthNameOf = (name: string) => (name.startsWith("set-") ? `depth-${name.slice(4)}` : `depth-${name}`);
export const assetPrefix = (projectId: string) => `plates/${projectId}/assets/`;
export const assetIndexKey = (projectId: string) => `${assetPrefix(projectId)}index.json`;
export const assetKeyFor = (projectId: string, hash: string) => `${assetPrefix(projectId)}${hash}.jpg`;
/** A smaller copy of a stored picture for the browser preview (the export always reads the full one). */
export const previewKeyFor = (projectId: string, hash: string) => `${assetPrefix(projectId)}${hash}.preview.jpg`;
export const depthKeyFor = (projectId: string, hash: string) => `${assetPrefix(projectId)}${hash}.depth.png`;
export const depthFailedKeyFor = (projectId: string, hash: string) => `${assetPrefix(projectId)}${hash}.depth.failed`;

/** Where a scene's picture lives: `u:` = uploads bucket (generated images), `o:` = outputs bucket (depth maps written by the worker). */
export type AssetRef = `u:${string}` | `o:${string}`;
export const parseAssetRef = (ref: string): { bucket: "uploads" | "outputs"; key: string } | null => {
  const m = /^([uo]):(plates\/[0-9a-f-]{36}\/assets\/[A-Za-z0-9_.-]+)$/i.exec(ref);
  return m ? { bucket: m[1] === "u" ? "uploads" : "outputs", key: m[2]! } : null;
};

/** Content hash of a spec: model, prompt, shape and its references' own hashes, so the same request is never paid for twice. */
export function assetHash(spec: AssetSpec, refHashes: string[], model = config.visualImageModel): string {
  return createHash("sha256")
    .update(JSON.stringify([PACK_ASSET_VERSION, model, spec.prompt, spec.aspect, spec.size ?? "1K", Boolean(spec.noText), ...(spec.noFigures ? ["nofig"] : []), refHashes]))
    .digest("hex")
    .slice(0, 32);
}

/** Digest of the specs a scene uses (and their references, recursively), so a changed picture request redraws only those scenes. */
export function specsDigest(specs: AssetSpec[], names?: string[]): string {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const wanted = new Set<string>();
  const visit = (name: string) => {
    const spec = byName.get(name);
    if (!spec || wanted.has(name)) return;
    wanted.add(name);
    for (const r of spec.refs ?? []) visit(r);
  };
  for (const name of names ?? specs.map((s) => s.name)) visit(name);
  const list = specs.filter((s) => wanted.has(s.name)).map((s) => [s.name, s.prompt, s.refs ?? [], s.aspect, s.size ?? "1K", Boolean(s.depth), Boolean(s.noText), ...(s.noFigures ? ["nofig"] : [])]);
  return createHash("sha256").update(JSON.stringify([PACK_ASSET_VERSION, list])).digest("hex").slice(0, 16);
}

/** Checks a pack's specs: unique names, the set/depth naming rule, and refs only to earlier specs. Throws with the first problem. */
export function validateSpecs(specs: AssetSpec[]): void {
  const seen = new Set<string>();
  for (const spec of specs) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(spec.name)) throw new Error(`Asset name "${spec.name}" must be lowercase letters, digits and dashes.`);
    if (spec.name.startsWith("depth-")) throw new Error(`Asset "${spec.name}": depth-* names are made from a set's depth map, not generated.`);
    if (seen.has(spec.name)) throw new Error(`Asset "${spec.name}" is declared twice.`);
    for (const ref of spec.refs ?? []) if (!seen.has(ref)) throw new Error(`Asset "${spec.name}" refers to "${ref}", which is not an earlier asset.`);
    if (spec.aspect !== "9:16" && spec.aspect !== "16:9") throw new Error(`Asset "${spec.name}" has aspect ${String(spec.aspect)}; use 9:16 or 16:9.`);
    seen.add(spec.name);
  }
}

// ------------------------------------------------------------------ inputs

/** The beats' word times from the voice takes (seconds from each scene's start), undefined where a beat has no timed take. */
export function packWords(project: VideoProject): (PackWord[] | undefined)[] {
  return (project.brief?.scriptBeats ?? []).map((_, i) => {
    const words = takeFor(project, i)?.words;
    return words?.length ? words.map((w) => ({ text: w.text, start: w.start, end: w.end })) : undefined;
  });
}

export function packAssetsInput(project: VideoProject, plan?: unknown): PackAssetsInput {
  return {
    ...(plan ? { plan } : {}),
    projectId: project.id,
    brief: project.brief!,
    beats: (project.brief?.scriptBeats ?? []) as PackAssetsInput["beats"],
    words: packWords(project),
    aspect: primaryAspect(project)
  };
}

/** The pack's asset specs for a project (validated), or [] when its template declares none. */
export function packSpecs(project: VideoProject, pack: TemplatePack | undefined = templatePack(project.brief?.styleExample), plan?: unknown): AssetSpec[] {
  if (!pack?.assets || !project.brief) return [];
  const specs = pack.assets(packAssetsInput(project, plan));
  validateSpecs(specs);
  return specs;
}

/**
 * The exact names a beat's scene may read: the pack's `sceneAssets`, plus `depth-<place>` for each listed set that has depth.
 * Without `sceneAssets`, a pack with assets gives every beat every name.
 */
export function sceneAssetNames(pack: TemplatePack | undefined, specs: AssetSpec[], beatIndex: number, beats: PackAssetsInput["beats"]): string[] {
  if (!pack?.assets) return [];
  const byName = new Map(specs.map((s) => [s.name, s]));
  const listed = pack.sceneAssets ? pack.sceneAssets(beatIndex, beats) : specs.map((s) => s.name);
  const out: string[] = [];
  for (const name of listed) {
    if (!out.includes(name)) out.push(name);
    const spec = byName.get(name);
    if (spec?.depth && !out.includes(depthNameOf(name))) out.push(depthNameOf(name));
  }
  return out;
}

/** A beat's allowed picture names and every picture name of the project (for wireSceneAssets), or empty lists for packs without assets. */
export function scenePictures(project: VideoProject, pack: TemplatePack | undefined, beatIndex: number): { names: string[]; all: string[]; specs: AssetSpec[] } {
  if (!pack?.assets) return { names: [], all: [], specs: [] };
  const specs = packSpecs(project, pack);
  const beats = (project.brief?.scriptBeats ?? []) as PackAssetsInput["beats"];
  const all = specs.flatMap((s) => (s.depth ? [s.name, depthNameOf(s.name)] : [s.name]));
  return { names: sceneAssetNames(pack, specs, beatIndex, beats), all, specs };
}

// ------------------------------------------------------------------ the stored index

export type AssetRecord = { name: string; hash: string; key: string; mime: string; size: "1K" | "2K"; depth?: { key: string; failedKey: string; queuedAt: string }; redrawn?: boolean; storedAt: string };
export type AssetIndex = {
  version: 1;
  /** specsDigest() of the whole list this index was made for. */
  digest: string;
  status: "generating" | "ready" | "failed";
  assets: Record<string, AssetRecord>;
  error?: string;
  usd: number;
  updatedAt: string;
};

export type AssetStorage = {
  getObject: (bucket: "uploads" | "outputs", key: string) => Promise<Buffer | null>;
  putObject: (bucket: "uploads" | "outputs", key: string, body: Buffer | string, contentType?: string) => Promise<void>;
  objectSize: (bucket: "uploads" | "outputs", key: string) => Promise<number | null>;
};

export async function readAssetIndex(projectId: string, storage: AssetStorage): Promise<AssetIndex | null> {
  const raw = await storage.getObject("uploads", assetIndexKey(projectId)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw.toString("utf8")) as AssetIndex; } catch { return null; }
}

// ------------------------------------------------------------------ generation

export type GeneratedImage = { data: Buffer; mime: string; usage?: unknown };
export type PackAssetDeps = AssetStorage & {
  /** One picture from the image model; refs are earlier assets' bytes. */
  image: (prompt: string, refs: { name: string; data: Buffer; mime: string }[], spec: AssetSpec) => Promise<GeneratedImage>;
  /** Words written in the picture that are not allowed (none allowed for noText specs), and the call's cost. */
  checkText: (image: Buffer, mime: string) => Promise<{ extra: string[]; figures?: string[]; usd: number | null }>;
  /** Queue the depth job for one stored set picture. */
  enqueueDepth: (job: DepthJob) => Promise<void>;
  /** Charge `usd` of provider cost as material (v2 step billing only); `ref` is unique per picture. */
  charge?: (usd: number, ref: string) => Promise<void>;
  /** Normalises the picture for storage (JPEG); identity in tests. */
  normalise?: (image: GeneratedImage) => Promise<{ data: Buffer; mime: string }>;
  /** Makes the smaller preview copy of a stored picture (JPEG bytes). */
  preview?: (data: Buffer) => Promise<Buffer>;
  parallel?: number;
  now?: () => Date;
};

export type DepthJob = { projectId: string; name: string; imageKey: string; depthKey: string; failedKey: string };

/**
 * Generates every spec of a pack for a project, in order (a spec starts once its refs are stored), ASSET_PARALLEL at a time. A picture
 * already stored under its hash is reused (free). noText pictures are read once by a cheap vision call and redrawn at most once.
 * Writes the index after every picture, so authoring sees each scene's pictures as soon as they exist.
 */
/**
 * Runs the charges one at a time. Pictures are drawn in parallel, but every charge takes the same per-user advisory lock and a database
 * connection; several at once can hold every connection of a small pool (staging runs 3) while the lock holder waits for one, which
 * hangs the whole backend. One at a time never does.
 */
export function serialCharge(charge: (usd: number, ref: string) => Promise<void>): (usd: number, ref: string) => Promise<void> {
  let tail: Promise<unknown> = Promise.resolve();
  return (usd, ref) => {
    const run = tail.catch(() => undefined).then(() => charge(usd, ref));
    tail = run;
    return run;
  };
}

export async function generatePackAssets(projectId: string, specs: AssetSpec[], rawDeps: PackAssetDeps): Promise<AssetIndex> {
  validateSpecs(specs);
  const deps: PackAssetDeps = rawDeps.charge ? { ...rawDeps, charge: serialCharge(rawDeps.charge) } : rawDeps;
  const now = deps.now ?? (() => new Date());
  const digest = specsDigest(specs);
  const previous = await readAssetIndex(projectId, deps);
  // Pictures of names still declared stay readable while they are redrawn: a scene keeps its current picture until the new one is stored.
  const names = new Set(specs.map((spec) => spec.name));
  const kept = Object.fromEntries(Object.entries(previous?.assets ?? {}).filter(([name]) => names.has(name)));
  const index: AssetIndex = { version: 1, digest, status: "generating", assets: kept, usd: 0, updatedAt: now().toISOString() };
  // Keep records whose hash still matches (written by an earlier run of this digest or another one).
  const prevByHash = new Map(Object.values(previous?.assets ?? {}).map((r) => [r.hash, r]));
  let writing = Promise.resolve();
  const save = () => {
    index.updatedAt = now().toISOString();
    const body = JSON.stringify(index);
    writing = writing.then(() => deps.putObject("uploads", assetIndexKey(projectId), body, "application/json"));
    return writing;
  };
  await save();

  const done = new Map<string, Promise<AssetRecord>>();
  const bytes = new Map<string, { data: Buffer; mime: string }>();
  let running = 0;
  const waiters: (() => void)[] = [];
  const slot = async () => { while (running >= (deps.parallel ?? ASSET_PARALLEL)) await new Promise<void>((r) => waiters.push(r)); running += 1; };
  const release = () => { running -= 1; waiters.shift()?.(); };

  const one = async (spec: AssetSpec): Promise<AssetRecord> => {
    const refs = await Promise.all((spec.refs ?? []).map((r) => done.get(r)!));
    const hash = assetHash(spec, refs.map((r) => r.hash));
    const key = assetKeyFor(projectId, hash);
    const size = spec.size ?? "1K";
    let record: AssetRecord | undefined;
    if ((await deps.objectSize("uploads", key)) !== null) {
      const prev = prevByHash.get(hash);
      record = { name: spec.name, hash, key, mime: prev?.mime ?? "image/jpeg", size, storedAt: prev?.storedAt ?? now().toISOString(), ...(prev?.redrawn ? { redrawn: true } : {}) };
      log("info", "pack_asset_cached", { projectId, name: spec.name, hash });
      if (deps.preview && (await deps.objectSize("uploads", previewKeyFor(projectId, hash))) === null) {
        const full = await deps.getObject("uploads", key).catch(() => null);
        if (full) await deps.putObject("uploads", previewKeyFor(projectId, hash), await deps.preview(full), "image/jpeg").catch(() => undefined);
      }
    } else {
      await slot();
      try {
        const refBytes = await Promise.all(refs.map(async (r) => {
          const have = bytes.get(r.name) ?? (await deps.getObject("uploads", r.key).then((d) => (d ? { data: d, mime: r.mime } : null)));
          if (!have) throw new Error(`Reference picture "${r.name}" is missing from storage.`);
          return { name: r.name, ...have };
        }));
        let redrawn = false;
        let picture = await drawOnce(projectId, spec, refBytes, deps, index);
        if (spec.noText || spec.allowedText?.length || spec.noFigures) {
          const check = await deps.checkText(picture.data, picture.mime).catch((error) => { log("warn", "pack_asset_check_failed", { projectId, name: spec.name, message: String((error as Error)?.message ?? error).slice(0, 200) }); return { extra: [] as string[], figures: [] as string[], usd: null }; });
          index.usd += check.usd ?? 0;
          const allowedWords = new Set((spec.allowedText ?? []).flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
          const stray = check.extra.filter((w) => !w.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).every((part) => allowedWords.has(part)));
          const figures = spec.noFigures ? (check.figures ?? []).slice(0, 6) : [];
          if (stray.length || figures.length) {
            log("info", "pack_asset_redraw", { projectId, name: spec.name, extra: stray.slice(0, 8) });
            picture = await drawOnce(projectId, spec, refBytes, deps, index, (stray.length ? `\n\nABSOLUTELY NO ${allowedWords.size ? "OTHER " : ""}WRITING: the last attempt had the words ${stray.slice(0, 6).map((w) => `"${w}"`).join(", ")} in it. ${allowedWords.size ? `Only these words may appear: ${(spec.allowedText ?? []).join(", ")}.` : "No letters, numbers, labels, signs or captions anywhere."}` : "") + (figures.length ? `\n\nABSOLUTELY NO PEOPLE, CHARACTERS, ANIMALS, VEHICLES OR STORY PROPS: the last attempt had ${figures.map((f) => `"${f}"`).join(", ")} in it. Draw only the empty place: scenery and ground, nothing that moves, no rope or wire strung across.` : ""));
            redrawn = true;
          }
        }
        const stored = deps.normalise ? await deps.normalise(picture) : { data: picture.data, mime: picture.mime };
        await deps.putObject("uploads", key, stored.data, stored.mime);
        if (deps.preview) await deps.putObject("uploads", previewKeyFor(projectId, hash), await deps.preview(stored.data), "image/jpeg").catch(() => undefined);
        bytes.set(spec.name, stored);
        record = { name: spec.name, hash, key, mime: stored.mime, size, storedAt: now().toISOString(), ...(redrawn ? { redrawn: true } : {}) };
      } finally {
        release();
      }
    }
    if (spec.depth) {
      const depthKey = depthKeyFor(projectId, hash), failedKey = depthFailedKeyFor(projectId, hash);
      const prev = prevByHash.get(hash)?.depth;
      record.depth = { key: depthKey, failedKey, queuedAt: prev?.queuedAt ?? now().toISOString() };
      const exists = (await deps.objectSize("outputs", depthKey)) !== null || (await deps.objectSize("outputs", failedKey)) !== null;
      if (!exists) {
        await deps.enqueueDepth({ projectId, name: depthNameOf(spec.name), imageKey: key, depthKey, failedKey });
        record.depth.queuedAt = now().toISOString();
      }
    }
    index.assets[spec.name] = record;
    await save();
    return record;
  };

  try {
    for (const spec of specs) done.set(spec.name, one(spec));
    const results = await Promise.allSettled([...done.values()]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
    index.status = "ready";
    await save();
    log("info", "pack_assets_ready", { projectId, count: specs.length, usd: Math.round(index.usd * 1000) / 1000 });
    return index;
  } catch (error) {
    index.status = "failed";
    index.error = String((error as Error)?.message ?? error).slice(0, 500);
    await save().catch(() => undefined);
    log("warn", "pack_assets_failed", { projectId, message: index.error });
    throw error;
  }
}

async function drawOnce(projectId: string, spec: AssetSpec, refs: { name: string; data: Buffer; mime: string }[], deps: PackAssetDeps, index: AssetIndex, extra = ""): Promise<GeneratedImage> {
  const started = Date.now();
  const picture = await deps.image(spec.prompt + extra, refs, spec);
  const usd = IMAGE_USD[spec.size ?? "1K"];
  index.usd += usd;
  // The same line shape as every other model call (providers.ts callModel), so cost dashboards pick it up.
  console.info(JSON.stringify({ event: "model_usage", step: "packAsset", provider: "gemini", model: config.visualImageModel, usage: picture.usage ?? null, usd, ms: Date.now() - started, project: projectId, asset: spec.name }));
  if (deps.charge) await deps.charge(usd, `${projectId}:${spec.name}:${createHash("sha256").update(spec.prompt + extra).digest("hex").slice(0, 12)}`);
  return picture;
}

// ------------------------------------------------------------------ what a scene may read, and waiting for it

export type SceneAssetState =
  | { state: "none" }
  | { state: "wait"; reason: string }
  | { state: "failed"; message: string }
  | { state: "ready" };

/**
 * Whether a beat's scene may be bundled: every listed picture stored. Depth maps are never waited for: the scene is written against
 * names only and draws flat until its depth map exists (the preview and the export pick it up by name when it lands).
 */
export async function sceneAssetState(projectId: string, names: string[], storage: AssetStorage): Promise<SceneAssetState> {
  const pictures = names.filter((n) => !n.startsWith("depth-"));
  if (!pictures.length) return { state: "none" };
  const index = await readAssetIndex(projectId, storage);
  if (!index) return { state: "wait", reason: "pictures not started" };
  for (const name of pictures) {
    if (index.assets[name]) continue;
    if (index.status === "failed") return { state: "failed", message: index.error ?? "The pictures for this film could not be made." };
    if (index.status === "ready") return { state: "failed", message: `The picture "${name}" is not one this template made.` };
    return { state: "wait", reason: `picture ${name}` };
  }
  return { state: "ready" };
}

/**
 * The pictures a scene reads RIGHT NOW, by name: the current stored picture of each listed name and the depth maps that exist.
 * Resolved when a scene is loaded (preview: the bundle route; export: the frozen export manifest; clip: the worker's control op),
 * never baked into the scene's bundle, so a depth map that lands later or a redrawn picture is picked up without authoring again.
 * `digest` names exactly these pictures: hosts add it to their cache identity (preview frame store, export clip cache).
 */
export async function resolveSceneAssets(projectId: string, names: string[], storage: AssetStorage): Promise<{ refs: Record<string, AssetRef>; digest: string | null }> {
  if (!names.length) return { refs: {}, digest: null };
  const index = await readAssetIndex(projectId, storage);
  const refs: Record<string, AssetRef> = {};
  if (index) {
    const byDepth = new Map(Object.values(index.assets).filter((r) => r.depth).map((r) => [depthNameOf(r.name), r]));
    for (const name of [...names].sort()) {
      const record = index.assets[name];
      if (record) { refs[name] = `u:${record.key}`; continue; }
      const owner = byDepth.get(name);
      if (owner?.depth && (await storage.objectSize("outputs", owner.depth.key).catch(() => null)) !== null) refs[name] = `o:${owner.depth.key}`;
    }
  }
  const digest = createHash("sha256").update(JSON.stringify(Object.entries(refs).sort(([a], [b]) => (a < b ? -1 : 1)))).digest("hex").slice(0, 16);
  return { refs, digest };
}

// ------------------------------------------------------------------ scene code: names and wiring

/** The film's `assets: { images: { ... } }` (a flat object literal; `{}` is what scenes are asked to write). */
const ASSETS_DECL_RE = /assets\s*:\s*\{\s*images\s*:\s*\{[^{}]*\}\s*(,\s*)?\}/;

/**
 * Checks a scene's use of pictures against the names it may use, and wires its `assets` to the host's preloaded pictures.
 * - `env.image("x")` with a name outside `allowed` is a repairable error (templates without pictures pass through unchanged);
 * - a string literal that names another of the project's pictures is refused too (a name passed through a variable);
 * - the module's `assets: { images: {...} }` (scenes write `{}`) becomes the host's map (window.__ASSETS__), so only pictures that
 *   exist are loaded and a missing one never stops the page.
 */
export function wireSceneAssets(code: string, allowed: string[], projectNames: string[] = []): string {
  const repairable = (message: string) => Object.assign(new Error(message), { repairable: true });
  const uses = [...code.matchAll(/\benv\s*\.\s*image\s*\??\.?\s*\(\s*(["'`])([^"'`]*)\1/g)].map((m) => m[2]!);
  // Templates without pictures are left exactly as before (their contract already says "no images"; nothing loads without __ASSETS__).
  if (!allowed.length) return code;
  const bad = uses.filter((n) => !allowed.includes(n));
  const others = projectNames.filter((n) => !allowed.includes(n) && new RegExp(`["'\`]${n.replace(/[-]/g, "\\-")}["'\`]`).test(code));
  if (bad.length || others.length) throw repairable(`This scene may only read these pictures: ${allowed.join(", ")}. Not allowed: ${[...new Set([...bad, ...others])].join(", ")}.`);
  if (!ASSETS_DECL_RE.test(code)) throw repairable("Export `assets: { images: {} }` exactly (the pictures are supplied by the host); read them only with env.image(name).");
  return code.replace(ASSETS_DECL_RE, "assets: { images: ((globalThis as any).__ASSETS__ ?? {}) as Record<string, string> }");
}

/** Prompt lines for a pack scene with pictures: the exact names and how to read them. */
export function sceneAssetsRule(names: string[]): string {
  if (!names.length) return "";
  const depth = names.filter((n) => n.startsWith("depth-"));
  return [
    `PICTURES: this scene may read exactly these pictures, and no others: ${names.map((n) => `"${n}"`).join(", ")}.`,
    "Read one with `const img = env.image(\"<name>\")` inside draw and draw it with ctx.drawImage(img, ...). It returns undefined when a picture is not available: always handle that (skip the picture, or draw a plain fill).",
    ...(depth.length ? ["A depth-* picture is the set's depth map (8-bit grey, near = white, same size as the set). It may be missing: then draw the set flat (no parallax), never fail."] : []),
    "Keep `assets: { images: {} }` in the film export exactly as written: the host supplies the pictures."
  ].join("\n");
}

// ------------------------------------------------------------------ the queue

export type AssetsMessage = { projectId: string; digest: string };

/** Production dependencies: Gemini, object storage, the depth queue, and material billing on v2 step billing. */
export async function liveDeps(project: VideoProject): Promise<PackAssetDeps> {
  const [{ getObject, putObject, objectSize }, { sendOnce }, { kickPlateWorkers }] = await Promise.all([import("../storage.ts"), import("../jobs/queues.ts"), import("../jobs/worker-launcher.ts")]);
  const { geminiImage, geminiTextCheck, toJpeg, toPreviewJpeg } = await import("./pack-assets-gemini.ts");
  const charge = await materialCharge(project);
  return {
    getObject, putObject, objectSize,
    image: (prompt, refs, spec) => geminiImage(prompt, refs, spec),
    checkText: (image, mime) => geminiTextCheck(image, mime),
    normalise: toJpeg,
    preview: toPreviewJpeg,
    enqueueDepth: async (job) => {
      await sendOnce(null, PLATE_DEPTH_QUEUE, job, job.depthKey);
      void kickPlateWorkers(true).catch(() => undefined);
    },
    ...(charge ? { charge } : {})
  };
}

/** Under v2_step_tier billing, generated pictures are charged as material (materialCostMillitokensV2); under v1, nothing extra. */
async function materialCharge(project: VideoProject): Promise<PackAssetDeps["charge"] | undefined> {
  const { stepBillingOnForProject } = await import("../billing/step-billing.ts");
  if (!stepBillingOnForProject(project)) return undefined;
  const [{ projectOwnerById }, { spendTokens }] = await Promise.all([import("../projects/store.ts"), import("../tokens/store.ts")]);
  const owner = await projectOwnerById(project.id);
  if (!owner) return undefined;
  return async (usd, ref) => { await spendTokens(owner, materialCostMillitokensV2(usd), "material", `pack-asset:${ref}`, project.id); };
}

// ------------------------------------------------------------------ a pack's own shot plan

export const shotPlanKey = (projectId: string) => `${assetPrefix(projectId)}shot-plan.json`;
const planHash = (project: VideoProject) => createHash("sha256").update(JSON.stringify([(project.brief?.scriptBeats ?? []).map((b) => [b.line, b.visual]), project.brief?.scriptNotes ?? null])).digest("hex").slice(0, 16);

/**
 * The plan of a pack that plans its pictures with one cheap model call (TemplatePack.shotPlan), stored with the project and reused until the
 * script changes. Anything that goes wrong falls back to the script's own VISUAL lines (the pack's planFromScript), so the film never waits on it.
 */
const planFlights = new Map<string, Promise<unknown | undefined>>();
export function loadShotPlan(project: VideoProject, pack: TemplatePack | undefined, deps: Pick<AssetStorage, "getObject" | "putObject"> & { call?: (request: { system: string; user: string; maxTokens: number }) => Promise<{ text: string; usd: number | null }> }): Promise<unknown | undefined> {
  // One planning call per project and script at a time: the enqueue step and the asset job both ask for the plan right after the script,
  // and two model calls give two different plans, which gives two different sets of picture prompts (every picture drawn and charged twice).
  const key = `${project.id}:${planHash(project)}`;
  const running = planFlights.get(key);
  if (running) return running;
  const flight = loadShotPlanOnce(project, pack, deps).finally(() => planFlights.delete(key));
  planFlights.set(key, flight);
  return flight;
}
async function loadShotPlanOnce(project: VideoProject, pack: TemplatePack | undefined, deps: Pick<AssetStorage, "getObject" | "putObject"> & { call?: (request: { system: string; user: string; maxTokens: number }) => Promise<{ text: string; usd: number | null }> }): Promise<unknown | undefined> {
  if (!pack?.shotPlan || !project.brief?.scriptBeats?.length) return undefined;
  const hash = planHash(project);
  const stored = await deps.getObject("uploads", shotPlanKey(project.id)).catch(() => null);
  if (stored) { try { const v = JSON.parse(stored.toString("utf8")) as { hash?: string; plan?: unknown }; if (v.hash === hash && v.plan) return v.plan; } catch { /* planned again */ } }
  try {
    const call = deps.call ?? (await import("./pack-assets-gemini.ts")).geminiShotPlan;
    const beats = project.brief.scriptBeats, notes = project.brief.scriptNotes ?? null;
    const reply = await call(pack.shotPlan.request(beats, notes));
    const plan = pack.shotPlan.parse(reply.text, beats, notes);
    // another process may have stored the plan for this script while the call ran: theirs wins, so every reader sees the same one
    const winner = await deps.getObject("uploads", shotPlanKey(project.id)).catch(() => null);
    if (winner) { try { const w = JSON.parse(winner.toString("utf8")) as { hash?: string; plan?: unknown }; if (w.hash === hash && w.plan) return w.plan; } catch { /* ours */ } }
    await deps.putObject("uploads", shotPlanKey(project.id), JSON.stringify({ hash, plan }), "application/json");
    log("info", "pack_shot_plan", { projectId: project.id, usd: reply.usd });
    return plan;
  } catch (error) {
    log("warn", "pack_shot_plan_failed", { projectId: project.id, message: String((error as Error)?.message ?? error).slice(0, 200) });
    return undefined;
  }
}

// ------------------------------------------------------------------ comments on template-written scenes

export const assetNotesKey = (projectId: string) => `${assetPrefix(projectId)}notes.json`;
type AssetNotes = Record<string, string[]>;

export async function readAssetNotes(projectId: string, storage: Pick<AssetStorage, "getObject">): Promise<AssetNotes> {
  const raw = await storage.getObject("uploads", assetNotesKey(projectId)).catch(() => null);
  if (!raw) return {};
  try { const v = JSON.parse(raw.toString("utf8")) as AssetNotes; return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

/** Specs with the viewer's corrections added to the named pictures' prompts (a changed prompt = a new hash, so only those pictures are redrawn). */
export function applyAssetNotes(specs: AssetSpec[], notes: AssetNotes): AssetSpec[] {
  return specs.map((s) => notes[s.name]?.length ? { ...s, prompt: `${s.prompt}\n\nCORRECTION FROM THE VIEWER (apply it, keep everything else the same): ${notes[s.name]!.join(" / ")}` } : s);
}

/** A comment on a scene whose code the template writes itself: its pictures are redrawn with the note. Returns the names. */
export async function noteScenePictures(project: VideoProject, beatIndex: number, note: string): Promise<string[]> {
  const pack = templatePack(project.brief?.styleExample);
  const { getObject, putObject } = await import("../storage.ts");
  const names = scenePictures(project, pack, beatIndex).names.filter((n) => !n.startsWith("depth-"));
  if (!names.length) return [];
  const notes = await readAssetNotes(project.id, { getObject });
  for (const n of names) notes[n] = [...(notes[n] ?? []), note.slice(0, 400)].slice(-3);
  await putObject("uploads", assetNotesKey(project.id), JSON.stringify(notes), "application/json");
  await ensurePackAssets(project, { retryFailed: true });
  return names;
}

/** Queues the asset step for a project whose template declares assets (idempotent per spec digest). Returns the digest, or null. */
export async function ensurePackAssets(project: VideoProject, options: { retryFailed?: boolean } = {}): Promise<string | null> {
  const pack = templatePack(project.brief?.styleExample);
  if (!pack?.assets) return null;
  const { getObject, putObject } = await import("../storage.ts");
  const plan = await loadShotPlan(project, pack, { getObject, putObject });
  const specs = applyAssetNotes(packSpecs(project, pack, plan), await readAssetNotes(project.id, { getObject }));
  if (!specs.length) return null;
  const digest = specsDigest(specs);
  const index = await readAssetIndex(project.id, { getObject, putObject: async () => undefined, objectSize: async () => null });
  if (index?.digest === digest && (index.status !== "failed" || options.retryFailed === false)) return digest;
  const { sendOnce } = await import("../jobs/queues.ts");
  await sendOnce(null, PLATE_ASSETS_QUEUE, { projectId: project.id, digest } satisfies AssetsMessage, `${project.id}:${digest}`);
  return digest;
}

export async function handlePackAssets(job: Job<AssetsMessage>): Promise<void> {
  const { projectId } = job.data ?? ({} as AssetsMessage);
  if (typeof projectId !== "string") return;
  const { getProject } = await import("../projects/store.ts");
  const project = await getProject(projectId);
  if (!project?.brief) return;
  const { getObject, putObject } = await import("../storage.ts");
  const plan = await loadShotPlan(project, templatePack(project.brief?.styleExample), { getObject, putObject });
  const specs = applyAssetNotes(packSpecs(project, undefined, plan), await readAssetNotes(project.id, { getObject }));
  if (!specs.length) return;
  if (specsDigest(specs) !== job.data.digest) return; // the beats changed since: a newer message carries the new digest
  try {
    await generatePackAssets(projectId, specs, await liveDeps(project));
  } catch (error) {
    // Out of tokens is final; anything else is retried by pg-boss (stored pictures are reused, so a retry pays only for the rest).
    if ((error as Error)?.name === "InsufficientTokens" || (error as { needed?: number }).needed !== undefined) return;
    throw error;
  }
}

/**
 * A clip or still drawn before its template pictures were injected (a worker without the picture code, or a clip made while a picture was
 * missing) shows an empty frame. The worker marks a picture clip with `timings.picturesClip` (control op plate.drawn, when it sent a
 * pictures cache digest); a scene with pictures and no mark has no usable clip, so the preview plays it live and an export redraws it.
 */
export const staleClip = (row: { bundle_manifest?: Record<string, unknown> | null; timings?: Record<string, unknown> | null }): boolean =>
  Array.isArray(row.bundle_manifest?.assetNames) && (row.bundle_manifest!.assetNames as unknown[]).length > 0 && row.timings?.picturesClip !== true;
