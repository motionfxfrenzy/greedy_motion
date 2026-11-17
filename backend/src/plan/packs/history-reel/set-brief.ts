// The set brief: everything the image model needs to paint a place of a history film as THE REAL PLACE, so our characters can be drawn on it.
// A set prompt is never a bare description (and never a beat's action line): it carries the real location, the era, the landmarks, the camera (position,
// height, angle, lens, where the ground plane sits), where the cast will stand (open ground above the bottom quarter, which holds the subtitles) and the light.
// The details come from the script's own place note when it has them, from one cheap planning call after the script (shot plan), and from the script's topic
// (its year and place names) when both are missing: Niagara Gorge in 1859 never becomes "a castle town square". The finished picture is then checked against the
// same location and era in the set check (plates/pack-assets.ts), and redrawn with the reason when it shows another place.
import type { ScriptBeat } from "@videosaas/contracts";

export type SetBrief = {
  /** The real location: "Niagara Gorge below the Horseshoe Falls, on the border of Ontario and New York". */
  location: string;
  /** The year or era: "1859". */
  era: string;
  /** What makes it unmistakable: the falls, the limestone cliffs, the green river, the rising mist. */
  landmarks: string[];
  /** The part of the location this set shows: "the grassy cliff-top where the rope is anchored". */
  summary: string;
  /** Where the camera stands and looks. */
  view: string;
  /** Time of day, light direction and mood. */
  light: string;
};

/** What the set check asks of a finished picture: does it show this place in this era? */
export type PlaceExpect = { location: string; era: string; landmarks: string[] };

export type PlaceLike = { id: string; description: string };

// ------------------------------------------------------------------ fixed camera and ground rules (the same for every set)
/** Position, height, angle and lens of the camera every set is painted from (the cast is drawn on it in code, so the camera never changes). */
export const SET_CAMERA = "CAMERA: an eye-level camera about 1.6 metres above the ground, held level (no tilt, no dutch angle), looking straight ahead; the horizon sits about 40% down from the top of the frame; a 35 mm lens look with natural perspective (no fisheye, no extreme wide angle), deep focus with the far distance slightly soft.";
/** Where the ground plane is and where the characters will stand: open ground above the bottom quarter, which holds the subtitles. */
export const SET_GROUND = "GROUND AND STANDING AREA: a flat, open, walkable ground plane fills the lower 60% of the frame. The cast will be drawn standing on it with their feet at about 70% of the frame height, so keep the band between 55% and 75% of the frame height completely open, flat and empty (nothing tall, no clutter, no steps, no fences or furniture in it). The bottom quarter of the frame (below 75%) is the same plain ground continuing towards the camera, calm and uncluttered: subtitles sit over it.";

// ------------------------------------------------------------------ the topic: year and place names
const MONTH_OR_DAY = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
/** Last words that make a capitalised phrase a place ("Niagara Gorge", "Pudding Lane"), not a person. */
const PLACE_TAIL = new Set(["gorge", "falls", "river", "bridge", "street", "lane", "road", "city", "town", "village", "square", "fort", "castle", "palace", "bay", "mountain", "mountains", "valley", "lake", "sea", "ocean", "harbour", "harbor", "desert", "canal", "tower", "station", "house", "hall", "market", "cathedral", "church", "island", "islands", "camp", "forest", "coast", "canyon", "pass", "strait", "park", "abbey", "theatre", "theater", "plaza", "gate", "wall", "arena", "colosseum", "field", "fields", "farm", "mine", "port", "harbour"]);

export function eraFrom(text: string): string | null {
  const bc = /\b(\d{1,4})\s*(BC|BCE)\b/i.exec(text);
  if (bc) return `${bc[1]} ${bc[2]!.toUpperCase()}`;
  const decade = /\b(?:the\s+)?(1[0-9]{2}0)s\b/i.exec(text);
  if (decade) return `the ${decade[1]}s`;
  const year = /\b(1[0-9]{3}|20[0-2][0-9]|[2-9][0-9]{2})\b/.exec(text);
  return year ? year[1]! : null;
}

/** The real place the topic names: a capitalised phrase that contains the place's own word ("gorge"), else any phrase ending in a place word; null when there is none. */
export function locationFrom(text: string, placeId: string): string | null {
  const idWords = placeId.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
  const phrases = [...text.matchAll(/\b([A-Z][a-z]{2,}(?:\s+(?:of|the|de|du|von|upon)\s+[A-Z][a-z]{2,}|\s+[A-Z][a-z]{2,})*)\b/g)].map((m) => m[1]!).filter((p) => !MONTH_OR_DAY.has(p.toLowerCase()));
  const placey = phrases.filter((p) => p.split(/\s+/).some((w) => PLACE_TAIL.has(w.toLowerCase())));
  const withId = placey.find((p) => idWords.some((w) => p.toLowerCase().includes(w)));
  return withId ?? placey[0] ?? null;
}

/** A line that is a beat's ACTION (a shot size, a character doing something), not a description of a place. */
export const looksLikeAction = (description: string): boolean =>
  !description.trim() || /\b(full cartoon character|cartoon character)\b/i.test(description) || /^\s*(wide|medium|close)\b/i.test(description) || /^[a-z][a-z-]*\s*,\s*[a-z]/i.test(description.trim()) && /\b(steps?|walks?|runs?|climbs?|holds?|taps?|shrugs?|gestures?|turns?|sits?|carries|carrying)\b/i.test(description);

/** Time of day, light direction and mood from what the film says about the place (night fire, dawn, midday ...). */
export function lightFrom(text: string): string {
  const t = text.toLowerCase();
  if (/\b(midnight|night|nighttime|moonlit?|moon|candle|lantern|torch)\b/.test(t)) return "night: warm lamp and firelight pooling on the ground, cool moonlight and deep blue sky above, long soft shadows away from the main light";
  if (/\b(dusk|sunset|evening|twilight|golden hour)\b/.test(t)) return "golden hour: low warm sun from the upper left, long soft shadows to the right, a warm orange and pink sky";
  if (/\b(dawn|sunrise|early morning)\b/.test(t)) return "early morning: low soft sun from the upper left, cool blue shadows, a pale gold sky";
  if (/\b(storm|rain|thunder|overcast|grey sky)\b/.test(t)) return "overcast: soft diffuse light from above, no hard shadows, moody dramatic sky";
  return "bright natural daylight: the sun high and to the upper left, one clear light direction with soft shadows falling to the right, a bright sky with soft clouds";
}

// ------------------------------------------------------------------ the brief: from the plan, else from the script
const clean = (s: unknown, max = 300) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * One place's full brief. `planned` is what the planning call (or the script's own PLACES note) said; every missing field is built from the script's topic,
 * its year and its place names. Never a bare description: a place note that is really a beat's action ("steps onto the rope") is dropped.
 */
export function resolveSetBrief(place: PlaceLike, topic: string, planned?: Partial<SetBrief> | null, beatText = ""): SetBrief {
  const own = looksLikeAction(place.description) ? "" : clean(place.description, 600);
  const location = clean(planned?.location, 160) || locationFrom(`${own} ${topic}`, place.id) || locationFrom(topic, "") || place.id.replace(/-/g, " ");
  const era = clean(planned?.era, 60) || eraFrom(`${own} ${topic}`) || "the period of the story";
  const landmarks = (planned?.landmarks ?? []).map((l) => clean(l, 80)).filter(Boolean).slice(0, 6);
  const summary = clean(planned?.summary, 400) || own || `the ${place.id.replace(/-/g, " ")} of ${location}`;
  const light = clean(planned?.light, 240) || lightFrom(`${own} ${beatText}`);
  const view = clean(planned?.view, 240) || `looking at ${location} from the ground, the most recognisable part of it filling the middle distance`;
  return { location, era, landmarks, summary, view, light };
}

export const placeExpectOf = (brief: SetBrief): PlaceExpect => ({ location: brief.location, era: brief.era, landmarks: brief.landmarks });

/**
 * The set prompt, always in this order: style, the real place and era with its landmarks, the part of it shown, the camera, the ground and standing area, the
 * light, the look, and the empty-set rules. `style`, `look` and `empty` are the pack's own existing texts.
 */
export function composeSetPrompt(brief: SetBrief, text: { style: string; look: string; empty: string }): string {
  const landmarks = brief.landmarks.length ? `Its unmistakable landmarks, all recognisable: ${brief.landmarks.join("; ")}.` : "Show its real, recognisable landmarks and scenery, true to how the place actually looks.";
  return [
    text.style,
    `LOCATION AND ERA: ${brief.location}, in ${brief.era}. This must be the REAL place in the REAL era, instantly recognisable as ${brief.location}: never a generic, fantasy or European town, castle or palace unless that is what this place is. Architecture, landscape, clothing-era details and materials belong to ${brief.era}. ${landmarks}`,
    `THE SET SHOWS: ${brief.summary}`,
    `VIEW: ${brief.view}`,
    SET_CAMERA,
    SET_GROUND,
    `LIGHT: ${brief.light}.`,
    text.look,
    text.empty
  ].join("\n");
}

// ------------------------------------------------------------------ the planning call
const TAG = /^\s*\[[^\]]*\]\s*/;
export function setBriefRequest(places: readonly PlaceLike[], beats: readonly Pick<ScriptBeat, "line" | "visual" | "keyword">[], notes: { idea?: string | null } | null | undefined, topic: string | null | undefined) {
  const used = (id: string) => beats.map((b, i) => ({ b, i })).filter(({ b }) => new RegExp(`^\\s*\\[\\s*${id.replace(/-/g, "[ -]")}\\s*\\]`, "i").test(b.visual ?? "")).slice(0, 4).map(({ b, i }) => `scene ${i + 1}: ${(b.line ?? b.keyword ?? "").slice(0, 100)}`).join(" | ");
  const list = places.map((p) => `- id "${p.id}"${looksLikeAction(p.description) ? "" : `: ${p.description.slice(0, 400)}`}${used(p.id) ? ` (used by: ${used(p.id)})` : ""}`).join("\n");
  return {
    system: [
      "You write the SET BRIEFS for a short true-history animated film: for each place, the facts an image model needs to paint it as the REAL place in the REAL era, with no people in it.",
      "Reply with JSON only: {\"places\":[{\"id\":\"gorge\",\"location\":\"Niagara Gorge below the Horseshoe Falls, on the border of Ontario and New York\",\"era\":\"1859\",\"landmarks\":[\"the Horseshoe Falls with rising white mist\",\"steep limestone cliffs\",\"the wide green Niagara River far below\",\"a grassy cliff-top bank with a few rocks\"],\"summary\":\"the grassy cliff-top on the American side where the rope is anchored, the gorge dropping away in front\",\"view\":\"standing on the cliff-top looking across the gorge towards the falls\",\"light\":\"bright midday summer sun high to the upper left, soft shadows, a thin mist rising from the falls\"}]}",
      "Rules:",
      "- location: the real, specific place from the film's topic or the beats (name it, add its country, region or famous feature). Never invent a fantasy or generic place; if the story names a place, use it.",
      "- era: the year or period from the topic (\"1859\", \"79 AD\", \"the 1960s\").",
      "- landmarks: 3-6 short phrases naming what makes the place unmistakable and period-correct (landscape, buildings, water, vegetation). Concrete and visual.",
      "- summary: one sentence on the part of the location this set shows and its open ground (where people can stand). view: where the camera stands and what it looks toward. light: time of day, sun direction and mood that fit the story at that place (a night fire, a bright noon).",
      "- One entry for every place id given, same ids. No people, animals or vehicles in any of it."
    ].join("\n"),
    user: `TOPIC: ${topic ?? ""}\n${notes?.idea ? `IDEA: ${notes.idea}\n` : ""}PLACES:\n${list}\nSCENES (what the film says, for the place facts):\n${beats.map((b, i) => `${i + 1}. ${(b.line ?? b.keyword ?? "")} / ${(b.visual ?? "").replace(TAG, "").slice(0, 140)}`).join("\n")}`,
    maxTokens: 1600
  };
}

export type SetBriefPlan = { sets: Record<string, Partial<SetBrief>> };

export function parseSetBriefs(reply: string): SetBriefPlan {
  let raw: any;
  try { raw = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? "{}"); } catch { return { sets: {} }; }
  const sets: Record<string, Partial<SetBrief>> = {};
  for (const p of Array.isArray(raw?.places) ? raw.places : []) {
    const id = String(p?.id ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id) continue;
    sets[id] = {
      location: clean(p.location, 160), era: clean(p.era, 60), summary: clean(p.summary, 400), view: clean(p.view, 240), light: clean(p.light, 240),
      landmarks: (Array.isArray(p.landmarks) ? p.landmarks : []).map((l: unknown) => clean(l, 80)).filter(Boolean).slice(0, 6)
    };
  }
  return { sets };
}
