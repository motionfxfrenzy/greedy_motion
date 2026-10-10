import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import {
  findTemplate,
  parseRenderRequest,
  validateTemplateValues,
  type ProjectReviewComment,
  type ProjectScript,
  type ProjectScreenshot,
  type ProjectState,
  type ProjectStudioDraft,
  type VideoProject
} from "@videosaas/contracts";
import { config } from "../config.ts";
import { query, withRowLock } from "../db/database.ts";
import { readMedia, removeMedia, saveMedia } from "../media.ts";

const projectDir = (id: string) => join(config.projectsDir, id);
const screenshotsDir = (id: string) => join(projectDir(id), "screenshots");
const idPattern = /^[0-9a-f-]{36}$/i;
const states: ProjectState[] = ["Ready to create", "Finish your brief", "Draft storyboard", "Rendering draft", "Ready for review", "Revisions needed", "Approved", "Render needs attention"];

export class ProjectInvalid extends Error {}

/** Records written before ownership existed belong to config.legacyOwnerId (nobody, unless an operator adopts them). */
export const projectOwner = (project: Pick<VideoProject, "ownerId">) => project.ownerId ?? config.legacyOwnerId;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A project can be updated by the API request and the asynchronous render job at nearly the same time.
 * Each read-modify-write runs under a row lock; the in-process chain keeps same-replica callers from each
 * holding a pooled connection while they wait on that lock.
 */
const writeChains = new Map<string, Promise<unknown>>();
function serializeProject<T>(id: string, operation: () => Promise<T>) {
  const previous = writeChains.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => withRowLock("app.projects", id, operation));
  writeChains.set(id, next);
  void next.finally(() => {
    if (writeChains.get(id) === next) writeChains.delete(id);
  }).catch(() => undefined);
  return next;
}

async function save(project: VideoProject) {
  await query(
    `insert into app.projects (id, owner_id, name, state, data, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do update set name = excluded.name, state = excluded.state, data = excluded.data, updated_at = excluded.updated_at`,
    [project.id, project.ownerId ?? null, project.name, project.state, project, project.createdAt, project.updatedAt]
  );
  return project;
}

export async function listProjects(ownerId?: string) {
  // Unowned (pre-ownership) rows belong to config.legacyOwnerId, matching projectOwner().
  const { rows } = ownerId === undefined
    ? await query<{ data: unknown }>("select data from app.projects order by updated_at desc")
    : await query<{ data: unknown }>(
        "select data from app.projects where owner_id = $1 or (owner_id is null and $1 = $2) order by updated_at desc",
        [ownerId, config.legacyOwnerId || null]
      );
  return rows.map((row) => normalizeProject(row.data));
}

/**
 * Project JSON is durable user data, so load drafts defensively. A stale
 * template field is ignored instead of making an otherwise valid project
 * unreadable after a template catalog update.
 */
function normalizeStudioDraft(project: Pick<VideoProject, "request" | "screenshots">, raw: unknown): ProjectStudioDraft | undefined {
  if (!isRecord(raw)) return undefined;
  const template = findTemplate(project.request.template);
  if (!template || !isRecord(raw.values) || !isRecord(raw.assets)) return undefined;
  const checked = validateTemplateValues(template, raw.values);
  if ("error" in checked) return undefined;
  const imageVariables = new Set(template.variables.filter((variable) => variable.type === "image").map((variable) => variable.id));
  const screenshotIds = new Set(project.screenshots.map((screenshot) => screenshot.id));
  const assets: Record<string, string> = {};
  for (const [variableId, screenshotId] of Object.entries(raw.assets)) {
    if (imageVariables.has(variableId) && typeof screenshotId === "string" && screenshotIds.has(screenshotId)) assets[variableId] = screenshotId;
  }
  const revision = typeof raw.revision === "number" && Number.isSafeInteger(raw.revision) && raw.revision > 0 ? raw.revision : 1;
  const updatedAt = typeof raw.updatedAt === "string" && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : new Date(0).toISOString();
  return { revision, values: checked.values, assets, updatedAt };
}

function normalizeProject(raw: unknown): VideoProject {
  const { studio: rawStudio, screenshots: rawScreenshots, comments: rawComments, ...project } = raw as VideoProject;
  const screenshots = Array.isArray(rawScreenshots) ? rawScreenshots : [];
  const comments = Array.isArray(rawComments) ? rawComments : [];
  const base = { ...project, screenshots, comments } as VideoProject;
  const studio = normalizeStudioDraft(base, rawStudio);
  return { ...base, ...(studio ? { studio } : {}) };
}

export async function getProject(id: string) {
  if (!idPattern.test(id)) return null;
  const { rows } = await query<{ data: unknown }>("select data from app.projects where id = $1", [id]);
  if (!rows[0]) return null;
  const project = normalizeProject(rows[0].data);
  const brandId = project.brief?.brandId ?? project.request.brandId;
  delete project.visualBrandSignature;
  if (brandId) {
    const brand = await query<{ data: { colors: unknown; mode?: string } }>("select data from app.brand_kits where id = $1", [brandId]);
    project.visualBrandSignature = createHash("sha256").update(JSON.stringify(brand.rows[0] ? { colors: brand.rows[0].data.colors, mode: brand.rows[0].data.mode } : null)).digest("hex");
  }
  return project;
}

export async function createProject(input: { name?: unknown; request?: unknown }, ownerId: string) {
  const request = parseRenderRequest(input.request);
  if (!request) throw new ProjectInvalid("Choose a template, format, and motion style before creating the project.");
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  const now = new Date().toISOString();
  return save({ id: randomUUID(), ownerId, name: name || "Untitled video", state: "Ready to create", createdAt: now, updatedAt: now, request, screenshots: [], comments: [] });
}

type ProjectUpdate = { name?: unknown; request?: unknown; state?: unknown; script?: unknown; renderJobId?: unknown; approvedAt?: unknown };

function cleanScript(value: unknown): ProjectScript | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.source !== "generated" && candidate.source !== "provided") throw new ProjectInvalid("The script source is invalid.");
  if (!Array.isArray(candidate.lines) || candidate.lines.length === 0 || candidate.lines.length > 12) throw new ProjectInvalid("A script needs between one and twelve scenes.");
  const lines = candidate.lines.map((line) => {
    if (!line || typeof line !== "object") throw new ProjectInvalid("Each script scene must be valid.");
    const item = line as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim().slice(0, 32) : "";
    const onScreen = typeof item.onScreen === "string" ? item.onScreen.trim().slice(0, 180) : "";
    const voiceover = typeof item.voiceover === "string" ? item.voiceover.trim().slice(0, 240) : undefined;
    if (!label || !onScreen) throw new ProjectInvalid("Each script scene needs a label and on-screen text.");
    return { label, onScreen, ...(voiceover ? { voiceover } : {}) };
  });
  return { source: candidate.source, lines, confirmed: candidate.confirmed === true, updatedAt: new Date().toISOString() };
}

type StudioPatch = { values?: unknown; assets?: unknown };

const sameRecord = (left: Record<string, string | number>, right: Record<string, string | number>) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
};

/**
 * Studio only persists declared text/number variables and references to files
 * owned by this project. The renderer remains the sole owner of logo and
 * boolean variables, which prevents callers from injecting arbitrary URLs.
 */
function cleanStudioDraft(project: VideoProject, input: StudioPatch): Omit<ProjectStudioDraft, "revision" | "updatedAt"> {
  if (!isRecord(input) || (input.values === undefined && input.assets === undefined)) throw new ProjectInvalid("Save at least one Studio value or asset.");
  const template = findTemplate(project.request.template);
  if (!template) throw new ProjectInvalid("The selected video template is unavailable.");

  const rawValues = input.values === undefined ? project.studio?.values ?? {} : input.values;
  if (!isRecord(rawValues)) throw new ProjectInvalid("Studio values must be an object.");
  const editableVariables = new Set(template.variables.filter((variable) => variable.type !== "image" && variable.type !== "boolean").map((variable) => variable.id));
  for (const key of Object.keys(rawValues)) {
    if (!editableVariables.has(key)) throw new ProjectInvalid(`\"${key}\" cannot be edited in this template.`);
  }
  const checked = validateTemplateValues(template, rawValues);
  if ("error" in checked) throw new ProjectInvalid(checked.error);

  const rawAssets = input.assets === undefined ? project.studio?.assets ?? {} : input.assets;
  if (!isRecord(rawAssets)) throw new ProjectInvalid("Studio assets must be an object.");
  const imageVariables = new Set(template.variables.filter((variable) => variable.type === "image").map((variable) => variable.id));
  const screenshotIds = new Set(project.screenshots.map((screenshot) => screenshot.id));
  const assets: Record<string, string> = {};
  for (const [variableId, screenshotId] of Object.entries(rawAssets)) {
    if (!imageVariables.has(variableId)) throw new ProjectInvalid(`\"${variableId}\" is not an image slot in this template.`);
    if (screenshotId === "") continue;
    if (typeof screenshotId !== "string" || !screenshotIds.has(screenshotId)) throw new ProjectInvalid("Choose one of this project's verified screenshots.");
    assets[variableId] = screenshotId;
  }
  // Current templates have one image slot named `screenshot`. Preserve the
  // product's established first-upload behavior until the user chooses another.
  if (imageVariables.has("screenshot") && !assets.screenshot && project.screenshots[0]) assets.screenshot = project.screenshots[0].id;
  return { values: checked.values, assets };
}

/** Saves a real Studio revision; it never stores a client-provided file path or markup. */
export async function updateProjectStudio(id: string, input: StudioPatch) {
  return serializeProject(id, async () => {
    const current = await getProject(id);
    if (!current) return null;
    if (current.state === "Rendering draft") throw new ProjectInvalid("Wait for the current render to finish before editing its Studio draft.");
    const next = cleanStudioDraft(current, input);
    const unchanged = current.studio && sameRecord(current.studio.values, next.values) && sameRecord(current.studio.assets, next.assets);
    if (unchanged) return current;

    const now = new Date().toISOString();
    const studio: ProjectStudioDraft = {
      revision: (current.studio?.revision ?? 0) + 1,
      values: next.values,
      assets: next.assets,
      updatedAt: now
    };
    // A changed Studio revision cannot remain approved or be presented as the
    // last reviewed render. The previous MP4 stays on disk for auditability,
    // while the project clearly asks for a new render.
    const requiresNewRender = ["Ready for review", "Revisions needed", "Approved", "Render needs attention"].includes(current.state);
    const { approvedAt: _approvedAt, ...withoutApproval } = current;
    return save({
      ...withoutApproval,
      studio,
      state: requiresNewRender ? "Draft storyboard" : current.state,
      updatedAt: now
    });
  });
}

export async function updateProject(id: string, update: ProjectUpdate) {
  return serializeProject(id, async () => {
    const current = await getProject(id);
    if (!current) return null;
    const name = update.name === undefined ? current.name : typeof update.name === "string" ? update.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
    if (!name) throw new ProjectInvalid("A project name is required.");
    const request = update.request === undefined ? current.request : parseRenderRequest(update.request);
    if (!request) throw new ProjectInvalid("The project brief is invalid.");
    const state = update.state === undefined ? current.state : states.includes(update.state as ProjectState) ? update.state as ProjectState : null;
    if (!state) throw new ProjectInvalid("The project state is invalid.");
    const script = update.script === undefined ? current.script : cleanScript(update.script);
    const renderJobId = update.renderJobId === undefined ? current.renderJobId : typeof update.renderJobId === "string" && idPattern.test(update.renderJobId) ? update.renderJobId : undefined;
    const approvedAt = update.approvedAt === undefined ? current.approvedAt : typeof update.approvedAt === "string" ? update.approvedAt : undefined;
    // Variable ids belong to a template. Dropping a draft on a template switch
    // is safer than carrying values into unrelated slots.
    const { studio: _studio, ...withoutStudio } = current;
    const base = request.template === current.request.template ? current : withoutStudio;
    return save({ ...base, name, request, state, ...(script ? { script } : {}), ...(renderJobId ? { renderJobId } : {}), ...(approvedAt ? { approvedAt } : {}), updatedAt: new Date().toISOString() });
  });
}

const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg" };

export async function addScreenshot(projectId: string, name: string, mime: string, bytes: Buffer, purpose: ProjectScreenshot["purpose"] = "Dashboard") {
  const extension = extensions[mime];
  if (!extension) throw new ProjectInvalid("Upload a PNG or JPEG screenshot.");
  if (bytes.length === 0 || bytes.length > 20_000_000) throw new ProjectInvalid("Screenshots must be between 1 byte and 20 MB.");
  let metadata: sharp.Metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata(); } catch { throw new ProjectInvalid("That screenshot could not be read."); }
  if (!metadata.width || !metadata.height || metadata.width < 640) throw new ProjectInvalid("Screenshots need to be at least 640 pixels wide.");
  const screenshot: ProjectScreenshot = { id: randomUUID(), name: name.trim().slice(0, 120) || "screenshot", purpose, width: metadata.width, height: metadata.height, createdAt: new Date().toISOString() };
  return serializeProject(projectId, async () => {
    const project = await getProject(projectId);
    if (!project) return null;
    await saveMedia(join(screenshotsDir(projectId), screenshot.id + extension), bytes);
    return save({ ...project, screenshots: [...project.screenshots, screenshot], state: project.state === "Ready to create" ? "Finish your brief" : project.state, updatedAt: new Date().toISOString() });
  });
}

export async function removeScreenshot(projectId: string, screenshotId: string) {
  if (!idPattern.test(screenshotId)) return null;
  return serializeProject(projectId, async () => {
    const project = await getProject(projectId);
    if (!project) return null;
    const screenshot = project.screenshots.find((item) => item.id === screenshotId);
    if (!screenshot) return project;
    await Promise.all([".png", ".jpg"].map((extension) => removeMedia(join(screenshotsDir(projectId), screenshotId + extension)).catch(() => undefined)));
    const screenshots = project.screenshots.filter((item) => item.id !== screenshotId);
    const draftAssets = project.studio?.assets;
    const assets = draftAssets && Object.fromEntries(Object.entries(draftAssets).filter(([, assetId]) => assetId !== screenshotId));
    if (assets && !assets.screenshot && screenshots[0]) assets.screenshot = screenshots[0].id;
    const changedDraft = Boolean(draftAssets && assets && !sameRecord(draftAssets, assets));
    const now = new Date().toISOString();
    return save({
      ...project,
      screenshots,
      ...(changedDraft && project.studio ? { studio: { ...project.studio, assets: assets!, revision: project.studio.revision + 1, updatedAt: now } } : {}),
      updatedAt: now
    });
  });
}

function cleanReviewComment(value: unknown): Pick<ProjectReviewComment, "body" | "timestampSeconds"> {
  if (!value || typeof value !== "object") throw new ProjectInvalid("Write a review comment before saving.");
  const input = value as Record<string, unknown>;
  const body = typeof input.body === "string" ? input.body.trim().replace(/\s+/g, " ") : "";
  const timestampSeconds = typeof input.timestampSeconds === "number" ? input.timestampSeconds : Number.NaN;
  if (body.length < 3 || body.length > 600) throw new ProjectInvalid("Review comments must be between 3 and 600 characters.");
  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0 || timestampSeconds > 3_600) throw new ProjectInvalid("Choose a valid moment in the video.");
  return { body, timestampSeconds: Math.round(timestampSeconds * 10) / 10 };
}

export async function addReviewComment(projectId: string, input: unknown) {
  const comment = cleanReviewComment(input);
  return serializeProject(projectId, async () => {
    const project = await getProject(projectId);
    if (!project) return null;
    if (project.state !== "Ready for review" && project.state !== "Revisions needed") throw new ProjectInvalid("Comments can be added after a draft render is ready.");
    const saved: ProjectReviewComment = { id: randomUUID(), ...comment, createdAt: new Date().toISOString() };
    return save({ ...project, comments: [...project.comments, saved], state: "Revisions needed", updatedAt: new Date().toISOString() });
  });
}

export async function removeReviewComment(projectId: string, commentId: string) {
  if (!idPattern.test(commentId)) return null;
  return serializeProject(projectId, async () => {
    const project = await getProject(projectId);
    if (!project) return null;
    const comments = project.comments.filter((comment) => comment.id !== commentId);
    if (comments.length === project.comments.length) return project;
    return save({ ...project, comments, state: comments.length === 0 && project.state === "Revisions needed" ? "Ready for review" : project.state, updatedAt: new Date().toISOString() });
  });
}

/** Atomically records the AI-revised script and consumes exactly the comments it used. */
export async function applyReviewComments(projectId: string, input: { request: unknown; script: unknown; commentIds: string[]; renderJobId: string; studioValues?: unknown }) {
  return serializeProject(projectId, async () => {
    const project = await getProject(projectId);
    if (!project) return null;
    if (project.state !== "Revisions needed" || project.comments.length === 0) throw new ProjectInvalid("There are no pending review comments to apply.");
    if (!Array.isArray(input.commentIds) || !idPattern.test(input.renderJobId)) throw new ProjectInvalid("The revision request is invalid.");
    const currentIds = project.comments.map((comment) => comment.id).sort();
    const submittedIds = [...new Set(input.commentIds)].sort();
    if (currentIds.length !== submittedIds.length || currentIds.some((id, index) => id !== submittedIds[index])) throw new ProjectInvalid("Review comments changed while the revision was being prepared. Apply the current list again.");
    const script = cleanScript(input.script);
    if (!script?.confirmed) throw new ProjectInvalid("The revised script must be confirmed before rendering.");
    const request = parseRenderRequest(input.request);
    if (!request) throw new ProjectInvalid("The revised render settings are invalid.");
    const now = new Date().toISOString();
    const nextStudio = input.studioValues === undefined
      ? project.studio
      : cleanStudioDraft(project, { values: input.studioValues, assets: project.studio?.assets ?? {} });
    const studioChanged = nextStudio && (!project.studio || !sameRecord(project.studio.values, nextStudio.values) || !sameRecord(project.studio.assets, nextStudio.assets));
    const studio = nextStudio
      ? {
          revision: studioChanged ? (project.studio?.revision ?? 0) + 1 : project.studio?.revision ?? 1,
          values: nextStudio.values,
          assets: nextStudio.assets,
          updatedAt: studioChanged ? now : project.studio?.updatedAt ?? now
        }
      : undefined;
    return save({ ...project, request, script, comments: [], state: "Rendering draft", renderJobId: input.renderJobId, ...(studio ? { studio } : {}), updatedAt: now });
  });
}

export async function screenshotFile(projectId: string, screenshotId: string) {
  if (!idPattern.test(projectId) || !idPattern.test(screenshotId)) return null;
  for (const extension of [".png", ".jpg"]) {
    const file = join(screenshotsDir(projectId), screenshotId + extension);
    const data = await readMedia(file).catch(() => null);
    if (data) return { file, data, mime: extension === ".png" ? "image/png" : "image/jpeg" };
  }
  return null;
}

/**
 * Product flow v2 (backend/src/plan): saves the Script & Style brief, the director's beat plan and
 * the matching script through the same serialised write path as every other project update.
 * `mutate` receives the current project and returns the fields to change.
 */
export async function updateProjectPlan(id: string, mutate: (current: VideoProject) => Pick<VideoProject, "brief" | "beatPlan"> & Partial<Pick<VideoProject, "script" | "state" | "request">>) {
  return serializeProject(id, async () => {
    const current = await getProject(id);
    if (!current) return null;
    if (current.state === "Rendering draft") throw new ProjectInvalid("Wait for the current render to finish before changing the plan.");
    const changes = mutate(current);
    const { approvedAt: _approvedAt, ...withoutApproval } = current;
    return save({ ...withoutApproval, ...changes, updatedAt: new Date().toISOString() });
  });
}

/**
 * Saves the plan's generated sound. `mutate` sees the latest project, so takes made while the
 * storyboard was being edited are merged against the current plan (a take whose line changed
 * meanwhile simply no longer matches; see `currentTake`). Approval is kept: audio is derived data.
 */
export async function updateProjectAudio(id: string, mutate: (current: VideoProject) => VideoProject["planAudio"]) {
  return serializeProject(id, async () => {
    const current = await getProject(id);
    if (!current) return null;
    return save({ ...current, planAudio: mutate(current), updatedAt: new Date().toISOString() });
  });
}

/** Saves what was read from the product's website (backend/src/site). */
export async function updateProjectSite(id: string, site: VideoProject["site"]) {
  return serializeProject(id, async () => {
    const current = await getProject(id);
    if (!current) return null;
    return save({ ...current, site, updatedAt: new Date().toISOString() });
  });
}

/**
 * Pro Editor (backend/src/pro): records the editable folder's manifest. `mutate` runs under the project's row lock,
 * so the file writes it performs and the revision bump are one step against every other writer. Returning
 * `undefined` leaves the project unchanged.
 */
export async function updateProjectPro(id: string, mutate: (current: VideoProject) => Promise<VideoProject["pro"] | undefined>) {
  return serializeProject(id, async () => {
    const current = await getProject(id);
    if (!current) return null;
    const pro = await mutate(current);
    if (!pro) return current;
    return save({ ...current, pro, updatedAt: new Date().toISOString() });
  });
}

/** A short row-locked update; enqueue callbacks may join the transaction, never call media APIs here. */
export async function updateProjectVisuals(id: string, mutate: (current: VideoProject) => Promise<VideoProject["planVisuals"]> | VideoProject["planVisuals"]) {
  return serializeProject(id, async () => {
    const current = await getProject(id);
    if (!current) return null;
    const planVisuals = await mutate(current);
    return save({ ...current, planVisuals, updatedAt: new Date().toISOString() });
  });
}
