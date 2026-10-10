import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { listFiles, sha256, skillDigest } from "../formats/digest.ts";
export class BundleCorrupt extends Error {}
export type SkillBundle = { bundle: string; files: Map<string, Buffer>; text: (path: string) => string };
export async function loadSkillBundle(dir = config.skillsBundleDir): Promise<SkillBundle> {
 try {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as { format: number; bundle: string; files: Record<string, string> };
  if (manifest.format !== 2) throw new BundleCorrupt("The skill bundle manifest has an unknown format.");
  const actual = (await listFiles(dir)).filter(p => p !== "manifest.json"), expected = Object.keys(manifest.files).sort();
  if (actual.join("\n") !== expected.join("\n")) {
   const missing = expected.find(p => !actual.includes(p)), extra = actual.find(p => !expected.includes(p));
   throw new BundleCorrupt(`Skill bundle: ${missing ? `missing ${missing}` : `unlisted ${extra}`}.`);
  }
  const files = new Map<string, Buffer>();
  for (const path of expected) {
   // Never allow manifest paths to escape the bundle.
   if (!/^(director|formats|author)\//.test(path) || path.split("/").some(p => p === ".." || p === "." || !p) || path.includes("\\")) throw new BundleCorrupt(`Invalid skill path: ${path}`);
   const bytes = await readFile(join(dir, path));
   if (sha256(bytes) !== manifest.files[path]) throw new BundleCorrupt(`Skill bundle: ${path} does not match its recorded hash.`);
   files.set(path, bytes);
  }
  if (skillDigest(manifest.files) !== manifest.bundle) throw new BundleCorrupt("The skill bundle digest does not match its files.");
  return { bundle: manifest.bundle, files, text: path => { const bytes = files.get(path); if (!bytes) throw new BundleCorrupt(`Missing skill document: ${path}`); return bytes.toString("utf8"); } };
 } catch (error) {
  if (error instanceof BundleCorrupt) throw error;
  throw new BundleCorrupt(`The skill bundle at ${dir} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
 }
}
let cached: Promise<SkillBundle> | undefined;
export const skillBundle = () => cached ??= loadSkillBundle();
