// The launcher's sweep checks rarely while the render queue is empty and often while a render is waiting.
import assert from "node:assert/strict";
import { startSweep } from "../src/jobs/sweep.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = async (demand) => {
  let checks = 0;
  const stop = startSweep(async () => { checks += 1; return demand; }, 20, 400);
  await wait(250);
  stop();
  return checks;
};
const idle = await run(0);
const busy = await run(1);
assert.ok(idle <= 1, `an empty queue should be checked on the idle interval, got ${idle} checks in 250 ms`);
assert.ok(busy >= 8, `a waiting render should be checked on the busy interval, got ${busy} checks in 250 ms`);
// A failing check never stops the sweep.
let calls = 0;
const stop = startSweep(async () => { calls += 1; throw new Error("down"); }, 20, 30);
await wait(200);
stop();
assert.ok(calls >= 3, "the sweep keeps going after a failed check");
console.log(`sweep cadence: ok (idle ${idle}, busy ${busy})`);
