// The storyboard cards in a real Chrome (no paid calls, no network): a fixture set picture with the film's kit puppets drawn on it by lib/storyboard-preview.
// Run with CARD_SAMPLES_DIR=<folder> to also save the sample cards as JPEGs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { namesFrom, planCard } from "../lib/storyboard-preview/cast.ts";
import { LAYOUT } from "../lib/storyboard-preview/draw.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const beats = [
  { keyword: "One spark", line: "Thomas Farriner forgot to bank his oven.", visual: "[bakery] medium: farriner yawns and shrugs, a spark floats from the oven" },
  { keyword: "Out of the oven", line: "A spark landed in the straw.", visual: "[bakery] wide: the spark drops on the straw and flames burst up" },
  { keyword: "He ran", line: "Farriner ran for the street.", visual: "[street] wide: Farriner runs along the street, neighbours point at the smoke" },
  { keyword: "The mayor", line: "The Lord Mayor looked at the fire and laughed.", visual: "[street] medium: the Lord Mayor stands and laughs at the fire" },
  { keyword: "Carry", line: "Neighbours carried buckets.", visual: "[street] wide: the crowd of neighbours carry buckets of water" }
];
const notes = { idea: "In 1666 a baker named Thomas Farriner went to bed after banking his oven, and a spark started the Great Fire of London.", places: "bakery = a bakery; street = a street" };

test("cards: the film's kit draws our puppets on a fixture set, deterministically, with no model call", { timeout: 120_000, skip: !existsSync(CHROME_PATH) && "Google Chrome not found" }, async () => {
  const kitJs = (await transform(readFileSync(join(REPO_ROOT, "backend/src/plan/packs/history-reel/kit.txt"), "utf8"), { loader: "ts", target: "es2020" })).code;
  const bundled = await build({
    stdin: { contents: `import { drawCard, loadKit } from "./lib/storyboard-preview/draw.ts"; window.__cards = { drawCard, loadKit };`, resolveDir: FRONTEND_DIR, loader: "ts" },
    bundle: true, format: "iife", target: "es2022", write: false
  });
  const names = namesFrom(beats, notes);
  assert.deepEqual(names, ["Thomas Farriner", "Lord Mayor"], "the people of the film, found from the script (the idea's \"Great Fire\" is a thing, not a person)");
  const plans = beats.map((_, i) => planCard(i, beats, names, ["set-bakery", "set-street"]));

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    // CARD_REAL_SETS=<bakery.jpg>,<street.jpg> draws the sample cards on real painted sets instead of the fixture ones
    const real = (process.env.CARD_REAL_SETS ?? "").split(",").filter(Boolean).map((f) => `data:image/jpeg;base64,${readFileSync(f).toString("base64")}`);
    const cards = await page.evaluate(async ({ kitJs, plans, beats, real }) => {
      const K = window.__cards.loadKit(kitJs);
      // fixture sets: a sky, hills and a flat ground in the lower third (what the pack's sets look like to the kit)
      const makeSet = (kind) => {
        if (real.length) { const img = new Image(); return new Promise((res) => { img.onload = () => res(img); img.src = real[kind === "street" ? 1 : 0] ?? real[0]; }); }
        const c = document.createElement("canvas"); c.width = 540; c.height = 960; const g = c.getContext("2d");
        const sky = g.createLinearGradient(0, 0, 0, 960); sky.addColorStop(0, kind === "street" ? "#e98a4a" : "#8fb6d8"); sky.addColorStop(0.6, kind === "street" ? "#7a4a38" : "#d9c8a0"); sky.addColorStop(1, "#6f5a3a");
        g.fillStyle = sky; g.fillRect(0, 0, 540, 960);
        g.fillStyle = kind === "street" ? "#4a3326" : "#7d9a62"; g.beginPath(); g.moveTo(0, 520); g.quadraticCurveTo(270, 380, 540, 520); g.lineTo(540, 640); g.lineTo(0, 640); g.fill();
        g.fillStyle = kind === "street" ? "#8a6a4a" : "#a9b27a"; g.fillRect(0, 640, 540, 320);
        const img = new Image(); return new Promise((res) => { img.onload = () => res(img); img.src = c.toDataURL("image/png"); });
      };
      const sets = { "set-bakery": await makeSet("bakery"), "set-street": await makeSet("street") };
      return plans.map((plan, i) => window.__cards.drawCard({ kit: K, setImage: sets[plan.set], place: plan.set.slice(4), aspect: "9:16", plan, caption: beats[i].keyword }));
    }, { kitJs, plans, beats, real });
    assert.deepEqual(pageErrors, []);
    assert.equal(cards.length, 5);
    for (const c of cards) { assert.match(c, /^data:image\/jpeg;base64,/); assert.ok(c.length < 120_000, `a card stays small, about 70 KB with a painted set (${c.length} chars)`); }
    assert.equal(new Set(cards).size, 5, "each beat's card is its own picture (a different set, pose or crowd)");

    // deterministic: the same plan gives the same card
    const again = await page.evaluate(async ({ kitJs, plan, caption }) => {
      const K = window.__cards.loadKit(kitJs);
      const c = document.createElement("canvas"); c.width = 540; c.height = 960; const g = c.getContext("2d"); g.fillStyle = "#789"; g.fillRect(0, 0, 540, 960);
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = c.toDataURL("image/png"); });
      const a = window.__cards.drawCard({ kit: K, setImage: img, place: "bakery", aspect: "9:16", plan, caption });
      const b = window.__cards.drawCard({ kit: K, setImage: img, place: "bakery", aspect: "9:16", plan, caption });
      const other = window.__cards.drawCard({ kit: K, setImage: img, place: "bakery", aspect: "9:16", plan: { ...plan, figure: { name: "Other Person", seed: 12345 } }, caption });
      return [a, b, other];
    }, { kitJs, plan: plans[0], caption: "x" });
    assert.ok(LAYOUT.heroHeight >= 0.35 && LAYOUT.heroHeight <= 0.55, "the hero fills 35-55% of the frame height (the kit's size rule)");
    assert.ok(LAYOUT.feetAt >= 0.7 && LAYOUT.feetAt <= 0.9, "feet on the ground, in the lower third");
    assert.equal(again[0], again[1], "the same plan draws the same card");
    assert.notEqual(again[0], again[2], "a different person looks different");

    // the other frame shapes draw too (a 16:9 film crops the 9:16 set; the ground stays in view)
    const shapes = await page.evaluate(async ({ kitJs, plan }) => {
      const K = window.__cards.loadKit(kitJs);
      const c = document.createElement("canvas"); c.width = 540; c.height = 960; const g = c.getContext("2d"); g.fillStyle = "#789"; g.fillRect(0, 0, 540, 960); g.fillStyle = "#a9b27a"; g.fillRect(0, 640, 540, 320);
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = c.toDataURL("image/png"); });
      return ["16:9", "1:1"].map((aspect) => window.__cards.drawCard({ kit: K, setImage: img, place: "bakery", aspect, plan, caption: "shape" }));
    }, { kitJs, plan: plans[2] });
    assert.deepEqual(pageErrors, []);
    for (const url of shapes) assert.match(url, /^data:image\/jpeg;base64,/);
    const out = process.env.CARD_SAMPLES_DIR;
    if (out) {
      mkdirSync(out, { recursive: true });
      cards.forEach((c, i) => writeFileSync(join(out, `card-${i + 1}.jpg`), Buffer.from(c.split(",")[1], "base64")));
      writeFileSync(join(out, "card-16x9.jpg"), Buffer.from(shapes[0].split(",")[1], "base64"));
    }
  } finally {
    await browser.close();
  }
});
