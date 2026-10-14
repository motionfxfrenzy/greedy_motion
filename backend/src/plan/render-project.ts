import { renderManifest } from "./render-manifest.ts";
import { visualVariables, withVisuals } from "./visual-composition.ts";
import { currentClips, visualDir, digest, requireReadyVisuals, requireCurrentPalette } from "./visual-state.ts";
import { readMedia } from "../media.ts";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
import { ensureMedia } from "../media.ts";
import { screenshotFile } from "../projects/store.ts";
import { audioMode, planAudioDir } from "./audio.ts";
import { declareVariables, ENGINE_TEMPLATE, engineVariables, fillTextBlock, stampCanvas, textValues } from "./composition.ts";
import { brandNameFor, projectLook, projectTiming } from "./preview.ts";
import { soundTracks, withSoundtrack, type SfxName } from "./sound.ts";

/**
 * A self-contained HyperFrames project for a plan: the same page as the live storyboard
 * (preview.ts), with every asset copied in and referenced by a relative path, so the CLI or the
 * render worker can render it with `--variables-file variables.json`. The storyboard and the film
 * come from one set of builders (timing, composition, sound), so the render matches the preview.
 *
 * Layout: index.html, variables.json, vendor/gsap.min.js, fonts/, brand-fonts/, brand/logo.png,
 * shots/<id>.png|jpg, audio/vo/*.wav, audio/music/*, sfx/*.mp3. With `check: true` the values are
 * also baked in as declared defaults (`hyperframes check` and `snapshot` take no variables flag).
 */
export async function buildPlanRenderProject(project: VideoProject, dir: string, { check = false, watermark = false }: { check?: boolean; watermark?: boolean } = {}) {
  const plan = project.beatPlan;
  if (!plan) throw new Error("Generate the plan first.");
  requireReadyVisuals(project);
  const [template, fontCss] = await Promise.all([
    readFile(join(config.templatesDir, ENGINE_TEMPLATE, "index.html"), "utf8"),
    readFile(join(config.fontsDir, "fonts.css"), "utf8")
  ]);
  const look = await projectLook(project);
  requireCurrentPalette(project, look.brand);
  const timing = projectTiming(project)!;

  await mkdir(join(dir, "vendor"), { recursive: true });
  await cp(config.gsapPath, join(dir, "vendor/gsap.min.js"));
  await cp(config.fontsDir, join(dir, "fonts"), { recursive: true });
  if (look.brand && look.brandFontsCss) await cp(join(config.brandsDir, look.brand.id, "fonts"), join(dir, "brand-fonts"), { recursive: true }).catch(() => undefined);
  if (look.logo) {
    await mkdir(join(dir, "brand"), { recursive: true });
    await writeFile(join(dir, "brand/logo.png"), look.logo.data);
  }
  if (look.logoBug) {
    await mkdir(join(dir, "brand"), { recursive: true });
    await writeFile(join(dir, "brand/logo-bug.png"), look.logoBug.data);
  }

  const screens = new Map(project.screenshots.map((shot) => [shot.id, shot]));
  const shots: Record<string, string> = {};
  for (const id of new Set(plan.beats.flatMap((beat) => (beat.ui && screens.has(beat.ui.screen) ? [beat.ui.screen] : [])))) {
    const image = await screenshotFile(project.id, id);
    if (!image) continue;
    await mkdir(join(dir, "shots"), { recursive: true });
    const name = `${id}${image.mime === "image/png" ? ".png" : ".jpg"}`;
    await writeFile(join(dir, "shots", name), image.data);
    shots[id] = `shots/${name}`;
  }

  const { tracks } = soundTracks({
    plan,
    timing,
    audio: project.planAudio,
    fileUrl: (file) => `audio/${file}`,
    sfxUrl: (name: SfxName) => `sfx/${name}.mp3`,
    hasShot: (id) => Boolean(shots[id]),
    mode: audioMode(project)
  });
  for (const track of tracks) {
    const from = track.src.startsWith("sfx/") ? join(config.templatesDir, ENGINE_TEMPLATE, track.src) : join(planAudioDir(project.id), track.src.slice("audio/".length));
    if (!track.src.startsWith("sfx/") && !(await ensureMedia(from))) throw new Error(`Audio file ${track.src} is missing; generate the audio again.`);
    await mkdir(join(dir, track.src, ".."), { recursive: true });
    await cp(from, join(dir, track.src));
  }

  for (const clip of Object.values(currentClips(project))) {
    const bytes = await readMedia(join(visualDir(project.id), clip.file));
    if (!bytes || digest(bytes) !== clip.sha256) throw new Error("A generated scene is missing or corrupt; restore it before rendering.");
    await mkdir(join(dir, "visuals"), { recursive: true });
    await writeFile(join(dir, "visuals", clip.file), bytes);
  }
  const values = {
    ...visualVariables(project),
    ...engineVariables({
      plan,
      timing,
      shots,
      screenSizes: Object.fromEntries(Object.keys(shots).map((id) => [id, { width: screens.get(id)!.width, height: screens.get(id)!.height }])),
      brandName: brandNameFor(project, look.brand),
      logo: look.logo ? "brand/logo.png" : null,
      logoWordmark: look.logo?.spellsName,
      logoBug: look.logoBug ? "brand/logo-bug.png" : null,
      look: project.brief?.look,
      family: project.brief?.styleFamily
    }),
    ...textValues(plan.beats)
  };
  let html = stampCanvas(template, plan.canvas);
  html = declareVariables(html, values, { asDefaults: check });
  html = fillTextBlock(html, {});
  html = withSoundtrack(html, tracks);
  if (watermark) html = withWatermark(html);
  html = withVisuals(html, project, timing, file => `visuals/${file}`);
  html = html.replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>${look.brandFontsCss ? `\n  <style id="brand-fonts">\n${look.brandFontsCss}\n  </style>` : ""}\n  <style id="theme" data-theme="${look.brand ? "brand" : look.theme}">\n${look.themeCss}\n  </style>\n</head>`);
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "variables.json"), JSON.stringify(values, null, 2));
  const manifest = await renderManifest(dir, JSON.parse(String(values.plan)), shots, currentClips(project));
  await writeFile(join(dir, "render-manifest.json"), JSON.stringify(manifest, null, 2));
  return { timing, tracks, durationSeconds: timing.total };
}

/**
 * The Free plan's mark: a small "Made with Greedy Motion" label in the lower right, drawn above every scene for the whole
 * film. It is static (no timeline) and sized from the stamped canvas, so it reads the same on every format.
 */
export function withWatermark(html: string): string {
  const width = Number(/data-composition-id="main"[^>]*data-width="(\d+)"/.exec(html)?.[1] ?? 1920);
  const size = Math.round(width * 0.016);
  const pad = Math.round(width * 0.02);
  const mark = `<div id="gm-watermark" data-layout-allow-overlap style="position:absolute;right:${pad}px;bottom:${pad}px;z-index:2147483000;padding:${Math.round(size * 0.45)}px ${Math.round(size * 0.8)}px;border-radius:999px;background:rgba(10,13,18,.62);color:#fff;font:600 ${size}px/1 'Plus Jakarta Sans',Inter,Arial,sans-serif;letter-spacing:.01em;pointer-events:none">Made with Greedy Motion</div>`;
  return html.replace('<div id="captions" data-layout-allow-overlap></div>', (tag) => `${tag}\n    ${mark}`);
}
