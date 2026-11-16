// Picture film ("Illustrated facts"): one hand-drawn still about every 2 s, hard cuts on the narrator's words, no music.
// Source: experiments/tarantula-reference (ANALYSIS.md measures the reference; test/ is the run that made gum-test.mp4).
//
// Flow on the plates engine (fields added by the engine work; this object keeps them optional until they exist):
//   script (scriptVoice) -> shot list (planFromScript, or one cheap call: shotListRequest -> parseShotList)
//   -> assets(): style anchor, set anchors, character sheets, then every still (word-checked when noText)
//   -> voice (Charon, pauses trimmed) -> sceneCode(): a deterministic module per beat, no authoring call -> MP4.

import type { ScriptNotes } from "@videosaas/contracts";
import type { PackAssetsInput, PackSceneCodeInput, TemplatePack } from "../../template-packs.ts";
import { assetSpecs, parseShotList, planFromScript, shotListRequest, shotNames, type AssetSpec, type ImageAspect, type PictureFilmPlan } from "./plan.ts";
import { pictureSceneModule } from "./scene.ts";
import { VOICE_DIRECTION } from "./style.ts";

export { assetSpecs, parseShotList, planFromScript, shotListRequest, shotNames, shotSlots, splitStarts, checkLabel, parseObjects, parseVisual } from "./plan.ts";
export type { AssetSpec, PictureFilmPlan, PlanShot } from "./plan.ts";
export { pictureSceneModule, cutFrames, alignTimes, CUT_LEAD_FRAMES, PUSH_IN } from "./scene.ts";
export { drawingStyle, VOICE_DIRECTION } from "./style.ts";

/**
 * What assets() reads: the engine's input, plus an optional `plan` (the parsed shot list, when the product ran the shot-list call).
 * Without `plan` the shot list comes from the script alone (brief.scriptNotes.objects and each beat's VISUAL).
 */
export type PictureFilmAssetsInput = Pick<PackAssetsInput, "beats" | "aspect"> & { brief?: { scriptNotes?: ScriptNotes | null } | null; plan?: PictureFilmPlan | null };
/** Image aspect for a film aspect: the image model draws 9:16 or 16:9; a square film cover-fits the 9:16 stills. */
export const imageAspect = (aspect: string | null | undefined): ImageAspect => (aspect === "16:9" ? "16:9" : "9:16");

const SCRIPT_VOICE = `VOICE FOR THIS FILM: an illustrated "what happens if you..." explainer. A calm, curious narrator answers one strange everyday question with real facts, while hand-drawn pictures change on his words about every two seconds. The measured reference: 185 words a minute, a new picture every ~6 spoken words, no music.

USE THIS ONLY WHEN WE WRITE THE SCRIPT. When the person gave their own script, keep their words exactly; only add the PLAN lines and the VISUAL lines.

PLAN FIRST. Before the first BEAT, write these two lines (the only lines allowed before the script):
IDEA: <the question and its real answer in one sentence, at most 25 words>
OBJECTS: cast: <id> = <look>; <id> = <look> | sets: <id> = <look>; <id> = <look>
  - cast: 1 to 4 recurring characters. People are stick figures with a big round white head, told apart only by one or two props ("you = stick figure in a red cap"; "doctor = lab coat, round glasses, clipboard"). The subject animal or object, when there is one, is a character too, described in detail. The viewer is "you".
  - sets: 2 to 5 recurring places: the viewer's everyday place with two or three homely props, an explaining device (a side-on cross-section of the body, the ground or a machine), and "card" = a plain cream info card for numbers, maps and dates. Short looks; the whole OBJECTS line under 400 characters. Ids are one lowercase word.

THE STRUCTURE, in this order (fit it to the length):
1. HOOK (2-3 lines): the viewer, in second person, in a concrete everyday scene, doing the action in the title ("You're walking down the street, chewing gum.").
2. PROMISE: one question naming exactly three possible outcomes ("Does it dissolve, stick for seven years, or block your gut?"). These become the chapters.
3. TWIST, inside the first 20 seconds: one fact that changes what the viewer thinks their action did.
4. BODY: the three outcomes in the same order. Every claim carries a concrete number, a place or a year.
5. One everyday analogy for the hardest idea ("Think of...").
6. One objection in the viewer's voice ("But X, right?"), then the answer.
7. Honest uncertainty where the science is unsure ("probably", "nobody seems to have measured that").
8. Call back to the hook object at least twice ("Now, think about that gum.").
9. ENDING: the three outcomes in the same order, one short line each, then one reversal line that flips the hook.

REAL FACTS ONLY: every number, place, year and finding must be true and widely documented. Name a real researcher or institution only when you are certain they exist and did that work; otherwise say "doctors", "researchers" or "studies". Never invent a name, number, date or study. If you are unsure of a number, leave it out.

RHYTHM:
- LENGTH: about 185 spoken words a minute of film (60 s = about 185 words, 14 to 20 beats). The narrator reads briskly with no long pauses.
- One sentence per beat, 6 to 15 words, one new fact per sentence. Plain spoken words, contractions. No "let's dive in", no "in this video", no hype, no exclamation marks, no jokes that need a laugh track.
- Every sentence must be drawable as simple pictures (a person, an object, a cross-section, a map, a number).

PER BEAT:
- BEAT: the line's key words in normal case, at most 4 words (never all capitals).
- VISUAL: the beat's pictures, one per ~6 spoken words (round(words / 6), 1 to 4), separated by " / ", in order, each "<framing> <set>: <what is drawn> [LABEL]":
  framing is wide (whole set), close (a tighter redrawn view of the same set, reads as a zoom-in), cutaway (side-on cross-section) or insert (a number, map, calendar or bar on the card set);
  "pop: <what is added>" instead means the picture before it with one thing added or changed (a label, an arrow, a prop or a pose), about 1 picture in 6;
  [LABEL] is optional: 1 to 3 capital words copied from the words spoken during that picture (a spoken number may be digits), on about 60% of pictures; never a word that is not spoken then.
  Each picture shows exactly the noun or verb being said during it. Alternate wide and close while the narration stays in one place. Name characters by their id. Keep the whole VISUAL under 200 characters.
  Example: "wide street: you walk past a lamp post, chewing / close street: you blow a tiny bubble [MINT GUM]"
- SCREEN: - (always; the only words on screen are the labels inside the pictures).
- VOICE: the line.`;

/** The film's image list (assets step). */
export const pictureFilmAssets = (input: PictureFilmAssetsInput): AssetSpec[] =>
  assetSpecs(input.plan ?? planFromScript(input.beats, input.brief?.scriptNotes), imageAspect(input.aspect));

/** One beat's scene module: only this beat's stills, in order (other names the engine passes, such as depth maps, are not drawn). */
export function pictureFilmScene(input: Pick<PackSceneCodeInput, "beatIndex" | "frames" | "beatWords" | "assetNames" | "aspect" | "beats">): string {
  const line = input.beats[input.beatIndex]?.line ?? null, own = new Set(shotNames(input.beatIndex, line));
  return pictureSceneModule({ index: input.beatIndex, frames: input.frames, words: input.beatWords, assets: input.assetNames.some((n) => own.has(n)) ? input.assetNames.filter((n) => own.has(n)) : input.assetNames, aspect: input.aspect, line });
}

export const pictureFilm: TemplatePack & {
  /** The shot list: from the script alone, or one cheap model call (request -> reply -> parse). */
  shotList: { fromScript: typeof planFromScript; request: typeof shotListRequest; parse: typeof parseShotList };
} & Required<Pick<TemplatePack, "assets" | "sceneAssets" | "sceneCode">> = {
  id: "picture-film",
  scriptVoice: SCRIPT_VOICE,
  // Charon is the gallery entry's narrator and the test's: calm, informative, male. Pauses trimmed (reference: none over 0.43 s).
  voice: { id: "Charon", tighten: true, direction: VOICE_DIRECTION },
  // No music: the reference is voice only (pauses measure -71 dB). The gallery entry's audio is "voiceover", so no bed is made.
  music: "",
  sceneDirection: "# Picture film: scene direction\n\nScenes are not authored: each beat's module is written by the pack (sceneCode) from its stills and word times. A beat is 1-4 hand-drawn stills shown full-frame, each cut in hard 2 frames before the first word it shows, with a 1.5% push-in. No motion inside a picture, no transitions, no sounds.",
  sketchDirection: "Style guide: the template \"Illustrated facts\". A hand-drawn cartoon explainer still: clean dark outlines, flat warm fills (grass green, sky blue, tan, cream), stick figures with a big round white head, lots of empty space, eye level. One idea per picture. Red arrows and green checks only as annotations. At most one 1-3 word hand-lettered capital label that is spoken in the line; no other words.",
  sceneSounds: false,
  // The reference has no captions: its only words are the labels drawn in the pictures. Smallest product setting, low in the frame.
  captions: { wordsPerCue: 3, style: "shadow", size: 48, y: 88 },
  // Tight like the reference: sentence gaps ~0.2 s, no title beat (BEAT keys are never all capitals), a short tail.
  pacing: { gap: 0.12, long: 0.3, beforeLast: 0.3, tail: 0.8, min: 0.6, titleMin: 0.9 },
  shotList: { fromScript: planFromScript, request: shotListRequest, parse: parseShotList },
  assets: (input) => pictureFilmAssets(input),
  sceneAssets: (beatIndex, beats) => shotNames(beatIndex, beats[beatIndex]?.line),
  sceneCode: (input) => pictureFilmScene(input)
};
