// Screenshot understanding: a vision read of each uploaded screenshot (what it is, what is on it, where), stored on the
// project so the director knows what every image shows and where it belongs, and the storyboard can say so.
import sharp from "sharp";
import type { ScreenshotAnalysis, VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
import { llmJson } from "../llm.ts";
import { getProject, screenshotFile, setScreenshotAnalysis } from "../projects/store.ts";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "summary", "kind", "elements", "best_for", "regions"],
  properties: {
    title: { type: "string" }, summary: { type: "string" },
    kind: { type: "string", enum: ["dashboard", "table", "chart", "form", "settings", "editor", "landing", "mobile", "chat", "code", "document", "other"] },
    elements: { type: "array", items: { type: "string" } },
    best_for: { type: "string" },
    regions: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "where"], properties: { label: { type: "string" }, where: { type: "string" } } } }
  }
} as const;

const SYSTEM = [
  "You describe a product screenshot for a video director who cannot see it. Be exact and literal: only what is visible.",
  "title: what the screen is, 2-6 words ('Team workload dashboard'). summary: one or two sentences on what it shows and what a person does here.",
  "elements: the visible UI parts and any readable labels or numbers, most important first, at most 10 (quote visible text exactly; do not invent text you cannot read).",
  "best_for: what a film can honestly use this screen to show, in one phrase ('showing live task status per teammate').",
  "regions: up to 6 places on the screen a film could zoom to or call out, each with a label and where it is ('top-right', 'left sidebar', 'centre chart', 'bottom bar')."
].join("\n");

/** Reads one screenshot; null when the read fails (the film is still made, just from the filename and purpose). */
export async function analyzeScreenshot(bytes: Buffer, name: string, purpose: string): Promise<ScreenshotAnalysis | null> {
  if (config.planner !== "anthropic" || !config.anthropicApiKey) return null;
  try {
    const jpeg = await sharp(bytes).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    const result = await llmJson({ provider: "anthropic", model: process.env.SCREENSHOT_MODEL || "claude-sonnet-5-5", system: SYSTEM, user: `File name: ${name}. The person labelled it: ${purpose}. Describe it.`, images: [{ mime: "image/jpeg", base64: jpeg.toString("base64") }], schema: SCHEMA, maxTokens: 1200, timeoutMs: 60_000 });
    const raw = JSON.parse(result.text) as { title: string; summary: string; kind: string; elements: string[]; best_for: string; regions: { label: string; where: string }[] };
    return { title: raw.title.slice(0, 80), summary: raw.summary.slice(0, 400), kind: raw.kind, elements: raw.elements.slice(0, 10).map((item) => item.slice(0, 80)), bestFor: raw.best_for.slice(0, 160), regions: raw.regions.slice(0, 6).map((region) => ({ label: region.label.slice(0, 60), where: region.where.slice(0, 40) })) };
  } catch {
    return null;
  }
}

/** Reads and stores the analysis of one screenshot; safe to call without awaiting. */
export async function describeScreenshot(projectId: string, screenshotId: string): Promise<ScreenshotAnalysis | null> {
  const project = await getProject(projectId);
  const shot = project?.screenshots.find((item) => item.id === screenshotId);
  const file = shot ? await screenshotFile(projectId, screenshotId) : null;
  if (!shot || !file) return null;
  const analysis = await analyzeScreenshot(file.data, shot.name, shot.purpose);
  if (analysis) await setScreenshotAnalysis(projectId, screenshotId, analysis);
  return analysis;
}

/** Before planning: reads any screenshot that has no analysis yet (an upload still in flight, or a failed read), in parallel, within `waitMs`. */
export async function ensureDescribed(project: VideoProject, waitMs = 25_000): Promise<VideoProject> {
  const missing = project.screenshots.filter((shot) => !shot.analysis);
  if (!missing.length) return project;
  await Promise.race([Promise.allSettled(missing.map((shot) => describeScreenshot(project.id, shot.id))), new Promise((resolve) => setTimeout(resolve, waitMs))]);
  return (await getProject(project.id)) ?? project;
}
