import { anthropicMessage } from "../anthropic.ts";
import { MUSIC_PROMPT_MAX, NARRATION_MAX, templateValueProblems, validateTemplateValues, type AudioOptions, type BrandKit, type PlannerInfo, type RenderRequest, type Template } from "@videosaas/contracts";
import { config } from "../config.ts";
import { callModel, type ModelMessage } from "../models/providers.ts";
import { routeFor, routeHasKey, type Provider, type Route } from "../models/routes.ts";
import { planFromValues, requireTemplate, type Plan, type PromptPlanner, type ReviewRevision } from "./planner.ts";

type ContentBlock = { type?: string; id?: string; name?: string; input?: unknown };
type ClaudeResponse = { content?: ContentBlock[]; stop_reason?: string };

const FILL_TOOL = "fill_template";

// Mirrors .claude/skills/gm-skill-authoring/references/script-for-motion.md (the single source of truth for scripts); keep them in step.
const SYSTEM_RULES = [
  "You write scripts for short SaaS product motion videos. Write beats, not paragraphs: every line must give the animation one visible thing to show.",
  "Open with a hook in the first 3 seconds: the viewer's pain or the outcome, never \"Introducing…\" or a logo-first line. One problem, one outcome, one call to action.",
  "One line = one visible action (click, type, drag, toggle, count, send, export). Lead with the verb or place it early, so the motion can land on it. Concrete over abstract: name what the product does, never the abstraction.",
  "On-screen copy is readable in 2 seconds and carries the message with the sound off: short headlines, a kinetic key phrase (the verb or outcome) per scene that echoes the voiceover instead of repeating it.",
  "Write voiceover for the ear: no colons, parentheses or slashes, acronyms written as they are said, and one short sentence per item in a list of more than three. The last scene must work as a poster frame: product name and call to action readable.",
  "Include exactly one success moment, where the result visibly lands, before the call to action. Voiceover: short sentences (6–14 words), no stage directions; the product name comes after a short opener in the closing line.",
  "Match the copy's tone to the motion style: clean = calm and assured, kinetic = terse and energetic, editorial = crafted and story-led. Use the product's own terms and the exact product name throughout.",
  "Respect every maxLength exactly. Never invent statistics, percentages, customer names, sources, or claims the brief does not support. Never use: magic, revolutionary, seamless, game-changing."
].join(" ");

/**
 * JSON schema generated from the template catalog, so the model can only return the template's own slots,
 * within their length limits. Media slots ("never") are excluded entirely.
 */
export function fillSchema(template: Template, audio?: AudioOptions, includeMotionStyle = false) {
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
  return { properties, required };
}

function fillTool(template: Template, audio?: AudioOptions, includeMotionStyle = false) {
  const { properties, required } = fillSchema(template, audio, includeMotionStyle);
  return {
    name: FILL_TOOL,
    description: `Fill the "${template.name}" video template (${template.durationSeconds} seconds).`,
    input_schema: { type: "object", properties, required }
  };
}

function parseJsonSlotObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const candidate = firstBrace >= 0 && lastBrace >= firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Checks that every required "write" variable is present with a usable value before falling back to template defaults. */
function missingRequiredProblems(template: Template, input: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const variable of template.variables) {
    if (variable.aiFill !== "write") continue;
    const val = input[variable.id];
    if (val === undefined || val === null || (typeof val === "string" && !val.trim())) {
      missing.push(`${variable.id}: required field is missing or empty`);
    }
  }
  return missing;
}

export class AnthropicPromptPlanner implements PromptPlanner {
  private readonly httpRequest: typeof fetch;
  private readonly explicitOptions: { provider?: Provider; model?: string };
  constructor(request = fetch, options: { provider?: Provider; model?: string } = {}) {
    this.httpRequest = request;
    this.explicitOptions = options;
  }

  private resolveRoute(): Route {
    const base = routeFor("planner");
    if (!this.explicitOptions.provider && !this.explicitOptions.model) return base;
    const provider: Provider =
      this.explicitOptions.provider ??
      (this.explicitOptions.model
        ? this.explicitOptions.model.startsWith("gemini")
          ? "gemini"
          : "anthropic"
        : base.provider);
    const model =
      this.explicitOptions.model ??
      (this.explicitOptions.provider && this.explicitOptions.provider !== base.provider
        ? this.explicitOptions.provider === "gemini"
          ? "gemini-3.8-flash"
          : config.anthropicModel
        : base.model);
    return {
      ...base,
      provider,
      model,
      ...(provider !== base.provider ? { effort: undefined } : {}),
      explicit: true
    };
  }

  get info(): PlannerInfo {
    const route = this.resolveRoute();
    return { provider: route.provider, model: route.model };
  }

  async plan(request: RenderRequest, brand?: BrandKit, revision?: ReviewRevision): Promise<Plan> {
    const template = requireTemplate(request.template);
    const scenes = template.scenes.map((scene) => `- ${scene.label} (${scene.duration}s): ${scene.variables.join(", ")}`).join("\n");
    const revisionContext = revision ? `\n\nCurrent approved script:\n${revision.script.lines.map((line, index) => `${index + 1}. ${line.label}: ${line.onScreen}`).join("\n")}\n\nTimestamped review requests to apply:\n${revision.comments.map((comment) => `- ${comment.timestampSeconds.toFixed(1)}s: ${comment.body}`).join("\n")}\n\nRevise the template copy to address every request that is supported by the brief. Preserve any approved facts and do not invent claims. Return the complete revised template, not only changed fields.` : "";
    const userPrompt = `Template: ${template.name} — ${template.description}\nScenes:\n${scenes}\n\nMotion style: ${request.style}. Format: ${request.format}.${brand ? `\n\nBrand: ${brand.name}${brand.url ? ` (${brand.url})` : ""}.${brand.description ? ` About: ${brand.description}` : ""} Use exactly this product name.` : ""}\n\nBrief: ${request.prompt}${revisionContext}`;

    const route = this.resolveRoute();
    if (route.provider !== "anthropic") {
      return this.planStructured(route, template, userPrompt, request, revision);
    }

    const messages: object[] = [{
      role: "user",
      content: userPrompt
    }];

    // One bounded repair attempt (Architecture §11): if limits are broken, return the exact problems and ask again.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const payload = await this.requestAnthropic(route, template, messages, request.audio, Boolean(revision));
      const toolUse = payload.content?.find((block) => block.type === "tool_use" && block.name === FILL_TOOL);
      if ((!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) && attempt === 1) {
        messages.push({ role: "assistant", content: payload.content ?? [{ type: "text", text: "(no answer)" }] }, { role: "user", content: `Call ${FILL_TOOL} now with every field. Do not reply with text.` });
        continue;
      }
      if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
        throw new Error(`Claude did not fill the template (stop reason: ${payload.stop_reason ?? "unknown"}).`);
      }
      const input = toolUse.input as Record<string, unknown>;
      const checked = this.checkInput(template, input, request, revision, "Claude");
      if ("plan" in checked) return checked.plan;
      if (attempt === 2) throw new Error(`Claude's copy still breaks the template limits: ${checked.problems.join("; ")}.`);
      messages.push(
        { role: "assistant", content: payload.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: `Fix these and call ${FILL_TOOL} again with every field:\n- ${checked.problems.join("\n- ")}` }] }
      );
    }
    throw new Error("Planning failed.");
  }

  private checkInput(
    template: Template,
    input: Record<string, unknown>,
    request: RenderRequest,
    revision: ReviewRevision | undefined,
    providerLabel: string
  ): { plan: Plan } | { problems: string[] } {
    const problems = [
      ...missingRequiredProblems(template, input),
      ...templateValueProblems(template, input)
    ];
    const narration = typeof input.narration === "string" ? input.narration.trim().replace(/\s+/g, " ") : "";
    const musicPrompt = typeof input.musicPrompt === "string" ? input.musicPrompt.trim().replace(/\s+/g, " ") : "";
    const motionStyle = input.motionStyle === "clean" || input.motionStyle === "kinetic" || input.motionStyle === "editorial" ? input.motionStyle : request.style;
    if (request.audio?.voiceover && (!narration || narration.length > NARRATION_MAX)) problems.push(`narration: ${narration.length} characters, must be 1–${NARRATION_MAX}`);
    if (request.audio?.music && (!musicPrompt || musicPrompt.length > MUSIC_PROMPT_MAX)) problems.push(`musicPrompt: ${musicPrompt.length} characters, must be 1–${MUSIC_PROMPT_MAX}`);
    if (revision && input.motionStyle !== "clean" && input.motionStyle !== "kinetic" && input.motionStyle !== "editorial") {
      problems.push(`motionStyle: must be "clean", "kinetic", or "editorial"`);
    }
    if (problems.length === 0) {
      const result = validateTemplateValues(template, input);
      if ("error" in result) throw new Error(`${providerLabel} returned invalid copy: ${result.error}`);
      return {
        plan: {
          ...planFromValues(template, result.values),
          ...(narration ? { narration } : {}),
          ...(musicPrompt ? { musicPrompt } : {}),
          ...(revision ? { motionStyle } : {})
        }
      };
    }
    return { problems };
  }

  private async planStructured(
    route: Route,
    template: Template,
    userPrompt: string,
    request: RenderRequest,
    revision?: ReviewRevision
  ): Promise<Plan> {
    const providerLabel = route.provider === "gemini" ? "Gemini" : "The planner model";
    if (route.provider === "gemini" && !config.geminiApiKey && !(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
      throw new Error("GEMINI_API_KEY is not configured on the backend.");
    }
    if (route.provider === "openai-compatible" && !routeHasKey("planner")) {
      throw new Error("OPENAI_COMPATIBLE_API_KEY is not configured on the backend.");
    }

    const { properties, required } = fillSchema(template, request.audio, Boolean(revision));
    const schema: Record<string, unknown> = {
      type: "object",
      additionalProperties: false,
      properties,
      required
    };

    const messages: ModelMessage[] = [{ role: "user", content: userPrompt }];
    const maxTokens = Math.max(route.maxTokens, 2048);

    // One bounded repair attempt (Architecture §11): if JSON is malformed/truncated/empty or limits are broken, ask once more.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await callModel({
        step: "planner",
        route,
        maxTokens,
        system: [{ text: `${SYSTEM_RULES} Return only a JSON object matching the schema for the "${template.name}" template (${template.durationSeconds} seconds).`, cache: true }],
        messages,
        schema,
        request: this.httpRequest,
        timeoutMs: 60_000,
        errorPrefix: `${providerLabel} planning request failed`,
        includeErrorDetail: true,
        stopErrors: {
          refusal: `${providerLabel} declined to fill the template.`
        }
      });

      const parsed = result.stopReason === "max_tokens" ? null : parseJsonSlotObject(result.text);
      if (!parsed) {
        if (attempt === 1) {
          const reason = result.stopReason === "max_tokens" ? "was cut off before finishing the JSON object" : "was not a valid JSON object";
          messages.push(
            { role: "assistant", content: result.text || "(empty response)" },
            { role: "user", content: `Your previous response ${reason}. Return only the complete JSON object with every required field (${required.join(", ")}) within its character limits.` }
          );
          continue;
        }
        throw new Error(`${providerLabel} did not fill the template (stop reason: ${result.stopReason}).`);
      }

      const checked = this.checkInput(template, parsed, request, revision, providerLabel);
      if ("plan" in checked) return checked.plan;
      if (attempt === 2) {
        throw new Error(`${providerLabel}'s copy still breaks the template limits: ${checked.problems.join("; ")}.`);
      }
      messages.push(
        { role: "assistant", content: result.text },
        { role: "user", content: `Fix these and return the complete JSON object again with every required field:\n- ${checked.problems.join("\n- ")}` }
      );
    }
    throw new Error("Planning failed.");
  }

  private async requestAnthropic(route: Route, template: Template, messages: object[], audio?: AudioOptions, includeMotionStyle = false): Promise<ClaudeResponse> {
    const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured on the backend.");
    const payload = await anthropicMessage({
        model: route.model,
        max_tokens: route.maxTokens,
        system: `${SYSTEM_RULES} Always answer by calling the ${FILL_TOOL} tool.`,
        tools: [fillTool(template, audio, includeMotionStyle)],
        // Newer models reject a forced tool choice, so the tool is asked for in the prompt and a missing call is retried once.
        tool_choice: { type: "auto" },
        messages

    }, { request: this.httpRequest, timeoutMs: 60000, errorPrefix: "Claude planning request failed", includeErrorDetail: true, stopErrors: {} });
    return payload as ClaudeResponse;
  }
}
