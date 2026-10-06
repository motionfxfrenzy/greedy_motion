import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
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
export async function buildPlanRenderProject(project: VideoProject, dir: string, { check = false } = {}) {
  const plan = project.beatPlan;
  if (!plan) throw new Error("Generate the plan first.");
  const [template, fontCss] = await Promise.all([
    readFile(join(config.templatesDir, ENGINE_TEMPLATE, "index.html"), "utf8"),
    readFile(join(config.fontsDir, "fonts.css"), "utf8")
  ]);
  const look = await projectLook(project);
  const timing = projectTiming(project)!;

  await mkdir(join(dir, "vendor"), { recursive: true });
  await cp(config.gsapPath, join(dir, "vendor/gsap.min.js"));
  await cp(config.fontsDir, join(dir, "fonts"), { recursive: true });
  if (look.brand && look.brandFontsCss) await cp(join(config.brandsDir, look.brand.id, "fonts"), join(dir, "brand-fonts"), { recursive: true }).catch(() => undefined);
  if (look.logo) {
    await mkdir(join(dir, "brand"), { recursive: true });
    await cp(look.logo.file, join(dir, "brand/logo.png"));
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
    await mkdir(join(dir, track.src, ".."), { recursive: true });
    await cp(from, join(dir, track.src));
  }

  const values = {
    ...engineVariables({
      plan,
      timing,
      shots,
      screenSizes: Object.fromEntries(Object.keys(shots).map((id) => [id, { width: screens.get(id)!.width, height: screens.get(id)!.height }])),
      brandName: brandNameFor(project, look.brand),
      logo: look.logo ? "brand/logo.png" : null,
      logoWordmark: look.logo?.wordmark
    }),
    ...textValues(plan.beats)
  };
  let html = stampCanvas(template, plan.canvas);
  html = declareVariables(html, values, { asDefaults: check });
  html = fillTextBlock(html, {});
  html = withSoundtrack(html, tracks);
  html = html.replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>${look.brandFontsCss ? `\n  <style id="brand-fonts">\n${look.brandFontsCss}\n  </style>` : ""}\n  <style id="theme" data-theme="${look.brand ? "brand" : look.theme}">\n${look.themeCss}\n  </style>\n</head>`);
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "variables.json"), JSON.stringify(values, null, 2));
  return { timing, tracks, durationSeconds: timing.total };
}
