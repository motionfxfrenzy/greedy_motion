import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { BrandExtraction, BrandKit, SiteCapture, SiteSection } from "@videosaas/contracts";
import { extractBrand } from "../brand/extract.ts";
import { listBrands } from "../brand/store.ts";
import { FetchRefused } from "../brand/safe-fetch.ts";
import { config } from "../config.ts";
import { removeMedia, saveMedia } from "../media.ts";
import { addScreenshot, getProject, removeScreenshot, updateProjectSite } from "../projects/store.ts";
import { readSite, SiteUnavailable } from "./capture.ts";

const host = (value: string | undefined) => { try { return value ? new URL(/^https?:/i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { return ""; } };

/** A brand kit the user already saved for this site (same host), newest first. */
async function savedKitFor(url: string): Promise<BrandKit | null> {
  const target = host(url);
  const kits = (await listBrands().catch(() => [])).filter((kit) => host(kit.url) === target);
  return kits.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

const notFound = { error: { code: "not_found", message: "Project not found." } };
const chains = new Map<string, Promise<unknown>>();

/** One site read per project at a time (a second request waits for the first). */
function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
  const next = (chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(work);
  chains.set(id, next);
  void next.finally(() => { if (chains.get(id) === next) chains.delete(id); }).catch(() => undefined);
  return next;
}

export async function registerSiteRoutes(app: FastifyInstance) {
  /**
   * Reads the product's website for the Script & Style step: the product's own words (facts the
   * director may use), labelled section screenshots added to the project, an HTML/CSS snapshot of
   * each section, and a brand-kit suggestion (same shape as POST /v1/brands/extract; not saved).
   * Re-reading replaces the previous site screenshots unless the plan already uses them.
   */
  app.post<{ Params: { id: string }; Body: { url?: unknown } }>("/v1/projects/:id/site", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    const url = typeof request.body?.url === "string" ? request.body.url.trim() : "";
    if (!url || url.length > 300) return reply.code(400).send({ error: { code: "invalid_request", message: "Enter your product's website URL." } });
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      return await serial(project.id, async () => {
        const [read, brand, savedBrand] = await Promise.all([
          readSite(full),
          extractBrand(full).then((value): BrandExtraction | null => value, () => null),
          savedKitFor(full)
        ]);
        // The rendered page's own colours (CTA fills, logo, accents) beat CSS-frequency guesses: they lead the
        // candidates, and replace a pale or unused primary. The user still reviews the kit before saving.
        if (brand && read.colors.length) {
          const pale = (hex: string) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return (Math.max(...v) + Math.min(...v)) / 510 > 0.78; };
          const primary = brand.colors.primary && !pale(brand.colors.primary) && read.colors.slice(0, 3).includes(brand.colors.primary.toLowerCase()) ? brand.colors.primary : read.colors[0];
          const accent = read.colors.find((hex) => hex !== primary) ?? brand.colors.accent;
          brand.colors = { ...brand.colors, primary, ...(accent ? { accent } : {}), candidates: [...new Set([...read.colors, ...brand.colors.candidates])].slice(0, 10) };
          brand.notes = [...brand.notes, "Colours ranked from the rendered page (buttons, links, logo)."];
        }
        const warnings = [...read.warnings, ...(brand ? [] : ["The brand kit could not be read from this site; pick a theme or build the kit by hand."])];

        // Replace the previous site shots, except ones the plan already shows.
        const latest = await getProject(project.id);
        const inPlan = new Set((latest?.beatPlan?.beats ?? []).flatMap((beat) => (beat.ui ? [beat.ui.screen] : [])));
        for (const old of latest?.site?.sections ?? []) if (old.screenshotId && !inPlan.has(old.screenshotId)) await removeScreenshot(project.id, old.screenshotId);
        const siteDir = join(config.projectsDir, project.id, "site");
        await removeMedia(siteDir);

        const sections: SiteSection[] = [];
        const added: { id: string; name: string; section: string }[] = [];
        for (const [i, section] of read.sections.entries()) {
          const name = `Site · ${section.heading}`.slice(0, 120);
          const saved = await addScreenshot(project.id, name, "image/png", section.png, "Dashboard").catch(() => null);
          const shot = saved?.screenshots[saved.screenshots.length - 1] ?? null;
          let snapshot: string | null = null;
          if (section.snapshot) {
            snapshot = `site/section-${i + 1}.html`;
            await saveMedia(join(config.projectsDir, project.id, snapshot), `<!doctype html><meta charset="utf-8"><!-- Snapshot of ${full.replace(/--/g, "")} (untrusted page content; styles inlined) -->\n${section.snapshot}\n`);
          }
          sections.push({ heading: section.heading, screenshotId: shot?.id ?? null, snapshot });
          if (shot) added.push({ id: shot.id, name: shot.name, section: section.heading });
        }
        const site: SiteCapture = { url: read.url, title: read.title, description: read.description, facts: read.facts, text: read.text, sections, mode: read.mode, capturedAt: new Date().toISOString() };
        const updated = await updateProjectSite(project.id, site);
        // savedBrand: a kit already saved for this site; select it directly. brand: the fresh suggestion for a new kit.
        return { site, brand, savedBrand, screenshots: added, project: updated, warnings };
      });
    } catch (error) {
      if (error instanceof FetchRefused || error instanceof SiteUnavailable) return reply.code(400).send({ error: { code: "site_unreadable", message: error.message } });
      if (error instanceof Error && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/.test(error.message)) return reply.code(400).send({ error: { code: "unreachable", message: "That website could not be reached." } });
      app.log.warn({ err: error, projectId: project.id }, "site read failed");
      return reply.code(502).send({ error: { code: "site_failed", message: "Reading the site failed. Try again, or upload screenshots instead." } });
    }
  });
}
