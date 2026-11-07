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

/**
 * Languages the narration can be spoken in. The model detects the language from the text, so these only tell the writer
 * which language the VOICE lines are in (on-screen words and visual directions stay English). Add a language here once a
 * test take has been heard and its word times checked.
 */
export const voiceLanguages = [
  { id: "en", label: "English", writer: "English" },
  { id: "hi", label: "Hindi (हिन्दी / Roman)", writer: "Hindi" }
] as const;
export type VoiceLanguageId = (typeof voiceLanguages)[number]["id"];
export const voiceLanguageIds: string[] = voiceLanguages.map((language) => language.id);
export const defaultVoiceLanguage: VoiceLanguageId = "en";

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
