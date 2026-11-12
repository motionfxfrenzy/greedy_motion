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
import { beatTimes, musicBeatGrid } from "./beat-grid.ts";
import { filmFeel, filmFrames, withFrameFilm } from "./frame-film.ts";
import { declareVariables, ENGINE_TEMPLATE, engineVariables, fillTextBlock, stampCanvas, textValues, withSubtitleStyling } from "./composition.ts";
import { brandNameFor, projectLook, projectTiming } from "./preview.ts";
import { soundTracks, withSoundtrack, type SfxName } from "./sound.ts";
import { getProjectSubtitles } from "../plates/service.ts";

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
    mode: audioMode(project),
    sfx: project.brief?.audio.sfx !== false
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
  const subtitles = await getProjectSubtitles(project);
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
      family: project.brief?.styleFamily,
      subtitles
    }),
    ...textValues(plan.beats)
  };
  let html = stampCanvas(template, plan.canvas);
  html = declareVariables(html, values, { asDefaults: check });
  html = fillTextBlock(html, plan.overrides && Object.keys(plan.overrides).length > 0 ? { overrides: plan.overrides } : {});
  html = withSoundtrack(html, tracks);
  // A film written in the script canvas animates its approved frames instead of the engine's own scenes.
  const frames = filmFrames(project, timing);
  if (frames) html = await withFrameFilm(html, frames, filmFeel(project), beatTimes(tracks, tracks.some((track) => track.id.startsWith("music-bed")) ? await musicBeatGrid(project.id, project.planAudio?.music?.file) : null));
  html = withSubtitleStyling(html, subtitles);
  if (watermark) html = withWatermark(html);
  html = withVisuals(html, project, timing, file => `visuals/${file}`);
  html = html.replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>${look.brandFontsCss ? `\n  <style id="brand-fonts">\n${look.brandFontsCss}\n  </style>` : ""}\n  <style id="theme" data-theme="${look.brand ? "brand" : look.theme}">\n${look.themeCss}\n  </style>\n</head>`);
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "variables.json"), JSON.stringify(values, null, 2));
  const manifest = await renderManifest(dir, JSON.parse(String(values.plan)), shots, currentClips(project));
  await writeFile(join(dir, "render-manifest.json"), JSON.stringify(manifest, null, 2));
  return { timing, tracks, durationSeconds: timing.total };
}

export const WATERMARK_INTERVAL_SECONDS = 4;
const GM_MARK_SVG_PATHS = `<g fill="#168BFF"><rect x="18" y="55" width="42" height="12" rx="6"/><rect x="8" y="74" width="58" height="12" rx="6"/><rect x="20" y="93" width="34" height="12" rx="6"/><path d="M76 49C76 31 96 20 114 28c26 12 46 32 64 52-18 20-38 40-64 52-18 8-38-3-38-21V49Z"/></g><path fill="#FF5A1F" d="M192 54c0-9 10-14 18-9l31 20c8 5 8 16 0 21l-31 20c-8 5-18 0-18-9V54Z"/>`;

/**
 * The Free plan's mark: a narrow centered stacked badge ([Greedy Motion logo] / Greedy / Motion), sized from the stamped canvas
 * (`Math.min(width, height)`) and deterministically alternating every 4 s on the composition timeline between LEFT above
 * vertical midpoint (~40% height) and RIGHT below vertical midpoint (~60% height).
 */
export function withWatermark(html: string): string {
  const rootMatch = /<div[^>]*data-composition-id="main"[^>]*>/.exec(html)?.[0] ?? "";
  const width = Number(/data-width="(\d+)"/.exec(rootMatch)?.[1] ?? 1920);
  const height = Number(/data-height="(\d+)"/.exec(rootMatch)?.[1] ?? 1080);
  const ref = Math.min(width, height);
  const fontSize = Math.max(10, Math.round(ref * 0.022));
  const lineHeight = Math.max(12, Math.round(fontSize * 1.15));
  const logoH = Math.max(14, Math.round(fontSize * 1.65));
  const logoW = Math.round(logoH * 1.6);
  const gap = Math.max(3, Math.round(fontSize * 0.25));
  const padX = Math.max(8, Math.round(fontSize * 0.65));
  const padY = Math.max(6, Math.round(fontSize * 0.5));
  const textW = Math.round(fontSize * 3.8);
  const boxW = Math.max(logoW, textW) + padX * 2;
  const textBlockH = fontSize + lineHeight;
  const boxH = padY + logoH + gap + textBlockH + padY;
  const rx = Math.max(8, Math.round(fontSize * 0.65));
  const strokeW = Math.max(1, Math.round(fontSize * 0.06));
  const marginX = Math.max(10, Math.round(width * 0.035));
  const leftX = marginX;
  const leftCenterY = Math.round(height * 0.40);
  const leftY = Math.max(marginX, Math.min(height - marginX - boxH, Math.round(leftCenterY - boxH / 2)));
  const rightX = Math.max(marginX, width - marginX - boxW);
  const rightCenterY = Math.round(height * 0.60);
  const rightY = Math.max(marginX, Math.min(height - marginX - boxH, Math.round(rightCenterY - boxH / 2)));

  const mark = `<div id="gm-watermark" data-layout-allow-overlap data-watermark-interval="${WATERMARK_INTERVAL_SECONDS}" data-left-x="${leftX}" data-left-y="${leftY}" data-right-x="${rightX}" data-right-y="${rightY}" style="position:absolute;left:${leftX}px;top:${leftY}px;width:${boxW}px;height:${boxH}px;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${gap}px;padding:${padY}px ${padX}px;border-radius:${rx}px;background:rgba(10,14,22,.64);border:${strokeW}px solid rgba(255,255,255,.18);color:#fff;font:700 ${fontSize}px/${lineHeight}px 'Plus Jakarta Sans',Inter,Arial,sans-serif;letter-spacing:.01em;text-align:center;pointer-events:none;box-sizing:border-box"><svg class="gm-watermark-logo" width="${logoW}" height="${logoH}" viewBox="0 0 256 160" aria-hidden="true" style="display:block;width:${logoW}px;height:${logoH}px;flex:none">${GM_MARK_SVG_PATHS}</svg><span class="gm-watermark-lines" style="display:flex;flex-direction:column;align-items:center;line-height:${lineHeight}px"><span class="gm-watermark-line" style="display:block;white-space:nowrap;line-height:1">Greedy</span><span class="gm-watermark-line" style="display:block;white-space:nowrap;line-height:${lineHeight}px">Motion</span></span></div>`;
  const script = `<script id="gm-watermark-script">(function(){var wm=document.getElementById("gm-watermark"),tl=window.__timelines&&window.__timelines.main;if(!wm||!tl||typeof tl.set!=="function")return;var dur=Math.max(typeof tl.duration==="function"?tl.duration():0,(window.__bp&&window.__bp.total)||0,${WATERMARK_INTERVAL_SECONDS});for(var t=0,step=0;t<dur;t+=${WATERMARK_INTERVAL_SECONDS},step++){var isRight=(step%2)===1;tl.set(wm,{left:(isRight?${rightX}:${leftX})+"px",top:(isRight?${rightY}:${leftY})+"px"},t)}})();</script>`;
  const withMark = html.replace('<div id="captions" data-layout-allow-overlap></div>', (tag) => `${tag}\n    ${mark}`);
  return withMark.includes("</body>")
    ? withMark.replace("</body>", () => `  ${script}\n</body>`)
    : `${withMark}\n${script}`;
}
