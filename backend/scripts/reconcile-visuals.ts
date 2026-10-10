import { readFile } from "node:fs/promises";
import { getProject, updateProjectVisuals } from "../src/projects/store.ts";
import { pool } from "../src/db/database.ts";
import { reconcileVisuals, type VisualRecovery } from "../src/plan/visual-recovery.ts";

const [id, file, flag] = process.argv.slice(2);
try {
  if (!id || !file || (flag && flag !== "--apply")) throw new Error("Usage: node scripts/reconcile-visuals.ts PROJECT_ID recovery.json [--apply] (dry run by default)");
  const input = JSON.parse(await readFile(file, "utf8")) as VisualRecovery;
  const project = await getProject(id);
  const proposed = reconcileVisuals(project?.planVisuals, input);
  console.log(JSON.stringify({ projectId: id, runId: input.runId, action: input.action, shot: input.shot, apply: flag === "--apply", reservedUsd: proposed.reservedUsd }, null, 2));
  if (flag === "--apply") await updateProjectVisuals(id, p => reconcileVisuals(p.planVisuals, input));
} finally { await pool.end(); }
