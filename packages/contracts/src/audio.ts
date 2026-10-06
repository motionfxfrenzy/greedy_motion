// Audio options: background music (Google Lyria) and voiceover (Gemini TTS), both via GEMINI_API_KEY.

export type AudioOptions = { music: boolean; voiceover: boolean; voice?: string };

/** Prebuilt Gemini TTS voices offered in the UI. */
export const voices = [
  { id: "Kore", label: "Kore", character: "Firm, confident" },
  { id: "Puck", label: "Puck", character: "Upbeat, friendly" },
  { id: "Charon", label: "Charon", character: "Calm, informative" },
  { id: "Aoede", label: "Aoede", character: "Warm, breezy" },
  { id: "Fenrir", label: "Fenrir", character: "Energetic" },
  { id: "Leda", label: "Leda", character: "Youthful, bright" }
] as const;
export const voiceIds: string[] = voices.map((voice) => voice.id);
export const defaultVoice = "Kore";

/** Narration must fit a 10 s video starting at 0.3 s; ~2.8 words/s means about 20 words. */
export const NARRATION_MAX = 140;
export const MUSIC_PROMPT_MAX = 120;

export type AudioResult = {
  music?: { prompt: string };
  voiceover?: { text: string; voice: string; seconds: number };
};

export function parseAudioOptions(value: unknown): AudioOptions | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.music !== "boolean" || typeof raw.voiceover !== "boolean") return null;
  const voice = raw.voice === undefined ? defaultVoice : raw.voice;
  if (typeof voice !== "string" || !voiceIds.includes(voice)) return null;
  return { music: raw.music, voiceover: raw.voiceover, voice };
}
