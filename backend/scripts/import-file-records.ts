// One-off import of projects and brand kits saved as JSON files (before Postgres) into app.projects and
// app.brand_kits. Safe to re-run: existing rows are left untouched. Binary files stay where they are.
//
//   node --env-file=.env scripts/import-file-records.ts [--owner <supabase-user-uuid>] [--dry-run]
//
// --owner sets the owner of records that have none; without it they stay unowned (visible only to
// LEGACY_OWNER_ID, or to the local user when AUTH_MODE=none).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../src/config.ts";
import { migrate, pool } from "../src/db/database.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ownerIndex = args.indexOf("--owner");
const owner = ownerIndex >= 0 ? args[ownerIndex + 1] : undefined;
if (owner !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) throw new Error("--owner must be a Supabase user uuid.");
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

async function documents(root: string, file: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isUuid(entry.name)) continue;
    const text = await readFile(join(root, entry.name, file), "utf8").catch(() => null);
    if (!text) continue;
    try { found.push(JSON.parse(text)); } catch { console.warn(`skipped unreadable ${entry.name}/${file}`); }
  }
  return found;
}

await migrate();
const projects = await documents(config.projectsDir, "project.json");
const brands = await documents(config.brandsDir, "brand.json");
let importedProjects = 0, importedBrands = 0;
for (const project of projects) {
  if (!isUuid(project.id)) continue;
  const ownerId = isUuid(project.ownerId) && project.ownerId !== "00000000-0000-4000-8000-000000000000" ? project.ownerId : owner;
  const data = { ...project, ...(ownerId ? { ownerId } : {}) };
  if (!ownerId) delete (data as { ownerId?: unknown }).ownerId;
  if (dryRun) { importedProjects++; continue; }
  const result = await pool.query(
    `insert into app.projects (id, owner_id, name, state, data, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
    [project.id, ownerId ?? null, String(project.name ?? "Untitled video"), String(project.state ?? "Ready to create"), data, project.createdAt ?? new Date().toISOString(), project.updatedAt ?? new Date().toISOString()]
  );
  importedProjects += result.rowCount ?? 0;
}
for (const brand of brands) {
  if (!isUuid(brand.id)) continue;
  const ownerId = isUuid(brand.ownerId) ? brand.ownerId : owner;
  const data = { ...brand, ...(ownerId ? { ownerId } : {}) };
  if (dryRun) { importedBrands++; continue; }
  const result = await pool.query(
    "insert into app.brand_kits (id, owner_id, name, data, created_at) values ($1, $2, $3, $4, $5) on conflict (id) do nothing",
    [brand.id, ownerId ?? null, String(brand.name ?? "Brand kit"), data, brand.createdAt ?? new Date().toISOString()]
  );
  importedBrands += result.rowCount ?? 0;
}
console.log(`${dryRun ? "would import" : "imported"} ${importedProjects}/${projects.length} projects and ${importedBrands}/${brands.length} brand kits${owner ? ` (unowned records assigned to ${owner})` : ""}`);
await pool.end();
