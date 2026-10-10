import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultVoice, paceWpm, voiceIds, voiceText, type Pace, type PlanVoiceLine, type PlanVoiceWord, type VideoProject } from "@videosaas/contracts";
import { synthesizeVoiceover, TTS_MODEL } from "../audio/gemini-tts.ts";
import { joinWithGaps, pcmSeconds, readWav, trimSilence, writeWav, type Pcm } from "./pcm.ts";
import { estimateLineSeconds } from "./timing.ts";
import { readMedia, saveMedia } from "../media.ts";

/**
 * The plan's voiceover: one Gemini TTS take per beat line, so each line is measured on its own and
 * an edit re-voices only that line (takes are cached by text, voice, direction and pace). Every take
 * is trimmed to its spoken length; one Whisper pass over all takes gives word times, which put the
 * cursor's press on the verb and time the captions. Without Whisper (the backend image ships no
 * whisper.cpp) word times are estimated inside the measured length.
 */
export const VOICE_RULES = {
  /** Parallel TTS requests per project. */
  concurrency: 4,
  /** A take this much longer than the pace estimate is read again, briskly, once. */
  retryOver: 1.3,
  /** Silence between takes in the transcription pass. */
  alignGap: 0.6,
  /** List-price estimate for Gemini flash TTS (audio output dominates): USD per second of speech. */
  usdPerSecond: 0.0004
} as const;

const PACE_DELIVERY: Record<Pace, string> = {
  calm: "unhurried and clear, about 130 words per minute",
  balanced: "natural and brisk, about 145 words per minute",
  fast: "fast and punchy, about 160 words per minute, no lingering pauses"
};

export type VoiceSettings = { voice: string; direction: string; pace: Pace };

/** The narrator for a project: the brief's voice, else the plan's, else the request's, else the default. */
export function voiceSettings(project: Pick<VideoProject, "brief" | "beatPlan" | "request">): VoiceSettings {
  const candidates = [project.brief?.audio.voice, project.beatPlan?.audio.voice?.voice, project.request.audio?.voice];
  const voice = candidates.find((id): id is string => typeof id === "string" && voiceIds.includes(id)) ?? defaultVoice;
  const direction = project.beatPlan?.audio.voice?.direction?.trim() || "clear, confident product narration";
  return { voice, direction: direction.slice(0, 200), pace: project.brief?.pace ?? "balanced" };
}

export const takeKey = (settings: VoiceSettings, text: string) =>
  createHash("sha256").update([TTS_MODEL, settings.voice, settings.direction, settings.pace, text].join("\u0000")).digest("hex").slice(0, 20);


const exists = (path: string) => access(path).then(() => true, () => false);

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index]);
    }
  }));
  return out;
}

export type VoiceJob = { beat: string; text: string };
type Take = { beat: string; text: string; file: string; pcm: Pcm; seconds: number; spentSeconds: number };

/** Voices every line (reusing cached takes) into `dir/vo/`. Returns the takes and the speech billed. */
async function voiceTakes(apiKey: string, dir: string, settings: VoiceSettings, jobs: VoiceJob[]): Promise<Take[]> {
  await mkdir(join(dir, "vo"), { recursive: true });
  const style = `${settings.direction}; ${PACE_DELIVERY[settings.pace]}`;
  return pool(jobs, VOICE_RULES.concurrency, async ({ beat, text }) => {
    const file = `vo/${takeKey(settings, text)}.wav`;
    const path = join(dir, file);
    const cached = await readMedia(path);
    if (cached) {
      const pcm = readWav(cached);
      return { beat, text, file, pcm, seconds: pcmSeconds(pcm), spentSeconds: 0 };
    }
    const read = async (extra = "") => {
      const take = await synthesizeVoiceover(apiKey, { text, voice: settings.voice, style: style + extra });
      return { pcm: trimSilence(readWav(take.wav)), billed: take.seconds };
    };
    let take = await read();
    let spent = take.billed;
    const estimate = estimateLineSeconds(text, paceWpm[settings.pace]);
    if (pcmSeconds(take.pcm) > estimate * VOICE_RULES.retryOver && estimate > 1) {
      const brisk = await read(", noticeably brisker, no pauses between phrases");
      spent += brisk.billed;
      if (pcmSeconds(brisk.pcm) < pcmSeconds(take.pcm)) take = brisk;
    }
    await saveMedia(path, writeWav(take.pcm));
    return { beat, text, file, pcm: take.pcm, seconds: pcmSeconds(take.pcm), spentSeconds: spent };
  });
}

// ---------- word alignment ----------

const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");
const tokens = (text: string) => text.split(/\s+/).filter(Boolean);
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Fallback word times: the measured length shared by syllables, with a beat at each comma. */
export function estimateWords(text: string, seconds: number): PlanVoiceWord[] {
  const words = tokens(text);
  const weight = (word: string) => Math.max(1, (bare(word).match(/[aeiouy]+/g) ?? []).length) + (/[,;:—–]$/.test(word) ? 0.8 : 0);
  const total = words.reduce((sum, word) => sum + weight(word), 0) || 1;
  let at = 0;
  return words.map((word) => {
    const span = (seconds * weight(word)) / total;
    const out = { text: word, start: round(at), end: round(at + span * (/[,;:—–]$/.test(word) ? 0.7 : 0.92)) };
    at += span;
    return out;
  });
}

type Heard = { text: string; start: number; end: number };

/**
 * Maps the line's own words onto what Whisper heard (a small edit-distance alignment, so "3" vs
 * "three" or a split hyphenation only costs a gap). Unmatched words are placed between their
 * matched neighbours, in proportion to their length.
 */
export function alignWords(text: string, heard: Heard[], seconds: number): PlanVoiceWord[] {
  const words = tokens(text);
  if (!heard.length) return estimateWords(text, seconds);
  const n = words.length;
  const m = heard.length;
  const score = (a: string, b: string) => {
    const x = bare(a);
    const y = bare(b);
    if (x && x === y) return 2;
    if (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) return 1;
    return -1;
  };
  const dp = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => -(i + j)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = Math.max(dp[i - 1][j - 1] + score(words[i - 1], heard[j - 1].text), dp[i - 1][j] - 1, dp[i][j - 1] - 1);
  const match = new Array<Heard | null>(n).fill(null);
  for (let i = n, j = m; i > 0 && j > 0;) {
    const s = score(words[i - 1], heard[j - 1].text);
    if (dp[i][j] === dp[i - 1][j - 1] + s && s > 0) { match[i - 1] = heard[j - 1]; i--; j--; }
    else if (dp[i][j] === dp[i - 1][j] - 1) i--;
    else j--;
  }
  const out: PlanVoiceWord[] = words.map((word, i) => ({ text: word, start: match[i]?.start ?? NaN, end: match[i]?.end ?? NaN }));
  // Fill the gaps between anchors (or the take's edges) by character length.
  for (let i = 0; i < n;) {
    if (!Number.isNaN(out[i].start)) { i++; continue; }
    let j = i;
    while (j < n && Number.isNaN(out[j].start)) j++;
    const from = i > 0 ? out[i - 1].end : 0;
    const to = j < n ? out[j].start : seconds;
    const chars = out.slice(i, j).reduce((sum, word) => sum + word.text.length + 1, 0);
    let at = from;
    for (let k = i; k < j; k++) {
      const span = (Math.max(0, to - from) * (out[k].text.length + 1)) / chars;
      out[k].start = at;
      out[k].end = at + span * 0.92;
      at += span;
    }
    i = j;
  }
  // Monotonic and inside the take.
  let floor = 0;
  for (const word of out) {
    word.start = round(Math.min(Math.max(word.start, floor), seconds));
    word.end = round(Math.min(Math.max(word.end, word.start + 0.04), seconds));
    floor = word.start;
  }
  return out;
}

const repositoryDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const hyperframesBin = process.env.HYPERFRAMES_BIN ?? resolve(repositoryDir, "worker/node_modules/.bin/hyperframes");

/** One Whisper pass (HyperFrames CLI, small.en) over all takes; null when Whisper is unavailable or fails. */
async function transcribeTakes(takes: Take[]): Promise<Heard[][] | null> {
  if (!takes.length || !(await exists(hyperframesBin))) return null;
  const work = await mkdtemp(join(tmpdir(), "plan-vo-"));
  try {
    const { pcm, offsets } = joinWithGaps(takes.map((take) => take.pcm), VOICE_RULES.alignGap);
    await writeFile(join(work, "all.wav"), writeWav(pcm));
    const timeout = Math.max(30_000, pcmSeconds(pcm) * 4000);
    await new Promise<void>((done, fail) => {
      execFile(hyperframesBin, ["transcribe", join(work, "all.wav"), "--json", "-m", "small.en", "-l", "en", "-d", work], { timeout, maxBuffer: 4 << 20 }, (error) => (error ? fail(error) : done()));
    });
    const heard = JSON.parse(await readFile(join(work, "transcript.json"), "utf8")) as Heard[];
    if (!Array.isArray(heard)) return null;
    const half = VOICE_RULES.alignGap / 2;
    return takes.map((take, i) => heard
      .filter((word) => typeof word.start === "number" && typeof word.end === "number" && (word.start + word.end) / 2 >= offsets[i] - half && (word.start + word.end) / 2 < offsets[i] + take.seconds + half)
      .map((word) => ({ text: String(word.text), start: word.start - offsets[i], end: word.end - offsets[i] })));
  } catch {
    return null;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type VoiceResult = { lines: PlanVoiceLine[]; spentSeconds: number; aligned: "whisper" | "estimate" };

/**
 * Voices and aligns `jobs`. `known` are takes already aligned on the project: a job whose take file
 * and text match one is reused as is (no TTS, no transcription), so re-running after one edit only
 * voices and transcribes the edited line.
 */
export async function produceVoice(apiKey: string, dir: string, settings: VoiceSettings, jobs: VoiceJob[], known: PlanVoiceLine[] = []): Promise<VoiceResult> {
  const reuse = new Map(known.map((line) => [`${line.file}\u0000${line.text}`, line]));
  const clean = jobs.map((job) => ({ beat: job.beat, text: voiceText(job.text) })).filter((job) => job.text);
  const takes = await voiceTakes(apiKey, dir, settings, clean);
  const fresh = takes.filter((take) => !reuse.has(`${take.file}\u0000${take.text}`));
  const heard = await transcribeTakes(fresh);
  const lines = takes.map((take) => {
    const old = reuse.get(`${take.file}\u0000${take.text}`);
    if (old) return { ...old, beat: take.beat };
    const index = fresh.indexOf(take);
    const words = heard ? alignWords(take.text, heard[index], take.seconds) : estimateWords(take.text, take.seconds);
    return { beat: take.beat, text: take.text, file: take.file, seconds: round(take.seconds), words, aligned: heard ? "whisper" : "estimate" } satisfies PlanVoiceLine;
  });
  return { lines, spentSeconds: takes.reduce((sum, take) => sum + take.spentSeconds, 0), aligned: heard || !fresh.length ? "whisper" : "estimate" };
}
