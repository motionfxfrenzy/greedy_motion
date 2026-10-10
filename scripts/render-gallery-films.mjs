// Renders the animated films behind the illustration styles (the anidoodle engine, Apache-2.0) at half size, locally.
//   node scripts/render-gallery-films.mjs [look-id ...]
// Needs a checkout of the engine with its dependencies installed (ANIDOODLE_TRY, default experiments/anidoodle-try, which
// has tools/render.mjs and a Chromium in pw-cache). Writes var/gallery-films/<look>.mp4. Large and regenerable: not committed.
// A style is shown with its draw-in film (the picture being made) or, where the engine has one, its "alive" film.
import { execFileSync } from "node:child_process";
import { mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const engine = resolve(process.env.ANIDOODLE_TRY ?? join(root, "experiments/anidoodle-try"));
export const films = {
  "illus-balloon": "balloonDraw", "illus-blueprint": "blueprint", "illus-broken-colour": "brokenColour", "illus-charcoal-erasure": "charcoalErasure",
  "illus-coloured-pencil": "colouredPencil", "illus-embroidery": "embroideryAlive", "illus-flat-vector": "flatVector", "illus-folk-tale": "folkTale",
  "illus-fox": "foxDraw", "illus-halftone": "halftone", "illus-isometric": "isometric", "illus-koi": "koiAlive", "illus-lighthouse": "lighthouseDraw",
  "illus-low-poly": "lowPoly", "illus-mellan": "mellanUnspool", "illus-mid-century": "midCentury", "illus-moon-phases": "moonPhasesDraw",
  "illus-painted-oil": "paintedOil", "illus-paper-craft": "paperCraft", "illus-pixel-art": "pixelArt", "illus-pocket-watch": "pocketWatchDraw",
  "illus-ranunculus": "ranunculusDraw", "illus-rubber-hose": "rubberHose", "illus-scrapbook": "scrapbook", "illus-scratchboard": "scratchboard",
  "illus-stipple": "stipple", "illus-storybook": "storybookDraw", "illus-sumi-e": "sumiE", "illus-toy-brick": "toyBrick", "illus-woodcut": "woodcut", "illus-wren": "wrenDraw"
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(root, "var/gallery-films");
  await mkdir(out, { recursive: true });
  const wanted = process.argv.slice(2);
  for (const [look, film] of Object.entries(films)) {
    if (wanted.length && !wanted.includes(look)) continue;
    console.log(`rendering ${look} <- ${film}`);
    try {
      execFileSync("node", ["tools/render.mjs", film, "--scale", "0.5", "--out", `out/gallery-films/${film}.mp4`], { cwd: engine, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(engine, "pw-cache") } });
      await rename(join(engine, "out/gallery-films", `${film}.mp4`), join(out, `${look}.mp4`));
    } catch (error) { console.error(`  FAILED ${look}: ${error.message.split("\n")[0]}`); process.exitCode = 1; }
  }
}
