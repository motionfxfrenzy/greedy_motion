// Content hashing for the skill bundle. Pure (no config, no env), so the bundle builder script, the CI freshness
// check and the backend's startup verification all compute exactly the same hashes.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Every file under `dir` as a sorted list of POSIX-style relative paths. */
export async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path, base)));
    else if (entry.isSymbolicLink()) throw new Error(`Skill bundles cannot contain symlinks: ${path}`);
    else if (entry.isFile()) out.push(path.slice(base.length + 1).split(sep).join("/"));
  }
  return out.sort();
}

/** path -> sha256 for every file under `dir`. */
export async function hashDirectory(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const file of await listFiles(dir)) files[file] = sha256(await readFile(join(dir, file)));
  return files;
}

/** One skill's identity: the hash of its sorted `path<TAB>hash` lines. */
export const skillDigest = (files: Record<string, string>) =>
  sha256(Object.keys(files).sort().map((path) => `${path}\t${files[path]}\n`).join(""));

/** The whole bundle's identity: the hash of its sorted `skill<TAB>digest` lines. */
export const bundleDigest = (skills: Record<string, { sha256: string }>) =>
  sha256(Object.keys(skills).sort().map((name) => `${name}\t${skills[name]!.sha256}\n`).join(""));
