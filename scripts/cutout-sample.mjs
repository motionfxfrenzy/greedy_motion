// Builds the narrated Cutout tales sample: local TTS per sentence (so sentence times are exact), the voiceover track,
// and the resolved shot lists (16:9 + 9:16) via resolveCutoutTimings, the same path the app uses with real voice timings.
//   node scripts/cutout-sample.mjs [outDir]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cutoutSpecProblems, resolveCutoutTimings } from "../packages/contracts/src/cutout-tales.ts";
import { ROOT, TEMPLATE } from "./cutout-lib.mjs";

const out = process.argv[2] ?? join(ROOT, "var/cutout-sample");
mkdirSync(out, { recursive: true });
const { script, draft } = JSON.parse(readFileSync(join(TEMPLATE, "samples/red-mesa.draft.json"), "utf8"));
const hf = join(ROOT, "worker/node_modules/.bin/hyperframes");
const GAP = 0.45, START = 0.3; // START matches worker addAudio (voiceover starts at 0.3s)
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", String(GAP), join(out, "gap.wav")]);
const list = [], sentences = []; let cursor = START;
script.forEach((text, i) => {
  const f = join(out, `s${i}.wav`);
  execFileSync(hf, ["tts", text, "--output", f, "--voice", "am_michael", "--speed", "0.88"], { stdio: "pipe" });
  const d = dur(f);
  sentences.push({ start: Math.round(cursor * 100) / 100, end: Math.round((cursor + d) * 100) / 100, text });
  cursor += d + GAP; list.push(`file '${f}'`, `file '${join(out, "gap.wav")}'`);
});
writeFileSync(join(out, "list.txt"), list.join("\n"));
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(out, "list.txt"), "-ar", "24000", "-ac", "1", join(out, "voiceover.wav")]);
// resolve relative to the voiceover file (it begins at START in the film, so sentence times are already film time)
const voiceSeconds = dur(join(out, "voiceover.wav"));
writeFileSync(join(out, "timings.json"), JSON.stringify({ voiceSeconds, sentences }, null, 1));
for (const aspect of ["16:9", "9:16"]) {
  const r = resolveCutoutTimings({ ...draft, aspect }, sentences);
  if ("error" in r) throw new Error(r.error);
  const problems = cutoutSpecProblems(r.spec); if (problems.length) throw new Error(problems.join("; "));
  writeFileSync(join(out, `spec-${aspect.replace(":", "x")}.json`), JSON.stringify(r.spec, null, 1));
  console.log(aspect, "duration", r.spec.duration, "shots", r.spec.shots.map((s) => `${s.t0}-${s.t1}`).join(" "));
}
