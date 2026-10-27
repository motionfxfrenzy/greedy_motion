// Everything the director and the script writer know about a project besides the brief's own words: the brand, the film's
// type, the template it started from, what each uploaded screenshot shows, the product's site, and (once the person has
// edited and approved one) the script itself.
import { findGalleryTemplate, inferVideoType, type ScriptBrief, type VideoProject, type VideoType } from "@videosaas/contracts";
import { getBrand } from "../brand/store.ts";
import type { DirectorContext } from "./director.ts";
import { ensureDescribed } from "./screenshots.ts";

export type ProjectDirectorContext = { context: DirectorContext; videoType: VideoType; brandId: string | undefined };

const host = (value: string) => { try { return new URL(/^https?:/i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, ""); } catch { return ""; } };

export async function directorContextFor(project: VideoProject, brief: ScriptBrief): Promise<ProjectDirectorContext> {
  const described = await ensureDescribed(project);
  const screenshots = described.screenshots
    .filter((shot) => !brief.screenshotIds || brief.screenshotIds.includes(shot.id))
    .sort((a, b) => (brief.screenshotIds ? brief.screenshotIds.indexOf(a.id) - brief.screenshotIds.indexOf(b.id) : 0))
    .map((shot) => ({ id: shot.id, name: shot.name, purpose: shot.purpose, width: shot.width, height: shot.height, ...(shot.analysis ? { analysis: shot.analysis } : {}) }));
  const starting = brief.styleExample ? findGalleryTemplate(brief.styleExample) : undefined;
  const template = starting ? { id: starting.id, name: starting.name, group: starting.group, summary: starting.summary, bestFor: starting.bestFor, skill: starting.skill } : undefined;
  const videoType = inferVideoType({ videoType: brief.videoType ?? project.script?.videoType, text: brief.text, group: template?.group ?? null, hasScreenshots: screenshots.length > 0 });
  const brandId = brief.brandId ?? project.request.brandId;
  const brand = brandId ? await getBrand(brandId) : null;
  const site = brief.productUrl && project.site && host(project.site.url) === host(brief.productUrl) ? project.site : undefined;
  // The person's edited script: when they write their own, its scenes (visual intent and screenshot assignments) are the plan.
  const approved = brief.scriptMode === "own" && project.script?.lines.length ? project.script.lines : undefined;
  const context: DirectorContext = {
    // No kit and no product name means no product: an empty name. The project name is the brief's first line, and passing it
    // on made the director sell "Explain binary search…" as a product (a "Try binary search" ending and an end card titled with it).
    brandName: brand?.name ?? brief.productName ?? "", productNamed: Boolean(brand?.name || brief.productName), videoType, screenshots,
    ...(template ? { template } : {}),
    ...(brand?.description ? { brandDescription: brand.description } : {}),
    ...(site ? { site: { url: site.url, title: site.title, description: site.description, facts: site.facts, text: site.text } } : {}),
    ...(approved ? { approvedScript: approved.map((line) => ({ role: line.role ?? null, voiceover: line.voiceover ?? null, onScreen: line.onScreen, visual: line.visual ?? null, screenshotId: line.screenshotId ?? null })) } : {})
  };
  return { context, videoType, brandId };
}
