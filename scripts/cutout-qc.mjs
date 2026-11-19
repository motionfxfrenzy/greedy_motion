// node scripts/cutout-qc.mjs <spec.json> <out.jpg> [t1,t2,t3,t4] [16:9|9:16]   -> contact sheet (2x2 landscape, 4-up portrait)
import { readFile, writeFile } from "node:fs/promises";
import { openKit } from "./cutout-lib.mjs";
const [specPath, out, ts, aspect] = process.argv.slice(2);
const spec = JSON.parse(await readFile(specPath, "utf8"));
if (aspect) spec.aspect = aspect;
const times = (ts ? ts.split(",").map(Number) : [3.5, 9.8, 16.4, 22.6]);
const kit = await openKit();
const portrait = spec.aspect === "9:16";
await writeFile(out, await kit.sheet(spec, times, portrait ? 4 : 2, portrait ? 480 : 960));
await kit.close();
console.log("wrote", out);
