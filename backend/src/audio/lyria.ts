// Background music from Google Lyria RealTime (models/lyria-realtime-exp) via the Gemini API.
// Streams 48 kHz 16-bit stereo PCM until the target length is collected, then wraps it as WAV.
// Same model and settings as HyperFrames' media-use lyria-recipe.py.
import { GoogleGenAI, type LiveMusicServerMessage } from "@google/genai";
import { pcmToWav } from "./wav.ts";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;

export type MusicRequest = { prompt: string; seconds: number; bpm?: number; brightness?: number; density?: number };

export async function generateMusic(apiKey: string, { prompt, seconds, bpm = 110, brightness = 0.7, density = 0.5 }: MusicRequest): Promise<Buffer> {
  const client = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
  const target = Math.round(seconds * SAMPLE_RATE) * CHANNELS * 2;
  const chunks: Buffer[] = [];
  let collected = 0;
  let settle!: (value: void) => void;
  let fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject; });

  const session = await client.live.music.connect({
    model: "models/lyria-realtime-exp",
    callbacks: {
      onmessage: (message: LiveMusicServerMessage) => {
        for (const chunk of message.serverContent?.audioChunks ?? []) {
          if (!chunk.data) continue;
          const bytes = Buffer.from(chunk.data, "base64");
          chunks.push(bytes);
          collected += bytes.length;
          if (collected >= target) settle();
        }
        if (message.filteredPrompt) fail(new Error(`The music prompt was filtered: ${message.filteredPrompt.filteredReason ?? "no reason given"}.`));
      },
      onerror: () => fail(new Error("Lyria connection error.")),
      onclose: () => (collected >= target ? settle() : fail(new Error("Lyria closed the stream early.")))
    }
  });
  const timeout = setTimeout(() => fail(new Error("Lyria did not return enough audio in time.")), (seconds + 20) * 1000);
  try {
    await session.setWeightedPrompts({ weightedPrompts: [{ text: prompt, weight: 1 }] });
    await session.setMusicGenerationConfig({ musicGenerationConfig: { bpm, brightness, density, temperature: 1 } });
    session.play();
    await done;
  } finally {
    clearTimeout(timeout);
    try { session.close(); } catch { /* already closed */ }
  }
  return pcmToWav(Buffer.concat(chunks).subarray(0, target), SAMPLE_RATE, CHANNELS);
}
