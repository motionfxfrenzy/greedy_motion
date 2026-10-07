// Brand persistence test. The brand read from a customer's website lives as a kit row in Postgres; the files
// renders use are derived from it. This checks that (1) the theme rebuilt from each row is byte-identical to
// the theme saved when the kit was created, and (2) restoreBrandFiles() rebuilds deleted theme/font files.
// Works on a temporary copy of the brands folder; the real files are never touched.
//   node --env-file=.env test/brand-files.mjs
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realBrands = process.env.BRANDS_DIR ?? join(import.meta.dirname, "../../var/brands");
const copy = await mkdtemp(join(tmpdir(), "brand-files-"));
await cp(realBrands, copy, { recursive: true });
process.env.BRANDS_DIR = copy; // before the backend modules read config

const { deriveBrandTheme, themeToCss } = await import("@videosaas/contracts");
const { listBrands, restoreBrandFiles } = await import("../src/brand/store.ts");
const { pool } = await import("../src/db/database.ts");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok   ", name); } catch (error) { failed++; console.log("FAIL ", name, "\n     ", error.message); } };

const kits = (await listBrands()).filter((kit) => kit.id);
const onDisk = new Set(await readdir(copy).catch(() => []));
const local = kits.filter((kit) => onDisk.has(kit.id));
console.log(`${kits.length} kits in Postgres, ${local.length} with files in ${realBrands}`);

await check("the theme rebuilt from each kit row matches the saved theme byte for byte", async () => {
  assert.ok(local.length > 0, "no kits with files to compare");
  for (const kit of local) {
    const saved = await readFile(join(copy, kit.id, "theme.css"), "utf8");
    assert.equal(themeToCss(deriveBrandTheme(kit, `brand-${kit.id}`).theme), saved, `kit ${kit.name} (${kit.id})`);
  }
});

await check("deleted theme.css and fonts.css are rebuilt; colours identical", async () => {
  const kit = local.find((k) => k.fonts.heading.source !== "upload" && k.fonts.body.source !== "upload");
  assert.ok(kit, "no kit without uploaded fonts");
  const theme = await readFile(join(copy, kit.id, "theme.css"), "utf8");
  await rm(join(copy, kit.id, "theme.css"));
  await rm(join(copy, kit.id, "fonts.css"));
  const health = await restoreBrandFiles(kit);
  assert.deepEqual(health.restored.sort(), ["fonts.css", "theme.css"]);
  assert.equal(await readFile(join(copy, kit.id, "theme.css"), "utf8"), theme);
  assert.ok((await stat(join(copy, kit.id, "fonts.css"))).isFile());
});

await check("nothing is rebuilt when the files are present", async () => {
  for (const kit of local) {
    const health = await restoreBrandFiles(kit);
    assert.deepEqual(health.restored, [], kit.name);
  }
});

await pool.end();
await rm(copy, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
