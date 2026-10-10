// Generates a job's audio (Lyria music + Gemini TTS voiceover) into <audioDir>/<jobId>/ for the worker.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AudioOptions, AudioResult } from "@videosaas/contracts";
import { config } from "../config.ts";
import { saveMedia } from "../media.ts";
import { synthesizeVoiceover } from "./gemini-tts.ts";
import { generateMusic } from "./lyria.ts";

/** Voice starts at 0.3 s and must end before the 10 s video does. */
export const VOICE_START = 0.3;
const VOICE_MAX = 9.4;

export type WorkerAudio = { music: boolean; voiceover?: { seconds: number } };

const STYLE_TEMPO: Record<string, { bpm: number; density: number; brightness: number; delivery: string }> = {
  clean: { bpm: 104, density: 0.45, brightness: 0.75, delivery: "clear, confident product-launch narration" },
  kinetic: { bpm: 124, density: 0.65, brightness: 0.8, delivery: "energetic, punchy product-launch narration" },
  editorial: { bpm: 92, density: 0.4, brightness: 0.6, delivery: "warm, considered narration" }
};

export async function produceAudio(jobId: string, options: AudioOptions, plan: { narration?: string; musicPrompt?: string }, style: string): Promise<{ result: AudioResult; worker: WorkerAudio }> {
  if (!config.geminiApiKey) throw new Error("Music and voiceover need GEMINI_API_KEY in backend/.env.");
  const dir = join(config.audioDir, jobId);
  await mkdir(dir, { recursive: true });
  const tempo = STYLE_TEMPO[style] ?? STYLE_TEMPO.clean;

  const music = options.music && plan.musicPrompt
    ? generateMusic(config.geminiApiKey, { prompt: plan.musicPrompt, seconds: 10, bpm: tempo.bpm, density: tempo.density, brightness: tempo.brightness })
      .then((wav) => saveMedia(join(dir, "music.wav"), wav)).then(() => ({ prompt: plan.musicPrompt! }))
    : Promise.resolve(undefined);

  const voice = options.voiceover && plan.narration
    ? (async () => {
        const voiceId = options.voice ?? "Kore";
        let take = await synthesizeVoiceover(config.geminiApiKey, { text: plan.narration!, voice: voiceId, style: tempo.delivery });
        // One retry with a brisker read; never cut speech mid-word.
        if (take.seconds > VOICE_MAX) take = await synthesizeVoiceover(config.geminiApiKey, { text: plan.narration!, voice: voiceId, style: `${tempo.delivery}, brisk fast pace, no pauses` });
        if (take.seconds > VOICE_MAX) throw new Error(`The voiceover runs ${take.seconds.toFixed(1)} s, longer than the video allows. Try a shorter brief.`);
        await saveMedia(join(dir, "voiceover.wav"), take.wav);
        return { text: plan.narration!, voice: voiceId, seconds: Math.round(take.seconds * 100) / 100 };
      })()
    : Promise.resolve(undefined);

  const [musicResult, voiceResult] = await Promise.all([music, voice]);
  return {
    result: { ...(musicResult ? { music: musicResult } : {}), ...(voiceResult ? { voiceover: voiceResult } : {}) },
    worker: { music: Boolean(musicResult), ...(voiceResult ? { voiceover: { seconds: voiceResult.seconds } } : {}) }
  };
}
