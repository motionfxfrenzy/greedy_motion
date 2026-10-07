import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { themeIds, type VideoProject } from "@videosaas/contracts";
import { getBrand, restoreBrandFiles } from "../brand/store.ts";
import { config } from "../config.ts";
import { PreviewUnavailable } from "../preview/service.ts";
import { ENGINE_TEMPLATE, engineVariables, fillTextBlock, scriptJson, stampCanvas, textValues } from "./composition.ts";
import { audioMode } from "./audio.ts";
import { soundTracks, withSoundtrack } from "./sound.ts";
import { planTiming, takeOptions, type PlanTiming } from "./timing.ts";

/**
 * The live storyboard page for a project's beat plan: the beat-plan engine template
 * (worker/templates/beat-plan/index.html) with the same bootstrap contract as
 * `projectPreviewHtml` (runtime, GSAP, fonts, theme or brand kit, logo), the plan and its
 * clock, the screenshot URLs and the editable text block. Every asset URL is absolute
 * (`/api/preview/…`), because the frontend loads the page through `srcdoc`.
 */
const studioAssetBase = "/api/preview";

const requiredText = async (path: string, description: string) => {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) throw new PreviewUnavailable(`${description} is unavailable on this backend.`);
  return text;
};

const rewriteFontUrls = (css: string, from: string, to: string) => css.replace(
  new RegExp(`url\\(\\s*(["'])?${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "g"),
  (_match, quote: string) => `url(${quote ?? ""}${to}/`
);

/** The project's plan clock: measured from the voiceover takes, estimated from the pace for lines without one. */
export function projectTiming(project: VideoProject): PlanTiming | null {
  return project.beatPlan ? planTiming(project.beatPlan, project.brief, takeOptions(project.beatPlan, project.planAudio)) : null;
}

/** The project's look: a brand kit (theme, fonts, logo, name) or a gallery theme. Shared by the preview and the render. */
export async function projectLook(project: VideoProject) {
  const brandId = project.brief?.brandId ?? project.request.brandId;
  const brand = brandId ? await getBrand(brandId) : null;
  if (brandId && !brand) throw new PreviewUnavailable("The project brand kit is no longer available.");
  // Rebuild derived brand files (theme, fonts) from the kit row if they are missing, so the brand never drops out.
  if (brand) {
    const health = await restoreBrandFiles(brand);
    if (health.restored.length || health.missing.length) console.warn(JSON.stringify({ level: "warn", event: "brand_files", brandId: brand.id, ...health }));
  }
  const theme = project.brief?.theme && themeIds.includes(project.brief.theme) ? project.brief.theme : project.request.theme;
  if (!brand) return { brand: null, theme, themeCss: await requiredText(join(config.themesDir, `${theme}.css`), "The selected preview theme"), brandFontsCss: "", logo: null };
  const themeCss = await requiredText(join(config.brandsDir, brand.id, "theme.css"), "The project brand theme");
  // Saved brand font CSS points at `brand-fonts/<file>` (the files live in <brandsDir>/<id>/fonts).
  const brandFontsCss = await readFile(join(config.brandsDir, brand.id, "fonts.css"), "utf8").catch(() => "");
  let logo: { file: string; wordmark: boolean } | null = null;
  if (brand.hasLogo) {
    const file = join(config.brandsDir, brand.id, "logo.png");
    const metadata = await sharp(file).metadata().catch(() => null);
    if (metadata?.width && metadata.height) logo = { file, wordmark: metadata.width / metadata.height > 2.2 };
  }
  return { brand, theme, themeCss, brandFontsCss, logo };
}

export const brandNameFor = (project: VideoProject, brand: { name: string } | null) =>
  brand?.name ?? project.brief?.productName ?? project.beatPlan?.brand.name ?? project.name;

export async function planPreviewHtml(project: VideoProject): Promise<string> {
  const plan = project.beatPlan;
  if (!plan) throw new PreviewUnavailable("Generate the plan first.");
  const [templateHtml, bundledFonts] = await Promise.all([
    requiredText(join(config.templatesDir, ENGINE_TEMPLATE, "index.html"), "The beat-plan engine"),
    requiredText(join(config.fontsDir, "fonts.css"), "Bundled preview fonts")
  ]);

  // Brand kit or gallery theme: same rules as projectPreviewHtml (a kit owns the name and the logo).
  const look = await projectLook(project);
  const { brand, theme, themeCss } = look;
  const brandFonts = brand ? rewriteFontUrls(look.brandFontsCss, "brand-fonts", `${studioAssetBase}/brands/${brand.id}/fonts`) : "";
  const logo = brand && look.logo ? `${studioAssetBase}/brands/${brand.id}/logo` : null;
  const logoWordmark = Boolean(look.logo?.wordmark);

  const timing = projectTiming(project)!;
  const screens = new Map(project.screenshots.map((shot) => [shot.id, shot]));
  const used = [...new Set(plan.beats.flatMap((beat) => (beat.ui && screens.has(beat.ui.screen) ? [beat.ui.screen] : [])))];
  const variables = engineVariables({
    plan,
    timing,
    shots: Object.fromEntries(used.map((id) => [id, `${studioAssetBase}/projects/${project.id}/screenshots/${id}`])),
    screenSizes: Object.fromEntries(used.map((id) => [id, { width: screens.get(id)!.width, height: screens.get(id)!.height }])),
    brandName: brandNameFor(project, brand),
    logo,
    logoWordmark,
    look: project.brief?.look
  });

  // Bootstrap: the runtime and GSAP replace the template's vendor line; the editable text block
  // follows and is merged into window.__hfVariables before the engine builds the timeline.
  const bootstrap = [
    `<script>window.__hfVariables = ${scriptJson(variables)};</script>`,
    `<script src="${studioAssetBase}/runtime.js"></script>`,
    `<script src="${studioAssetBase}/gsap.js"></script>`
  ].join("\n  ");
  const merge = `<script>(function () { try { var block = document.getElementById("hf-variables"); var edits = JSON.parse(block && block.textContent || "{}"); if (edits && typeof edits === "object" && !Array.isArray(edits)) window.__hfVariables = Object.assign({}, window.__hfVariables || {}, edits); } catch (error) {} })();</script>`;
  let html = stampCanvas(templateHtml, plan.canvas);
  const withRuntime = html.replace('<script src="vendor/gsap.min.js"></script>', () => bootstrap);
  if (withRuntime === html) throw new PreviewUnavailable("The beat-plan engine does not have a supported preview bootstrap.");
  html = fillTextBlock(withRuntime, textValues(plan.beats));
  html = html.replace(/(<script id="hf-variables" type="application\/json">[\s\S]*?<\/script>)/, (block) => `${block}\n  ${merge}`);
  // The soundtrack: voiceover takes, the ducked bed and the SFX, as <audio> tracks the player plays in sync.
  const { tracks } = soundTracks({
    plan,
    timing,
    audio: project.planAudio,
    fileUrl: (file) => `${studioAssetBase}/plans/${project.id}/audio/${file}`,
    sfxUrl: (name) => `${studioAssetBase}/plan-sfx/${name}.mp3`,
    hasShot: (id) => screens.has(id),
    mode: audioMode(project)
  });
  html = withSoundtrack(html, tracks);
  const fontCss = rewriteFontUrls(bundledFonts, "fonts", `${studioAssetBase}/fonts`);
  return html.replace(
    "</head>",
    () => `  <style id="fonts">\n${fontCss}\n  </style>${brandFonts ? `\n  <style id="brand-fonts">\n${brandFonts}\n  </style>` : ""}\n  <style id="theme" data-theme="${brand ? "brand" : theme}">\n${themeCss}\n  </style>\n</head>`
  );
}
