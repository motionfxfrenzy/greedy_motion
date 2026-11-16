// The picture film's shot list and image list. Pure functions only: no model call, no I/O.
//
// One rule makes the rest simple: how many stills a beat gets, and which of its words each still covers, is a pure function of the
// beat's line (shotSlots). So sceneAssets(beatIndex, beats) and sceneCode() know the shot names without the shot list, and the
// shot list (from the script alone, or from one cheap model call) only fills in what each slot shows.
//
// Two ways to get the shot list:
//  1. planFromScript(beats, notes): no model call. Reads the script's OBJECTS line (cast and sets with short looks) and each beat's
//     VISUAL (its shots in a short grammar the script voice asks for). Good enough to run; looks are short.
//  2. shotListRequest(beats, notes) -> one cheap text call (Flash class, ~$0.01-0.04) -> parseShotList(reply, beats, notes).
//     Writes fuller looks and pictures for the same slots. Every slot the reply misses or gets wrong falls back to (1), so a bad
//     reply never breaks a film. This is the "shot list" line in docs/TRENDING_TEMPLATES_PLAN.md's fixed cost.

import type { ScriptBeat, ScriptNotes } from "@videosaas/contracts";
import type { AssetSpec as PackAssetSpec } from "../../template-packs.ts";
import { drawingStyle } from "./style.ts";

export const FRAMINGS = ["wide", "close", "cutaway", "insert"] as const;
export type Framing = (typeof FRAMINGS)[number];
export type Look = { id: string; look: string };
export type PlanShot = {
  /** Asset name: shot-<beat 01>-<k 1>. */
  name: string;
  beat: number;
  /** Index of the still inside its beat. */
  index: number;
  /** The spoken words this still covers (the cut lands on the first one). */
  text: string;
  kind: "new" | "pop";
  set: string;
  framing: Framing;
  picture: string;
  /** 1-3 capital words copied from this still's own spoken words, or null. */
  label: string | null;
  annotations: string[];
};
export type PictureFilmPlan = { characters: Look[]; sets: Look[]; shots: PlanShot[] };

/** The engine's AssetSpec, plus `allowedText`: the only words a word check may accept on a labelled still (not read by the engine yet). */
export type AssetSpec = PackAssetSpec & { allowedText?: string[] };
export type ImageAspect = PackAssetSpec["aspect"];

export const WORDS_PER_SHOT = 6;
export const MAX_SHOTS_PER_BEAT = 4;
export const MAX_CHARACTERS = 4;
export const MAX_SETS = 5;

const words = (line: string | null | undefined) => (line ?? "").trim().split(/\s+/).filter(Boolean);
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x";

/** Stills for a line: one per ~6 spoken words, 1 to 4. A beat without a line gets one still. */
export const shotCount = (line: string | null | undefined) => Math.max(1, Math.min(MAX_SHOTS_PER_BEAT, Math.round(words(line).length / WORDS_PER_SHOT)));

/**
 * Splits a list of words into `count` consecutive groups of about equal length, moving each split by at most one word to land
 * after a comma, semicolon, colon, dash or full stop (so "street, | chewing" rather than "the | street,"). Returns start indices.
 */
export function splitStarts(tokens: readonly string[], count: number): number[] {
  const n = tokens.length, starts = [0];
  if (n === 0) return Array.from({ length: count }, () => 0);
  for (let k = 1; k < count; k++) {
    const ideal = Math.round((k * n) / count), prev = starts[k - 1]!, room = n - (count - k); // leave a word for each later group
    const ok = (i: number) => i > prev && i <= room;
    const pause = (i: number) => /[,;:.!?—-]$/.test(tokens[i - 1] ?? "");
    const pick = [ideal, ideal + 1, ideal - 1].find((i) => ok(i) && pause(i)) ?? [ideal, ideal + 1, ideal - 1].find(ok) ?? Math.min(room, prev + 1);
    starts.push(Math.max(prev + (n >= count ? 1 : 0), Math.min(pick, n)));
  }
  return starts;
}

/** The still names of one beat, in order. */
export const shotNames = (beatIndex: number, line: string | null | undefined) =>
  Array.from({ length: shotCount(line) }, (_, k) => `shot-${String(beatIndex + 1).padStart(2, "0")}-${k + 1}`);

/** A beat's slots: name and the words each still covers. */
export function shotSlots(beatIndex: number, line: string | null | undefined): { name: string; beat: number; index: number; text: string }[] {
  const tokens = words(line), names = shotNames(beatIndex, line), starts = splitStarts(tokens, names.length);
  return names.map((name, k) => ({ name, beat: beatIndex, index: k, text: tokens.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : tokens.length).join(" ") }));
}

/** The OBJECTS line the script voice asks for: "cast: you = ...; doctor = ... | sets: yard = ...; gut = ...". */
export function parseObjects(objects: string | null | undefined): { characters: Look[]; sets: Look[] } {
  const out = { characters: [] as Look[], sets: [] as Look[] };
  for (const part of (objects ?? "").split("|")) {
    const m = /^\s*(cast|characters|sets?)\s*:(.*)$/i.exec(part);
    if (!m) continue;
    const list = /^cast|^char/i.test(m[1]!) ? out.characters : out.sets;
    for (const item of m[2]!.split(";")) {
      const [id, ...rest] = item.split("=");
      const look = rest.join("=").trim();
      if (id?.trim() && !list.some((x) => x.id === slug(id))) list.push({ id: slug(id), look: look || id.trim() });
    }
  }
  return { characters: out.characters.slice(0, MAX_CHARACTERS), sets: out.sets.slice(0, MAX_SETS) };
}

/** One VISUAL segment: "wide yard: you hold a pink gum ball [GUM]" or "pop: a red arrow at the throat [GULP]". */
export function parseVisual(visual: string | null | undefined): { kind: "new" | "pop"; framing: Framing | null; set: string | null; picture: string; label: string | null }[] {
  return (visual ?? "").split(/\s+\/\s+|\s*\|\s*/).map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const label = /\[([^\]]+)\]/.exec(seg)?.[1]?.trim() || null;
    const body = seg.replace(/\[[^\]]*\]/g, "").trim();
    const pop = /^pop\s*:\s*(.*)$/i.exec(body);
    if (pop) return { kind: "pop" as const, framing: null, set: null, picture: pop[1]!.trim(), label };
    const head = /^(wide|close|cutaway|insert)(?:\s+([a-z0-9_-]+))?\s*:\s*(.*)$/i.exec(body);
    if (head) return { kind: "new" as const, framing: head[1]!.toLowerCase() as Framing, set: head[2] ? slug(head[2]) : null, picture: head[3]!.trim(), label };
    return { kind: "new" as const, framing: null, set: null, picture: body, label };
  });
}

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|percent)\b/i;
/** A label is kept only when every word of it is spoken in that still (a number may be written in digits). Capitals, at most 3 words. */
export function checkLabel(label: unknown, spoken: string): string | null {
  if (typeof label !== "string") return null;
  const parts = label.trim().toUpperCase().replace(/[^A-Z0-9%?' -]/g, "").split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 3 || parts.join(" ").length > 24) return null;
  const heard = new Set(words(spoken).map(norm));
  const hasNumber = /\d/.test(spoken) || NUMBER_WORDS.test(spoken);
  return parts.every((p) => heard.has(norm(p)) || (/^\d[\d%.,]*$/.test(p) && hasNumber) || norm(p) === "") ? parts.join(" ") : null;
}

/** The shot list from the script alone (no model call). Also the per-slot fallback of parseShotList. */
export function planFromScript(beats: readonly ScriptBeat[], notes?: ScriptNotes | null): PictureFilmPlan {
  const { characters, sets: listed } = parseObjects(notes?.objects);
  const sets = listed.length ? listed : [{ id: "scene", look: "a simple everyday place with lots of empty space" }];
  const known = new Set(sets.map((s) => s.id));
  const shots: PlanShot[] = [];
  beats.forEach((beat, b) => {
    const segs = parseVisual(beat.visual);
    for (const slot of shotSlots(b, beat.line)) {
      const last = slot.index === shotSlots(b, beat.line).length - 1;
      // extra segments fold into the last still; missing ones become a closer redraw of the beat's picture
      const seg = last && segs.length > slot.index + 1 ? { ...segs[slot.index]!, picture: segs.slice(slot.index).map((s) => s.picture).join("; ") } : segs[slot.index];
      const prev = shots[shots.length - 1];
      const set = seg?.set && known.has(seg.set) ? seg.set : prev?.set ?? sets[0]!.id;
      const kind = seg?.kind === "pop" && prev ? "pop" : "new";
      shots.push({
        ...slot, kind, set: kind === "pop" ? prev!.set : set,
        framing: kind === "pop" ? prev!.framing : seg?.framing ?? (slot.index > 0 ? "close" : "wide"),
        picture: seg?.picture || beat.visual || beat.line || beat.keyword,
        label: checkLabel(seg?.label, slot.text), annotations: []
      });
    }
  });
  return { characters, sets, shots };
}

export const SHOT_LIST_SYSTEM = `You are the storyboard artist for a stick-figure science explainer. Pictures are still illustrations that change on the narrator's words, about every 2 seconds. Nothing moves inside a picture.
You get the film's cast and sets (short notes) and every still to draw, each with the exact spoken words it covers. Do not add, remove, merge or rename stills.
Rules:
- Each still shows exactly the noun or verb being said during it. One idea per picture.
- "characters": every recurring person or animal, with a precise look so it can be redrawn identically (stick figures told apart only by one or two props; animals drawn in more detail). At most ${MAX_CHARACTERS}.
- "sets": a small number of recurring places (the viewer's everyday place, an inside-the-body or underground cross-section, a desk, a plain cream info card), each with a precise visual description. At most ${MAX_SETS}. Keep the ids from the notes.
- "kind": "new" = a new drawing; "pop" = the previous still's exact drawing with one thing added or changed (a label, arrow, prop or pose), for "and then" beats. About 1 in 6 stills. Never for the first still.
- "framing": "wide" (whole set), "close" (a tighter redrawn view of the same set, reads as a zoom-in), "cutaway" (side-on cross-section), "insert" (a map, calendar, big number, bar or timeline on a plain card). Alternate wide and close while the narration stays in one place; return to wide for an instant zoom-out.
- "label": 1-3 capital words copied from that still's own spoken words (a spoken number may be written in digits), or null. About 60% of stills have one. Never a word that is not spoken in that still.
- "annotations": optional red arrows, green checks, red question marks or thought bubbles, saying what they point at.
- "picture": what is drawn, concrete, with positions (left/right, foreground/background), eye level, in a tall 9:16 frame. Name characters by their id. Never describe any text other than the label.
Return JSON only: {"characters":[{"id","look"}],"sets":[{"id","look"}],"shots":[{"name","kind","set","framing","picture","label","annotations"}]}`;

/** The one cheap model call that writes the shot list: system + user text. */
export function shotListRequest(beats: readonly ScriptBeat[], notes?: ScriptNotes | null): { system: string; user: string; maxTokens: number } {
  const slots = beats.flatMap((beat, b) => shotSlots(b, beat.line).map((s) => `${s.name} | beat ${b + 1} visual: ${beat.visual ?? "-"} | words: "${s.text}"`));
  const user = [`Film idea: ${notes?.idea ?? "-"}`, `Cast and sets (notes): ${notes?.objects ?? "-"}`, "", "Stills to draw, in order:", ...slots].join("\n");
  return { system: SHOT_LIST_SYSTEM, user, maxTokens: Math.min(30000, 1500 + slots.length * 220) };
}

/** Reads the model's shot list. Anything missing or invalid is taken from planFromScript, slot by slot. Never throws. */
export function parseShotList(reply: string, beats: readonly ScriptBeat[], notes?: ScriptNotes | null): PictureFilmPlan {
  const base = planFromScript(beats, notes);
  let json: { characters?: unknown; sets?: unknown; shots?: unknown } = {};
  try { json = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? "{}"); } catch { json = {}; }
  const looks = (list: unknown, max: number): Look[] => {
    const out: Look[] = [];
    for (const x of Array.isArray(list) ? list : []) {
      const r = x as { id?: unknown; look?: unknown };
      if (typeof r?.id === "string" && typeof r.look === "string" && r.look.trim() && !out.some((o) => o.id === slug(r.id as string))) out.push({ id: slug(r.id), look: r.look.trim().slice(0, 400) });
    }
    return out.slice(0, max);
  };
  const characters = looks(json.characters, MAX_CHARACTERS);
  const sets = looks(json.sets, MAX_SETS);
  const plan: PictureFilmPlan = { characters: characters.length ? characters : base.characters, sets: sets.length ? sets : base.sets, shots: [] };
  const known = new Set(plan.sets.map((s) => s.id));
  const byName = new Map<string, Record<string, unknown>>();
  for (const x of Array.isArray(json.shots) ? json.shots : []) if (x && typeof (x as { name?: unknown }).name === "string") byName.set((x as { name: string }).name, x as Record<string, unknown>);
  for (const fallback of base.shots) {
    const got = byName.get(fallback.name), prev = plan.shots[plan.shots.length - 1];
    if (!got || typeof got.picture !== "string" || !got.picture.trim()) { plan.shots.push({ ...fallback, set: known.has(fallback.set) ? fallback.set : prev?.set ?? plan.sets[0]!.id }); continue; }
    const kind = got.kind === "pop" && prev ? "pop" : "new";
    const set = kind === "pop" ? prev!.set : typeof got.set === "string" && known.has(slug(got.set)) ? slug(got.set) : known.has(fallback.set) ? fallback.set : prev?.set ?? plan.sets[0]!.id;
    const framing = kind === "pop" ? prev!.framing : (FRAMINGS as readonly string[]).includes(got.framing as string) ? (got.framing as Framing) : fallback.framing;
    const annotations = (Array.isArray(got.annotations) ? got.annotations : typeof got.annotations === "string" ? [got.annotations] : [])
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a))).filter(Boolean).slice(0, 3);
    plan.shots.push({ ...fallback, kind, set, framing, picture: got.picture.trim().slice(0, 600), label: checkLabel(got.label, fallback.text), annotations });
  }
  return plan;
}

const FRAMING_TEXT: Record<Framing, string> = {
  wide: "the whole set, wide",
  close: "a tighter close-up of part of the same set, redrawn larger (reads as a zoom-in)",
  cutaway: "side-on cross-section",
  insert: "a simple info card: one object, number, map or chart on a plain cream background"
};
const textRule = (label: string | null) => label
  ? `The only words in the picture: "${label}" (numbers as digits), hand-lettered capitals in empty space.`
  : "No words or letters anywhere in the picture.";

/** Characters a still shows: those whose id is named in its picture or annotations. */
const castIn = (plan: PictureFilmPlan, shot: PlanShot) => plan.characters.filter((c) => new RegExp(`\\b${c.id.replace(/-/g, "[- ]")}\\b`, "i").test(`${shot.picture} ${shot.annotations.join(" ")}`));

/**
 * The film's images, in generation order: the style anchor, set anchors, character model sheets, then every still.
 * A still's refs are its set anchor and the model sheets of the characters it names (the set anchor already carries the style);
 * a "pop" is an edit of the still before it, so its only ref is that still. Refs always name earlier entries.
 */
export function assetSpecs(plan: PictureFilmPlan, aspect: ImageAspect = "9:16"): AssetSpec[] {
  const style = drawingStyle(aspect), base = { aspect, size: "1K" } as const;
  const chars = plan.characters.map((c) => `- ${c.id}: ${c.look}`).join("\n") || "- (none)";
  const setLook = new Map(plan.sets.map((s) => [s.id, s.look]));
  const out: AssetSpec[] = [];
  out.push({ name: "style", ...base, noText: true, prompt: `${style}\n\nA style reference picture for this film: ${plan.sets[0] ? `the establishing wide view of ${plan.sets[0].look}` : "a simple everyday place"}, with one stick figure standing in it and one red arrow pointing at something. No words or letters anywhere.` });
  for (const s of plan.sets) out.push({ name: `set-${s.id}`, ...base, noText: true, refs: ["style"], prompt: `${style}\n\nMatch the drawing style of the reference exactly (line weight, palette, shading). Draw the establishing wide view of this set, with no people: ${s.look}\n${textRule(null)}` });
  for (const c of plan.characters) out.push({ name: `char-${c.id}`, ...base, noText: true, refs: ["style"], prompt: `${style}\n\nCharacter model sheet on a plain white background: the same character drawn three times (standing front view, walking side view, surprised pose), stacked to fit the frame. Character: ${c.look}\nMatch the reference's drawing style exactly. No words or letters anywhere.` });
  let allowed: string[] = [];
  plan.shots.forEach((shot, i) => {
    const prev = plan.shots[i - 1];
    if (shot.kind === "pop" && prev) {
      allowed = [...allowed, ...(shot.label ? [shot.label] : [])];
      const add = `${shot.picture}${shot.annotations.length ? `; annotations: ${shot.annotations.join("; ")}` : ""}`;
      out.push({ name: shot.name, ...base, refs: [prev.name], noText: allowed.length === 0, ...(allowed.length ? { allowedText: allowed } : {}),
        prompt: `Edit this picture. Keep everything exactly the same (composition, characters, colours, line work, existing words) and only add or change: ${add}. ${shot.label ? `Add the hand-lettered capital words "${shot.label}" in empty space (numbers as digits).` : "Add no new words."}` });
      return;
    }
    allowed = shot.label ? [shot.label] : [];
    const cast = castIn(plan, shot);
    const refs = [setLook.has(shot.set) ? `set-${shot.set}` : "style", ...cast.map((c) => `char-${c.id}`)];
    const prompt = [style, `Characters:\n${chars}`, `Set "${shot.set}": ${setLook.get(shot.set) ?? ""}`, `Framing: ${FRAMING_TEXT[shot.framing]}.`, `Picture: ${shot.picture}`,
      shot.annotations.length ? `Annotations: ${shot.annotations.join("; ")}` : "", textRule(shot.label),
      `References: the set picture shows this place and the drawing style${cast.length ? "; each character model sheet shows ONE person in several poses: draw that character only ONCE, exactly in that design" : ""}. Match the references' drawing style exactly.`
    ].filter(Boolean).join("\n\n");
    out.push({ name: shot.name, ...base, refs, noText: !shot.label, ...(shot.label ? { allowedText: [shot.label] } : {}), prompt });
  });
  return out;
}
