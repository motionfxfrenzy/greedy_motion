import { writeFileSync } from "node:fs"; import { join, resolve } from "node:path";
const S = process.argv[2]; process.env.PLATE_BROWSER_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; process.env.PLATE_CHROME_ARGS = "--disable-gpu --use-gl=angle --use-angle=swiftshader";
const { openScene } = await import(resolve(import.meta.dirname, "../../packages/plate-engine/lib/capture.mjs"));
const s = await openScene(join(S, "blueprint-dcd88501-2.html"), { pages: 1 }); writeFileSync(join(S, "bpsw-ref-112.png"), await s.frame(112, 0)); await s.close();
