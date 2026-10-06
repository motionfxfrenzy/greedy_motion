import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { findTemplate, type VideoProject } from "@videosaas/contracts";
import { getBrand } from "../brand/store.ts";
import { config } from "../config.ts";

const studioAssetBase = "/api/preview";
const idPattern = /^[0-9a-f-]{36}$/i;
const fontFilePattern = /^[a-z0-9][a-z0-9._-]*\.(?:woff2|woff|ttf|otf)$/i;

export class PreviewUnavailable extends Error {}

const scriptJson = (value: unknown) => JSON.stringify(value)
  .replace(/</g, "\\u003c")
  .replace(/>/g, "\\u003e")
  .replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const requiredText = async (path: string, description: string) => {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) throw new PreviewUnavailable(`${description} is unavailable on this backend.`);
  return text;
};

const rewriteFontUrls = (css: string, from: string, to: string) => css.replace(
  new RegExp(`url\\(\\s*([\"'])?${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "g"),
  (_match, quote: string) => `url(${quote ?? ""}${to}/`
);

const fallbackScreenshotId = (project: VideoProject) => project.studio?.assets.screenshot ?? project.screenshots[0]?.id;

/**
 * Builds a real HyperFrames composition page for the browser. It reads the
 * worker's template files and injects exactly the persisted Studio values and
 * verified project assets that the queued render uses.
 */
export async function projectPreviewHtml(project: VideoProject) {
  const template = findTemplate(project.request.template);
  if (!template) throw new PreviewUnavailable("The selected template is unavailable.");

  const [templateHtml, bundledFonts] = await Promise.all([
    requiredText(join(config.templatesDir, template.id, "index.html"), `The ${template.name} template`),
    requiredText(join(config.fontsDir, "fonts.css"), "Bundled preview fonts")
  ]);

  let themeCss: string;
  let brandFonts = "";
  const values: Record<string, string | number | boolean> = { ...(project.studio?.values ?? {}) };
  const brand = project.request.brandId ? await getBrand(project.request.brandId) : null;
  if (project.request.brandId && !brand) throw new PreviewUnavailable("The project brand kit is no longer available.");

  if (brand) {
    themeCss = await requiredText(join(config.brandsDir, brand.id, "theme.css"), "The project brand theme");
    const savedBrandFonts = await readFile(join(config.brandsDir, brand.id, "fonts.css"), "utf8").catch(() => "");
    brandFonts = rewriteFontUrls(savedBrandFonts, "brand-fonts", `${studioAssetBase}/brands/${brand.id}/fonts`);
    // Keep the player in lockstep with `applyBrand()` in the render service:
    // a selected kit owns the name and website, even if an older Studio draft
    // still contains values from before the kit was chosen.
    values.brandName = brand.name;
    const domain = brand.url?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
    if (domain) values.url = domain.slice(0, 40);
    if (brand.hasLogo) {
      const logoPath = join(config.brandsDir, brand.id, "logo.png");
      const metadata = await sharp(logoPath).metadata().catch(() => null);
      if (metadata?.width && metadata.height) {
        values.logo = `${studioAssetBase}/brands/${brand.id}/logo`;
        values.logoWordmark = metadata.width / metadata.height > 2.2;
      }
    }
  } else {
    themeCss = await requiredText(join(config.themesDir, `${project.request.theme}.css`), "The selected preview theme");
  }

  const selectedScreenshot = fallbackScreenshotId(project);
  if (selectedScreenshot && project.screenshots.some((screenshot) => screenshot.id === selectedScreenshot)) {
    values.screenshot = `${studioAssetBase}/projects/${project.id}/screenshots/${selectedScreenshot}`;
  }

  const bootstrap = [
    `<base href="${studioAssetBase}/templates/${template.id}/">`,
    `<script>window.__hfVariables = ${scriptJson(values)};</script>`,
    `<script src="${studioAssetBase}/runtime.js"></script>`,
    `<script src="${studioAssetBase}/gsap.js"></script>`
  ].join("\n  ");
  const withRuntime = templateHtml.replace('<script src="vendor/gsap.min.js"></script>', bootstrap);
  if (withRuntime === templateHtml) throw new PreviewUnavailable("The selected template does not have a supported preview bootstrap.");

  const fontCss = rewriteFontUrls(bundledFonts, "fonts", `${studioAssetBase}/fonts`);
  return withRuntime.replace(
    "</head>",
    `  <style id="fonts">\n${fontCss}\n  </style>${brandFonts ? `\n  <style id="brand-fonts">\n${brandFonts}\n  </style>` : ""}\n  <style id="theme" data-theme="${brand ? "brand" : project.request.theme}">\n${themeCss}\n  </style>\n</head>`
  );
}

export async function previewRuntime() {
  return readFile(config.hyperframesRuntimePath).catch(() => null);
}

export async function previewGsap() {
  return readFile(config.gsapPath).catch(() => null);
}

export async function previewFont(name: string) {
  if (!fontFilePattern.test(name)) return null;
  return readFile(join(config.fontsDir, name)).catch(() => null);
}

/** Current starter templates reference only this bundled image placeholder. */
export async function previewTemplateScreenshot(templateId: string) {
  if (!findTemplate(templateId)) return null;
  return readFile(join(config.templatesDir, templateId, "assets", "screenshot.svg")).catch(() => null);
}

export async function previewBrandLogo(brandId: string) {
  if (!idPattern.test(brandId)) return null;
  const brand = await getBrand(brandId);
  if (!brand?.hasLogo) return null;
  return readFile(join(config.brandsDir, brandId, "logo.png")).catch(() => null);
}

export async function previewBrandFont(brandId: string, name: string) {
  if (!idPattern.test(brandId) || !fontFilePattern.test(name)) return null;
  if (!await getBrand(brandId)) return null;
  return readFile(join(config.brandsDir, brandId, "fonts", name)).catch(() => null);
}
