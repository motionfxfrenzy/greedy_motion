import { anthropicMessage, responseText } from "../anthropic.ts";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { config } from "../config.ts";
export type AuthorStage = "design" | "animation" | "threejs" | "logo" | "interaction" | "skill-authoring" | "audit";
export type AuthorContext = { stage: AuthorStage; skills: string[]; bundleHash: string; prompt: string };
const sha = (x: Buffer | string) => createHash("sha256").update(x).digest("hex");
const base = () => config.cloudAuthorSkillsDir;
const file = {
  contract: "stages/contract.md", design: "stages/design.md", animate: "stages/animate.md", threejs: "stages/threejs.md", logo: "stages/logo.md", interaction: "stages/interaction.md", skill: "stages/skill-authoring.md", audit: "stages/audit.md",
  designSource: "sources/scene-design/modern-web-design/skills/modern-web-design/SKILL.md",
  three: "sources/threejs/threejs-fundamentals/SKILL.md",
  geometry: "sources/threejs/threejs-geometry/SKILL.md", materials: "sources/threejs/threejs-materials/SKILL.md", light: "sources/threejs/threejs-lighting/SKILL.md", threeMotion: "sources/threejs/threejs-animation/SKILL.md", shader: "sources/threejs/threejs-shaders/SKILL.md", loader: "sources/threejs/threejs-loaders/SKILL.md", threeInteract: "sources/threejs/threejs-interaction/SKILL.md", threePerf: "sources/threejs/threejs-postprocessing/SKILL.md",
  gsap: "sources/gsap/gsap-core/SKILL.md", timeline: "sources/gsap/gsap-timeline/SKILL.md", gsapPerf: "sources/gsap/gsap-performance/SKILL.md",
  lottie: "sources/lottie/text-to-lottie/SKILL.md", lottieType: "sources/lottie/text-to-lottie/references/recipe-typography.md", lottieUi: "sources/lottie/text-to-lottie/references/recipe-ui-microinteractions.md", lottieLogo: "sources/lottie/text-to-lottie/references/recipe-logo.md", lottieSpec: "sources/lottie/text-to-lottie/references/lottie-spec-map.md",
  rive: "sources/scene-design/rive-interactive/skills/rive-interactive/SKILL.md", wiggle: "sources/wiggle-logo/wiggle/SKILL.md", wiggleText: "sources/wiggle-logo/wiggle/references/text_animation_guide.md",
  emil: "sources/emil-animation/animate/SKILL.md", emilReview: "sources/emil-animation/review-animations/SKILL.md", remotionDesign: "sources/remotion-craft/remotion-motion-graphics/references/design-rules.md", remotionMotion: "sources/remotion-craft/remotion-motion-graphics/references/motion-patterns.md",
  web3d: "sources/scene-design/web3d-integration-patterns/skills/web3d-integration-patterns/SKILL.md"
} as const;
let loaded: Map<string,string> | null = null;
let bundleHash = "";
async function* walk(dir: string): AsyncGenerator<string> { for (const e of await readdir(dir,{withFileTypes:true})) { const p=join(dir,e.name); if(e.isDirectory()) yield* walk(p); else if(e.isFile()) yield p; } }
export async function loadAuthorSkills() {
  if (loaded) return loaded;
  const manifest = JSON.parse(await readFile(join(base(),"manifest.json"),"utf8")) as {version:number;files:Record<string,string>;sha256:string};
  if (manifest.version !== 1 || sha(JSON.stringify(manifest.files)) !== manifest.sha256) throw new Error("Cloud author skill manifest is invalid.");
  const actual = new Set<string>(); const docs = new Map<string,string>();
  for await (const p of walk(base())) { const rel=relative(base(),p).replaceAll("\\","/"); if(rel==="manifest.json")continue; actual.add(rel);if(!manifest.files[rel])throw new Error(`Unlisted cloud author skill: ${rel}`); const bytes=await readFile(p);if(sha(bytes)!==manifest.files[rel])throw new Error(`Cloud author skill changed: ${rel}`);if(rel.endsWith(".md"))docs.set(rel,bytes.toString("utf8")); }
  if(actual.size!==Object.keys(manifest.files).length)throw new Error("A cloud author skill file is missing.");
  for(const rel of Object.values(file))if(!docs.has(rel))throw new Error(`Required cloud author skill is missing: ${rel}`);
  bundleHash=manifest.sha256;loaded=docs;return docs;
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
  const docs=await loadAuthorSkills(), stage=chosen ?? await routeAuthorStage(task, request), t=task.toLowerCase();
  const keys: (keyof typeof file)[]=["contract"];
  switch(stage){
    case "design":keys.push("design","designSource","remotionDesign");break;
    case "animation":keys.push("animate","gsap","timeline","lottie","lottieType","rive","emil","remotionDesign");if(/\b(icon|button|element)\b/.test(t))keys.push("lottieUi");break;
    case "threejs":keys.push("threejs","three","gsap","web3d");if(/mesh|geometry|model/.test(t))keys.push("geometry");if(/material|pbr|surface/.test(t))keys.push("materials");if(/light|shadow|environment/.test(t))keys.push("light");if(/animate|motion|move|camera/.test(t))keys.push("threeMotion");if(/shader|glsl/.test(t))keys.push("shader");if(/gltf|glb|load/.test(t))keys.push("loader");if(/post|bloom|dof/.test(t))keys.push("threePerf");break;
    case "logo":keys.push("logo","wiggle","wiggleText","lottie","lottieLogo","gsap","remotionDesign");break;
    case "interaction":keys.push("interaction","rive","lottieUi","gsap","emil");break;
    case "skill-authoring":keys.push("skill","designSource","remotionDesign");break;
    case "audit":keys.push("audit","emilReview","gsapPerf","remotionDesign");break;
  }
  const paths=[...new Set(keys.map(k=>file[k]))];
  return {stage,skills:paths.filter(p=>p.startsWith("sources/")),bundleHash,prompt:paths.map(p=>`<skill-source path="${p}">\n${docs.get(p)}\n</skill-source>`).join("\n\n")};
}
