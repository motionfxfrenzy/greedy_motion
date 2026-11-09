// Audio options: background music (Google Lyria) and voiceover (Gemini TTS), both via GEMINI_API_KEY.

export type AudioOptions = { music: boolean; voiceover: boolean; voice?: string };

/** Prebuilt Gemini TTS voices offered in the UI. */
export const voices = [
  { id: "Kore", label: "Kore", character: "Firm, confident" },
  { id: "Puck", label: "Puck", character: "Upbeat, friendly" },
  { id: "Charon", label: "Charon", character: "Calm, informative" },
  { id: "Aoede", label: "Aoede", character: "Warm, breezy" },
  { id: "Fenrir", label: "Fenrir", character: "Energetic, bold" },
  { id: "Leda", label: "Leda", character: "Youthful, bright" },
  { id: "Sulafat", label: "Sulafat", character: "Warm, storytelling" },
  { id: "Zephyr", label: "Zephyr", character: "Bright, clear" },
  { id: "Orus", label: "Orus", character: "Steady, assured" },
  { id: "Achird", label: "Achird", character: "Friendly, approachable" },
  { id: "Despina", label: "Despina", character: "Smooth, warm" },
  { id: "Algieba", label: "Algieba", character: "Smooth, polished" },
  { id: "Callirrhoe", label: "Callirrhoe", character: "Easygoing, relaxed" },
  { id: "Autonoe", label: "Autonoe", character: "Bright, expressive" },
  { id: "Enceladus", label: "Enceladus", character: "Soft, breathy" },
  { id: "Iapetus", label: "Iapetus", character: "Clear, articulate" },
  { id: "Umbriel", label: "Umbriel", character: "Easygoing, smooth" },
  { id: "Erinome", label: "Erinome", character: "Clear, poised" },
  { id: "Algenib", label: "Algenib", character: "Deep, textured" },
  { id: "Gacrux", label: "Gacrux", character: "Mature, resonant" },
  { id: "Achernar", label: "Achernar", character: "Soft, gentle" },
  { id: "Vindemiatrix", label: "Vindemiatrix", character: "Gentle, kind" },
  { id: "Sadaltager", label: "Sadaltager", character: "Knowledgeable, calm" },
  { id: "Schedar", label: "Schedar", character: "Even, balanced" }
] as const;
export const voiceIds: string[] = voices.map((voice) => voice.id);
export const defaultVoice = "Kore";

/**
 * Who speaks the film: one narrator, or a narrator plus the story's characters, each in a voice of its own. With
 * characters the script names the speaker of every voiced line (the narrator when none is named).
 */
export const voiceCasts = ["narrator", "characters"] as const;
export type VoiceCast = (typeof voiceCasts)[number];
export const NARRATOR = "Narrator";
/** At most this many speaking characters besides the narrator: more become hard to tell apart with six voices. */
export const CAST_MAX = 4;
export const SPEAKER_MAX = 24;
const speakerKey = (name: string) => name.trim().toLowerCase();
/** The narrator: no speaker, or one named "Narrator". */
export const isNarrator = (speaker: string | null | undefined) => !speaker || speakerKey(speaker) === speakerKey(NARRATOR);
/**
 * The voice a line is spoken in: the narrator's for narration; for a character, the person's pick, else a stable pick
 * (from the name) among the other voices, so the same character always sounds the same and never like the narrator.
 */
export function voiceForSpeaker(speaker: string | null | undefined, narratorVoice: string, picks?: Record<string, string> | null): string {
  if (isNarrator(speaker)) return narratorVoice;
  const chosen = picks ? Object.entries(picks).find(([name]) => speakerKey(name) === speakerKey(speaker!))?.[1] : undefined;
  if (chosen && voiceIds.includes(chosen)) return chosen;
  const others = voiceIds.filter((id) => id !== narratorVoice);
  let hash = 0;
  for (const char of speakerKey(speaker!)) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return others[hash % others.length] ?? narratorVoice;
}
/** The speaking characters of a script, in order of first line, without the narrator. */
export const castOf = (beats: readonly { speaker?: string | null; line?: string | null }[]): string[] => {
  const seen = new Map<string, string>();
  for (const beat of beats) if (beat.line && !isNarrator(beat.speaker) && !seen.has(speakerKey(beat.speaker!))) seen.set(speakerKey(beat.speaker!), beat.speaker!.trim());
  return [...seen.values()];
};

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
