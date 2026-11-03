import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getLook, type ScriptBeat } from "@videosaas/contracts";
import { ENGINE_DIR, kitFile, plateFile } from "@videosaas/plate-engine";
import { existsSync } from "node:fs";
import { FPS, sizeForAspect } from "./model.ts";

/**
 * The authoring prompt for one scene. The plate source, its kit and the worked example come from the versioned engine package
 * (never from a developer path), and the digest of the template + example enters every scene signature, so editing this
 * prompt redraws what it would draw differently.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
export const PROMPT_VERSION = 3;
const exampleFile = join(ENGINE_DIR, "worked-example.txt");

export const contractFor = (size: { w: number; h: number; label: string }) => [
  "You write ONE scene of a film as a single TypeScript module for the anidoodle engine: pictures drawn entirely in code, in a named hand-made medium.",
  "THE CONTRACT (absolute): the module is a pure function of (ctx, frame, env). Randomness only through rng(seed) or the helpers' seeds; no Date, no Math.random, no clock, no ctx.filter, no fetch, no images, no fonts, no external assets.",
  "Draw every mark in the SAME MEDIUM AND ORDER OF MARKS as the style's plate (the plate source below is the recipe: its marks, its textures, its palette habits, its contour). A different palette is not a different style.",
  `The scene is ${size.w}x${size.h} (${size.label}), 30 fps. All coordinates are in that ${size.w}x${size.h} space. Start with ctx.setTransform(env.scale,0,0,env.scale,0,0), fill the full ${size.w}x${size.h} paper, draw, then finish with the plate's paper pass.`,
  "Draw what the beat's VISUAL line says, as a finished picture with one focal subject and one light. Something visibly changes every second (a swing, a drift, a flame, drawing-on marks): no dead frames. Keep recurring characters and objects consistent with the film's other scenes, as described in the CAST note.",
  "People are friendly and simple; faces are a few marks (eye strokes, a mouth line). No text in the picture: the words are laid on by the editor.",
  `Export exactly (the typed form, on one line start): \`export const film: Film = { meta: { title, W: ${size.w}, H: ${size.h}, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] }\` where draw has the signature (ctx: Ctx, frame: number, env: Env) => void and durationFrames is given in the request.`,
  "Import only from \"./core\", \"./film\", \"./gallery\" and the plate's own kit modules that the plate itself imports. Copy the plate's small local helpers (scribble, line, wax, etc.) into your module instead of importing them: they are not exported.",
  "Keep the module COMPACT, under about 220 lines: one focal subject, a simple setting, and reuse small helpers and loops. A complete short module is worth far more than a long unfinished one.",
  "Reply with the complete module inside one ```ts fence and nothing else."
].join("\n");

let digestMemo: string | undefined;
/** Digest of everything in the prompt that is not the beat: the contract text, the worked example, the version. */
export async function promptDigest(): Promise<string> {
  if (digestMemo) return digestMemo;
  const example = await readFile(exampleFile, "utf8");
  return (digestMemo = createHash("sha256").update(`${PROMPT_VERSION}\0${contractFor({ w: 0, h: 0, label: "" })}\0${example}`).digest("hex").slice(0, 16));
}

const readText = async (path: string, cap: number) => { const text = await readFile(path, "utf8"); return text.length > cap ? `${text.slice(0, cap)}\n/* ...truncated... */` : text; };

export type AuthorRequest = {
  look: string; plateName: string; film: string; beats: ScriptBeat[]; aspect: string; index: number; frames: number;
  error?: string; previous?: string; revise?: { notes: string; code: string }; reference?: string;
};

/** The model request (system + messages) for one scene; the large shared context is cached across scenes. */
export async function buildAuthorMessages(args: AuthorRequest) {
  const plate = await readText(plateFile(args.plateName), 30_000);
  const kitPath = kitFile(args.plateName);
  const kitCode = existsSync(kitPath) ? await readText(kitPath, 15_000) : null;
  const example = await readText(exampleFile, 12_000);
  const beat = args.beats[args.index]!;
  const size = sizeForAspect(args.aspect);
  const cast = args.beats.map((b, i) => `${i + 1}. ${b.keyword}: ${b.visual ?? ""}`).join("\n");
  const shared = [
    `STYLE: ${getLook(args.look as never).name}. THE STYLE'S PLATE (the recipe; study its medium, do not copy its subject):\n<plate name="${args.plateName}">\n${plate}\n</plate>`,
    ...(kitCode ? [`THE PLATE'S KIT MODULE (imported as "./${args.plateName}Kit"; use these exact exported helpers and types):\n<kit name="${args.plateName}Kit">\n${kitCode}\n</kit>`] : []),
    `A WORKED EXAMPLE of a new subject authored in the crayon plate's medium (a scene of another film). Study the structure, not the subject:\n<example>\n${example}\n</example>`,
    `THE FILM: ${args.film}\nFRAME SIZE: W=${size.w}, H=${size.h} (${size.label}), 30 fps. Use W: ${size.w}, H: ${size.h} in meta and compose all coordinates within ${size.w}x${size.h}.\nCAST AND STORY (all scenes, for consistency of recurring characters and objects):\n${cast}`
  ].join("\n\n");
  const scene = [
    `WRITE SCENE ${args.index + 1} OF ${args.beats.length}: "${beat.keyword}".\nVISUAL: ${beat.visual ?? beat.keyword}\nVOICEOVER (for pacing only, not drawn): ${beat.line ?? ""}\nLength: ${args.frames} frames (${args.frames / FPS} s).Frame dimensions: W=${size.w}, H=${size.h}.`,
    ...(args.reference ? [`THE SAME SCENE WAS ALREADY AUTHORED FOR ANOTHER FRAME SHAPE. Keep its characters, objects, palette, light and story beats exactly; recompose them natively for ${size.w}x${size.h} (do not letterbox or crop).\nREFERENCE MODULE:\n${args.reference.slice(0, 14_000)}`] : []),
    ...(args.revise ? [`THIS SCENE WAS ALREADY DRAWN. The person watched it and left notes with the time in the scene (seconds from the scene start). REVISE the module below to answer the notes; keep everything the notes do not mention exactly as it is (same composition, characters and palette), and return the whole revised module.\nNOTES:\n${args.revise.notes}\nCURRENT MODULE:\n${args.revise.code.slice(0, 16_000)}`] : []),
    ...(args.error ? [`YOUR PREVIOUS MODULE FAILED. Fix it and return the whole corrected module.\nERROR:\n${args.error.slice(0, 2500)}\nPREVIOUS MODULE:\n${args.previous?.slice(0, 14_000) ?? ""}`] : [])
  ].join("\n\n");
  return {
    system: contractFor(size),
    messages: [{ role: "user", content: [{ type: "text", text: shared, cache_control: { type: "ephemeral" } }, { type: "text", text: scene }] }]
  };
}

/** Pulls the module out of the model's reply. Throws a repairable error when there is none. */
export function moduleFrom(text: string): string {
  const fenced = /```(?:ts|typescript)?\n([\s\S]*?)```/.exec(text);
  const code = (fenced?.[1] ?? text).trim();
  if (!/export const film/.test(code)) throw Object.assign(new Error("The model's module has no `film` export."), { repairable: true });
  return code;
}
void here;
