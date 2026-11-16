// The picture film's scene module, written without a model call: the beat's stills full-frame (cover-fit), hard cuts on the words,
// and a tiny push-in (1.5%) over each still so no frame is dead. Mirrors cut.py: a still lands 2 frames (0.06 s) before its first word.

import { norm, splitStarts } from "./plan.ts";

export const FPS = 30;
/** Frames a cut lands before its first word (cut.py: 0.06 s at 30 fps). */
export const CUT_LEAD_FRAMES = 2;
/** How much a still grows over its time on screen. */
export const PUSH_IN = 0.015;
const SIZES: Record<string, { w: number; h: number }> = { "16:9": { w: 1920, h: 1080 }, "9:16": { w: 1080, h: 1920 }, "1:1": { w: 1080, h: 1080 } };

export type PictureSceneInput = {
  /** Beat index (0-based). */
  index: number;
  /** Scene length in frames. */
  frames: number;
  /** The beat's spoken words, `start` in seconds from the scene start. */
  words: { text: string; start: number }[];
  /** The beat's still names, in order (sceneAssets). */
  assets: string[];
  aspect?: string;
  /** The beat's script line. When given, the stills split on its words exactly as the shot list did; otherwise on the heard words. */
  line?: string | null;
};

/** Seconds of each script token, matched to the heard words in order (a heard word may be "48" where the script says "forty-eight"). */
export function alignTimes(script: readonly string[], heard: readonly { text: string; start: number }[]): (number | undefined)[] {
  const h = heard.map((w) => norm(w.text));
  let j = 0;
  return script.map((token) => {
    const want = norm(token);
    if (!want) return undefined;
    for (let k = j; k < Math.min(h.length, j + 4); k++) if (h[k] === want) { j = k + 1; return heard[k]!.start; }
    return undefined;
  });
}

/** The first frame of each still: 0 for the first, then 2 frames before each still's first word; strictly increasing, inside the scene. */
export function cutFrames(input: Pick<PictureSceneInput, "frames" | "words" | "assets" | "line">): number[] {
  const count = Math.max(1, input.assets.length), frames = Math.max(1, Math.round(input.frames));
  const heard = input.words.filter((w) => w.text.trim() && Number.isFinite(w.start));
  const script = input.line?.trim() ? input.line.trim().split(/\s+/) : heard.map((w) => w.text);
  const starts = splitStarts(script, count);
  const times = input.line?.trim() ? alignTimes(script, heard) : heard.map((w) => w.start);
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    if (k === 0) { out.push(0); continue; }
    const i = starts[k]!;
    // a word the voice did not match: its proportional place among the heard words, else among the frames
    const t = times[i] ?? heard[Math.round((i * heard.length) / Math.max(1, script.length))]?.start;
    let f = t === undefined ? Math.round((k * frames) / count) : Math.round(t * FPS) - CUT_LEAD_FRAMES;
    f = Math.max(out[k - 1]! + 1, Math.min(frames - (count - k), f));
    out.push(f);
  }
  return out;
}

/** The complete scene module for one beat (TypeScript for the plate engine's bundler). Deterministic: same input, same text. */
export function pictureSceneModule(input: PictureSceneInput): string {
  const size = SIZES[input.aspect ?? "9:16"] ?? SIZES["9:16"]!;
  const frames = Math.max(1, Math.round(input.frames));
  const cuts = cutFrames({ ...input, frames });
  const stills = input.assets.length ? input.assets : [];
  const table = stills.map((name, k) => `[${JSON.stringify(name)}, ${cuts[k]}]`).join(", ");
  const images = stills.map((name) => `${JSON.stringify(name)}: ${JSON.stringify(name)}`).join(", ");
  return `// Picture film, beat ${input.index + 1}: ${stills.length} still(s), hard cuts at frames ${cuts.join(", ")} (2 frames before each still's first word), ${PUSH_IN * 100}% push-in per still. Written by packs/picture-film/scene.ts, no model.
import type { Ctx, Env } from "./core";
import type { Film } from "./film";

const W = ${size.w}, H = ${size.h};
const durationFrames = ${frames};
const STILLS: [string, number][] = [${table}];
const PUSH = ${PUSH_IN};

function draw(ctx: Ctx, frame: number, env: Env) {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = "#f4eedb";
  ctx.fillRect(0, 0, W, H);
  let k = 0;
  for (let i = 0; i < STILLS.length; i++) if (frame >= STILLS[i][1]) k = i;
  const still = STILLS[k];
  if (!still) return;
  const end = k + 1 < STILLS.length ? STILLS[k + 1][1] : durationFrames;
  const img = env.image ? env.image(still[0]) : undefined;
  if (!img) return;
  const iw = (img as unknown as { width: number }).width, ih = (img as unknown as { height: number }).height;
  if (!iw || !ih) return;
  const p = Math.min(1, Math.max(0, (frame - still[1]) / Math.max(1, end - still[1])));
  const s = Math.max(W / iw, H / ih) * (1 + PUSH * p);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
}

export const sounds: { kind: string; frame: number }[] = [];

export const film: Film = { meta: { title: ${JSON.stringify(`picture film beat ${input.index + 1}`)}, W: ${size.w}, H: ${size.h}, fps: 30, bpm: 120, durationFrames }, assets: { images: { ${images} } }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };
`;
}
