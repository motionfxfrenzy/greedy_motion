// The script canvas: the script streams in as plain tagged lines, so the page can show each beat (even a half-written
// one) the moment its words arrive, long before the storyboard exists. Shared by the backend (which writes and checks it)
// and the frontend (which renders it while it streams).
//
//   BEAT: Find the target
//   VISUAL: A row of sorted numbers; a pointer drops on the middle one   (what the viewer sees; a direction, never printed)
//   SCREEN: middle < target        (or "SCREEN: -" when nothing else is read on screen)
//   VOICE: Can you find one number?
//
// A blank line between beats is optional; a new BEAT: line starts the next one.

export type ScriptBeat = {
  /** The key phrase: ≤ 4 words, ≤ 28 characters. */
  keyword: string;
  /** What the viewer sees in this beat, in a sentence: a direction for the storyboard and the reference frame, never printed. */
  visual: string | null;
  /** Words read on screen under the key phrase, or null. */
  onScreen: string | null;
  /** The voiceover line, or null in a film without voiceover. */
  line: string | null;
};

export const SCRIPT_BEATS_MAX = 16;

/**
 * The writer's plan for an explainer, written before the first beat: the one idea, and the worked example's data with
 * every step's result. Kept with the script so every frame, change and storyboard uses the same example.
 */
export type ScriptNotes = { idea: string | null; example: string | null; /** Ids of the objects that recur across scenes ("box-1..box-16, pointer, bracket"), shared by every frame. */ objects?: string | null };

/**
 * A reference frame saved with the project (`VideoProject.scriptFrames`), keyed by everything it was drawn from: the
 * template, look and aspect, and the beat's key phrase, visual and on-screen words. A beat whose key is saved is not redrawn.
 */
export type ScriptFrame = { key: string; svg: string };

/**
 * A frame's motion, directed when the film is rendered (backend/src/plan/frame-motion.ts): plain data the render plays,
 * never code. The SVG is the end state; each entry says what an element (by its id) starts as and when it reaches its
 * drawn state. `start`/`end` are seconds from the start of the scene, so moves land on the words that name them.
 *  - move:  one element animates from `from` (attributes) to how it is drawn, optionally in `steps` (a pointer hopping box to box)
 *  - sweep: several elements flash `flash` one after another (or keep it, with `stay`), like boxes checked in turn
 *  - count: a text element counts up from `from` to the number it shows
 */
export type FrameMotion =
  | { kind: "move"; id: string; from: Record<string, string>; start: number; end: number; steps?: number }
  | { kind: "sweep"; ids: string[]; flash: Record<string, string>; start: number; end: number; stay?: boolean }
  | { kind: "count"; id: string; from: number; start: number; end: number };

const MOTION_ATTRS = new Set(["x", "y", "cx", "cy", "r", "rx", "ry", "width", "height", "x1", "y1", "x2", "y2", "points", "transform", "opacity", "fill", "stroke", "fill-opacity", "stroke-opacity", "stroke-width"]);
const MOTION_ID = /^[A-Za-z][\w-]{0,40}$/;

/** Motion for a scene, kept only where it is well formed, names elements the SVG really has and fits the scene; at most 8 entries. */
export function parseFrameMotion(input: unknown, svg: string, seconds: number): FrameMotion[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  const fraction = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(seconds, Math.max(0, value)) : fallback;
  const attrs = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const out: Record<string, string> = {};
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!MOTION_ATTRS.has(name) || (typeof raw !== "string" && typeof raw !== "number") || String(raw).length > 300 || /url\(|javascript:/i.test(String(raw))) continue;
      // Opacities are 0–1; anything else (a model once wrote 5.5) is clamped.
      out[name] = /opacity$/.test(name) ? String(Math.min(1, Math.max(0, Number(raw) || 0))) : String(raw);
    }
    return Object.keys(out).length ? out : null;
  };
  const motion: FrameMotion[] = [];
  for (const item of input.slice(0, 8)) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const start = fraction(entry.start, 0), end = Math.max(start + 0.2, fraction(entry.end, seconds));
    if (entry.kind === "move" && typeof entry.id === "string" && MOTION_ID.test(entry.id) && ids.has(entry.id)) {
      const from = attrs(entry.from);
      const steps = typeof entry.steps === "number" && entry.steps >= 2 ? Math.min(40, Math.round(entry.steps)) : undefined;
      if (from) motion.push({ kind: "move", id: entry.id, from, start, end, ...(steps ? { steps } : {}) });
    } else if (entry.kind === "sweep" && Array.isArray(entry.ids)) {
      const list = entry.ids.filter((id): id is string => typeof id === "string" && MOTION_ID.test(id) && ids.has(id)).slice(0, 40);
      const flash = attrs(entry.flash);
      // An opacity flash that comes back reads as flicker; dimming that stays (ruled-out boxes) is fine.
      if (flash && entry.stay !== true) for (const name of Object.keys(flash)) if (/opacity$/.test(name)) delete flash[name];
      if (list.length && flash && Object.keys(flash).length) motion.push({ kind: "sweep", ids: list, flash, start, end, ...(entry.stay === true ? { stay: true } : {}) });
    } else if (entry.kind === "count" && typeof entry.id === "string" && MOTION_ID.test(entry.id) && ids.has(entry.id) && typeof entry.from === "number" && Number.isFinite(entry.from)) {
      motion.push({ kind: "count", id: entry.id, from: entry.from, start, end });
    }
  }
  return motion;
}
/** Frames kept per project, newest first: enough for a full script plus a few rounds of changes. */
export const SCRIPT_FRAMES_KEPT = 48;
export const scriptFrameKey = (beat: ScriptBeat, style: { styleExample?: string | undefined; look?: string | undefined; aspect: string }) =>
  ["v2", style.styleExample ?? "", style.look ?? "", style.aspect, beat.keyword, beat.visual ?? "", beat.onScreen ?? ""].join("\u0001");

const value = (rest: string) => rest.trim().replace(/\s+/g, " ");

/** Every beat in the text so far. The last one may still be arriving; `open` names the field being written. */
export function parseScriptStream(text: string): { beats: ScriptBeat[]; open: keyof ScriptBeat | null; notes: ScriptNotes } {
  const beats: ScriptBeat[] = [];
  const notes: ScriptNotes = { idea: null, example: null };
  let open: keyof ScriptBeat | null = null;
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const last = index === lines.length - 1 && !text.endsWith("\n");
    const note = beats.length === 0 ? /^\s*(IDEA|EXAMPLE|OBJECTS)\s*:(.*)$/i.exec(raw) : null;
    if (note) { notes[({ IDEA: "idea", EXAMPLE: "example", OBJECTS: "objects" } as const)[note[1]!.toUpperCase() as "IDEA"]] = value(note[2]!) || null; return; }
    const match = /^\s*(BEAT|VISUAL|SCREEN|VOICE)\s*:(.*)$/i.exec(raw);
    if (!match) return;
    const tag = match[1]!.toUpperCase();
    const content = value(match[2]!);
    if (tag === "BEAT") {
      if (beats.length >= SCRIPT_BEATS_MAX) return;
      beats.push({ keyword: content, visual: null, onScreen: null, line: null });
      if (last) open = "keyword";
      return;
    }
    const beat = beats[beats.length - 1];
    if (!beat) return;
    if (tag === "VISUAL") { beat.visual = content && content !== "-" ? content : null; if (last) open = "visual"; }
    else if (tag === "SCREEN") { beat.onScreen = content && content !== "-" ? content : null; if (last) open = "onScreen"; }
    else { beat.line = content && content !== "-" ? content : null; if (last) open = "line"; }
  });
  return { beats, open, notes };
}

/** The script back in the stream format: what the model is shown when it is asked to change it. */
export function formatScript(beats: readonly ScriptBeat[], notes?: ScriptNotes | null): string {
  const head = [notes?.idea ? `IDEA: ${notes.idea}` : "", notes?.example ? `EXAMPLE: ${notes.example}` : "", notes?.objects ? `OBJECTS: ${notes.objects}` : ""].filter(Boolean).join("\n");
  return (head ? `${head}\n\n` : "") + beats.map((beat) => `BEAT: ${beat.keyword}\nVISUAL: ${beat.visual ?? "-"}\nSCREEN: ${beat.onScreen ?? "-"}\nVOICE: ${beat.line ?? "-"}`).join("\n\n");
}

const clip = (input: unknown, max: number) => typeof input === "string" ? input.trim().replace(/\s+/g, " ").slice(0, max) : "";

/** A script sent back by the page (edited or not): cleaned, bounded, or null when it is not a usable script. */
export function parseScriptBeats(input: unknown): ScriptBeat[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > SCRIPT_BEATS_MAX) return null;
  const beats = input.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return { keyword: clip(record.keyword, 28), visual: clip(record.visual, 200) || null, onScreen: clip(record.onScreen, 60) || null, line: clip(record.line, 300) || null };
  });
  return beats.every((beat) => beat.keyword.length > 0) ? beats : null;
}

/** Notes sent back by the page: cleaned and bounded, or null when there are none. */
export function parseScriptNotes(input: unknown): ScriptNotes | null {
  const record = (input ?? {}) as Record<string, unknown>;
  const notes = { idea: clip(record.idea, 200) || null, example: clip(record.example, 1200) || null, objects: clip(record.objects, 400) || null };
  return notes.idea || notes.example || notes.objects ? notes : null;
}
