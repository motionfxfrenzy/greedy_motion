#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const OUT_DIR = join(REPO_ROOT, "frontend/test/fixtures/hf");

const { FIXTURE_HF_PROJECT } = await import("../../frontend/test/fixtures/hf/data.ts");
const { planPreviewHtml, projectTiming } = await import("../../backend/src/plan/preview.ts");
const { beatTimes } = await import("../../backend/src/plan/timing.ts");
const { audioStatus } = await import("../../backend/src/plan/audio.ts");
const { textValues } = await import("../../backend/src/plan/composition.ts");
const { planReadiness } = await import("../../backend/src/plan/readiness.ts");
const { BEAT_LIMITS } = await import("../../packages/contracts/src/index.ts");

function makeSilentWav(seconds = 3.5, sampleRate = 8000) {
  const numSamples = Math.max(1, Math.round(seconds * sampleRate));
  const dataSize = numSamples; // 8-bit unsigned mono
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  buf.fill(128, 44); // 128 is silence in 8-bit unsigned PCM
  return buf;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Strip scriptFrames if any so planPreviewHtml builds the beat-plan composition engine HTML directly
  const projectForHtml = {
    ...FIXTURE_HF_PROJECT,
    brief: FIXTURE_HF_PROJECT.brief
      ? { ...FIXTURE_HF_PROJECT.brief, scriptBeats: undefined }
      : undefined
  };

  const html = await planPreviewHtml(projectForHtml);
  const timing = projectTiming(FIXTURE_HF_PROJECT);
  if (!timing || !FIXTURE_HF_PROJECT.beatPlan) {
    throw new Error("Could not compute timing for FIXTURE_HF_PROJECT");
  }
  const times = beatTimes(timing);
  const beats = FIXTURE_HF_PROJECT.beatPlan.beats;

  const compositionMeta = {
    engine: "beat-plan",
    baseUrl: `/v1/preview/plans/${FIXTURE_HF_PROJECT.id}`,
    canvas: FIXTURE_HF_PROJECT.beatPlan.canvas,
    durationSeconds: timing.total,
    variables: textValues(beats),
    beatTimes: Object.fromEntries(beats.map((b) => [b.id, times[b.id]])),
    audio: audioStatus(FIXTURE_HF_PROJECT),
    readiness: planReadiness(FIXTURE_HF_PROJECT),
    slots: beats.flatMap((beat) => [
      { id: `${beat.id}.keyword`, beat: beat.id, budget: { chars: BEAT_LIMITS.keywordChars, words: BEAT_LIMITS.keywordWords } },
      { id: `${beat.id}.on_screen`, beat: beat.id, budget: { chars: BEAT_LIMITS.onScreenChars } },
      { id: `${beat.id}.line`, beat: beat.id, budget: { words: BEAT_LIMITS.lineWords } }
    ])
  };

  await writeFile(join(OUT_DIR, "composition.html"), html, "utf8");
  await writeFile(join(OUT_DIR, "composition.json"), JSON.stringify(compositionMeta, null, 2) + "\n", "utf8");
  await writeFile(join(OUT_DIR, "silent.wav"), makeSilentWav(3.5, 8000));

  console.log(`Wrote composition.html (${html.length} chars), composition.json, and silent.wav to ${OUT_DIR}`);
  console.log("Beat times:", JSON.stringify(compositionMeta.beatTimes));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
