import { join } from "node:path";
import { config } from "../config.ts";
import { loadSkillBundle, skillBundle, BundleCorrupt } from "../skills/loader.ts";
import type { SkillSpec } from "./slots.ts";
export { BundleCorrupt } from "../skills/loader.ts";
export type FormatSkill = { name: string; version: string; description: string; sha256: string; dir: string; spec: SkillSpec; guidance: string };
export type LoadedBundle = { bundle: string; skills: Map<string, FormatSkill> };
export async function loadBundle(dir = config.skillsBundleDir): Promise<LoadedBundle> {
 const verified = dir === config.skillsBundleDir ? await skillBundle() : await loadSkillBundle(dir);
 const catalog = JSON.parse(verified.text("formats/catalog.json")) as Record<string, { version: string; description: string; sha256: string }>;
 const skills = new Map<string, FormatSkill>();
 for (const [name, entry] of Object.entries(catalog)) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new BundleCorrupt(`Invalid format name: ${name}`);
  const spec = JSON.parse(verified.text(`formats/${name}/slots.json`)) as SkillSpec;
  if (spec.skill !== name || spec.version !== entry.version) throw new BundleCorrupt(`Skill ${name}: slots.json differs from the catalog.`);
  skills.set(name, { name, ...entry, dir: join(dir, "formats", name), spec, guidance: verified.text(`formats/${name}/fill-guidance.md`) });
 }
 return { bundle: verified.bundle, skills };
}
let cached: Promise<LoadedBundle> | undefined;
export const formatBundle = () => cached ??= loadBundle();
