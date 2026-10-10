import { resolveSceneRoute, type SceneRoute, type Aspect, type Beat, type BeatPlan } from "@videosaas/contracts";
import type { PlanTiming } from "./timing.ts";

/**
 * Pure builders for the beat-plan composition engine (worker/templates/beat-plan/index.html).
 * No filesystem or config access, so the live preview route, the test renders in
 * experiments/beat-engine and (later) the render worker all produce the same page.
 */

export const ENGINE_TEMPLATE = "beat-plan";

/**
 * HyperFrames reads `data-width`/`data-height` once, before scripts run, so the canvas cannot
 * come from a variable. The template ships at 1920×1080 and every consumer stamps the plan's
 * canvas onto the root and the viewport with `stampCanvas` before serving or rendering it.
 */
export const CANVAS: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 }
};

/** JSON safe to embed inside a <script> element (same escaping as the preview service). */
export const scriptJson = (value: unknown) => JSON.stringify(value)
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

type EngineBeat = {
  route: SceneRoute;
  id: string;
  role: Beat["role"];
  kind: Beat["kind"];
  keyword: string;
  on_screen: string | null;
  line: string | null;
  verb: string | null;
  success: boolean;
  energy: Beat["energy"];
  ui: (NonNullable<Beat["ui"]> & { aspect?: number }) | null;
  motion: { entry: Beat["motion"]["entry"]; exit: Beat["motion"]["exit"]; text_effect: string | null };
  transition_out: Beat["transition_out"];
  fallback: Beat["fallback"] | null;
  start: number;
  end: number;
  vo: { start: number; end: number } | null;
  act_at: number | null;
  success_at: number | null;
  /** Transcript word times on the film clock (captions follow the real read); null until voiced. */
  words: { text: string; start: number; end: number }[] | null;
};

export type EnginePlan = {
  canvas: Aspect;
  motion_profile: BeatPlan["brand"]["motion_profile"];
  captions: BeatPlan["audio"]["captions"];
  beats: EngineBeat[];
};

/** The `plan` variable: the beats the engine draws, with their clock from `planTiming`. */
export function enginePlan(plan: BeatPlan, timing: PlanTiming, screenSizes: Record<string, { width: number; height: number }> = {}, look = "clean"): EnginePlan {
  const times = new Map(timing.beats.map((beat) => [beat.id, beat]));
  return {
    canvas: plan.canvas,
    motion_profile: plan.brand.motion_profile,
    captions: plan.audio.captions,
    beats: plan.beats.map((beat) => {
      const time = times.get(beat.id);
      const size = beat.ui ? screenSizes[beat.ui.screen] : undefined;
      return {
        id: beat.id,
        route: resolveSceneRoute(beat, look),
        role: beat.role,
        kind: beat.kind,
        keyword: beat.keyword,
        on_screen: beat.on_screen,
        line: beat.line,
        verb: beat.verb,
        success: beat.success,
        energy: beat.energy,
        ui: beat.ui ? { ...beat.ui, ...(size && size.width > 0 && size.height > 0 ? { aspect: Math.round((size.width / size.height) * 1000) / 1000 } : {}) } : null,
        motion: { entry: beat.motion.entry, exit: beat.motion.exit, text_effect: beat.motion.text_effect ?? null },
        transition_out: beat.transition_out,
        fallback: beat.fallback ?? null,
        start: time?.start ?? 0,
        end: time?.end ?? 0,
        vo: time?.vo ?? null,
        act_at: time?.actAt ?? null,
        success_at: time?.successAt ?? null,
        words: time?.words ?? null
      };
    })
  };
}

/** The editable text values, keyed `<beatId>.keyword|on_screen|line` (the `/composition` variables). */
export function textValues(beats: Pick<Beat, "id" | "keyword" | "on_screen" | "line">[]): Record<string, string> {
  return Object.fromEntries(beats.flatMap((beat) => [[`${beat.id}.keyword`, beat.keyword], [`${beat.id}.on_screen`, beat.on_screen ?? ""], [`${beat.id}.line`, beat.line ?? ""]]));
}

export type EngineInputs = {
  plan: BeatPlan;
  timing: PlanTiming;
  /** Screenshot id → URL (preview: `/api/preview/projects/:id/screenshots/:sid`; render: a project-relative path). */
  shots: Record<string, string>;
  screenSizes?: Record<string, { width: number; height: number }>;
  brandName: string;
  logo?: string | null;
  logoWordmark?: boolean;
  /** Drawing style (contracts looks.ts); the engine reads it as the `look` variable. */
  look?: string;
};

/** Every variable the engine reads: `plan`, `shot.<id>`, `brandName`, `logo`, `logoWordmark`, `look`. */
export function engineVariables(input: EngineInputs): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {
    plan: JSON.stringify(enginePlan(input.plan, input.timing, input.screenSizes, input.look)),
    brandName: input.brandName,
    logo: input.logo ?? "",
    logoWordmark: Boolean(input.logo && input.logoWordmark),
    look: input.look ?? "clean"
  };
  for (const [id, url] of Object.entries(input.shots)) values[`shot.${id}`] = url;
  return values;
}

/** Sets the root's data-width/data-height and the viewport for the plan's canvas. */
export function stampCanvas(html: string, aspect: Aspect): string {
  const { width, height } = CANVAS[aspect];
  const rootTag = /<div id="root"[^>]*>/.exec(html);
  if (!rootTag) throw new Error("The beat-plan template has no #root element.");
  const stamped = rootTag[0].replace(/data-width="\d+"/, `data-width="${width}"`).replace(/data-height="\d+"/, `data-height="${height}"`);
  return html
    .replace(rootTag[0], stamped)
    .replace(/<meta name="viewport" content="[^"]*">/, `<meta name="viewport" content="width=${width}, height=${height}">`);
}

const TEXT_BLOCK = /<script id="hf-variables" type="application\/json">[\s\S]*?<\/script>/;

/** Fills the one replaceable block that carries the storyboard's editable text. */
export function fillTextBlock(html: string, values: Record<string, string>): string {
  if (!TEXT_BLOCK.test(html)) throw new Error("The beat-plan template has no hf-variables block.");
  return html.replace(TEXT_BLOCK, () => `<script id="hf-variables" type="application/json">${scriptJson(values)}</script>`);
}

const DECLARATIONS = /data-composition-variables='([\s\S]*?)'/;
const decodeAttribute = (value: string) => value.replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const encodeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Declares every variable in `values` on the template (for `--strict-variables` renders), keeping
 * the template's own declarations. With `asDefaults`, the values also become the declared defaults:
 * that is the "check twin" for `hyperframes check` and `snapshot`, which take no variables flag.
 */
export function declareVariables(html: string, values: Record<string, string | number | boolean>, { asDefaults = false } = {}): string {
  const match = DECLARATIONS.exec(html);
  if (!match) throw new Error("The beat-plan template has no variable declarations.");
  type Declaration = { id: string; type: string; label: string; default: unknown; [key: string]: unknown };
  const declared = JSON.parse(decodeAttribute(match[1])) as Declaration[];
  const byId = new Map(declared.map((item) => [item.id, item]));
  for (const [id, value] of Object.entries(values)) {
    const existing = byId.get(id);
    if (existing) {
      if (asDefaults) existing.default = value;
      continue;
    }
    const item: Declaration = { id, type: typeof value === "boolean" ? "boolean" : id.startsWith("shot.") ? "image" : "string", label: id, default: asDefaults ? value : typeof value === "boolean" ? false : "" };
    declared.push(item);
    byId.set(id, item);
  }
  return html.replace(match[0], () => `data-composition-variables='${encodeAttribute(JSON.stringify(declared))}'`);
}
