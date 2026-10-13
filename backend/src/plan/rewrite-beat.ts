import { anthropicMessage, responseText } from "../anthropic.ts";
import { config } from "../config.ts";
import { BEAT_LIMITS, lookDirection, plainText, type Beat, type BeatPlan, type ScriptBrief } from "@videosaas/contracts";

export type BeatRewrite = { keyword: string; on_screen: string | null; line: string | null };

/**
 * Rewrites the words of one frame from the person's instruction, keeping the rest of the film as context.
 * Only text fields change, so timing, motion and look stay as they were.
 */
export async function rewriteBeat(plan: BeatPlan, beat: Beat, instruction: string, brief: ScriptBrief | undefined, signal?: AbortSignal): Promise<BeatRewrite> {
  const voiced = Boolean(beat.line);
  const system = [
    "You rewrite one frame of a short motion-graphics storyboard. Return only JSON: {\"keyword\":string,\"on_screen\":string|null,\"line\":string|null}.",
    `keyword: at most ${BEAT_LIMITS.keywordWords} words and ${BEAT_LIMITS.keywordChars ?? 28} characters, the big words on screen; the last word takes the accent colour.`,
    `on_screen: at most ${BEAT_LIMITS.onScreenChars} characters, or null. line: the voiceover for this frame, at most ${BEAT_LIMITS.lineWords} words${voiced ? "" : "; this frame is silent, so return null"}.`,
    "Plain text only: no markdown, no quotes around the words. Follow the person's instruction; keep the story coherent with the neighbouring frames and do not impose a hook, success or call-to-action shape.",
    brief?.look ? lookDirection(brief.look) : ""
  ].filter(Boolean).join("\n");
  const film = plan.beats.map((item, i) => `${i + 1}${item.id === beat.id ? " (REWRITE THIS)" : ""}: ${item.keyword}${item.on_screen ? ` / ${item.on_screen}` : ""}${item.line ? ` / "${item.line}"` : ""}`).join("\n");
  const payload = await anthropicMessage({
    model: config.anthropicModel, max_tokens: 600, system,
    messages: [{ role: "user", content: `Script brief: ${brief?.text ?? ""}\n\nFilm so far:\n${film}\n\nInstruction for the marked frame: ${instruction}` }]
  }, { ...(signal ? { signal } : {}), timeoutMs: 45000, errorPrefix: "Frame rewrite failed", includeErrorDetail: true });
  const text = responseText(payload);
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let value: Partial<BeatRewrite>;
  try { value = JSON.parse(json); } catch { throw new Error("The rewrite came back unreadable. Try again."); }
  const keyword = plainText(String(value.keyword ?? "")).slice(0, 28).trim();
  if (!keyword) throw new Error("The rewrite came back empty. Try again.");
  return {
    keyword,
    on_screen: value.on_screen ? plainText(String(value.on_screen)).slice(0, BEAT_LIMITS.onScreenChars) : null,
    line: voiced && value.line ? plainText(String(value.line)).slice(0, BEAT_LIMITS.lineChars) : beat.line ?? null
  };
}
