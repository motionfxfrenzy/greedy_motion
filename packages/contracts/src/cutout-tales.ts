/**
 * "Cutout tales": the shot-list contract for the code-drawn 2D cutout / puppet look
 * (worker/templates/cutout-tales, ported from the MIT growkaz-cutout-tales skill; see third_party/cutout-tales).
 *
 * The planner/LLM only ever produces a JSON DRAFT (CutoutDraft). It never writes drawing code: the server runs no
 * Python and no model-written code. A draft is resolved against the voiceover's sentence timings into a CutoutSpec,
 * validated here, and interpreted by the renderer's pure drawFrame(ctx, spec, t).
 *
 * Times inside a shot (gestures, expressions, talk, overlays) are seconds from the START OF THAT SHOT.
 */

export const cutoutAspects = ["16:9", "9:16"] as const;
export type CutoutAspect = (typeof cutoutAspects)[number];

/** Keep these lists identical to CutoutKit's exports (worker/templates/cutout-tales/kit.js); a test enforces it. */
export const cutoutSets = ["western_town", "camp", "silhouette", "apartment", "office", "street", "dinner", "stage", "plain", "roof"] as const;
export const cutoutMoods = ["dusk", "night", "day", "gold", "interior"] as const;
export const cutoutProps = ["fire", "riders", "rider", "table"] as const;
export const cutoutArchetypes = ["everyman", "mother", "father", "executive", "tycoon", "underdog", "friend_a", "friend_b", "drifter", "markswoman", "scamp", "marshal", "child", "laborer"] as const;
export const cutoutPoses = ["idle", "hips", "cross", "point", "shrug", "think", "wave", "up", "sad", "hold", "present", "hat_tip"] as const;
export const cutoutExpressions = ["neutral", "happy", "worried", "angry", "sly", "think", "sad", "shock"] as const;
export const cutoutOverlayTypes = ["tag", "year", "stamp", "rating", "bubble", "caption", "title"] as const;
export const cutoutHairs = ["short", "curly", "slick", "long", "bun", "bald"] as const;
export const cutoutSkins = ["a", "b", "c", "d", "e"] as const;
export const cutoutTransitions = ["fade", "cut"] as const;

export const CUTOUT_LIMITS = { shots: 40, cast: 5, overlays: 10, gestures: 8, durationSeconds: 300, text: 80, bubbleText: 140, name: 24 } as const;

export type CutoutLook = Partial<{
  skin: (typeof cutoutSkins)[number]; hair: (typeof cutoutHairs)[number];
  hairColor: string; shirt: string; jacket: string; pants: string; shoes: string; tie: string; stetson: string; bandana: string; band: string; cap: string;
  stubble: boolean; mustache: boolean; female: boolean; dress: boolean; tophat: boolean; chubby: boolean; patched: boolean; holster: boolean; star: boolean; chibi: boolean; glasses: boolean;
}>;

export type CutoutCast = {
  id?: string;
  /** Display name for the story (original characters only). Not drawn; tags carry visible text. */
  name?: string;
  archetype: (typeof cutoutArchetypes)[number];
  look?: CutoutLook;
  /** Horizontal position as a fraction of the landscape frame, 0..1. Portrait re-frames automatically. */
  x?: number;
  scale?: number;
  pose?: (typeof cutoutPoses)[number];
  expr?: (typeof cutoutExpressions)[number];
  flip?: boolean;
  gestures?: { t: number; pose: (typeof cutoutPoses)[number]; hold?: number }[];
  expressions?: { t: number; expr: (typeof cutoutExpressions)[number] }[];
  /** Talking-mouth windows [from, to] in shot seconds. */
  talk?: [number, number][];
};

export type CutoutOverlay = {
  type: (typeof cutoutOverlayTypes)[number];
  t0: number;
  t1?: number;
  text: string;
  sub?: string;
  size?: number;
  color?: string;
  stars?: number;
  think?: boolean;
  /** Bubble: index into the shot's cast. */
  speaker?: number;
  /** Tag/stamp/rating: stand next to this cast member. */
  target?: number;
  /** Optional explicit anchor as frame fractions; otherwise the layout solver places it without overlaps. */
  at?: { x: number; y: number };
};

export type CutoutShot = {
  t0: number;
  t1: number;
  set: (typeof cutoutSets)[number];
  mood?: (typeof cutoutMoods)[number];
  props?: (typeof cutoutProps)[number][];
  zoom?: [number, number];
  transition?: (typeof cutoutTransitions)[number];
  cast: CutoutCast[];
  overlays?: CutoutOverlay[];
};

export type CutoutSpec = {
  version: 1;
  aspect: CutoutAspect;
  duration: number;
  seed?: number;
  fadeIn?: number;
  fadeOut?: number;
  shots: CutoutShot[];
};

const has = <T extends readonly string[]>(list: T, value: unknown): value is T[number] => typeof value === "string" && (list as readonly string[]).includes(value);
const isNum = (v: unknown, min = -1e6, max = 1e6): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const isHex = (v: unknown) => typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Original characters only: never a game, film or TV character. Best-effort guard on names and visible text. */
const BLOCKED_NAMES = /\b(arthur morgan|john marston|dutch van der linde|cj\b|carl johnson|mario|luigi|sonic|pikachu|mickey mouse|donald duck|homer simpson|bart simpson|spongebob|batman|superman|spider-?man|iron man|harry potter|darth vader|luke skywalker|han solo|walter white|tony soprano|the man with no name|blondie|clint eastwood)\b/i;
export function cutoutNameProblem(value: string): string | null {
  return BLOCKED_NAMES.test(value) ? `"${value}" looks like an existing character: invent an original character and name` : null;
}

export function cutoutSpecProblems(value: unknown): string[] {
  const errors: string[] = [];
  const add = (message: string) => { if (errors.length < 30) errors.push(message); };
  if (!isObj(value)) return ["spec must be an object"];
  const L = CUTOUT_LIMITS;
  if (value.version !== 1) add("version must be 1");
  if (!has(cutoutAspects, value.aspect)) add(`aspect must be one of ${cutoutAspects.join(", ")}`);
  if (!isNum(value.duration, 1, L.durationSeconds)) add(`duration must be 1..${L.durationSeconds} seconds`);
  if (value.seed !== undefined && !isNum(value.seed, 0, 1e9)) add("seed must be a number");
  for (const key of ["fadeIn", "fadeOut"]) if (value[key] !== undefined && !isNum(value[key], 0, 3)) add(`${key} must be 0..3`);
  if (!Array.isArray(value.shots) || !value.shots.length) return [...errors, "shots must be a non-empty list"];
  if (value.shots.length > L.shots) add(`at most ${L.shots} shots`);
  let prevEnd = 0;
  value.shots.slice(0, L.shots).forEach((shot: unknown, i: number) => {
    const at = `shots[${i}]`;
    if (!isObj(shot)) return add(`${at} must be an object`);
    if (!isNum(shot.t0, 0, 1e4) || !isNum(shot.t1, 0, 1e4) || shot.t1 <= shot.t0) return add(`${at}: t0/t1 must be increasing seconds`);
    if (Math.abs(shot.t0 - prevEnd) > 0.001) add(`${at}: shots must be contiguous (t0 ${shot.t0} should be ${prevEnd})`);
    prevEnd = shot.t1;
    const dur = shot.t1 - shot.t0;
    if (!has(cutoutSets, shot.set)) add(`${at}.set must be one of ${cutoutSets.join(", ")}`);
    if (shot.mood !== undefined && !has(cutoutMoods, shot.mood)) add(`${at}.mood must be one of ${cutoutMoods.join(", ")}`);
    if (shot.transition !== undefined && !has(cutoutTransitions, shot.transition)) add(`${at}.transition must be fade or cut`);
    if (shot.props !== undefined && (!Array.isArray(shot.props) || shot.props.some((p) => !has(cutoutProps, p)))) add(`${at}.props must be from ${cutoutProps.join(", ")}`);
    if (shot.zoom !== undefined && (!Array.isArray(shot.zoom) || shot.zoom.length !== 2 || !isNum(shot.zoom[0], 0.9, 1.4) || !isNum(shot.zoom[1], 0.9, 1.4))) add(`${at}.zoom must be [from, to] between 0.9 and 1.4`);
    if (!Array.isArray(shot.cast) || shot.cast.length > L.cast) return add(`${at}.cast must be a list of at most ${L.cast}`);
    shot.cast.forEach((c: unknown, ci: number) => {
      const cat = `${at}.cast[${ci}]`;
      if (!isObj(c)) return add(`${cat} must be an object`);
      if (!has(cutoutArchetypes, c.archetype)) add(`${cat}.archetype must be one of ${cutoutArchetypes.join(", ")}`);
      if (c.name !== undefined) { if (typeof c.name !== "string" || c.name.length > L.name) add(`${cat}.name too long`); else { const p = cutoutNameProblem(c.name); if (p) add(`${cat}: ${p}`); } }
      if (c.x !== undefined && !isNum(c.x, 0, 1)) add(`${cat}.x must be 0..1`);
      if (c.scale !== undefined && !isNum(c.scale, 0.4, 2.2)) add(`${cat}.scale must be 0.4..2.2`);
      if (c.pose !== undefined && !has(cutoutPoses, c.pose)) add(`${cat}.pose unknown`);
      if (c.expr !== undefined && !has(cutoutExpressions, c.expr)) add(`${cat}.expr unknown`);
      if (c.flip !== undefined && typeof c.flip !== "boolean") add(`${cat}.flip must be boolean`);
      if (c.gestures !== undefined && (!Array.isArray(c.gestures) || c.gestures.length > L.gestures || c.gestures.some((g) => !isObj(g) || !isNum(g.t, 0, dur) || !has(cutoutPoses, g.pose) || (g.hold !== undefined && !isNum(g.hold, 0.2, 30))))) add(`${cat}.gestures invalid (t within the shot, known pose)`);
      if (c.expressions !== undefined && (!Array.isArray(c.expressions) || c.expressions.length > L.gestures || c.expressions.some((g) => !isObj(g) || !isNum(g.t, 0, dur) || !has(cutoutExpressions, g.expr)))) add(`${cat}.expressions invalid`);
      if (c.talk !== undefined && (!Array.isArray(c.talk) || c.talk.length > 12 || c.talk.some((r) => !Array.isArray(r) || r.length !== 2 || !isNum(r[0], 0, dur) || !isNum(r[1], 0, dur + 1) || r[1] <= r[0]))) add(`${cat}.talk must be [[from,to],...] in shot seconds`);
      if (c.look !== undefined) {
        if (!isObj(c.look)) return add(`${cat}.look must be an object`);
        const look = c.look as Record<string, unknown>;
        for (const [k, v] of Object.entries(look)) {
          if (k === "skin") { if (!has(cutoutSkins, v)) add(`${cat}.look.skin must be a..e`); }
          else if (k === "hair") { if (!has(cutoutHairs, v)) add(`${cat}.look.hair unknown`); }
          else if (["hairColor", "shirt", "jacket", "pants", "shoes", "tie", "stetson", "bandana", "band", "cap"].includes(k)) { if (!isHex(v)) add(`${cat}.look.${k} must be a #rrggbb colour`); }
          else if (["stubble", "mustache", "female", "dress", "tophat", "chubby", "patched", "holster", "star", "chibi", "glasses"].includes(k)) { if (typeof v !== "boolean") add(`${cat}.look.${k} must be boolean`); }
          else add(`${cat}.look.${k} is not a known appearance option`);
        }
      }
    });
    if (shot.overlays !== undefined) {
      if (!Array.isArray(shot.overlays) || shot.overlays.length > L.overlays) return add(`${at}.overlays must be a list of at most ${L.overlays}`);
      shot.overlays.forEach((o: unknown, oi: number) => {
        const oat = `${at}.overlays[${oi}]`;
        if (!isObj(o)) return add(`${oat} must be an object`);
        if (!has(cutoutOverlayTypes, o.type)) add(`${oat}.type must be one of ${cutoutOverlayTypes.join(", ")}`);
        if (!isNum(o.t0, 0, dur)) add(`${oat}.t0 must be within the shot (0..${dur.toFixed(2)})`);
        if (o.t1 !== undefined && (!isNum(o.t1, 0, dur + 0.5) || (isNum(o.t0) && o.t1 <= o.t0))) add(`${oat}.t1 must be after t0`);
        const max = o.type === "bubble" || o.type === "caption" ? L.bubbleText : L.text;
        if (typeof o.text !== "string" || !o.text.trim() || o.text.length > max) add(`${oat}.text must be 1..${max} characters`);
        else { const p = cutoutNameProblem(o.text); if (p) add(`${oat}: ${p}`); }
        if (o.sub !== undefined && (typeof o.sub !== "string" || o.sub.length > L.text)) add(`${oat}.sub too long`);
        if (o.size !== undefined && !isNum(o.size, 16, 140)) add(`${oat}.size must be 16..140`);
        if (o.color !== undefined && !isHex(o.color)) add(`${oat}.color must be #rrggbb`);
        if (o.stars !== undefined && !isNum(o.stars, 1, 5)) add(`${oat}.stars must be 1..5`);
        if (o.think !== undefined && typeof o.think !== "boolean") add(`${oat}.think must be boolean`);
        for (const key of ["speaker", "target"]) if (o[key] !== undefined && (!isNum(o[key], 0, 4) || !Number.isInteger(o[key]) || (o[key] as number) >= shot.cast.length)) add(`${oat}.${key} must index the shot's cast`);
        if (o.type === "bubble" && o.speaker === undefined) add(`${oat}: a speech bubble needs a speaker (cast index)`);
        if (o.at !== undefined && (!isObj(o.at) || !isNum(o.at.x, 0, 1) || !isNum(o.at.y, 0, 1))) add(`${oat}.at must be {x,y} in 0..1`);
      });
    }
  });
  if (isNum(value.duration) && Math.abs(prevEnd - value.duration) > 0.05) add(`the last shot must end at duration (${prevEnd} vs ${value.duration})`);
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// Planner draft + voiceover timing

export type SentenceTiming = { start: number; end: number; text?: string };

/** What the planner writes: shots reference VOICEOVER SENTENCES, never seconds. */
export type CutoutDraftOverlay = Omit<CutoutOverlay, "t0" | "t1"> & {
  /** Sentence (0-based, within this shot) the overlay appears with, plus an optional offset in seconds. */
  atSentence?: number;
  offset?: number;
  /** Bubbles/captions: stay up for this many sentences (default 1). */
  forSentences?: number;
};
export type CutoutDraftCast = Omit<CutoutCast, "gestures" | "expressions" | "talk"> & {
  gestures?: { atSentence: number; offset?: number; pose: (typeof cutoutPoses)[number]; hold?: number }[];
  expressions?: { atSentence: number; offset?: number; expr: (typeof cutoutExpressions)[number] }[];
  /** Sentences (within the shot) this character speaks: drives the talking mouth from the voiceover timing. */
  talkSentences?: number[];
};
export type CutoutDraftShot = Omit<CutoutShot, "t0" | "t1" | "cast" | "overlays"> & {
  /** Inclusive range of voiceover sentence indexes the shot covers. */
  sentences: [number, number];
  cast: CutoutDraftCast[];
  overlays?: CutoutDraftOverlay[];
};
export type CutoutDraft = { aspect: CutoutAspect; seed?: number; shots: CutoutDraftShot[] };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Turns a planner draft plus the voiceover's sentence timings into a renderable spec. Shots abut: a shot ends where
 * the next one's first sentence begins, the first starts at 0 and the last runs `tail` seconds past its last sentence.
 */
export function resolveCutoutTimings(draft: CutoutDraft, sentences: SentenceTiming[], tail = 1.2): { spec: CutoutSpec } | { error: string } {
  if (!draft?.shots?.length) return { error: "The draft has no shots." };
  if (!sentences.length) return { error: "No voiceover sentences to time the shots to." };
  let prevLast = -1;
  for (const [i, shot] of draft.shots.entries()) {
    const [a, b] = shot.sentences ?? [];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= sentences.length) return { error: `shots[${i}].sentences must be a valid inclusive range of the ${sentences.length} sentences.` };
    if (a !== prevLast + 1) return { error: `shots[${i}] must start at sentence ${prevLast + 1} (shots cover every sentence in order).` };
    prevLast = b;
  }
  if (prevLast !== sentences.length - 1) return { error: `The shots stop at sentence ${prevLast}; they must cover all ${sentences.length}.` };
  const duration = r2(sentences[sentences.length - 1]!.end + tail);
  const shots: CutoutShot[] = draft.shots.map((shot, i) => {
    const [a, b] = shot.sentences;
    const t0 = i === 0 ? 0 : r2(sentences[a]!.start);
    const next = draft.shots[i + 1];
    const t1 = next ? r2(sentences[next.sentences[0]]!.start) : duration;
    const local = (k: number, offset = 0) => {
      const s = sentences[Math.min(b, a + Math.max(0, k))]!;
      return r2(Math.min(Math.max(0, s.start - t0 + offset), Math.max(0, t1 - t0 - 0.1)));
    };
    const windowOf = (k: number): [number, number] => { const s = sentences[Math.min(b, a + Math.max(0, k))]!; return [r2(Math.max(0, s.start - t0)), r2(s.end - t0)]; };
    const cast: CutoutCast[] = shot.cast.map(({ gestures, expressions, talkSentences, ...rest }) => ({
      ...rest,
      ...(gestures && { gestures: gestures.map((g) => ({ t: local(g.atSentence, g.offset), pose: g.pose, ...(g.hold !== undefined && { hold: g.hold }) })) }),
      ...(expressions && { expressions: expressions.map((e) => ({ t: local(e.atSentence, e.offset), expr: e.expr })) }),
      ...(talkSentences?.length && { talk: talkSentences.map((k) => windowOf(k)) })
    }));
    const overlays = shot.overlays?.map(({ atSentence, offset, forSentences, ...rest }): CutoutOverlay => {
      const k = atSentence ?? 0, start = local(k, offset ?? (rest.type === "bubble" ? 0.05 : 0.2));
      const timed = rest.type === "bubble" || rest.type === "caption" || forSentences !== undefined;
      const end = timed ? r2(Math.min(t1 - t0 + 0.2, windowOf(k + Math.max(1, forSentences ?? 1) - 1)[1] + 0.3)) : undefined;
      return { ...rest, t0: start, ...(end !== undefined && end > start && { t1: end }) };
    });
    const { sentences: _s, cast: _c, overlays: _o, ...base } = shot;
    return { ...base, t0, t1, cast, ...(overlays && { overlays }) } as CutoutShot;
  });
  const spec: CutoutSpec = { version: 1, aspect: draft.aspect, duration, seed: draft.seed ?? 7, shots };
  const problems = cutoutSpecProblems(spec);
  return problems.length ? { error: problems.join("; ") } : { spec };
}

/** Staging-only flag. The look is never offered in production, whatever the env var says. */
export function cutoutTalesEnabled(env: Record<string, string | undefined>): boolean {
  return env.CUTOUT_TALES_ENABLED === "1" && (env.APP_ENV ?? "local") !== "production";
}

/** Canvas the renderer stamps on the composition for each aspect. */
export const cutoutCanvas: Record<CutoutAspect, { width: number; height: number }> = { "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 } };

/** Prompt text for the planner: the vocabulary it may use, as data (the draft is JSON only). */
export const cutoutPlannerBrief = [
  "LOOK: Cutout tales. Flat vector adult characters (about 7 heads tall, mitten hands) as layered puppets that barely move; the camera push-in and pop-in overlays carry the energy.",
  `Output a JSON CutoutDraft: { aspect, shots: [{ sentences: [first, last], set, mood, props?, cast: [...], overlays?: [...] }] }. Shots cover every voiceover sentence in order, 1 to 3 sentences each.`,
  `set: ${cutoutSets.join(" | ")}. mood: ${cutoutMoods.join(" | ")}. props: ${cutoutProps.join(" | ")}.`,
  `cast: at most ${CUTOUT_LIMITS.cast} per shot. Each: archetype (${cutoutArchetypes.join(" | ")}), an ORIGINAL display name, optional look overrides (colours as #rrggbb, hair, flags), x (0..1), pose (${cutoutPoses.join(" | ")}), expr (${cutoutExpressions.join(" | ")}), gestures/expressions at a sentence, talkSentences for the sentences that character speaks.`,
  `overlays: ${cutoutOverlayTypes.join(" | ")}. tag = name tag (text + sub), year, stamp, rating (stars), bubble (needs speaker = cast index), caption, title. Use at most 3 overlays at once. Never place text yourself: the renderer lays overlays out so they never overlap each other or a head. Text is short (under 40 characters; bubbles under 100).`,
  "RULES: original characters only; never a game, film or TV character or their names. Silhouette shots (set silhouette, no cast, props riders) suit an epic open and a closing ride-off. Classic arc: epic open, name tag intro, stat or stamp jokes, a speech-bubble line, ride-off."
].join("\n");
