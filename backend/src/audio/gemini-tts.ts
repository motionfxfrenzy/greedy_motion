// Voiceover from Gemini TTS (same request shape as HyperFrames' media-use gemini-tts.mjs).
// gemini-3.8 TTS models return WAV directly; delivery is steered with a style annotation.
import { voiceIds } from "@videosaas/contracts";
import { wavDuration } from "./wav.ts";

export const TTS_MODEL = "gemini-3.8-flash-tts";

export async function synthesizeVoiceover(apiKey: string, { text, voice, style }: { text: string; voice: string; style?: string }) {
  if (!voiceIds.includes(voice)) throw new Error(`Unknown voice "${voice}".`);
  const content: Record<string, unknown> = { type: "text", text };
  if (style) content.annotations = [{ type: "speech_metadata", style }];
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: TTS_MODEL,
      input: [{ type: "user_input", content: [content] }],
      response_format: { type: "audio", mime_type: "audio/wav" },
      generation_config: { speech_config: [{ voice }] },
      store: false
    })
  });
  if (!response.ok) {
    // Never echo the key: only status and the API's own message.
    const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Gemini TTS failed (${response.status})${detail.error?.message ? `: ${detail.error.message}` : "."}`);
  }
  const payload = (await response.json()) as { status?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }> };
  if (payload.status !== "completed") throw new Error(`Gemini TTS did not complete (${payload.status ?? "no status"}).`);
  const audio = (payload.steps ?? []).filter((step) => step.type === "model_output").flatMap((step) => step.content ?? []).filter((part) => part.type === "audio");
  if (audio.length !== 1 || !audio[0].data || audio[0].mime_type !== "audio/wav") throw new Error("Gemini TTS returned no WAV audio.");
  const wav = Buffer.from(audio[0].data, "base64");
  return { wav, seconds: wavDuration(wav) };
}
