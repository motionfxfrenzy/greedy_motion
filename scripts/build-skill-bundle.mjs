#!/usr/bin/env node
// Packages the gm-* skills listed in .claude/skills/BUNDLE.json into backend/skills/, the folder that ships in
// the backend image and is the only thing the hosted app reads (docs/SKILL_DELIVERY.md).
//
//   npm run skills:build            rebuild backend/skills (commit the result)
//   npm run skills:build -- --check  fail if the committed bundle differs from the skill sources (CI)
//   npm run skills:build -- --gates  build a sample through the backend's own builder and run the release gates:
//                                     hyperframes check, seek safety, text-size floors
//
// Per skill the bundle holds: slots.json, fill-guidance.md, sample-values.json, template/ (its engine.js inlined and
// minified, so the backend needs no build tools), vendor/ (the pinned browser libraries the template loads). Hashes
// of every file go in manifest.json; the backend verifies them at startup. Nothing here is time-dependent, so the
// output is byte-for-byte reproducible.
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundleDigest, hashDirectory, skillDigest } from "../backend/src/formats/digest.ts";
import { VENDOR, vendorPath } from "./creative-vendor.mjs";

const root = resolve(import.meta.dirname, "..");
const outDir = join(root, "backend/skills");
const skillsDir = join(root, ".claude/skills");
const flag = (name) => process.argv.includes(`--${name}`);

const frontmatter = (text, key) => {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const line = block.split("\n").find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
};

async function buildInto(dest) {
  const { skills: names } = JSON.parse(await readFile(join(skillsDir, "BUNDLE.json"), "utf8"));
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const skills = {};
  for (const name of names) {
    const src = join(skillsDir, name);
    for (const required of ["references/slots.json", "references/fill-guidance.md", "template/index.html", "SKILL.md"]) {
      if (!existsSync(join(src, required))) throw new Error(`${name}: ${required} is missing. A bundled skill needs a slot schema, fill guidance and a frozen template.`);
    }
    const spec = JSON.parse(await readFile(join(src, "references/slots.json"), "utf8"));
    if (spec.skill !== name) throw new Error(`${name}: slots.json says it belongs to ${spec.skill}.`);
    const to = join(dest, "formats", name);
    await mkdir(to, { recursive: true });
    await cp(join(src, "references/slots.json"), join(to, "slots.json"));
    await cp(join(src, "references/fill-guidance.md"), join(to, "fill-guidance.md"));
    if (existsSync(join(src, "references/sample-values.json"))) await cp(join(src, "references/sample-values.json"), join(to, "sample-values.json"));
    await cp(join(src, "template"), join(to, "template"), { recursive: true });
    let html = await readFile(join(to, "template/index.html"), "utf8");
    if (existsSync(join(to, "template/engine.js"))) {
      const { transform } = await import("esbuild");
      const { code } = await transform(await readFile(join(to, "template/engine.js"), "utf8"), { minify: true, target: "es2018", legalComments: "none" });
      if (!/<script id="format-engine">[\s\S]*?<\/script>/.test(html)) throw new Error(`${name}: index.html has no <script id="format-engine"> placeholder for engine.js.`);
      html = html.replace(/<script id="format-engine">[\s\S]*?<\/script>/, () => `<script id="format-engine">\n${code.trim().replace(/<\/script/gi, "<\\/script")}\n</script>`);
      await writeFile(join(to, "template/index.html"), html);
      await rm(join(to, "template/engine.js"));
    }
    await mkdir(join(to, "vendor"), { recursive: true });
    for (const file of Object.keys(VENDOR)) if (html.includes(`vendor/${file}`)) await cp(vendorPath(root, file), join(to, "vendor", file));
    const files = await hashDirectory(to);
    skills[name] = { version: spec.version, description: frontmatter(await readFile(join(src, "SKILL.md"), "utf8"), "description"), sha256: skillDigest(files), files };
  }
  await writeFile(join(dest, "formats/catalog.json"), JSON.stringify(skills, null, 2) + "\n");
  await cp(join(root, "third_party/cloud-author-skills"), join(dest, "author/sources"), { recursive: true });
  await cp(join(root, "cloud-author/stages"), join(dest, "author/stages"), { recursive: true });
  await cp(join(root, "cloud-author/stages.json"), join(dest, "author/stages.json"));
  await mkdir(join(dest, "director"), { recursive: true });
  const directorSources = {
    SCRIPT_FOR_MOTION: "gm-skill-authoring/references/script-for-motion.md",
    WATCHABILITY: "gm-skill-authoring/references/watchability.md",
    ROUTING: "gm-script-director/references/routing.md",
    MOTION_DIRECTION: "gm-script-director/references/motion-direction.md",
    SHOT_DIRECTION: "gm-script-director/references/shot-direction.md"
  };
  for (const [key, source] of Object.entries(directorSources)) {
    const text = (await readFile(join(skillsDir, source), "utf8"))
      .replace(/<!-- director:skip -->[\s\S]*?<!-- \/director:skip -->\n\n?/g, "")
      .split("\n").filter(line => !line.includes("<!-- director:skip-line -->")).join("\n");
    await writeFile(join(dest, "director", `${key}.md`), text);
  }
  const files = await hashDirectory(dest);
  const manifest = { format: 2, bundle: skillDigest(files), files };
  await writeFile(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (flag("check")) {
  const tmp = await mkdtemp(join(tmpdir(), "skill-bundle-"));
  try {
    await buildInto(tmp);
    const [want, have] = [await hashDirectory(tmp), existsSync(outDir) ? await hashDirectory(outDir) : {}];
    const paths = [...new Set([...Object.keys(want), ...Object.keys(have)])].sort();
    const differ = paths.filter((p) => want[p] !== have[p]);
    if (differ.length) {
      console.error(`backend/skills is out of date with .claude/skills (${differ.length} file${differ.length === 1 ? "" : "s"} differ, e.g. ${differ.slice(0, 3).join(", ")}).\nRun \`npm run skills:build\` and commit the result.`);
      process.exit(1);
    }
    console.log(`skill bundle is up to date (${Object.keys(want).length} files)`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
} else {
  const manifest = await buildInto(outDir);
  console.log(`built backend/skills: ${Object.keys(manifest.files).length} files; bundle ${manifest.bundle.slice(0, 12)}`);
}

if (flag("gates")) {
  // The backend modules read config at import: give them what they need to load without a database or a model key.
  process.env.PLANNER ??= "deterministic"; process.env.APP_ENV ??= "local"; process.env.AUTH_MODE ??= "none";
  process.env.DATABASE_URL ??= "postgres://gates:gates@127.0.0.1:5432/gates";
  const { loadBundle } = await import("../backend/src/formats/bundle.ts");
  const { buildFormatProject } = await import("../backend/src/formats/build.ts");
  const { normalizeValues } = await import("../backend/src/formats/slots.ts");
  const { skills } = await loadBundle(outDir);
  const { knownGaps = {} } = JSON.parse(await readFile(join(skillsDir, "BUNDLE.json"), "utf8"));
  let failed = false;
  const known = [];
  for (const skill of skills.values()) {
    const gaps = knownGaps[skill.name] ?? {};
    // A gate that is a recorded known gap for this skill is reported, not blocking; any other failure blocks.
    const settle = (id, ok) => { if (ok) return; if (gaps[id]) known.push(`${skill.name}: ${id}`); else failed = true; };
    const sample = JSON.parse(await readFile(join(skill.dir, "sample-values.json"), "utf8"));
    const { values, problems } = normalizeValues(skill.spec, sample, { brandName: sample.brand_word_1 });
    if (problems.length) { console.error(`${skill.name}: sample values break the slot schema:`, problems); process.exit(1); }
    const dir = await mkdtemp(join(tmpdir(), `bundle-gates-${skill.name}-`));
    const project = join(dir, "project");
    await buildFormatProject({ skill, values, look: { themeCss: await readFile(join(root, "worker/themes/neutral.css"), "utf8") }, fontsDir: join(root, "worker/fonts"), dir: project });
    await writeFile(join(project, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }));
    await writeFile(join(project, "meta.json"), JSON.stringify({ id: skill.name, name: skill.name }));
    const run = (label, cmd, args) => { const r = spawnSync(cmd, args, { cwd: project, encoding: "utf8" }); const text = (r.stdout || "") + (r.stderr || ""); console.log(`\n== ${skill.name}: ${label} (exit ${r.status})\n${text.trim().split("\n").slice(-6).join("\n")}`); return r.status === 0; };
    const gates = join(root, ".claude/skills/gm-skill-authoring/scripts");
    settle("check", run("hyperframes check", join(root, "worker/node_modules/.bin/hyperframes"), ["check"]));
    settle("seek-safety", run("seek safety", process.execPath, [join(gates, "seek_safety.mjs"), "--project", project, "--frames", "--require-motion"]));
    settle("text-size", run("text-size floors", process.execPath, [join(gates, "text_size_gate.mjs"), "--project", project, "--step", "0.5"]));
    await rm(dir, { recursive: true, force: true });
  }
  if (known.length) console.log(`\nKnown gaps (recorded in .claude/skills/BUNDLE.json, not blocking): ${known.join("; ")}`);
  console.log(failed ? "\nGATES: FAIL" : "\nGATES: PASS (every gate passes or is a recorded known gap)");
  process.exit(failed ? 1 : 0);
}
