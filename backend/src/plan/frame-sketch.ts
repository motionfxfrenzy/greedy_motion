import type { Aspect, ScriptBeat, ScriptNotes } from "@videosaas/contracts";
import { config } from "../config.ts";

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
  "- Print the key phrase and the on-screen words exactly as given (they are what the viewer reads). Never print the VISUAL line itself, and never copy words, numbers or labels from the style guide's code: other text is limited to short labels the VISUAL line names.",
  "- Plain SVG elements only: rect, circle, ellipse, line, polyline, polygon, path, text, tspan, g, defs, linearGradient, radialGradient, stop, clipPath, marker. No script, no foreignObject, no image, no external links, no animation, no CSS @import.",
  "- Keep it under 6 KB: simple shapes, no long point lists.",
  "- Ids (the film animates from frame to frame by id, so they must be consistent across all frames):",
  "  - the key phrase text is id=\"title\"; the on-screen words (if any) are id=\"subtitle\"; any other line of reading text is id=\"caption\" (a second one \"caption-2\").",
  "  - every object listed in OBJECTS keeps exactly that id in every frame it appears in (box-1..box-16 means box-1, box-2, … in order); put a numbered box's rect and its number text in a <g id=\"box-3\">; a whole row of them in <g id=\"row\"> when OBJECTS names it.",
  "  - anything else gets a short unique id of its own, never one of the OBJECTS ids.",
  "- Draw pointers, arrows and markers last so they sit on top of brackets, boxes and outlines, never hidden behind them.",
  "- Follow the style guide closely: its background, palette, fonts, stroke weights, corner radii and layout habits. Use font-family stacks that end in a generic family (serif or sans-serif)."
].join("\n");

const STYLE_LIMIT = 16_000;

export type FrameRequest = { beat: ScriptBeat; index: number; count: number; aspect: Aspect; topic: string; style: { name: string; code: string } | null; look: string; notes?: ScriptNotes | null };

/** The part every beat shares (style guide, topic, size), cached, then the beat itself. */
function prompt({ beat, index, count, aspect, topic, style, look, notes }: FrameRequest) {
  const { width, height } = FRAME_SIZE[aspect];
  const shared = [
    style
      ? `Style guide: the template "${style.name}". Its reference code (an animated HyperFrames composition; draw in its visual language, not its animation):\n<reference>\n${style.code.slice(0, STYLE_LIMIT)}\n</reference>`
      : `Style guide: a clean, modern "${look}" motion-graphics look: one flat background, one accent colour, a geometric sans-serif.`,
    `What the film is about: ${topic.slice(0, 600)}`,
    ...(notes?.idea ? [`The film's one idea: ${notes.idea}`] : []),
    ...(notes?.objects ? [`OBJECTS (the film's recurring objects; use exactly these ids): ${notes.objects}`] : []),
    ...(notes?.example ? [`The film's worked example. Every frame that shows it uses exactly these values (the same list, target and positions), so the frames match each other; never use the style guide's own numbers:\n${notes.example}`] : []),
    `Frame size: width="${width}" height="${height}" viewBox="0 0 ${width} ${height}".`
  ].join("\n\n");
  const own = [
    `Beat ${index + 1} of ${count}:`,
    `KEY PHRASE: ${beat.keyword}`,
    `VISUAL: ${beat.visual ?? "(none given: show the key phrase with one simple supporting shape)"}`,
    `ON SCREEN: ${beat.onScreen ?? "-"}`,
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
  const response = await http("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.FRAME_MODEL || process.env.SCRIPT_MODEL || config.anthropicModel,
      max_tokens: 6000,
      output_config: { effort: "low" },
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
