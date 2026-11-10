import { resolveSceneRoute, type SceneRoute, type Aspect, type Beat, type BeatLayoutHint, type BeatPlan, type HyperFramesOverridesMap } from "@videosaas/contracts";
import type { PlateSubtitles } from "../plates/model.ts";
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
  motion: { entry: Beat["motion"]["entry"]; exit: Beat["motion"]["exit"]; text_effect: string | null; /** The director's camera direction in words; the engine reads its verb, direction and size. */ camera: string | null };
  transition_out: Beat["transition_out"];
  fallback: Beat["fallback"] | null;
  scene?: string | null;
  hints?: BeatLayoutHint | null;
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
  subtitles?: PlateSubtitles | null;
  beats: EngineBeat[];
};

/** The `plan` variable: the beats the engine draws, with their clock from `planTiming`. */
export function enginePlan(
  plan: BeatPlan,
  timing: PlanTiming,
  screenSizes: Record<string, { width: number; height: number }> = {},
  look = "clean",
  subtitles?: PlateSubtitles | null
): EnginePlan {
  const times = new Map(timing.beats.map((beat) => [beat.id, beat]));
  return {
    canvas: plan.canvas,
    motion_profile: plan.brand.motion_profile,
    captions: subtitles?.mode ?? plan.audio.captions,
    ...(subtitles ? { subtitles } : {}),
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
        motion: { entry: beat.motion.entry, exit: beat.motion.exit, text_effect: beat.motion.text_effect ?? null, camera: beat.motion.camera || null },
        transition_out: beat.transition_out,
        fallback: beat.fallback ?? null,
        scene: beat.scene ?? null,
        ...(beat.hints ? { hints: beat.hints } : {}),
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

/** The `hf-variables` block payload: editable beat text plus any element-level `overrides` object. */
export function hfBlockValues(
  beats: Pick<Beat, "id" | "keyword" | "on_screen" | "line">[],
  overrides?: HyperFramesOverridesMap
): Record<string, unknown> {
  const base: Record<string, unknown> = textValues(beats);
  if (overrides && Object.keys(overrides).length > 0) {
    base.overrides = overrides;
  }
  return base;
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
  /** A small corner mark (the kit's logo mark or silhouette), shown on content scenes; empty when the kit has none. */
  logoBug?: string | null;
  /** Drawing style (contracts looks.ts); the engine reads it as the `look` variable. */
  look?: string;
  /** Style family (contracts style-families.ts), e.g. "clean-type"; the engine reads it as the `family` variable. */
  family?: string;
  /** Saved subtitle customization (mode, style, size, opacity, color, bgColor, x, y, scenePositions). */
  subtitles?: PlateSubtitles | null;
};

/** Every variable the engine reads: `plan`, `shot.<id>`, `brandName`, `logo`, `logoWordmark`, `logoBug`, `look`. */
export function engineVariables(input: EngineInputs): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {
    plan: JSON.stringify(enginePlan(input.plan, input.timing, input.screenSizes, input.look, input.subtitles)),
    brandName: input.brandName,
    logo: input.logo ?? "",
    logoWordmark: Boolean(input.logo && input.logoWordmark),
    logoBug: input.logoBug ?? "",
    look: input.look ?? "clean",
    family: input.family ?? ""
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

/** Fills the one replaceable block that carries the storyboard's editable text and element-level overrides. */
export function fillTextBlock(html: string, values: Record<string, unknown>): string {
  if (!TEXT_BLOCK.test(html)) throw new Error("The beat-plan template has no hf-variables block.");
  return html.replace(TEXT_BLOCK, () => `<script id="hf-variables" type="application/json">${scriptJson(values)}</script>`);
}

const SUBTITLE_STYLING_SCRIPT = `<script id="bp-subtitles">(function(){
  try {
    var HF = window.__hyperframes, V = Object.assign({}, window.__hfVariables || {}, HF && HF.getVariables ? HF.getVariables() : {});
    var plan = V.plan && typeof V.plan === "object" ? V.plan : JSON.parse(V.plan || "{}");
    var sub = plan && plan.subtitles && typeof plan.subtitles === "object" ? plan.subtitles : null;
    if (!sub) return;
    var capLayer = document.getElementById("captions");
    var root = document.getElementById("root");
    var tl = window.__timelines && window.__timelines.main;
    if (!capLayer || !root) return;
    var W = +root.getAttribute("data-width") || 1920, H = +root.getAttribute("data-height") || 1080;
    var baseFs = W > H * 1.2 ? 42 : H > W * 1.2 ? 40 : 38;
    var beats = Array.isArray(plan.beats) ? plan.beats : [];
    var idxByBeatId = {};
    for (var i = 0; i < beats.length; i++) idxByBeatId[beats[i].id] = i;
    var clamp = function(v, a, b) { return Math.min(b, Math.max(a, v)); };
    var mode = sub.mode || plan.captions || "full";
    if (mode === "none") {
      capLayer.innerHTML = "";
      return;
    }
    if (mode === "key-phrases" && capLayer.children.length === 0 && document.getElementById("frame-film") && tl) {
      for (var k = 0; k < beats.length; k++) {
        var b = beats[k];
        var phrase = String(V[b.id + ".on_screen"] || b.on_screen || V[b.id + ".keyword"] || b.keyword || "").trim();
        if (!phrase) continue;
        var el = document.createElement("div");
        el.className = "cap";
        el.setAttribute("data-el", b.id + ":cap:0");
        el.setAttribute("data-layout-allow-overlap", "");
        var sp = document.createElement("span");
        sp.textContent = phrase;
        el.appendChild(sp);
        capLayer.appendChild(el);
        var s = +b.start || 0, e = +b.end || (s + 2);
        var t0 = Math.round((s + 0.1) * 30) / 30, t1 = Math.round(Math.max(s + 0.3, e - 0.15) * 30) / 30;
        tl.set(el, { autoAlpha: 0 }, 0);
        tl.set(el, { autoAlpha: 1 }, t0);
        tl.fromTo(el, { y: 12 }, { y: 0, duration: 0.14, ease: "power2.out" }, t0);
        tl.set(el, { autoAlpha: 0 }, t1);
      }
    }
    var spMap = sub.scenePositions && typeof sub.scenePositions === "object" ? sub.scenePositions : {};
    var subScale = clamp((+sub.size || 100) / 100, 0.5, 1.6);
    var subAlpha = clamp((+sub.opacity || 100) / 100, 0.2, 1);
    var st = sub.style || "pill";
    var col = sub.color || "";
    var bg = sub.bgColor || "";
    var caps = capLayer.querySelectorAll(".cap");
    for (var j = 0; j < caps.length; j++) {
      var capEl = caps[j];
      var elId = capEl.getAttribute("data-el") || "";
      var beatId = elId.split(":")[0] || "";
      var scIdx = Object.prototype.hasOwnProperty.call(idxByBeatId, beatId) ? idxByBeatId[beatId] : 0;
      capEl.setAttribute("data-scene-index", String(scIdx));
      var scPos = spMap[String(scIdx)];
      var pxVal = scPos && typeof scPos.x === "number" ? scPos.x : (typeof sub.x === "number" ? sub.x : 50);
      var pyVal = scPos && typeof scPos.y === "number" ? scPos.y : (typeof sub.y === "number" ? sub.y : 80);
      capEl.className = "cap cap-" + st;
      capEl.style.left = clamp(pxVal, 8, 92) + "%";
      capEl.style.top = clamp(pyVal, 8, 92) + "%";
      capEl.style.bottom = "auto";
      capEl.style.width = "max-content";
      capEl.style.maxWidth = "84%";
      if (tl) tl.set(capEl, { xPercent: -50, yPercent: -50 }, 0);
      else capEl.style.transform = "translate(-50%, -50%)";
      var spanEl = capEl.querySelector("span");
      if (!spanEl) continue;
      spanEl.style.fontSize = Math.round(baseFs * subScale) + "px";
      spanEl.style.maxWidth = "100%";
      spanEl.style.opacity = String(subAlpha);
      if (st === "cinema") {
        var shCol = bg || "#090b10";
        spanEl.style.background = "transparent";
        spanEl.style.color = col || "#fef08a";
        spanEl.style.border = "none";
        spanEl.style.boxShadow = "none";
        spanEl.style.textShadow = "0 2px 4px " + shCol + ", -1.5px -1.5px 0 " + shCol + ", 1.5px -1.5px 0 " + shCol + ", -1.5px 1.5px 0 " + shCol + ", 1.5px 1.5px 0 " + shCol;
      } else if (st === "kinetic") {
        spanEl.style.background = bg || "#facc15";
        spanEl.style.color = col || "#0b0d12";
        spanEl.style.borderRadius = "10px";
        spanEl.style.border = "3px solid #0b0d12";
        spanEl.style.fontWeight = "800";
        spanEl.style.textTransform = "uppercase";
        spanEl.style.letterSpacing = "0.02em";
        spanEl.style.boxShadow = "0 4px 0 #0b0d12";
      } else if (st === "paper") {
        spanEl.style.background = bg || "#faf5e8";
        spanEl.style.color = col || "#231f1b";
        spanEl.style.borderRadius = "10px";
        spanEl.style.border = "2px solid #3b3228";
        spanEl.style.fontFamily = "Georgia, 'Times New Roman', serif";
        spanEl.style.fontWeight = "600";
        spanEl.style.boxShadow = "3px 4px 0 rgba(30, 22, 14, 0.32)";
      } else if (st === "blueprint") {
        spanEl.style.background = bg || "rgba(12, 42, 74, 0.9)";
        spanEl.style.color = col || "#f0f9ff";
        spanEl.style.borderRadius = "6px";
        spanEl.style.border = "2px solid #7dd3fc";
        spanEl.style.fontFamily = "'SF Mono', Menlo, monospace";
        spanEl.style.fontWeight = "600";
        spanEl.style.letterSpacing = "0.02em";
        spanEl.style.boxShadow = "0 4px 12px rgba(4, 16, 36, 0.45)";
      } else {
        spanEl.style.background = bg || "rgba(12, 15, 22, 0.82)";
        spanEl.style.color = col || "#f8fafc";
        spanEl.style.borderRadius = "999px";
        spanEl.style.border = "1px solid rgba(255, 255, 255, 0.14)";
        spanEl.style.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.38)";
      }
    }
  } catch (e) {}
})();</script>`;

/** Applies saved PlateSubtitles styling, position, and mode to #captions in preview and final render HTML. */
export function withSubtitleStyling(html: string, subtitles?: PlateSubtitles | null): string {
  if (!subtitles) return html;
  return html.replace("</body>", () => `  ${SUBTITLE_STYLING_SCRIPT}\n</body>`);
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
