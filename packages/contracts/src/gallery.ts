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
import { getLook, looks, type LookId } from "./looks.ts";
import { themes } from "./themes.ts";

export type GalleryKind = "starter" | "explainer" | "skill" | "style";

export type GalleryTemplate = {
  id: string;
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
    id: "product-launch", kind: "starter", starterId: "product-launch", name: "Product launch", group: "Launch",
    summary: "Hook, product reveal, three features, the benefit and a call to action.",
    bestFor: "Announcing a new product or a major relaunch",
    preview: still("/templates/product-launch.jpg", "Rendered still"),
    skill: null, look: "clean", theme: "neutral", aspect: "16:9", durationSeconds: 30, motionProfile: "snappy", pace: "balanced", audio: "both", captions: "key-phrases",
    prompt: "Launch video for Relay, a tool that turns SaaS product updates into short motion videos for marketing teams. Hook with the problem, reveal the product, show three features, end with a call to start free."
  },
  {
    id: "feature-spotlight", kind: "starter", starterId: "feature-spotlight", name: "Feature spotlight", group: "Feature",
    summary: "A headline, your screenshot pushed in, a callout, the benefit and a call to action.",
    bestFor: "Showing one feature with a real product screenshot",
    preview: still("/templates/feature-spotlight.jpg", "Rendered still"),
    skill: null, look: "clean", theme: "blue-professional", aspect: "16:9", durationSeconds: 30, motionProfile: "smooth", pace: "balanced", audio: "voiceover", captions: "key-phrases",
    prompt: "Spotlight the profit dashboard in Northwind, which shows ecommerce teams their real margin after fees for every order. Show the dashboard, call out the live margin figure, and end with a call to try it free."
  },
  {
    id: "feature-walkthrough", kind: "skill", name: "Narrated walkthrough", group: "Feature",
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
    id: "whats-new", kind: "starter", starterId: "whats-new", name: "What's new", group: "Release",
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
    id: "narrated-product-minute", kind: "explainer", name: "One-minute narrated explainer", group: "Explainer",
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
    summary: "The problem, the options, the change and what you learned.",
    bestFor: "Case studies and portfolio walkthroughs",
    preview: still("/previews/looks/clean.png", "Layout draft"),
    source: { label: "Remade from @moguzbulbul", url: "https://x.com/moguzbulbul/status/2104206095313215591" },
    skill: null, look: "hairline", theme: "neutral", aspect: "16:9", durationSeconds: 45, motionProfile: "smooth", pace: "calm", audio: "voiceover", captions: "key-phrases",
    prompt: "A short case study explaining one design decision: the problem users had, what we considered, the change we made, and what we learned. Calm and clear, one visual per step, so a hiring manager or stakeholder can follow it."
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
    id: "prompt-to-result-story", kind: "explainer", name: "Product motion-graphics video", group: "Explainer",
    summary: "Paper shards sweep across a deep gradient panel, then settle around the product name and one line.",
    bestFor: "Launch teasers and product intros that research the product first",
    preview: still("/previews/looks/clean.png", "Layout draft"),
    source: { label: "Remade from the Motion Prompt Gallery product prompt", url: "https://motionpromptgallery.com/p/reusable-prompt-template-for-a-product-motion-video-ann-nnng/" },
    skill: null, look: "clean", theme: "neutral", aspect: "16:9", durationSeconds: 15, motionProfile: "snappy", pace: "fast", audio: "music", captions: "key-phrases",
    prompt: "Make a dynamic 15-second motion graphics video for Relay that shows what an incredible motion designer you are. Paper shards sweep across a deep gradient panel with motion trails, then settle around the product name and one short line. Research the product first, then write the video content yourself using only real features."
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
  return { ...item, ...reference, preview: { src: `gallery:${entry.poster}`, kind: "video", video: `gallery:${entry.video}`, label: getLook(item.look).renderMode === "generated" ? "Layout draft: generated footage replaces it" : "Preview of this style" } };
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
    skill: null, look: look.id, theme: "neutral", aspect: "16:9", durationSeconds: 30, motionProfile: "smooth", pace: "balanced", audio: "voiceover", captions: "key-phrases",
    prompt: exampleStylePrompt
  }));


/**
 * Every generated style comes in two versions, so each is easy to find where it is wanted: a Story & film one (the whole
 * scene, told through the look) and a SaaS one (the same look behind the product's own screen and words). The renderer is
 * the same underneath. Previews are rendered by scripts/build-gallery-styles.mjs from the style's reference art.
 */
type StyleRow = { look: LookId; name: string; description: string; hero: string | null };
const styleVersions: readonly GalleryTemplate[] = (styleRows as unknown as StyleRow[]).flatMap((row): GalleryTemplate[] => {
  const base = { look: row.look, theme: "neutral", aspect: "16:9" as const, durationSeconds: 30, captions: "key-phrases" as const, skill: null, kind: "style" as const, preview: getLook(row.look).preview };
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
const sceneTemplates: readonly GalleryTemplate[] = (sceneRows as unknown as SceneRow[]).map((row) => ({ ...row, kind: "explainer", skill: null, captions: "key-phrases", preview: lookPreview(row.look) }));

/** Remakes of public motion prompts (scripts/merge-gallery-opus.mjs validates and writes the rows). */
type OpusRow = Omit<GalleryTemplate, "kind" | "skill" | "captions" | "preview">;
const opusTemplates: readonly GalleryTemplate[] = (opusRows as unknown as OpusRow[]).map((row) => ({
  ...row, kind: "explainer", skill: null, captions: "key-phrases",
  preview: lookPreview(row.look)
}));

/** A colour theme is a starting point too: the same example film in a different palette and type. */
const themeTemplates: readonly GalleryTemplate[] = themes.map((theme): GalleryTemplate => ({
  id: `theme-${theme.id}`, kind: "style", name: theme.name, group: "Colour",
  summary: `${theme.mode === "dark" ? "A dark" : "A light"} palette with its own type. Your brand kit can override it.`,
  bestFor: "Matching a mood or a brand before you add your own kit",
  preview: still(`/themes/${theme.id}.jpg`, "Rendered still"),
  skill: null, look: "clean", theme: theme.id, aspect: "16:9", durationSeconds: 30, motionProfile: "smooth", pace: "balanced", audio: "voiceover", captions: "key-phrases",
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
export const galleryTemplates: readonly GalleryTemplate[] = [...curated, ...sceneTemplates.filter(hasClip), ...opusTemplates, ...styleVersions.filter(hasClip), ...styleTemplates, ...themeTemplates].map(withLookTheme).map(withRendered);

import { galleryUseCases, type GalleryUseCase } from "./gallery-use-cases.ts";
export { galleryUseCases, type GalleryUseCase };

// What was built first (starters, the product explainers, the remade prompts, every drawn style) all serve product videos,
// so it is browsed under SaaS & product. Explainers & learning holds the distinct teaching styles; Story & film the art-led
// handmade looks; 3D & cinematic the Three.js scenes.
const explainGroups = new Set(["Math", "Tech", "Flat vector", "Whiteboard", "Blackboard", "Kinetic type", "Screencast", "Data & maps", "Storybook"]);
const brandGroups = new Set(["Showreel", "Typography", "Social"]);

export function useCaseOf(item: GalleryTemplate): GalleryUseCase {
  if (item.group === "Colour") return "colour";
  if (item.group === "3D") return "threed";
  if (explainGroups.has(item.group)) return "explain";
  if (item.kind === "style" && item.group === "Story") return "story";
  if (brandGroups.has(item.group)) return "brand";
  return "saas";
}

export const galleryIds = galleryTemplates.map((item) => item.id);
export const findGalleryTemplate = (id: string | null | undefined) => galleryTemplates.find((item) => item.id === id);

/** True when the style needs generated footage (and a confirmed budget) rather than a native drawing treatment. */
export const needsGeneration = (item: GalleryTemplate) => getLook(item.look).renderMode === "generated";

/** The brief fields a gallery entry presets. Everything else (brand kit, screenshots, product site) stays the person's. */
export function galleryBrief(item: GalleryTemplate): Pick<ScriptBrief, "scriptMode" | "text" | "durationSeconds" | "aspect" | "motionProfile" | "pace" | "audio" | "captions" | "template" | "theme" | "look"> {
  return {
    scriptMode: "problem",
    text: item.prompt,
    durationSeconds: item.durationSeconds,
    aspect: item.aspect,
    motionProfile: item.motionProfile,
    pace: item.pace,
    audio: { mode: item.audio, voice: "Kore" },
    captions: item.captions,
    template: item.skill,
    theme: item.theme,
    look: item.look
  };
}

/** A style on its own: only the look is set. The script stays the person's. */
export function styleBrief(look: LookId): Pick<ScriptBrief, "look"> {
  return { look };
}

/** What a card needs. The prompt and the brief presets stay on the server until a template is chosen. */
export type GalleryCard = Pick<GalleryTemplate, "id" | "name" | "group" | "summary" | "preview" | "source" | "aspect"> & { generated: boolean; useCase: GalleryUseCase };
export type GalleryPage = { items: GalleryCard[]; total: number; nextCursor: string | null; counts: Record<GalleryUseCase | "all", number> };

export const galleryCard = (item: GalleryTemplate): GalleryCard => ({
  id: item.id, name: item.name, group: item.group, summary: item.summary, preview: item.preview, aspect: item.aspect,
  ...(item.source ? { source: item.source } : {}), generated: needsGeneration(item), useCase: useCaseOf(item)
});

/** The templates shown on the landing page, in order. */
export const featuredGalleryIds = ["product-launch", "feature-walkthrough", "sketch-explainer", "whats-new"] as const;

export const GALLERY_PAGE_MAX = 48;

/**
 * Filtering, search and paging for the gallery, run by the backend (GET /v1/gallery/templates) so the browser only
 * ever holds the page it shows. `cursor` is the offset of the next item; `counts` are for the search text across all
 * use cases, so the tabs stay truthful while someone searches.
 */
export function queryGallery(options: { useCase?: string; q?: string; cursor?: string; limit?: number; ids?: readonly string[] } = {}): GalleryPage {
  const needle = (options.q ?? "").trim().toLowerCase().slice(0, 80);
  const matches = needle ? galleryTemplates.filter((item) => `${item.name} ${item.summary} ${item.bestFor} ${item.group} ${item.look}`.toLowerCase().includes(needle)) : galleryTemplates;
  const counts = { all: matches.length } as Record<GalleryUseCase | "all", number>;
  for (const entry of galleryUseCases) counts[entry.id] = 0;
  for (const item of matches) counts[useCaseOf(item)]++;
  const pool = options.ids
    ? options.ids.flatMap((id) => matches.filter((item) => item.id === id))
    : options.useCase && galleryUseCases.some((entry) => entry.id === options.useCase) ? matches.filter((item) => useCaseOf(item) === options.useCase) : matches;
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 24) || 24, 1), GALLERY_PAGE_MAX);
  const offset = Math.max(Math.floor(Number(options.cursor)) || 0, 0);
  const page = pool.slice(offset, offset + limit);
  return { items: page.map(galleryCard), total: pool.length, nextCursor: offset + limit < pool.length ? String(offset + limit) : null, counts };
}
