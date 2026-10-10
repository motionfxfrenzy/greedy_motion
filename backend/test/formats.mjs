// Fill-mode formats: the shipped skill bundle, slot validation and the render-folder builder. No database, no
// network, no model: it proves that what ships in the image is intact, that a bad fill is rejected with the
// slot named, and that a build from the bundle alone (no .claude/skills) is a complete HyperFrames project.
//
//   node test/formats.mjs
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
const { loadBundle, BundleCorrupt } = await import("../src/formats/bundle.ts");
const { normalizeValues, aiSlots } = await import("../src/formats/slots.ts");
const { buildFormatProject } = await import("../src/formats/build.ts");
const { config } = await import("../src/config.ts");

const scratch = await mkdtemp(join(tmpdir(), "formats-test-"));
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok - ${name}`); };
const exists = (path) => stat(path).then(() => true, () => false);

try {
  const { bundle, skills } = await loadBundle();
  const skill = skills.get("gm-velocity-sting");
  const sample = JSON.parse(await readFile(join(skill.dir, "sample-values.json"), "utf8"));

  await check("the shipped bundle verifies and lists the sting", () => {
    assert.match(bundle, /^[0-9a-f]{64}$/);
    assert.ok(skill, "gm-velocity-sting is bundled");
    assert.equal(skill.spec.skill, "gm-velocity-sting");
    assert.ok(skill.guidance.length > 200, "fill guidance ships with the skill");
  });

  await check("a damaged bundle is refused: edited file, missing file, unlisted file", async () => {
    const copy = join(scratch, "bundle");
    await cp(config.skillsBundleDir, copy, { recursive: true });
    await loadBundle(copy); // an unmodified copy is fine
    const slots = join(copy, "formats/gm-velocity-sting/slots.json");
    const original = await readFile(slots);
    await writeFile(slots, original.toString() + " ");
    await assert.rejects(() => loadBundle(copy), BundleCorrupt);
    await writeFile(slots, original);
    await rm(join(copy, "formats/gm-velocity-sting/fill-guidance.md"));
    await assert.rejects(() => loadBundle(copy), /missing .*fill-guidance\.md/);
    await cp(join(config.skillsBundleDir, "formats/gm-velocity-sting/fill-guidance.md"), join(copy, "formats/gm-velocity-sting/fill-guidance.md"));
    await writeFile(join(copy, "formats/gm-velocity-sting/extra.txt"), "x");
    await assert.rejects(() => loadBundle(copy), /unlisted .*extra\.txt/);
  });

  await check("the complete sample passes the slot schema", () => {
    const { problems, values } = normalizeValues(skill.spec, sample, { brandName: "Ledgerly" });
    assert.deepEqual(problems, []);
    assert.equal(values.d_to, 2416);
    assert.deepEqual(JSON.parse(values.e_rows), sample.e_rows);
    assert.equal(JSON.parse(values.f_menu_rows)[0].name, "Blank invoice");
  });

  await check("budgets, facts and shapes are enforced, each problem naming its slot", () => {
    const bad = { ...sample, b_title: "x".repeat(40), d_to: "lots", e_rows: ["a", "b"], f_menu_rows: [{ name: "n".repeat(30), meta: "m" }, { name: "b", meta: "m" }, { name: "c", meta: "m" }, { name: "d" }], nope: 1 };
    delete bad.b_cta;
    const { problems } = normalizeValues(skill.spec, bad);
    const by = Object.fromEntries(problems.map((p) => [p.slot, p.message]));
    assert.match(by.b_title, /limit is 16/);
    assert.match(by.d_to, /number/);
    assert.match(by.e_rows, /2 items/);
    assert.match(by.f_menu_rows, /name|meta|limit/);
    assert.match(by.b_cta, /real value/);
    assert.match(by.nope, /not a slot/);
  });

  await check("a fact the person must supply is never defaulted into existence; defaults and the brand name apply where declared", () => {
    const { problems, values } = normalizeValues(skill.spec, {}, { brandName: "Ledgerly" });
    assert.ok(problems.some((p) => p.slot === "d_to"), "d_to is a product fact");
    assert.equal(values.brand_word_1, "Ledgerly", "brand_word_1 comes from the brand kit");
    assert.equal(values.brand_word_2, "", "an optional slot takes its default");
    assert.ok(normalizeValues(skill.spec, { logo: "x" }).problems.some((p) => p.slot === "logo"), "the logo cannot come from a request");
  });

  await check("only slots that are not facts are left for the model", () => {
    const left = aiSlots(skill.spec, { b_title: "Hi" }).map((s) => s.id);
    assert.ok(left.includes("b_sub") && !left.includes("b_title") && !left.includes("d_to") && !left.includes("brand_word_1"));
  });

  await check("a build from the bundle alone is a complete, self-contained project", async () => {
    const { values } = normalizeValues(skill.spec, sample, { brandName: "Ledgerly" });
    const theme = await readFile(join(config.themesDir, "neutral.css"), "utf8");
    const dir = join(scratch, "project");
    const built = await buildFormatProject({ skill, values, look: { themeCss: theme }, fontsDir: config.fontsDir, dir });
    assert.equal(built.canvas, "1:1");
    assert.ok(built.durationSeconds > 11 && built.durationSeconds < 12.5);
    for (const file of ["index.html", "variables.json", "theme.css", "fonts.css", "vendor/gsap.min.js", "fonts", "assets/audio/sting-mix.wav"]) assert.ok(await exists(join(dir, file)), `${file} exists`);
    const html = await readFile(join(dir, "index.html"), "utf8");
    assert.ok(!/<script id="format-engine">\s*<\/script>/.test(html) && html.includes('id="format-engine"'), "engine is inlined");
    assert.match(html, /Good morning\./, "values are baked in as variable defaults");
    const variables = JSON.parse(await readFile(join(dir, "variables.json"), "utf8"));
    assert.equal(variables.d_to, 2416);
    assert.ok(!(await exists(join(dir, "engine.js"))), "the readable engine is not shipped into the folder");
  });

  console.log(`\n${passed} checks passed`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
process.exit(0);
