// Builds a render folder for a fill-mode format from the shipped bundle: the skill's frozen template, the slot values
// baked in as variable defaults, the brand (theme, fonts, logo) and the pinned vendor files. The same folder works for
// `hyperframes check`, `snapshot` and `render`. Pure: every input is passed in, so scripts, tests and the route use it
// identically (the route resolves the brand; the bundle gates pass a gallery theme).
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { declareVariables } from "../plan/composition.ts";
import type { FormatSkill } from "./bundle.ts";
import type { SlotValues } from "./slots.ts";

export type FormatLook = {
  themeCss: string;
  /** Extra @font-face rules for the brand's own faces (they point at `brand-fonts/<file>`), and where the files are. */
  brandFontsCss?: string;
  brandFontsDir?: string;
  /** The brand kit's normalized logo; it fills the `logo` slot. Without one the template draws a monogram. */
  logoFile?: string;
};

export async function buildFormatProject({ skill, values, look, fontsDir, dir }: { skill: FormatSkill; values: SlotValues; look: FormatLook; fontsDir: string; dir: string }) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(join(skill.dir, "template"), dir, { recursive: true });
  await cp(join(skill.dir, "vendor"), join(dir, "vendor"), { recursive: true });
  await cp(fontsDir, join(dir, "fonts"), { recursive: true });
  let fontsCss = await readFile(join(fontsDir, "fonts.css"), "utf8");
  if (look.brandFontsCss) fontsCss += "\n" + look.brandFontsCss;
  if (look.brandFontsDir) await cp(look.brandFontsDir, join(dir, "brand-fonts"), { recursive: true }).catch(() => undefined);
  const baked: SlotValues = { ...values };
  if (look.logoFile) {
    await mkdir(join(dir, "brand"), { recursive: true });
    await cp(look.logoFile, join(dir, "brand/logo.png"));
    baked.logo = "brand/logo.png";
  }
  await writeFile(join(dir, "theme.css"), look.themeCss);
  await writeFile(join(dir, "fonts.css"), fontsCss);
  const html = await readFile(join(dir, "index.html"), "utf8");
  await writeFile(join(dir, "index.html"), declareVariables(html, baked, { asDefaults: true }));
  await writeFile(join(dir, "variables.json"), JSON.stringify(baked, null, 2) + "\n");
  const duration = skill.spec.duration;
  return { durationSeconds: duration ? duration.max : 0, canvas: skill.spec.canvas[0] ?? "16:9" };
}
