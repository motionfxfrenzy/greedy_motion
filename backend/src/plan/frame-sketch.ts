import { inferScriptTemplate, type Aspect, type ScriptBeat, type ScriptNotes } from "@videosaas/contracts";
import { config } from "../config.ts";
import { callModel } from "../models/providers.ts";
import { routeFor } from "../models/routes.ts";

/**
 * Reference frames for the script canvas: one still SVG per beat, drawn by the model in the chosen template's style (its
 * reference code is the style guide). They are sketches to judge the script by, not the film. The page shows them as
 * `<img src="data:image/svg+xml,…">`, where nothing in them can run; `cleanSvg` strips scripts and links anyway.
 */
export const FRAME_SIZE: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 1080, height: 1080 }
};

const SYSTEM = [
  "You draw one still reference frame for one beat of a short motion-graphics video, as a single SVG.",
  "Answer with the SVG only: it starts with <svg and ends with </svg>. No markdown, no prose, no comments.",
  "Rules:",
  "- Use the exact width, height and viewBox you are given. Paint the full background first.",
  "- Draw the beat's key moment: the objects the VISUAL line names, laid out as the finished frame would show them.",
  "- Compose the primary focal subject, room action, and diagrams in the upper-middle focal band (roughly 18% to 65% of frame height, i.e. Y=130..468 on 1280x720, and 14% to 86% of frame width) with balanced top headroom and bottom ground padding across all aspect ratios (16:9, 9:16, and 1:1) so the bottom 30% (Y>480 on 1280x720) remains a clean floor or dark ground for the player's subtitle overlay. Never make the frame bottom-heavy, keep complete character/prop geometry (such as a balloon and its hanging basket) above the bottom caption safe zone, and draw background hills/landscapes before foreground subjects so hills never occlude the subject.",
  "- Follow the VISUAL line's shot/role tag when present:",
  "  - [A-ROLL: WIDE SCENE]: Draw a grounded 2D architectural room or street (e.g. window panes with city skyline silhouettes, wall, floor line at Y=468, furniture/door/stage) and the full-body character acting. NEVER draw chart axes, dashboard cards, or decorative flowchart arrows in an A-Roll story scene.",
  "  - [A-ROLL: CLOSE-UP]: Draw a deep dark radial vignette background and a large centered close-up of the character's head (r=110..135 around Y=290) with expressive eyes, eyebrows, mouth, and rim-light arc. Zero diagrams or boxes.",
  "  - [B-ROLL: LINE GRAPH]: Draw a clean L-shaped X/Y axis on a dark vignette grid with 1 or 2 bold colored curves (stroke-width 5..6, fill=\"none\") and at most 3 short labels (font-size >= 22).",
  "  - [B-ROLL: BAR COMPARISON]: Draw 2 clean vertical bars rising from a baseline at Y=445, optionally with the silhouette character standing beside the bar, and at most 3 short labels.",
  "  - [B-ROLL: DUAL CLOCK]: Draw 1 or 2 bold circular stopwatch dials centered around Y=295 with clear time readouts inside and 1 short label under each.",
  "  - [B-ROLL: COUNTER HIT]: Draw one giant glowing number (font-size 110..130, id matching the counter in OBJECTS or id=\"counter\") centered around Y=295 with one short uppercase label underneath. No dashboard card boxes.",
  "  - [B-ROLL: VISUAL METAPHOR]: Draw one clean centered conceptual object (a paper checklist sheet, a 35mm horizontal film strip with faces and red X marks, a 1-2-3 podium with characters, a glowing brain outline, or a horizontal scale line) in Y=140..460.",
  "  - [CHAPTER CARD]: Draw a centered rounded pill frame on a dark starry vignette with the bold uppercase chapter title inside.",
  "- TEXT RESTRAINT: Print the beat's KEY PHRASE once at the top center as id=\"title\" (uppercase, bold, font-size 26..30). Inside the scene, use at most 3 short labels (1–3 words each, font-size >= 20). Never draw tiny multi-line sub-labels or SaaS dashboard cards, never print the VISUAL line itself, and never print bracketed tags like [A-ROLL: ...] or [B-ROLL: ...].",
  "- Respect each object's role (PROP, LIVING OBJECT, or FULL CARTOON CHARACTER): never draw eyes, brows, or a mouth on a plain PROP.",
  "- Plain SVG elements only: rect, circle, ellipse, line, polyline, polygon, path, text, tspan, g, defs, linearGradient, radialGradient, stop, clipPath, marker. No script, no foreignObject, no image, no external links, no animation, no CSS @import.",
  "- Keep it under 6 KB: simple shapes, no long point lists.",
  "- Ids (the film animates from frame to frame by id, so they must be consistent across all frames):",
  "  - the key phrase text is id=\"title\"; the on-screen words (when distinct from the title and needed as a short badge) are id=\"subtitle\" placed directly beneath id=\"title\" near the top of the frame (Y=94 on 1280x720, Y=162 on 720x1280), NEVER floating in the middle of the frame over characters or props; any other line of reading text is id=\"caption\" (a second one \"caption-2\").",
  "  - every object listed in OBJECTS keeps exactly that id in every frame it appears in (e.g. <g id=\"character\">, <g id=\"office-door\">, <g id=\"coffee-cup\">, <g id=\"rewind-dial\">); never reinvent the protagonist's design from scene to scene.",
  "  - anything else gets a short unique id of its own, never one of the OBJECTS ids.",
  "- Draw pointers, arrows and markers last so they sit on top of brackets, boxes and outlines, never hidden behind them.",
  "- Follow the style guide closely: its background, palette, character rig, fonts, stroke weights, corner radii and layout habits. Use font-family stacks that end in a generic family (serif or sans-serif)."
].join("\n");

const STYLE_LIMIT = 16_000;

/**
 * Built-in curated SVG reference guide for "What If" thought-experiment and "How Does" mechanism films.
 * Gives the SVG artist the exact locked silhouette character rig, grounded A-Roll room, A-Roll close-up reaction face,
 * and minimalist B-Roll graph/clock/counter/metaphor layouts from our reference standard.
 */
export const CURATED_THOUGHT_EXPERIMENT_STYLE_GUIDE = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <radialGradient id="bg-vig" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#141629"/>
      <stop offset="100%" stop-color="#070810"/>
    </radialGradient>
  </defs>
  <!-- 1. SHARED DARK VIGNETTE GROUND & TOP HEADER (id="title" at Y=54; keep all focal art in Y=130..468 above the Y>480 subtitle zone) -->
  <rect width="1280" height="720" fill="url(#bg-vig)"/>
  <text id="title" x="640" y="56" text-anchor="middle" fill="#fef3c7" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="800" letter-spacing="2">A FULL CUP OF COFFEE</text>

  <!-- 2. ARCHETYPE A — [A-ROLL: WIDE SCENE] Grounded architectural room (windows y=84..290 with city skyline, wall y=290..468, floor y=468..720) -->
  <g id="room-backdrop">
    <rect x="0" y="84" width="1280" height="206" fill="#64748b"/>
    <rect x="70" y="140" width="90" height="150" fill="#475569"/>
    <rect x="190" y="105" width="110" height="185" fill="#334155"/>
    <rect x="340" y="155" width="85" height="135" fill="#475569"/>
    <rect x="820" y="115" width="105" height="175" fill="#334155"/>
    <rect x="960" y="150" width="90" height="140" fill="#475569"/>
    <line x1="0" y1="290" x2="1280" y2="290" stroke="#0f172a" stroke-width="6"/>
    <line x1="320" y1="84" x2="320" y2="290" stroke="#0f172a" stroke-width="5"/>
    <line x1="640" y1="84" x2="640" y2="290" stroke="#0f172a" stroke-width="5"/>
    <line x1="960" y1="84" x2="960" y2="290" stroke="#0f172a" stroke-width="5"/>
    <rect x="0" y="290" width="1280" height="178" fill="#262338"/>
    <rect x="0" y="468" width="1280" height="252" fill="#12101b"/>
  </g>
  <g id="office-door">
    <rect x="650" y="160" width="18" height="308" fill="#181524"/>
    <rect x="668" y="172" width="190" height="296" fill="#5c432d"/>
    <circle cx="692" cy="335" r="7" fill="#eab308"/>
  </g>

  <!-- 3. CANONICAL PROTAGONIST RIG (<g id="character">): pitch-dark circle head #0d0d14, warm rim-light arc #fef3c7, white eyes/brows/mouth, #8b5cf6 hoodie profile, dark legs -->
  <g id="character" transform="translate(520 468)">
    <line x1="-6" y1="-58" x2="-10" y2="0" stroke="#0d0d14" stroke-width="10" stroke-linecap="round"/>
    <line x1="6" y1="-58" x2="10" y2="0" stroke="#0d0d14" stroke-width="10" stroke-linecap="round"/>
    <line x1="10" y1="-58" x2="14" y2="0" stroke="#fef3c7" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M -22 -128 Q -32 -122 -24 -110" fill="#6d28d9"/>
    <path d="M -16 -125 L 14 -125 L 16 -58 L -16 -58 Z" fill="#8b5cf6"/>
    <line x1="14" y1="-125" x2="16" y2="-58" stroke="#fef3c7" stroke-width="2.5"/>
    <circle cx="0" cy="-154" r="26" fill="#0d0d14"/>
    <path d="M 4 -179 A 25 25 0 0 1 4 -129" fill="none" stroke="#fef3c7" stroke-width="3" stroke-linecap="round"/>
    <path d="M 3 -164 Q 7 -168 11 -164" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M 14 -164 Q 18 -168 22 -164" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="7" cy="-156" r="3.5" fill="#ffffff"/>
    <circle cx="18" cy="-156" r="3.5" fill="#ffffff"/>
    <circle cx="13" cy="-144" r="4" fill="none" stroke="#ffffff" stroke-width="2.2"/>
    <path d="M 4 -112 L 34 -96" stroke="#8b5cf6" stroke-width="12" stroke-linecap="round"/>
  </g>
  <g id="coffee-cup" transform="translate(575 365) rotate(18)">
    <polygon points="-16,-24 16,-24 12,24 -12,24" fill="#f5f5f4"/>
    <rect x="-18" y="-29" width="36" height="6" rx="2" fill="#78716c"/>
    <path d="M 14 -10 A 9 9 0 0 1 14 10" fill="none" stroke="#f5f5f4" stroke-width="3.5"/>
  </g>

  <!-- 4. ARCHETYPE B — [A-ROLL: CLOSE-UP] Reaction shot on dark vignette: giant head cx=640 cy=290 r=120 with rim-light & big eyes/brows/mouth -->
  <!-- <g id="character"><path d="M 490 468 Q 640 385 790 468 Z" fill="#8b5cf6"/><circle cx="640" cy="285" r="118" fill="#0d0d14"/><path d="M 640 167 A 118 118 0 0 1 640 403" fill="none" stroke="#67e8f9" stroke-width="6"/><circle cx="600" cy="270" r="22" fill="#fef3c7"/><circle cx="600" cy="272" r="10" fill="#0d0d14"/><circle cx="680" cy="270" r="22" fill="#fef3c7"/><circle cx="680" cy="272" r="10" fill="#0d0d14"/><path d="M 582 232 Q 600 218 618 232" fill="none" stroke="#fef3c7" stroke-width="7" stroke-linecap="round"/><path d="M 662 232 Q 680 218 698 232" fill="none" stroke="#fef3c7" stroke-width="7" stroke-linecap="round"/><circle cx="640" cy="332" r="16" fill="none" stroke="#fef3c7" stroke-width="7"/></g> -->

  <!-- 5. ARCHETYPE C — [B-ROLL: LINE GRAPH] Clean L-axis (x=280..1000, y=150..440) + 2 bold curves + 2 labels -->
  <!-- <polyline points="280,150 280,440 1000,440" fill="none" stroke="#fef3c7" stroke-width="3"/><path id="curve-short" d="M 280 210 L 680 315" fill="none" stroke="#f87171" stroke-width="6" stroke-linecap="round"/><path id="curve-life" d="M 280 370 L 460 335 L 460 275" fill="none" stroke="#eab308" stroke-width="6" stroke-linecap="round"/><text x="340" y="466" text-anchor="middle" fill="#cbd5e1" font-size="20" font-weight="700">SHORT TERM</text><text x="940" y="466" text-anchor="middle" fill="#cbd5e1" font-size="20" font-weight="700">LIFETIME</text> -->

  <!-- 6. ARCHETYPE D — [B-ROLL: DUAL CLOCK] Two circular stopwatches at (420, 285) and (860, 285), r=105 -->
  <!-- <g id="clock-5m"><circle cx="420" cy="285" r="105" fill="#0d131f" stroke="#4ade80" stroke-width="8"/><line x1="420" y1="285" x2="465" y2="205" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/><text x="420" y="325" text-anchor="middle" fill="#ffffff" font-size="34" font-weight="800">5 MIN</text><text x="420" y="445" text-anchor="middle" fill="#4ade80" font-size="24" font-weight="800">THE CHAT</text></g> -->
</svg>`;

export function curatedThoughtExperimentGuide(aspect: Aspect = "16:9"): string {
  if (aspect === "9:16") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <defs>
    <radialGradient id="bg-vig" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#141629"/>
      <stop offset="100%" stop-color="#070810"/>
    </radialGradient>
  </defs>
  <!-- 1. SHARED DARK VIGNETTE GROUND & TOP HEADER (id="title" at Y=110; keep all focal art in Y=220..820 above the Y>880 subtitle safe zone) -->
  <rect width="720" height="1280" fill="url(#bg-vig)"/>
  <text id="title" x="360" y="110" text-anchor="middle" fill="#fef3c7" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800" letter-spacing="2">A FULL CUP OF COFFEE</text>

  <!-- 2. ARCHETYPE A — [A-ROLL: WIDE SCENE] Grounded 9:16 architectural room (windows y=170..500 with city skyline, wall y=500..820, floor y=820..1280) -->
  <g id="room-backdrop">
    <rect x="0" y="170" width="720" height="330" fill="#64748b"/>
    <rect x="55" y="250" width="95" height="250" fill="#475569"/>
    <rect x="180" y="200" width="120" height="300" fill="#334155"/>
    <rect x="440" y="220" width="110" height="280" fill="#334155"/>
    <rect x="580" y="270" width="90" height="230" fill="#475569"/>
    <line x1="0" y1="500" x2="720" y2="500" stroke="#0f172a" stroke-width="6"/>
    <line x1="240" y1="170" x2="240" y2="500" stroke="#0f172a" stroke-width="5"/>
    <line x1="480" y1="170" x2="480" y2="500" stroke="#0f172a" stroke-width="5"/>
    <rect x="0" y="500" width="720" height="320" fill="#262338"/>
    <rect x="0" y="820" width="720" height="460" fill="#12101b"/>
  </g>
  <g id="office-door">
    <rect x="380" y="340" width="18" height="480" fill="#181524"/>
    <rect x="398" y="355" width="210" height="465" fill="#5c432d"/>
    <circle cx="424" cy="600" r="8" fill="#eab308"/>
  </g>

  <!-- 3. CANONICAL PROTAGONIST RIG (<g id="character">): pitch-dark circle head #0d0d14, warm rim-light arc #fef3c7, white eyes/brows/mouth, #8b5cf6 hoodie profile, dark legs -->
  <g id="character" transform="translate(245 820) scale(1.25)">
    <line x1="-6" y1="-58" x2="-10" y2="0" stroke="#0d0d14" stroke-width="10" stroke-linecap="round"/>
    <line x1="6" y1="-58" x2="10" y2="0" stroke="#0d0d14" stroke-width="10" stroke-linecap="round"/>
    <line x1="10" y1="-58" x2="14" y2="0" stroke="#fef3c7" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M -22 -128 Q -32 -122 -24 -110" fill="#6d28d9"/>
    <path d="M -16 -125 L 14 -125 L 16 -58 L -16 -58 Z" fill="#8b5cf6"/>
    <line x1="14" y1="-125" x2="16" y2="-58" stroke="#fef3c7" stroke-width="2.5"/>
    <circle cx="0" cy="-154" r="26" fill="#0d0d14"/>
    <path d="M 4 -179 A 25 25 0 0 1 4 -129" fill="none" stroke="#fef3c7" stroke-width="3" stroke-linecap="round"/>
    <path d="M 3 -164 Q 7 -168 11 -164" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M 14 -164 Q 18 -168 22 -164" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="7" cy="-156" r="3.5" fill="#ffffff"/>
    <circle cx="18" cy="-156" r="3.5" fill="#ffffff"/>
    <circle cx="13" cy="-144" r="4" fill="none" stroke="#ffffff" stroke-width="2.2"/>
    <path d="M 4 -112 L 34 -96" stroke="#8b5cf6" stroke-width="12" stroke-linecap="round"/>
  </g>

  <!-- 4. ARCHETYPE B — [A-ROLL: CLOSE-UP] Reaction shot on dark vignette: giant head cx=360 cy=520 r=135 with rim-light & big eyes/brows/mouth -->
  <!-- 5. ARCHETYPE C — [B-ROLL: LINE GRAPH] Clean L-axis (x=110..610, y=300..740) + 2 bold curves + 2 labels -->
  <!-- 6. ARCHETYPE D — [B-ROLL: BAR COMPARISON] Two vertical bars rising from y=760 at x=210 and x=480 with character standing beside bar -->
</svg>`;
  }
  return CURATED_THOUGHT_EXPERIMENT_STYLE_GUIDE;
}

export type FrameRequest = { beat: ScriptBeat; index: number; count: number; aspect: Aspect; topic: string; style: { name: string; code: string } | null; look: string; notes?: ScriptNotes | null };

/** The part every beat shares (style guide, topic, size), cached, then the beat itself. */
function prompt({ beat, index, count, aspect, topic, style, look, notes }: FrameRequest) {
  const { width, height } = FRAME_SIZE[aspect];
  const scriptTemplate = inferScriptTemplate({ text: topic, look });
  const hasARollBRollTag = /^\s*\[(?:A-ROLL|B-ROLL|CHAPTER CARD)/i.test(beat.visual ?? "");
  const useCuratedThoughtGuide =
    (scriptTemplate === "what-if" || scriptTemplate === "how-does" || hasARollBRollTag) &&
    (look === "clean" || !look || look === "illus-flat-vector");
  const effectiveStyle = useCuratedThoughtGuide
    ? {
        name: scriptTemplate === "how-does" ? "How-Does Mechanism Explainer" : "What-If Thought Experiment",
        code: curatedThoughtExperimentGuide(aspect)
      }
    : style;
  const shared = [
    effectiveStyle
      ? `Style guide: the template "${effectiveStyle.name}". Its reference code (an animated HyperFrames composition; draw in its visual language, character rig, and shot archetypes, not its literal words):\n<reference>\n${effectiveStyle.code.slice(0, STYLE_LIMIT)}\n</reference>`
      : `Style guide: a clean, modern "${look}" motion-graphics look: one flat background, one accent colour, a geometric sans-serif.`,
    `What the film is about: ${topic.slice(0, 600)}`,
    ...(notes?.idea ? [`The film's one idea: ${notes.idea}`] : []),
    ...(notes?.objects ? [`OBJECTS (the film's recurring objects; use these exact ids on <g> or leaf elements every time they appear): ${notes.objects}`] : []),
    ...(notes?.example ? [`The film's worked example and locked character/cast visual spec. Every frame that shows the character or data MUST use these exact colours, head/body design, and values so all frames match each other:\n${notes.example}`] : []),
    `Frame size: width="${width}" height="${height}" viewBox="0 0 ${width} ${height}".`
  ].join("\n\n");
  const own = [
    `Beat ${index + 1} of ${count}:`,
    `KEY PHRASE: ${beat.keyword}`,
    `VISUAL: ${beat.visual ?? "(none given: show the key phrase with one simple supporting shape)"}`,
    `ON SCREEN: ${useCuratedThoughtGuide ? "- (print only KEY PHRASE at the top as id=\"title\" and the short labels explicitly named in VISUAL; do NOT draw a separate id=\"subtitle\" banner)" : (beat.onScreen ?? "-")}`,
    `VOICEOVER at this moment: ${beat.line ?? "-"}`,
    "The frame shows what this voiceover line is saying as it is said (if it talks about a million, show the million)."
  ].join("\n");
  return [{ type: "text", text: shared, cache_control: { type: "ephemeral" } }, { type: "text", text: own }];
}

/** Removes anything that could run or load: the frame is shown as an image, and this keeps it inert even if pasted elsewhere. */
export function cleanSvg(text: string): string | null {
  const start = text.indexOf("<svg");
  const end = text.lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  const svg = text.slice(start, end + 6)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<(?:image|use|animate\w*|set)\b[^>]*\/?>/gi, "")
    .replace(/\s(?:on\w+|(?:xlink:)?href)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/@import[^;]*;/gi, "")
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none");
  // An SVG shown as an <img> renders only with its namespace; models sometimes leave it out.
  const named = /^<svg[^>]*\sxmlns\s*=/.test(svg) ? svg : svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return named.length <= 40_000 ? named : null;
}

/** Draws one frame. Throws on an API error or an answer that is not an SVG. */
export async function sketchFrame(request: FrameRequest, signal: AbortSignal, http: typeof fetch = fetch): Promise<string> {
  const route = routeFor("frameSketch");
  if (route.provider !== "anthropic") {
    // Another provider (MODEL_FRAME_SKETCH): the shared provider layer.
    const result = await callModel({ step: "frameSketch", route, system: SYSTEM, messages: [{ role: "user", content: prompt(request).map((part) => ({ type: "text" as const, text: part.text, ...(part.cache_control ? { cache: true } : {}) })) }], maxTokens: 6000, effort: "low", signal, errorPrefix: "Frame request failed", includeErrorDetail: true, ...(http !== fetch ? { request: http } : {}) });
    const svg = cleanSvg(result.text);
    if (!svg) throw new Error("The frame came back without a usable SVG.");
    return svg;
  }
  const response = await http("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: route.model,
      max_tokens: route.maxTokens,
      output_config: { effort: route.effort ?? "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt(request) }]
    }),
    signal
  });
  const payload = await response.json().catch(() => ({})) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(`Frame request failed (${response.status})${payload.error?.message ? `: ${payload.error.message}` : "."}`);
  const text = (payload.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  const svg = cleanSvg(text);
  if (!svg) throw new Error("The frame came back without a usable SVG.");
  return svg;
}
