// Template packs: what a gallery template owns beyond its look: its own script-writer voice, narrator and music.
// A pack applies ONLY when the person started from that template (brief.styleExample). Every other film keeps the shared
// script writer (EXPLAINER_VOICE), the director's voice direction and the usual music prompt.
// Source of the Dark Fable pack: experiments/dark-fable-template (reference analysis, tests, cast kit), 2026-11-15.
// This file and packs/dark-fable/ are now the source of truth; the experiment folder is the test bench.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ScriptBeat, VideoProject } from "@videosaas/contracts";
import { pictureFilm } from "./packs/picture-film/index.ts";
import { historyReel } from "./packs/history-reel/index.ts";

/** Scene drawing owned by a pack: a shared cast kit inlined into every scene module, and pictures the scene writer sees. */
export type PackScenes = {
  /** TypeScript that declares the global `K` (the cast kit). Inlined after a scene's imports before it is built. */
  kit: string;
  /** PNG pictures shown to the scene writer: what the kit draws and what a finished film of this template looks like. */
  images: { label: string; data: Buffer }[];
  /** Changes when the kit, the direction or the pictures change, so drawn scenes are redrawn. */
  hash: string;
};

/**
 * One picture a pack asks for (generated with Gemini, stored with the project, read by scenes with `env.image(name)`).
 * Names: sets are `set-<place>` (their depth map is `depth-<place>`); stills are whatever the pack names them.
 */
export type AssetSpec = {
  name: string;
  prompt: string;
  /** Names of EARLIER assets in the list passed as reference images (generated first, so they resolve). */
  refs?: string[];
  aspect: "9:16" | "16:9";
  size?: "1K" | "2K";
  /** Also produce `depth-<place>` (for `set-<place>`, else `depth-<name>`): 8-bit greyscale, near = white, same size. */
  depth?: boolean;
  /** Checked once for stray words with a cheap vision call, and redrawn at most once. */
  noText?: boolean;
  /** Words that MAY appear (hand-lettered labels): the word check runs too and only words outside this list count as stray. */
  allowedText?: string[];
};

/** A beat's spoken words, start/end in seconds from the start of that beat's scene. */
export type PackWord = { text: string; start: number; end: number };

/** What a pack's `assets` step sees: the brief, the beats (with any per-beat fields a pack adds) and the voice word times when known. */
export type PackAssetsInput = {
  projectId: string;
  brief: NonNullable<VideoProject["brief"]>;
  beats: (ScriptBeat & Record<string, unknown>)[];
  /** Per beat, its words with times (undefined until the voice exists). */
  words: (PackWord[] | undefined)[];
  aspect: "9:16" | "16:9" | "1:1";
};

/** What a pack's `sceneCode` sees: one beat, its length, its word times and the asset names it may use. */
export type PackSceneCodeInput = PackAssetsInput & {
  beatIndex: number;
  frames: number;
  fps: number;
  /** This beat's words, start in seconds relative to the scene. */
  beatWords: PackWord[];
  /** Asset names this beat's scene may read with env.image(name) (depth names included). */
  assetNames: string[];
};

export type TemplatePack = {
  /** Gallery template id (GalleryTemplate.id) that switches the pack on. */
  id: string;
  /** Replaces EXPLAINER_VOICE in the script writer, for this template only. */
  scriptVoice: string;
  /** Narrator when the person has not picked one, and its delivery (kept over the director's own direction). */
  voice: { id: string; direction: string; /** Cut long pauses inside each take (pcm.tightenPauses): the narrator never drags. */ tighten?: boolean };
  /** The whole Lyria prompt, used as written: no product-video wrapper, no BPM, no final hit. */
  music: string;
  /** Scene direction for the storyboard and scene authoring. */
  sceneDirection: string;
  /** How a storyboard reference frame (one SVG still per beat) of this template looks: the same camera, cast and palette as its scenes. */
  sketchDirection?: string;
  /** The cast kit and pictures for code-drawn scenes (read on first use). */
  scenes?: () => PackScenes;
  /** Each scene module exports `sounds: { kind, frame }[]` (kinds in SCENE_SOUND_KINDS), mixed on the frame its action lands. */
  sceneSounds?: boolean;
  /** Caption defaults for plate films of this template (the person can still change them). wordsPerCue 1 = one spoken word at a time. */
  captions?: { wordsPerCue: number; style: "shadow"; size: number; y: number };
  /** Scene pacing for plate films: a voiced scene is its line plus `gap` (seconds), longer around the title beat and before the last line, never rounded up, at least `min`. */
  pacing?: { gap: number; long: number; beforeLast: number; tail: number; min: number; titleMin: number };
  /** Script rules checked after writing; lines that break them are rewritten once (packScriptIssues). */
  scriptRules?: { maxWords: number; lastMaxWords: number; shortShare: number; forbidden: RegExp };
  /** Pictures generated for the project once the beats exist (plates/pack-assets.ts), in order so `refs` resolve. */
  assets?: (input: PackAssetsInput) => AssetSpec[];
  /** A complete scene module for a beat: authoring skips the model call for it. */
  sceneCode?: (input: PackSceneCodeInput) => string;
  /** Asset names a beat's scene may use (`depth-<place>` is added for a `set-<place>` with depth). */
  sceneAssets?: (beatIndex: number, beats: (ScriptBeat & Record<string, unknown>)[]) => string[];
};

/** Sounds a pack scene may export (`export const sounds = [{ kind, frame }]`): our own generated foley in the SFX library as `foley-<kind>`. */
export const SCENE_SOUND_KINDS = ["mark", "tuft", "thud", "step", "shuffle", "bleat", "whoosh", "hit", "drop"] as const;
export type SceneSoundKind = (typeof SCENE_SOUND_KINDS)[number];

const packFile = (dir: string, name: string) => readFileSync(new URL(`./packs/${dir}/${name}`, import.meta.url));
const once = <T>(make: () => T) => { let value: T | undefined; return () => (value ??= make()); };

const darkFable: TemplatePack = {
  id: "dark-fable",
  scriptVoice: "VOICE FOR THIS FILM: a dark fable. A short, cruel little story about animals that turns out to be about people, told by a calm, low voice. It explains one idea from psychology, society or behaviour by letting the viewer watch it happen first and only then naming it. Two films of this kind passed a million views each; this is their shape.\n\nUSE THIS ONLY WHEN WE WRITE THE SCRIPT. When the person gave their own script, keep their words exactly; the format below is a suggestion they may ignore.\n\nPLAN FIRST. Before the first BEAT, write these lines for yourself (never shown; the only lines allowed before the script):\nIDEA: <the one idea the film names, and its name: e.g. \"stigma: a label makes everyone reject a person\">\nFABLE: <the animals (only the kit's animals: sheep; no props the kit cannot draw: no branches, cages, food or tools other than the narrator's marker), the mark (always a small red dot put on one of them with a marker; never a rope, loop, collar or anything that hangs), the power figure who does it (the narrator, a man in a long coat and a wide hat, seen only as a gloved hand with the marker or as a towering coat), and the visible cruel act. The trick must work on the animals the same way the idea works on people. Never copy a known fable or video.>\nMAPPING: <the same mechanism among people, said concretely: who holds the marker, who gets marked, what the crowd does>\nCHORUS: <one short phrase the film repeats, which the last line turns into a question or a reversal: e.g. \"who put the dot there\">\nOBJECTS: <ids for the things that recur, so every frame names them the same way: e.g. flock, sheep-marked, narrator-hand, marker, narrator-coat, fence, people-row, person-marked>\n\nTHE NINE BEATS (fit them to the beat count):\n1. THE ACT, first line, no setup, said within 3 seconds: a visible, physical, cruel act by the power figure on one animal. Either a first-person confession, past tense (\"Yesterday, I put one red dot on a sheep.\"), or a third-person legend (\"A farmer once ...\"). Pick one and keep it for the whole fable.\n2. THE CONSEQUENCE, in tiny lines (two to five words each): what happened to the animal (\"By morning, it was alone.\" \"It cried.\" \"It ran.\").\n3. THE SILENCE of the onlookers, one line (\"Nobody in the flock looked up.\").\n4. THE STRANGE METHOD: what the power figure does next or who they choose and why, the twist that makes the viewer lean in, ideally as a short list (\"The one that... The one that...\").\n5. INSIDE THEIR HEADS: what the victim or the crowd tells themselves, in two-to-four-word lines (\"He has a dot. I don't. So I am safe.\").\n6. THE MORAL from the power figure, one line, flat and cold (in the legend form, the figure says it aloud; in the confession form, the narrator says it as fact).\n7. THE NAME, as two beats: \"Psychologists have a name for this.\" then the term alone (the title beat; its BEAT is the term in capitals). It lands between 45% and 65% of the film.\n8. THE REAL WORLD: one plain definition, then the same marker and crowd among people, with a list of three that escalates (\"dangerous. A traitor. An enemy.\" / \"in homes, in offices, in entire countries.\"). Name roles (a boss, a crowd, people in power), never real named people, parties, countries or groups.\n9. THE TURN BACK: a last callback in the fable (the cycle continues) and a closing line that turns the CHORUS into a question to the viewer, or flips a common saying (\"before you thank the hand that feeds you, look at what it took from you first\"). Never a call to action, never a moral spelled out twice.\n\nRHYTHM (this is what makes it gripping):\n- LENGTH: about 90 seconds unless the person asks for another length: 24 to 30 beats and about 210 to 235 spoken words. The narrator reads briskly (about 160 words a minute) with only a few long pauses, so the words, not silences, fill the time. Shorter films scale down the same way.\n- One sentence per beat. Each idea is a little cell: one or two longer lines (8 to 15 words) that set it up, then it ends on its SHORTEST line. At least a third of the beats are four words or fewer. Never end a cell on a long line.\n- Repetition: the CHORUS appears at least twice before the end; a key noun (the dot, the flock, the others) recurs; one \"The one that... The one that...\" list.\n- Time words that tick: \"Yesterday... By morning... That night... This morning.\"\n- Plain, physical verbs (marked, pushed, attacked, dropped, followed, turned away). No questions except the last line (and one the narrator may ask inside the fable).\n- Read every VOICE line in order as one paragraph: it must sound like one person telling one story, and no two lines could swap places.\n\nSTYLE:\n- Spoken English, contractions, everyday words. The name of the idea is the only technical word.\n- Calm and matter-of-fact even when the events are cruel; the narrator never touches the victim with anything but the marker, and in the confession form keeps his own hands clean (\"I never touched it.\"). No adjectives that tell the viewer how to feel (shocking, terrible, sad), no exclamation marks, no hype, no \"in this video\".\n- No gore: say what happened (\"the others had killed it\"), never describe it.\n- Facts: do not state statistics, studies or dates the brief doesn't give. \"Psychologists have a name for this\" is fine; inventing a study is not.\n\nPER BEAT:\n- BEAT: the key words of the line (the caption system shows the spoken words one at a time; BEAT is the label). The title beat's BEAT is the term in capitals.\n- VISUAL: one shot, one action, of the beat's own line, using the OBJECTS ids. Say the shot size (wide, medium or close), the one thing that moves and on which word, and the camera: \"hold\", \"reveal (zoom out) on <word>\", \"tilt up the narrator\", or \"slow push-in\". The first beat opens close on the act and reveals the watching flock. 6 to 10 camera moves in the film; most beats hold. The narrator is only ever a gloved hand with the marker, or a towering coat, boots and hat; never a face. People are faceless mannequins. The mark is a red dot and the only red thing. Shots are at eye level, side on; never a view from above.\n- SCREEN: - (always; the words are the captions).\n- VOICE: the line.",
  voice: { id: "Algenib", tighten: true, direction: "An older man quietly confessing something cruel, close to the mic, low, a little gravel. Calm, never loud. Rush the setup lines; slow and heavy on the word that hurts. Lines end falling." },
  music: "Dark ambient drone bed for a calm narrated fable. Layered low synth pads with slight detuning, low C minor modal centre, one static drone with no chord changes. No drums, no kick, no pulse, no heartbeat, no rhythm, no melody, no lead line, no bells. Long dark reverb, wide and cold. Starts very soft and builds imperceptibly; around the middle a faint high glassy shimmer joins; peaks gently near the end, then a slow fade out.",
  scenes: once(() => {
    const kit = packFile("dark-fable", "kit.txt").toString("utf8");
    const images = [
      { label: "THE KIT DRAWN (test shots made only with K: a marked sheep close with the hand, a wide flock, the narrator coat figure, the people half). Your scene must look like these:", data: packFile("dark-fable", "kit-shots.png") },
      { label: "THE KIT'S CAMERA AND MOTION (each column is one test shot at frames 5, 25, 40, 70, top to bottom): 1 a snap reveal from the hand marking a sheep out to the watching flock; 2 K.flock (spaced, facing in, stepping back with dx) around a frightened marked sheep (K.shake) with a K.burst of tufts; 3 a smooth tilt up the towering narrator from his boots; 4 a slow push-in on the marked person in the crowd.", data: packFile("dark-fable", "kit-motion.png") },
      { label: "A FINISHED FILM OF THIS TEMPLATE (one frame per scene: eye-level camera, figure sizes, spacing, the red dot as the only red):", data: packFile("dark-fable", "example-film.png") }
    ];
    const hash = createHash("sha256").update(kit).update(darkFable.sceneDirection); for (const image of images) hash.update(image.data);
    return { kit, images, hash: hash.digest("hex").slice(0, 12) };
  }),
  sketchDirection: [
    "Style guide: the template \"Dark fable\". Draw the still exactly in the look of the pictures above (the template's cast kit and a finished film):",
    "- CAMERA: eye level, side on, at animal height. A straight horizon between 42% and 60% of the height. NEVER a top-down or bird's-eye view, NEVER a ring or circle of animals seen from above: a crowd around someone stands left, right, in front of and behind it.",
    "- SIZE: the focal figure fills 35-55% of the frame width; wide shots hold at most 14 animals in loose rows, smaller as they are further back; feet on the ground, far figures drawn first.",
    "- PALETTE: night ground #1b1c20 / #24262c, dusk sky #3e4452, moon #e9e4d4 with a soft halo, dark silhouettes #121316 (fence, barn, city blocks). Figures: cream #d9cdb0 with shade #b9ad90 and a thin cream outline #ece6d6. The ONLY saturated colour is the red mark #d0262b.",
    "- CAST: sheep in side profile (woolly scalloped body, small cream head with a dot eye and an ear, thin grey legs) or seen from behind; the narrator is ONLY a navy sleeve with a white cuff and a dark gloved hand holding a grey marker with a red tip, or a tall figure in a long dark coat and a wide-brim hat whose head is a black disc (never a face); people are faceless dark wooden mannequins (round head, block torso, jointed limbs, cream outlines) in rows in front of dark tower blocks.",
    "- THE MARK: always a small red dot on a flank or chest. Never a rope, loop, collar or anything that hangs.",
    "- NO WORDS in the picture at all (no title, no labels, no key phrase): captions are added later. The title beat is the flock darkened to 40%."
  ].join("\n"),
  sceneDirection: "# Dark Fable: scene direction (added to every scene's authoring prompt)\n\nEvery scene is built from the **Dark Fable cast kit** (available as `K`). The kit is the only way to draw the cast and the setting, so every scene matches every other scene. A scene chooses the shot, places kit pieces, moves the camera and animates the pieces over time. It never draws its own animals, people, hand, fence, barn, city or moon.\n\nTwo viral films of this kind (each over a million views) were measured. What holds attention:\n- something moves in most frames;\n- the camera is still most of the time and then makes one sharp, motivated move;\n- the powerful figure is drawn huge and the victim small;\n- the only colour is the mark.\n\n## The camera: still, then one sharp move with a reason\nWrite `ctx.setTransform(env.scale,0,0,env.scale,0,0); ctx.save(); K.camera(ctx, frame, keys);` on EVERY shot (`keys` may be `[]` for a hold; the camera then drifts slowly closer on its own, which keeps the picture alive), draw the whole 1080x1920 shot as usual, then `ctx.restore(); K.vignette(ctx);`. Pass `K.camera(ctx, frame, [], 0)` (no drift) only on the title beat and the frozen-onlookers beat. The camera is locked for most of the shot. When it moves, the move is one of these, and it lands on the word that motivates it:\n\n| Move | When the line... | Keys |\n|---|---|---|\n| **Reveal (zoom out)** | names the audience, the crowd, the scale, or the aftermath (\"in front of the whole flock\", \"they all just stand there\", \"alone\") | start close on the act (z 2.5–3.5 on it), hold it, then `ease: \"snap\"` out to z 1 over 12–24 frames |\n| **Tilt up the power figure** | the narrator, or the one in charge, acts or is revealed | start low on the boots or hem at z 2–2.6, then `ease: \"smooth\"` up to the hat over 24–45 frames |\n| **Slow push-in** | the horrible detail, the moment it sinks in, the last line | z 1 to 1.4–2.0 with `ease: \"slow\"` over the whole line |\n| **Hold** | everything else | one key, or none |\n\nRules:\n- **The hook (scene 1) opens close and reveals within its first 2 seconds.** Start on the act (the hand, the marked animal), then snap out to show who is watching.\n- **6 to 10 moves in the whole film, never two snaps in a row, and at most one move per shot.** Most shots hold.\n- **Eye level, side on, always.** The horizon is a straight line between y 800 and y 1150, and animals are seen in side profile (`K.sheep`) or from front or back (`K.sheepFront`). Never a top-down or bird's-eye view, never a ring of animals seen from above. The low-angle tilt is the only exception, and only on the power figure.\n\n## Scale tells who has power\n- **The power figure is huge.** The narrator (`K.narrator`) stands in the foreground at s 0.9–1.3, cropped by the frame, with the victim small at its feet (s 0.5–0.8). The hand (`K.hand`) is big at s 1.2–1.6 against a sheep at s 0.8–1.2.\n- **The victim alone is small in a big empty frame** when the line is about isolation (\"alone\", \"nobody came\"). Otherwise the focal figure fills 35–55% of the frame width:\n  - close: `K.sheep` s 1.6–2.2;\n  - medium: hero s 1.0–1.4 with 3–6 others;\n  - wide: 10–14 figures at s 0.35–0.9 placed with `K.crowd`.\n- **Every flock is drawn with `K.flock`** (at most 14 sheep, spaced rows, never stacked; `clear` keeps a gap around the marked one, `extra` adds the marked one and the narrator so everything is drawn far to near; `face: \"in\"` makes them look at it; `dx` with `K.span` steps them back). Never place flock sheep one by one, and never let two sheep overlap by more than a third.\n- **One size rule within a crowd:** crowd figures take their scale from `K.crowd` or `K.depth`, never bigger because they matter.\n- **Feet on the ground, far to near:** draw sheep, mannequins and the narrator in one `K.figures(ctx, [...])` call.\n- **Beside or behind, never on top:** a figure next to a fallen one stands at least 0.6 of a body width away on the same ground line, or 60 px further back.\n\n## Motion: something moves in most frames\nEach shot does ONE action, timed to the words: it starts on the word that names it (frame = word time × 30) and lands within 0.3–1 s.\n- **Hands enter** from a frame edge with `K.move(frame, a, b, from, to)` and press (`press`).\n- **An attack or scuffle** throws wool with `K.burst(ctx, frame, at, x, y, groundY)` on the frame it lands. The tufts stay where they fall and `K.pile` grows from them.\n- **Fear** is a tremble: add `K.shake(t, 1–1.5)` to the frightened figure's position.\n- **Walking** uses `walk: 1` with `t`, crowds stepping in or back animate x with `K.span`, and heads turn with `head`.\n- **After the action, the shot keeps small life:** breathing and idle bob, drifting `K.tufts`, the mark's `K.glow` breathing.\n- **Only two shots stand completely still:**\n  - the silence of the onlookers (\"nobody moved\"): everyone frozen, one tuft drifting down;\n  - the title beat.\n\n## The meaning object\nThe red mark is the only saturated colour in the film, and its colour is the story.\n- `K.dot`, `mark:` options and the marker tip.\n- `K.glow(ctx, x, y, r, t * 0.5)` behind it whenever the mark is the subject.\n- Never a rope, cord, loop, ribbon, collar or anything that hangs: if the script says one, draw the dot.\n\n## The two halves\n- **The fable:** `K.backdrop`, then `K.moon`, `K.barn` and `K.fence` on the horizon (`K.fenceNear` for close shots). Night or dusk.\n- **The turn to people:** `K.backdrop(…, \"night\")` with `K.city` and faceless `K.mannequin`s in rows, the marked one with `mark: 1`.\n  - **The power figure rhymes across the turn:** the same coat-and-hat `K.narrator` (or the same hand and marker) now towers over the people, so the viewer recognises the shape without being told.\n- **The last shot echoes the first:** the same place, the same mark, now with the aftermath (a `K.pile`, the hand still holding the marker).\n\n## Palette\nOnly the kit's colours:\n- Night ground #1b1c20 / #24262c; dusk sky #3e4452; dawn #5a6272.\n- Cream animals with thin cream outlines; dark mannequins and narrator with cream outlines.\n- **#d0262b only for the mark.**\n\n## Shot grammar\n- One beat = one shot = one action. Hard cuts; no transitions.\n- Keep the band y 830–960 free of faces and of the mark: the caption sits there. The horizon and fence may cross it.\n- **The title beat:** the opening fable shot redrawn (the flock and the marked one), then `K.dim(ctx, 0.6)`, with a few `K.tufts` drifting and nothing else moving. No camera move.\n- No words drawn by the scene, ever. Finish every scene with `K.vignette(ctx)` after `ctx.restore()`.\n- Use `K.span(frame, a, b)` for every timed change. Everything comes from `frame`; no randomness except `K.rng(seed)`.",
  sceneSounds: true,
  captions: { wordsPerCue: 1, style: "shadow", size: 72, y: 46 },
  pacing: { gap: 0.15, long: 0.6, beforeLast: 0.5, tail: 1.2, min: 0.9, titleMin: 1.6 },
  scriptRules: { maxWords: 16, lastMaxWords: 14, shortShare: 0.25, forbidden: /\b(rope|loop|noose|collar|leash|hang(?:ed|s|ing)?)\b/i }
};

const packs: Record<string, TemplatePack> = { [darkFable.id]: darkFable, "picture-film": pictureFilm, "history-reel": historyReel };

/** Adds (or replaces) a pack by id: for packs defined in their own folders, and for tests. Returns a function that removes it again. */
export function registerTemplatePack(pack: TemplatePack): () => void {
  const previous = packs[pack.id];
  packs[pack.id] = pack;
  return () => { if (previous) packs[pack.id] = previous; else delete packs[pack.id]; };
}

/**
 * Lines of a written script that break the pack's rules (TemplatePack.scriptRules), as beat indices with what to fix. The script route
 * rewrites just these beats once, before the person sees the finished script. Short-line share: when fewer than `shortShare` of the lines
 * are four words or fewer, the longest non-title lines are asked to become short ones.
 */
export function packScriptIssues(pack: TemplatePack | undefined, beats: { keyword: string; line?: string | null; visual?: string | null }[]): { index: number; message: string }[] {
  const rules = pack?.scriptRules;
  if (!rules || !beats.length) return [];
  const words = (text: string | null | undefined) => (text ?? "").trim().split(/\s+/).filter(Boolean).length;
  const isTitle = (keyword: string) => /^[A-Z0-9][A-Z0-9' -]*[A-Z]$/.test(keyword.trim());
  const out = new Map<number, string>();
  const last = beats.length - 1;
  beats.forEach((beat, index) => {
    const count = words(beat.line);
    if (rules.forbidden.test(`${beat.line ?? ""} ${beat.visual ?? ""}`)) out.set(index, "It mentions a rope, loop, collar or hanging; the mark is only ever a small red dot. Rewrite without it.");
    else if (index === last && count > rules.lastMaxWords) out.set(index, `The last line has ${count} words; land the film in ${rules.lastMaxWords} words or fewer (the chorus as a question, or a flipped saying).`);
    else if (count > rules.maxWords) out.set(index, `This line has ${count} words; keep it to ${rules.maxWords} or fewer.`);
    if (isTitle(beat.keyword) && /\b(empty|blank|text|title|words?|letters?)\b/i.test(beat.visual ?? "")) out.set(index, "The title beat's VISUAL must be the opening fable shot redrawn and dimmed (the flock and the marked one), not an empty or text frame.");
  });
  const short = beats.filter((beat) => words(beat.line) <= 4).length;
  const need = Math.ceil(beats.length * rules.shortShare) - short;
  if (need > 0) {
    const longest = beats.map((beat, index) => ({ index, count: words(beat.line) })).filter((x) => x.index !== last && !isTitle(beats[x.index]!.keyword) && !out.has(x.index)).sort((a, b) => b.count - a.count);
    for (const x of longest.slice(0, need)) out.set(x.index, "Too few short lines in this film: make this line four words or fewer, so its idea ends on a tiny line (keep what it means).");
  }
  return [...out].map(([index, message]) => ({ index, message })).sort((a, b) => a.index - b.index);
}

/** The pack of the template the person started from, when that template has one. */
export const templatePack = (styleExample: string | null | undefined): TemplatePack | undefined => (styleExample ? packs[styleExample] : undefined);

/** A scene module ready to bundle: a pack's cast kit goes in right after the module's imports (the kit declares the global K). */
export function withPackKit(code: string, pack: TemplatePack | undefined): string {
  const scenes = pack?.scenes?.();
  if (!scenes) return code;
  let end = 0;
  for (const match of code.matchAll(/^import[^\n]*\n/gm)) end = match.index + match[0].length;
  return `${code.slice(0, end)}\n${scenes.kit}\n${code.slice(end)}`;
}
