// Starting points shown in the Templates page, the Projects empty state and the landing page.
// A gallery entry is a ready brief: choosing one fills the script prompt, the structure skill, the visual style,
// the length and the sound, so the person edits an example instead of facing a blank form.
// Previews are real stills or renders: starters come from the worker's rendered stills (npm run previews),
// styles from the style library's previews, and the narrated explainer from a render of its skill.
import type { Aspect, AudioMode, CaptionMode, MotionProfile, Pace, ScriptBrief } from "./beat-plan.ts";
import opusRows from "./gallery-opus.json" with { type: "json" };
import sceneRows from "./gallery-scenes.json" with { type: "json" };
import styleRows from "./gallery-styles.json" with { type: "json" };
import previewManifest from "./gallery-previews.json" with { type: "json" };
import storyWorlds from "./story-worlds.json" with { type: "json" };
import { getLook, looks, type LookId } from "./looks.ts";
import { themes } from "./themes.ts";
import { familiesOfLook } from "./style-families.ts";

export type GalleryKind = "starter" | "explainer" | "skill" | "style";

/**
 * The shape of a product film, chosen by its template (the visual style comes from the template's look and theme).
 * - "launch-sections": a launch film in sections (hook in the viewer's world, brand reveal, the one-line promise with the product
 *   on screen, three or four feature sections each with a small label, a headline with one highlighted word and a product card,
 *   proof, and an end card), like a product launch page set in motion.
 * - "ui-moments": wordless-feeling product demos, one interface piece at a time (a list, a control, a tab switch, a figure counting up,
 *   a prompt bar, an approval), each centred on a plain ground with a cursor doing the work.
 */
export type ProductFlow = "launch-sections" | "ui-moments";

export type GalleryTemplate = {
  id: string;
  /** How a product film from this template is structured; "launch-sections" when absent. */
  flow?: ProductFlow;
  kind: GalleryKind;
  name: string;
  group: string;
  /** One line on what the finished video is. */
  summary: string;
  /** Who it is for and what it shows. */
  bestFor: string;
  /** `src` is the poster still; `video` is the muted 5-second preview rendered by our engine, when there is one. */
  preview: { src: string; kind: "image" | "video"; label: string; video?: string };
  /** The public prompt this template remakes, credited. We rebuild the idea with our own engine; no media is copied. */
  source?: { label: string; url: string };
  /** File name of the hand-built clip's source (index.html), published by scripts/publish-gallery.mjs. Served at /v1/gallery/<name> as plain text. */
  reference?: string;
  /** The legacy starter this entry sets on the render request (templates.ts), when it is one. */
  starterId?: string;
  /** Structure skill the director builds from, e.g. "gm-feature-explainer"; null lets the director choose. */
  skill: string | null;
  look: LookId;
  theme: string;
  aspect: Aspect;
  durationSeconds: number;
  motionProfile: MotionProfile;
  pace: Pace;
  audio: AudioMode;
  captions: CaptionMode;
  /** The example brief the script field starts with; the person replaces the product details. */
  prompt: string;
};

export const skillLabels: Record<string, string> = {
  "gm-feature-explainer": "Feature explainer",
  "gm-glossy-3d-reel": "Glossy 3D reel"
};

const still = (src: string, label: string) => ({ src, kind: "image" as const, label });
const lookPreview = (id: LookId) => getLook(id).preview;

const curated: readonly GalleryTemplate[] = [
  {
    id: "product-launch", flow: "launch-sections", kind: "starter", starterId: "product-launch", name: "Product launch", group: "Launch",
    summary: "Hook, product reveal, three features, the benefit and a call to action.",
    bestFor: "Announcing a new product or a major relaunch",
    preview: still("/templates/product-launch.jpg", "Rendered still"),
    skill: null, look: "clean", theme: "neutral", aspect: "16:9", durationSeconds: 30, motionProfile: "snappy", pace: "balanced", audio: "both", captions: "key-phrases",
    prompt: "Launch video for Relay, a tool that turns SaaS product updates into short motion videos for marketing teams. Hook with the problem, reveal the product, show three features, end with a call to start free."
  },
  {
    id: "feature-spotlight", flow: "ui-moments", kind: "starter", starterId: "feature-spotlight", name: "Feature spotlight", group: "Feature",
    summary: "A headline, your screenshot pushed in, a callout, the benefit and a call to action.",
    bestFor: "Showing one feature with a real product screenshot",
    preview: still("/templates/feature-spotlight.jpg", "Rendered still"),
    skill: null, look: "clean", theme: "blue-professional", aspect: "16:9", durationSeconds: 30, motionProfile: "smooth", pace: "balanced", audio: "voiceover", captions: "key-phrases",
    prompt: "Spotlight the profit dashboard in Northwind, which shows ecommerce teams their real margin after fees for every order. Show the dashboard, call out the live margin figure, and end with a call to try it free."
  },
  {
    id: "feature-walkthrough", flow: "ui-moments", kind: "skill", name: "Narrated walkthrough", group: "Feature",
    summary: "A voice names each action and an oversized cursor performs it on your real screens.",
    bestFor: "Explaining how a feature works, step by step",
    preview: still("/previews/looks/clean.png", "Layout draft"),
    skill: "gm-feature-explainer", look: "clean", theme: "blue-professional", aspect: "16:9", durationSeconds: 60, motionProfile: "smooth", pace: "balanced", audio: "voiceover", captions: "key-phrases",
    prompt: "Walk through how Tidyslot, a booking tool for small teams, lets someone create a meeting type, set their availability and share a booking page. Show each step on screen as the voice names it."
  },
  {
    id: "stat-highlight", kind: "starter", starterId: "stat-highlight", name: "Stat highlight", group: "Proof",
    summary: "A setup line, one big count-up number, why it matters and its source.",
    bestFor: "Leading with one proof point or metric",
    preview: still("/templates/stat-highlight.jpg", "Rendered still"),
    skill: null, look: "clean", theme: "bold", aspect: "16:9", durationSeconds: 15, motionProfile: "snappy", pace: "fast", audio: "music", captions: "key-phrases",
    prompt: "Highlight that teams using Relay spent 72% less time on launch videos last quarter, from our customer survey. Lead with the number, then say what it means."
  },
  {
    id: "whats-new", flow: "launch-sections", kind: "starter", starterId: "whats-new", name: "What's new", group: "Release",
    summary: "A version badge, the release title, three shipped updates and a closing line.",
    bestFor: "Release notes, monthly updates and changelogs",
    preview: still("/templates/whats-new.jpg", "Rendered still"),
    skill: null, look: "clean", theme: "code-editorial", aspect: "16:9", durationSeconds: 30, motionProfile: "smooth", pace: "balanced", audio: "music", captions: "key-phrases",
    prompt: "Release video for Relay v2.4: timeline comments for AI edits, 16 new themes with live previews, and 4K exports on every plan."
  },
  {
    id: "sketch-explainer", kind: "style", name: "Sketch explainer", group: "Explainer",
    summary: "Hand-drawn lines draw on as the voice explains the idea.",
    bestFor: "Explaining a problem and how the product solves it",
    preview: lookPreview("sketch"),
    skill: null, look: "sketch", theme: "neutral", aspect: "16:9", durationSeconds: 45, motionProfile: "smooth", pace: "balanced", audio: "voiceover", captions: "key-phrases",
    prompt: "Explain why small teams lose hours every week chasing invoice approvals in email, and how Ledgerly puts every approval in one shared queue. Open with the problem, then show the queue, then the result."
  },
  {
    id: "hairline-editorial", kind: "style", name: "Hairline editorial", group: "Editorial",
    summary: "Thin precise lines and generous space, for a quiet premium feel.",
    bestFor: "Brand introductions and design-led products",
    preview: lookPreview("hairline"),
    skill: null, look: "hairline", theme: "neutral", aspect: "16:9", durationSeconds: 30, motionProfile: "smooth", pace: "calm", audio: "music", captions: "key-phrases",
    prompt: "Introduce Atlas, a design system tool that keeps every product team's components in sync. Calm and confident: the problem of drifting designs, the single source of truth, and an invitation to see it."
  },
  {
    id: "doodle-walkthrough", kind: "style", name: "Doodle walkthrough", group: "Explainer",
    summary: "Playful seeded doodles around your product, with a friendly voice.",
    bestFor: "Approachable how-it-works videos for new users",
    preview: lookPreview("doodle"),
    skill: null, look: "doodle", theme: "neutral", aspect: "16:9", durationSeconds: 45, motionProfile: "springy", pace: "balanced", audio: "voiceover", captions: "key-phrases",
    prompt: "Show new users how Tidyslot works in three steps: pick a meeting type, share your booking link, and watch confirmed bookings land in your calendar. Friendly and simple."
  },
  {
    id: "narrated-product-minute", flow: "launch-sections", kind: "explainer", name: "One-minute narrated explainer", group: "Explainer",
    summary: "A calm narrated minute written for a first-time visitor to your site.",
    bestFor: "Landing pages and onboarding: what it is, who it helps, what next",
    preview: still("/previews/looks/clean.png", "Layout draft"),
    source: { label: "Remade from @1stnoel_ and @AmitSingha89", url: "https://x.com/1stnoel_/status/2103247530259603851" },
    skill: null, look: "clean", theme: "neutral", aspect: "16:9", durationSeconds: 60, motionProfile: "smooth", pace: "calm", audio: "voiceover", captions: "key-phrases",
    prompt: "A one-minute narrated explainer of Sotto, a reading app, written for a first-time visitor to the website: what it is, who it helps, how it works, and what to do next. Calm, clear and educational."
  },
  {
    id: "about-us-story", kind: "explainer", name: "About-us story", group: "Story",
    summary: "A paper-collage timeline: tape-label years, sticky notes, cut-out people, stamps and torn caption strips.",
    bestFor: "Founder stories, about-us pages and company origin films",
    preview: still("/previews/looks/clean.png", "Layout draft"),
    source: { label: "Remade from @TomAndrieu96707", url: "https://x.com/TomAndrieu96707/status/2103411144899875264" },
    skill: null, look: "doodle", theme: "daisy-days", aspect: "16:9", durationSeconds: 45, motionProfile: "springy", pace: "balanced", audio: "both", captions: "key-phrases",
    prompt: "A 45-second whimsical hand-drawn paper-collage film that tells the story of our about-us page, year by year. A pale map backdrop, tape-label years, sticky notes, name tags, a lined notebook page with the logo and website, cut-out photos of the founders, a rubber stamp for a milestone, and a torn paper caption strip that states each step in one sentence. Use assets from our repo when possible. Gentle music."
  },
  {
    id: "decision-story", kind: "explainer", name: "Design decision case study", group: "Story",
    summary: "One app screen re-arranged in four steps: the problem, the options, the change and what you learned, with a caption bar.",
    bestFor: "Case studies and portfolio walkthroughs",
    preview: still("/previews/looks/clean.png", "Layout draft"),
    source: { label: "Remade from @moguzbulbul", url: "https://x.com/moguzbulbul/status/2104206095313215591" },
    skill: null, look: "hairline", theme: "neutral", aspect: "16:9", durationSeconds: 45, motionProfile: "smooth", pace: "calm", audio: "voiceover", captions: "key-phrases",
    prompt: "A calm 45-second case study that explains one UX decision to a hiring manager or stakeholder. Use one app screen that re-arranges itself across four numbered steps: the problem, the options we sketched, the change we made, and what we learned. A caption bar under the screen swaps its numbered label, one plain sentence and one highlighted outcome sentence at each step. Hairline borders, precise motion, voiceover."
  },
  {
    id: "brand-showreel", kind: "explainer", name: "Brand showreel", group: "Showreel",
    summary: "A tilted wall of condensed type, hard beat cuts, a tile grid of motion ideas and a closing name card.",
    bestFor: "Portfolios, studio intros and brand teasers",
    preview: still("/previews/looks/clean.png", "Layout draft"),
    source: { label: "Remade from the Motion Prompt Gallery showreel", url: "https://motionpromptgallery.com/p/motion-showreel-with-a-fully-code-synthesized-soundtrack-pra/" },
    skill: null, look: "clean", theme: "bold-poster", aspect: "16:9", durationSeconds: 15, motionProfile: "snappy", pace: "fast", audio: "music", captions: "key-phrases",
    prompt: "Make a dynamic 15-second motion graphics showreel for Motion Studio, like a resume reel for an incredible motion designer. Open on a tilted wall of condensed uppercase type that slides in alternating rows, then cut hard on the beat between single huge words and simple shapes, flip a grid of small motion ideas, bring the type wall back faster, and close on the studio name with a short line. Every cut lands on the beat. Paper-white, black and one red accent."
  },
  {
    id: "prompt-to-result-story", flow: "launch-sections", kind: "explainer", name: "Product motion-graphics video", group: "Explainer",
    summary: "Paper shards sweep across a deep gradient panel, then settle around the product name and one line.",
    bestFor: "Launch teasers and product intros that research the product first",
    preview: still("/previews/looks/clean.png", "Layout draft"),
    source: { label: "Remade from the Motion Prompt Gallery product prompt", url: "https://motionpromptgallery.com/p/reusable-prompt-template-for-a-product-motion-video-ann-nnng/" },
    skill: null, look: "clean", theme: "neutral", aspect: "16:9", durationSeconds: 15, motionProfile: "snappy", pace: "fast", audio: "music", captions: "key-phrases",
    prompt: "Make a dynamic 15-second motion graphics video for Relay that shows what an incredible motion designer you are. Paper shards sweep across a deep gradient panel with motion trails, then settle around the product name and one short line. Research the product first, then write the video content yourself using only real features."
  },
  {
    id: "what-if-story-explainer", kind: "explainer", name: "What-If Thought Experiment", group: "Flat vector",
    summary: "A dark-stage flat-vector story essay: one rim-lit silhouette protagonist tests a 'what if' rule from Day 1 to Year 1, weaving lived moments with real psychology and minimal B-roll graphs.",
    bestFor: "Speculative 'What if...' stories, psychology & science essays, and thought experiments",
    preview: lookPreview("clean"),
    skill: null, look: "clean", theme: "bold", aspect: "16:9", durationSeconds: 90, motionProfile: "smooth", pace: "balanced", audio: "both", captions: "full",
    prompt: "What if you could rewind time by exactly 10 seconds, as many times as you want? Follow one character from Day 1 (spilling coffee on an office door, rewinding -10s, fixing awkward jokes) to Month 1 (a 5-minute chat taking 1 hour, psychology's Maximizer vs Satisficer trap, Olympic Bronze vs Silver medalists, the Pratfall effect) to Year 1 (why life's biggest regrets don't happen in 10 seconds)."
  },
  {
    id: "how-does-system-explainer", kind: "explainer", name: "How-Does Mechanism Explainer", group: "Tech",
    summary: "Follow one concrete action under the hood, step by step: everyday trigger, system cutaways, naive failure mode, and clean B-roll comparison charts.",
    bestFor: "'How does X work?' engineering, science, and mechanism deep-dives",
    preview: lookPreview("clean"),
    skill: null, look: "clean", theme: "cobalt-grid", aspect: "16:9", durationSeconds: 60, motionProfile: "smooth", pace: "balanced", audio: "both", captions: "full",
    prompt: "How does active noise cancellation silence a jet engine in milliseconds? Start with a traveller putting on headphones, follow one incoming sound wave into the external microphone, show why simple padding fails on low-frequency rumble, then show the chip generating an inverted anti-phase wave that cancels the noise before it reaches the ear."
  }
];


/**
 * Previews published to object storage (scripts/publish-gallery.mjs) are referenced as `gallery:<file>`; the app resolves
 * them to the backend's public /v1/gallery route. Everything else keeps its static path.
 */
const media = previewManifest as Record<string, { video?: string; poster: string; reference?: string }>;
const withRendered = (item: GalleryTemplate): GalleryTemplate => {
  const entry = media[item.id];
  if (!entry) return item;
  const reference = entry.reference ? { reference: entry.reference } : {};
  if (!entry.video) return { ...item, ...reference, preview: { ...item.preview, src: `gallery:${entry.poster}` } };
  return { ...item, ...reference, preview: { src: `gallery:${entry.poster}`, kind: "video", video: `gallery:${entry.video}`, label: item.id.startsWith("story-illus-") ? "A code-drawn example of this style" : getLook(item.look).renderMode === "generated" ? "Layout draft: generated footage replaces it" : "Preview of this style" } };
};

const exampleStylePrompt = "A 30-second explainer for Pocket, an app that turns receipts into a tidy monthly budget. Show the problem of a pile of receipts, how Pocket sorts them, and a call to try it free.";

/** Every drawn style is also a template: its look, a ready example prompt and a preview. */
const styleTemplates: readonly GalleryTemplate[] = looks
  .filter((look) => look.available && look.renderMode === "native" && !curated.some((item) => item.look === look.id))
  .map((look): GalleryTemplate => ({
    id: `style-${look.id}`, kind: "style", name: look.name.replace(/^Illustration · /, ""), group: look.group,
    summary: look.description,
    bestFor: look.renderMode === "native" ? "A drawn treatment that keeps your text and screenshots crisp" : "Generated footage in this look, with your text and screenshots on top",
    preview: look.preview,
    skill: null, look: look.id, theme: "neutral", aspect: "16:9", durationSeconds: 30, motionProfile: "smooth", pace: "balanced", audio: "voiceover", captions: "full",
    prompt: exampleStylePrompt
  }));


/**
 * Every generated style comes in two versions, so each is easy to find where it is wanted: a Story & film one (the whole
 * scene, told through the look) and a SaaS one (the same look behind the product's own screen and words). The renderer is
 * the same underneath. Previews are rendered by scripts/build-gallery-styles.mjs from the style's reference art.
 */
type StyleRow = { look: LookId; name: string; description: string; hero: string | null };
const styleVersions: readonly GalleryTemplate[] = (styleRows as unknown as StyleRow[]).flatMap((row): GalleryTemplate[] => {
  const base = { look: row.look, theme: "neutral", aspect: "16:9" as const, durationSeconds: 30, captions: "full" as const, skill: null, kind: "style" as const, preview: getLook(row.look).preview };
  const name = row.name.toLowerCase();
  return [
    { ...base, id: `story-${row.look}`, name: `${row.name} story`, group: "Story", summary: row.description, bestFor: "Narrative and cinematic films told in one handmade look",
      motionProfile: "smooth", pace: "calm", audio: "music",
      prompt: row.hero
        ? `A short 30-second film told as a ${name} illustration: ${row.hero}. One small moment changes the scene, and a closing line stays with the viewer.`
        : `A warm 30-second brand story for Aurora, a small skincare brand: the quiet morning routine, the moment the serum works, and a closing line. Told in a ${name} look.` },
    { ...base, id: `saas-${row.look}`, name: `${row.name} product video`, group: "Product", summary: `Your product screen and words over a full ${name} scene.`, bestFor: "Product explainers that stand out with a handmade look",
      motionProfile: "smooth", pace: "balanced", audio: "voiceover",
      prompt: `A 30-second product explainer for Pocket, an app that turns receipts into a tidy monthly budget, in a ${name} look. Show the problem of a pile of receipts, how Pocket sorts them, and a call to try it free.` }
  ];
});

/** Hand-built explainer styles (maths, tech diagrams, whiteboard, flat vector, 3D and more): scripts/gallery-scenes. */
type SceneRow = Omit<GalleryTemplate, "kind" | "skill" | "captions" | "preview">;
const sceneTemplates: readonly GalleryTemplate[] = (sceneRows as unknown as SceneRow[]).map((row) => ({ ...row, kind: "explainer", skill: null, captions: "full", preview: lookPreview(row.look) }));

/** Remakes of public motion prompts (scripts/merge-gallery-opus.mjs validates and writes the rows). */
type OpusRow = Omit<GalleryTemplate, "kind" | "skill" | "captions" | "preview">;
const opusTemplates: readonly GalleryTemplate[] = (opusRows as unknown as OpusRow[]).map((row) => ({
  ...row, kind: "explainer", skill: null, captions: "full",
  preview: lookPreview(row.look)
}));

/** A colour theme is a starting point too: the same example film in a different palette and type. */
const themeTemplates: readonly GalleryTemplate[] = themes.map((theme): GalleryTemplate => ({
  id: `theme-${theme.id}`, kind: "style", name: theme.name, group: "Colour",
  summary: `${theme.mode === "dark" ? "A dark" : "A light"} palette with its own type. Your brand kit can override it.`,
  bestFor: "Matching a mood or a brand before you add your own kit",
  preview: still(`/themes/${theme.id}.jpg`, "Rendered still"),
  skill: null, look: "clean", theme: theme.id, aspect: "16:9", durationSeconds: 30, motionProfile: "smooth", pace: "balanced", audio: "voiceover", captions: "full",
  prompt: exampleStylePrompt
}));

// A style version or a hand-built scene is listed only once its real clip is published: a stand-in layout draft would
// misrepresent a handmade look.
const hasClip = (item: GalleryTemplate) => Boolean(media[item.id]);
/**
 * A drawn look keeps the type that suits it, so the preview and the film it starts agree: doodle is rounded and playful,
 * sketch is a notebook serif on cream paper, hairline is a fine high-contrast serif. (A brand kit still overrides the theme.)
 */
const lookThemes: { match: RegExp; theme: string }[] = [
  { match: /^doodle/, theme: "daisy-days" },
  { match: /^sketch$/, theme: "cobalt-grid" },
  { match: /^hairline$/, theme: "capsule" }
];
const withLookTheme = (item: GalleryTemplate): GalleryTemplate => {
  const rule = item.group === "Colour" ? undefined : lookThemes.find((entry) => entry.match.test(item.look));
  return rule ? { ...item, theme: rule.theme } : item;
};
const everyGalleryTemplate: readonly GalleryTemplate[] = [...curated, ...sceneTemplates.filter(hasClip), ...opusTemplates, ...styleVersions.filter(hasClip), ...styleTemplates, ...themeTemplates].map(withLookTheme).map(withRendered);

/**
 * Held for v2 (docs/v2/PLAN.md #2): every style whose look is rendered from generated material (paper, clay, illustration,
 * editorial collage). The engine cannot draw those from a person's script, so "Use this" would give a plain layout draft,
 * not the look on the card. They stay in the catalogue data and old projects keep rendering, but nothing offers them.
 * Set to false to bring them all back.
 */
export const HOLD_GENERATED_STYLES = true;
export const heldForV2 = (look: string) => HOLD_GENERATED_STYLES && getLook(look).renderMode === "generated";
/** The Story & film plates of the illustration styles: each is code-drawn (anidoodle), so they stay in the gallery while the generated looks are held. */
export const isStylePlate = (item: GalleryTemplate) => item.id.startsWith("story-illus-");
export const isStylePlateLook = (look: string) => everyGalleryTemplate.some((item) => item.look === look && isStylePlate(item));
export const galleryTemplates: readonly GalleryTemplate[] = everyGalleryTemplate.filter((item) => !heldForV2(item.look) || isStylePlate(item));

import { galleryUseCases, normalizeSearch, type GalleryUseCase } from "./gallery-use-cases.ts";
export { galleryUseCases, type GalleryUseCase };

export type GalleryScope = "all" | "film";
export const isGalleryScope = (value: unknown): value is GalleryScope => value === "all" || value === "film";

// What was built first (starters, the product explainers, the remade prompts, every drawn style) all serve product videos,
// so it is browsed under SaaS & product. Explainers & learning holds the distinct teaching styles; Story & film the art-led
// handmade looks; 3D & cinematic the Three.js scenes.
const explainGroups = new Set(["Math", "Tech", "Flat vector", "Whiteboard", "Blackboard", "Kinetic type", "Screencast", "Data & maps", "Storybook"]);
const brandGroups = new Set(["Showreel", "Typography", "Social"]);

export function useCaseOf(item: GalleryTemplate): GalleryUseCase {
  if (item.group === "Colour") return "colour";
  if (item.group === "3D") return "threed";
  if (explainGroups.has(item.group)) return "explain";
  if (item.group === "Paper" || item.group === "Clay") return "story";
  // The editorial collage is drawn by the engine from a script, with product screens on top: it is a product look, not a film.
  if (item.id === "story-vox-collage") return "saas";
  if (item.kind === "style" && item.group === "Story") return "story";
  if (brandGroups.has(item.group)) return "brand";
  return "saas";
}

/** True when a gallery template is a film (an educational explainer or a story/illustrated film) rather than a product, brand or colour template. */
export function isFilmTemplate(item: GalleryTemplate): boolean {
  const useCase = useCaseOf(item);
  return useCase === "explain" || useCase === "story";
}

export const scriptWriterTemplates: readonly GalleryTemplate[] = curated.filter(
  (item) => item.id === "what-if-story-explainer" || item.id === "how-does-system-explainer"
);

export const galleryIds = galleryTemplates.map((item) => item.id);
export const findGalleryTemplate = (id: string | null | undefined) => everyGalleryTemplate.find((item) => item.id === id);

/** The flow a product film follows: its template's, else the launch-page sections. */
export const productFlowFor = (styleExample: string | null | undefined): ProductFlow => findGalleryTemplate(styleExample)?.flow ?? "launch-sections";

/**
 * A film (a story or an explainer) rather than a product video: it needs no product site, name, audience, brand kit,
 * theme or screenshots, because everything in it is made from the idea. True for story and educational templates and
 * for any code-drawn story style (illus-*); product, brand and colour templates keep the product brief.
 */
export type StoryWorld = { world: string; elements: string[] };
/**
 * The hidden world rules of a story style (story-worlds.json, drafted from each style's engine kit): how the style tells
 * a story and what its engine draws and animates well. Sent to the script writer with the person's idea, never shown,
 * so the script asks for what makes that style come alive. By the brief's look, else the look of the template it started from.
 */
export function storyWorldFor(brief: { look?: string | null; styleExample?: string | null }): StoryWorld | null {
  const worlds = storyWorlds as Record<string, StoryWorld>;
  const look = brief.look ?? findGalleryTemplate(brief.styleExample)?.look ?? null;
  return (look && worlds[look]) || null;
}

export function isFilmBrief(brief: { look?: string | null; styleFamily?: string | null; styleExample?: string | null }): boolean {
  return filmKind(brief) !== null;
}

/**
 * Which kind of film: "explainer" for educational templates (told the way the best explainer shorts talk), "story" for
 * story templates and code-drawn story styles (told as a story), null for product, brand and colour films.
 */
export function filmKind(brief: { look?: string | null; styleFamily?: string | null; styleExample?: string | null }): "story" | "explainer" | null {
  const template = findGalleryTemplate(brief.styleExample);
  const useCase = template ? useCaseOf(template) : null;
  if (useCase === "explain") return "explainer";
  if (useCase === "story") return "story";
  if (useCase !== null) return null;
  if (brief.look?.startsWith("illus-")) return "story";
  if (brief.styleFamily === "clean-data") return "explainer";
  return null;
}

/** True when the style needs generated footage (and a confirmed budget) rather than a native drawing treatment. */
export const needsGeneration = (item: GalleryTemplate) => getLook(item.look).renderMode === "generated";

/** The brief fields a gallery entry presets. Everything else (brand kit, screenshots, product site) stays the person's. */
/** A film starts from a small story, never a product pitch: a template in the Story & film group that has no story of its own gets this. */
const dummyFilmPrompt = "A short film about a lighthouse keeper who lights an old lantern by hand when the lamp goes dark, and guides the fishing boats home before morning.";

export function galleryBrief(item: GalleryTemplate): Pick<ScriptBrief, "scriptMode" | "text" | "durationSeconds" | "durationMode" | "aspect" | "motionProfile" | "pace" | "audio" | "captions" | "template" | "theme" | "look" | "styleFamily" | "styleExample"> {
  return {
    scriptMode: "problem",
    text: useCaseOf(item) === "story" && !item.id.startsWith("story-") ? dummyFilmPrompt : item.prompt,
    durationSeconds: item.durationSeconds,
    durationMode: "script",
    aspect: item.aspect,
    motionProfile: item.motionProfile,
    pace: item.pace,
    audio: { mode: "both", voice: "Kore" },
    captions: "full",
    template: item.skill,
    theme: item.theme,
    look: item.look,
    styleExample: item.id,
    // A template made in a look that is split into families starts in its own family (e.g. a 3D scene opens "Clean · 3D & cinematic").
    ...(familiesOfLook(item.look).length ? { styleFamily: familyOf(item) } : {})
  };
}

/** A style on its own: only the look is set. The script stays the person's. */
export function styleBrief(look: LookId): Pick<ScriptBrief, "look"> {
  return { look };
}

/** What a card needs. The prompt and the brief presets stay on the server until a template is chosen. */
export type GalleryCard = Pick<GalleryTemplate, "id" | "name" | "group" | "summary" | "preview" | "source" | "aspect"> & { generated: boolean; useCase: GalleryUseCase; paintedLook?: string; /** Story film whose look needs a worker this deployment does not have yet. */ locked?: boolean };
export type GalleryPage = { items: GalleryCard[]; total: number; nextCursor: string | null; counts: Record<GalleryUseCase | "all", number> };

export const galleryCard = (item: GalleryTemplate): GalleryCard => ({
  id: item.id, name: item.name, group: item.group, summary: item.summary, preview: item.preview, aspect: item.aspect,
  ...(item.source ? { source: item.source } : {}), generated: needsGeneration(item) && !isStylePlate(item), useCase: useCaseOf(item)
});

/** The templates shown on the landing page, in order. */
export const featuredGalleryIds = ["product-launch", "feature-walkthrough", "sketch-explainer", "whats-new"] as const;

export const GALLERY_PAGE_MAX = 48;

/**
 * Filtering, search and paging for the gallery, run by the backend (GET /v1/gallery/templates) so the browser only
 * ever holds the page it shows. `cursor` is the offset of the next item; `counts` are for the search text across all
 * use cases, so the tabs stay truthful while someone searches.
 */
/** Use-case groups held back from the gallery for now. Remove an id here to show it again. */
const hiddenUseCases: readonly GalleryUseCase[] = ["threed"];

const ALL_INTERLEAVE_ORDER: readonly GalleryUseCase[] = ["story", "saas", "explain", "brand", "colour"];

function hashGallerySeed(seed: string | number): number {
  const str = String(seed || "default");
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 0x9e3779b9;
}

function makeSeededPrng(seed: string | number): () => number {
  let a = hashGallerySeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Balanced, seeded category interleaving across the full matching pool when browsing "All".
 * Shuffles items within each category (`story`, `saas`, `explain`, `brand`, `colour`) and interleaves
 * one item per category per round (with seeded round order) so Page 1 has balanced representation
 * across all categories, while remaining 100% deterministic for a given `seed` across pagination cursors.
 */
export function interleaveGalleryPool(
  items: readonly GalleryTemplate[],
  seed: string | number = "default"
): GalleryTemplate[] {
  if (items.length <= 1) return [...items];
  const rand = makeSeededPrng(seed);
  const buckets = new Map<GalleryUseCase, GalleryTemplate[]>();
  for (const uc of ALL_INTERLEAVE_ORDER) buckets.set(uc, []);
  for (const item of items) {
    const uc = useCaseOf(item);
    let list = buckets.get(uc);
    if (!list) {
      list = [];
      buckets.set(uc, list);
    }
    list.push(item);
  }
  const activeBuckets: { uc: GalleryUseCase; items: GalleryTemplate[]; idx: number }[] = [];
  for (const [uc, list] of buckets.entries()) {
    if (list.length > 0) {
      activeBuckets.push({ uc, items: seededShuffle(list, rand), idx: 0 });
    }
  }
  if (activeBuckets.length <= 1) {
    return activeBuckets[0]?.items ?? [];
  }
  const out: GalleryTemplate[] = [];
  while (out.length < items.length) {
    const roundBuckets = seededShuffle(
      activeBuckets.filter((b) => b.idx < b.items.length),
      rand
    );
    if (roundBuckets.length === 0) break;
    for (const b of roundBuckets) {
      out.push(b.items[b.idx++]!);
    }
  }
  return out;
}

export function queryGallery(options: { useCase?: string; q?: string; cursor?: string; limit?: number; ids?: readonly string[]; look?: string /* a look id or a family id */; /** Include the code-drawn plate templates (only where the backend has the plate pipeline on). */ plates?: boolean; /** Restrict to templates compatible with a specific brief flow ("film" = educational explainers and story/illustrated films). */ scope?: GalleryScope; /** Deterministic shuffle seed for balanced category interleaving in "all" mode. */ seed?: string | number } = {}): GalleryPage {
  const needle = normalizeSearch(options.q).toLowerCase();
  const base = options.look ? styleExamples(options.look) : galleryTemplates;
  const scoped = options.scope === "film" ? base.filter(isFilmTemplate) : base;
  const matches = needle ? scoped.filter((item) => `${item.name} ${item.summary} ${item.bestFor} ${item.group} ${item.look}`.toLowerCase().includes(needle)) : scoped;
  // Hidden groups stay out of browsing and counts (so their tab disappears); a template asked for by id still resolves.
  const shown = matches.filter((item) => !hiddenUseCases.includes(useCaseOf(item)) && (options.plates || !isStylePlate(item)));
  const counts = { all: shown.length } as Record<GalleryUseCase | "all", number>;
  for (const entry of galleryUseCases) counts[entry.id] = 0;
  for (const item of shown) counts[useCaseOf(item)]++;
  const isSpecificUseCase = Boolean(options.useCase && galleryUseCases.some((entry) => entry.id === options.useCase));
  const pool = options.ids
    ? options.ids.flatMap((id) => (options.scope === "film" ? shown : matches).filter((item) => item.id === id))
    : isSpecificUseCase
      ? shown.filter((item) => useCaseOf(item) === options.useCase)
      : options.look
        ? shown
        : interleaveGalleryPool(shown, options.seed ?? "default");
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 24) || 24, 1), GALLERY_PAGE_MAX);
  const offset = Math.max(Math.floor(Number(options.cursor)) || 0, 0);
  const page = pool.slice(offset, offset + limit);
  return { items: page.map(galleryCard), total: pool.length, nextCursor: offset + limit < pool.length ? String(offset + limit) : null, counts };
}


/**
 * Which family of its look a template belongs to. Only "clean" has families (style-families.ts): 3D scenes and the cinematic
 * group are 3D; type, showreel and social groups are typography; maths, tech, data, flat-vector and blackboard explainers are
 * data and diagrams; everything else (starters, product demos, screencasts) is product UI. A look without families is its own family.
 */
export const familyOf = (item: GalleryTemplate): string => {
  if (!familiesOfLook(item.look).length) return item.look;
  if (item.group === "3D") return "clean-3d";
  if (["Kinetic type", "Typography", "Showreel", "Social"].includes(item.group)) return "clean-type";
  if (["Math", "Tech", "Data", "Data & maps", "Flat vector", "Blackboard"].includes(item.group)) return "clean-data";
  return "clean-ui";
};

/** Every example of one style: a look id (all of its families) or a family id (just that family). Colour themes are
 *  palettes, not styles, so they are not examples. */
export const styleExamples = (id: string, options: { scope?: GalleryScope; plates?: boolean } = {}): readonly GalleryTemplate[] => {
  const plates = options.plates ?? true;
  return galleryTemplates.filter((item) =>
    item.group !== "Colour" &&
    (item.look === id || familyOf(item) === id) &&
    (plates || !isStylePlate(item)) &&
    (options.scope === "film" ? isFilmTemplate(item) && !hiddenUseCases.includes(useCaseOf(item)) : true)
  );
};

/** The default example template for a style or family within a given scope (e.g. when "Use this style" is chosen without a specific example card). */
export const defaultStyleExample = (id: string, options: { scope?: GalleryScope; plates?: boolean } = {}): string | undefined => {
  const examples = styleExamples(id, options);
  const hero = examples.find((item) => item.kind === "style" && item.preview.video) ?? examples.find((item) => item.preview.video) ?? examples[0];
  return hero?.id;
};

/** A visual style as the style picker shows it. `id` is a look id, or a family id for a look that is split into families
 *  (`look` is the look to set either way); `examples` is how many templates are made in it; `preview` is one real clip. */
export type GalleryStyleCard = { id: string; look: string; name: string; group: string; description: string; examples: number; preview: GalleryTemplate["preview"]; defaultExample?: string };

export function galleryStyles(options: { plates?: boolean; scope?: GalleryScope } = {}): GalleryStyleCard[] {
  const plates = options.plates ?? true;
  const scope = options.scope;
  const card = (id: string, look: (typeof looks)[number], name: string, description: string): GalleryStyleCard => {
    const examples = styleExamples(id, { scope, plates });
    // Prefer a style-led example (the style itself) over a product starter, then any example with a clip.
    const hero = examples.find((item) => item.kind === "style" && item.preview.video) ?? examples.find((item) => item.preview.video) ?? examples[0];
    return {
      id,
      look: look.id,
      name,
      group: look.group,
      description,
      examples: examples.length,
      preview: hero?.preview ?? { src: look.preview.src, kind: look.preview.kind === "video" ? "video" : "image", label: look.preview.label, ...(look.preview.kind === "video" ? { video: look.preview.src } : {}) },
      ...(hero ? { defaultExample: hero.id } : {})
    };
  };
  const items = looks.filter((look) => look.available && (!heldForV2(look.id) || (plates && isStylePlateLook(look.id)))).flatMap((look) => {
    const families = familiesOfLook(look.id);
    return families.length ? families.map((family) => card(family.id, look, family.name, family.description)) : [card(look.id, look, look.name, look.description)];
  });
  return scope === "film" ? items.filter((item) => item.examples > 0) : items;
}
