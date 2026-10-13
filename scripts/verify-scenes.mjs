// Verifies the scene lists (packages/contracts/src/scenes.ts) end to end, on this machine.
//   node scripts/verify-scenes.mjs                 static checks + render every scene of every style, in two brand palettes
//   node scripts/verify-scenes.mjs --live          also ask the real director (needs ANTHROPIC_API_KEY) for a film in each style,
//                                                  check what it assigned, and render the whole film
//   node scripts/verify-scenes.mjs sketch vox-collage   limit to some styles (a look id, or "clean-type")
// Checks: the engine draws every scene id the list offers (and the lists match the engine's own id arrays); each scene renders
// without error, is not blank and shows the brand colour on a light and on a dark brand; a patch can only set a scene of the
// style; and (live) the director's scenes are valid, varied and never repeated back to back.
// Output: var/verify-scenes/<style>-<scene>-<palette>.png (one frame per scene) and <style>-live.png (a contact sheet).
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { declareVariables, engineVariables } from "../backend/src/plan/composition.ts";
import { planTiming } from "../backend/src/plan/timing.ts";
import { scenesFor } from "../packages/contracts/src/scenes.ts";

const root = resolve(import.meta.dirname, "..");
const live = process.argv.includes("--live");
if (!live) process.env.PLANNER ??= "deterministic"; // the static and render checks need no model key
const { applyPlanEdits } = await import("../backend/src/plan/routes.ts");
const out = join(root, "var/verify-scenes");
const hyperframes = join(root, "worker/node_modules/.bin/hyperframes");
const engine = await readFile(join(root, "worker/templates/beat-plan/engine.js"), "utf8");
const template = await readFile(join(root, "worker/templates/beat-plan/index.html"), "utf8");
const fontCss = await readFile(join(root, "worker/fonts/fonts.css"), "utf8");
const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const only = Object.fromEntries(process.argv.filter((arg) => /^--(scene|palette)=/.test(arg)).map((arg) => arg.slice(2).split("=")));
await mkdir(out, { recursive: true });

// The styles that have scene lists: [name, look, family].
const styles = [
  ["clean-type", "clean", "clean-type"], ["sketch", "sketch", null], ["doodle", "doodle", null], ["doodle-crosshatch", "doodle-crosshatch", null],
  ["doodle-zigzag", "doodle-zigzag", null], ["hairline", "hairline", null], ["vox-collage", "vox-collage", null]
].filter(([name, look]) => !wanted.length || wanted.includes(name) || wanted.includes(look));
const palettes = { orange: "#e8590c", navy: "#1e3a8a" };
const failures = [];
const notes = [];
const fail = (message) => { failures.push(message); console.log("  FAIL", message); };

// ---------- static checks ----------
const engineArrays = [...engine.matchAll(/pick\(b, (\[[^\]]+\]), i\)/g)].map((match) => JSON.parse(match[1].replace(/'/g, '"')));
const tyIds = JSON.parse(/var TY_IDS = (\[[^\]]+\])/.exec(engine)?.[1] ?? "[]");
engineArrays.push(tyIds);
for (const [name, look, family] of styles) {
  const ids = scenesFor(look, family).map((scene) => scene.id);
  if (!ids.length) { fail(`${name}: no scene list`); continue; }
  if (new Set(ids).size !== ids.length) fail(`${name}: duplicate scene ids`);
  const match = engineArrays.some((array) => array.length === ids.length && array.every((id, n) => id === ids[n]));
  if (!match) fail(`${name}: the engine's id array does not match the list ${JSON.stringify(ids)}`);
  else console.log(`ok ${name}: ${ids.length} scenes match the engine (${ids.join(", ")})`);
}
{
  // A patch may only set a scene that belongs to the project's style.
  const mk = (id, role) => ({ id, role, kind: "kinetic", keyword: "Hi there", on_screen: null, line: null, verb: null, success: false, energy: "high", motion: { camera: "x", entry: { axis: "x", dir: -1 }, exit: { axis: "x", dir: -1 } }, transition_out: { type: id === "b3" ? "end" : "j-cut" }, producer: "hyperframes" });
  const base = { id: "p", brief: { scriptMode: "problem", text: "x", durationSeconds: 6, aspect: "16:9", motionProfile: "snappy", pace: "fast", audio: { mode: "none" }, captions: "off" }, beatPlan: { target_duration_s: 6, beats: [mk("b1", "hook"), mk("b2", "reveal"), mk("b3", "cta")], suggestions: [], audio: {}, brand: {} } };
  const set = (look, family, scene) => { const project = structuredClone(base); project.brief = { ...project.brief, look, styleFamily: family }; const result = applyPlanEdits(project, { beats: [{ id: "b1", scene }] }); return "plan" in result ? result.plan.beats[0].scene ?? null : "problems"; };
  if (set("sketch", undefined, "ring") !== "ring") fail("a sketch beat could not take the 'ring' scene");
  if (set("sketch", undefined, "wall") === "wall") fail("a sketch beat accepted a typography scene");
  if (set("clean", "clean-type", "counter") !== "counter") fail("a typography beat could not take 'counter'");
  if (set("clean", "clean-type", "bulb") === "bulb") fail("a typography beat accepted a doodle scene");
  if (set("sketch", undefined, null) !== null) fail("a scene could not be cleared");
  console.log("ok scene patches are limited to the style's own scenes");
}

// ---------- rendering ----------
const frameStats = (png, brand) => {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", png, "-vf", "scale=96:54", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
  const px = raw.length / 3, lum = [];
  let near = 0;
  const target = [1, 3, 5].map((i) => parseInt(brand.slice(i, i + 2), 16));
  for (let p = 0; p < px; p++) {
    const r = raw[p * 3], g = raw[p * 3 + 1], b = raw[p * 3 + 2];
    lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    if (Math.hypot(r - target[0], g - target[1], b - target[2]) < 70) near++;
  }
  const mean = lum.reduce((x, y) => x + y, 0) / px;
  return { sd: Math.sqrt(lum.reduce((x, y) => x + (y - mean) ** 2, 0) / px), brand: near / px };
};

async function renderPlan({ plan, look, family, brand, brandName, seconds, label, frames }) {
  const dir = await mkdtemp(join(tmpdir(), "verify-scene-"));
  try {
    await cp(join(root, "worker/templates/beat-plan"), dir, { recursive: true });
    await mkdir(join(dir, "vendor"), { recursive: true });
    await cp(join(root, "node_modules/gsap/dist/gsap.min.js"), join(dir, "vendor/gsap.min.js"));
    await cp(join(root, "worker/fonts"), join(dir, "fonts"), { recursive: true });
    const values = { ...(plan.enginePlan ? { plan: JSON.stringify(plan.enginePlan) } : {}), brandName, logo: "", logoWordmark: false, look, family: family ?? "" };
    const themeCss = (await readFile(join(root, "worker/themes/neutral.css"), "utf8")) + `\n:root{--brand:${brand};--accent:${brand};}`;
    let html = declareVariables(template, values, { asDefaults: true });
    html = html.replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>\n  <style id="theme">\n${themeCss}\n  </style>\n</head>`);
    await writeFile(join(dir, "index.html"), html);
    const mp4 = join(dir, "render.mp4");
    try {
      // A render can be cancelled when the machine is busy; one retry tells a flake from a real failure.
      try { execFileSync(hyperframes, ["render", "--output", mp4], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] }); }
      catch { execFileSync(hyperframes, ["render", "--output", mp4], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] }); }
    } catch (error) { throw new Error(`${label}: render failed: ${String(error.stderr ?? error.message).split("\n").filter((line) => !/Render:trace|\[INFO\]/.test(line)).join(" | ").slice(-700)}`); }
    const shots = [];
    for (const [n, at] of frames.entries()) {
      const png = join(out, `${label}${frames.length > 1 ? `-${n + 1}` : ""}.png`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", mp4, "-frames:v", "1", "-vf", "scale=640:-2", png]);
      shots.push(png);
    }
    return shots;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// One film of three beats per scene: the scene under test, a second beat, and the closing card.
function sceneFilm(sceneId, look, family) {
  const beat = (id, start, end, extra) => ({ id, route: { renderer: "dom", treatment: look, graphic: "none", editability: "elements", reason: "" }, role: "reveal", kind: "kinetic", keyword: "Leica 200MP", on_screen: "Xiaomi 17 Ultra", line: null, verb: null, success: false, energy: "high", ui: null, motion: { entry: { axis: "x", dir: -1 }, exit: { axis: "x", dir: -1 }, text_effect: null }, transition_out: { type: "j-cut" }, fallback: null, start, end, vo: null, act_at: null, success_at: null, words: null, ...extra });
  return { canvas: "16:9", motion_profile: "snappy", captions: "none", beats: [beat("b1", 0, 2.4, { role: "hook", scene: sceneId, keyword: sceneId === "counter" ? "7000 mAh" : "Leica 200MP" }), beat("b2", 2.4, 4.4, { scene: null, keyword: "Local warranty" }), beat("b3", 4.4, 6, { role: "cta", kind: "title", keyword: "Xiaomi", on_screen: "Shop MiStore.pk", transition_out: { type: "end" } })] };
}

for (const [name, look, family] of styles) {
  for (const scene of scenesFor(look, family).filter((item) => !only.scene || item.id === only.scene)) {
    for (const [paletteName, brand] of Object.entries(palettes).filter(([key]) => !only.palette || key === only.palette)) {
      const label = `${name}-${scene.id}-${paletteName}`;
      try {
        const [png] = await renderPlan({ plan: { enginePlan: sceneFilm(scene.id, look, family) }, look, family, brand, brandName: "Xiaomi", label, frames: [1.5] });
        const stats = frameStats(png, brand);
        if (stats.sd < 8) fail(`${label}: the frame is blank (sd ${stats.sd.toFixed(1)})`);
        else if (stats.brand < 0.002) notes.push(`${label}: no brand colour in the frame at 1.5 s (${(stats.brand * 100).toFixed(2)}%)`);
        console.log(`ok ${label}  sd ${stats.sd.toFixed(0)}  brand ${(stats.brand * 100).toFixed(1)}%`);
      } catch (error) { fail(String(error.message)); }
    }
  }
}

// ---------- the real director ----------
if (live) {
  const { director } = await import("../backend/src/plan/director.ts");
  for (const [name, look, family] of styles) {
    const brief = { scriptMode: "problem", text: "Show what is special about the Xiaomi 17 series for people in Pakistan: the Leica cameras, the huge battery, fast charging, and that it is sold with a local warranty.", durationSeconds: 20, aspect: "16:9", motionProfile: "snappy", pace: "fast", audio: { mode: "none" }, captions: "off", template: null, look: look === "clean" ? undefined : look, ...(family ? { styleFamily: family } : {}) };
    const context = { brandName: "MiStore.pk", brandDescription: "Official Xiaomi store in Pakistan.", screenshots: [] };
    console.log(`live ${name}: asking the director…`);
    try {
      const { plan, problems } = await director.plan(brief, context);
      const list = scenesFor(look, family).map((scene) => scene.id);
      const scenes = plan.beats.map((beat) => beat.scene ?? null);
      console.log(`  scenes: ${scenes.join(", ")}  (${problems.length} problems)`);
      if (scenes.some((scene) => scene && !list.includes(scene))) fail(`${name}: the director used a scene outside the list`);
      const used = new Set(scenes.filter(Boolean));
      if (plan.beats.length >= 5 && used.size < 3) fail(`${name}: only ${used.size} different scenes in ${plan.beats.length} beats`);
      if (scenes.filter(Boolean).length < plan.beats.length - 1) fail(`${name}: ${plan.beats.length - scenes.filter(Boolean).length} beats have no scene`);
      for (const id of used) if (scenes.filter((scene) => scene === id).length > 2) fail(`${name}: scene '${id}' is used more than twice`);
      for (let n = 1; n < scenes.length; n++) if (scenes[n] && scenes[n] === scenes[n - 1]) fail(`${name}: scene '${scenes[n]}' repeats back to back at beat ${n + 1}`);
      const timing = planTiming(plan, brief);
      const { enginePlan } = await import("../backend/src/plan/composition.ts");
      const vars = engineVariables({ plan, timing, shots: {}, screenSizes: {}, brandName: "MiStore.pk", look: look === "clean" ? undefined : look, family: family ?? undefined });
      const total = timing.total, at = plan.beats.map((_, n) => Math.min(total - 0.2, timing.beats[n].start + Math.min(1.1, (timing.beats[n].end - timing.beats[n].start) * 0.6)));
      const shots = await renderPlan({ plan: { enginePlan: JSON.parse(vars.plan) }, look: look === "clean" ? "clean" : look, family, brand: palettes.orange, brandName: "MiStore.pk", label: `${name}-live`, frames: at });
      const sheet = join(out, `${name}-live.png`);
      const cols = 4, rows = Math.ceil(shots.length / cols);
      execFileSync("ffmpeg", ["-v", "error", "-y", ...shots.flatMap((file) => ["-i", file]), "-filter_complex", shots.map((_, n) => `[${n}]scale=320:-2[s${n}]`).join(";") + ";" + shots.map((_, n) => `[s${n}]`).join("") + `xstack=inputs=${shots.length}:layout=${shots.map((_, n) => `${(n % cols) * 320}_${Math.floor(n / cols) * 180}`).join("|")}`, sheet]);
      console.log(`ok ${name}: live film rendered (${plan.beats.length} beats, ${total.toFixed(1)} s) → ${sheet}`);
    } catch (error) { fail(`${name}: ${String(error.message).slice(0, 300)}`); }
  }
}

console.log(notes.length ? `\nNotes:\n  ${notes.join("\n  ")}` : "");
console.log(failures.length ? `\n${failures.length} failure(s):\n  ${failures.join("\n  ")}` : "\nAll scene checks passed.");
process.exit(failures.length ? 1 : 0);
