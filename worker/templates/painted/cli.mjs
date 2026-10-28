#!/usr/bin/env node
/*
 * Painted short from a script: the whole job in one command.
 *
 *   node cli.mjs --script script.txt --out film.mp4 [--voice Charon] [--look oil] [--format 9:16] [--draw continuous|each] [--width 720] [--spec-only] [--work dir]
 *
 * 1. the director (Claude) splits the script, word for word, into lines and describes each line's pictures in the SPEC.md vocabulary,
 * 2. Gemini speaks every line (one recording per line, so the pictures follow the voice),
 * 3. render.mjs paints the film.
 * --engine gemini makes the whole film with Gemini (script from --topic, director, scene repair, drawings, voice, music): only GEMINI_API_KEY is needed.
 * --topic "..." has the model write the script first. Otherwise needs ANTHROPIC_API_KEY and GEMINI_API_KEY. A finished spec.json (e.g. from the product's director) skips step 1 with --spec.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { directorBrief } from "./brief.mjs";
import { supervise } from "./supervise.mjs";
import { normalize } from "./lint.mjs";
import { resolveCustom } from "./recipe.mjs";
import { review, reviewBatch } from "./check.mjs";
import { ask, askJson, engineName, modelFor, scriptPersona, writeScript } from "./llm.mjs";
import { recordEditEvent, retrieveCameraExemplars } from "./world-db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const has = (n) => { const i = args.indexOf(n); if (i >= 0) args.splice(i, 1); return i >= 0; };
const fixes = []; for (let i; (i = args.indexOf("--fix")) >= 0; ) fixes.push(args.splice(i, 2)[1]);
const peopleStyle = flag("--people"), modeFlag = flag("--mode") ?? flag("--persona"), topic = flag("--topic"), engine = engineName(flag("--engine")), scriptPath = flag("--script"), outPath = flag("--out"), specIn = flag("--spec"), voice = flag("--voice", "Charon"), look = flag("--look", "oil");
const drawFlag = flag("--draw"), styleFlag = flag("--style"), format = flag("--format", "9:16"), width = flag("--width"), workDir = path.resolve(flag("--work", "painted-work")), specOnly = has("--spec-only");
if ((!scriptPath && !specIn && !topic) || (!outPath && !specOnly)) { console.error("usage: node cli.mjs (--script script.txt | --topic <text>) --out film.mp4 [--engine gemini|claude] [--people lit|silhouette] [--voice Charon] [--look oil] [--format 9:16] [--width 720] [--spec-only] [--work dir] | --spec spec.json"); process.exit(2); }
fs.mkdirSync(path.join(workDir, "tts"), { recursive: true });

const DIRECTOR = modelFor(engine);
const TTS_MODEL = process.env.PAINTED_TTS_MODEL || "gemini-3.8-flash-tts";

async function direct(script) {
  const exemplars = retrieveCameraExemplars(script);
  const learnedBlock = exemplars.length ? `\n\n# Verified camera exemplars from user-approved films\n${exemplars.map((e) => `- Line: "${e.say}" -> ${JSON.stringify(e.shots)}`).join("\n")}` : "";
  const system = directorBrief() + learnedBlock;
  if (process.env.PAINTED_SAVE_BRIEF) fs.writeFileSync(path.join(workDir, "director-brief.txt"), `MODEL: ${DIRECTOR}\n\n=== SYSTEM ===\n${system}\n\n=== USER ===\nFormat: ${format}\nLook: ${look}\n\nScript:\n${script}\n`);
  return askJson({ engine, what: "director", system, user: `Format: ${format}\nLook: ${look}\n\nScript:\n${script}` });
}

const words = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
function checkVerbatim(script, spec) {
  const a = words(script).join(" "), b = words(spec.lines.map((l) => l.say).join(" ")).join(" ");
  if (a !== b) throw new Error("Director changed the script's words; refusing to continue (run again).");
}

async function speak(text, file) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ model: TTS_MODEL, input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: "Warm, steady storytelling delivery with a calm, unhurried pace." }] }] }], response_format: { type: "audio", mime_type: "audio/wav" }, generation_config: { speech_config: [{ voice }] }, store: false })
  });
  if (!res.ok) throw new Error(`Gemini TTS failed (${res.status})`);
  const p = await res.json();
  const part = (p.steps ?? []).filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).find((c) => c.type === "audio");
  if (p.status !== "completed" || !part?.data) throw new Error("Gemini TTS returned no audio.");
  fs.writeFileSync(file, Buffer.from(part.data, "base64"));
}

let spec;
if (specIn) spec = JSON.parse(fs.readFileSync(specIn, "utf8"));
else {
  let script;
  if (topic) { const persona = scriptPersona(topic, modeFlag); script = await writeScript(topic, engine, { mode: persona }); fs.writeFileSync(path.join(workDir, "script.txt"), script + "\n"); console.log(`· script by ${engine} (${persona}, ${script.split("\n").length} lines)`); }
  else script = fs.readFileSync(scriptPath, "utf8").trim();
  for (let attempt = 1; ; attempt++) { try { spec = await direct(script); checkVerbatim(script, spec); break; } catch (e) { if (attempt >= 3) throw e; console.error(`director attempt ${attempt}: ${e.message}`); } }
}
spec.look ??= look; spec.format ??= format;
// --style doodle[:marker|flat|pencil|...] draws the film as a hand drawing (the first look of each doodle is "marker"); captions sit in a box, and the opening is drawn in.
// --draw continuous|each: a doodle film is one continuous scene drawn once at the start (the default), or every shot draws itself in again at each transition (spec.drawIn "opening" | "each")
if (drawFlag) spec.drawIn = { continuous: "opening", each: "each" }[drawFlag] ?? spec.drawIn;
if (styleFlag) { const [st, dd] = styleFlag.split(":"); spec.style = st; if (st === "doodle") { spec.doodle = dd || "marker"; spec.drawIn ??= "opening"; spec.captions ??= { style: "box", y: 0.76 }; } }
if (peopleStyle) spec.people = peopleStyle;
// Fix one scene without touching the others: "--fix '8: they should be inside the house'" rewrites only line 8's shots from the instruction.
for (const fix of fixes) {
  const m = /^\s*(\d+)\s*:\s*(.+)$/s.exec(fix); if (!m || !spec.lines[Number(m[1])]) { console.error(`--fix "${fix}": expected "<line number>: <what to change>"`); process.exit(2); }
  const li = Number(m[1]), vocab = directorBrief().split("# Example")[0];
  const brief = spec.lines.map((l, i) => `${i}${i === li ? " (THE ONE TO FIX)" : ""}: "${l.say}" -> ${JSON.stringify((l.shots ?? []).map(({ place, time, weather, ground, subjects, props }) => ({ place, time, weather, ground, subjects, props })))}`).join("\n");
  const shots = await askJson({ engine, maxTokens: 4000, system: `You repair ONE scene of a painted short film. The spec vocabulary:\n\n${vocab}\n\nOutput ONLY a JSON array of 1-3 replacement shots for the scene to fix (same shape as the shots shown), keeping people, clothes and the weather/time continuity of the scenes around it. No prose, no code fence.`, user: `Story objects: ${JSON.stringify(spec.objects ?? {})}\n\nThe film, line by line:\n${brief}\n\nFix scene ${li}: ${m[2]}` });
  if (!Array.isArray(shots) || !shots.length) throw new Error("Fix returned no shots.");
  const before = structuredClone(spec.lines[li].shots ?? []);
  spec.lines[li].shots = shots;
  const learned = recordEditEvent({ engine: spec.style || spec.look || "doodle", say: spec.lines[li].say, scene: spec.lines[li].scene, instruction: m[2], shotsBefore: before, shotsAfter: shots });
  console.log(`· scene ${li} rewritten (${shots.length} shot${shots.length > 1 ? "s" : ""}): ${m[2]} [${learned.classification}]`);
}
fs.writeFileSync(path.join(workDir, "spec.raw.json"), JSON.stringify(spec, null, 1));
if (spec.lines?.some((l) => l.scene)) fs.writeFileSync(path.join(workDir, "scenes.txt"), spec.lines.map((l, i) => `${i}. "${l.say}"\n   ${l.scene ?? "(no scene written)"}`).join("\n\n") + "\n");
// The supervisor reads the director's spec against the script and fixes relationships (who is where, which room, what the weather can touch...). Only on a fresh direction, once; --no-supervise skips it.
const needsSupervise = (s) => !(s.lines ?? []).every((l) => l.scene && (l.shots ?? []).length && (l.shots ?? []).every((sh) => sh.place && ((sh.subjects ?? []).length + (sh.props ?? []).length > 0)));
if (!specIn && !has("--no-supervise") && (has("--supervise") || needsSupervise(spec))) {
  try { const r = await supervise({ spec, script: fs.readFileSync(scriptPath ?? path.join(workDir, "script.txt"), "utf8").trim(), engine, ask: askJson }); for (const n of r.notes) console.log("· " + n); console.log(`· supervisor: ${r.applied} fix${r.applied === 1 ? "" : "es"} of ${r.asked} asked`); fs.writeFileSync(path.join(workDir, "supervisor-notes.txt"), r.notes.join("\n") + "\n"); }
  catch (e) { console.error("supervisor skipped: " + e.message); }
}
{ const lint = normalize(spec); for (const n of lint.notes) console.log("· lint " + n); Object.assign(spec, lint.spec); }
await resolveCustom(spec, { cacheDir: path.join(workDir, "recipes"), apiKey: process.env.GEMINI_API_KEY, reviewBatch: has("--no-check") ? undefined : (items) => reviewBatch(items, { engine, look }) });
console.log(`· ${spec.lines.length} lines, ${spec.lines.reduce((n, l) => n + (l.shots?.length ?? 1), 0)} shots`);
fs.writeFileSync(path.join(workDir, "spec.json"), JSON.stringify(spec, null, 1));
if (specOnly) { console.log("✓ " + path.join(workDir, "spec.json")); process.exit(0); }

spec.audio ??= {};
const makeMusic = async () => {
  if (specIn && spec.audio.music && fs.existsSync(path.resolve(workDir, spec.audio.music))) return;
  const secs = Math.ceil(spec.lines.reduce((n, l) => n + (l.shots?.length ?? 1) * 3, 0) + 6);
  const model = secs <= 28 ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
  const base = (mood) => `Instrumental background music for a ${secs}-second narrated short film. ${mood.replace(/\.$/, "")}. It sits under a narrator: no vocals, no lead melody in the voice range, no big drops. Starts immediately, lifts gently toward the final third, ends on a soft resolved chord.`.slice(0, 600);
  // Lyria sometimes refuses a prompt without saying why (storm and danger words do it). Ladder: the director's mood as written, then the same mood with
  // close allowed words in place of the risky ones, then the director's model rewriting it in gentler musical terms, then a safe default.
  const SYNONYMS = [[/\bthunder(ing)?\b/gi, "deep rolling"], [/\bstorm(y|s)?\b/gi, "swelling"], [/\blightning\b/gi, "bright flashes"], [/\btension\b/gi, "anticipation"], [/\btense\b/gi, "expectant"], [/\bdrums?\b/gi, "low percussion"], [/\bdanger(ous)?\b/gi, "uncertainty"], [/\bdark(er|ness)?\b/gi, "shadowed"], [/\b(fear|scary|menacing|ominous)\b/gi, "mysterious"], [/\b(violent|fierce|furious|raging)\b/gi, "powerful"], [/\b(war|battle|fight)\b/gi, "struggle"], [/\b(death|dying|grief)\b/gi, "farewell"], [/\bdry\b/gi, "sparse"]];
  const soften = (m) => SYNONYMS.reduce((t, [re, to]) => t.replace(re, to), m);
  async function rewrite(m) {
    return ask({ engine, maxTokens: 300, timeoutMs: 60_000, model: engine === "claude" ? "claude-sonnet-5-5" : undefined, user: `A music generator refused this description for an unstated policy reason:\n\n"${m}"\n\nRewrite it as ONE sentence of musical direction with the same instruments, emotional arc and tempo, using only gentle, neutral musical vocabulary (no weather, danger, conflict, violence or darkness words; synonyms such as "swelling", "deep rolling", "anticipation", "low percussion" are fine). Output only the sentence.` });
  }
  const mood0 = spec.audio.mood || "gentle, warm, cinematic", soft = soften(mood0);
  const ladder = [() => base(mood0), soft !== mood0 ? () => base(soft) : null, async () => base(await rewrite(mood0)), () => base("Warm acoustic guitar and soft strings, slow and hopeful, gentle and cinematic")].filter(Boolean);
  const file = path.join(workDir, "music.wav");
  for (const make of ladder) {
    if ([file, file.replace(".wav", ".mp3")].some((f) => fs.existsSync(f))) break;
    try {
      const prompt = await make();
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(240_000), body: JSON.stringify({ model, input: prompt, store: false }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(`Lyria failed (${res.status})${d.error?.message ? ": " + d.error.message.slice(0, 120) : ""}`); }
      const p = await res.json();
      const part = [...(p.steps ?? []).flatMap((s) => s.content ?? []), ...(p.outputs ?? [])].find((x) => x.type === "audio" && x.data);
      if (!part) throw new Error("Lyria returned no audio");
      const bytes = Buffer.from(part.data, "base64");
      fs.writeFileSync(bytes.toString("ascii", 0, 4) === "RIFF" ? file : file.replace(".wav", ".mp3"), bytes);
      console.log("· music prompt: " + prompt.slice(66, 200));
    } catch (e) { console.error("music: " + e.message + " (trying closer-but-allowed words)"); }
  }
  const got = [file, file.replace(".wav", ".mp3")].find((f) => fs.existsSync(f));
  if (got) spec.audio.music = path.relative(workDir, got);
  console.log(got ? `· music ready (${model})` : "· no music");
};
const makeVoices = async () => {
  let done = 0, next = 0; const n = spec.lines.length, par = Number(process.env.PAINTED_TTS_PARALLEL) || 4;
  await Promise.all(Array.from({ length: Math.min(par, n) }, async () => {
    for (let i = next++; i < n; i = next++) {
      const rel = `tts/${String(i).padStart(2, "0")}.wav`, file = path.join(workDir, rel), line = spec.lines[i];
      if (!line.audio?.file && !(line.audio?.seconds > 0)) { if (!fs.existsSync(file)) await speak(line.say, file); line.audio = { file: rel }; }
      process.stdout.write(`\r· voice ${++done}/${n}`);
    }
  }));
  process.stdout.write("\n");
};
await Promise.all([makeMusic(), makeVoices()]);
fs.writeFileSync(path.join(workDir, "spec.json"), JSON.stringify(spec, null, 1));
const r = spawnSync("node", [path.join(here, "render.mjs"), path.join(workDir, "spec.json"), outPath, ...(width ? ["--width", width] : [])], { stdio: "inherit" });
process.exit(r.status ?? 1);
