import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BeatPlan, MotionProfile, Pace, ScriptBrief } from "@videosaas/contracts";
import { wavDuration } from "../audio/wav.ts";

/**
 * The plan's music bed: one Lyria 3 track per film (gemini-tts style request on the Interactions
 * API). Films up to 28 s use a 30 s clip, longer films a full song; the bed is cut to the film's
 * length on the timeline (sound.ts), so a re-timed film reuses the same track. A track is cached by
 * model and prompt, so only a mood change or a much longer film buys a new one.
 */
export const MUSIC_RULES = {
  clipModel: "lyria-3-clip-preview",
  songModel: "lyria-3-pro-preview",
  /** Films up to this length fit a 30 s clip (with room for the fade). */
  clipMaxSeconds: 28,
  /** List prices (ai.google.dev): a clip and a full song. */
  usd: { "lyria-3-clip-preview": 0.04, "lyria-3-pro-preview": 0.08 } as Record<string, number>
} as const;

const PROFILE_FEEL: Record<MotionProfile, string> = {
  snappy: "tight, punchy modern electronic with crisp percussion",
  smooth: "polished, flowing modern electronic with soft pads and a steady pulse",
  springy: "bright, bouncy, playful modern pop-electronic with light plucks"
};

const PACE_BPM: Record<Pace, number> = { calm: 96, balanced: 112, fast: 124 };

/** The Lyria prompt: the director's (or the user's) mood plus the hard constraints every bed needs. */
export function musicPrompt(plan: BeatPlan, brief: Pick<ScriptBrief, "pace" | "audio"> | undefined, seconds: number): string {
  const mood = plan.audio.music?.prompt?.trim() || brief?.audio.musicMood?.trim() || PROFILE_FEEL[plan.brand.motion_profile];
  const bpm = plan.audio.music?.bpm ?? PACE_BPM[brief?.pace ?? "balanced"];
  const voiced = plan.beats.some((beat) => beat.line?.trim());
  return [
    `Instrumental background music for a ${Math.round(seconds)}-second software product video.`,
    `${mood.replace(/\.$/, "")}.`,
    `About ${bpm} BPM, ${PROFILE_FEEL[plan.brand.motion_profile]}.`,
    voiced ? "It sits under a narrator: no vocals, no lead melody in the voice range, no big drops." : "No vocals; a clear, confident lead is fine.",
    "Starts immediately with no long intro, lifts toward the final third, and ends on a clean, resolved final hit."
  ].join(" ").slice(0, 600);
}

/** Duration of an MP3 from its first frame header (Xing/Info frame count when present, else CBR size). */
export function mp3Duration(mp3: Buffer): number {
  let offset = 0;
  if (mp3.toString("ascii", 0, 3) === "ID3") offset = 10 + ((mp3[6] & 0x7f) << 21 | (mp3[7] & 0x7f) << 14 | (mp3[8] & 0x7f) << 7 | (mp3[9] & 0x7f));
  while (offset + 4 < mp3.length && !(mp3[offset] === 0xff && (mp3[offset + 1] & 0xe0) === 0xe0)) offset++;
  if (offset + 4 >= mp3.length) throw new Error("No MP3 frame found.");
  const versionBits = (mp3[offset + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const bitrateIndex = mp3[offset + 2] >> 4;
  const rateIndex = (mp3[offset + 2] >> 2) & 3;
  const mpeg1 = versionBits === 3;
  const bitrates = mpeg1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rates = mpeg1 ? [44100, 48000, 32000] : versionBits === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
  const bitrate = bitrates[bitrateIndex] * 1000;
  const sampleRate = rates[rateIndex];
  if (!bitrate || !sampleRate) throw new Error("Unsupported MP3 header.");
  const samplesPerFrame = mpeg1 ? 1152 : 576;
  const xing = mp3.indexOf("Xing", offset) >= 0 && mp3.indexOf("Xing", offset) < offset + 64 ? mp3.indexOf("Xing", offset) : mp3.indexOf("Info", offset) >= 0 && mp3.indexOf("Info", offset) < offset + 64 ? mp3.indexOf("Info", offset) : -1;
  if (xing >= 0 && (mp3.readUInt32BE(xing + 4) & 1)) return (mp3.readUInt32BE(xing + 8) * samplesPerFrame) / sampleRate;
  return ((mp3.length - offset) * 8) / bitrate;
}

const exists = (path: string) => access(path).then(() => true, () => false);

export type MusicTrack = { model: string; prompt: string; file: string; seconds: number; spentUsd: number };

/** Generates (or reuses) the bed for a film of `seconds`, into `dir/music/`. */
export async function produceMusic(apiKey: string, dir: string, prompt: string, seconds: number): Promise<MusicTrack> {
  const model = seconds <= MUSIC_RULES.clipMaxSeconds ? MUSIC_RULES.clipModel : MUSIC_RULES.songModel;
  const key = createHash("sha256").update(`${model}\u0000${prompt}`).digest("hex").slice(0, 20);
  await mkdir(join(dir, "music"), { recursive: true });
  for (const ext of ["mp3", "wav"]) {
    const file = `music/${key}.${ext}`;
    if (await exists(join(dir, file))) {
      const bytes = await readFile(join(dir, file));
      return { model, prompt, file, seconds: ext === "wav" ? wavDuration(bytes) : mp3Duration(bytes), spentUsd: 0 };
    }
  }
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({ model, input: prompt, store: false })
  });
  if (!response.ok) {
    // Never echo the key: only status and the API's own message.
    const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Lyria failed (${response.status})${detail.error?.message ? `: ${detail.error.message}` : "."}`);
  }
  const payload = (await response.json()) as { steps?: Array<{ content?: Array<{ type?: string; data?: string; mime_type?: string }> }>; outputs?: Array<{ type?: string; data?: string; mime_type?: string }> };
  const parts = [...(payload.steps ?? []).flatMap((step) => step.content ?? []), ...(payload.outputs ?? [])];
  const audio = parts.find((part) => part.type === "audio" && part.data);
  if (!audio?.data) throw new Error("Lyria returned no audio (the prompt may have been filtered).");
  const bytes = Buffer.from(audio.data, "base64");
  const wav = audio.mime_type?.includes("wav") || bytes.toString("ascii", 0, 4) === "RIFF";
  const file = `music/${key}.${wav ? "wav" : "mp3"}`;
  await writeFile(join(dir, file), bytes);
  return { model, prompt, file, seconds: wav ? wavDuration(bytes) : mp3Duration(bytes), spentUsd: MUSIC_RULES.usd[model] ?? 0.08 };
}
