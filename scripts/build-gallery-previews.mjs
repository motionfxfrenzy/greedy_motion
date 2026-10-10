// Renders the 5-second preview of each gallery template on this machine: the real beat-plan engine, the template's
// look and theme, and a short authored plan (scripts/gallery-plans.mjs). No cloud, no model keys, no network.
//   node scripts/build-gallery-previews.mjs [id ...]   render the named templates (default: all with a plan)
// Output: var/gallery-src/<id>.mp4 (muted, looping) and <id>.jpg (poster). Then run scripts/publish-gallery.mjs, which
// content-addresses them, stores them on R2 (or var/gallery locally) and writes the catalog manifest.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { declareVariables } from "../backend/src/plan/composition.ts";
import { galleryTemplates } from "../packages/contracts/src/gallery.ts";
import { getLook } from "../packages/contracts/src/looks.ts";
import { resolveSceneRoute } from "../packages/contracts/src/scene-rendering.ts";
import { useCaseOf } from "../packages/contracts/src/gallery.ts";
import { galleryPlans } from "./gallery-plans.mjs";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "var/gallery-src");
const hyperframes = join(root, "worker/node_modules/.bin/hyperframes");
const template = await readFile(join(root, "worker/templates/beat-plan/index.html"), "utf8");
const wanted = process.argv.slice(2);
await mkdir(out, { recursive: true });

const v = (axis, dir) => ({ axis, dir });
const entries = [v("x", -1), v("y", -1), v("x", 1), v("y", 1)];

/**
 * Fills the engine's beat fields from the short authored form, and routes each scene the way the product does
 * (resolveSceneRoute): sketch and doodle draw full-frame seeded hand-drawn SVG, hairline draws vector plates, and clean
 * kinetic scenes get a procedural Canvas layer behind the type. A card-style UI scene (text on one side, a screen on the
 * other) is kept only where the template is a product demo; elsewhere the beat becomes a full-frame kinetic one.
 */
function beat(spec, index, count, item) {
  const last = index === count - 1;
  const demo = useCaseOf(item) === "saas";
  // A drawn look (sketch, doodle, hairline) is drawn on every beat: ui, title and closing beats would fall back to plain
  // layout scenes, so they become kinetic ones and none is a "cta" (which the engine always lays out as plain DOM).
  // (Sketch is different: its marks are circles, arrows and underlines drawn over a product screen, so it keeps its screen beats.)
  const drawn = /^(doodle|hairline)/.test(item.look);
  const kind = drawn ? "kinetic" : spec.kind === "ui" && !demo ? "kinetic" : spec.kind ?? "kinetic";
  const base = {
    id: `b${index + 1}`, role: drawn ? (index === 0 ? "hook" : "reveal") : spec.role ?? (index === 0 ? "hook" : last ? "cta" : "reveal"), kind,
    keyword: spec.keyword, on_screen: spec.on_screen ?? null, line: null, verb: kind === "ui" ? spec.verb ?? null : null, success: Boolean(spec.success),
    energy: spec.energy ?? "medium", ui: kind === "ui" ? spec.ui ?? null : null
  };
  // Clean films alternate big type with procedural art: orbits on the second scene, particles on the third.
  const art = item.look === "clean" && kind === "kinetic" && base.role !== "cta" && index > 0 && !last;
  if (art) { base.energy = "high"; base.render = { graphic: index % 2 === 1 ? "orbits" : "particles" }; }
  const route = resolveSceneRoute(base, item.look);
  return {
    ...base, route,
    motion: { entry: entries[index % 4], exit: entries[(index + 1) % 4], text_effect: spec.text_effect ?? null },
    transition_out: { type: last ? "end" : "j-cut" },
    start: spec.start, end: spec.end,
    ...(base.ui ? { act_at: Math.round((spec.start + (spec.end - spec.start) * 0.45) * 100) / 100 } : {}),
    ...(spec.success ? { success_at: Math.round((spec.start + 0.6) * 100) / 100 } : {})
  };
}

/** A style template has no product of its own: it shows the look on one shared example. Illustration looks keep their
 *  reference frame, because the native engine cannot draw that medium and a video of it would mislead. */
const stylePlan = { brand: "Pocket", poster: 2.8, beats: [
  { kind: "kinetic", keyword: "Receipts everywhere", on_screen: "Every month, the same pile", start: 0, end: 1.8 },
  { kind: "ui", role: "reveal", keyword: "Sorted in seconds", on_screen: "Pocket files each one", verb: "select", ui: { screen: "s1", action: "select", target: "Receipt list", aspect: 1.6 }, start: 1.8, end: 3.7 },
  { kind: "title", role: "cta", keyword: "Pocket", on_screen: "Try it free", start: 3.7, end: 5 }] };
const planFor = (item) => galleryPlans[item.id] ?? opusPlans[item.id] ?? (item.kind === "style" && !item.look.startsWith("illus-") ? stylePlan : null);
const opusPlans = JSON.parse(await readFile(join(root, "scripts/gallery-opus/plans.json"), "utf8").catch(() => "{}"));
const rendered = [];

for (const item of galleryTemplates) {
  const spec = planFor(item);
  if (!spec || (wanted.length && !wanted.includes(item.id))) continue;
  const dir = await mkdtemp(join(tmpdir(), `gallery-${item.id}-`));
  try {
    await cp(join(root, "worker/templates/beat-plan"), dir, { recursive: true });
    await mkdir(join(dir, "vendor"), { recursive: true });
    await cp(join(root, "node_modules/gsap/dist/gsap.min.js"), join(dir, "vendor/gsap.min.js"));
    await cp(join(root, "worker/fonts"), join(dir, "fonts"), { recursive: true });
    await mkdir(join(dir, "shots"), { recursive: true });
    await cp(join(root, "worker/templates/product-launch/assets/screenshot.svg"), join(dir, "shots/s1.svg"));
    const plan = { canvas: "16:9", motion_profile: item.motionProfile, captions: "none", beats: spec.beats.map((entry, i) => beat(entry, i, spec.beats.length, item)) };
    const values = { plan: JSON.stringify(plan), "shot.s1": "shots/s1.svg", brandName: spec.brand ?? "Acme", logo: "", logoWordmark: false, look: item.look };
    const fontCss = await readFile(join(root, "worker/fonts/fonts.css"), "utf8");
    const themeCss = await readFile(join(root, "worker/themes", `${item.theme}.css`), "utf8");
    let html = declareVariables(template, values, { asDefaults: true });
    html = html.replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>\n  <style id="theme">\n${themeCss}\n  </style>\n</head>`);
    await writeFile(join(dir, "index.html"), html);
    const raw = join(dir, "render.mp4");
    console.log(`rendering ${item.id} (${item.look}, ${item.theme})`);
    execFileSync(hyperframes, ["render", "--output", raw], { cwd: dir, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env } });
    // 5 s, 640 wide, muted, web-friendly; the poster is the frame the card shows before it plays.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-t", "5", "-an", "-vf", "scale=720:-2,fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, `${item.id}.mp4`)]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(spec.poster ?? 2.6), "-i", raw, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "4", join(out, `${item.id}.jpg`)]);
    console.log(`  wrote ${item.id}.mp4 and ${item.id}.jpg`);
    rendered.push(item.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
console.log(`${rendered.length} previews rendered into var/gallery-src`);
