// The script, written before the storyboard: scene by scene, in words a person can read and edit like a document.
// It is fast (one short call, no motion direction) so the person sees something to correct within seconds; the
// storyboard is then built from the script they approved, in their own words (scriptMode "own").
import { beatCountRange, beatRoles, formatForDuration, paceWpm, sceneDirection, wordBudget, type ProjectScript, type ProjectScriptLine, type ScriptBrief, type VideoType } from "@videosaas/contracts";
import { llmJson, type LlmProvider } from "../llm.ts";
import { PLAYBOOKS, playbookBlock } from "../skills/playbooks.ts";
import { contextBlocks, screenshotBlock, resolveVideoType, type DirectorContext } from "./director.ts";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "video_type", "scenes"],
  properties: {
    title: { type: "string" },
    video_type: { type: "string", enum: ["explainer", "tutorial", "demo", "promo", "story", "data"] },
    scenes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["role", "voiceover", "on_screen", "visual", "screenshot_index"],
        properties: {
          role: { type: "string", enum: [...beatRoles] },
          voiceover: { type: "string" },
          on_screen: { type: "string" },
          visual: { type: "string" },
          screenshot_index: { anyOf: [{ type: "integer" }, { type: "null" }] }
        }
      }
    }
  }
} as const;

const SYSTEM = [
  "You write the script for a short video, scene by scene, before any storyboard exists. The person will read it like a document and edit it, so it must read well on a page and sound natural spoken.",
  "Follow the VIDEO TYPE playbook you are given: its purpose, its shape (roles in order), its rules and whether it ends on a call to action.",
  "For each scene write: role (from the playbook's shape), voiceover (the exact words spoken; written for the ear: no colons, parentheses, slashes; acronyms as they are said; at most 24 words), on_screen (the one to three words or the number shown large; no sentences), visual (one plain sentence on what the viewer SEES while it is said: the picture must show what the voice says, never decorate it), screenshot_index (the uploaded screenshot shown in this scene, or null).",
  "Narration adds a layer the picture does not. Use the person's own facts; never invent statistics, names, prices or claims. Never use: magic, revolutionary, seamless, game-changing.",
  "Every uploaded screenshot must appear in at least one scene, in the scene whose voiceover is about what that screenshot shows; the visual sentence names the part of the screen the voice refers to.",
  "title: a working title of at most six words. video_type: the playbook you followed."
].join("\n");

export function scriptMessage(brief: ScriptBrief, context: DirectorContext): string {
  const range = beatCountRange(brief.durationSeconds, brief.pace, brief.styleFamily);
  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  return [
    `PROBLEM / BRIEF:\n${brief.text}`,
    `Product: ${context.brandName}${context.brandDescription ? ` — ${context.brandDescription}` : ""}${brief.audience ? `\nAudience: ${brief.audience}` : ""}`,
    `Length: ${brief.durationSeconds}s (${formatForDuration(brief.durationSeconds)}), pace ${brief.pace} (~${paceWpm[brief.pace]} wpm). Scenes: ${range.min}-${range.max}.${voiced ? ` Total voiceover about ${wordBudget(brief.durationSeconds, brief.pace)} words at most.` : " No voiceover: leave voiceover empty and let on_screen carry the story."}`,
    ...contextBlocks(brief, context),
    ...(sceneDirection(brief.look, brief.styleFamily) ? [sceneDirection(brief.look, brief.styleFamily)] : []),
    context.screenshots.length ? screenshotBlock(context.screenshots) : "Screenshots: none uploaded (screenshot_index is always null)."
  ].join("\n");
}

export type ScriptDraft = { script: ProjectScript; model: string; ms: number };

const modelOf = (): { provider: LlmProvider; model: string } => {
  const provider: LlmProvider = process.env.SCRIPT_PROVIDER === "gemini" ? "gemini" : "anthropic";
  return { provider, model: process.env.SCRIPT_MODEL ?? (provider === "gemini" ? "gemini-3.1-pro-preview" : "claude-sonnet-5-5") };
};

type RawScene = { role: string; voiceover: string; on_screen: string; visual: string; screenshot_index: number | null };
const titleCase = (role: string) => role[0]!.toUpperCase() + role.slice(1);

function toScript(raw: { title: string; video_type: VideoType; scenes: RawScene[] }, context: DirectorContext, source: ProjectScript["source"]): ProjectScript {
  const lines: ProjectScriptLine[] = raw.scenes.slice(0, 12).map((scene) => {
    const shot = scene.screenshot_index !== null && scene.screenshot_index >= 0 ? context.screenshots[scene.screenshot_index] : undefined;
    return {
      label: titleCase(scene.role).slice(0, 32), role: scene.role,
      onScreen: (scene.on_screen || scene.voiceover || scene.role).trim().slice(0, 180),
      ...(scene.voiceover.trim() ? { voiceover: scene.voiceover.trim().slice(0, 240) } : {}),
      ...(scene.visual.trim() ? { visual: scene.visual.trim().slice(0, 240) } : {}),
      screenshotId: shot?.id ?? null
    };
  });
  return { source, lines, confirmed: false, updatedAt: new Date().toISOString(), title: raw.title.trim().slice(0, 80), videoType: raw.video_type };
}

/** Writes the first draft. */
export async function draftScript(brief: ScriptBrief, context: DirectorContext, signal?: AbortSignal): Promise<ScriptDraft> {
  const { provider, model } = modelOf();
  const result = await llmJson({ provider, model, system: `${SYSTEM}\n\n${playbookBlock(resolveVideoType(brief, context))}`, user: scriptMessage(brief, context), schema: SCHEMA as unknown as Record<string, unknown>, maxTokens: 6000, timeoutMs: 90_000, ...(signal ? { signal } : {}), stopErrors: { refusal: "The script writer declined this brief.", max_tokens: "The script was too long; shorten the duration or the brief." } });
  return { script: toScript(JSON.parse(result.text), context, "generated"), model, ms: result.ms };
}

const REVISE_SYSTEM = [
  SYSTEM,
  "You are now revising a script the person has been editing. Apply their instruction and nothing else: keep every scene, word and screenshot assignment they did not ask to change exactly as it is (the person may have edited the words themselves, so treat the current script as the truth). Return the complete script."
].join("\n");

/** Applies a person's instruction ("make it shorter", "add a scene on pricing") to the script they have been editing. */
export async function reviseScript(script: ProjectScript, instruction: string, brief: ScriptBrief, context: DirectorContext, signal?: AbortSignal): Promise<ScriptDraft> {
  const { provider, model } = modelOf();
  const current = script.lines.map((line, i) => ({ n: i + 1, role: line.role ?? line.label.toLowerCase(), voiceover: line.voiceover ?? "", on_screen: line.onScreen, visual: line.visual ?? "", screenshot_index: line.screenshotId ? context.screenshots.findIndex((shot) => shot.id === line.screenshotId) : null }));
  const user = [scriptMessage(brief, context), `\nCURRENT SCRIPT (the person's edited version):\n${JSON.stringify({ title: script.title ?? "", scenes: current })}`, `\nTHE PERSON ASKS: ${instruction}`].join("\n");
  const result = await llmJson({ provider, model, system: `${REVISE_SYSTEM}\n\n${playbookBlock(resolveVideoType(brief, context))}`, user, schema: SCHEMA as unknown as Record<string, unknown>, maxTokens: 6000, timeoutMs: 90_000, ...(signal ? { signal } : {}) });
  return { script: toScript(JSON.parse(result.text), context, "generated"), model, ms: result.ms };
}

/** The script as the plain text the storyboard step reads in "own script" mode: the voiceover lines, one per scene. */
export const scriptText = (script: ProjectScript) => script.lines.map((line) => line.voiceover).filter(Boolean).join("\n");
export { PLAYBOOKS };
