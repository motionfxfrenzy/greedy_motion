// Starter template catalog shared by the frontend gallery, backend validation/planning, and preview tooling.
// Each entry mirrors worker/templates/<id>/index.html; `npm run templates:verify` fails if the declared
// HyperFrames variables (data-composition-variables) drift from this file.

export type TemplateVariable = {
  id: string;
  label: string;
  type: "string" | "number" | "image" | "boolean";
  default: string | number | boolean;
  description?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  /**
   * What the planner may do with this slot:
   * "write" — draft copy from the brief; "extract" — only copy a value the user stated (numbers, sources, URLs),
   * otherwise leave the default for the user to replace; "never" — media slots the user supplies.
   */
  aiFill: "write" | "extract" | "never";
  /**
   * When the named variable gets a value and this one does not, this one becomes empty instead of its default.
   * Example: a user's "$48,000" must not inherit the template's default "%" suffix.
   */
  clearWhenSet?: string;
};

export type TemplateScene = { id: string; label: string; start: number; duration: number; variables: string[] };

export type Template = {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  durationSeconds: number;
  defaultTheme: string;
  /** Second at which the gallery preview still is captured. */
  previewAt: number;
  examplePrompt: string;
  scenes: TemplateScene[];
  variables: TemplateVariable[];
};

const cta = (text: string): TemplateVariable => ({ id: "ctaText", label: "Call to action", type: "string", default: text, maxLength: 28, aiFill: "write" });
/** Set by the renderer from the brand kit, never by the planner or the caller. */
const brandLogo: TemplateVariable[] = [
  { id: "logo", label: "Logo", type: "image", default: "", description: "Brand logo from the brand kit (set by the renderer).", aiFill: "never" },
  { id: "logoWordmark", label: "Logo includes the name", type: "boolean", default: false, description: "True when the logo already spells the product name, so the name text is hidden next to it.", aiFill: "never" }
];
const brand: TemplateVariable = { id: "brandName", label: "Product name", type: "string", default: "Relay", maxLength: 28, description: "Name of the product.", aiFill: "write" };

export const templates: readonly Template[] = [
  {
    id: "product-launch",
    name: "Product launch",
    description: "Hook, product reveal, three features, the benefit, and a call to action.",
    bestFor: "Announcing a new product or a major relaunch",
    durationSeconds: 10, defaultTheme: "neutral", previewAt: 3.4,
    examplePrompt: "Launch video for Relay, a tool that turns SaaS product updates into short motion videos for marketing teams.",
    scenes: [
      { id: "hook", label: "Hook", start: 0, duration: 2, variables: ["hook"] },
      { id: "reveal", label: "Product reveal", start: 2, duration: 2, variables: ["brandName", "tagline", "screenshot"] },
      { id: "features", label: "Three features", start: 4, duration: 2, variables: ["feature1", "feature2", "feature3"] },
      { id: "benefit", label: "Benefit", start: 6, duration: 2, variables: ["benefit"] },
      { id: "cta", label: "Call to action", start: 8, duration: 2, variables: ["ctaText", "url"] }
    ],
    variables: [
      { ...brand, description: "Name of the product this video launches." },
      { id: "hook", label: "Hook", type: "string", default: "Your product updates deserve an audience.", maxLength: 64, description: "Opening line naming the problem the audience has.", aiFill: "write" },
      { id: "tagline", label: "Tagline", type: "string", default: "Turn every release into a story people watch.", maxLength: 64, description: "The product’s positioning line, shown under its name.", aiFill: "write" },
      { id: "screenshot", label: "Product screenshot", type: "image", default: "assets/screenshot.svg", description: "A verified product screenshot shown during the reveal.", aiFill: "never" },
      { id: "feature1", label: "Feature 1", type: "string", default: "Screenshots become scenes", maxLength: 36, description: "First approved feature, a short noun phrase.", aiFill: "write" },
      { id: "feature2", label: "Feature 2", type: "string", default: "On-brand motion, automatically", maxLength: 36, description: "Second approved feature, a short noun phrase.", aiFill: "write" },
      { id: "feature3", label: "Feature 3", type: "string", default: "Edit any scene in seconds", maxLength: 36, description: "Third approved feature, a short noun phrase.", aiFill: "write" },
      { id: "benefit", label: "Benefit", type: "string", default: "Ship the update and the video on the same day.", maxLength: 72, description: "One sentence on the outcome for the customer. Approved claims only.", aiFill: "write" },
      cta("Start free today"),
      { id: "url", label: "Website", type: "string", default: "relay.video", maxLength: 40, description: "Domain or URL shown with the call to action.", aiFill: "extract" },
      ...brandLogo
    ]
  },
  {
    id: "feature-spotlight",
    name: "Feature spotlight",
    description: "Headline, your screenshot in a browser frame with a push-in, a callout, the benefit, and a call to action.",
    bestFor: "Showing one feature with a real product screenshot",
    durationSeconds: 10, defaultTheme: "blue-professional", previewAt: 4.8,
    examplePrompt: "Spotlight the profit dashboard in Northwind, which shows ecommerce teams their real margin after fees for every order.",
    scenes: [
      { id: "headline", label: "Headline", start: 0, duration: 2, variables: ["featureName", "headline"] },
      { id: "screenshot", label: "Screenshot", start: 2, duration: 2, variables: ["screenshot"] },
      { id: "callout", label: "Callout", start: 4, duration: 2, variables: ["callout"] },
      { id: "benefit", label: "Benefit", start: 6, duration: 2, variables: ["benefit"] },
      { id: "cta", label: "Call to action", start: 8, duration: 2, variables: ["brandName", "ctaText"] }
    ],
    variables: [
      { id: "featureName", label: "Feature name", type: "string", default: "Profit dashboard", maxLength: 32, description: "Name of the feature being shown.", aiFill: "write" },
      { id: "headline", label: "Headline", type: "string", default: "See your real profit in one glance.", maxLength: 60, description: "What the feature lets the customer do, in one line.", aiFill: "write" },
      { id: "screenshot", label: "Screenshot", type: "image", default: "assets/screenshot.svg", description: "Product screenshot of the feature, 16:10 or wider.", aiFill: "never" },
      { id: "callout", label: "Callout", type: "string", default: "Live margin, after fees", maxLength: 32, description: "Short label pointing at the key part of the screenshot.", aiFill: "write" },
      { id: "benefit", label: "Benefit", type: "string", default: "Stop guessing which orders actually make money.", maxLength: 72, description: "The outcome for the customer. Approved claims only.", aiFill: "write" },
      cta("Try it free"),
      brand,
      ...brandLogo
    ]
  },
  {
    id: "stat-highlight",
    name: "Stat highlight",
    description: "A setup line, a big count-up number, why it matters, its source, and a call to action.",
    bestFor: "Leading with one proof point or metric",
    durationSeconds: 10, defaultTheme: "bold", previewAt: 4.2,
    examplePrompt: "Highlight that teams using Relay spent 72% less time on launch videos last quarter, from our customer survey.",
    scenes: [
      { id: "setup", label: "Setup", start: 0, duration: 2, variables: ["setup"] },
      { id: "number", label: "Count-up", start: 2, duration: 3, variables: ["statPrefix", "statValue", "statSuffix", "statLabel"] },
      { id: "context", label: "Why it matters", start: 5, duration: 2, variables: ["context"] },
      { id: "source", label: "Source", start: 7, duration: 1, variables: ["source"] },
      { id: "cta", label: "Call to action", start: 8, duration: 2, variables: ["brandName", "ctaText"] }
    ],
    variables: [
      { id: "setup", label: "Setup", type: "string", default: "Teams using Relay last quarter", maxLength: 60, description: "The question or context the number answers.", aiFill: "write" },
      { id: "statValue", label: "Number", type: "number", default: 72, min: 0, max: 100000000, description: "The headline figure. Must come from the customer’s approved data.", aiFill: "extract" },
      { id: "statPrefix", label: "Before the number", type: "string", default: "", maxLength: 3, description: "Optional, e.g. $ or +.", aiFill: "extract", clearWhenSet: "statValue" },
      { id: "statSuffix", label: "After the number", type: "string", default: "%", maxLength: 4, description: "Optional unit, e.g. % or x or K.", aiFill: "extract", clearWhenSet: "statValue" },
      { id: "statLabel", label: "What the number means", type: "string", default: "less time spent on launch videos", maxLength: 48, aiFill: "write" },
      { id: "context", label: "Context", type: "string", default: "From a two-day edit to a ten-minute review.", maxLength: 72, description: "One sentence on why the number matters. Approved claims only.", aiFill: "write" },
      { id: "source", label: "Source", type: "string", default: "Source: internal customer survey, Q3", maxLength: 56, description: "Where the number comes from, shown as a citation.", aiFill: "extract" },
      cta("See how it works"),
      brand,
      ...brandLogo
    ]
  },
  {
    id: "whats-new",
    name: "What's new",
    description: "Version badge, release title, three shipped updates, a closing line, and a call to action.",
    bestFor: "Release notes, monthly updates, and changelogs",
    durationSeconds: 10, defaultTheme: "code-editorial", previewAt: 5.4,
    examplePrompt: "Release video for Relay v2.4: timeline comments for AI edits, 16 new themes with live previews, and 4K exports on every plan.",
    scenes: [
      { id: "intro", label: "Version", start: 0, duration: 2, variables: ["version"] },
      { id: "title", label: "Release title", start: 2, duration: 2, variables: ["title"] },
      { id: "updates", label: "Three updates", start: 4, duration: 2.5, variables: ["update1", "update2", "update3"] },
      { id: "closing", label: "Closing line", start: 6.5, duration: 1.5, variables: ["closing"] },
      { id: "cta", label: "Call to action", start: 8, duration: 2, variables: ["brandName", "ctaText"] }
    ],
    variables: [
      { id: "version", label: "Version or date", type: "string", default: "v2.4", maxLength: 20, description: "Release identifier, e.g. v2.4 or October release.", aiFill: "write" },
      { id: "title", label: "Release title", type: "string", default: "Faster edits, sharper exports.", maxLength: 56, description: "One line summarising the release.", aiFill: "write" },
      { id: "update1", label: "Update 1", type: "string", default: "Comment on any moment to edit it", maxLength: 44, description: "First shipped change, a short phrase.", aiFill: "write" },
      { id: "update2", label: "Update 2", type: "string", default: "16 new themes with live previews", maxLength: 44, description: "Second shipped change, a short phrase.", aiFill: "write" },
      { id: "update3", label: "Update 3", type: "string", default: "4K exports for every plan", maxLength: 44, description: "Third shipped change, a short phrase.", aiFill: "write" },
      { id: "closing", label: "Closing line", type: "string", default: "Available to every workspace today.", maxLength: 64, description: "What customers should do or feel next.", aiFill: "write" },
      cta("Read the changelog"),
      brand,
      ...brandLogo
    ]
  }
];

export const templateIds = templates.map((template) => template.id);
export const defaultTemplateId = "product-launch";

export function findTemplate(id: string) {
  return templates.find((template) => template.id === id);
}

export type TemplateValues = Record<string, string | number>;

/**
 * Validates values against a template's variables: unknown keys are dropped, strings are trimmed and
 * length-checked, numbers range-checked. Returns the clean values or the first error.
 */
/** Every problem with a set of values (used to give the planner one precise repair attempt). */
export function templateValueProblems(template: Template, values: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const variable of template.variables) {
    const raw = values[variable.id];
    if (raw === undefined || raw === null || raw === "" || variable.type === "image" || variable.type === "boolean") continue;
    if (variable.type === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) problems.push(`${variable.id}: must be a number`);
      else if ((variable.min !== undefined && n < variable.min) || (variable.max !== undefined && n > variable.max)) problems.push(`${variable.id}: must be between ${variable.min} and ${variable.max}`);
    } else if (typeof raw !== "string") {
      problems.push(`${variable.id}: must be text`);
    } else {
      const length = raw.trim().replace(/\s+/g, " ").length;
      if (variable.maxLength !== undefined && length > variable.maxLength) problems.push(`${variable.id}: ${length} characters, limit is ${variable.maxLength} — shorten it`);
    }
  }
  return problems;
}

export function validateTemplateValues(template: Template, values: Record<string, unknown>): { values: TemplateValues } | { error: string } {
  const clean: TemplateValues = {};
  for (const variable of template.variables) {
    const raw = values[variable.id];
    if (raw === undefined || raw === null || raw === "") continue;
    // Image and boolean slots are set by the renderer (bundled defaults, brand-kit logo); never accept caller values.
    if (variable.type === "image" || variable.type === "boolean") continue;
    if (variable.type === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return { error: `${variable.label} must be a number.` };
      if ((variable.min !== undefined && n < variable.min) || (variable.max !== undefined && n > variable.max)) return { error: `${variable.label} is out of range.` };
      clean[variable.id] = n;
    } else {
      if (typeof raw !== "string") return { error: `${variable.label} must be text.` };
      const text = raw.trim().replace(/\s+/g, " ");
      if (variable.maxLength !== undefined && text.length > variable.maxLength) return { error: `${variable.label} must be ${variable.maxLength} characters or fewer.` };
      clean[variable.id] = text;
    }
  }
  // Dependent defaults: a value supplied for one slot clears the default of slots tied to it.
  for (const variable of template.variables) {
    if (variable.clearWhenSet && clean[variable.clearWhenSet] !== undefined && clean[variable.id] === undefined) clean[variable.id] = "";
  }
  return { values: clean };
}

/** Resolved value for a slot: the given value, or the template default. */
export function templateValue(template: Template, values: TemplateValues, id: string) {
  return values[id] ?? template.variables.find((variable) => variable.id === id)?.default ?? "";
}

/** Human-readable text for one scene, used by the storyboard. */
export function describeScene(template: Template, scene: TemplateScene, values: TemplateValues) {
  const get = (id: string) => templateValue(template, values, id);
  if (scene.variables.includes("statValue")) {
    const value = Number(get("statValue")).toLocaleString("en-US");
    return `${get("statPrefix")}${value}${get("statSuffix")} ${get("statLabel")}`.trim();
  }
  return scene.variables
    .filter((id) => template.variables.find((variable) => variable.id === id)?.type === "string")
    .map((id) => String(get(id)))
    .filter(Boolean)
    .join(" · ");
}
