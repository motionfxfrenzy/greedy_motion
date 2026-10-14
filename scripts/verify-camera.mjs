// Checks the camera and the words, in a real browser, on the storyboard films stored in the local database:
//   node --env-file=backend/.env scripts/verify-camera.mjs            every stored film with a plan
//   node --env-file=backend/.env scripts/verify-camera.mjs <project id> ...
//   node --env-file=backend/.env scripts/verify-camera.mjs --dolly   also force a dolly zoom in (beat 2) and out (beat 3) of each film
// For each film it builds the render page (the same page the worker renders), seeks through the whole timeline every 50 ms
// and measures every visible keyword, sub-line, pill and lockup against the frame. It fails if any is cut by the frame
// (a negative margin) outside a scene change, where the cut or wipe itself carries the words across the edge, and it
// prints the camera decision engine.js made for each beat (window.__bp.cam): the move, whether it came from the plan or
// was chosen, and when it was shrunk or dropped to keep the text in frame. Typography films are listed but not failed:
// their rows are offset on purpose.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const { getProject } = await import("../backend/src/projects/store.ts");
const { pool } = await import("../backend/src/db/database.ts");
const { buildPlanRenderProject } = await import("../backend/src/plan/render-project.ts");
const { withEditorRoot } = await import("../backend/src/pro/routes.ts");
const { fillTextBlock } = await import("../backend/src/plan/composition.ts");

const cache = join(homedir(), ".cache/hyperframes/chrome/chrome-headless-shell");
const version = (await readdir(cache)).sort().pop();
const executablePath = join(cache, version, (await readdir(join(cache, version)))[0], "chrome-headless-shell");

const dolly = process.argv.includes("--dolly");
const argIds = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ids = argIds.length ? argIds : (await pool.query("select id from app.projects where data->'beatPlan' is not null order by updated_at desc limit 12")).rows.map((r) => r.id);
const browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox", "--allow-file-access-from-files"] });
let failed = 0;
const MEASURE = () => {
  const tl = window.__timelines.main, root = document.getElementById("root"), rr = root.getBoundingClientRect(), W = 1920, H = rr.height;
  const sel = ".kw,.sub,.pill,.lock", worst = { m: 1e9 };
  for (let t = 0; t < tl.duration(); t += 0.05) {
    tl.seek(t);
    document.querySelectorAll(sel).forEach((n) => {
      if (getComputedStyle(n).visibility === "hidden") return;
      let o = 1, e = n;
      while (e && e !== root) { o *= parseFloat(getComputedStyle(e).opacity); e = e.parentElement; }
      if (o < 0.2) return;
      const seam = n.closest(".seam");
      if (seam) { const m = new DOMMatrix(getComputedStyle(seam).transform); if (Math.abs(m.e) > 3 || Math.abs(m.f) > 3 || Math.abs(m.a - 1) > 0.01) return; }
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const m = Math.min(r.left - rr.left, W - (r.right - rr.left), r.top - rr.top, H - (r.bottom - rr.top));
      if (m < worst.m) { worst.m = Math.round(m); worst.at = Math.round(t * 100) / 100; worst.text = n.textContent.slice(0, 28); }
    });
  }
  return { worst, cam: window.__bp.cam, warnings: window.__bp.warnings };
};
for (const id of ids) {
  const project = await getProject(id);
  if (!project?.beatPlan) continue;
  if (dolly) { const b = project.beatPlan.beats; if (b[1]) b[1].motion.camera = "slow dolly zoom 10%"; if (b[2]) b[2].motion.camera = "dolly zoom out 10%"; }
  const dir = join(tmpdir(), `verify-camera-${id}`);
  await rm(dir, { recursive: true, force: true });
  try {
    const built = await buildPlanRenderProject(project, dir);
    const values = JSON.parse(await readFile(join(dir, "variables.json"), "utf8"));
    await writeFile(join(dir, "index.html"), withEditorRoot(fillTextBlock(await readFile(join(dir, "index.html"), "utf8"), values), built.durationSeconds));
  } catch (error) { console.log(`skip   ${project.name.slice(0, 40)}: ${String(error.message).slice(0, 60)}`); continue; }
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(pathToFileURL(join(dir, "index.html")).href);
  await new Promise((r) => setTimeout(r, 1200));
  const r = await page.evaluate(MEASURE);
  await page.close();
  const typography = project.beatPlan.beats.some((b) => b.scene === "stack" || b.scene === "marquee") || /typograph/i.test(project.name);
  const cut = r.worst.m < 0 && !typography;
  if (cut) failed++;
  console.log(`${cut ? "FAIL" : "ok  "}   ${project.name.slice(0, 40).padEnd(40)} margin ${r.worst.m}px at ${r.worst.at}s ("${r.worst.text}")  ${r.warnings.length ? "warnings: " + r.warnings.join("; ") : ""}`);
  console.log("       " + r.cam.map((c) => `${c.beat}:${c.kind || "none"}${c.src ? "/" + c.src : ""}${c.why ? " [" + c.why.slice(0, 40) + "]" : ""}`).join("  "));
}
await browser.close();
await pool.end();
if (failed) { console.error(`${failed} film(s) have words cut by the frame.`); process.exitCode = 1; } else console.log("camera: no words cut by the frame");
