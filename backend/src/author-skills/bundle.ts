import { anthropicMessage } from "../anthropic.ts";
import { skillBundle } from "../skills/loader.ts";
export type AuthorStage = "design" | "animation" | "threejs" | "logo" | "interaction" | "skill-authoring" | "audit";
export type AuthorContext = { stage: AuthorStage; skills: string[]; bundleHash: string; prompt: string };
type StageMap = Record<AuthorStage, { sources: string[]; select?: { pattern: string; sources: string[] }[] }>;
export async function loadAuthorSkills() {
 const bundle = await skillBundle();
 return new Map([...bundle.files].filter(([p]) => p.startsWith("author/") && p.endsWith(".md")).map(([p, bytes]) => [p.slice(7), bytes.toString("utf8")]));
}
export const authorStages = ["design", "animation", "threejs", "logo", "interaction", "skill-authoring", "audit"] as const;
export const isAuthorStage = (value: unknown): value is AuthorStage => typeof value === "string" && (authorStages as readonly string[]).includes(value);
export async function routeAuthorStage(task: string, request = fetch): Promise<AuthorStage> {
  const payload = await anthropicMessage({ model: process.env.ANTHROPIC_ROUTING_MODEL || "claude-haiku-4-5-20251001", max_tokens: 128,
      system: "Classify the task's intent, not isolated words. design: layout/typography/colors (adding a bold style to a headline). animation: linear motion, including a 3D tilt feel or a toggle-like switch animation. threejs: actual Three.js/WebGL geometry or scene implementation. interaction: real user-input state machines, not a depiction of a switch. logo: brand mark motion. skill-authoring: explicitly creating a reusable skill/template package, not styling content. audit: reviewing existing motion. Default to animation when unclear.",
      messages: [{ role: "user", content: task }], output_config: { format: { type: "json_schema", schema: { type: "object", properties: { stage: { type: "string", enum: [...authorStages] } }, required: ["stage"], additionalProperties: false } } }

  }, { request, timeoutMs: 30_000, errorPrefix: "Claude stage classification failed" });
  if (payload.stop_reason === "refusal" || payload.stop_reason === "max_tokens") return "animation";
  try { const result = JSON.parse(payload.content?.filter(b => b.type === "text").map(b => b.text ?? "").join("") ?? ""); return isAuthorStage(result.stage) ? result.stage : "animation"; } catch { return "animation"; }
}
export async function authorContext(task: string, chosen?: AuthorStage, request = fetch): Promise<AuthorContext> {
 const bundle = await skillBundle(), docs = await loadAuthorSkills();
 const stage = chosen ?? await routeAuthorStage(task, request);
 const stages = JSON.parse(bundle.text("author/stages.json")) as StageMap;
 const entry = stages[stage];
 const paths = [...new Set([...entry.sources, ...(entry.select ?? []).filter(rule => new RegExp(rule.pattern, "i").test(task)).flatMap(rule => rule.sources)])];
 for (const path of paths) if (!docs.has(path)) throw new Error(`Required cloud author skill is missing: ${path}`);
 return { stage, skills: paths.filter(p => p.startsWith("sources/")), bundleHash: bundle.bundle, prompt: paths.map(p => `<skill-source path="${p}">\n${docs.get(p)}\n</skill-source>`).join("\n\n") };
}
