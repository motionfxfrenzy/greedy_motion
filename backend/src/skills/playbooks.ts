/**
 * One director playbook per kind of film. The director is told which playbook applies (brief.videoType), so a lesson is not
 * built like an ad: each one says what the film is for, how it is shaped (the beat roles and rough timings), how the words and
 * pictures pair, how screenshots are used and whether it ends on a call to action.
 *
 * Distilled from public guidance on explainer, tutorial, demo, short-ad, story and data-video scripting: one idea per film or
 * scene, hook in the first seconds, narration that adds to the picture instead of repeating it, real UI rather than invented UI,
 * a recap for anything taught, and a call to action only where a viewer is being asked to do something.
 */
import type { ScriptTemplate, VideoType } from "@videosaas/contracts";

export type Playbook = {
  /** One line the director can quote back: what this film is for. */
  purpose: string;
  /** Whether the film ends on a call to action (role "cta"). Taught or told films do not. */
  cta: "never" | "optional" | "required";
  /** The shape: roles in order, with what each does. */
  shape: string[];
  rules: string[];
  /** How uploaded screenshots are used in this kind of film. */
  screenshots: string;
  music: string;
};

export const PLAYBOOKS: Record<VideoType, Playbook> = {
  explainer: {
    purpose: "Teach one idea so the viewer can explain it back. The viewer is learning, not being sold to.",
    cta: "never",
    shape: [
      "question: open on the question or surprising fact the lesson answers (first 8-10 seconds). Not a slogan, not the product.",
      "setup: the minimum context, one beat, so the next step makes sense.",
      "step: one beat per step of the idea, in the order the idea actually unfolds. Each step is one picture doing one thing; the picture shows the mechanism, not a decoration.",
      "insight: the 'aha' beat, where the steps click together into the answer (mark it success=true).",
      "recap: the idea restated in one short sentence (about 10 seconds). It ends the film. No product pitch, no 'try', no 'sign up'."
    ],
    rules: [
      "One clear beat per step or moment. When the brief names several stages, tests, studies or turns, unfold each one in order rather than dropping them or cramming them into one summary sentence.",
      "Narration adds a layer the picture does not: it names why or what happens next. If a line only labels what is static on screen, rewrite it as an active cause-and-effect sentence.",
      "Pair each spoken idea with its visual in the same beat; alternate lived story scenes (A-roll) with clean data/concept visuals (B-roll) only where a number, comparison, or study needs a visual diagram.",
      "Use the teaching vocabulary of the subject, defined on first use. Examples are concrete (a real list, real numbers or studies the brief gives), never invented product statistics.",
      "Keep on-screen text to the term or number being taught (one to three words); the voice carries the sentence.",
      "Signal with highlights, labels and motion on the thing being discussed; one element is lit at a time."
    ],
    screenshots: "Use a screenshot only when the lesson is about that screen or tool; show it at the moment the voice refers to it, with the region being discussed called out. Otherwise draw the idea with the style's own scenes.",
    music: "Calm, unobtrusive, instrumental; 80-100 BPM; no drop. It supports concentration."
  },
  tutorial: {
    purpose: "Take the viewer through a task so they can do it themselves.",
    cta: "optional",
    shape: [
      "question: state the outcome the viewer will have by the end ('Reset a password in three steps') in the first 8-10 seconds.",
      "setup: one beat on what they need before starting, if anything.",
      "step: one beat per step, numbered in the voice ('Step one') and led by an action verb (click, choose, type). One action per beat.",
      "insight: the moment the result appears, if there is one (mark it success=true).",
      "recap: the steps in one or two sentences. An optional last line may point to the next resource; no hard sell."
    ],
    rules: [
      "One outcome per film. Number the steps in order.",
      "Each step's picture is where the viewer's attention goes: the control to click, the field to fill, highlighted on the beat of the verb.",
      "Anticipate the confusing moment and say it before it happens ('It may take a few seconds').",
      "Mini-summaries between steps are short and spoken, never a separate beat."
    ],
    screenshots: "Screenshots are the steps. Assign each step the screenshot that shows its screen, in task order, and name the exact control (ui.target) the action happens on.",
    music: "Light and steady; 90-105 BPM; low in the mix so the narration is always clear."
  },
  demo: {
    purpose: "Show the real product doing the job, so the viewer believes it works.",
    cta: "required",
    shape: [
      "hook: the viewer's problem or the outcome they want, in the first 3 seconds.",
      "problem: the 'before': the slow or painful way (one beat).",
      "reveal: the product's first appearance, a real screen.",
      "feature: one beat per capability, each shown on a real screenshot with the feature's control called out.",
      "success: the result the product produced (mark it success=true).",
      "cta: one next step, short, in the last 3-5 seconds."
    ],
    rules: [
      "Problem first, product second; show the transformation, not a feature list.",
      "Use only real UI from the supplied screenshots; never invent screens, data, results or features.",
      "Keep narration minimal in the core section: let the screen and its callouts carry it.",
      "Do not claim anything the brief, the brand description or the site does not state."
    ],
    screenshots: "Every uploaded screenshot appears in at least one beat. Use each for the feature its content shows (its description is given); place it on the beat whose line talks about that feature, and call out the control or region the line refers to.",
    music: "Confident, forward-moving; 105-120 BPM; a clear lift on the success beat."
  },
  promo: {
    purpose: "Stop the scroll, make one promise, and ask for one action.",
    cta: "required",
    shape: [
      "hook: a question, bold claim or pattern interrupt in the first 1-3 seconds; the first frame carries one idea only.",
      "problem: the pain, one beat (the agitation).",
      "reveal: the product or offer as the answer.",
      "feature: at most three benefits, one per beat, each a result and not a spec.",
      "success: the payoff moment (mark it success=true).",
      "cta: one clear action, last 3-5 seconds."
    ],
    rules: [
      "One message. A visual change at least every 2-3 seconds.",
      "Word budget is tight: hook about 10 words, problem about 25, solution about 30, call to action about 15 at 30 seconds.",
      "Open on the viewer's problem or outcome, never on the product name or a greeting.",
      "Never invent a number, a price, a testimonial or a claim the brief does not give."
    ],
    screenshots: "Use screenshots for the product-reveal and benefit beats; show the real screen and push into the part that proves the benefit.",
    music: "Energetic; 110-130 BPM; cuts land on the beat, with a drop under the success beat."
  },
  story: {
    purpose: "Make the viewer feel something true about the brand; the product is a plot device, not the pitch.",
    cta: "optional",
    shape: [
      "setup: the situation and the person in it, understood within about 7 seconds.",
      "problem: the change or tension (the longest part; stakes rise rather than a demo starting).",
      "turn: the decision, discovery or help that changes things, by the halfway point.",
      "resolution: the outcome, specific and human (mark it success=true).",
      "cta: only if the brief asks for an action; otherwise end on the resolution or a quiet brand line."
    ],
    rules: [
      "One message. Specific details beat general claims.",
      "Conversational, spoken language; short sentences; the brand stays secondary until the ending.",
      "Show, do not tell: where the line states a feeling, the picture shows its cause.",
      "Every scene illustrates the specific thing its line names (the lighthouse, the boat, the garage door), drawn as a concrete picture: what it is, where it sits, what moves. Never a generic backdrop or a stock metaphor.",
      "When the person gives a verse, quote, poem or parable, their words are the script; the film's job is one picture per line or phrase, in the look they asked for, and the shots may be short (two seconds or less) when the lines are short."
    ],
    screenshots: "Use a screenshot only where the story reaches the product, usually in the turn or resolution; keep it brief and in service of the person in the story.",
    music: "Emotional arc; 70-95 BPM building to the resolution; room for the voice."
  },
  data: {
    purpose: "Make one finding unmistakable.",
    cta: "never",
    shape: [
      "question: the headline finding or the question the data answers, as an action title (a takeaway, not a topic).",
      "setup: what is measured and over what period, one beat.",
      "step: one beat per message, ONE chart or number per beat, revealed progressively with the key element highlighted and everything else muted.",
      "insight: the cause or implication (mark it success=true).",
      "recap: the finding restated in one line, with what to do about it if the brief says."
    ],
    rules: [
      "One idea per scene; a new idea is a new scene.",
      "Title states the takeaway ('Q3 revenue beat target by 23%') and every number comes from the brief; never invent data.",
      "Annotate one data point or one region; labelling everything dilutes the signal.",
      "A viewer who reads only the titles and callouts should still understand the conclusion; narration reinforces them and does not read the data out."
    ],
    screenshots: "Use a chart or dashboard screenshot as the evidence for the beat that discusses it; zoom to the region that shows the finding and annotate that region only.",
    music: "Minimal and steady; 85-100 BPM; no drop."
  }
};

/**
 * The first line decides whether anyone watches the rest, for every kind of film. Short-form pages that grow on a hook
 * name exactly who it is for and what they get, and keep testing that opening, so the director writes it that way.
 */
export const HOOK_RULES = [
  "Put the viewer directly inside the moment in plain spoken words ('If you are sitting next to a roaring engine, you only need to push one button on the headphone to make it quiet', 'What if you could rewind time by ten seconds?'), never a generic opener ('Welcome', 'Have you ever wondered', 'For anyone who...').",
  "It makes the next beat necessary: a question the film answers, a paradox it unpacks, or a surprise it explains. Say the specific thing in everyday words, never ad copy.",
  "Ground it in the brief's own audience and facts; never invent a number, a result or a claim to make it punchier."
];

export const SPECIALIZED_PLAYBOOKS: Record<"what-if" | "how-does", Playbook> = {
  "what-if": {
    purpose: "Take the viewer inside a 'What if...' thought experiment through one relatable protagonist in second person ('You'), escalating from playful wish-fulfillment to the hidden catch, real psychology/science studies, and a human resolution.",
    cta: "never",
    shape: [
      "question: open with the 'What if...' premise and its exact constraint across 1-2 crisp beats ('What if you could rewind time? By exactly 10 seconds.'). Never spoil the trap or ending in the hook.",
      "setup: 'Day one.' Drop straight into a visceral everyday incident unpacked into 3-5 camera-shot micro-beats (setup action -> physical accident -> close-up shock/wish -> the power triggers -> aftermath realization).",
      "step: escalate through time jumps ('Week one.', 'Month one.') — testing small slips, winning social moments, hitting an edge limit, and discovering the first hidden cost (e.g. a 5-minute chat taking 1 hour). Weave in real psychology/science studies using the 3-part sandwich: (a) lived symptom in the story -> (b) clean B-roll study/graph card -> (c) personal mirror line.",
      "turn: 'Year one.' The emotional climax where editing life erases authentic moments, followed by a real-life mistake that happens outside the rule's boundary (e.g. 60 seconds later or over years).",
      "insight: the deeper truth backed by research (e.g. short-term action regrets vs. lifetime inaction regrets; why mistakes make us human, mark it success=true).",
      "recap: 'Years later.' Choosing not to use the power during an honest human mistake, a callback to the opening object (letting the coffee spill), and a closing question to the viewer."
    ],
    rules: [
      "Write in present-tense second person ('You') with one physical camera action or one clear thought per beat (4-14 words on action beats). Never cram a whole incident into one summary sentence.",
      "Show, never summarize: instead of 'You use it to fix coffee spills and bad jokes', write the actual moment beat by beat.",
      "Alternate A-Roll story scenes ([A-ROLL: WIDE SCENE] and [A-ROLL: CLOSE-UP]) with B-Roll visual inserts ([B-ROLL: LINE GRAPH], [B-ROLL: BAR COMPARISON], [B-ROLL: DUAL CLOCK], [B-ROLL: COUNTER HIT], [B-ROLL: VISUAL METAPHOR], [CHAPTER CARD]). Draw graphs and charts ONLY when a beat states a metric, time comparison, or research study; never draw chart axes or flowchart arrows inside A-Roll story rooms."
    ],
    screenshots: "Use drawn scenes and B-roll concept cards unless a screenshot is explicitly supplied.",
    music: "Curious, cinematic, minimal pulse; 85-100 BPM; room for the voice."
  },
  "how-does": {
    purpose: "Demystify how a system, machine, or phenomenon works under the hood by following one concrete action or packet from trigger to completion.",
    cta: "never",
    shape: [
      "question: Beat 1 states the everyday second-person paradox in plain spoken words ('If you are sitting next to a roaring engine, you only need to push one button on the headphone to make it quiet.'). Beat 2 breaks the obvious assumption ('But thin plastic and foam cannot stop a jet engine.'). Never start with 'For anyone...' and never repeat the trigger across two beats.",
      "setup: state the counter-intuitive premise in one plain line ('To make silence, your headphones actually shoot a second sound wave at your ear.') and introduce the single concrete unit we will follow.",
      "step: walk the unit through each hop one beat at a time (cause -> mechanism -> effect). Show what breaks under the naive approach before showing the clever mechanism that solves it, and show the physical move before naming the technical term.",
      "insight: the 'aha' mechanism or fault-recovery test where the whole system locks together (mark it success=true).",
      "recap: zoom back out to the everyday 1-second action from the opening, now with the invisible machinery understood."
    ],
    rules: [
      "Follow ONE concrete item with real example values from start to finish.",
      "Open in direct second person ('If you are..., you only need to...'), never 'For anyone...'. Use plain spoken words ('push one button', 'make it quiet'), never literary filler.",
      "Rotate A-Roll camera angles ([A-ROLL: POV HANDS], [A-ROLL: OVER-THE-SHOULDER], [A-ROLL: CUTAWAY / X-RAY], [A-ROLL: SPLIT-SCREEN], [A-ROLL: WIDE SCENE], [A-ROLL: CLOSE-UP]) so A-Roll is never just a stick figure standing on a line, and interleave with [B-ROLL: VISUAL METAPHOR], [B-ROLL: LINE GRAPH], [B-ROLL: BAR COMPARISON], or [B-ROLL: DUAL CLOCK]."
    ],
    screenshots: "Use screenshots only when explaining a specific software UI; otherwise draw the system mechanism.",
    music: "Steady, inquisitive, modern instrumental; 90-105 BPM."
  }
};

/** The playbook as the block of instructions the director reads. */
export function playbookBlock(type: VideoType, scriptTemplate?: ScriptTemplate): string {
  const book =
    scriptTemplate === "what-if" || scriptTemplate === "how-does"
      ? SPECIALIZED_PLAYBOOKS[scriptTemplate]
      : PLAYBOOKS[type];
  const cta = book.cta === "never" ? "This film does NOT end on a call to action: never use the role 'cta', never write 'try', 'sign up', 'get started' or a product pitch."
    : book.cta === "required" ? "This film ends on one clear call to action (role 'cta')."
    : "A call to action (role 'cta') is allowed only if the brief asks the viewer to do something; otherwise end on the last beat of the shape.";
  return [
    `VIDEO TYPE: ${type}. Purpose: ${book.purpose}`,
    cta,
    "Shape (roles in order; use only these roles for this film, skipping one only when the brief has nothing for it):",
    ...book.shape.map((line) => `- ${line}`),
    "Rules for this kind of film:",
    ...book.rules.map((line) => `- ${line}`),
    "The opening line:",
    ...HOOK_RULES.map((line) => `- ${line}`),
    `Screenshots: ${book.screenshots}`,
    `Music: ${book.music}`
  ].join("\n");
}
