import { plainText, type VideoProject } from "@videosaas/contracts";
import { callModel } from "../models/providers.ts";

/** Longest music description the brief keeps (contracts clean(): audio.musicMood). */
export const MUSIC_PROMPT_MAX = 120;

const SYSTEM = [
  "You write a one-line description of background music for a short video, for a music generator.",
  "Describe genre, instruments, energy and how it moves over the film (for example: where it lifts, where it settles), matched to the film you are given: its subject, pace, mood and length.",
  "Instrumental only: never lyrics or vocals. Plain words, no artist or song names, no quotes, no markdown.",
  `Answer with the description only, one sentence of at most ${MUSIC_PROMPT_MAX} characters.`
].join("\n");

/** What the film is, in a few lines, for the suggestion: its idea, look, pace, length, whether a narrator speaks, and the scene names. */
export function musicContext(project: Pick<VideoProject, "brief" | "beatPlan">, seconds: number): string {
  const brief = project.brief;
  const beats = (project.beatPlan?.beats.map((beat) => beat.keyword) ?? brief?.scriptBeats?.map((beat) => beat.keyword) ?? []).filter(Boolean);
  const voiced = project.beatPlan ? project.beatPlan.beats.some((beat) => beat.line?.trim()) : brief?.audio?.mode === "voiceover" || brief?.audio?.mode === "both";
  return [
    `Film idea: ${plainText(brief?.text ?? "").slice(0, 500)}`,
    brief?.look ? `Visual look: ${brief.look}` : "",
    `Pace: ${brief?.pace ?? "balanced"}. Length: about ${Math.round(seconds)} seconds.`,
    voiced ? "A narrator speaks over the music, so keep it under the voice." : "No narrator: the music carries the film.",
    beats.length ? `Scenes in order: ${beats.slice(0, 14).join(", ")}.` : ""
  ].filter(Boolean).join("\n");
}

/** Cleans a model answer into a single line the brief can keep. */
export function cleanMusicPrompt(text: string): string {
  const line = plainText(text.replace(/^["'“”\s]+|["'“”\s]+$/g, "")).replace(/\s+/g, " ").trim();
  if (line.length <= MUSIC_PROMPT_MAX) return line;
  const cut = line.slice(0, MUSIC_PROMPT_MAX);
  const end = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(" "));
  return (end > 60 ? cut.slice(0, end) : cut).replace(/[,\s]+$/, "");
}

/** Suggests a music description for this film. */
export async function suggestMusicPrompt(project: Pick<VideoProject, "brief" | "beatPlan">, seconds: number, signal?: AbortSignal): Promise<string> {
  const { text } = await callModel({
    step: "rewriteBeat", maxTokens: 200, system: SYSTEM,
    messages: [{ role: "user", content: musicContext(project, seconds) }],
    ...(signal ? { signal } : {}), timeoutMs: 30000, errorPrefix: "Music suggestion failed", includeErrorDetail: true
  });
  const prompt = cleanMusicPrompt(text);
  if (!prompt) throw new Error("The suggestion came back empty. Try again.");
  return prompt;
}
