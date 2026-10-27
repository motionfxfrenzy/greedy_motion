import { createHash } from "node:crypto";
import { currentTake, parseFrameMotion, type FrameMotion, type VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
import { getProject, saveFilmMotion } from "../projects/store.ts";
import type { PlanTiming } from "./timing.ts";
import { filmFeel } from "./frame-film.ts";

/**
 * Motion for a film made from approved frames, directed when the person clicks Render: each frame is the END state of its
 * scene, and the director says how the scene gets there while its voiceover line plays (a pointer walking the row, boxes
 * checked one by one, a counter ticking), timed to the real word times. The answer is data checked by parseFrameMotion,
 * never code; worker/templates/frame-film plays it. Cached by signature, so an unchanged scene is not directed again.
 */
const SYSTEM = [
  "You direct the motion for one scene of an explainer film. You get the scene's final frame as SVG (its END state; every drawable element has an id), the frame before it, the voiceover line with word times in seconds from the scene start, and the scene's length.",
  "Answer with a JSON array only, no prose. Entry kinds:",
  "- {\"kind\":\"move\",\"id\":\"…\",\"from\":{attr:value},\"start\":s,\"end\":s,\"steps\":n} : the element animates from `from` to how it is drawn. Move a whole element with \"transform\":\"translate(dx dy)\"; reshape with x, y, width, height, cx, cy, r, x1…y2 or points; appear with \"opacity\":\"0\"; recolour with fill or stroke. Optional steps makes it hop n times (a pointer visiting boxes one by one).",
  "- {\"kind\":\"sweep\",\"ids\":[…],\"flash\":{attr:value},\"start\":s,\"end\":s,\"stay\":true|false} : the elements take `flash` one after another (checked in turn) and return, or keep it with stay (boxes dimmed one by one as they are ruled out).",
  "- {\"kind\":\"count\",\"id\":\"…\",\"from\":n,\"start\":s,\"end\":s} : a text element counts up from n to the number it shows.",
  "Rules:",
  "- Follow the words: each action starts on the word that names it (use the word times) and lands before the next idea starts.",
  "- The scene must never feel stuck. From the first word to the last, something that serves the line is always moving, one action chaining into the next. Hold still only where a reveal lands (at most 1 s), and let the last half second settle.",
  "- Animate what the voiceover describes: a pointer travelling and searching, boxes checked or dimmed in turn, a range closing, bars growing, counters ticking, a result lighting up. Never add idle wobble, bobbing, pulsing or decoration.",
  "- A pointer that searches walks from where the search starts to where it ends, with steps for each box it checks, and a sweep can flash the boxes it passes.",
  "- Elements that also appear in the previous frame are already on screen: animate only how they change, not their arrival. Leave the scene's title alone.",
  "- Use only ids that exist in the SVG. Times are between 0 and the scene length. At most 8 entries."
].join("\n");

const LEAF = /<(rect|circle|ellipse|line|polyline|polygon|path|text|g)\b(?![^>]*\sid=)/g;

/** Gives every drawable element (and group) a stable id the motion can name; elements that have one keep it. */
export function withIds(svg: string): string {
  let n = 0;
  return svg.replace(LEAF, (_match, tag: string) => `<${tag} id="m${++n}"`);
}

export type SceneInput = { index: number; svg: string; previous: string | null; line: string | null; words: { text: string; start: number; end: number }[]; seconds: number; feel: "explainer" | "default" };

/** Pacing for an explainer: the unhurried rhythm of 3Blue1Brown, where each change is given time to be understood. */
const EXPLAINER_PACE = [
  "PACING (an explainer, like 3Blue1Brown): unhurried and smooth. Give each change about a second (never under 0.6 s), one idea at a time, letting each finish before the next begins; small overlaps are fine, snaps are not.",
  "A searching pointer glides from box to box, pausing on each it checks; use steps for the number of boxes it visits (at most 8 hops; jump ahead with a single glide when there are more).",
  "Prefer a few deliberate actions spread across the line over many quick ones."
].join("\n");

export const motionSignature = (scene: SceneInput) =>
  createHash("sha256").update(JSON.stringify([scene.feel, scene.svg, scene.previous ? createHash("sha256").update(scene.previous).digest("hex") : null, scene.line, scene.words, Math.round(scene.seconds * 10)])).digest("hex").slice(0, 24);

/** Seconds of the spoken line (first word to last) that no motion covers; the director is asked again when this is large. */
function uncovered(motion: FrameMotion[], scene: SceneInput): number {
  const from = scene.words[0]?.start ?? 0.3, to = scene.words.at(-1)?.end ?? scene.seconds - 0.4;
  const spans = motion.map((entry) => [Math.max(from, entry.start), Math.min(to, entry.end)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let covered = 0, reach = from;
  for (const [a, b] of spans) { if (b > reach) { covered += b - Math.max(a, reach); reach = b; } }
  return Math.max(0, to - from - covered);
}

async function ask(scene: SceneInput, feedback: string | null, signal: AbortSignal): Promise<FrameMotion[]> {
  const words = scene.words.map((word) => `${word.text}@${word.start.toFixed(2)}`).join(" ");
  const content = [
    `Scene ${scene.index + 1}, ${scene.seconds.toFixed(2)} s long.`,
    `Voiceover: ${scene.line ?? "(none: a silent scene; pace the motion across it)"}`,
    words ? `Word times (seconds from the scene start): ${words}` : "",
    `Final frame (END state):\n${scene.svg}`,
    scene.previous ? `Previous frame (already on screen when this scene starts):\n${scene.previous.slice(0, 9000)}` : "This is the first scene.",
    feedback ?? ""
  ].filter(Boolean).join("\n\n");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.MOTION_MODEL || process.env.FRAME_MODEL || config.anthropicModel, max_tokens: 3000, output_config: { effort: "low" }, system: scene.feel === "explainer" ? `${SYSTEM}\n${EXPLAINER_PACE}` : SYSTEM, messages: [{ role: "user", content }] }),
    signal
  });
  const payload = await response.json().catch(() => ({})) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(`Motion request failed (${response.status})${payload.error?.message ? `: ${payload.error.message}` : "."}`);
  const text = (payload.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return parseFrameMotion(JSON.parse(json || "[]"), scene.svg, scene.seconds);
}

/** Directs one scene; asks once more when the motion leaves the line standing still for long. */
async function direct(scene: SceneInput, signal: AbortSignal): Promise<FrameMotion[]> {
  const first = await ask(scene, null, signal);
  const gap = uncovered(first, scene);
  if (gap <= Math.max(1.2, (scene.words.at(-1)?.end ?? scene.seconds) * 0.25)) return first;
  const again = await ask(scene, `Your last answer left ${gap.toFixed(1)} s of the spoken line with nothing moving: ${JSON.stringify(first)}. Fill the gaps with motion the words describe, so the scene never feels stuck.`, signal).catch(() => first);
  return uncovered(again, scene) < gap ? again : first;
}

/** The scenes of a frame film, with ids added and word times relative to each scene. */
export function filmScenes(project: VideoProject, timing: PlanTiming, frames: { svg: string }[]): SceneInput[] {
  const plan = project.beatPlan!;
  const ided = frames.map((frame) => withIds(frame.svg));
  return plan.beats.map((beat, index) => {
    const slot = timing.beats[index]!;
    const take = currentTake(project.planAudio, beat);
    const offset = (slot.vo?.start ?? slot.start) - slot.start;
    const words = (take?.words ?? []).map((word) => ({ text: word.text, start: +(offset + word.start).toFixed(2), end: +(offset + word.end).toFixed(2) }));
    return { index, svg: ided[index]!, previous: index > 0 ? ided[index - 1]! : null, line: beat.line ?? null, words, seconds: slot.end - slot.start, feel: filmFeel(project) };
  });
}

/**
 * Runs at Render: directs every scene whose signature changed (in parallel, within `budgetMs`) and saves the set.
 * A scene that fails or runs out of time keeps no motion; the film still renders, with its frames gliding at the cuts.
 */
export async function ensureFilmMotion(project: VideoProject, scenes: SceneInput[], budgetMs = 60_000): Promise<VideoProject> {
  const cached = new Map((project.filmMotion ?? []).map((entry) => [entry.signature, entry]));
  const signal = AbortSignal.timeout(budgetMs);
  let directed = 0;
  const results = await Promise.all(scenes.map(async (scene) => {
    const signature = motionSignature(scene);
    const hit = cached.get(signature);
    if (hit) return hit;
    const motion = await direct(scene, signal).catch((error) => {
      console.warn(JSON.stringify({ level: "warn", event: "motion_failed", projectId: project.id, scene: scene.index + 1, message: error instanceof Error ? error.message : String(error) }));
      return [] as FrameMotion[];
    });
    directed += 1;
    return { signature, svg: scene.svg, motion };
  }));
  if (directed === 0) return project;
  // Only scenes that got motion are kept: one that failed is directed again on the next render.
  return (await saveFilmMotion(project.id, results.filter((entry) => entry.motion.length > 0))) ?? (await getProject(project.id)) ?? project;
}
