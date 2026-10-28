// Story films (worker/templates/painted): a script becomes a narrated hand-drawn film. The backend has already checked the
// look, charged the tokens and (for a comment) named the film it repaints; this module runs the engine's command line in a
// scratch folder, reports its stages, uploads the MP4 and keeps the work folder so one scene can be rewritten later.
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getFile, putFile, uploadOutput } from "./storage.mjs";

const CLI = new URL("../templates/painted/cli.mjs", import.meta.url).pathname;
/** Doodle media the engine draws; keep in sync with packages/contracts/src/painted.ts. */
const DOODLE = new Set(["marker", "flat", "crayon", "pencil", "woodcut", "chalk", "broken", "ballpoint", "charcoal", "cyanotype", "sumie", "pixel", "riso", "scratchboard", "engraving"]);
const OIL = new Set(["oil", "pastel", "watercolor", "ink", "gouache"]);

/** A failure no retry can fix (a bad look, a missing work folder). The worker turns it into a permanent job failure. */
export class PaintedFailure extends Error {}

/** The engine prints one line per step; map the ones that mark a new stage to the stage names the page shows. */
const STAGES = [
  [/script by|^director attempt|supervisor:|· lint /, "directing", 12],
  [/· oracle|· looked at|· drew |sheet/, "objects", 30],
  [/· voice|^voice/, "voice", 55],
  [/music/, "music", 62],
  [/drawings painted|painting|drawing \d+\//, "painting", 72]
];

export async function renderPainted({ id, input, attempt, signal, reporter, run }) {
  const look = String(input.look ?? "");
  const [engine, medium] = look.split(":");
  if (engine === "doodle" ? !DOODLE.has(medium) : engine === "oil" ? !OIL.has(medium) : true) throw new PaintedFailure("This look is not available.");
  const script = String(input.script ?? "").trim();
  if (script.length < 20 && !input.baseJobId) throw new PaintedFailure("The film has no script.");
  if (input.baseJobId && !/^[a-f0-9-]{36}$/i.test(input.baseJobId)) throw new PaintedFailure("The film to repaint is invalid.");

  const scratch = join("/tmp", `painted-${id}-a${attempt}`);
  const work = join(scratch, "work");
  const out = join(scratch, "film.mp4");
  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    reporter.set("directing", 8);

    const args = [CLI, "--out", out, "--work", work, "--width", String(input.width ?? 540), "--format", input.format === "16:9" ? "16:9" : "9:16"];
    if (input.baseJobId) {
      // A comment: take the earlier film's work folder (spec, recipes, voice, music), rewrite the named scenes, paint again.
      const archive = join(scratch, "work.tgz");
      if (!(await getFile(`painted/${input.baseJobId}/work.tgz`, archive))) throw new PaintedFailure("The film to change is no longer stored. Make it again.");
      await run("tar", ["-xzf", archive, "-C", work], { signal });
      args.push("--spec", join(work, "spec.json"));
      for (const fix of input.fixes ?? []) args.push("--fix", `${Number(fix.line)}: ${String(fix.say).replace(/\s+/g, " ").slice(0, 500)}`);
    } else {
      await writeFile(join(scratch, "script.txt"), `${script}\n`);
      args.push("--script", join(scratch, "script.txt"));
    }
    // The look. "doodle:marker" draws a hand drawing; "oil:gouache" is the painted pass (needs a GPU worker).
    if (engine === "doodle") args.push("--style", `doodle:${medium}`, "--draw", input.drawIn === "each" ? "each" : "continuous");
    else args.push("--look", medium);

    let stage = "directing";
    const onLine = (line) => {
      for (const [pattern, name, percent] of STAGES) {
        if (pattern.test(line) && name !== stage) { stage = name; reporter.set(name, percent); break; }
      }
      const frame = /(?:drawing|painting|frame)\s+(\d+)\s*\/\s*(\d+)/i.exec(line);
      if (frame) reporter.set("painting", 72 + Math.round((Number(frame[1]) / Number(frame[2])) * 18));
    };
    await run("node", args, { onLine, signal });
    if (!(await stat(out).catch(() => null))) throw new Error("The engine finished without a film.");

    reporter.set("encoding", 92);
    const key = `renders/${id}/a${attempt}.mp4`;
    await uploadOutput(out, key);
    // Keep the work folder (not the frame cache) under the film's id, so a comment can change one scene later.
    const archive = join(scratch, "keep.tgz");
    await run("tar", ["-czf", archive, "-C", work, "--exclude=frames-cache", "--exclude=frames", "."], { signal });
    await putFile(`painted/${id}/work.tgz`, archive);
    const spec = JSON.parse(await readFile(join(work, "spec.json"), "utf8").catch(() => "{}"));
    const lines = Array.isArray(spec.lines) ? spec.lines.map((line) => String(line.say ?? "")) : [];
    return { url: `/v1/renders/${id}`, format: "mp4", durationSeconds: Number(spec.durationSeconds) || Number(input.durationSeconds) || 60, file: `${id}-a${attempt}.mp4`, key, lines };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
