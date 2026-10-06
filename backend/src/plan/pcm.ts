import { pcmToWav } from "../audio/wav.ts";

/**
 * 16-bit PCM WAV helpers for the plan's voiceover takes: read, trim the silence a TTS model
 * leaves around a line (so the measured length is the spoken length), and join takes with gaps
 * for one transcription pass. Pure Buffer work: the backend image has no ffmpeg.
 */
export type Pcm = { sampleRate: number; channels: number; data: Buffer };

export function readWav(wav: Buffer): Pcm {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file.");
  let offset = 12;
  let format: { sampleRate: number; channels: number; bits: number; tag: number } | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") format = { tag: wav.readUInt16LE(offset + 8), channels: wav.readUInt16LE(offset + 10), sampleRate: wav.readUInt32LE(offset + 12), bits: wav.readUInt16LE(offset + 22) };
    if (id === "data") {
      if (!format || format.bits !== 16 || (format.tag !== 1 && format.tag !== 0xfffe)) throw new Error("Only 16-bit PCM WAV is supported.");
      const end = Math.min(wav.length, offset + 8 + size);
      return { sampleRate: format.sampleRate, channels: format.channels, data: wav.subarray(offset + 8, end - ((end - offset - 8) % (2 * format.channels))) };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk.");
}

export const pcmSeconds = (pcm: Pcm) => pcm.data.length / (2 * pcm.channels * pcm.sampleRate);

export const writeWav = (pcm: Pcm) => pcmToWav(pcm.data, pcm.sampleRate, pcm.channels);

/**
 * Cuts leading and trailing silence. A 10 ms window counts as sound when its peak is within
 * 40 dB of the take's loudest peak (and above -50 dBFS); a little room is kept either side so
 * soft onsets and fricative tails ("s", "f") are not clipped.
 */
export function trimSilence(pcm: Pcm, { headPad = 0.06, tailPad = 0.09 } = {}): Pcm {
  const frameBytes = 2 * pcm.channels;
  const frames = pcm.data.length / frameBytes;
  const window = Math.max(1, Math.round(pcm.sampleRate * 0.01));
  const peaks: number[] = [];
  let loudest = 0;
  for (let start = 0; start < frames; start += window) {
    let peak = 0;
    for (let f = start; f < Math.min(frames, start + window); f++) {
      for (let c = 0; c < pcm.channels; c++) peak = Math.max(peak, Math.abs(pcm.data.readInt16LE(f * frameBytes + c * 2)));
    }
    peaks.push(peak);
    loudest = Math.max(loudest, peak);
  }
  if (loudest === 0) return pcm;
  const threshold = Math.max(loudest * 10 ** (-40 / 20), 32768 * 10 ** (-50 / 20));
  const first = peaks.findIndex((peak) => peak >= threshold);
  let last = peaks.length - 1;
  while (last > first && peaks[last] < threshold) last--;
  const from = Math.max(0, first * window - Math.round(headPad * pcm.sampleRate));
  const to = Math.min(frames, (last + 1) * window + Math.round(tailPad * pcm.sampleRate));
  return { ...pcm, data: Buffer.from(pcm.data.subarray(from * frameBytes, to * frameBytes)) };
}

/** Joins takes (same rate and channels) with `gap` seconds of silence; returns each take's offset. */
export function joinWithGaps(takes: Pcm[], gap: number): { pcm: Pcm; offsets: number[] } {
  if (!takes.length) throw new Error("Nothing to join.");
  const { sampleRate, channels } = takes[0];
  if (takes.some((take) => take.sampleRate !== sampleRate || take.channels !== channels)) throw new Error("Takes differ in sample rate or channels.");
  const silence = Buffer.alloc(Math.round(gap * sampleRate) * 2 * channels);
  const parts: Buffer[] = [silence];
  const offsets: number[] = [];
  let at = gap;
  for (const take of takes) {
    offsets.push(at);
    parts.push(take.data, silence);
    at += pcmSeconds(take) + gap;
  }
  return { pcm: { sampleRate, channels, data: Buffer.concat(parts) }, offsets };
}
