// Checks the template catalog's invariants (run after adding or changing templates):
//   node --experimental-strip-types scripts/verify-gallery.mjs
// - every template belongs to a visual style: its `look` is a known look, so it shows under that style's examples in the style picker;
// - ids are unique; every template has a clip in the manifest (a card without one would show a stand-in);
// - every style the picker lists resolves, and the examples per style add up.
import { galleryStyles, galleryTemplates } from "../packages/contracts/src/gallery.ts";
import { looks } from "../packages/contracts/src/looks.ts";

const known = new Set(looks.map((look) => look.id));
const problems = [];
const seen = new Set();
for (const item of galleryTemplates) {
  if (seen.has(item.id)) problems.push(`duplicate id ${item.id}`);
  seen.add(item.id);
  if (!known.has(item.look)) problems.push(`${item.id}: look "${item.look}" is not a known style (packages/contracts/src/looks.ts)`);
  if (!item.preview.video && item.group !== "Colour") problems.push(`${item.id}: no preview clip published`);
}
const styles = galleryStyles();
const listed = styles.reduce((sum, style) => sum + style.examples, 0);
const expected = galleryTemplates.filter((item) => item.group !== "Colour" && known.has(item.look) && looks.find((look) => look.id === item.look)?.available).length;
if (listed !== expected) problems.push(`style examples (${listed}) do not add up to templates (${expected}): a template's look is unavailable`);
console.log(`${galleryTemplates.length} templates, ${styles.length} styles, ${styles.filter((style) => style.examples === 0).length} styles without an example yet`);
if (problems.length) { for (const line of problems) console.error("  " + line); process.exitCode = 1; } else console.log("catalog ok");
