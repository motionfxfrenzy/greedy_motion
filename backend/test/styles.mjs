import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
process.env.PLANNER = "deterministic";
process.env.DATABASE_URL = "postgres://unused@127.0.0.1:1/unused";
const { looks, isLook, getLook, lookDirection, parseScriptBrief } = await import("../../packages/contracts/src/index.ts");
const { userMessage } = await import("../src/plan/director.ts");
const { engineVariables } = await import("../src/plan/composition.ts");
const root = resolve(import.meta.dirname, "../..");
const base = { scriptMode:"problem", text:"Make product releases easier to share.", durationSeconds:30, aspect:"16:9", motionProfile:"smooth", pace:"balanced", audio:{mode:"none"}, captions:"none", template:null, theme:"neutral" };
assert.equal(new Set(looks.map((look) => look.id)).size, looks.length, "duplicate style ids");
for (const look of looks) {
  assert.ok(isLook(look.id));
  const parsed = parseScriptBrief({...base,look:look.id});
  assert.ok("brief" in parsed, `${look.id} cannot be saved`);
  assert.equal(parsed.brief.look ?? "clean",look.id);
  const reopened = parseScriptBrief(JSON.parse(JSON.stringify(parsed.brief)));
  assert.ok("brief" in reopened);
  assert.equal(reopened.brief.look ?? "clean",look.id);
  const variables = engineVariables({plan:{beats:[],canvas:"16:9",brand:{motion_profile:"smooth"},audio:{captions:"none"}},timing:{beats:[]},shots:{},brandName:"Test",look:reopened.brief.look});
  assert.equal(variables.look,look.id);
  const message = userMessage(parsed.brief,{brandName:"Test",screenshots:[]});
  assert.ok(message.includes(lookDirection(look.id)),`${look.id}: recipe missing from director`);
  assert.ok(message.includes(look.instructions.motion));
  assert.ok(message.includes("No generated text"));
  const recipe = JSON.parse(await readFile(join(root,`backend/style-library/${look.id}.json`),"utf8"));
  assert.equal(recipe.id,look.id);
  assert.deepEqual(recipe.instructions,look.instructions);
  const digest = createHash("sha256").update(await readFile(join(root,look.source))).digest("hex");
  assert.equal(recipe.sourceSha256,digest,`${look.id}: source changed without rebuilding recipe`);
  await access(join(root,"frontend/public",look.preview.src));
  for (const reference of recipe.referenceAssets) {
    const bytes = await readFile(join(root,"backend/style-library",reference.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"),reference.sha256);
    assert.deepEqual(await readFile(join(root,"frontend/public/previews/looks",reference.path)),bytes);
  }
  const fixture = await readFile(join(root,`validation/creative-libraries/engine-${look.id}/index.html`),"utf8");
  const defaults = JSON.parse(fixture.match(/data-composition-variables='([^']*)'/)[1]);
  assert.equal(defaults.find((v) => v.id === "look")?.default,look.id,`${look.id}: render fixture missing style`);
  console.log(`ok ${look.id}: brief round-trip → director recipe → render variable; deploy assets verified`);
}
for (const look of ["missing", "../sketch", "<script>", 1, {}, false]) {
  assert.equal(isLook(look),false);
  assert.ok("error" in parseScriptBrief({...base,look}));
}
assert.equal(getLook(undefined).id,"clean");
console.log(`All ${looks.length} style contracts passed. No services or model calls used.`);
