/**
 * Read model and string-splice edits for a HyperFrames HTML composition (HTML clips mode).
 *
 * The HTML string is the source of truth. We never build a DOM from user HTML: a small scanner finds
 * start tags (outside <script>/<style>), and edits replace exact attribute / text spans, so formatting
 * survives. Tween edits go through the HyperFrames GSAP writer (acorn + magic-string, browser-safe).
 * Anything the scanner cannot express stays editable in the Source tab.
 */
import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import {
  addAnimationToScript,
  removeAnimationFromScript,
  scalePositionsInScript,
  shiftPositionsInScript,
  updateAnimationInScript
} from "@hyperframes/parsers/gsap-writer-acorn";
import { round3 } from "./time.ts";
import type { Tween } from "./types.ts";

export type SourceTween = Tween & { id: string; method: string };

export type SourceClip = {
  id: string;
  tag: string;
  track: number;
  start: number;
  dur: number;
  className: string;
  src: string;
  text: string;
  /** True when the text span is a plain leaf (no child tags), so it can be edited in place. */
  leaf: boolean;
  css: [string, string][];
  volume: number | null;
  muted: boolean;
};

export type SourceProject = {
  clips: SourceClip[];
  canvas: { width: number; height: number };
  /** Composition length: the root's data-duration, else the end of the last clip. */
  duration: number;
};

type Span = { start: number; end: number };
type Attr = { name: string; value: string; span: Span; valueSpan: Span | null };
type Tag = { name: string; start: number; end: number; attrs: Attr[]; selfClosing: boolean };

const VOID = new Set(["img", "input", "br", "hr", "meta", "link", "source", "audio_"]);
const TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
const ATTR = /\s+([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const blockRanges = (html: string): Span[] => {
  const out: Span[] = [];
  const re = /<(script|style)\b[\s\S]*?<\/\1\s*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
};

function scanTags(html: string): Tag[] {
  const blocks = blockRanges(html);
  const inBlock = (i: number) => blocks.some((b) => i > b.start && i < b.end);
  const tags: Tag[] = [];
  TAG.lastIndex = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    if (inBlock(m.index)) continue;
    const attrs: Attr[] = [];
    const attrText = m[2] ?? "";
    const base = m.index + 1 + m[1]!.length;
    ATTR.lastIndex = 0;
    for (let a = ATTR.exec(attrText); a; a = ATTR.exec(attrText)) {
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      const quoted = a[2] !== undefined || a[3] !== undefined;
      const spanStart = base + a.index;
      const spanEnd = spanStart + a[0].length;
      // value span (inside the quotes when quoted)
      const valueEnd = spanEnd - (quoted ? 1 : 0);
      const valueStart = a[2] !== undefined || a[3] !== undefined || a[4] !== undefined ? valueEnd - value.length : null;
      attrs.push({ name: a[1]!, value, span: { start: spanStart, end: spanEnd }, valueSpan: valueStart === null ? null : { start: valueStart, end: valueEnd } });
    }
    tags.push({ name: m[1]!.toLowerCase(), start: m.index, end: m.index + m[0].length, attrs, selfClosing: m[3] === "/" });
  }
  return tags;
}

const attrOf = (tag: Tag, name: string) => tag.attrs.find((a) => a.name.toLowerCase() === name);
const num = (v: string | undefined, fallback = 0) => { const n = Number.parseFloat(v ?? ""); return Number.isFinite(n) ? n : fallback; };

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function parseStyle(style: string): [string, string][] {
  return style.split(";").map((row) => row.trim()).filter(Boolean).flatMap((row) => {
    const colon = row.indexOf(":");
    return colon < 0 ? [] : [[row.slice(0, colon).trim(), row.slice(colon + 1).trim()] as [string, string]];
  });
}

export const styleToString = (css: readonly [string, string][]) => css.map(([k, v]) => `${k}:${v}`).join("; ");

/** Text between a start tag and its closing tag when nothing but text lies between them. */
function leafText(html: string, tag: Tag): { text: string; span: Span } | null {
  if (tag.selfClosing || VOID.has(tag.name)) return null;
  const close = html.toLowerCase().indexOf(`</${tag.name}`, tag.end);
  if (close < 0) return null;
  const inner = html.slice(tag.end, close);
  return inner.includes("<") ? null : { text: inner, span: { start: tag.end, end: close } };
}

export function parseProject(html: string): SourceProject {
  const tags = scanTags(html);
  const root = tags.find((t) => attrOf(t, "data-width") && attrOf(t, "data-height"));
  const canvas = { width: num(attrOf(root!, "data-width")?.value, 1920), height: num(attrOf(root!, "data-height")?.value, 1080) };
  const clips: SourceClip[] = [];
  for (const tag of tags) {
    const start = attrOf(tag, "data-start");
    const id = attrOf(tag, "id");
    if (!start || !id) continue;
    const leaf = leafText(html, tag);
    const volume = attrOf(tag, "data-volume")?.value;
    clips.push({
      id: id.value,
      tag: tag.name,
      track: num(attrOf(tag, "data-track-index")?.value),
      start: num(start.value),
      dur: num(attrOf(tag, "data-duration")?.value),
      className: attrOf(tag, "class")?.value ?? "",
      src: attrOf(tag, "src")?.value ?? "",
      text: leaf ? decode(leaf.text) : "",
      leaf: leaf !== null,
      css: parseStyle(attrOf(tag, "style")?.value ?? ""),
      volume: volume === undefined ? null : num(volume),
      muted: Boolean(attrOf(tag, "muted"))
    });
  }
  const declared = root ? num(attrOf(root, "data-duration")?.value, 0) : 0;
  const duration = declared || Math.max(0, ...clips.map((c) => c.start + c.dur));
  return { clips, canvas, duration };
}

const find = (html: string, id: string) => {
  const tag = scanTags(html).find((t) => attrOf(t, "id")?.value === id);
  if (!tag) throw new Error(`No element with id "${id}"`);
  return tag;
};

const splice = (html: string, span: Span, text: string) => html.slice(0, span.start) + text + html.slice(span.end);
const quote = (value: string) => value.replace(/"/g, "&quot;");

/** Set (or add) one attribute on the element with this id. A `null` value removes it. */
export function setAttribute(html: string, id: string, name: string, value: string | null): string {
  const tag = find(html, id);
  const attr = attrOf(tag, name.toLowerCase());
  if (attr) {
    if (value === null) return splice(html, attr.span, "");
    return attr.valueSpan ? splice(html, attr.valueSpan, quote(value)) : splice(html, attr.span, ` ${name}="${quote(value)}"`);
  }
  if (value === null) return html;
  const at = tag.selfClosing ? tag.end - 2 : tag.end - 1;
  return splice(html, { start: at, end: at }, ` ${name}="${quote(value)}"`);
}

export function setTiming(html: string, id: string, timing: { start?: number; dur?: number; track?: number }): string {
  let next = html;
  if (timing.start !== undefined) next = setAttribute(next, id, "data-start", String(round3(timing.start)));
  if (timing.dur !== undefined) next = setAttribute(next, id, "data-duration", String(round3(timing.dur)));
  if (timing.track !== undefined) next = setAttribute(next, id, "data-track-index", String(timing.track));
  return next;
}

export function setStyle(html: string, id: string, css: readonly [string, string][]): string {
  return setAttribute(html, id, "style", css.length ? styleToString(css) : null);
}

/** Replace the text of a leaf element. Returns the input unchanged when the element has children. */
export function setText(html: string, id: string, text: string): string {
  const tag = find(html, id);
  const leaf = leafText(html, tag);
  return leaf ? splice(html, leaf.span, encode(text)) : html;
}

/** Remove an element and its contents. Only for elements whose end tag is found; void tags are cut alone. */
export function removeElement(html: string, id: string): string {
  const tag = find(html, id);
  if (tag.selfClosing || VOID.has(tag.name)) return splice(html, tag, "");
  const close = html.toLowerCase().indexOf(`</${tag.name}`, tag.end);
  if (close < 0) return html;
  const closeEnd = html.indexOf(">", close) + 1;
  return splice(html, { start: tag.start, end: closeEnd }, "");
}

/** Append a new clip element before the root's closing tag. `markup` should carry its own id. */
export function appendToRoot(html: string, markup: string): string {
  const tags = scanTags(html);
  const root = tags.find((t) => attrOf(t, "data-width") && attrOf(t, "data-height"));
  if (!root) throw new Error("Composition has no root with data-width / data-height");
  const close = html.toLowerCase().lastIndexOf(`</${root.name}`);
  return splice(html, { start: close, end: close }, `  ${markup}\n`);
}

// ---------------------------------------------------------------- tweens

type ScriptBlock = { code: string; span: Span };

function timelineScript(html: string): ScriptBlock | null {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (/\bsrc\s*=/.test(m[1]!)) continue;
    if (/gsap\.timeline|__timelines/.test(m[2]!)) {
      const start = m.index + m[0].indexOf(m[2]!, m[1]!.length);
      return { code: m[2]!, span: { start, end: start + m[2]!.length } };
    }
  }
  return null;
}

const scalar = (v: unknown) => (v === undefined ? "" : String(v));

/** Tweens targeting `#id`, with `at` relative to the clip's start. */
export function readTweens(html: string, clipId: string, clipStart: number): SourceTween[] {
  const block = timelineScript(html);
  if (!block) return [];
  let parsed;
  try { parsed = parseGsapScriptAcorn(block.code); } catch { return []; }
  const out: SourceTween[] = [];
  for (const a of parsed.animations) {
    if (a.targetSelector !== `#${clipId}`) continue;
    const props = Object.keys(a.properties ?? {});
    const prop = props[0] ?? Object.keys(a.fromProperties ?? {})[0] ?? "";
    out.push({
      id: a.id,
      method: a.method,
      prop,
      from: a.method === "from" ? scalar(a.properties?.[prop]) : scalar(a.fromProperties?.[prop]),
      to: a.method === "from" ? "" : scalar(a.properties?.[prop]),
      dur: a.duration ?? 0,
      ease: a.ease ?? "none",
      at: round3(((a.position as number | undefined) ?? 0) - clipStart)
    });
  }
  return out;
}

const parseValue = (v: string): number | string => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v);

function mapScript(html: string, fn: (code: string) => string): string {
  const block = timelineScript(html);
  if (!block) return html;
  const next = fn(block.code);
  return next === block.code ? html : splice(html, block.span, next);
}

export function updateTween(html: string, tweenId: string, clipStart: number, patch: Partial<Pick<Tween, "dur" | "ease" | "at" | "to" | "from" | "prop">>): string {
  return mapScript(html, (code) => {
    const current = parseGsapScriptAcorn(code).animations.find((a) => a.id === tweenId);
    if (!current) return code;
    const prop = patch.prop ?? Object.keys(current.properties ?? {})[0] ?? "";
    const updates: Record<string, unknown> = {};
    if (patch.dur !== undefined) updates.duration = patch.dur;
    if (patch.ease !== undefined) updates.ease = patch.ease;
    if (patch.at !== undefined) updates.position = round3(clipStart + patch.at);
    if (patch.to !== undefined || patch.prop !== undefined) updates.properties = { [prop]: parseValue(patch.to ?? scalar(current.properties?.[Object.keys(current.properties ?? {})[0] ?? ""])) };
    if (patch.from !== undefined && current.method === "fromTo") updates.fromProperties = { [prop]: parseValue(patch.from) };
    return updateAnimationInScript(code, tweenId, updates);
  });
}

export function addTween(html: string, clipId: string, clipStart: number, tween: Omit<Tween, "at"> & { at?: number }): string {
  return mapScript(html, (code) => addAnimationToScript(code, {
    targetSelector: `#${clipId}`,
    method: tween.from !== "" ? "fromTo" : "to",
    position: round3(clipStart + (tween.at ?? 0)),
    properties: { [tween.prop]: parseValue(tween.to) },
    ...(tween.from !== "" ? { fromProperties: { [tween.prop]: parseValue(tween.from) } } : {}),
    duration: tween.dur,
    ease: tween.ease
  } as Parameters<typeof addAnimationToScript>[1]).script);
}

export function removeTween(html: string, tweenId: string): string {
  return mapScript(html, (code) => removeAnimationFromScript(code, tweenId));
}

/** Move a clip in time and keep its tweens attached to it. */
export function moveClipInTime(html: string, id: string, oldStart: number, newStart: number, track?: number): string {
  let next = setTiming(html, id, { start: newStart, ...(track === undefined ? {} : { track }) });
  const delta = round3(newStart - oldStart);
  if (delta !== 0) next = mapScript(next, (code) => shiftPositionsInScript(code, `#${id}`, delta));
  return next;
}

/** Trim a clip's edges. Dragging the end only changes the duration; tweens keep their absolute times. */
export function trimClip(html: string, id: string, next: { start: number; dur: number }, prev: { start: number; dur: number }, scaleTweens = false): string {
  let out = setTiming(html, id, next);
  if (scaleTweens) out = mapScript(out, (code) => scalePositionsInScript(code, `#${id}`, prev.start, prev.dur, next.start, next.dur));
  return out;
}

/** Insert a copy of an element (with its contents) right after the original, under a new id. */
export function cloneElement(html: string, id: string, newId: string): string {
  const tag = find(html, id);
  let end = tag.end;
  if (!tag.selfClosing && !VOID.has(tag.name)) {
    const close = html.toLowerCase().indexOf(`</${tag.name}`, tag.end);
    if (close < 0) return html;
    end = html.indexOf(">", close) + 1;
  }
  const original = html.slice(tag.start, end);
  const copy = original.replace(/\bid\s*=\s*("[^"]*"|'[^']*')/i, `id="${newId}"`);
  return html.slice(0, end) + "\n  " + copy + html.slice(end);
}

/** First id of the form `base`, `base-2`, `base-3`… that is unused in the composition. */
export function uniqueId(html: string, base: string): string {
  const used = new Set(parseProject(html).clips.map((c) => c.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}
