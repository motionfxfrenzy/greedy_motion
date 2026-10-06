import { MUSIC_PROMPT_MAX, NARRATION_MAX, templateValueProblems, validateTemplateValues, type AudioOptions, type BrandKit, type PlannerInfo, type RenderRequest, type Template } from "@videosaas/contracts";
import { config } from "../config.ts";
import { planFromValues, requireTemplate, type PromptPlanner, type ReviewRevision } from "./planner.ts";

type ContentBlock = { type?: string; id?: string; name?: string; input?: unknown };
type ClaudeResponse = { content?: ContentBlock[]; stop_reason?: string };

const FILL_TOOL = "fill_template";

/**
 * Tool schema generated from the template catalog, so Claude can only return the template's own slots,
 * within their length limits. Media slots ("never") are excluded entirely.
 */
function fillTool(template: Template, audio?: AudioOptions, includeMotionStyle = false) {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const variable of template.variables) {
    if (variable.aiFill === "never") continue;
    const guidance = variable.aiFill === "extract"
      ? " ONLY fill this if the user's brief states it explicitly; copy it, never invent or estimate it. Otherwise omit it."
      : "";
    const description = `${variable.label}. ${variable.description ?? ""}${guidance}`.trim();
    properties[variable.id] = variable.type === "number"
      ? { type: "number", description, ...(variable.min !== undefined && { minimum: variable.min }), ...(variable.max !== undefined && { maximum: variable.max }) }
      : { type: "string", description, ...(variable.maxLength !== undefined && { maxLength: variable.maxLength }) };
    if (variable.aiFill === "write") required.push(variable.id);
  }
  if (audio?.voiceover) {
    properties.narration = { type: "string", maxLength: NARRATION_MAX, description: `Voiceover script read over the whole ${template.durationSeconds}-second video, following the scene order. At most ${NARRATION_MAX} characters (about 20 words); short sentences; no stage directions.` };
    required.push("narration");
  }
  if (audio?.music) {
    properties.musicPrompt = { type: "string", maxLength: MUSIC_PROMPT_MAX, description: "Background music direction for an instrumental track: mood, genre, instruments, energy. No artist, song, or brand names." };
    required.push("musicPrompt");
  }
  if (includeMotionStyle) {
    properties.motionStyle = { type: "string", enum: ["clean", "kinetic", "editorial"], description: "Motion treatment for the revision. Preserve the current style unless the review requests a different energy or treatment. Use kinetic for faster, more dynamic, or more energetic motion; editorial for a crafted, story-led treatment; clean for calm, restrained motion." };
    required.push("motionStyle");
  }
  return {
    name: FILL_TOOL,
    description: `Fill the "${template.name}" video template (${template.durationSeconds} seconds).`,
    input_schema: { type: "object", properties, required }
  };
}

export class AnthropicPromptPlanner implements PromptPlanner {
  readonly info: PlannerInfo = { provider: "anthropic", model: config.anthropicModel };

  async plan(request: RenderRequest, brand?: BrandKit, revision?: ReviewRevision) {
    const template = requireTemplate(request.template);
    const scenes = template.scenes.map((scene) => `- ${scene.label} (${scene.duration}s): ${scene.variables.join(", ")}`).join("\n");
    const revisionContext = revision ? `\n\nCurrent approved script:\n${revision.script.lines.map((line, index) => `${index + 1}. ${line.label}: ${line.onScreen}`).join("\n")}\n\nTimestamped review requests to apply:\n${revision.comments.map((comment) => `- ${comment.timestampSeconds.toFixed(1)}s: ${comment.body}`).join("\n")}\n\nRevise the template copy to address every request that is supported by the brief. Preserve any approved facts and do not invent claims. Return the complete revised template, not only changed fields.` : "";
    const messages: object[] = [{
      role: "user",
      content: `Template: ${template.name} — ${template.description}\nScenes:\n${scenes}\n\nMotion style: ${request.style}. Format: ${request.format}.${brand ? `\n\nBrand: ${brand.name}${brand.url ? ` (${brand.url})` : ""}.${brand.description ? ` About: ${brand.description}` : ""} Use exactly this product name.` : ""}\n\nBrief: ${request.prompt}${revisionContext}`
    }];

    // One bounded repair attempt (Architecture §11): if limits are broken, return the exact problems and ask again.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const payload = await this.request(template, messages, request.audio, Boolean(revision));
      const toolUse = payload.content?.find((block) => block.type === "tool_use" && block.name === FILL_TOOL);
      if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
        throw new Error(`Claude did not fill the template (stop reason: ${payload.stop_reason ?? "unknown"}).`);
      }
      const input = toolUse.input as Record<string, unknown>;
      const problems = templateValueProblems(template, input);
      const narration = typeof input.narration === "string" ? input.narration.trim().replace(/\s+/g, " ") : "";
      const musicPrompt = typeof input.musicPrompt === "string" ? input.musicPrompt.trim().replace(/\s+/g, " ") : "";
      const motionStyle = input.motionStyle === "clean" || input.motionStyle === "kinetic" || input.motionStyle === "editorial" ? input.motionStyle : request.style;
      if (request.audio?.voiceover && (!narration || narration.length > NARRATION_MAX)) problems.push(`narration: ${narration.length} characters, must be 1–${NARRATION_MAX}`);
      if (request.audio?.music && (!musicPrompt || musicPrompt.length > MUSIC_PROMPT_MAX)) problems.push(`musicPrompt: ${musicPrompt.length} characters, must be 1–${MUSIC_PROMPT_MAX}`);
      if (problems.length === 0) {
        const result = validateTemplateValues(template, input);
        if ("error" in result) throw new Error(`Claude returned invalid copy: ${result.error}`);
        return { ...planFromValues(template, result.values), ...(narration ? { narration } : {}), ...(musicPrompt ? { musicPrompt } : {}), ...(revision ? { motionStyle } : {}) };
      }
      if (attempt === 2) throw new Error(`Claude's copy still breaks the template limits: ${problems.join("; ")}.`);
      messages.push(
        { role: "assistant", content: payload.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: `Fix these and call ${FILL_TOOL} again with every field:\n- ${problems.join("\n- ")}` }] }
      );
    }
    throw new Error("Planning failed.");
  }

  private async request(template: Template, messages: object[], audio?: AudioOptions, includeMotionStyle = false): Promise<ClaudeResponse> {
    const apiKey = config.anthropicApiKey;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured on the backend.");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 1024,
        // Mirrors .claude/skills/gm-skill-authoring/references/script-for-motion.md (the single source of truth for scripts); keep them in step.
        system: [
          "You write scripts for short SaaS product motion videos. Write beats, not paragraphs: every line must give the animation one visible thing to show.",
          "Open with a hook in the first 3 seconds: the viewer's pain or the outcome, never \"Introducing…\" or a logo-first line. One problem, one outcome, one call to action.",
          "One line = one visible action (click, type, drag, toggle, count, send, export). Lead with the verb or place it early, so the motion can land on it. Concrete over abstract: name what the product does, never the abstraction.",
          "On-screen copy is readable in 2 seconds and carries the message with the sound off: short headlines, a kinetic key phrase (the verb or outcome) per scene that echoes the voiceover instead of repeating it.",
          "Include exactly one success moment, where the result visibly lands, before the call to action. Voiceover: short sentences (6–14 words), no stage directions; the product name comes after a short opener in the closing line.",
          "Match the copy's tone to the motion style: clean = calm and assured, kinetic = terse and energetic, editorial = crafted and story-led. Use the product's own terms and the exact product name throughout.",
          "Respect every maxLength exactly. Never invent statistics, percentages, customer names, sources, or claims the brief does not support. Never use: magic, revolutionary, seamless, game-changing."
        ].join(" "),
        tools: [fillTool(template, audio, includeMotionStyle)],
        tool_choice: { type: "tool", name: FILL_TOOL },
        messages
      }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(`Claude planning request failed (${response.status})${detail.error?.message ? `: ${detail.error.message}` : "."}`);
    }
    return await response.json() as ClaudeResponse;
  }
}
