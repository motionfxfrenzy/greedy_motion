import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { ensureMedia } from "../media.ts";
import { planAudioDir } from "./audio.ts";
import type { AudioTrack } from "./sound.ts";

const run = promisify(execFile);

/** The beat of a piece of music: tempo, and when the first beat lands (seconds from the start of the file). */
export type BeatGrid = { bpm: number; offset: number; confidence: number };

const SAMPLE_RATE = 11025;

/** Linear interpolation of a series at a fractional index (0 outside it). */
const at = (series: Float64Array, index: number) => {
  if (index < 0 || index >= series.length - 1) return 0;
  const i = Math.floor(index), f = index - i;
  return series[i]! * (1 - f) + series[i + 1]! * f;
};

/**
 * Finds the tempo and the beat phase of music from its samples (mono, -1..1): an onset curve (how fast the loudness rises),
 * the tempo whose spacing lines the onsets up best (70 to 180 BPM), then the phase where a grid of that spacing hits the most onsets.
 * Returns null for silence, or music with no steady beat (low confidence), so nothing pulses to a beat that is not there.
 */
export function detectBeatGrid(pcm: ArrayLike<number>, sampleRate = SAMPLE_RATE): BeatGrid | null {
  const hop = Math.max(1, Math.round(sampleRate * 0.0116));
  const hopSec = hop / sampleRate;
  const frames = Math.floor(pcm.length / hop);
  if (frames < 120) return null;

  const loud = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let j = 0; j < hop; j++) { const v = pcm[i * hop + j]!; sum += v * v; }
    loud[i] = Math.log(1 + 1000 * (sum / hop));
  }
  const rise = new Float64Array(frames);
  for (let i = 1; i < frames; i++) rise[i] = Math.max(0, loud[i]! - loud[i - 1]!);
  // Keep what stands out from its surroundings.
  const onset = new Float64Array(frames);
  const window = 24;
  let running = 0;
  for (let i = 0; i < frames; i++) {
    running += rise[i]!;
    if (i >= window) running -= rise[i - window]!;
    const mean = running / Math.min(i + 1, window);
    onset[i] = Math.max(0, rise[i]! - mean * 1.2);
  }
  let total = 0;
  for (let i = 0; i < frames; i++) total += onset[i]!;
  if (total < 1e-6) return null;

  const scores: { bpm: number; score: number }[] = [];
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = 60 / bpm / hopSec;
    let first = 0, second = 0;
    const span = frames - Math.ceil(lag * 2) - 1;
    if (span < 10) continue;
    for (let i = 0; i < span; i++) { const o = onset[i]!; if (o === 0) continue; first += o * at(onset, i + lag); second += o * at(onset, i + 2 * lag); }
    scores.push({ bpm, score: (first + 0.5 * second) / span });
  }
  if (scores.length === 0) return null;
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  const mean = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const confidence = mean > 0 ? best.score / mean : 0;
  if (confidence < 1.5) return null;

  // Refine the tempo against the beat grid itself: a tempo that is a fraction of a BPM off drifts across a whole song, so each nearby
  // tempo gets its best phase and the pair that hits the most onsets wins.
  let bestBpm = best.bpm, bestPhase = 0, bestHit = -1;
  for (let bpm = best.bpm - 0.6; bpm <= best.bpm + 0.6001; bpm += 0.02) {
    const period = 60 / bpm / hopSec;
    for (let phase = 0; phase < period; phase += 1) {
      let hit = 0, n = 0;
      for (let k = phase; k < frames - 1; k += period) { hit += at(onset, k); n++; }
      hit /= Math.max(1, n);
      if (hit > bestHit) { bestHit = hit; bestBpm = bpm; bestPhase = phase; }
    }
  }
  const period = 60 / bestBpm / hopSec;
  let fineHit = -1, fine = bestPhase;
  for (let phase = bestPhase - 1; phase <= bestPhase + 1; phase += 0.1) {
    let hit = 0;
    for (let k = phase; k < frames - 1; k += period) if (k >= 0) hit += at(onset, k);
    if (hit > fineHit) { fineHit = hit; fine = phase; }
  }
  // The first beat is the first grid point in the file (a phase can sit one period late).
  const firstBeat = fine >= 0 ? fine : fine + period;
  return { bpm: +bestBpm.toFixed(2), offset: +(firstBeat * hopSec).toFixed(3), confidence: +confidence.toFixed(2) };
}

/** Decodes a music file (any format ffmpeg reads) and finds its beat. */
export async function beatGridOfFile(path: string): Promise<BeatGrid | null> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-"], { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 });
  const bytes = stdout as unknown as Buffer;
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return detectBeatGrid(samples, SAMPLE_RATE);
}

const cache = new Map<string, BeatGrid | null>();

/** The beat of the film's music bed, or null when there is no music or no steady beat. Cached per file. */
export async function musicBeatGrid(projectId: string, file: string | undefined): Promise<BeatGrid | null> {
  if (!file) return null;
  const key = `${projectId}/${file}`;
  if (cache.has(key)) return cache.get(key)!;
  let grid: BeatGrid | null = null;
  try {
    const path = join(planAudioDir(projectId), file);
    grid = (await ensureMedia(path)) ? await beatGridOfFile(path) : null;
  } catch { grid = null; }
  if (cache.size > 200) cache.clear();
  cache.set(key, grid);
  return grid;
}

/**
 * The beat times on the film clock: for each copy of the music bed in the soundtrack (a short bed loops), the grid starting at that
 * copy's start. Fast music pulses on every other beat. Beats too close together (where two copies overlap) count once.
 */
export function beatTimes(tracks: Pick<AudioTrack, "id" | "start" | "duration" | "mediaStart">[], grid: BeatGrid | null): number[] {
  if (!grid) return [];
  const period = 60 / grid.bpm;
  const every = grid.bpm > 150 ? 2 : 1;
  const times: number[] = [];
  for (const track of tracks.filter((item) => item.id.startsWith("music-bed"))) {
    // A bed whose start is trimmed (mediaStart) or delayed (start) shifts every beat with it.
    const skip = Math.max(0, Math.ceil(((track.mediaStart ?? 0) - grid.offset) / period - 1e-6));
    for (let k = skip; ; k++) {
      const t = track.start + grid.offset + k * period - (track.mediaStart ?? 0);
      if (t >= track.start + track.duration - 0.05) break;
      if (k % every === 0) times.push(+t.toFixed(3));
    }
  }
  times.sort((a, b) => a - b);
  return times.filter((t, i) => i === 0 || t - times[i - 1]! >= 0.12);
}
