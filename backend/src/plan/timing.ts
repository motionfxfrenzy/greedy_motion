import { currentTake, paceWpm, type Beat, type BeatPlan, type Pace, type PlanAudio, type PlanVoiceWord, type ScriptBrief } from "@videosaas/contracts";

/**
 * The beat-plan clock. Every boundary in the beat-plan composition engine
 * (worker/templates/beat-plan) comes from here: beat cuts, where each voiceover
 * line sits, when a UI action lands and when the success moment lands.
 *
 * Until a real voiceover exists the line lengths are estimated from the pace
 * (`paceWpm`). Pass `lineSeconds` (measured from the VO transcript) to re-time
 * the same plan against the real read without changing anything else.
 */
export const TIMING_RULES = {
  fps: 30,
  /** The first line starts this far in; the hook still moves from frame 0. */
  leadIn: 0.2,
  /** Silence between two lines inside one act, and between acts (shared-craft → Pacing). */
  gapInAct: 0.3,
  gapBetweenActs: 0.45,
  /** J-cut: the cut lands this long before a voiced line ends, under its last word. */
  jcut: 0.12,
  /** Extra pause the reader takes at a comma, colon or dash. */
  commaPause: 0.12,
  kineticMin: 1.6,
  kineticMax: 4,
  uiMin: 2.6,
  uiMax: 5.5,
  titleMin: 2,
  /** A silent title needs its elements to land and then a landed ending. */
  titleSilentMin: 2.4,
  titleMax: 4.5,
  /** The CTA keeps moving at least this long after its line ends (watchability → Land the ending). */
  landedTail: 1.2,
  hookMax: 3,
  /** Pacing standard: the voice never stops longer than this between two lines of a voiced film. */
  voiceGapMax: 1.0,
  /** The film may end within ±10% of the brief's duration. */
  tolerance: 0.1,
  /** On-screen text read time: words × 0.3 s + 0.5 s (watchability → Read time). */
  readPerWord: 0.3,
  readBase: 0.5,
  /** Stillness before the success result lands (motion-doctrine: the dramatic comma, 0.3–0.75 s). */
  successComma: 0.35,
  /** Typing speed used by the engine's `type` action (characters per second). */
  typeCps: 22
} as const;

export type BeatTiming = {
  id: string;
  /** Visual slot on the film clock: the cut in and the cut out. Consecutive beats share the boundary. */
  start: number;
  end: number;
  /** Where the voiceover line sits (estimated or measured), or null for a silent beat. */
  vo: { start: number; end: number } | null;
  /** UI beats: the frame the cursor performs the action (on the verb). */
  actAt: number | null;
  /** The success beat: the frame the result lands (pop, check or count). */
  successAt: number | null;
  /** The voiced line's words on the film clock, when the line has a measured take. */
  words: PlanVoiceWord[] | null;
};

export type PlanTiming = { pace: Pace; target: number; total: number; beats: BeatTiming[]; warnings: string[] };

export type TimingOptions = {
  /** Measured line durations by beat id (seconds), from the real VO transcript. */
  lineSeconds?: Record<string, number>;
  /** Word times inside each measured line (seconds from the line's start), from the transcript. */
  lineWords?: Record<string, PlanVoiceWord[]>;
};

/** Timing options from the project's current voiceover takes (an edited line falls back to the estimate). */
export function takeOptions(plan: BeatPlan, audio: PlanAudio | null | undefined): TimingOptions {
  const lineSeconds: Record<string, number> = {};
  const lineWords: Record<string, PlanVoiceWord[]> = {};
  for (const beat of plan.beats) {
    const take = currentTake(audio, beat);
    if (!take) continue;
    lineSeconds[beat.id] = take.seconds;
    lineWords[beat.id] = take.words;
  }
  return { lineSeconds, lineWords };
}

type EngineKind = "ui" | "kinetic" | "title";

const ACT: Record<Beat["role"], number> = { hook: 1, problem: 1, reveal: 2, feature: 3, proof: 3, success: 3, cta: 4 };

const wordList = (text: string | null | undefined) => (text ?? "").trim().split(/\s+/).filter(Boolean);
const frame = (seconds: number) => Math.round(seconds * TIMING_RULES.fps) / TIMING_RULES.fps;
const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");

/** What the engine actually draws for a beat: generated beats render their 2D fallback until clips exist. */
export function engineKind(beat: Pick<Beat, "kind" | "ui" | "fallback">): EngineKind {
  if (beat.kind === "3d" || beat.kind === "footage") return beat.fallback?.kind === "ui" && beat.ui ? "ui" : "kinetic";
  if (beat.kind === "ui") return beat.ui ? "ui" : "kinetic";
  return beat.kind === "title" ? "title" : "kinetic";
}

/** Estimated read time of one voiceover line at the pace's words-per-minute. */
export function estimateLineSeconds(line: string, wpm: number): number {
  const pauses = (line.match(/[,;:—–]/g) ?? []).length;
  return wordList(line).length * 60 / wpm + pauses * TIMING_RULES.commaPause;
}

/** The text the `type` action types (the engine uses the same rule). */
export function typedText(beat: Pick<Beat, "on_screen" | "keyword">): string {
  const onScreen = beat.on_screen?.trim() ?? "";
  return onScreen && onScreen.length <= 32 ? onScreen : beat.keyword.trim();
}

/** How long a UI action takes from the press to its visible result (mirrors the engine). */
export function actionSeconds(beat: Pick<Beat, "ui" | "on_screen" | "keyword">): number {
  switch (beat.ui?.action) {
    case "type": return 0.12 + clamp(typedText(beat).length / TIMING_RULES.typeCps, 0.5, 1.4);
    case "count": return 0.9;
    case "drag": return 0.85;
    case "select": return 0.6;
    case "scroll": return 1.0;
    default: return 0.25;
  }
}

function inferPace(plan: BeatPlan): Pace {
  const speed = plan.audio.voice?.speed;
  if (speed === undefined) return "balanced";
  return speed >= 1.13 ? "fast" : speed <= 1.02 ? "calm" : "balanced";
}

type Row = {
  beat: Beat;
  kind: EngineKind;
  line: string | null;
  lineDur: number;
  /** Line start offset inside the beat (gap + the previous beat's J-cut spill). */
  pre: number;
  duration: number;
  hardMin: number;
  max: number;
};

/** Grows (amount > 0) or shrinks (amount < 0) rows toward their max / hard minimum. Returns what it applied. */
function flex(rows: Row[], amount: number): number {
  const room = (row: Row) => (amount > 0 ? row.max - row.duration : row.duration - row.hardMin);
  const total = rows.reduce((sum, row) => sum + Math.max(0, room(row)), 0);
  if (total <= 0) return 0;
  const applied = Math.min(Math.abs(amount), total);
  for (const row of rows) row.duration += Math.sign(amount) * applied * Math.max(0, room(row)) / total;
  return Math.sign(amount) * applied;
}

/**
 * Times every beat of a plan. Rules (shared-craft → Pacing, watchability → Correct time):
 * - a voiced beat holds its line at the pace's wpm, 0.3 s after the previous line inside an act and
 *   0.45 s between acts; the cut lands 0.12 s before the line ends (J-cut);
 * - kinetic and silent beats run 1.6–4 s (a long voiced line wins over the 4 s cap), UI beats 2.6–5.5 s,
 *   the hook is ≤ 3 s, the title is ≥ 2 s and keeps a landed tail of ≥ 1.2 s after its line;
 * - the film is then scaled toward `target_duration_s` (silent beats and the title flex first, then
 *   holds after voiced lines), never below a minimum; it lands within ±10% or a warning says why not.
 */
export function planTiming(plan: BeatPlan, brief?: Pick<ScriptBrief, "pace"> | null, options: TimingOptions = {}): PlanTiming {
  const R = TIMING_RULES;
  const pace = brief?.pace ?? inferPace(plan);
  const wpm = paceWpm[pace];
  const warnings: string[] = [];
  const beats = plan.beats;
  const rows: Row[] = beats.map((beat, i) => {
    const kind = engineKind(beat);
    const line = beat.line?.trim() || null;
    const measured = options.lineSeconds?.[beat.id];
    const lineDur = line ? (typeof measured === "number" && measured > 0 ? measured : estimateLineSeconds(line, wpm)) : 0;
    const gap = i === 0 ? R.leadIn : ACT[beat.role] !== ACT[beats[i - 1].role] ? R.gapBetweenActs : R.gapInAct;
    const prevVoiced = i > 0 && Boolean(beats[i - 1].line?.trim());
    const pre = line ? gap + (prevVoiced ? R.jcut : 0) : 0;
    const last = i === beats.length - 1;
    const onScreen = beat.on_screen && beat.on_screen.trim() !== beat.keyword.trim() ? beat.on_screen : "";
    const read = R.readPerWord * (wordList(beat.keyword).length + wordList(onScreen).length) + R.readBase;
    // The last beat lands the film (watchability → Land the ending), whatever its kind.
    let min: number = kind === "ui" ? R.uiMin : kind === "title" || last ? (line ? R.titleMin : R.titleSilentMin) : R.kineticMin;
    let max: number = kind === "ui" ? R.uiMax : kind === "title" ? R.titleMax : R.kineticMax;
    // A UI beat must fit the cursor's travel, the action and its result.
    if (kind === "ui") min = Math.max(min, 1.0 + actionSeconds(beat) + (beat.success ? R.successComma + 0.6 : 0.4));
    const voiceNeed = line ? pre + lineDur + (last ? R.landedTail : -R.jcut) : 0;
    const hardMin = Math.max(min, voiceNeed);
    if (beat.role === "hook") {
      if (hardMin > R.hookMax + 0.25) warnings.push(`${beat.id}: the hook runs ${hardMin.toFixed(1)}s; shorten its line so the hook lands within ${R.hookMax}s.`);
      max = Math.min(max, R.hookMax);
    }
    max = Math.max(max, hardMin);
    const duration = Math.max(hardMin, Math.min(read, max));
    return { beat, kind, line, lineDur, pre, duration, hardMin, max };
  });

  const target = plan.target_duration_s;
  const sum = () => rows.reduce((total, row) => total + row.duration, 0);
  const lastRow = rows[rows.length - 1];
  const silentFirst = rows.filter((row) => !row.line || row === lastRow);
  const voiced = rows.filter((row) => row.line && row !== lastRow);
  let diff = target - sum();
  if (Math.abs(diff) > 0.01) {
    diff -= flex(silentFirst, diff);
    if (Math.abs(diff) > 0.01) diff -= flex(voiced, diff);
  }
  // Still short of the -10% bound: stretch every beat proportionally past its soft max (never the hook).
  const floor = target * (1 - R.tolerance);
  if (sum() < floor) {
    const stretchable = rows.filter((row) => row.beat.role !== "hook");
    const short = floor - sum();
    const base = stretchable.reduce((total, row) => total + row.duration, 0);
    for (const row of stretchable) row.duration += short * row.duration / base;
    warnings.push(`The plan is too short for ${target}s: beats were stretched past their usual length. Add a beat or lengthen the lines.`);
  }
  if (sum() > target * (1 + R.tolerance)) warnings.push(`The plan needs ${sum().toFixed(1)}s, more than ${target}s + 10%. Cut a beat or shorten the lines.`);

  const out: BeatTiming[] = [];
  let cursor = 0;
  for (const row of rows) {
    const start = cursor;
    const end = frame(start + row.duration);
    cursor = end;
    const vo = row.line ? { start: round(start + row.pre), end: round(start + row.pre + row.lineDur) } : null;
    let actAt: number | null = null;
    if (row.kind === "ui") {
      const measured = options.lineWords?.[row.beat.id];
      const words = measured?.length ? measured.map((word) => word.text) : wordList(row.line);
      const verb = bare(row.beat.verb ?? "");
      const index = verb ? words.findIndex((word) => bare(word).startsWith(verb) || verb.startsWith(bare(word)) && bare(word).length > 2) : -1;
      // On the verb: its transcript onset when the line is voiced, else its share of the estimated read.
      const onWord = vo && index >= 0
        ? measured?.length ? vo.start + measured[index].start + 0.04 : vo.start + (index / Math.max(1, words.length)) * row.lineDur + 0.08
        : start + Math.max(0.9, 0.38 * (end - start));
      actAt = frame(clamp(onWord, start + 0.9, end - actionSeconds(row.beat) - 0.6));
    }
    let successAt: number | null = null;
    if (row.beat.success) {
      const at = actAt !== null ? actAt + actionSeconds(row.beat) + R.successComma : row.kind === "title" ? start + 0.9 : start + Math.max(0.9, 0.5 * (end - start));
      successAt = frame(Math.min(at, end - 0.5));
    }
    const heard = options.lineWords?.[row.beat.id];
    const words = vo && heard?.length ? heard.map((word) => ({ text: word.text, start: round(vo.start + word.start), end: round(vo.start + word.end) })) : null;
    out.push({ id: row.beat.id, start: round(start), end: round(end), vo, actAt: actAt === null ? null : round(actAt), successAt: successAt === null ? null : round(successAt), words });
  }
  const spoken = out.filter((beat) => beat.vo);
  for (let i = 1; i < spoken.length; i++) {
    const gap = spoken[i].vo!.start - spoken[i - 1].vo!.end;
    if (gap > R.voiceGapMax) warnings.push(`${spoken[i - 1].id}→${spoken[i].id}: the voice stops for ${gap.toFixed(1)}s (keep gaps under ${R.voiceGapMax}s). Give the beats between a line, or shorten the film.`);
  }
  return { pace, target, total: round(cursor), beats: out, warnings };
}

/** The `{ [beatId]: { start, end } }` map the storyboard player uses. */
export function beatTimes(timing: PlanTiming): Record<string, { start: number; end: number }> {
  return Object.fromEntries(timing.beats.map((beat) => [beat.id, { start: beat.start, end: beat.end }]));
}
