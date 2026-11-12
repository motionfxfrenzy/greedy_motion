import { createHash } from "node:crypto";
import { currentTake, parseFrameMotion, type FrameMotion, type VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
import { callModel } from "../models/providers.ts";
import { routeFor, type Route } from "../models/routes.ts";
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
  "- {\"kind\":\"move\",\"id\":\"…\",\"from\":{attr:value},\"start\":s,\"end\":s,\"steps\":n} : the element animates from `from` to how it is drawn in the SVG (its END state; stroked paths and loops draw on automatically as they appear). Move, scale or rotate a whole element with \"transform\":\"translate(dx dy) scale(s) rotate(deg)\" (matching the element's coordinate space in the SVG, or a small offset if the element has no transform attribute); reshape or resize with x, y, width, height, cx, cy, r, x1…y2, points, font-size or stroke-width; appear with \"opacity\":\"0\"; recolour with fill or stroke. Optional steps makes it hop n times (a pointer visiting boxes one by one). You may include up to 2 non-overlapping sequential move entries on the same element id when a character or prop performs a two-part action (e.g. walk to the door, then recoil).",
  "- {\"kind\":\"sweep\",\"ids\":[…],\"flash\":{attr:value},\"start\":s,\"end\":s,\"stay\":true|false} : the elements take `flash` one after another (checked in turn) and return, or keep it with stay (boxes dimmed one by one as they are ruled out).",
  "- {\"kind\":\"count\",\"id\":\"…\",\"from\":n,\"start\":s,\"end\":s} : a text element counts up from n to the number it shows.",
  "- {\"kind\":\"vibrate\",\"ids\":[…],\"mode\":\"jiggle\"|\"wave\",\"amp\":n,\"freq\":n,\"start\":s,\"end\":s} : CONTINUOUS shaking of many small things. \"jiggle\" shakes every id in place, all at once and chaotic from start to end. \"wave\" passes a burst of shaking along ids IN THE ORDER GIVEN (a chain reaction; list them in the direction it spreads, source first, ring by ring for a grid), so each starts when its neighbour does, then settles. amp is the shake in drawing units (2 to 3 for small parts joined by lines so the lines still meet them, up to 8 for big ones), freq the shakes per second (3 to 6 slow and heavy, 8 to 12 fast and nervous).",
  "- {\"kind\":\"grow\",\"ids\":[…],\"from\":\"bottom\"|\"top\"|\"left\"|\"right\"|\"center\",\"start\":s,\"end\":s} : shapes grow from zero size out of one edge to how they are drawn, one after another: bars rise from their baseline (from bottom), a progress or loading bar fills from left, a panel opens from its centre, a band or fill rises. Use it instead of fading a bar, block or fill in.",
  "- {\"kind\":\"draw\",\"ids\":[…],\"start\":s,\"end\":s} : strokes draw on along their path, one after another: axes and gridlines, connectors, arrows, outlines, routes, curves, underlines. Use it for anything drawn with a line.",
  "- {\"kind\":\"travel\",\"ids\":[…],\"path\":\"id of a drawn path/line/curve\",\"mode\":\"loop\"|\"once\",\"period\":seconds a lap,\"colors\":[\"#rrggbb\",\"#rrggbb\"] (optional),\"start\":s,\"end\":s} : things move ALONG another drawn path. \"loop\" circulates them round it over and over (traffic on a ring road, items on a conveyor, blood round a circuit, data round a pipeline) and they end where they are drawn; \"once\" carries them from the path's start to where they are drawn at its end (a character walking a route, a parcel following a line, a cursor travelling to a button). colors (2 to 6 hex colours) shifts their fill from the path's start to its end (warming, cooling, filling, ageing). Use several ids on one path, spread along it, for a stream.",
  "- {\"kind\":\"drift\",\"ids\":[…],\"dx\":n,\"dy\":n,\"period\":seconds a pass,\"start\":s,\"end\":s} : things keep drifting by (dx, dy) over and over, fading out at the end of a pass and back in: mist, rising shimmer or steam, falling snow or rain, sparks, a flowing arrow, wind lines, glow rising off a surface.",
  "Rules:",
  "- NEVER leave the start of a scene blank: the first visual action or setting entrance MUST begin between 0.05s and 0.30s so the viewer sees the room, character, or graph axis immediately when the scene starts.",
  "- Follow the words: each subsequent action starts on the word that names it (use the word times) and lands before the next idea starts.",
  "- The scene must never feel stuck. From the first word to the last, something that serves the line is always moving, one action chaining into the next. Hold still only where a reveal lands (at most 1 s), and let the last half second settle.",
  "- Animate what the voiceover describes: characters walking and reacting, coffee spilling or reversing, loops or branches drawing out, a pointer travelling and searching, boxes checked or dimmed in turn, a range closing, bars growing, line-graph curves tracing, counters ticking, a result lighting up. When ideas or questions branch, multiply, or grow louder/bigger in turn, stagger their arrivals and scale (e.g. from smaller scale or font-size) on the words that name them. Never add idle wobble, bobbing, pulsing or decoration that the line does not describe.",
  "- A pointer that searches walks from where the search starts to where it ends, with steps for each box it checks, and a sweep can flash the boxes it passes.",
  "- Elements that also appear in the previous frame are already on screen: NEVER set \"opacity\":\"0\" on an element that existed in the previous frame; animate only how it moves or changes.",
  "- Use only ids that exist in the SVG. Times are between 0 and the scene length. At most 22 entries.",
  "",
  "MAKE IT ALIVE (this is what separates a film from slides that fade in and then sit still):",
  "- Use 12 to 20 entries for a scene of 3 s or more (fewer only for a very short scene). Direct the groups and the individual pieces inside them, not just the frame as a whole.",
  "- Entrances are never opacity alone. Combine opacity 0 with a move or a scale, and vary them: some pieces slide in from the left, some from the right or below (\"translate(-60 0)\", \"translate(0 40)\"), cards pop from \"scale(0.88)\", bars and lines grow from width 0 or height 0, text rises a few pixels. Stagger them: a row of cards or items arrives one after another about 0.1 to 0.18 s apart.",
  "- Order the build like a story: the setting and the title first, then the main object, then its details one by one, and last the small accents (badges, dots, labels).",
  "- After the build, keep going until the scene ends. Do a second layer of action on pieces that are already on screen: a cursor travelling to a button and the button pressing (a quick \"scale(0.94)\" that settles), a toggle flipping, a progress bar filling (width), a number counting up (\"count\"), a highlight sweeping across rows (\"sweep\"), a ring or dial turning (\"transform\":\"rotate(-40)\" into place), a badge popping in late.",
  "- Between actions let a piece breathe: a slow float (\"translate(0 -8)\" settling) or a gentle pulse (\"scale(1.05)\" settling) on the hero object or its accent, timed to land after the build, so the last second still has something moving.",
  "- UNDERSTAND EACH ELEMENT, THEN ANIMATE WHAT IT DOES. Before writing any entry, read the scene's own picture, on-screen words and voiceover, and for every group of elements decide (1) what it IS (bars of a chart, an axis, a connector, a swarm of particles, a character, a vehicle, a progress bar, a panel, a path, a sky, a surface) and (2) what the voiceover says it DOES (grow, count up, draw, circulate, travel, vibrate, hand something on, fill, drain, spin, open, compare, warm up, fade). Then pick the primitive that is how that kind of thing really behaves. Never give everything the same fade-and-slide entrance: that is the failure this rule exists to prevent.",
  "- How things behave: charts build axes and gridlines first (draw), then bars rise from the baseline (grow, staggered), value labels count up in step (count), and connectors or callouts between bars draw on last. Lines, arrows and paths draw along their stroke. Many small repeated shapes (particles, dots, cells, people, coins, packets) are the actors of a process and keep moving for as long as the line describes it: jiggle when they are agitated, wave when something spreads through them in order, travel when they flow along a drawn path (list several on one path), drift when they rise, fall or stream. A thing whose state is described (hot, cold, full, empty, on, off, growing, decaying, selected) shows that state as visible change: colours shifting over time (move with fill or stroke from a start colour, or travel colors), a level rising or draining, a glow brightening, mist or shimmer drifting, never a static icon. Something that is 'passed on', 'sent', 'flows' or 'circulates' visibly moves from one place to the next. A character that goes somewhere travels once along a route.",
  "- Different films, same method. Examples from other subjects: a revenue chart (axes draw, quarterly bars grow from the baseline one by one, the totals count up, a growth arrow draws across the tops); a signup flow (steps appear in order, a progress bar fills from the left, the cursor travels once to the button and the button presses); a story scene (a character travels once along the road, birds drift across the sky, a lamp glow pulses once as the door opens); a planet diagram (moons travel in loops round their orbit paths); a heart or pipeline (cells or packets loop round their circuit, colours shifting from one end to the other); a crowd or market (dots jiggle, a rumour passes through them as a wave).",
  "- Build things in the order the voiceover explains them: each action starts on the word that names it. Elements that a state change or process acts on keep moving until the line moves on, then settle exactly where they are drawn.",
  "- Never leave more than 0.7 s with nothing moving, and never put every entrance at the same time.",
  "- Match the film's motion feel (given in the request): snappy = short, crisp moves of 0.25 to 0.4 s with a little overshoot; smooth = longer glides of 0.6 to 1.0 s; springy = bouncy pops with overshoot. Distances stay modest (20 to 80 px) so the frame still reads as the approved picture, and every piece ends exactly where the SVG draws it."
].join("\n");

const LEAF = /<(rect|circle|ellipse|line|polyline|polygon|path|text|g)\b(?![^>]*\sid=)/g;

/** Gives every drawable element (and group) a stable id the motion can name; elements that have one keep it. */
export function withIds(svg: string): string {
  let n = 0;
  return svg.replace(LEAF, (_match, tag: string) => `<${tag} id="m${++n}"`);
}

export type SceneInput = { profile?: string | undefined; index: number; svg: string; previous: string | null; line: string | null; words: { text: string; start: number; end: number }[]; seconds: number; feel: "explainer" | "default" };

/** Pacing for an explainer: the unhurried rhythm of 3Blue1Brown, where each change is given time to be understood. */
const EXPLAINER_PACE = [
  "PACING (an explainer, like 3Blue1Brown): unhurried and smooth. Give each change about a second (never under 0.6 s), one idea at a time, letting each finish before the next begins; small overlaps are fine, snaps are not.",
  "A searching pointer glides from box to box, pausing on each it checks; use steps for the number of boxes it visits (at most 8 hops; jump ahead with a single glide when there are more).",
  "Prefer a few deliberate actions spread across the line over many quick ones."
].join("\n");

export const motionSignature = (scene: SceneInput) =>
  createHash("sha256").update(JSON.stringify(["m2", scene.profile ?? null, scene.feel, scene.svg, scene.previous ? createHash("sha256").update(scene.previous).digest("hex") : null, scene.line, scene.words, Math.round(scene.seconds * 10)])).digest("hex").slice(0, 24);

/** Seconds of the spoken line (first word to last) that no motion covers; the director is asked again when this is large. */
function uncovered(motion: FrameMotion[], scene: SceneInput): number {
  const from = scene.words[0]?.start ?? 0.3, to = scene.words.at(-1)?.end ?? scene.seconds - 0.4;
  const spans = motion.map((entry) => [Math.max(from, entry.start), Math.min(to, entry.end)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let covered = 0, reach = from;
  for (const [a, b] of spans) { if (b > reach) { covered += b - Math.max(a, reach); reach = b; } }
  return Math.max(0, to - from - covered);
}

/** Embedded pictures (the brand logo) are base64: thousands of tokens the motion model cannot use. */
const withoutImages = (svg: string) => svg.replace(/<image\b[^>]*>/gi, "");

/** Models sometimes wrap the array in prose or code fences, or leave trailing commas, comments or single quotes; fix those before giving up. */
export function parseMotionText(text: string): unknown {
  const body = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1) || "[]";
  try { return JSON.parse(body); } catch { /* repair below */ }
  const repaired = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/'([^'\n]*)'/g, '"$1"');
  return JSON.parse(repaired);
}

/** How many entries of each kind a scene got (and how many the model wrote that did not survive validation), for the logs. */
function kindCounts(motion: FrameMotion[]) {
  const counts: Record<string, number> = {};
  for (const entry of motion) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return counts;
}

async function ask(scene: SceneInput, feedback: string | null, signal: AbortSignal, routeOverride?: Route): Promise<FrameMotion[]> {
  const words = scene.words.map((word) => `${word.text}@${word.start.toFixed(2)}`).join(" ");
  const content = [
    `Scene ${scene.index + 1}, ${scene.seconds.toFixed(2)} s long.${scene.profile ? ` Motion feel: ${scene.profile}.` : ""}`,
    `Voiceover: ${scene.line ?? "(none: a silent scene; pace the motion across it)"}`,
    words ? `Word times (seconds from the scene start): ${words}` : "",
    `Final frame (END state):\n${withoutImages(scene.svg)}`,
    scene.previous ? `Previous frame (already on screen when this scene starts):\n${withoutImages(scene.previous).slice(0, 9000)}` : "This is the first scene.",
    feedback ?? ""
  ].filter(Boolean).join("\n\n");
  const route = routeOverride ?? routeFor("motion");
  const system = scene.feel === "explainer" ? `${SYSTEM}\n${EXPLAINER_PACE}` : SYSTEM;
  if (route.provider !== "anthropic" || routeOverride) {
    // Another provider (MODEL_MOTION) or explicit tier route snapshot: the shared provider layer.
    const result = await callModel({ step: "motion", route, system, messages: [{ role: "user", content }], maxTokens: Math.max(route.maxTokens, 6000), effort: "low", signal, errorPrefix: "Motion request failed", includeErrorDetail: true });
    return finish(scene, result.text);
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: route.model, max_tokens: Math.max(route.maxTokens, 6000), output_config: { effort: route.effort ?? "low" }, system, messages: [{ role: "user", content }] }),
    signal
  });
  const payload = await response.json().catch(() => ({})) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(`Motion request failed (${response.status})${payload.error?.message ? `: ${payload.error.message}` : "."}`);
  const text = (payload.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  return finish(scene, text);
}

/** Parses the model's answer into validated motion and logs what it contained, so a scene with only plain moves can be told from a scene the model never moved. */
function finish(scene: SceneInput, text: string): FrameMotion[] {
  const raw = parseMotionText(text);
  const motion = parseFrameMotion(raw, scene.svg, scene.seconds);
  const asked: Record<string, number> = {};
  for (const item of Array.isArray(raw) ? raw : []) { const kind = String((item as { kind?: unknown })?.kind ?? "?"); asked[kind] = (asked[kind] ?? 0) + 1; }
  console.log(JSON.stringify({ level: "info", event: "motion_directed", scene: scene.index + 1, wrote: asked, kept: kindCounts(motion) }));
  return motion;
}

/** Directs one scene in a single fast pass so all scenes run in parallel without sequential retry latency. */
async function direct(scene: SceneInput, signal: AbortSignal, routeOverride?: Route): Promise<FrameMotion[]> {
  return ask(scene, null, signal, routeOverride);
}

/** The scenes of a frame film, with ids added and word times relative to each scene. */
export function filmScenes(project: VideoProject, timing: PlanTiming, frames: { svg: string; raw?: string }[]): SceneInput[] {
  const plan = project.beatPlan!;
  // The unscoped picture when there is one (see FilmFrame.raw), so authoring and the preview share one signature.
  const ided = frames.map((frame) => withIds(frame.raw ?? frame.svg));
  return plan.beats.map((beat, index) => {
    const slot = timing.beats[index]!;
    const take = currentTake(project.planAudio, beat);
    const offset = (slot.vo?.start ?? slot.start) - slot.start;
    const words = (take?.words ?? []).map((word) => ({ text: word.text, start: +(offset + word.start).toFixed(2), end: +(offset + word.end).toFixed(2) }));
    return { index, svg: ided[index]!, previous: index > 0 ? ided[index - 1]! : null, line: beat.line ?? null, words, seconds: slot.end - slot.start, feel: filmFeel(project), profile: project.brief?.motionProfile };
  });
}

/**
 * Directs every scene whose signature changed (in parallel, within `budgetMs`) and saves the set.
 * Calls `onScene` as each scene finishes so the browser can stream parallel scene animation progress.
 */
export async function ensureFilmMotion(
  project: VideoProject,
  scenes: SceneInput[],
  budgetMs = 60_000,
  onScene?: (info: { index: number; done: number; total: number; cached: boolean; ok?: boolean }) => void,
  routeOverride?: Route
): Promise<VideoProject> {
  const cached = new Map((project.filmMotion ?? []).map((entry) => [entry.signature, entry]));
  const signal = AbortSignal.timeout(budgetMs);
  let directed = 0;
  let doneCount = 0;
  const results = await Promise.all(scenes.map(async (scene) => {
    const signature = motionSignature(scene);
    const hit = cached.get(signature);
    if (hit) {
      doneCount += 1;
      onScene?.({ index: scene.index, done: doneCount, total: scenes.length, cached: true, ok: true });
      return hit;
    }
    let failed = false;
    const motion = await direct(scene, signal, routeOverride).catch((error) => {
      failed = true;
      console.warn(JSON.stringify({ level: "warn", event: "motion_failed", projectId: project.id, scene: scene.index + 1, message: error instanceof Error ? error.message : String(error) }));
      return [] as FrameMotion[];
    });
    directed += 1;
    doneCount += 1;
    onScene?.({ index: scene.index, done: doneCount, total: scenes.length, cached: false, ok: !failed && motion.length > 0 });
    return { signature, svg: scene.svg, motion };
  }));
  if (directed === 0) return project;
  // Only scenes that got motion are kept: one that failed is directed again on the next render.
  return (await saveFilmMotion(project.id, results.filter((entry) => entry.motion.length > 0))) ?? (await getProject(project.id)) ?? project;
}
