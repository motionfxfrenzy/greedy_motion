import { resolveSceneRoute, type SceneRendering } from "./scene-rendering.ts";
// Product flow v2 (docs/PRODUCT_FLOW_V2.md): the Script & Style brief and the beat plan.
// The beat plan mirrors .claude/skills/gm-script-director/references/beat-plan.schema.json;
// change both together. Budgets come from gm-skill-authoring/references/script-for-motion.md.
import { isLook, type LookId } from "./looks.ts";

export const aspects = ["16:9", "9:16", "1:1"] as const;
export const paces = ["calm", "balanced", "fast"] as const;
export const motionProfiles = ["snappy", "smooth", "springy"] as const;
export const audioModes = ["voiceover", "music", "both", "none"] as const;
export const captionModes = ["key-phrases", "full", "none"] as const;
export const scriptModes = ["problem", "own"] as const;
export const durationPresets = [15, 30, 45, 60, 90] as const;
export const DURATION_MIN = 10;
export const DURATION_MAX = 120;
export const PROBLEM_TEXT_MAX = 600;
export const OWN_SCRIPT_MAX = 4000;

export type Aspect = (typeof aspects)[number];
export type Pace = (typeof paces)[number];
export type MotionProfile = (typeof motionProfiles)[number];
export type AudioMode = (typeof audioModes)[number];
export type CaptionMode = (typeof captionModes)[number];
export type ScriptMode = (typeof scriptModes)[number];
export type VideoFormatKind = "social" | "launch" | "explainer";

/** Everything the Script & Style screen collects. */
export type ScriptBrief = {
  scriptMode: ScriptMode;
  /** The problem description (scriptMode "problem") or the user's own script (scriptMode "own"). */
  text: string;
  durationSeconds: number;
  aspect: Aspect;
  motionProfile: MotionProfile;
  pace: Pace;
  audio: { mode: AudioMode; voice?: string; musicMood?: string };
  captions: CaptionMode;
  /** Optional structure skill, e.g. "gm-feature-explainer". Null lets the director choose. */
  template?: string | null;
  /** Gallery theme id, used when no brand kit is chosen. */
  theme?: string;
  /** Drawing style on top of the brand (looks.ts); colours and fonts always stay the brand's. Default "clean". */
  look?: LookId;
  brandId?: string;
  productName?: string;
  audience?: string;
  /** The product's website, read by `POST /v1/projects/:id/site` (facts for the director, section screenshots). */
  productUrl?: string;
  /** Project screenshot ids in the order the user arranged them. */
  screenshotIds?: string[];
};

/** Words per minute for the voiceover at each pace. */
export const paceWpm: Record<Pace, number> = { calm: 130, balanced: 145, fast: 160 };
/** Average seconds per beat at each pace (used to size the beat list). */
export const paceBeatSeconds: Record<Pace, number> = { calm: 5.5, balanced: 4.5, fast: 3.5 };

export function formatForDuration(seconds: number): VideoFormatKind {
  return seconds <= 30 ? "social" : seconds <= 45 ? "launch" : "explainer";
}

/** The beat-count range the director must hit for a duration and pace. */
export function beatCountRange(seconds: number, pace: Pace): { min: number; max: number } {
  const target = seconds / paceBeatSeconds[pace];
  return { min: Math.max(3, Math.floor(target * 0.8)), max: Math.min(16, Math.ceil(target * 1.2) + 1) };
}

/** Voiceover word budget for the whole film (leaves room for gaps, the hook and the landed ending). */
export function wordBudget(seconds: number, pace: Pace): number {
  return Math.floor((seconds - 2) * (paceWpm[pace] / 60));
}

/** Most words a hook line can have and still be said within 3 s at this pace. */
export function hookWordLimit(pace: Pace): number {
  return Math.floor(2.7 * (paceWpm[pace] / 60));
}

export const beatRoles = ["hook", "problem", "reveal", "feature", "proof", "success", "cta"] as const;
export const beatKinds = ["ui", "kinetic", "3d", "footage", "title"] as const;
export const beatProducers = ["hyperframes", "threejs", "nanobanana+veo", "veo-footage"] as const;
export const uiActions = ["click", "type", "drag", "toggle", "count", "send", "scroll", "select"] as const;
export const transitionTypes = ["j-cut", "match-cut", "push-through", "whip", "brand-field-wipe", "hard-cut-on-beat", "end"] as const;
export const energies = ["calm", "medium", "high"] as const;

export type Vector = { axis: "x" | "y" | "z"; dir: -1 | 1 };

export type Beat = {
  /** Optional per-scene native art direction; omitted values inherit the project look. */
  render?: SceneRendering;
  id: string;
  role: (typeof beatRoles)[number];
  kind: (typeof beatKinds)[number];
  producer: (typeof beatProducers)[number];
  /** Voiceover sentence (verbatim in own-script mode), or null for a silent beat. */
  line: string | null;
  verb: string | null;
  /** Kinetic key phrase on screen; the last word takes the brand accent. */
  keyword: string;
  on_screen: string | null;
  success: boolean;
  energy: (typeof energies)[number];
  ui?: { screen: string; action: (typeof uiActions)[number]; target: string };
  motion: { camera: string; entry: Vector; exit: Vector; text_effect?: string | null };
  generation?: {
    keyframe_prompt?: string;
    end_frame?: "none" | "crop-push" | "generated";
    veo_prompt?: string;
    veo_vector?: string;
    character?: string | null;
    screen?: "replace" | "blank" | "away" | "none";
    dialogue?: string | null;
    voice_modifier?: string | null;
    keep_s?: number;
    skills_used?: string[];
  };
  fallback?: { kind: "ui" | "kinetic"; keyword: string } | null;
  sfx?: string | null;
  transition_out: { type: (typeof transitionTypes)[number]; carrier?: string | null };
};

export type BeatPlanSuggestion = { beat: string; problem: string; proposal: string; accepted: boolean | null };

export type BeatPlan = {
  version: "1.0";
  mode: "own-script" | "problem-only";
  template: string | null;
  format: VideoFormatKind;
  canvas: Aspect;
  target_duration_s: number;
  clock: "voiceover" | "beats";
  brand: { name: string; motion_profile: MotionProfile; style_frame?: string | null };
  characters: { id: string; description: string; sheet?: string | null }[];
  beats: Beat[];
  audio: {
    voice: { engine: "kokoro" | "gemini-tts"; voice: string; speed: number; direction: string } | null;
    music: { source: "lyria" | "library"; prompt: string; bpm?: number } | null;
    captions: CaptionMode;
  };
  approvals: ("script" | "style-frame" | "character-sheet" | "storyboard" | "motion-preview" | "final")[];
  suggestions: BeatPlanSuggestion[];
  estimate: { generated_shots: number; api_usd: number; render_s?: number };
};

/** On-screen and voice budgets, enforced on every edit. */
export const BEAT_LIMITS = { keywordChars: 28, keywordWords: 4, onScreenChars: 60, lineChars: 200, lineWords: 24, dialogueWords: 20 } as const;
export const BANNED_WORDS = ["magic", "revolutionary", "seamless", "game-changing"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
const oneOf = <T extends readonly string[]>(list: T, value: unknown): value is T[number] => typeof value === "string" && (list as readonly string[]).includes(value);

export function parseScriptBrief(value: unknown): { brief: ScriptBrief } | { error: string } {
  if (!isRecord(value)) return { error: "The brief must be an object." };
  if (!oneOf(scriptModes, value.scriptMode)) return { error: "Choose whether to describe the problem or paste your script." };
  const max = value.scriptMode === "own" ? OWN_SCRIPT_MAX : PROBLEM_TEXT_MAX;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (text.length < 12) return { error: value.scriptMode === "own" ? "Paste a script of at least a sentence." : "Describe the problem in at least a sentence." };
  if (text.length > max) return { error: `Keep it under ${max} characters.` };
  const durationSeconds = typeof value.durationSeconds === "number" ? Math.round(value.durationSeconds) : NaN;
  if (!(durationSeconds >= DURATION_MIN && durationSeconds <= DURATION_MAX)) return { error: `Duration must be ${DURATION_MIN}–${DURATION_MAX} seconds.` };
  if (!oneOf(aspects, value.aspect)) return { error: "Choose 16:9, 9:16 or 1:1." };
  if (!oneOf(motionProfiles, value.motionProfile)) return { error: "Choose a motion style: snappy, smooth or springy." };
  if (!oneOf(paces, value.pace)) return { error: "Choose a pace: calm, balanced or fast." };
  if (!isRecord(value.audio) || !oneOf(audioModes, value.audio.mode)) return { error: "Choose voiceover, music, both or none." };
  const captions = value.captions === undefined ? "key-phrases" : value.captions;
  if (!oneOf(captionModes, captions)) return { error: "Choose captions: key phrases, full or off." };
  if (value.template !== undefined && value.template !== null && (typeof value.template !== "string" || !/^gm-[a-z0-9-]+$/.test(value.template))) return { error: "Unknown template." };
  if (value.brandId !== undefined && (typeof value.brandId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.brandId))) return { error: "Unknown brand kit." };
  if (value.look !== undefined && value.look !== null && !isLook(value.look)) return { error: "Unknown look." };
  const screenshotIds = Array.isArray(value.screenshotIds) ? value.screenshotIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 20) : undefined;
  const brief: ScriptBrief = {
    scriptMode: value.scriptMode,
    text,
    durationSeconds,
    aspect: value.aspect,
    motionProfile: value.motionProfile,
    pace: value.pace,
    audio: {
      mode: value.audio.mode,
      ...(clean(value.audio.voice, 40) ? { voice: clean(value.audio.voice, 40) } : {}),
      ...(clean(value.audio.musicMood, 120) ? { musicMood: clean(value.audio.musicMood, 120) } : {})
    },
    captions,
    template: typeof value.template === "string" ? value.template : null,
    ...(clean(value.theme, 60) ? { theme: clean(value.theme, 60) } : {}),
    ...(isLook(value.look) && value.look !== "clean" ? { look: value.look } : {}),
    ...(typeof value.brandId === "string" ? { brandId: value.brandId } : {}),
    ...(clean(value.productName, 60) ? { productName: clean(value.productName, 60) } : {}),
    ...(typeof value.productUrl === "string" && /^https?:\/\/\S+$/i.test(value.productUrl.trim()) && value.productUrl.trim().length <= 300 ? { productUrl: value.productUrl.trim() } : {}),
    ...(clean(value.audience, 160) ? { audience: clean(value.audience, 160) } : {}),
    ...(screenshotIds?.length ? { screenshotIds } : {})
  };
  return { brief };
}

const vector = (value: unknown): Vector | null =>
  isRecord(value) && (value.axis === "x" || value.axis === "y" || value.axis === "z") && (value.dir === 1 || value.dir === -1) ? { axis: value.axis, dir: value.dir } : null;

/**
 * Validates a beat plan structurally and against the script-for-motion budgets. Returns every
 * problem (used for one repair round with the model, and to reject storyboard edits).
 */
export function beatPlanProblems(plan: BeatPlan, brief?: ScriptBrief): string[] {
  const problems: string[] = [];
  if (!Array.isArray(plan.beats) || plan.beats.length < 3) return ["A plan needs at least three beats."];
  if (brief) {
    const range = beatCountRange(brief.durationSeconds, brief.pace);
    if (plan.beats.length < range.min || plan.beats.length > range.max) problems.push(`Use ${range.min}–${range.max} beats for ${brief.durationSeconds}s at a ${brief.pace} pace (got ${plan.beats.length}).`);
    if (brief.audio.mode === "voiceover" || brief.audio.mode === "both") {
      const total = plan.beats.reduce((sum, beat) => sum + (beat.line ? words(beat.line) : 0), 0);
      const budget = wordBudget(brief.durationSeconds, brief.pace);
      // The budget is an estimate (±10%, like the film length): only a clear overrun blocks.
      if (brief.scriptMode === "problem" && total > Math.round(budget * 1.1)) problems.push(`The voiceover is ${total} words; ${brief.durationSeconds}s at a ${brief.pace} pace fits about ${budget}.`);
      // The hook must be said within 3 s (watchability → hook): about 2.7 s of speech after the lead-in.
      const hook = plan.beats[0];
      const hookMax = hookWordLimit(brief.pace);
      if (brief.scriptMode === "problem" && hook?.line && words(hook.line) > hookMax) problems.push(`The hook line is ${words(hook.line)} words (${hook.id}); keep it to ${hookMax} so it lands within 3s.`);
    }
  }
  const ids = new Set<string>();
  let successCount = 0;
  plan.beats.forEach((beat, index) => {
    const at = `beat ${index + 1} (${beat.id})`;
    if (!beat.id || ids.has(beat.id)) problems.push(`${at}: needs a unique id.`);
    ids.add(beat.id);
    try { resolveSceneRoute(beat, brief?.look); } catch (error) { problems.push(`${at}: ${error instanceof Error ? error.message : "invalid scene rendering"}`); }
    if (!oneOf(beatRoles, beat.role)) problems.push(`${at}: unknown role.`);
    if (!oneOf(beatKinds, beat.kind)) problems.push(`${at}: unknown kind.`);
    if (!beat.keyword?.trim()) problems.push(`${at}: needs a kinetic key phrase.`);
    else {
      if (beat.keyword.length > BEAT_LIMITS.keywordChars) problems.push(`${at}: key phrase is ${beat.keyword.length} characters (max ${BEAT_LIMITS.keywordChars}).`);
      if (words(beat.keyword) > BEAT_LIMITS.keywordWords) problems.push(`${at}: key phrase is ${words(beat.keyword)} words (max ${BEAT_LIMITS.keywordWords}).`);
    }
    if (beat.on_screen && beat.on_screen.length > BEAT_LIMITS.onScreenChars) problems.push(`${at}: on-screen text is over ${BEAT_LIMITS.onScreenChars} characters.`);
    if (beat.line) {
      if (beat.line.length > BEAT_LIMITS.lineChars || words(beat.line) > BEAT_LIMITS.lineWords) problems.push(`${at}: voiceover line is too long (max ${BEAT_LIMITS.lineWords} words).`);
      if (beat.verb && !beat.line.toLowerCase().includes(beat.verb.toLowerCase())) problems.push(`${at}: the verb "${beat.verb}" isn't in its line.`);
    }
    if ((beat.kind === "3d" || beat.kind === "footage") && !beat.fallback) problems.push(`${at}: a generated beat needs a 2D fallback.`);
    if (beat.kind === "ui" && !beat.ui) problems.push(`${at}: a UI beat needs a screen, action and target.`);
    if (!vector(beat.motion?.entry) || !vector(beat.motion?.exit)) problems.push(`${at}: motion needs entry and exit vectors.`);
    if (beat.generation?.dialogue && words(beat.generation.dialogue) > BEAT_LIMITS.dialogueWords) problems.push(`${at}: on-camera dialogue is over ${BEAT_LIMITS.dialogueWords} words.`);
    const text = `${beat.line ?? ""} ${beat.keyword ?? ""} ${beat.on_screen ?? ""}`.toLowerCase();
    for (const banned of BANNED_WORDS) if (text.includes(banned)) problems.push(`${at}: don't use "${banned}".`);
    if (beat.success) successCount++;
  });
  if (plan.beats[0] && plan.beats[0].role !== "hook") problems.push("The first beat must be the hook.");
  if (plan.beats.at(-1)?.role !== "cta") problems.push("The last beat must be the call to action.");
  if (successCount !== 1) problems.push(`Exactly one beat must be the success moment (got ${successCount}).`);
  const generated = plan.beats.filter((beat) => beat.kind === "3d" || beat.kind === "footage").length;
  if (generated > 3) problems.push(`At most 3 generated (3D or footage) beats per film (got ${generated}).`);
  for (let i = 1; i < plan.beats.length; i++) {
    const prev = vector(plan.beats[i - 1].motion?.exit);
    const next = vector(plan.beats[i].motion?.entry);
    if (prev && next && (prev.axis !== next.axis || prev.dir !== next.dir)) problems.push(`beat ${i}→${i + 1}: exit and entry must share axis and direction (seam ledger).`);
  }
  return problems;
}

/** Aspect ratio → the existing render format (1:1 renders through the landscape path until square templates ship). */
export function aspectToFormat(aspect: Aspect): "landscape" | "portrait" {
  return aspect === "9:16" ? "portrait" : "landscape";
}

/**
 * The plan's generated sound (docs/PRODUCT_FLOW_V2.md → Audio). One voiceover take per beat line,
 * measured and word-aligned, so the transcript (not the estimate) is the clock; one music bed.
 * A take belongs to its beat only while the beat's line still matches `text`: an edited line falls
 * back to the estimated timing until it is voiced again.
 */
export type PlanVoiceWord = { text: string; start: number; end: number };

export type PlanVoiceLine = {
  beat: string;
  text: string;
  /** File name in the project's plan-audio folder (vo/<hash>.wav). */
  file: string;
  /** Spoken length after trimming silence, in seconds. */
  seconds: number;
  /** Word times relative to the start of the take. */
  words: PlanVoiceWord[];
  aligned: "whisper" | "estimate";
};

export type PlanAudio = {
  voice: { engine: "gemini-tts"; model: string; voice: string; direction: string; pace: Pace; lines: PlanVoiceLine[] } | null;
  music: { source: "lyria"; model: string; prompt: string; file: string; seconds: number } | null;
  /** Generation spend so far for this project's plan audio (USD, estimated from list prices). */
  cost_usd: number;
  updatedAt: string;
};

/** Normalises a line for take matching (whitespace only; any wording change needs a new take). */
/**
 * The text the narrator reads. A colon makes text-to-speech engines drop their pitch and pause oddly mid-sentence, and a
 * line is read, not displayed, so a colon (before a space or at the end) becomes a comma (a full stop at the end). Times
 * ("3:45") and addresses ("https://") have no space after the colon and are left alone.
 */
export const voiceText = (line: string | null | undefined) =>
  (line ?? "").trim().replace(/\s+/g, " ").replace(/\s*:\s*$/, ".").replace(/\s*:(?=\s)/g, ",");

/** The take for a beat, only when it still speaks the beat's current line. */
export function currentTake(audio: PlanAudio | null | undefined, beat: Pick<Beat, "id" | "line">): PlanVoiceLine | null {
  const text = voiceText(beat.line);
  if (!text || !audio?.voice) return null;
  return audio.voice.lines.find((line) => line.beat === beat.id && line.text === text) ?? null;
}

/**
 * On-screen and voiced copy is plain text. Language models like to mark emphasis with markdown
 * (`**now.**`, `*in*`, `_fast_`, backticks); the engine accents the key phrase's last word itself, so
 * any markers would be drawn (and read aloud) literally. Strips them, keeping the words.
 */
export function plainText(value: string): string {
  return value
    .replace(/[*`~]+/g, "")
    .replace(/(^|[\s([{"'])_{1,2}(?=\S)([^_]*?\S)_{1,2}(?=$|[\s.,;:!?)\]}"'])/g, "$1$2")
    .replace(/^\s*(?:#{1,6}|[-+>]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What we read from the product's website (backend/src/site): the product's own words for the
 * director (the only claims it may add beyond the brief) and labelled section screenshots, each
 * with a self-contained HTML/CSS snapshot of the section for faithful UI beats later. Site text is
 * untrusted data: it informs the copy, it never instructs the director.
 */
export type SiteSection = {
  heading: string;
  /** The project screenshot made from this section (null when screenshots were unavailable). */
  screenshotId: string | null;
  /** Self-contained HTML (inline computed styles) in the project's site folder, e.g. "site/section-2.html". */
  snapshot: string | null;
};

export type SiteCapture = {
  url: string;
  title: string;
  description: string;
  /** Headings, CTA labels and short feature lines, in page order. */
  facts: string[];
  /** Visible page text, trimmed (≤ 6000 characters). */
  text: string;
  sections: SiteSection[];
  /** "browser": screenshots and snapshots were taken; "html-only": facts from the static HTML only. */
  mode: "browser" | "html-only";
  capturedAt: string;
};
