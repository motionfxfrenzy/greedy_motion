/*
 * The eye. A drawing recipe from the oracle is only structurally valid until someone looks at it. This paints ONE recipe alone with the real renderer
 * (a still, same GPU painter as the film), shows it to a vision model with the description it was meant to depict, and returns a verdict:
 * a score, what is wrong, and concrete drawing instructions. recipe.mjs feeds those back to the artist and keeps the best attempt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { askJson } from "./llm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Paints the recipe on its own (a place alone; an object on a plain meadow) and returns the JPEG bytes, or null when the renderer fails. */
export function paintStill(kind, recipe, describe, { look = "oil" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "painted-check-"));
  try {
    const shot = kind === "place" ? { place: "custom", time: "day", recipe } : { place: "meadow", time: "day", props: [{ kind: "custom", id: "subject", describe, recipe, x: 0.5, size: "large" }] };
    fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ look, format: "9:16", lines: [{ say: " ", audio: { seconds: 1.5 }, shots: [shot] }] }));
    const r = spawnSync("node", [path.join(here, "render.mjs"), path.join(dir, "spec.json"), "x.mp4", "--width", "540", "--sheet", path.join(dir, "out")], { encoding: "utf8" });
    const f = path.join(dir, "out", "s000.jpg");
    return r.status === 0 && fs.existsSync(f) ? fs.readFileSync(f) : null;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const SYSTEM = `You are the art director of a painted vertical short film (9:16). You see ONE painted still that was generated from a description. Judge it as a viewer who has not read the description would, then against the description.
Score 1-10: 9-10 reads at a glance and looks painted by a person; 7-8 clear and pleasant with small flaws; 4-6 recognisable but crude, cluttered or muddy; 1-3 unreadable, broken or a pile of random shapes.
Check: (1) is the main subject recognisable and the right shape, in the right place, big enough? (2) is it ONE clear idea, or stray shards, hexagons, rays or lines that mean nothing? (3) depth and light: a lit side and a shadow side on rounded things, a dark-to-light background, not flat colour; (4) the lowest quarter of the frame stays calm (captions sit there) and the subject sits in the upper two thirds; (5) colours: a limited, harmonious palette, with the subject standing out from the background.
Ignore any small text label or caption on the image.
Answer JSON only: {"score":<1-10>,"problems":["<what is wrong, concretely>"],"fixes":["<one concrete drawing instruction in terms of shapes, positions, colours, e.g. 'make the moon one big circle at (0.5,0.35) r 0.18 with a darker crescent ellipse offset left'>"]}`;

/** Returns { score, problems, fixes } for a recipe, or null when it could not be painted or judged (the caller then keeps the recipe unchecked). */
export async function review(kind, recipe, describe, { engine = "gemini", look } = {}) {
  const jpg = paintStill(kind, recipe, describe, { look });
  if (!jpg) return null;
  try {
    const v = await askJson({ engine, what: "check-" + kind, system: SYSTEM, user: `Description it should depict (${kind}): ${describe}`, images: [{ mime: "image/jpeg", base64: jpg.toString("base64") }], maxTokens: 4000, temperature: 0.2, timeoutMs: 120_000 });
    return { score: Math.max(1, Math.min(10, Number(v.score) || 0)), problems: (v.problems ?? []).slice(0, 6).map(String), fixes: (v.fixes ?? []).slice(0, 6).map(String), jpg };
  } catch { return null; }
}

/**
 * One look at many drawings: every recipe is painted in ONE render (one browser, one shot per drawing) and the vision model judges all the stills in ONE call.
 * items: [{ kind, recipe, describe }]; returns one { score, problems, fixes, jpg } (or null when that one could not be judged) per item, in order.
 */
export async function reviewBatch(items, { engine = "gemini", look } = {}) {
  if (!items.length) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "painted-checks-"));
  try {
    const shots = items.map(({ kind, recipe, describe }, i) => kind === "place" ? { place: "custom", time: "day", recipe } : { place: "meadow", time: "day", props: [{ kind: "custom", id: `subject${i}`, describe, recipe, x: 0.5, size: "large" }] });   // one id per drawing: the film keeps an id's first description
    fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ look, format: "9:16", lines: shots.map((shot) => ({ say: " ", audio: { seconds: 1.5 }, shots: [shot] })) }));
    const r = spawnSync("node", [path.join(here, "render.mjs"), path.join(dir, "spec.json"), "x.mp4", "--width", "540", "--sheet", path.join(dir, "out")], { encoding: "utf8", maxBuffer: 1 << 26 });
    // the end of a shot is the finished painting, except the last shot, whose end fades to black
    const stills = items.map((_, i) => { const f = path.join(dir, "out", `s${String(i === items.length - 1 ? i * 2 : i * 2 + 1).padStart(3, "0")}.jpg`); return r.status === 0 && fs.existsSync(f) ? fs.readFileSync(f) : null; });
    const ok = stills.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (process.env.PAINTED_KEEP_CHECK) { fs.mkdirSync(process.env.PAINTED_KEEP_CHECK, { recursive: true }); stills.forEach((b, i) => b && fs.writeFileSync(path.join(process.env.PAINTED_KEEP_CHECK, `${Date.now()}-${i}.jpg`), b)); }
    if (!ok.length) return items.map(() => null);
    const list = ok.map((i, n) => `Image ${n + 1} (${items[i].kind}): ${items[i].describe}`).join("\n");
    const v = await askJson({ engine, what: "check-batch", system: SYSTEM.replace("You see ONE painted still", "You see SEVERAL painted stills, one per description, in order,").replace("Answer JSON only:", 'Answer JSON only, one entry per image in order: {"results":[<entry>,...]} where each entry is:'), user: `Judge each image against its description.\n${list}`, images: ok.map((i) => ({ mime: "image/jpeg", base64: stills[i].toString("base64") })), maxTokens: 8000, temperature: 0.2, timeoutMs: 150_000 });
    const out = items.map(() => null);
    (v.results ?? []).slice(0, ok.length).forEach((e, n) => { out[ok[n]] = { score: Math.max(1, Math.min(10, Number(e.score) || 0)), problems: (e.problems ?? []).slice(0, 6).map(String), fixes: (e.fixes ?? []).slice(0, 6).map(String), jpg: stills[ok[n]] }; });
    return out;
  } catch { return items.map(() => null); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
