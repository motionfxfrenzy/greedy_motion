// Renders gallery previews with the real renderer and gates every template × theme on `hyperframes check`.
// Runs inside the worker image (see scripts/build-previews.ts). Writes to /out:
//   themes/<theme>.jpg              Product launch reveal scene in each theme
//   templates/<template>.jpg        each template in its default theme at its preview moment
//   templates/<template>-scenes.jpg five-frame strip, one frame per scene
//   report.json                     check results for every template × theme
// Config arrives as JSON in PREVIEW_CONFIG: { templates: [{ id, defaultTheme, previewAt, sceneTimes }] }.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HYPERFRAMES, buildProject, listThemes, run } from "./compose.mjs";

const out = "/out";
const config = JSON.parse(process.env.PREVIEW_CONFIG ?? "{}");
const templates = config.templates ?? [];
const themes = await listThemes();
const only = new Set(process.argv.slice(2));
const report = [];
await mkdir(join(out, "themes"), { recursive: true });
await mkdir(join(out, "templates"), { recursive: true });

async function withProject(name, template, theme, work) {
  const project = join("/tmp", name);
  try {
    await buildProject(project, { template, theme });
    return await work(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

async function snapshot(project, times) {
  const dir = join(project, "snapshots");
  await run(HYPERFRAMES, ["snapshot", project, "--at", times.join(","), "--no-end", "--output", dir, "--no-browser-gpu", "--describe", "false"]);
  return (await readdir(dir)).filter((file) => file.endsWith(".png")).sort().map((file) => join(dir, file));
}

const jpg = (input, output, width = 640) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", `scale=${width}:-2`, "-q:v", "3", output]);

async function check(project) {
  const stdout = await run(HYPERFRAMES, ["check", project, "--no-browser-gpu"]).catch((error) => Object.assign(new String(error.stdout ?? error.message), { failed: true }));
  const text = String(stdout);
  const contrast = /(\d+)\/(\d+) text checks pass/.exec(text);
  return { ok: !stdout.failed, contrast: contrast ? `${contrast[1]}/${contrast[2]}` : null, issues: text.split("\n").filter((line) => line.includes("✗")).map((line) => line.trim()) };
}

// 1. Check every template in every theme, and capture its gallery stills in the default theme.
for (const template of templates.filter((item) => only.size === 0 || only.has(item.id))) {
  for (const theme of themes) {
    const started = performance.now();
    const entry = await withProject(`check-${template.id}-${theme}`, template.id, theme, async (project) => {
      const result = await check(project);
      if (theme === template.defaultTheme) {
        const [hero] = await snapshot(project, [template.previewAt]);
        await jpg(hero, join(out, "templates", `${template.id}.jpg`));
        const frames = await snapshot(project, template.sceneTimes);
        const strip = join(project, "strip.png");
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...frames.flatMap((file) => ["-i", file]), "-filter_complex", `${frames.map((_, index) => `[${index}]scale=384:-2[f${index}]`).join(";")};${frames.map((_, index) => `[f${index}]`).join("")}hstack=${frames.length}`, strip]);
        await jpg(strip, join(out, "templates", `${template.id}-scenes.jpg`), 1920);
      }
      if (template.id === "product-launch") {
        const [still] = await snapshot(project, [3.4]);
        await jpg(still, join(out, "themes", `${theme}.jpg`));
      }
      return result;
    }).catch((error) => ({ ok: false, error: error.message.slice(0, 300), issues: [] }));
    report.push({ template: template.id, theme, check: entry.ok ? "passed" : "failed", contrast: entry.contrast ?? null, issues: entry.issues, error: entry.error, seconds: Math.round((performance.now() - started) / 100) / 10 });
    console.log(JSON.stringify(report.at(-1)));
  }
}

await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const failed = report.filter((entry) => entry.check !== "passed");
console.log(`${report.length - failed.length}/${report.length} template × theme checks passed`);
if (failed.length) process.exitCode = 1;
