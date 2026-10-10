import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { motionBlurProblem, parseMotionBlur, themeIds, type RenderJob } from "@videosaas/contracts";
import { callerId } from "../auth.ts";
import { getBrand, restoreBrandFiles } from "../brand/store.ts";
import { config } from "../config.ts";
import { renderJobRepository } from "../render/repository.ts";
import { uploadDirectory } from "../storage.ts";
import { formatBundle, type FormatSkill } from "./bundle.ts";
import { buildFormatProject, type FormatLook } from "./build.ts";
import { fillSlots } from "./fill.ts";
import { normalizeValues, writableSlots } from "./slots.ts";

/**
 * Fill-mode formats: the shipped gm-* skills, run by the hosted app. A person supplies the product's facts, the model
 * writes the slots that are not facts (the skill's fill guidance is its prompt), the slot schema validates all of it, and
 * the finished folder goes to the same render queue and worker as every other render: the worker needs nothing new.
 */
const describe = (skill: FormatSkill) => ({
  skill: skill.name,
  version: skill.version,
  description: skill.description,
  canvas: skill.spec.canvas,
  durationSeconds: skill.spec.duration?.max ?? null,
  slots: writableSlots(skill.spec).map((slot) => ({
    id: slot.id, type: slot.type, purpose: slot.purpose, maxChars: slot.maxChars, count: slot.count, itemFields: slot.itemFields,
    mustBeReal: Boolean(slot.mustBeReal), aiFillable: Boolean(slot.aiFillable), optional: slot.default !== undefined || slot.from !== undefined
  }))
});

const fail = (code: string, message: string, extra: object = {}) => ({ error: { code, message, ...extra } });

async function resolveLook(body: { brandId?: unknown; theme?: unknown }): Promise<{ look: FormatLook; brandName?: string } | { notFound: true }> {
  if (typeof body.brandId === "string" && body.brandId) {
    const brand = await getBrand(body.brandId);
    if (!brand) return { notFound: true };
    const health = await restoreBrandFiles(brand);
    if (health.restored.length || health.missing.length) console.warn(JSON.stringify({ level: "warn", event: "brand_files", brandId: brand.id, ...health }));
    const dir = join(config.brandsDir, brand.id);
    return {
      brandName: brand.name,
      look: {
        themeCss: await readFile(join(dir, "theme.css"), "utf8"),
        brandFontsCss: await readFile(join(dir, "fonts.css"), "utf8").catch(() => ""),
        brandFontsDir: join(dir, "fonts"),
        ...(brand.hasLogo ? { logoFile: join(dir, "logo.png") } : {})
      }
    };
  }
  const theme = typeof body.theme === "string" && themeIds.includes(body.theme as (typeof themeIds)[number]) ? body.theme : "neutral";
  return { look: { themeCss: await readFile(join(config.themesDir, `${theme}.css`), "utf8") } };
}

export async function registerFormatRoutes(app: FastifyInstance) {
  // Fail at startup, not on the first request, if the shipped bundle is damaged.
  const { bundle, skills } = await formatBundle();
  app.log.info({ bundle: bundle.slice(0, 12), formats: [...skills.values()].map((skill) => `${skill.name}@${skill.version}`) }, "skill bundle verified");

  app.get("/v1/formats", async () => ({ bundle, formats: [...skills.values()].map(describe) }));

  app.post<{ Params: { skill: string }; Body: { values?: unknown; brief?: unknown; brandId?: unknown; theme?: unknown } }>("/v1/formats/:skill/render", async (request, reply) => {
    const skill = skills.get(request.params.skill);
    if (!skill) return reply.code(404).send(fail("not_found", "That format does not exist."));
    const body = (request.body ?? {}) as { values?: unknown; brief?: unknown; brandId?: unknown; theme?: unknown; motionBlur?: unknown };
    if (body.values !== undefined && (typeof body.values !== "object" || body.values === null || Array.isArray(body.values))) return reply.code(400).send(fail("invalid_request", "`values` must be an object of slot values."));
    const supplied = { ...((body.values as Record<string, unknown> | undefined) ?? {}) };
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";

    const resolved = await resolveLook(body);
    if ("notFound" in resolved) return reply.code(404).send(fail("not_found", "Brand kit not found."));
    const context = resolved.brandName ? { brandName: resolved.brandName } : {};

    // 1. the model writes what the person did not supply (only slots the skill marks aiFillable)
    let written: Record<string, unknown> = {};
    try {
      const needsFill = writableSlots(skill.spec).some((slot) => slot.aiFillable && supplied[slot.id] === undefined);
      if (needsFill && config.planner === "anthropic") {
        if (brief.length < 12) return reply.code(400).send(fail("brief_required", "Describe the product in a sentence or two (`brief`), so the slots that are not facts can be written."));
        written = await fillSlots(skill, { story: brief, ...context }, supplied);
      }
    } catch (error) {
      request.log.error({ err: error, skill: skill.name }, "format slot fill failed");
      return reply.code(502).send(fail("fill_failed", error instanceof Error ? error.message : "The slots could not be written."));
    }

    // 2. everything, supplied or written, meets the same budgets
    const { values, problems } = normalizeValues(skill.spec, { ...written, ...supplied }, context);
    if (problems.length) return reply.code(422).send(fail("slots_invalid", `${problems.length} slot${problems.length === 1 ? "" : "s"} need attention.`, { problems }));

    // Motion blur is an option of this final render only; it costs several times the render time, so it is checked up front.
    const blur = parseMotionBlur(body.motionBlur);
    if (!blur.ok) return reply.code(400).send(fail("invalid_request", blur.message));

    // 3. build, hand over to storage, queue
    const jobId = randomUUID();
    const dir = join(config.renderOutputDir, jobId, "project");
    try {
      const built = await buildFormatProject({ skill, values, look: resolved.look, fontsDir: config.fontsDir, dir });
      if (blur.on) {
        const tooLong = motionBlurProblem(built.durationSeconds);
        if (tooLong) { await rm(join(config.renderOutputDir, jobId), { recursive: true, force: true }).catch(() => undefined); return reply.code(400).send(fail("motion_blur_too_long", tooLong)); }
      }
      let projectPrefix: string | undefined;
      if (config.storageDriver === "r2") {
        projectPrefix = `jobs/${jobId}/project`;
        await uploadDirectory(dir, projectPrefix);
        await rm(join(config.renderOutputDir, jobId), { recursive: true, force: true });
      }
      const job: RenderJob = {
        id: jobId,
        state: "rendering",
        progress: 45,
        createdAt: new Date().toISOString(),
        revision: { id: randomUUID(), title: `${resolved.brandName ?? String(values.brand_word_1 ?? skill.name)} · ${skill.name}`, scenes: [], values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])), ...(typeof body.brandId === "string" ? { brandId: body.brandId } : {}) }
      };
      const queued = await renderJobRepository.createFormatAndEnqueue(job, {
        ownerId: callerId(request),
        request: { kind: "format", skill: skill.name, version: skill.version, bundle: bundle, sha256: skill.sha256, ...(typeof body.brandId === "string" ? { brandId: body.brandId } : {}) },
        // The worker's whole input: the prepared folder. `skill` is provenance only; the worker ignores it.
        renderInput: { kind: "beat-plan", id: jobId, workerDir: `/renders/${jobId}/project`, ...(projectPrefix ? { projectPrefix } : {}), durationSeconds: built.durationSeconds, canvas: built.canvas, ...(blur.on ? { motionBlur: true } : {}), skill: { name: skill.name, version: skill.version, sha256: skill.sha256, bundle } }
      });
      return reply.code(202).send({ ...queued, format: { skill: skill.name, version: skill.version, sha256: skill.sha256, bundle } });
    } catch (error) {
      await rm(join(config.renderOutputDir, jobId), { recursive: true, force: true }).catch(() => undefined);
      request.log.error({ err: error, skill: skill.name }, "could not queue format render");
      return reply.code(503).send(fail("queue_unavailable", "The render queue is not reachable. Nothing was charged; try again in a moment."));
    }
  });
}
