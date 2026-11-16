// History-reel template pack: a true story from history told fast by flat cut-out puppets acting on a painted, rendered-3D-looking
// set, under a camera that never stops. Source: experiments/history-reels (ANALYSIS.md for the measured reference reels, template/ for
// the kit, the owner-approved rig rules in template/reference/POSE_RULES.md and the Niagara film). This folder is now the source of
// truth for the product; the experiment is the test bench.
// Each place in the story is one generated EMPTY set image (plus a depth map made on the render worker); the scene modules draw the
// cast, the props and the camera on top of it with the kit in kit.txt (global K).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ScriptBeat } from "@videosaas/contracts";
import type { AssetSpec, TemplatePack } from "../../template-packs.ts";

/** A place of the story: an empty set the cast acts in. */
export type HistoryPlace = { id: string; description: string };

const file = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url));
const once = <T>(make: () => T) => { let value: T | undefined; return () => (value ??= make()); };

/** The look every set shares (experiments/history-reels/template/tools/make-inputs.mjs SET_STYLE): the rendered-3D world the flat puppets stand in. */
export const SET_STYLE = "A vertical 9:16 frame from a stylized 3D animated film, rendered in a modern game engine (Unreal Engine look): saturated colours, soft global illumination, crisp detailed foreground, background slightly out of focus (shallow depth of field), cinematic light. No people, no characters, no animals, no text, no letters, no signs with words, no watermark.";

// ---------------------------------------------------------------- places: from the script plan and the beats' [place] tags
const placeId = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
const TAG = /^\s*\[([A-Za-z0-9 _-]{1,32})\]/;
/** The place tag a beat's VISUAL starts with (`[gorge] wide: ...`), or null. */
export const beatPlace = (beat: Pick<ScriptBeat, "visual"> | undefined): string | null => {
  const m = TAG.exec(beat?.visual ?? "");
  return m ? placeId(m[1]!) || null : null;
};

/** `PLACES: gorge = <empty set>; bedroom = <empty set>` (inside OBJECTS today, or its own note later) -> places. */
export function parsePlaces(text: string): HistoryPlace[] {
  const m = /PLACES\s*:\s*([\s\S]*?)(?=\s+(?:CAST|PROPS)\s*:|\n\s*[A-Z]{3,}\s*:|$)/.exec(text);
  if (!m) return [];
  const out: HistoryPlace[] = [];
  for (const part of m[1]!.split(/[;|]\s*(?=\[?[A-Za-z0-9 _-]{1,32}\]?\s*=)/)) {
    const kv = /^\s*\[?([A-Za-z0-9 _-]{1,32})\]?\s*[=:]\s*([\s\S]+?)\s*$/.exec(part);
    const id = kv ? placeId(kv[1]!) : "";
    if (id && kv && !out.some((p) => p.id === id)) out.push({ id, description: kv[2]! });
  }
  return out.slice(0, 3);
}

const strings = (value: unknown, depth = 0): string[] => {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, depth + 1));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap((v) => strings(v, depth + 1));
  return [];
};

/**
 * The film's places. Read, in order: an explicit `places` list, a PLACES block anywhere in the script notes (OBJECTS carries it today),
 * then the beats' [place] tags (a tag with no description is described by its first VISUAL). Never empty: a film with no plan gets
 * one place, "main", described by its idea or first VISUAL.
 */
export function placesFrom(input: unknown): HistoryPlace[] {
  const obj = (input ?? {}) as { places?: unknown; beats?: ScriptBeat[]; scriptBeats?: ScriptBeat[]; notes?: unknown; scriptNotes?: unknown; brief?: { scriptBeats?: ScriptBeat[]; scriptNotes?: unknown } };
  let places: HistoryPlace[] = [];
  if (Array.isArray(obj.places)) places = obj.places.flatMap((p: { id?: string; description?: string }) => (p?.id && p.description ? [{ id: placeId(p.id), description: p.description }] : []));
  if (!places.length) for (const text of strings([obj.notes, obj.scriptNotes, obj.brief?.scriptNotes, obj.places])) { places = parsePlaces(text); if (places.length) break; }
  const beats = obj.beats ?? obj.scriptBeats ?? obj.brief?.scriptBeats ?? [];
  for (const beat of beats) {
    const id = beatPlace(beat);
    if (id && !places.some((p) => p.id === id)) places.push({ id, description: (beat.visual ?? "").replace(TAG, "").trim() });
  }
  if (!places.length) {
    const idea = strings([obj.notes, obj.scriptNotes, obj.brief?.scriptNotes]).find(Boolean) ?? beats[0]?.visual ?? beats[0]?.line ?? "a place from history";
    places.push({ id: "main", description: idea });
  }
  return places.slice(0, 3);
}

/** The place a beat is in: its own tag, else the last tagged beat before it, else the next one after it, else the first place. */
export function placeOfBeat(beatIndex: number, beats: readonly Pick<ScriptBeat, "visual">[], places?: HistoryPlace[]): string {
  for (let i = beatIndex; i >= 0; i--) { const id = beatPlace(beats[i]); if (id) return id; }
  for (let i = beatIndex + 1; i < beats.length; i++) { const id = beatPlace(beats[i]); if (id) return id; }
  return places?.[0]?.id ?? "main";
}

/** What made the reference Niagara set look right (experiments/history-reels, films/niagara/sets.json), asked of every set: bright daylight, visible sky, clear air. */
const SET_LOOK = "Look: bright, colourful and clear like the best frames of a modern animated feature. A visible sky in the top quarter (soft clouds or a clear colour gradient), one clear light direction with soft shadows, sharp detailed middle ground, clean air: no fog, haze, murk or heavy mist covering the scene (a thin mist rising in the distance is fine). Rich saturated greens, blues and warm earth tones; never grey, brown or dull. A night or interior set stays warm and readable: a glowing lamp, moonlight on the floor, colour in the shadows.";
const setPrompt = (p: HistoryPlace) =>
  `${SET_STYLE}\n\n${p.description}\n${SET_LOOK}\nThe bottom 35% of the frame is flat open ground with lots of empty space in the centre for people to stand on. An empty set: no people, no characters, no animals, no vehicles or objects that would move, no text.`;

// ---------------------------------------------------------------- the writer's voice
const scriptVoice = `VOICE FOR THIS FILM: a cartoon history reel. ONE true, strange story from history, told fast and deadpan by a young storyteller, acted by cut-out cartoon puppets in a painted 3D world. Two reference reels of this kind ("How Mine Salting Worked", "How One Cart Stopped an Entire Army") were measured; this is their shape.

USE THIS ONLY WHEN WE WRITE THE SCRIPT. When the person gave their own script, keep their words exactly; still write the PLAN and start every VISUAL with its place tag.

PLAN FIRST. Before the first BEAT, write these three lines for yourself (never shown; the only lines allowed before the script; each on ONE line):
IDEA: <the true story in under 200 characters: who, what, where, the year, and the ironic ending. Only facts you are sure of.>
EXAMPLE: PLACES: gorge = Niagara Gorge in 1859, seen from the top of the American cliff. Foreground (bottom 35%): a flat grassy cliff-top with a few rocks and wildflowers and a wooden post-and-rail fence at the left edge, lots of empty flat ground in the centre. Middle: the cliff edge drops into a deep green gorge with the river far below and white mist rising. Background: the great horseshoe waterfall in the distance on the right, the far cliff with trees across the gorge, a bright blue sky with soft clouds, afternoon sun from the left. No rope, no people, no animals.; <place-id> = <...>
OBJECTS: CAST: <cast-id> = <look>; <cast-id> = <look> PROPS: <prop ids>
- PLACES (the EXAMPLE line, under 1100 characters): 1 or 2 places, 3 at most (fewer is better: the camera travels inside one set). The id is one lowercase word or two with a hyphen (gorge, fort, mine-shaft). The description is a painter's brief of the EMPTY set in 350 to 450 characters, written like the example above (foreground ground, middle, background, a bright sky with soft clouds, the sun side): the era and the real location, the time of day and where the sun comes from, what fills the middle and the background, and flat open ground in the bottom third where people stand. No people, no animals, no text, no signs with words. Things that move in the story (a cart, a rope, a door, a cannon that fires) are NOT in the set; they are drawn in code.
- CAST (the OBJECTS line, under 380 characters in all): our own cartoon characters, 1 to 4, each in a few words: era clothes in one clear shirt colour, hat or hair, moustache or beard, build (thin, stout). Teams by shirt colour. Never a known cartoon or channel character. PROPS: the things that move or get used (rope, wheelbarrow, pan, crate, pickaxe, cart).

THE SHAPE (fit it to the beat count):
1. THE STRANGE ACT, line 1, mid-action, no setup, said within 2 seconds: a visible, physical, absurd act ("He loaded a shotgun with gold and fired it into the walls of his own mine."). The why comes later.
2. A BYSTANDER'S DOUBT, as a quoted line in the bystander's words, deadpan ("So we're shooting gold into a gold mine?").
3. STAKES AND A CLOCK in the first 15 seconds: tomorrow, next week, by sunset, an army is coming.
4. ESCALATION: "But it gets weirder." (or the same hinge in other words), then the method step by step, each step one visible action.
5. "You see," then the mechanism, said plainly in one or two lines: how the trick really works.
6. THE DOUBTER IS PROVED WRONG: the expert, the crowd, the commander sees it work.
7. THE PAYOFF: one plain, ironic line that reverses everything ("ten feet past where the last guy gave up"). No moral, no call to action, no question to the viewer.

RHYTHM:
- LENGTH: 45 to 60 seconds unless the person asks for another length, read at about 225 words a minute with no pauses: 170 to 225 spoken words in 14 to 24 beats.
- One sentence or one clause per beat. Sentences swing from 2 words ("Completely insane.") to long run-ons of 20+ words that keep the voice racing; the median is about 10.
- Exact small numbers (82 holes, ten feet, a hundred bucks). The hero is mostly "he" or "she" once named. Keep one tense.
- Deadpan comedy in the quoted lines; the narrator never says how to feel (no "shocking", "incredible", "insane" more than once, no exclamation marks, no "in this video").
- Read every VOICE line in order as one paragraph: it must sound like one friend telling another a crazy story.

FACTS: real facts only. Never invent names, dates, numbers or quotes beyond plain dramatised bystander lines. When unsure of a detail, leave it out. If the brief is not a true story, find the closest well-documented true story that fits and tell that.

PER BEAT:
- BEAT: the key words of the line, in normal case (never all capitals).
- VISUAL: ALWAYS starts with the place tag in square brackets, then one shot: [gorge] <shot size: wide / medium / close>, <which CAST ids do what, and on which word>, <the camera move: snap reveal out on <word>, push in on <word>, whip in, look down on <word>, slow drift>. Every shot moves. One action per shot, landing on its verb.
- SCREEN: - (always; the words are the captions).
- VOICE: the line.`;

// ---------------------------------------------------------------- the scene writer's direction
const EXAMPLE_SCENE = `import type { Ctx, Env } from "./core";
import type { Film } from "./film";
const durationFrames = 90;
// the cast is built once, outside draw (the same numbers in every scene of the film)
const blondin = K.makeCast({ skin: "#e9b892", skinShade: "#cc9673", shirt: "#8e2b3c", shirtShade: "#6c1f2d", dots: "#f3c64f", collar: false, buttons: false, pants: "#efe3c6", pantsShade: "#cdbf9d", hair: "#2b1a12", moustache: "#2b1a12", width: 112, torso: 146, leg: 92 });
const harry = K.makeCast({ shirt: "#4a4a58", shirtShade: "#363642", pants: "#3c3c48", pantsShade: "#2c2c36", hat: "bowler", hatColor: "#2a2420", hatShade: "#1b1714", moustache: "#5a3a22", vest: "#7a2f2f", vestShade: "#5c2323", width: 124, torso: 140, leg: 80 });
const crowd = K.crowdCast(10, 7);
const rope = K.ropeCurve({ x: 150, y: 1095, d: 0.62 }, { x: 960, y: 770, d: 0.12 }, 70);
// LINE: "...a man walked across Niagara Falls on a rope." WORD START FRAMES: ... walked@32 across@44 ...
// wide on the gorge with a slow creep, then a snap push in to the walker landing on "across"
const KEYS = [[0, { x: 540, y: 1250, z: 1.05 }], [40, { x: 540, y: 1240, z: 1.1 }, "lin"], [52, { x: 470, y: 980, z: 2.2, px: -20 }, "snap"], [89, { x: 480, y: 975, z: 2.35 }, "lin"]];
function draw(ctx: Ctx, frame: number, env: Env) {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  const t = frame / 30, tp = (frame - (frame % 2)) / 30; // puppets move on twos (tp); the camera and the air stay smooth (t)
  const cam = K.camera(frame, KEYS);
  K.set(ctx, env, cam, "gorge");
  K.actors(ctx, env, cam, (g) => {
    K.mist(g, cam, t, 650, 1000, 820, 0.12);
    K.drawRope(g, cam, rope, 9);
    const u = 0.42 + tp * 0.012, p = rope(u), walk = K.pose.walk(blondin, tp, "side", 1.6);
    const balance = { face: 1, ...K.pose.holdPole(blondin, "side"), stepF: walk.stepF, stepB: walk.stepB, fFy: walk.fFy, fBy: walk.fBy, bob: walk.bob, lean: 2 + Math.sin(tp * 2.3) * 3, face2: K.FACE.focus };
    K.puppet(g, cam, blondin, p.x, p.y, 150 - u * 120, balance, { shadow: false, d: p.d + 0.02, front: (c: Ctx, R: any) => K.pole(c, R, Math.sin(tp * 2.3) * 4) });
    K.crowd(g, cam, crowd, [[1500, 230, 4], [1650, 290, 4]], frame - (frame % 2), "watch", 560, 1040);
    K.puppet(g, cam, harry, 300, 1640, 480, { face: 1, ...K.pose.fidget(harry, tp), head: -6, look: 0.9, face2: { ...K.FACE.scared, blink: K.blink(frame, [20, 70]) } }, { sun: "left" });
    K.motes(g, cam, t);
  });
}
export const film: Film = { meta: { title: "gorge", W: 1080, H: 1920, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };
export const sounds: { kind: string; frame: number }[] = [{ kind: "whoosh", frame: 41 }, { kind: "step", frame: 60 }];`;

const sceneDirection = `# History reel: scene direction (added to every scene's authoring prompt)

Every scene is ONE shot of a fast true-history reel: our own flat cut-out puppets acting in front of a painted, rendered-3D set, under a camera that never stops. The set picture for the beat's place is already made; the scene draws it with \`K.set\`, then the cast, props and air on top with the kit \`K\`. THIS TEMPLATE'S KIT HAS NO K.backdrop AND NO K.vignette: the set image IS the backdrop; never fill the frame with a flat colour, never draw your own landscape or sky.

## The frame, in order (every scene)
1. \`ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);\` then \`const t = frame / 30, tp = (frame - (frame % 2)) / 30;\`
2. \`const cam = K.camera(frame, KEYS);\` (KEYS: see the camera grammar).
3. \`K.set(ctx, env, cam, "<place>");\` the beat's place id from its VISUAL tag ([gorge] -> "gorge"). It draws the set with depth parallax and motion blur and completes \`cam\`, so everything after it can be placed in the set.
4. \`K.actors(ctx, env, cam, (g) => { ... });\` draw ALL puppets, props and air with \`g\` inside it, far to near: mist and far props, the cast from the back row to the front, then \`K.motes\` or \`K.rain\` last. It grades the drawn layer with the set's warm light so flat colours sit in the world.
5. Optional: \`K.fade(ctx, env, amount)\` (only the first frames of the last beat).
Nothing else is drawn after the actors. No captions: the editor adds them.

## Coordinates
- **Plate space** (camera keys, K.puppet, K.at, K.toScreen, props in the set): the set is 1080 wide and about 1935 tall (9:16). The flat ground where people stand is the bottom third: y 1300 to 1850, x 100 to 980. The horizon and the middle ground sit around y 700 to 1150; the sky above.
- **Depth**: \`K.depthAt(cam, x, y)\` (0 far .. 1 near) from the set's depth map; K.puppet and K.at use it on their own. Pass \`d\` only for things not standing on the set's ground (a man on a rope, a bird in the sky).
- **Puppet space** (inside drawPuppet and the opts.front/behind props): feet on y = 0, up is negative, facing +x; \`face: -1\` mirrors.
- **Screen space** (things glued to the lens, like K.popLines, K.steam, K.ropeNear, K.rain): the scene's W x H; get a set point's screen position with \`const [sx, sy, k] = K.toScreen(cam, x, y, d)\`.

## The cast (our own; never a known cartoon or channel character)
- Build each character ONCE at module level with \`K.makeCast({...})\`, from the CAST in the OBJECTS note: shirt colour (teams by colour), pants, boot, hat ("wide", "bowler", "top", "nightcap"), hair, moustache, beard, glasses, vest, braces, dots; build with width (80 thin .. 140 stout), torso, leg. Use the SAME numbers in every scene (copy them from the CAST note's look, consistently).
- Crowds: \`K.crowdCast(n, seed)\` (pass a team's colours as the third argument: \`K.crowdCast(12, 3, { shirt: "#c79a3a", shirtShade: "#a07a26" })\`) and \`K.crowd(g, cam, members, rows, frame, mood, x0, x1)\` with rows far to near: \`[[1450, 220, 5], [1600, 290, 5], [1760, 360, 6]]\`.
- Expressions: \`face2: K.FACE.<name>\` (calm, focus, smug, wow, grin, scared, terror, shut, happy, asleep, angry, doubt, shout, sad), spread to add \`blink: K.blink(frame, [frames])\`, \`blindfold: true\`, \`sweat: true\`, or a speaking mouth \`mouth: K.talk(frame)\` for a bystander's quoted line.

## Sizes and placement (h = standing height in plate px)
- **Ground rows:** a figure standing at plate y is about \`h = (y - 1100) * 0.65\` tall (y 1450 -> 230, y 1600 -> 325, y 1760 -> 430). The hero of a medium shot may be up to 1.4 times that.
- **Medium shot (most beats):** the hero 420-650 tall at y 1550-1800, camera z 1.3-1.7 centred near his chest; the hero fills 35-55% of the frame height.
- **Close / reaction:** the same placement, camera z 2.4-3.4 on the head (y about 1.0 h above his feet).
- **Wide / reveal:** figures 120-300 tall, camera z 1.0-1.2.
- **Feet on the ground, never floating**: the feet are the (x, y) you pass. Two figures side by side stand at least 0.6 of a body width apart on the same line, or 60 px further back and smaller.
- Every standing puppet gets its shadows from K.puppet (shadow: false only for someone in mid-air or on a rope). \`sun: "left" | "right" | "top"\` matches the set's light from the PLACES note.

## The rig and the pose rules (owner-approved; always keep them)
- A pose is a spread of named pose functions: \`{ face: 1, ...K.pose.holdOut(cast, "three"), head: -6, face2: K.FACE.smug }\`. Every number in K.pose is a fraction of that character's own size, so any cast stands and moves the same way. Library: stand(view), walk(t, view, speed), run(t, view), holdPole, push, holdOut, handsOnHips (front), armsOut (front), pointUp (front), point (three), armsUp (front), sit(seat, view), carry + ride (with K.drawPiggyback), fidget(t), swing(k) (a tool from raised k 0 to struck k 1).
- **Views:** "side" (profile: the far arm is hidden BEHIND the body), "three" (default three-quarter: the far arm hangs half visible along the back edge, behind the body), "front" (both arms in front). Never set armsFront on a side or three view.
- **Arms:** relaxed hands hang OUTSIDE the body's edges, never in front of the crotch; hanging arms are nearly straight (elbow at the waist, wrist at the belt). Elbows bend one way: reaching forward the elbow drops below (eF "down"); hanging or hand on hip side-on it points back ("back"); from the front, elbows point outward. Hands are always visible or holding a prop: never a hand hidden behind the back or cut off.
- **Holding:** a pole: the near hand at the chest, elbow down by the side (pose.holdPole + K.pole as opts.front). Holding out a pan or lamp: near arm 0.74 forward, far hand at the back hip (pose.holdOut). Pushing low: lean 16°, both hands forward and down, the back leg pushing (pose.push + K.wheelbarrow).
- **Legs:** standing legs nearly straight; knees bend only forward, from the front outward on each side. Walking stride 0.34 of the leg with the arms swinging opposite (pose.walk; move x with time so the feet do not slide: about 0.55 h per second at speed 2). Sitting: hips just below the seat line, thigh level, shin straight down (pose.sit; K.crate makes a seat).
- **Feet:** the shoe is the lowest part, on the ground line, and turns with the shin; never draw your own feet or shoes.
- **Piggyback:** \`const b = { face: 1, ...K.pose.carry(c) }; K.drawPiggyback(g, carrier, rider, b, { face: 1, ...K.pose.ride(rider, K.rig(carrier, b), carrier) })\` inside a K.at in the set.
- Props in hands: pass \`opts.front: (c, R) => K.pole(c, R, tilt) | K.pan(c, R, cook, t) | K.wheelbarrow(c, R, spin) | K.tool(c, R, "pick" | "axe" | "hammer")\`; R.armF[2] is the front hand in puppet space for your own small prop.

## The camera grammar: every shot moves, and every move lands on a word
KEYS are \`[[frame, { x, y, z, px?, py?, roll?, par?, dof?, focus? }, ease?], ...]\` in scene frames and plate coordinates; a field left out keeps the previous key's value. Every shot also creeps in on its own (about 0.12% a frame), so no frame is ever dead still. The camera never leaves the set (it clamps); z below 1 is raised to cover the frame.
| Move | When | Keys |
|---|---|---|
| **Whip in** (about half the shots: the cut lands moving) | the start of a shot | first key offset x ±250-350 (and roll ±4, z ±0.3) from the rest key, then \`"snap"\` to the rest key over 6-9 frames. Motion blur is automatic. |
| **Snap reveal (pull out)** | the line names the crowd, the army, the scale, the aftermath | start close on the detail (z 2.2-3), hold, then \`"snap"\` out to z 1.0-1.2 over 10-16 frames on the word |
| **Push in** | the detail, the reaction, the mechanism, a quoted line | z +0.6-1.2 toward the face or the thing: \`"snap"\` over 8-14 frames on the word, or \`"lin"\` slowly over the whole line |
| **Parallax slide** | a wide shot that needs depth | px or py 20-60 over the line: near things slide more than far ones |
| **Look down** | "don't look down", a drop, a fall, the river below | \`par: 0\` (a flat zoom), z 2.5-3, y toward the far bottom of the set, "smooth" over 8-12 frames, then \`"snap"\` back with par 1 |
| **Roll** | tension, danger, a crazy moment | roll ±3-7° held through the move |
**Depth of field** (lens blur by depth; use it sparingly: a sharp frame is the default and the set is the star of the picture): \`dof\` is 0 on almost every shot. Give 2 or 3 deliberate CLOSE shots in the whole film \`dof: 8-12\` (blur in px at 1080 wide) in the key where the camera settles, on a face or a single detail, so the background goes soft behind the subject, which stays sharp (focus defaults to the subject's depth; \`focus: 0..1\` pulls it elsewhere). Never on wides, mediums, crowds or the opening and closing shots. A \`dof\` lerps between keys, so a rack focus is two keys. It needs the set's depth map and is skipped without it.

About 15 moves a minute: every shot has at least one timed move besides the creep. Never two snap reveals in a row; vary whip, push and reveal.

## The shot mix (what makes the reel look like the reference, not a string of close-ups)
- In every film, at least half of the shots are WIDE or MEDIUM-WIDE: camera z 1.0-1.5, the set clearly visible (sky, gorge, buildings, the whole room), the hero 150-350 tall, with a crowd (\`K.crowd\`, 2-3 rows), props or a second character in the frame. At most a third of the shots are close-ups (z over 2), and never two close-ups in a row.
- A close-up still shows the set behind the puppet (do not push in so far that only the face and a blur remain): z 2.0-2.8, never above 3 except a "look down" move.
- Every scene has life in the air and the background besides the hero: mist, motes, a crowd reacting, a prop in use, a second figure. A shot with one puppet and nothing else is a failure.
- Alternate: wide (the place), medium (the action), close (the reaction), and open on a wide that shows where we are.

## Timing: actions land on their words
The request gives WORD START FRAMES (word@frame). An action starts 2-4 frames BEFORE its verb and lands ON it: \`K.span(frame, w - 3, w + 3, "snap")\` for a hit, \`K.span(frame, w, w + 12, "out")\` for a move. A pose change is a K.span-driven lerp of the pose numbers or a switch at the word frame. Puppets move ON TWOS (\`tp\`, stepped like stop-motion); the camera, mist, motes and flames stay smooth (\`t\`). After the action, keep small life: a walk, a fidget, a blink, a breathing \`bob\`, mist and motes.
Accents on a word: \`K.popLines(g, sx, sy, r, K.span(frame, w, w + 10))\`, \`K.burst(g, sx, sy, K.span(frame, w, w + 15), size, "dust" | "sparks" | "water")\`, \`K.steam\`, \`K.flame\`.

## Sounds
Export \`sounds\` with the frame each visible action lands, from these kinds only: step (a foot lands; every 2-3 steps of the hero), whoosh (a whip or snap move starts), thud (a body or heavy thing lands or falls), hit (the big reveal, an impact, a launch), drop (small things fall: coins, tools), shuffle (a crowd reacts or steps back). Never mark, tuft or bleat in this template. Usually 2 to 5 per scene.

## Never
- Never draw text of any kind: no letters, numbers, labels, signs, banners, dates or speech bubbles. Captions are added by the editor.
- Never draw your own people, faces, hands, feet or the set: only K.makeCast/K.puppet/K.drawPuppet and K.set.
- Never hide a hand, never bring the far arm in front of the body in a side or three view, never bend a knee backwards.
- Never fill the frame with a colour or a gradient over the set, never add a vignette, never draw a sky or ground of your own.
- No Math.random, Date or clock: \`K.rng(seed)\` only. No images other than through K.set.
- No gore: a fall, a hit or a defeat is shown by a pose, a burst of dust and a reaction face.

## Example (the Niagara opening shot)
\`\`\`ts
${EXAMPLE_SCENE}
\`\`\``;

// ---------------------------------------------------------------- the pack
export const historyReel: TemplatePack = {
  id: "history-reel",
  scriptVoice,
  voice: { id: "Puck", tighten: true, direction: "A young American guy telling a crazy true story to a friend. Fast and energetic, about 220 words a minute, no pauses. Quoted lines a little lower and deadpan." },
  music: "Bouncy period-flavoured comedy underscore for a fast true-history storytime narrated over it: plucked banjo, pizzicato strings, upright saloon piano and light hand percussion, about 120 BPM, major key with a mischievous minor turn. Loud and busy, building section by section. Two sudden full stops to near silence for reveals, each followed by a hard comeback, and one big final orchestral hit at the end. No vocals.",
  sceneDirection,
  sketchDirection: [
    "Style guide: the template \"Cartoon history\". Draw the still exactly in the look of the pictures above:",
    "- WORLD: a painted, lit, rendered-3D-looking set (saturated, soft global light, shallow depth of field) seen at eye level, with flat open ground in the bottom third.",
    "- CAST: flat cut-out cartoon puppets with thick dark-brown ink outlines and flat colours with one shade tone: bean-shaped heads with big oval eyes, a round nose and swappable mouths, a bean torso in one shirt colour, rounded tube arms and legs with mitten hands and shoes. Era hats and moustaches. Never white round heads with stick legs.",
    "- SIZE: the hero fills 35-55% of the frame height in a medium shot; crowds in rows, smaller further back; feet on the ground with a soft shadow.",
    "- NO WORDS in the picture at all: captions are added later."
  ].join("\n"),
  scenes: once(() => {
    const kit = file("kit.txt").toString("utf8");
    const images = [
      { label: "THE RIG AND POSE LIBRARY (drawn only with K: three different builds in K.pose stand side/three/front, walk, run, holdPole, push, holdOut, handsOnHips, armsOut, pointUp, point, armsUp, sit on K.crate, fidget, swing with K.tool). Every puppet must look and stand like these:", data: file("pose-sheet.png") },
      { label: "THE KIT ON A SET (one scene drawn with K.set, K.camera, K.puppet and K.crowd, frames 0, 44, 48 and 89: the wide with a creeping push, the snap push in to the walker on the rope with motion blur, the landing). Set, sizes, shadows and depth must look like this:", data: file("kit-shot.png") },
      { label: "A FINISHED FILM OF THIS TEMPLATE (Niagara, one frame per shot; its captions were burned in by the test bench: in the product the editor adds them, so your scene never draws words):", data: file("example-film.png") }
    ];
    const hash = createHash("sha256").update(kit).update(sceneDirection); for (const image of images) hash.update(image.data);
    return { kit, images, hash: hash.digest("hex").slice(0, 12) };
  }),
  // one empty set per place, each with a depth map (made on the render worker; a set without one draws flat)
  assets: (input) => placesFrom(input).map((place): AssetSpec => ({ name: `set-${place.id}`, prompt: setPrompt(place), aspect: "9:16", size: "2K", depth: true, noText: true })),
  // the beat's place: its set and depth map (the engine adds depth-<place> too; listing it is harmless)
  sceneAssets: (beatIndex, beats) => { const id = placeOfBeat(beatIndex, beats); return [`set-${id}`, `depth-${id}`]; },
  sceneSounds: true,
  captions: { wordsPerCue: 2, style: "shadow", size: 84, y: 70 },
  // tight: the line plus one frame or so, no long gaps anywhere (no title beat in this template); the last scene holds the payoff
  pacing: { gap: 0.04, long: 0.04, beforeLast: 0.08, tail: 1.0, min: 0.5, titleMin: 0.5 },
  // sentences swing from 2 to 27 words; the payoff is one plain line; nothing is forbidden by word (forbidden never matches)
  scriptRules: { maxWords: 28, lastMaxWords: 16, shortShare: 0.1, forbidden: /(?!)/ }
};
