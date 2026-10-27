/**
 * One director playbook per kind of film. The director is told which playbook applies (brief.videoType), so a lesson is not
 * built like an ad: each one says what the film is for, how it is shaped (the beat roles and rough timings), how the words and
 * pictures pair, how screenshots are used and whether it ends on a call to action.
 *
 * Distilled from public guidance on explainer, tutorial, demo, short-ad, story and data-video scripting: one idea per film or
 * scene, hook in the first seconds, narration that adds to the picture instead of repeating it, real UI rather than invented UI,
 * a recap for anything taught, and a call to action only where a viewer is being asked to do something.
 */
import type { VideoType } from "@videosaas/contracts";

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
      "Teach ONE idea. If the brief holds several, teach the main one and drop the rest.",
      "Narration adds a layer the picture does not: it names why, not what. If a line only describes what is visible, cut it or rewrite it.",
      "Pair each spoken idea with its visual in the same beat; where the visual column would be empty, find a visual.",
      "Use the teaching vocabulary of the subject, defined on first use. Examples are concrete (a real list, real numbers the brief gives), never invented statistics.",
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
      "Show, do not tell: where the line states a feeling, the picture shows its cause."
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

/** The playbook as the block of instructions the director reads. */
export function playbookBlock(type: VideoType): string {
  const book = PLAYBOOKS[type];
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
    `Screenshots: ${book.screenshots}`,
    `Music: ${book.music}`
  ].join("\n");
}
