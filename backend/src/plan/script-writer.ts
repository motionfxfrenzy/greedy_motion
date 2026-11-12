import { CHARACTER_RULE, filmKind, formatScript, inferScriptTemplate, isScriptLedDuration, parseScriptBeats, parseScriptStream, plainText, productFlowFor, type BeatPlan, type ProductFlow, type ScriptBeat, type ScriptBrief, type ScriptNotes, type ScriptTemplate } from "@videosaas/contracts";
import { config } from "../config.ts";
import { streamModel, callModel } from "../models/providers.ts";
import { routeFor, routeHasKey } from "../models/routes.ts";
import { inventedNumbers, languageRule, userMessage, type DirectorContext } from "./director.ts";

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
  "VISUAL is a direction and is never printed: describe concrete shapes and objects the template can draw (boxes, arrows, charts, a product screen), not camera jargon or feelings. Compose the main focal subject and action in the central area of the frame with balanced top and bottom padding in all aspect ratios (9:16, 16:9, and 1:1), never bottom-heavy, with foreground subjects clearly in front of background hills or landscapes and complete character/prop geometry (such as a balloon and its basket) visible.",
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
  "- Talk to \"you\"; \"I\" and \"we\" are fine. Natural spoken phrasing (in the requested VOICE language; spoken English with contractions when English). Mix short punches (two or three words) with longer sentences that carry the reasoning.",
  "- Say the obvious idea or the common wrong answer before the right one, and turn it. Anticipate the viewer's objection and answer it once, when it helps.",
  "- Name a technical term only after the idea is clear, in plain words.",
  "- No hype or marketing words (amazing, powerful, unlock, game-changer, seamless, effortless), no exclamation marks, no \"In this video\".",
  "- Key phrases on screen name the idea or the object (\"Halve the range\", \"Is 37 bigger?\"), not a slogan.",
  "",
  "NUMBERS (this replaces the numbers rule above): illustrative example values are encouraged (16 boxes, find 37; a million numbers). Work out every number you derive and make sure it is right (halving a million takes about 20 steps). Never state statistics, shares, prices or facts about the world that the brief doesn't give."
].join("\n");


/**
 * The flow of a product film. It is the structure of the film, not its look: the look, colours and type come from the style
 * template, and none of this copies a particular film. Studied from two public product films (a launch-page film and a
 * UI-demo film), 2026-11-12. What-If and How-Does films never use this: they keep their own voices.
 * Music and voiceover are the person's choice, so the script reads on its own with sound off.
 */
const PRODUCT_COMMON = [
  "VOICE FOR THIS FILM: a product film. Short, concrete, confident; each beat is one idea and one thing on screen. No hype words (amazing, powerful, unlock, game-changer, seamless, revolutionary), no exclamation marks.",
  "The film makes sense with the sound off: SCREEN carries the message, VOICE (when there is one) only says it aloud in plain words.",
  "The product is shown, not described: most beats put a piece of the real product interface on screen (a card, list, control, chart, prompt bar), and VISUAL says what the cursor or the data does there.",
  "Use only claims, names and numbers from the brief, the brand and the site facts. Never invent a statistic, customer, logo or price; if proof is missing, skip that beat.",
  "This film may end with a call to action (it is a product film): the product name, one short line and the site address from the brief or the site, when there is one."
];

const PRODUCT_FLOWS: Record<ProductFlow, string[]> = {
  "launch-sections": [
    "FLOW: a launch page set in motion, in sections. Fit it to the beat count; merge sections in a short film, never reorder them.",
    "1. Hook (first beat, lands in 3 seconds): the viewer's own world or problem in one plain line, with the everyday tools or objects they already juggle on screen.",
    "2. Brand reveal: the product name and logo, with its one-line promise.",
    "3. The promise: a headline that says what the product does for the viewer, with the whole product screen shown once.",
    "4. Feature sections (three or four, one per beat): each has a small label of two or three words (SCREEN starts with it in capitals), a headline of at most eight words in which exactly one word is the highlighted keyword, and one product card showing that feature working, with a cursor or typing doing the action.",
    "5. A standout moment, only if the brief or site gives one: one big figure or claim filling the frame.",
    "6. Proof, only if the brief or site gives it: customer names or a few real figures in a row. Skip it otherwise.",
    "7. End card: the logo, one short line, a button-shaped call to action and the address."
  ],
  "ui-moments": [
    "FLOW: product demo moments, one interface piece at a time, each centred alone on a plain ground, with a cursor doing the work. Fit it to the beat count.",
    "1. A quick opening: a small loading or first-state piece that wakes up (not a title card).",
    "2. The thing the product organises or collects: a library, list or inbox view appearing.",
    "3. A control being set: a slider, a toggle or a segmented switch that the cursor moves, with its value changing.",
    "4. The result: a dashboard card or chart where one figure counts up (only a figure the brief or site gives; otherwise show the chart rising without numbers).",
    "5. The ask: a prompt or command bar where a request is typed in plain language.",
    "6. The approval: a card with its main button ('Approve', 'Launch', 'Publish') that the cursor presses, then the state confirms.",
    "Each beat shows ONE interface piece; the next beat replaces it. SCREEN is a short label (at most four words) or -."
  ]
};

/** The voice block of a product film: the shared rules plus the flow its style template asks for. */
export function productVoice(styleExample: string | null | undefined): string {
  return [...PRODUCT_COMMON, "", ...PRODUCT_FLOWS[productFlowFor(styleExample)]].join("\n");
}

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
  "- Tell it simply, in natural spoken phrasing (in the requested VOICE language; spoken English with contractions when English), keeping one tense throughout. Short sentences; one image per line.",
  "- Show the character's feeling through what they do, not by naming it. A little humour is welcome when the style is playful.",
  "- No questions to the viewer as a hook, no \"Did you know\", no hype or marketing words, no exclamation marks.",
  "- Key phrases on screen are short story beats (\"The lid trick\", \"Still warm\"), not lessons or slogans.",
  "",
  "FACTS: when the story touches real facts (history, science), keep them right and simple; never invent dates, statistics or prices the brief doesn't give.",
  "",
  `When you turn the topic into a story, decide who the characters are and at which level each one is (prop, living object or full cartoon character), name them in the cast, and write what they say and do: ${CHARACTER_RULE}`
].join("\n");

export type VisualWorldPreset = {
  id: string;
  name: string;
  palette: string;
  castStyle: string;
  stagingStyle: string;
};

export const VISUAL_WORLD_PRESETS: readonly VisualWorldPreset[] = [
  {
    id: "cosmic-teal-coral",
    name: "Cosmic Teal & Coral Studio",
    palette: "Deep indigo-plum background (#0c1026), warm coral (#fb7185), electric teal (#2dd4bf), and sunlit gold (#fbbf24) accents.",
    castStyle: "Expressive geometric character in a warm coral jacket (#fb7185) and teal collar, dark head (#0a0d1a) with gold crescent rim-light (#fde68a) and expressive white eyes.",
    stagingStyle: "Layered parallax foreground props, contoured seats/desks, glowing circular portals, and split-screen panels—never a bare stick figure on a flat line."
  },
  {
    id: "cobalt-amber-cutaway",
    name: "Engineering Cobalt & Amber Cutaway",
    palette: "Deep Prussian-cobalt ground (#081426), warm amber (#f59e0b), cyan (#38bdf8), and crisp cream (#fef3c7) highlights.",
    castStyle: "Character in a sleek amber jacket (#f59e0b) with cyan accent trim, dark silhouette head (#090d16) with cyan rim-light (#67e8f9) and expressive white eyes.",
    stagingStyle: "X-ray device cutaways, first-person POV hands operating controls, over-the-shoulder depth views, and isometric cross-sections."
  },
  {
    id: "espresso-terracotta-editorial",
    name: "Warm Espresso & Terracotta Editorial",
    palette: "Rich dark-espresso vignette (#14100e), terracotta (#ea580c), sage mint (#34d399), and warm cream (#fef3c7) accents.",
    castStyle: "Stylized character in a sage-emerald jacket (#10b981) with warm cream highlight, dark head (#0d0b0a) with amber rim-light (#fcd34d).",
    stagingStyle: "Warm café/studio tables in foreground, over-the-shoulder perspectives, split-screen comparisons, and tactile hands-on close-ups."
  },
  {
    id: "emerald-gold-cinema",
    name: "Deep Forest & Gold Cinema",
    palette: "Deep pine-slate vignette (#091615), luminous gold (#eab308), sky cyan (#38bdf8), and soft coral (#f87171) accents.",
    castStyle: "Character in a sunlit gold jacket (#eab308) with dark slate trousers, dark head (#081010) with cream rim-light (#fef3c7).",
    stagingStyle: "Dramatic spotlight cones, over-the-shoulder window views, POV hands-on shots, and cutaway diagrams."
  },
  {
    id: "midnight-neon-noir",
    name: "Midnight Neon Noir",
    palette: "Deep midnight-navy vignette (#090a14), electric violet (#8b5cf6), cyan (#67e8f9), and warm cream (#fef3c7).",
    castStyle: "Character in an electric violet hoodie (#8b5cf6) with cream front highlight, dark circle head (#0d0d14) with warm rim-light.",
    stagingStyle: "Cinematic wide dioramas, extreme close-up eye reflections, POV hands, and split-screen contrasts."
  }
];

export function selectVisualWorld(text: string): VisualWorldPreset {
  const s = (text || "").trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Math.abs(h) % VISUAL_WORLD_PRESETS.length;
  return VISUAL_WORLD_PRESETS[idx]!;
}

/**
 * The voice for a "What If" thought-experiment film (e.g. "What if you could rewind time by 10 seconds?"):
 * second-person camera-shot micro-beats, chronological escalation (Day one -> Week one -> Month one -> Year one -> Years later),
 * lived symptoms followed by real psychology/science studies, and rotating A-Roll camera shots + B-Roll visual inserts.
 */
export const WHAT_IF_VOICE = [
  "VOICE FOR THIS FILM: a 'What If' thought-experiment story-essay (in the narrative style of top thought-experiment channels). You put the viewer inside the premise in present-tense second person ('You'), escalating from playful wish-fulfillment to the hidden catch, real psychology/science studies, and an emotional human payoff.",
  "",
  "PLAN FIRST. Before the first BEAT, write these three lines for yourself (never shown; the only lines allowed before the script):",
  "IDEA: <the premise, the hidden catch, and the human truth at the end, at most 25 words>",
  "EXAMPLE: <1) lock the film's VISUAL WORLD PALETTE and protagonist look from the assigned Visual World Preset; 2) HERO OBJECT ANATOMY: name the film's central physical object and list 4–6 of its recognizable physical sub-parts (e.g. for headphones: curved headband-arch over head, angled oval earcup-shell, plush ear-cushion, outer-mic-grille, glowing anc-button; for an insulated bottle: threaded cap, narrow neck collar, tapered double-wall steel body, vacuum gap, inner copper lining) plus its proper real-world environment; 3) the exact numbers and real psychology/science studies used>",
  "OBJECTS: <ids for recurring characters, the hero object, its sub-parts, and props across scenes. Lowercase, hyphens>",
  "",
  "NARRATIVE ARC & FLOW (unpack into camera-shot micro-beats; never compress multiple actions into one summary sentence):",
  "1. Hook & Constraint (1–2 crisp beats): Open with the 'What if...' question, then narrow the exact rule ('By exactly 10 seconds. Not a day, not an hour — anytime you want.'). NEVER spoil the trap or ending in the hook.",
  "2. 'Day one.' — Visceral Micro-Story (4–6 camera-shot beats): Drop straight into one everyday accident and unpack it one physical action per beat (6–14 words per beat), rotating camera angles:",
  "   - Setup action ([A-ROLL: OVER-THE-SHOULDER] or [A-ROLL: WIDE SCENE]: e.g. walking with a steaming cup toward a door).",
  "   - The accident ([A-ROLL: POV HANDS]: close-up on hands/elbow hitting the handle and liquid splashing).",
  "   - Gut reaction ([A-ROLL: CLOSE-UP]: tight close-up on eyes clenching shut wishing it never happened).",
  "   - The power triggers ([A-ROLL: CUTAWAY / X-RAY] or [A-ROLL: WIDE SCENE]: time/environment snapping backward).",
  "   - Aftermath & first tests ([A-ROLL: POV HANDS] staring at your hands -> [B-ROLL: VISUAL METAPHOR] checklist of small tests -> [A-ROLL: SPLIT-SCREEN] contrasting Attempt 1 vs. Attempt 2 -> [B-ROLL: COUNTER HIT] end-of-day tally).",
  "3. 'Week one.' & 'Month one.' — Gaming the System, Edge Limits & The First Catch (4–6 beats):",
  "   - Show social wins and test an edge limit where the rule fails.",
  "   - Reveal the First Catch with a [B-ROLL: DUAL CLOCK] comparison.",
  "4. The 3-Part Science / Psychology Sandwiches (weave in 2–4 real studies, 3 beats per study):",
  "   - NEVER lecture out of nowhere. Every scientific or psychological concept MUST follow this 3-beat sandwich:",
  "     (a) Lived Symptom ([A-ROLL: OVER-THE-SHOULDER] / [A-ROLL: POV HANDS] / [A-ROLL: WIDE SCENE]): show what happens to 'you' first.",
  "     (b) The Real Study ([B-ROLL: BAR COMPARISON] / [B-ROLL: VISUAL METAPHOR] / [B-ROLL: LINE GRAPH]): cut to a clean B-Roll visual insert naming the real finding.",
  "     (c) Personal Mirror ([A-ROLL: CLOSE-UP] or [A-ROLL: SPLIT-SCREEN]): one punchy sentence tying the study back to you.",
  "5. 'Year one.' — Emotional Climax & The Boundary Failure (4–6 beats):",
  "   - Show the cost of deleting authentic moments ([B-ROLL: VISUAL METAPHOR]) and hit a real-life mistake outside the rule's boundary, backed by research ([B-ROLL: LINE GRAPH]).",
  "6. 'Years later.' — Resolution, Callback & Audience Question Outro (3–4 beats):",
  "   - Choose NOT to use the power during an honest human moment, echo the opening prop, and close by asking the viewer a direct question.",
  "",
  "MANDATORY CAMERA VARIETY & A-ROLL / B-ROLL TAGGING (every beat's VISUAL line MUST start with one of these exact tags; NEVER use the same A-Roll camera angle twice in a row, and NEVER draw a plain stick figure standing on a bare line):",
  "- [A-ROLL: HERO MEDIUM SHOT] : Chest-up / shoulders-up framing of the person in the proper real-world environment (e.g. airplane window & wing, sunny beach/trail, office desk) with the Hero Object worn or held large (25%–35% of the frame) and drawn with all 4–6 of its recognizable physical sub-parts so it registers immediately on the viewer. Always use this when introducing the Hero Object in use.",
  "- [A-ROLL: POV HANDS] : First-person / hands-on close-up of expressive hands interacting with a physical object, button, mug, bottle, phone, or instrument (no full-body figure or floor line).",
  "- [A-ROLL: OVER-THE-SHOULDER] : Foreground silhouette of character's head/shoulder on the left or right third looking into a deep background environment (out an airplane window, across a desk, down a city street).",
  "- [A-ROLL: CUTAWAY / X-RAY] : Zoom into the Hero Object on/with the person and slice open a glowing cutaway window revealing its internal layers/components working inside simultaneously.",
  "- [A-ROLL: SPLIT-SCREEN] : Two side-by-side or stacked panels contrasting two simultaneous realities, temperatures, attempts, or people.",
  "- [A-ROLL: WIDE SCENE] : Layered environmental diorama (foreground framing props, midground character in a seat/vehicle/room, deep background skyline/nature). Zero charts or flowchart arrows.",
  "- [A-ROLL: CLOSE-UP] : Dark vignette background + large centered close-up of character's face/eyes for shock, realization, or hesitation.",
  "- [B-ROLL: LINE GRAPH] : Clean L-shaped X/Y axis on dark grid with 1–2 bold curves. Use ONLY when the line describes a trend or curve over time.",
  "- [B-ROLL: BAR COMPARISON] : 2 clean vertical bars comparing two groups with the character standing beside the bar. Use ONLY when comparing study groups.",
  "- [B-ROLL: DUAL CLOCK] : 1 or 2 circular stopwatches comparing durations.",
  "- [B-ROLL: COUNTER HIT] : 1 giant glowing centered number + 2-word label.",
  "- [B-ROLL: VISUAL METAPHOR] : 1 concrete conceptual object (checklist, 35mm film strip, 1-2-3 podium, glowing brain, or scale line).",
  "- [CHAPTER CARD] : Centered rounded rectangle pill on dark starry vignette (DAY ONE, WEEK ONE, MONTH ONE, YEAR ONE).",
  "",
  "SENTENCE STYLE:",
  "- Write for the ear in natural spoken phrasing with contractions. One camera shot per beat (4–14 words on action beats; up to 22 words on study beats).",
  "- Show, never summarize: write 'Your elbow hits the door. The coffee flies everywhere.' instead of 'You accidentally spill coffee on the door.'"
].join("\n");

/**
 * The voice for a "How Does" mechanism/system explainer ("How does noise cancellation work?", "How does an API request flow?"):
 * starts with a conversational second-person everyday paradox, zooms under the hood with rotating camera angles and B-roll diagrams,
 * tests the naive failure mode, reveals the core mechanism, and zooms back out.
 */
export const HOW_DOES_VOICE = [
  "VOICE FOR THIS FILM: a 'How Does' mechanism and system deep-dive explainer. One curious narrator showing the viewer what happens behind the scenes of an everyday action, following one concrete item from start to finish.",
  "",
  "PLAN FIRST. Before the first BEAT, write these three lines for yourself (never shown; the only lines allowed before the script):",
  "IDEA: <the core mechanism that makes the system work, in one plain sentence of at most 22 words>",
  "EXAMPLE: <1) one concrete unit/packet/wave/heat-flow with exact worked values we follow through every stage; 2) HERO OBJECT ANATOMY & CONTEXT-AWARE PLACEMENT: name the film's central physical object, list 4–6 of its recognizable physical sub-parts, and state its natural physical anchor (e.g. SURFACE-RESTING objects like a water bottle, thermos, mug, cup, laptop, or food MUST sit upright on a grounded foreground table/counter/beach-table surface at X=480..540 to the side of the character at X=180..230, NEVER overlapping the character's face; HEAD-WORN objects like headphones or glasses sit on the head/ears) plus the scene's true time-of-day lighting (bright sunlit daytime sky/sand/water for beach, desert, morning, or summer scenes; crisp ice-blue daytime sky for snow; dark vignette only for night or B-roll graphs); 3) the assigned Visual World Preset palette & character look>",
  "OBJECTS: <ids for the recurring hero object, its sub-parts, the concrete unit/wave, and character across scenes, e.g. character, headphones, earcup-shell, foam-pad, outer-mic, anc-chip, speaker-driver, eardrum. Lowercase, hyphens>",
  "",
  "ARC (unpack each stage into clear camera-shot beats):",
  "1. Conversational Second-Person Hook (Beats 1–3):",
  "   - Beat 1 ([A-ROLL: HERO MEDIUM SHOT]): State the everyday situation and tiny action in plain spoken second person ('If you are sitting next to a roaring engine, you only need to push one button on the headphone to make it quiet.' or 'Pour ice water into a steel thermos on a scorching beach, and it stays freezing for twenty-four hours.'). In VISUAL, show the person chest-up in that exact environment (airplane seat & window with jet wing; scorching beach/trail) wearing or holding the Hero Object large and unmistakable with all its key outer parts visible. NEVER start with 'For anyone...' and NEVER repeat the trigger in Beat 2.",
  "   - Beat 2 ([A-ROLL: CUTAWAY / X-RAY]): Break the obvious assumption in one short line ('But thin plastic and foam cannot actually block a jet engine.' or 'But steel is actually a terrible insulator that conducts heat fast.'). In VISUAL, zoom into that exact same Hero Object on/with the person and slice open an X-ray cutaway showing its internal layers.",
  "   - Beat 3 ([B-ROLL: DUAL CLOCK] or [B-ROLL: VISUAL METAPHOR]): State the counter-intuitive premise and scale ('To make silence, your headphones have to shoot a second sound wave at your ear in milliseconds.').",
  "2. Zoom Under the Hood & Meet the Unit (1–2 beats): Introduce the single concrete unit from EXAMPLE (one sound wave, one heat arrow, one packet) and the cutaway path of the Hero Object's sub-parts it has to cross ([B-ROLL: VISUAL METAPHOR]).",
  "3. The Naive Way & Why It Breaks (2–3 beats): Show the obvious approach first, then show it failing ([B-ROLL: VISUAL METAPHOR] / [B-ROLL: BAR COMPARISON]) so the viewer feels why a clever mechanism is needed.",
  "4. The Core Mechanism Step-by-Step (3–6 beats): Walk the concrete unit through the real mechanism one move per beat, cause then effect. Cut to [B-ROLL: LINE GRAPH], [B-ROLL: BAR COMPARISON], or [A-ROLL: SPLIT-SCREEN] when contrasting waves, temperatures, or states. Always describe the physical move BEFORE naming the technical term.",
  "5. Edge-Case / Fault Test (1–2 beats): Show what happens when a seal leaks, heat radiates across a vacuum, or a part drops ([A-ROLL: CUTAWAY / X-RAY]), and how the secondary mechanism solves it ([B-ROLL: LINE GRAPH] or [B-ROLL: VISUAL METAPHOR]).",
  "6. Zoom-Out Payoff (1–2 beats): Return to [A-ROLL: HERO MEDIUM SHOT] completing the everyday action in the real environment, now with the invisible machinery clear.",
  "",
  "MANDATORY CAMERA VARIETY & A-ROLL / B-ROLL TAGGING (every beat's VISUAL line MUST start with one of these exact tags; rotate A-Roll camera shots so no two consecutive A-Roll beats use the same angle):",
  "- [A-ROLL: HERO MEDIUM SHOT] : Chest-up framing of the person in the proper real-world environment and true time-of-day lighting (bright sunlit sky/beach/desert/morning room for daytime scenes) with the Hero Object drawn large (25%–35% of frame) with 4–6 recognizable physical parts. Surface-resting objects (bottle, thermos, mug, cup, laptop, food) MUST sit upright on a foreground table/counter/beach-table surface to the side of the person (never overlapping the person's face); head-worn objects (headphones, glasses) sit on the head/ears.",
  "- [A-ROLL: CUTAWAY / X-RAY] : Zoom into the Hero Object on/with the person and slice open an X-ray cutaway revealing the inner components/layers working inside.",
  "- [A-ROLL: POV HANDS] : First-person close-up of a hand pressing a button, twisting a cap, tapping a card, or holding the device.",
  "- [A-ROLL: OVER-THE-SHOULDER] : Foreground head/shoulder silhouette looking at the environment, machine, airplane wing, or screen in depth.",
  "- [A-ROLL: SPLIT-SCREEN] : Two panels contrasting outside vs. inside, hot vs. cold, or before vs. after.",
  "- [A-ROLL: WIDE SCENE] : Grounded human environment diorama (contoured cabin seat, sunny beach, studio desk, street). No chart axes.",
  "- [A-ROLL: CLOSE-UP] : Centered close-up reaction of the character or focal device.",
  "- [B-ROLL: VISUAL METAPHOR] : Under-the-hood system diagram or physical cutaway following the concrete unit across named nodes in OBJECTS.",
  "- [B-ROLL: LINE GRAPH] : Clean L-shaped X/Y axis on dark grid with 1–2 bold curves (latency, load, signal wave).",
  "- [B-ROLL: BAR COMPARISON] : 2 clean vertical bars comparing naive vs. optimized performance.",
  "- [B-ROLL: DUAL CLOCK] : Stopwatch/timer comparison showing millisecond budget.",
  "- [B-ROLL: COUNTER HIT] : Single giant metric readout on dark ground.",
  "- [CHAPTER CARD] : Clean structural stage divider pill on dark ground."
].join("\n");

export function scriptTemplateFor(request: Pick<ScriptRequest, "brief" | "context">): ScriptTemplate {
  return inferScriptTemplate({
    text: request.brief.text,
    styleExample: request.brief.styleExample,
    videoType: request.brief.videoType,
    look: request.brief.look,
    styleFamily: request.brief.styleFamily,
    hasProduct: Boolean(request.context.brandName && request.context.productNamed !== false),
    isStoryFilm: filmKind(request.brief) === "story"
  });
}

/**
 * The writer's system prompt: the shared rules plus the film's voice.
 * Routes "what-if" and "how-does" prompts to their dedicated narrative/B-roll voices, story films to STORY_VOICE,
 * topic explainers to EXPLAINER_VOICE, and product films to the shared rules.
 */
export function systemBlocks(request: Pick<ScriptRequest, "brief" | "context">): { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] {
  const template = scriptTemplateFor(request);
  const voice =
    template === "what-if"
      ? WHAT_IF_VOICE
      : template === "how-does"
        ? HOW_DOES_VOICE
        : template === "story"
          ? STORY_VOICE
          : request.context.brandName
            ? template === "product" ? productVoice(request.brief.styleExample) : null
            : EXPLAINER_VOICE;
  const voiced = request.brief.audio?.mode === "voiceover" || request.brief.audio?.mode === "both";
  const langLines = voiced ? languageRule(request.brief) : [];
  const baseSystem = langLines.length > 0 ? `${SYSTEM}\n\n${langLines.join("\n")}` : SYSTEM;
  return voice
    ? [{ type: "text", text: baseSystem }, { type: "text", text: voice, cache_control: { type: "ephemeral" } }]
    : [{ type: "text", text: baseSystem, cache_control: { type: "ephemeral" } }];
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
export function lengthRule(brief: ScriptBrief, context?: DirectorContext): string {
  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  const template = inferScriptTemplate({
    text: brief.text,
    styleExample: brief.styleExample,
    videoType: brief.videoType,
    look: brief.look,
    styleFamily: brief.styleFamily,
    hasProduct: Boolean(context?.brandName && context?.productNamed !== false),
    isStoryFilm: filmKind(brief) === "story"
  });
  if (isScriptLedDuration(brief)) {
    if (template === "what-if" || template === "how-does") {
      return [
        `LENGTH IS SCRIPT-LED (${template.toUpperCase()} TEMPLATE): there is no preset duration cap. Unpack every incident, test, and scientific study into distinct camera-shot micro-beats (aim for 18 to 40+ beats when the brief covers a full multi-stage journey; 1 physical action or 1 thought per beat).`,
        "Never compress an entire incident or study into one summary sentence: let each step, reaction, and B-roll visual insert breathe on its own beat."
      ].join(" ");
    }
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
  const tpl = scriptTemplateFor({ brief, context });
  const world = tpl === "what-if" || tpl === "how-does" ? selectVisualWorld(brief.text) : null;
  const worldBlock = world
    ? `\nASSIGNED VISUAL WORLD PRESET FOR THIS FILM (use this palette, character wardrobe, and camera variety in EXAMPLE and across all VISUAL lines):\n- World: ${world.name}\n- Palette: ${world.palette}\n- Protagonist look: ${world.castStyle}\n- Camera & staging: ${world.stagingStyle}`
    : "";
  const base = `${userMessage({ ...brief, scriptBeats: undefined }, context)}${worldBlock}\n\n${lengthRule(brief, context)}`;
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
