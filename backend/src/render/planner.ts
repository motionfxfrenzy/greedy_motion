import { describeScene, findTemplate, templateValue, validateTemplateValues, type BrandKit, type PlannerInfo, type ProjectReviewComment, type ProjectScript, type RenderRequest, type Scene, type Template, type TemplateValues } from "@videosaas/contracts";

/** Every starter template is 10 seconds; scene lengths come from the template catalog. */
export const VIDEO_SECONDS = 10;

export type Plan = { title: string; scenes: Scene[]; template: string; values: TemplateValues; narration?: string; musicPrompt?: string; motionStyle?: RenderRequest["style"] };
export type ReviewRevision = { script: ProjectScript; comments: ProjectReviewComment[] };

export interface PromptPlanner {
  readonly info: PlannerInfo;
  plan(request: RenderRequest, brand?: BrandKit, revision?: ReviewRevision): Promise<Plan>;
}

export function requireTemplate(id: string): Template {
  const template = findTemplate(id);
  if (!template) throw new Error(`Unknown template "${id}".`);
  return template;
}

/** Builds the storyboard view and title from a template and its filled values. */
export function planFromValues(template: Template, values: TemplateValues): Plan {
  const scenes = template.scenes.map((scene) => ({ id: scene.id, label: scene.label, detail: describeScene(template, scene, values), duration: scene.duration }));
  const headlineId = template.scenes.flatMap((scene) => scene.variables).find((id) => {
    const variable = template.variables.find((item) => item.id === id);
    return variable?.type === "string" && variable.aiFill === "write" && id !== "brandName" && id !== "version";
  });
  const title = String(headlineId ? templateValue(template, values, headlineId) : template.name).slice(0, 72);
  return { title, scenes, template: template.id, values };
}

/** Offline planner, used only when PLANNER=deterministic: renders the template with its default copy. */
export class DeterministicPromptPlanner implements PromptPlanner {
  readonly info: PlannerInfo = { provider: "deterministic" };

  async plan(request: RenderRequest, _brand?: BrandKit) {
    const template = requireTemplate(request.template);
    const plan = planFromValues(template, {});
    const narration = request.audio?.voiceover ? plan.scenes.slice(0, 2).map((scene) => scene.detail.split(" · ")[0]).join(". ").slice(0, 140) : undefined;
    const musicPrompt = request.audio?.music ? `${request.style === "kinetic" ? "Driving, energetic" : request.style === "editorial" ? "Warm, textured" : "Bright, modern"} instrumental tech background, light percussion` : undefined;
    return { ...plan, ...(narration ? { narration } : {}), ...(musicPrompt ? { musicPrompt } : {}) };
  }
}

/** The brand kit is the source of truth for the product's name and website: it overrides planner copy. */
export function applyBrand(plan: Plan, brand: BrandKit): Plan {
  const template = requireTemplate(plan.template);
  const domain = brand.url ? brand.url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "") : undefined;
  const merged = { ...plan.values, brandName: brand.name, ...(domain ? { url: domain.slice(0, 40) } : {}) };
  const result = validateTemplateValues(template, merged);
  return { ...plan, ...planFromValues(template, "error" in result ? plan.values : result.values) };
}
