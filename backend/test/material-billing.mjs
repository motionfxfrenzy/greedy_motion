// Generated scenes are charged in tokens at the material markup, once per film: the price is the provider's list price, a failed
// queueing gives the tokens back, a resumed run does not pay twice, and a changed storyboard pays for a new film.
// Run: node --env-file=.env test/material-billing.mjs   (needs DATABASE_URL, a disposable test database)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.PLANNER = "deterministic";
process.env.GEMINI_API_KEY = "offline-test-never-sent";
const { migrate, pool, query } = await import("../src/db/database.ts");
const { startQueues, boss, QUEUES } = await import("../src/jobs/queues.ts");
const { getProject, updateProjectVisuals } = await import("../src/projects/store.ts");
const { enqueueVisuals } = await import("../src/plan/visuals.ts");
const { materialPriceUsd, materialOwedUsd, visualStatus } = await import("../src/plan/visual-state.ts");
const { grantTokens, spendTokens, refundSpend, tokenSummary } = await import("../src/tokens/store.ts");
const { materialCostMillitokens, MATERIAL_MARKUP } = await import("@videosaas/contracts");

const id = randomUUID(), owner = randomUUID(), now = new Date().toISOString();
const base = { id, ownerId: owner, name: "Material billing test", state: "Draft storyboard", createdAt: now, updatedAt: now, request: { theme: "neutral", template: "product-launch", format: "landscape", style: "kinetic" }, screenshots: [], comments: [], brief: { look: "claymation" }, beatPlan: { canvas: "16:9", beats: [{ id: "b1", kind: "kinetic", keyword: "Build" }] } };
const deps = { get: getProject, update: updateProjectVisuals, read: async () => null, save: async () => {}, wait: async () => {}, palette: async () => "", references: async () => [], enqueue: (projectId, runId) => boss.send(QUEUES.visuals, { projectId, runId }, { db: { executeSql: (sql, values) => query(sql, values) } }) };
// What the route does: take the tokens, hand back the way to return them.
const charges = [];
const billing = { charge: async (usd, runId) => {
  charges.push(usd);
  const spend = await spendTokens(owner, materialCostMillitokens(usd), "material", `${id}:${runId}`, id);
  return async () => { if (spend.charged) await refundSpend(owner, spend.event); };
} };
const balance = async () => (await tokenSummary(owner)).remaining;
try {
  await migrate(); await startQueues();
  await query("insert into app.projects(id,owner_id,name,state,data,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$6)", [id, owner, base.name, base.state, base, now]);
  await grantTokens(owner, 200, "test", "cli:test", `order:${id}`, "pack");
  const start = await balance();

  // The price: one scene = a style key image + a keyframe image + an eight-second clip, at list price, times the markup.
  assert.equal(MATERIAL_MARKUP, 3);
  assert.equal(materialPriceUsd(base), 0.94, "$0.07 style key + $0.07 keyframe + $0.80 clip");
  assert.equal(visualStatus(await getProject(id)).priceTokens, 28.2, "$0.94 x 3 = $2.82 = 28.2 tokens");

  // A queueing failure gives the tokens back, and nothing stays recorded as paid.
  await assert.rejects(enqueueVisuals(id, 25, { ...deps, enqueue: async () => { throw Error("queue down"); } }, billing), /queue down/);
  assert.equal(await balance(), start, "tokens returned when the run could not be queued");
  assert.equal((await getProject(id)).planVisuals, undefined);

  // The run is queued: charged once, recorded as paid.
  await enqueueVisuals(id, 25, deps, billing);
  assert.deepEqual(charges, [0.94, 0.94]);
  assert.equal(Math.round((start - (await balance())) * 10) / 10, 28.2);
  assert.equal((await getProject(id)).planVisuals.paidUsd, 0.94);
  await enqueueVisuals(id, 25, deps, billing);
  assert.equal(charges.length, 2, "asking again while it is queued charges nothing");

  // A stopped run resumed on the same storyboard owes nothing more.
  await updateProjectVisuals(id, (p) => ({ ...(p.planVisuals ?? {}), status: "failed" }));
  assert.equal(materialOwedUsd(await getProject(id)), 0);
  await enqueueVisuals(id, 25, deps, billing);
  assert.equal(charges.length, 2, "resuming a failed run does not pay again");
  assert.equal(Math.round((start - (await balance())) * 10) / 10, 28.2);

  // A changed storyboard (another scene) is a new film and is paid for as one.
  await query("update app.projects set data = jsonb_set(data, '{beatPlan,beats}', $2::jsonb) where id = $1", [id, JSON.stringify([{ id: "b1", kind: "kinetic", keyword: "Build" }, { id: "b2", kind: "kinetic", keyword: "Ship" }])]);
  await updateProjectVisuals(id, (p) => ({ ...(p.planVisuals ?? {}), status: "failed" }));
  assert.equal(materialPriceUsd(await getProject(id)), 1.81, "$0.07 + 2 x $0.87");
  await enqueueVisuals(id, 25, deps, billing);
  assert.equal(charges.at(-1), 1.81, "the new storyboard is paid for in full");
  console.log("material billing: ok");
} finally {
  await query("delete from pgboss.job where name=$1 and data->>'projectId'=$2", [QUEUES.visuals, id]).catch(() => {});
  await query("delete from app.token_ledger where user_id=$1", [owner]).catch(() => {});
  await query("delete from app.projects where id=$1", [id]).catch(() => {});
  await boss.stop({ graceful: false }); await pool.end();
}
