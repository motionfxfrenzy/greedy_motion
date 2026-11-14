// Opening another project must drop the previous project's script and load its own.
// A stale script was saved over the next project's script (syncCurrentBriefToProject, project create).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/studio.tsx", import.meta.url), "utf8");
const start = src.indexOf("const scriptProjectId = useRef");
const end = src.indexOf("}, [project?.id]);", start);
const effect = src.slice(start, end);

test("switching from one project to another resets the script canvas", () => {
  assert.ok(start > 0 && end > start, "project-change effect is present");
  assert.match(effect, /switched = scriptProjectId\.current !== null && Boolean\(project\?\.id\) && scriptProjectId\.current !== project\?\.id/);
  assert.match(effect, /if \(switched\) canvasStop\.current\?\.abort\(\)/);
  assert.match(effect, /const current = switched \? null : canvas/);
  assert.match(effect, /if \(switched\) setCanvas\(null\)/);
});

test("the new project's script is loaded from the new project, not the old canvas", () => {
  assert.match(effect, /if \(!current && project\?\.brief\?\.scriptBeats\?\.length\) setCanvas\(/);
  assert.doesNotMatch(effect, /!canvas &&/);
});
