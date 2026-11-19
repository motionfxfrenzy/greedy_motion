// Renders a Cutout tales shot list the way the worker's template render job does: the worker's own
// buildProject + stampCutoutTales + addAudio + writeVariables, then `hyperframes render` with the worker's flags.
//   node scripts/cutout-render.mjs <spec.json> <voiceover.wav|-> <out.mp4>
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./cutout-lib.mjs";

const [specPath, voice, out] = process.argv.slice(2);
const id = randomUUID(), audioRoot = join(tmpdir(), `cutout-audio-${id}`), project = join(tmpdir(), `cutout-render-${id}`);
process.env.WORKER_APP_ROOT = join(ROOT, "worker");
process.env.WORKER_AUDIO_ROOT = audioRoot;
const { HYPERFRAMES, addAudio, buildProject, run, stampCutoutTales, writeVariables } = await import("../worker/src/compose.mjs");

const spec = JSON.parse(await readFile(specPath, "utf8"));
await mkdir(project, { recursive: true });
await buildProject(project, { template: "cutout-tales", theme: "neutral" });
const stamped = await stampCutoutTales(project, { spec: JSON.stringify(spec) });
if (voice && voice !== "-") {
  await mkdir(join(audioRoot, id), { recursive: true });
  await cp(voice, join(audioRoot, id, "voiceover.wav"));
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", voice]).toString());
  await addAudio(project, id, { voiceover: { seconds } }, stamped.duration);
}
const variablesFile = await writeVariables(project, { spec: JSON.stringify(spec) });
const started = Date.now();
await run(HYPERFRAMES, ["render", project, "--variables-file", variablesFile, "--strict-variables", "--output", resolve(out), "--fps", "30", "--workers", process.env.HF_WORKERS || "2", "--quality", "standard", "--no-browser-gpu"], { onLine: (l) => process.env.VERBOSE && console.log(l) });
console.log(`rendered ${out} ${stamped.width}x${stamped.height} ${stamped.duration}s in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (!process.env.KEEP) { await rm(project, { recursive: true, force: true }); await rm(audioRoot, { recursive: true, force: true }); } else console.log("project kept at", project);
