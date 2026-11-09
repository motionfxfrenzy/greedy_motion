import { CHARACTER_RULE, filmKind, formatScript, isScriptLedDuration, parseScriptBeats, parseScriptStream, plainText, type BeatPlan, type ScriptBeat, type ScriptBrief, type ScriptNotes } from "@videosaas/contracts";
import { config } from "../config.ts";
import { streamModel, callModel } from "../models/providers.ts";
import { routeFor, routeHasKey } from "../models/routes.ts";
import { inventedNumbers, userMessage, type DirectorContext } from "./director.ts";

/**
 * The script canvas's writer: one short streamed call that returns only the script (key phrase, visual direction, on-screen
 * words, voiceover per beat) in the tagged format of contracts/script-stream.ts. It is the part a person reads, so it streams first; the
 * storyboard (visuals) is planned from it afterwards in the background.
 */
const SYSTEM = [
  "You write the script for a short motion-graphics video: the words, plus one plain sentence per beat saying what the viewer sees.",
  "Answer with the script and nothing else: no preamble, no notes, no markdown. One block per beat, in film order:",
  "BEAT: <key phrase: at most 4 words and 28 characters, the words that land on screen>",
  "VISUAL: <what the viewer sees in this beat, one sentence of at most 25 words: the objects, their layout and the one thing that moves>",
  "SCREEN: <words the viewer reads under the key phrase, at most 60 characters, or - when nothing else needs reading>",
  "VOICE: <the voiceover line, at most 24 words; - when the film has no voiceover>",
  "Leave one blank line between beats.",
  "VISUAL is a direction and is never printed: describe concrete shapes and objects the template can draw (boxes, arrows, charts, a product screen), not camera jargon or feelings.",
  "SCREEN is printed exactly as written: never describe what to show or animate there (not \"Pointer jumps to the middle box\"); that belongs in VISUAL. It is a short label people read (at most 8 words), never a list of data values: the numbers themselves are drawn in the visual.",
  "Each VISUAL shows what its own VOICE line is saying, at the moment it is said: if the line talks about a million, the visual shows the million; if it says \"take sixteen\", the visual shrinks to sixteen. Read each VOICE line against its VISUAL and SCREEN before moving on.",
  "Numbers: use only numbers (digits or words) that appear in the brief, the product or the site facts; do not invent example values, counts, prices or stats, unless a voice section below says otherwise.",
  "Follow the requested beat count and voiceover word budget, and make the first line land within 3 seconds.",
  "Tell the brief's own story in its own shape. Do not add a sales pitch or a call to action the brief does not ask for."
].join("\n");

/**
 * The voice for a film about a topic (no product): the way the best educational shorts (3Blue1Brown, Veritasium) talk,
 * studied from their shorts on 2026-10-27. A person thinking out loud with the viewer, not captions on slides.
 */
const EXPLAINER_VOICE = [
  "VOICE FOR THIS FILM: an explainer, the way the best educational shorts talk. One curious person thinking out loud with the viewer.",
  "",
  "PLAN FIRST. Before the first BEAT, write one line for yourself (it is never shown; the only line allowed before the script):",
  "IDEA: <the single insight the film exists to deliver, at most 20 words>",
  "EXAMPLE: <the concrete example's data and every step's result, worked out exactly (e.g. the list, the target, each comparison and what is left after it)>",
  "OBJECTS: <ids for the things that recur across scenes, so every frame names them the same way: e.g. row, box-1..box-16, pointer, bracket, counter. Lowercase, hyphens, ranges written as box-1..box-16>",
  "Every beat then serves that idea, and the walk-through follows EXAMPLE exactly: no step may contradict the data or the step before it. Every VISUAL that shows the example names EXAMPLE's exact values (the same list, the same target, the same box numbers), so every frame drawn from it matches.",
  "",
  "ARC (fit it to the beat count; merge steps in a short film):",
  "1. Hook (always the first beat): ask the viewer a direct question about the problem at a scale where the obvious way is hopeless or the answer surprises (\"You need one number out of a million. How would you find it?\"). It is the first VOICE line and fits the hook word limit. It must make sense heard alone, without the screen, so it names the scale itself (\"One number in a million. How?\"). Ask it at the big scale even when the brief describes a small example (16 boxes): the small example comes after, in beat 2 or 3, as the way in.",
  "   When the brief describes a walk-through (as template briefs do: \"sixteen boxes, ask for a target...\"), that walk-through is the material for steps 3–5, not the opening. The hook still comes first and is a question, and this overrides telling the brief's story in its own order.",
  "2. The obvious way, said plainly, and why it hurts at that scale.",
  "3. Shrink it to a small example the frame can show (a handful of objects), and introduce the key idea as a move the viewer could make themselves.",
  "4. Walk the example one move per beat, cause then effect.",
  "5. Zoom back out to the hook's scale: the payoff answers the opening question with its striking consequence (a million numbers, about 20 questions).",
  "6. A last line that names the idea or leaves one thought to chew on. Never a call to action.",
  "",
  "FLOW: read every VOICE line in order as one paragraph. It must sound like one continuous explanation: each line follows from the one before (So, But, Now, Which means, Here's the catch), and no two lines could swap places. Each VISUAL shows exactly what its line is talking about, and consecutive VISUALs continue the same objects rather than starting new scenes.",
  "",
  "STYLE:",
  "- Talk to \"you\"; \"I\" and \"we\" are fine. Spoken English with contractions. Mix short punches (two or three words) with longer sentences that carry the reasoning.",
  "- Say the obvious idea or the common wrong answer before the right one, and turn it. Anticipate the viewer's objection and answer it once, when it helps.",
  "- Name a technical term only after the idea is clear, in plain words.",
  "- No hype or marketing words (amazing, powerful, unlock, game-changer, seamless, effortless), no exclamation marks, no \"In this video\".",
  "- Key phrases on screen name the idea or the object (\"Halve the range\", \"Is 37 bigger?\"), not a slogan.",
  "",
  "NUMBERS (this replaces the numbers rule above): illustrative example values are encouraged (16 boxes, find 37; a million numbers). Work out every number you derive and make sure it is right (halving a million takes about 20 steps). Never state statistics, shares, prices or facts about the world that the brief doesn't give."
].join("\n");

/**
 * The voice for a story film (story templates and code-drawn story styles): a short told tale with characters and a turn,
 * not an explainer. Educational templates keep EXPLAINER_VOICE.
 */
const STORY_VOICE = [
  "VOICE FOR THIS FILM: a short told story, not an explainer and not an ad. Characters the viewer can follow, something that happens, and a line that stays.",
  "",
  "PLAN FIRST. Before the first BEAT, write these lines for yourself (they are never shown; the only lines allowed before the script):",
  "IDEA: <the heart of the story in one sentence: who wants what, and what changes, at most 25 words>",
  "EXAMPLE: <the cast and the place, fixed for every frame: each character's name and look in a few words, and the one setting>",
  "OBJECTS: <ids for the characters and props that recur across scenes, so every frame names them the same way: e.g. fox, lantern, bridge. Lowercase, hyphens>",
  "Every beat then tells that story with that cast in that place: no new main character after the opening, and every VISUAL names the characters by their ids.",
  "",
  "ARC (fit it to the beat count; merge steps in a short film):",
  "1. Open on the world and the main character doing their usual thing, so the viewer knows who to follow within 3 seconds.",
  "2. Want or trouble: what the character wants, or what goes wrong.",
  "3. Try: one or two attempts, each a clear action with a result, cause then effect.",
  "4. The turn: one small moment that changes things (a surprise, a kindness, a mistake that helps).",
  "5. After: the world a little different because of it.",
  "6. A closing line that stays with the viewer: an image or a thought, never a moral spelled out as a lecture and never a call to action.",
  "If the idea is about a topic (how money evolved, why leaves fall), tell it through characters living it, not as a lesson: the facts happen to them.",
  "",
  "FLOW: read every VOICE line in order as one paragraph. It must sound like one told story: each line follows from the one before (Then, But, So, Until one day), and no two lines could swap places. Each VISUAL shows exactly what its line is telling, with the same characters continuing from the beat before.",
  "",
  "STYLE:",
  "- Tell it simply, in spoken English with contractions, keeping one tense throughout. Short sentences; one image per line.",
  "- Show the character's feeling through what they do, not by naming it. A little humour is welcome when the style is playful.",
  "- No questions to the viewer as a hook, no \"Did you know\", no hype or marketing words, no exclamation marks.",
  "- Key phrases on screen are short story beats (\"The lid trick\", \"Still warm\"), not lessons or slogans.",
  "",
  "FACTS: when the story touches real facts (history, science), keep them right and simple; never invent dates, statistics or prices the brief doesn't give.",
  "",
  `When you turn the topic into a story, decide who the characters are and at which level each one is (prop, living object or full cartoon character), name them in the cast, and write what they say and do: ${CHARACTER_RULE}`
].join("\n");

/**
 * The writer's system prompt: the shared rules plus the film's voice. A story film (story template or story style) is told
 * as a story; any other film without a product is an explainer; a product film gets only the shared rules.
 */
export function systemBlocks(request: Pick<ScriptRequest, "brief" | "context">): { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] {
  const voice = filmKind(request.brief) === "story" ? STORY_VOICE : request.context.brandName ? null : EXPLAINER_VOICE;
  return voice
    ? [{ type: "text", text: SYSTEM }, { type: "text", text: voice, cache_control: { type: "ephemeral" } }]
    : [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }];
}

/** The system blocks in the provider-neutral shape (a cached block stays cached on Anthropic; Gemini caches by itself). */
const neutralSystem = (request: Pick<ScriptRequest, "brief" | "context">) => systemBlocks(request).map((block) => ({ text: block.text, ...(block.cache_control ? { cache: true } : {}) }));

/** `only`: indices of the beats to rewrite; the answer then holds just those beats, in order, and the rest stay as they are. */
export type ScriptRequest = { brief: ScriptBrief; context: DirectorContext; instruction?: string; previous?: ScriptBeat[]; notes?: ScriptNotes | null; only?: number[] };

export type InsertSceneRequest = {
  brief: ScriptBrief;
  context: DirectorContext;
  previous: ScriptBeat[];
  /** Insertion boundary in `0..previous.length` (`0` = before beat 1, `k` = between beat `k` and beat `k + 1`, `previous.length` = after last beat). */
  position: number;
  prompt: string;
  notes?: ScriptNotes | null;
};

/** The chosen length is a target unless the person locked it: an idea that needs longer gets it, and the canvas says so. */
export function lengthRule(brief: ScriptBrief): string {
  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  if (isScriptLedDuration(brief)) {
    return [
      `LENGTH IS SCRIPT-LED: there is no preset duration target or runtime cap. Let the story or explanation take the natural number of beats${voiced ? " and spoken words" : ""} its idea genuinely needs to land clearly (at least 3 beats, and as many beats as a longer script or multi-step story requires).`,
      "Never pad a short idea to fill time, and never cram or truncate a longer script into an arbitrary short target. The hook word limit still applies."
    ].join(" ");
  }
  if (brief.lockDuration) return `LENGTH IS FIXED at ${brief.durationSeconds}s: keep to the beat range${voiced ? " and the word budget" : ""}; cut to the essentials rather than rushing them.`;
  return [
    `LENGTH: ${brief.durationSeconds}s is a target, not a limit. If the idea needs more time to land clearly, take it: more beats${voiced ? " and words" : ""}, up to about ${Math.round(brief.durationSeconds * 1.5)}s. The person is told the real length and can ask for a shorter cut.`,
    "Never pad: an idea that lands in less time stays short. The hook word limit still applies."
  ].join(" ");
}

function messages({ brief, context, instruction, previous, notes, only }: ScriptRequest) {
  const base = `${userMessage({ ...brief, scriptBeats: undefined }, context)}\n\n${lengthRule(brief)}`;
  if (!previous || !instruction) return [{ role: "user" as const, content: base }];
  if (only?.length) {
    // A change to picked beats: only those come back, so nothing else is rewritten (or even re-sent) while it streams.
    const names = only.map((i) => i + 1).join(", ");
    return [
      { role: "user" as const, content: base },
      { role: "assistant" as const, content: formatScript(previous, notes) },
      { role: "user" as const, content: `Rewrite only beat${only.length > 1 ? "s" : ""} ${names} (counting from 1): ${instruction}\nAnswer with only ${only.length > 1 ? `those ${only.length} beats, in order` : "that beat"}, in the same BEAT/VISUAL/SCREEN/VOICE format, and nothing else: no IDEA, EXAMPLE or OBJECTS lines, no other beats. ${only.length > 1 ? "They" : "It"} must still follow from the beat before and lead into the beat after, and use the film's EXAMPLE values exactly.` }
    ];
  }
  // A change asked for in the canvas: the current script (with the person's own edits) and what to change. Untouched beats stay.
  return [
    { role: "user" as const, content: base },
    { role: "assistant" as const, content: formatScript(previous, notes) },
    { role: "user" as const, content: `Change the script: ${instruction}\nChange only what this asks for and keep every other beat word for word. Answer with the complete script again in the same format.` }
  ];
}

/** Streams the script's text as it is written. Throws on an API error; stops when `signal` aborts. */
export async function* writeScript(request: ScriptRequest, signal: AbortSignal, http: typeof fetch = fetch): AsyncGenerator<string> {
  // Per-step routing (MODEL_SCRIPT_WRITE, which follows MODEL_SCRIPT): when the route is not Anthropic (or no custom http was injected), stream through streamModel.
  const route = routeFor("scriptWrite");
  if (route.provider !== "anthropic" || http === fetch) {
    yield* streamModel({
      step: "scriptWrite",
      route,
      system: neutralSystem(request),
      messages: messages(request),
      maxTokens: 16000,
      effort: "low",
      signal,
      errorPrefix: "Script writer request failed",
      includeErrorDetail: true,
      ...(http !== fetch ? { request: http } : {}),
      stopErrors: { max_tokens: "The script ran too long and was cut off. Try again, or ask for a shorter film." }
    });
    return;
  }
  const response = await http("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: route.model,
      // Room for the plan (IDEA, EXAMPLE) plus multi-minute scripts without cutting off mid-beat.
      max_tokens: route.maxTokens,
      stream: true,
      // Thinking is always on for current models and runs before the first word: short copy needs little of it, and the
      // first words arriving fast is the point of the canvas (measured: ~11 s to the first word at the default effort).
      output_config: { effort: route.effort ?? "low" },
      system: systemBlocks(request),
      messages: messages(request)
    }),
    signal
  });
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`Script writer request failed (${response.status})${detail.error?.message ? `: ${detail.error.message}` : "."}`);
  }
  // Anthropic's server-sent events: text arrives in content_block_delta events.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    let end: number;
    while ((end = buffered.indexOf("\n\n")) >= 0) {
      const event = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      const data = event.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      const payload = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string; stop_reason?: string }; error?: { message?: string } };
      // A script cut off by the output limit would save a half-written last beat: fail instead, so nothing partial is kept.
      if (payload.type === "message_delta" && payload.delta?.stop_reason === "max_tokens") throw new Error("The script ran too long and was cut off. Try again, or ask for a shorter film.");
      if (payload.type === "error") throw new Error(`Script writer failed: ${payload.error?.message ?? "unknown error"}`);
      if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta" && payload.delta.text) yield payload.delta.text;
    }
  }
}

/**
 * The finished script, checked the way the storyboard used to be: numbers the brief does not support are flagged on their
 * beat (shown in the canvas for the person to fix or keep) rather than sent back for a silent rewrite.
 */
export function finishScript(text: string, brief: ScriptBrief, context: DirectorContext, scope?: { previous: ScriptBeat[]; only: number[]; notes?: ScriptNotes | null }): { beats: ScriptBeat[]; notes: ScriptNotes | null; flags: { beat: number; message: string }[] } {
  const parsed = parseScriptStream(text);
  const written = parsed.beats;
  // A full rewrite brings its own plan; a scoped change keeps the film's (or updates it if the writer restated it).
  const notes = parsed.notes.idea || parsed.notes.example || parsed.notes.objects ? parsed.notes : scope?.notes ?? null;
  // A scoped change: its beats go back into their places, and every other beat is the previous one, word for word.
  if (scope && written.length !== scope.only.length) throw new Error("The change came back incomplete. Try again.");
  const beats = scope ? scope.previous.map((beat, i) => scope.only.includes(i) ? written[scope.only.indexOf(i)]! : beat) : written;
  const asPlan = { beats: beats.map((beat, i) => ({ id: `b${i + 1}`, keyword: beat.keyword, on_screen: beat.onScreen, line: beat.line })) } as unknown as BeatPlan;
  const flags = inventedNumbers(asPlan, brief, context).map((problem) => {
    const match = /^b(\d+): (.*)$/.exec(problem);
    return { beat: match ? Number(match[1]) - 1 : -1, message: (match?.[2] ?? problem).replace(/; remove it or use the brief's wording\.$/, ".") };
  });
  // On-screen words are read: a row of data values belongs in the picture, not in the caption.
  beats.forEach((beat, i) => {
    if ((beat.onScreen?.match(/\d+/g) ?? []).length >= 5) flags.push({ beat: i, message: "The on-screen text reads like a list of data; the frame draws the numbers, so keep a short label here." });
  });
  return { beats, notes, flags };
}

export function insertSceneMessages({ brief, context, previous, position, prompt, notes }: InsertSceneRequest) {
  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  const insertionLengthNote = isScriptLedDuration(brief)
    ? "USER SCENE INSERTION: The person is explicitly adding 1 new scene to their storyboard. The film is script-led, so let this new scene take its natural length without compressing or rewriting any other beat."
    : `USER SCENE INSERTION: The person is explicitly adding 1 new scene to their storyboard. Adding a scene is allowed to extend the film's total runtime beyond ${brief.durationSeconds}s; do not compress or rewrite any other beat.`;
  const base = [
    userMessage({ ...brief, scriptBeats: undefined }, context),
    "",
    insertionLengthNote
  ].join("\n");
  const before = position > 0 ? previous[position - 1] : null;
  const after = position < previous.length ? previous[position] : null;
  const boundaryLabel =
    before && after
      ? `between beat ${position} ("${before.keyword}") and beat ${position + 1} ("${after.keyword}")`
      : before
        ? `after the final beat ${previous.length} ("${before.keyword}")`
        : `before the opening beat 1 ("${after?.keyword ?? "Scene 1"}")`;
  const neighborContext = [
    before ? `Preceding scene (beat ${position}):\n${formatScript([before])}` : "Preceding scene: (none — this new scene opens the film)",
    after ? `Following scene (beat ${position + 1}):\n${formatScript([after])}` : "Following scene: (none — this new scene closes the film)"
  ].join("\n\n");
  return [
    { role: "user" as const, content: base },
    { role: "assistant" as const, content: formatScript(previous, notes) },
    {
      role: "user" as const,
      content: [
        `Insert ONE new scene ${boundaryLabel}.`,
        `What the new scene should show / say: ${prompt}`,
        "",
        neighborContext,
        "",
        `Answer with ONLY that 1 new beat in the same BEAT/VISUAL/SCREEN/${voiced ? "VOICE" : "VOICE: -"} format, and nothing else: no IDEA, EXAMPLE or OBJECTS lines, and no other beats. Keep the same cast, recurring objects, visual style, and narrative continuity so it flows naturally from the preceding scene into the following scene.`
      ].join("\n")
    }
  ];
}

function deterministicInsertedSceneBlock(request: InsertSceneRequest): string {
  const { brief, previous, position, prompt } = request;
  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  const cleanPrompt = plainText(prompt).replace(/\s+/g, " ").trim();
  const words = cleanPrompt.split(/\s+/).filter(Boolean);
  const rawKeyword = words.slice(0, 3).join(" ").replace(/[.,;:!?]+$/g, "") || `Scene ${position + 1}`;
  const keyword = rawKeyword.slice(0, 28).trim() || `Scene ${position + 1}`;
  const before = position > 0 ? previous[position - 1] : null;
  const after = position < previous.length ? previous[position] : null;
  const visual = cleanPrompt.slice(0, 195);
  const onScreen = words.slice(0, 5).join(" ").slice(0, 60) || keyword;
  const speaker = brief.audio.cast === "characters" ? (before?.speaker ?? after?.speaker ?? null) : null;
  const voiceLine = voiced
    ? (cleanPrompt.endsWith(".") || cleanPrompt.endsWith("?") || cleanPrompt.endsWith("!") ? cleanPrompt : `${cleanPrompt}.`).slice(0, 180)
    : "-";
  return [
    `BEAT: ${keyword}`,
    `VISUAL: ${visual}`,
    `SCREEN: ${onScreen}`,
    ...(speaker ? [`SPEAKER: ${speaker}`] : []),
    `VOICE: ${voiceLine}`
  ].join("\n");
}

/** Writes a single new scene for insertion at `request.position`, using neighboring context without rewriting other scenes. */
export async function writeInsertedScene(
  request: InsertSceneRequest,
  signal: AbortSignal,
  http: typeof fetch = fetch
): Promise<string> {
  if (http === fetch && (config.planner === "deterministic" || !routeHasKey("sceneInsert")) && !process.env.SCRIPT_WRITER_FORCE_HTTP) {
    if (signal.aborted) throw new Error("Scene insertion was cancelled.");
    return deterministicInsertedSceneBlock(request);
  }
  const route = routeFor("sceneInsert");
  if (route.provider !== "anthropic") {
    const result = await callModel({ step: "sceneInsert", route, system: neutralSystem(request), messages: insertSceneMessages(request), maxTokens: 900, effort: "low", signal, errorPrefix: "Scene writer request failed", includeErrorDetail: true, ...(http !== fetch ? { request: http } : {}), stopErrors: { max_tokens: "The new scene ran too long and was cut off. Try again with a shorter description." } });
    return result.text;
  }
  const response = await http("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: route.model,
      max_tokens: route.maxTokens,
      stream: true,
      output_config: { effort: route.effort ?? "low" },
      system: systemBlocks(request),
      messages: insertSceneMessages(request)
    }),
    signal
  });
  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Scene writer request failed (${response.status})${detail.error?.message ? `: ${detail.error.message}` : "."}`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    let end: number;
    while ((end = buffered.indexOf("\n\n")) >= 0) {
      const event = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      const data = event.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      const payload = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string; stop_reason?: string }; error?: { message?: string } };
      if (payload.type === "message_delta" && payload.delta?.stop_reason === "max_tokens") {
        throw new Error("The new scene ran too long and was cut off. Try again with a shorter description.");
      }
      if (payload.type === "error") throw new Error(`Scene writer failed: ${payload.error?.message ?? "unknown error"}`);
      if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta" && payload.delta.text) {
        text += payload.delta.text;
      }
    }
  }
  return text;
}

/** Validates the single generated beat, splices it into `previous` at `position` leaving every existing beat untouched, and checks flags. */
export function finishInsertedScene(
  text: string,
  brief: ScriptBrief,
  context: DirectorContext,
  options: { previous: ScriptBeat[]; position: number; notes?: ScriptNotes | null; beatId: string }
): {
  insertedBeat: ScriptBeat;
  beats: ScriptBeat[];
  position: number;
  notes: ScriptNotes | null;
  flags: { beat: number; message: string }[];
} {
  const { previous, position, notes, beatId } = options;
  if (!Number.isInteger(position) || position < 0 || position > previous.length) {
    throw new Error("Choose a valid scene boundary.");
  }
  const parsed = parseScriptStream(text);
  if (parsed.beats.length !== 1) {
    throw new Error(parsed.beats.length === 0 ? "The new scene came back empty. Try again." : "The model returned more than one scene. Try again.");
  }
  const validated = parseScriptBeats([
    {
      ...parsed.beats[0]!,
      id: beatId,
      visual: parsed.beats[0]!.visual ?? null,
      onScreen: parsed.beats[0]!.onScreen ?? null,
      line: brief.audio.mode === "voiceover" || brief.audio.mode === "both" ? parsed.beats[0]!.line ?? null : null
    }
  ]);
  const insertedBeat = validated?.[0];
  if (!insertedBeat || !insertedBeat.keyword.trim() || !insertedBeat.visual?.trim()) {
    throw new Error("The new scene came back incomplete. Try again.");
  }
  const beats = [...previous.slice(0, position), insertedBeat, ...previous.slice(position)];
  const asPlan = {
    beats: beats.map((beat, i) => ({ id: `b${i + 1}`, keyword: beat.keyword, on_screen: beat.onScreen, line: beat.line }))
  } as unknown as BeatPlan;
  const flags = inventedNumbers(asPlan, brief, context).map((problem) => {
    const match = /^b(\d+): (.*)$/.exec(problem);
    return { beat: match ? Number(match[1]) - 1 : -1, message: (match?.[2] ?? problem).replace(/; remove it or use the brief's wording\.$/, ".") };
  });
  beats.forEach((beat, i) => {
    if ((beat.onScreen?.match(/\d+/g) ?? []).length >= 5) {
      flags.push({ beat: i, message: "The on-screen text reads like a list of data; the frame draws the numbers, so keep a short label here." });
    }
  });
  return { insertedBeat, beats, position, notes: notes ?? null, flags };
}
