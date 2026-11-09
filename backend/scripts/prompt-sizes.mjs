import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { kitFile, loadManifest, plateFile } from "@videosaas/plate-engine";
import { buildAuthorMessages, loadGuide, lookForPlateName } from "../src/plates/prompt.ts";
import { KIT_BUDGET_CHARS, SOURCE_BUDGET_CHARS, kitModulesFor, kitModulesForPrompt, plateExcerpt } from "../src/plates/prompt-context.ts";

const oldCutLen = (text, cap) => (text.length > cap ? `${text.slice(0, cap)}\n/* ...truncated... */`.length : text.length);

export async function computePromptSizes() {
  const manifest = loadManifest();
  const sampleBeats = [
    { keyword: "Opening", visual: "A quiet morning scene introduces the subject.", onScreen: null, line: "It began on a quiet morning." },
    { keyword: "Turn", visual: "One small movement changes the balance.", onScreen: null, line: "Then one small thing changed." }
  ];
  const rows = [];
  const prevSwitch = process.env.PLATE_STYLE_GUIDES;
  for (const plateName of Object.keys(manifest.styles).sort()) {
    const look = lookForPlateName(plateName);
    const rawPlate = readFileSync(plateFile(plateName), "utf8");
    const kPath = kitFile(plateName);
    const rawKit = existsSync(kPath) ? readFileSync(kPath, "utf8") : null;
    const plateBefore = oldCutLen(rawPlate, 30_000);
    const plateAfter = plateExcerpt(rawPlate, SOURCE_BUDGET_CHARS).length;
    const kitBefore = rawKit ? oldCutLen(rawKit, 15_000) : 0;
    const resolvedKits = kitModulesFor(plateName);
    const promptKits = kitModulesForPrompt(resolvedKits, rawPlate, KIT_BUDGET_CHARS);
    const kitAfter = promptKits.reduce((acc, k) => acc + k.text.length, 0);
    const req = {
      look,
      plateName,
      film: "A short film about how small habits shape a day.",
      beats: sampleBeats,
      aspect: "16:9",
      index: 0,
      frames: 90
    };
    process.env.PLATE_STYLE_GUIDES = "off";
    const oldMsg = await buildAuthorMessages(req);
    process.env.PLATE_STYLE_GUIDES = "on";
    const newMsg = await buildAuthorMessages(req);
    const guide = await loadGuide(plateName);
    const sharedBeforeChars = oldMsg.messages[0].content[0].text.length;
    const sharedAfterChars = newMsg.messages[0].content[0].text.length;
    const sceneBeforeChars = oldMsg.messages[0].content[1].text.length;
    const sceneAfterChars = newMsg.messages[0].content[1].text.length;
    const systemBeforeChars = oldMsg.system.length;
    const systemAfterChars = newMsg.system.length;
    const totalBeforeChars = systemBeforeChars + sharedBeforeChars + sceneBeforeChars;
    const totalAfterChars = systemAfterChars + sharedAfterChars + sceneAfterChars;
    rows.push({
      plateName,
      look,
      hasGuide: Boolean(guide),
      kitModules: resolvedKits.map((k) => k.name),
      kitModulesLabel: resolvedKits.length > 0 ? resolvedKits.map((k) => k.name).join(" + ") : "(plate is kit)",
      rawPlateChars: rawPlate.length,
      plateBeforeChars: plateBefore,
      plateAfterChars: plateAfter,
      rawKitChars: resolvedKits.reduce((acc, k) => acc + k.source.length, 0),
      kitBeforeChars: kitBefore,
      kitAfterChars: kitAfter,
      totalBeforeChars,
      totalBeforeTokens: Math.round(totalBeforeChars / 3.5),
      totalAfterChars,
      totalAfterTokens: Math.round(totalAfterChars / 3.5),
      sharedBeforeChars,
      sharedBeforeTokens: Math.round(sharedBeforeChars / 3.5),
      sharedAfterChars,
      sharedAfterTokens: Math.round(sharedAfterChars / 3.5),
      cachedBlockChars: sharedAfterChars,
      cachedBlockTokens: Math.round(sharedAfterChars / 3.5),
      uncachedSceneChars: systemAfterChars + sceneAfterChars,
      uncachedSceneTokens: Math.round((systemAfterChars + sceneAfterChars) / 3.5)
    });
  }
  if (prevSwitch === undefined) delete process.env.PLATE_STYLE_GUIDES;
  else process.env.PLATE_STYLE_GUIDES = prevSwitch;
  return rows;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const rows = await computePromptSizes();
  console.log(
    [
      "Style".padEnd(16),
      "Kit modules sent".padEnd(36),
      "Plate(old->new)".padStart(15),
      "Kit(old->new)".padStart(13),
      "Total chars(old->new)".padStart(21),
      "Total tok(old->new)".padStart(19),
      "Cached shared(chars/tok)".padStart(24)
    ].join(" | ")
  );
  console.log("-".repeat(162));
  for (const r of rows) {
    console.log(
      [
        r.plateName.padEnd(16),
        r.kitModulesLabel.padEnd(36),
        `${r.plateBeforeChars}->${r.plateAfterChars}`.padStart(15),
        `${r.kitBeforeChars}->${r.kitAfterChars}`.padStart(13),
        `${r.totalBeforeChars}->${r.totalAfterChars}`.padStart(21),
        `${r.totalBeforeTokens}->${r.totalAfterTokens}`.padStart(19),
        `${r.cachedBlockChars} / ${r.cachedBlockTokens}`.padStart(24)
      ].join(" | ")
    );
  }
}
