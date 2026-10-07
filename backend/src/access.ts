import type { FastifyInstance, FastifyReply } from "fastify";
import { callerId, isOpen } from "./auth.ts";
import { brandOwner, getBrand } from "./brand/store.ts";
import { getProject, listProjects, projectOwner } from "./projects/store.ts";
import { renderJobRepository } from "./render/repository.ts";
import { config } from "./config.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const projectPath = new RegExp(`^/v1/projects/(${uuid})(?:/|$)`, "i");
const brandPath = new RegExp(`^/v1/brands/(${uuid})(?:/|$)`, "i");
const jobPath = new RegExp(`^/v1/render-jobs/(${uuid})$`, "i");

const notFound = (reply: FastifyReply, message: string) => reply.code(404).send({ error: { code: "not_found", message } });

async function jobOwner(id: string) {
  const row = await renderJobRepository.row(id);
  if (row) {
    if (row.project_id) {
      const project = await getProject(row.project_id);
      return project ? projectOwner(project) : null;
    }
    return row.owner_id ?? config.legacyOwnerId;
  }
  // Jobs from before the database existed are recovered through the project that references them.
  const project = (await listProjects()).find((item) => item.renderJobId === id);
  return project ? projectOwner(project) : undefined;
}

/**
 * Per-user data isolation. Runs after authentication: a project, brand kit or render job that belongs to
 * someone else is indistinguishable from one that does not exist (404), so ids cannot be probed.
 * Records that do not exist fall through to the route's own 404.
 */
export function registerOwnership(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (isOpen(request)) return;
    const path = request.url.split("?")[0];
    const me = callerId(request);

    const projectId = projectPath.exec(path)?.[1];
    if (projectId) {
      const project = await getProject(projectId);
      if (project && projectOwner(project) !== me) return notFound(reply, "Project not found.");
    }
    const brandId = brandPath.exec(path)?.[1];
    if (brandId) {
      const kit = await getBrand(brandId);
      if (kit && brandOwner(kit) !== me) return notFound(reply, "Brand kit not found.");
    }
    const jobId = jobPath.exec(path)?.[1];
    if (jobId) {
      const owner = await jobOwner(jobId);
      if (owner !== undefined && owner !== me) return notFound(reply, "That render job does not exist.");
    }

    // A request may reference a brand kit it does not own (project create/update, render, plan brief).
    const body = request.body;
    if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
      const record = body as { brandId?: unknown; request?: { brandId?: unknown } };
      for (const referenced of [record.brandId, record.request?.brandId]) {
        if (typeof referenced !== "string") continue;
        const kit = await getBrand(referenced);
        if (kit && brandOwner(kit) !== me) return notFound(reply, "Brand kit not found.");
      }
    }
  });
}
