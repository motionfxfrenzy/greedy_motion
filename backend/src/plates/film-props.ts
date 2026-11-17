// Recurring props are one object across the whole film (owner rule: when the script shows the SAME object it must look identical scene to scene, and
// change only where the script says it changes). Like the cast, they are decided and drawn ONCE per film:
//  1. a cheap plan call reads the beats' VISUAL lines and lists the props that recur (id, the words that name it, its look, and a new version only where
//     the script rebuilds or replaces it);
//  2. one code call writes each prop's drawing once, as `K.defineProp(id, { w, h, versions })` calls in a film-level module;
//  3. every scene bundle includes that module right after the kit and calls the prop by id: K.prop(g, cam, { use: "magnetron", version, x, y, on });
//  4. a scene that names a recurring prop but draws it with its own code fails the pack's scene check (prop-check.ts) and gets one repair round.
// The result is cached per film in storage (the plan and the module), so every scene of the film (they are authored in parallel) reads the same one.
import { createHash } from "node:crypto";
import type { ScriptBeat, VideoProject } from "@videosaas/contracts";
import type { AssetStorage } from "./pack-assets.ts";

export const FILM_PROPS_VERSION = 1;
export const MAX_FILM_PROPS = 4;

export type PropVersion = { version: string; /** First beat (0-based) that shows this version. */ from: number; description: string };
export type PropPlanItem = { id: string; name: string; /** Words a VISUAL uses for it (lower case, 3+ letters). */ aliases: string[]; description: string; versions: PropVersion[] };
export type PropPlan = { props: PropPlanItem[] };
export type FilmProps = { plan: PropPlan; code: string; hash: string };

const TAG = /^\s*\[[^\]]*\]\s*/;
/** Words too general to name one object: "the metal box" must not claim every box of the film. */
const GENERIC = new Set(["box", "boxes", "thing", "things", "machine", "device", "object", "item", "unit", "tool", "stuff", "one", "big", "small", "large", "metal", "steel", "the"]);
const words = (text: string) => (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []);

// ------------------------------------------------------------------ the plan
export function propsPlanRequest(beats: readonly Pick<ScriptBeat, "line" | "visual" | "keyword">[], notes?: { idea?: string | null; objects?: string | null } | null) {
  const list = beats.map((b, i) => `${i + 1}. ${(b.visual ?? b.keyword ?? "").replace(TAG, "")}`).join("\n");
  return {
    system: [
      "You plan the RECURRING PROPS of a short animated history film: the inanimate objects that the script shows in two or more scenes (a microwave oven, a lantern, a crate, a barrel, a letter).",
      "Reply with JSON only: {\"props\":[{\"id\":\"magnetron\",\"name\":\"the magnetron box\",\"aliases\":[\"magnetron\",\"box\"],\"description\":\"a squat grey metal box with a round yellow window and a blue indicator light\",\"versions\":[{\"from\":1,\"description\":\"...\"},{\"from\":6,\"description\":\"...\"}]}]}",
      "Rules:",
      "- id: lowercase letters, digits or dashes, 3-20 characters. aliases: the DISTINCT words the scene lines use for this object (lowercase, 3+ letters, specific nouns only: \"magnetron\", \"microwave\", \"lantern\"; never a verb, a person, or a general word like box, thing, machine).",
      "- Only objects that really recur (two or more scenes) and that a code drawing can show (not people, not the place, not scenery the set picture already shows). At most 4, the most important first.",
      "- versions: ONE version unless the script says the object is rebuilt, replaced, or becomes something else (\"Raytheon built a seven-hundred-pound metal box\" is a NEW object). `from` is the 1-based scene where that version first appears; the first version starts at the first scene that shows it.",
      "- description: shape, size, colours and parts in 15-40 words, concrete enough to draw: flat cut-out cartoon style. No text or labels on the object.",
      "If no object recurs, answer {\"props\":[]}."
    ].join("\n"),
    user: `${notes?.idea ? `IDEA: ${notes.idea}\n` : ""}${notes?.objects ? `OBJECTS: ${notes.objects}\n` : ""}SCENES (what each shows):\n${list}`,
    maxTokens: 1500
  };
}

export function parsePropsPlan(reply: string, beatCount: number): PropPlan {
  let raw: any;
  try { raw = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? "{}"); } catch { return { props: [] }; }
  const props: PropPlanItem[] = [];
  for (const p of Array.isArray(raw?.props) ? raw.props : []) {
    const id = String(p?.id ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
    if (id.length < 3 || props.some((q) => q.id === id)) continue;
    const aliases = [...new Set<string>([id, ...(Array.isArray(p?.aliases) ? p.aliases : []).map((a: unknown) => String(a).toLowerCase().trim())].filter((a) => /^[a-z][a-z'-]{2,}$/.test(a) && !GENERIC.has(a)))].slice(0, 8);
    const versions = (Array.isArray(p?.versions) ? p.versions : [])
      .map((v: any) => ({ from: Math.max(0, Math.min(beatCount - 1, Math.round(Number(v?.from ?? 1)) - 1)), description: String(v?.description ?? "").slice(0, 400) }))
      .filter((v: { description: string }) => v.description)
      .sort((a: { from: number }, b: { from: number }) => a.from - b.from)
      .filter((v: { from: number }, i: number, all: { from: number }[]) => i === 0 || v.from > all[i - 1]!.from)
      .map((v: { from: number; description: string }, i: number): PropVersion => ({ version: String(i + 1), from: v.from, description: v.description }));
    const description = String(p?.description ?? versions[0]?.description ?? "").slice(0, 400);
    if (!description) continue;
    if (!versions.length) versions.push({ version: "1", from: 0, description });
    props.push({ id, name: String(p?.name ?? id).slice(0, 60), aliases, description, versions });
    if (props.length >= MAX_FILM_PROPS) break;
  }
  return { props };
}

/** The version of a prop a beat shows: the latest version that has begun by that beat (before its first appearance, version 1). */
export function propVersionForBeat(prop: PropPlanItem, beatIndex: number): string {
  let v = prop.versions[0]!.version;
  for (const x of prop.versions) if (x.from <= beatIndex) v = x.version;
  return v;
}

/** The recurring props a beat's VISUAL (or its spoken line) names, by any of their words. */
export function propsNamedBy(beat: { line?: string | null; visual?: string | null; keyword?: string | null } | undefined, plan: PropPlan | null | undefined): PropPlanItem[] {
  if (!plan || !beat) return [];
  const have = new Set(words(`${(beat.visual ?? "").replace(TAG, "")} ${beat.line ?? ""}`).flatMap((w) => [w, w.replace(/(?:e?s)$/, "")]));
  return plan.props.filter((p) => p.aliases.some((a) => have.has(a)));
}

// ------------------------------------------------------------------ the shared drawing
export function propsCodeRequest(plan: PropPlan, previous?: { code: string; error: string }) {
  const spec = plan.props.map((p) => `- id "${p.id}" (${p.name}); versions: ${p.versions.map((v) => `"${v.version}" = ${v.description}`).join("; ")}`).join("\n");
  return {
    system: [
      "You write the shared drawings of a film's recurring props as TypeScript statements for a canvas kit. Return the code only (no markdown fences, no imports, no exports).",
      "For each prop write ONE call: K.defineProp(\"<id>\", { w: <width>, h: <height>, versions: { \"1\": (c, s) => { ... }, \"2\": (c, s) => { ... } } });",
      "The drawing rules (absolute):",
      "- `c` is a 2D canvas context. Draw with the object's BOTTOM CENTRE at (0, 0): up is negative y, so a box 160 wide and 120 tall spans x -80..80, y -120..0. w and h are the object's own size in these units (100-320).",
      "- `s` = { version, t, active }: t is seconds (for steam, glow or a hum: use Math.sin(s.t * k) only; never Math.random, Date or any clock), active is 0 or 1 (a light on, a door open).",
      "- Flat cut-out cartoon look: fill each shape with a flat colour and ink the outline with K.INK, a thick dark-brown line (lineWidth 7), one darker shade tone on the side away from the light. Use K.shape(c, () => { c.beginPath(); ... }, fill, shade, shadeStartX) to fill + shade + ink a path in one call, or c.fillStyle / c.fill / c.strokeStyle / c.stroke yourself.",
      "- NO text, letters, numbers or labels on the object. No ctx.filter, no images, no gradients needed (flat colours).",
      "- Draw EVERY version listed for a prop and make them clearly the same family where the plan says it is the same object, and a different object where the plan says it is replaced. The first version of each prop is the one most scenes show: make it simple, bold and readable at small size.",
      "- The same prop must look identical every time: no per-call random values."
    ].join("\n"),
    user: `THE PROPS:\n${spec}${previous ? `\n\nYOUR PREVIOUS CODE FAILED. Fix it and return all the code again.\nERROR:\n${previous.error.slice(0, 1500)}\nPREVIOUS CODE:\n${previous.code.slice(0, 8000)}` : ""}`,
    maxTokens: 7000
  };
}

export const stripFence = (text: string) => text.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/i, "").trim();

// ------------------------------------------------------------------ keys and cache
export const filmPropsKey = (projectId: string) => `plates/${projectId}/assets/film-props.json`;
export const filmPropsHash = (beats: readonly Pick<ScriptBeat, "line" | "visual">[], notes: unknown, kitHash: string) =>
  createHash("sha256").update(JSON.stringify([FILM_PROPS_VERSION, kitHash, beats.map((b) => [b.line ?? "", b.visual ?? ""]), notes ?? null])).digest("hex").slice(0, 16);

export type FilmPropsDeps = Pick<AssetStorage, "getObject" | "putObject"> & {
  plan: (request: ReturnType<typeof propsPlanRequest>) => Promise<string>;
  code: (request: ReturnType<typeof propsCodeRequest>) => Promise<string>;
  /** Problems in a props module (empty = fine): the shared drawings must run and paint (prop-check.ts probePropsModule). */
  validate: (code: string, plan: PropPlan) => string[];
  kitHash: string;
};

const flights = new Map<string, Promise<FilmProps | null>>();

/**
 * The film's recurring props (plan + shared module), made once and stored: null when no prop recurs, or the drawings could not be made (scenes are then
 * written as before). When the script changes but the same props are still planned (same ids and version counts), the earlier drawings are kept, so the
 * look of an object never changes because an unrelated line was edited.
 */
export function loadFilmProps(project: Pick<VideoProject, "id" | "brief">, deps: FilmPropsDeps): Promise<FilmProps | null> {
  const beats = project.brief?.scriptBeats ?? [];
  if (!beats.length) return Promise.resolve(null);
  const notes = project.brief?.scriptNotes ?? null;
  const hash = filmPropsHash(beats, notes, deps.kitHash);
  const key = `${project.id}:${hash}`;
  const running = flights.get(key);
  if (running) return running;
  const flight = make(project.id, beats, notes, hash, deps).finally(() => flights.delete(key));
  flights.set(key, flight);
  return flight;
}

async function make(projectId: string, beats: ScriptBeat[], notes: any, hash: string, deps: FilmPropsDeps): Promise<FilmProps | null> {
  const stored = await deps.getObject("uploads", filmPropsKey(projectId)).catch(() => null);
  let old: FilmProps | null = null;
  if (stored) { try { old = JSON.parse(stored.toString("utf8")) as FilmProps; if (old.hash === hash) return old.plan.props.length ? old : null; } catch { old = null; } }
  const save = async (value: FilmProps | { hash: string; plan: PropPlan; code: string }) => { await deps.putObject("uploads", filmPropsKey(projectId), JSON.stringify(value), "application/json").catch(() => undefined); };
  let plan: PropPlan;
  try { plan = parsePropsPlan(await deps.plan(propsPlanRequest(beats, notes)), beats.length); } catch { return null; }
  if (!plan.props.length) { await save({ hash, plan, code: "" }); return null; }
  // the same objects as before: keep their drawings (a new description of the same object must not redraw it)
  const same = old && old.code && old.plan.props.length === plan.props.length && old.plan.props.every((p, i) => p.id === plan.props[i]!.id && p.versions.length === plan.props[i]!.versions.length);
  if (same && old) {
    const kept = { hash, plan: { props: plan.props.map((p, i) => ({ ...p, description: old!.plan.props[i]!.description, versions: p.versions.map((v, j) => ({ ...v, description: old!.plan.props[i]!.versions[j]!.description })) })) }, code: old.code };
    await save(kept); return kept;
  }
  let code = "", error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try { code = stripFence(await deps.code(propsCodeRequest(plan, attempt && error ? { code, error } : undefined))); } catch (e) { error = String((e as Error)?.message ?? e); continue; }
    const issues = deps.validate(code, plan);
    if (!issues.length) { const made = { hash, plan, code }; await save(made); return made; }
    error = issues.join("\n");
  }
  return null;
}

/** The film's props with the live model calls and storage (production). */
export async function filmPropsFor(project: Pick<VideoProject, "id" | "brief">, pack: { id: string; scenes?: () => { kit: string; hash: string } }): Promise<FilmProps | null> {
  const scenes = pack.scenes?.();
  if (!scenes) return null;
  const [{ getObject, putObject }, { callModel }, { routeFor }, { probePropsModule }] = await Promise.all([import("../storage.ts"), import("../models/providers.ts"), import("../models/routes.ts"), import("../plan/packs/history-reel/prop-check.ts")]);
  return loadFilmProps(project, {
    getObject, putObject, kitHash: scenes.hash,
    plan: async (request) => (await callModel({ step: "director", route: { ...routeFor("director"), maxTokens: request.maxTokens }, system: request.system, messages: [{ role: "user", content: request.user }], errorPrefix: "Film props plan failed" })).text,
    code: async (request) => (await callModel({ step: "sceneWriter", route: { ...routeFor("sceneWriter"), maxTokens: request.maxTokens }, system: request.system, messages: [{ role: "user", content: request.user }], errorPrefix: "Film props drawing failed" })).text,
    validate: (code, plan) => probePropsModule(code, scenes.kit, plan)
  });
}
