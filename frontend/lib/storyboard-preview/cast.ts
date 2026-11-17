// Who and how: the pure half of the storyboard cards (a template whose storyboardPreviews is "cast", e.g. Cartoon history). Everything here is
// deterministic from the script and its notes, so the same person looks the same on every card and an edited beat re-poses at once. No kit, no canvas.

export type CardBeat = { keyword?: string | null; line?: string | null; visual?: string | null; onScreen?: string | null };

/** Templates whose storyboard shows the set with the kit's puppets drawn on it (the pack flag storyboardPreviews = "cast", backend/src/plan/template-packs.ts). */
export const CAST_PREVIEW_TEMPLATES: ReadonlySet<string> = new Set(["history-reel"]);

// ------------------------------------------------------------------ places (the same rule as the backend's placeOfBeat, packs/history-reel/index.ts)
const placeId = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
const TAG = /^\s*\[([A-Za-z0-9 _-]{1,32})\]/;
/** The place tag a beat's VISUAL starts with (`[gorge] wide: ...`), or null. */
export const beatPlaceTag = (beat: Pick<CardBeat, "visual"> | undefined): string | null => {
  const m = TAG.exec(beat?.visual ?? "");
  return m ? placeId(m[1]!) || null : null;
};
/** The set a beat stands in: its own tag, else the last tagged beat before it, else the next one after it, else the first set that exists. */
export function setOfBeat(index: number, beats: readonly CardBeat[], knownSets: readonly string[]): string | null {
  for (let i = index; i >= 0; i--) { const id = beatPlaceTag(beats[i]); if (id) return `set-${id}`; }
  for (let i = index + 1; i < beats.length; i++) { const id = beatPlaceTag(beats[i]); if (id) return `set-${id}`; }
  return knownSets[0] ?? null;
}

// ------------------------------------------------------------------ names
const NOT_NAMES = new Set(["the", "a", "an", "he", "she", "it", "they", "we", "i", "his", "her", "their", "but", "and", "then", "when", "while", "after", "before", "this", "that", "there", "what", "who", "why", "how", "in", "on", "at", "by", "for", "with", "from", "to", "of", "as", "so", "yet", "once", "now", "next", "one", "two", "three", "wide", "medium", "close", "hold", "push", "pull", "tilt", "reveal", "zoom", "cut", "snap", "slow", "fast", "narrator"]);
/** Last words that make a capitalised phrase an event or a place, not a person ("Great Fire", "Niagara Falls", "London Bridge"). */
const NON_PERSON_TAIL = new Set(["fire", "war", "battle", "plague", "flood", "storm", "revolution", "empire", "kingdom", "republic", "river", "bridge", "falls", "gorge", "street", "road", "city", "town", "village", "castle", "tower", "mountain", "lake", "sea", "ocean", "island", "square", "market", "church", "cathedral", "palace", "hall", "house", "park", "station", "company", "party", "act", "day", "night", "age", "ages", "years", "year", "times", "wall", "gate", "canal", "valley", "desert", "forest"]);
const words = (text: string) => text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];

/**
 * The people of the film, main first: capitalised names that appear in the middle of a sentence (two words together, "Percy Spencer", or one word that
 * recurs), found in the script lines, the visuals and the idea. Names at the start of a sentence count only when they recur or sit beside another
 * capitalised word, so "Then", "Wide" and "When" are never people.
 */
export function namesFrom(beats: readonly CardBeat[], notes?: { idea?: string | null } | null): string[] {
  const texts = [notes?.idea ?? "", ...beats.flatMap((b) => [b.line ?? "", (b.visual ?? "").replace(TAG, "")])];
  const counts = new Map<string, number>();
  const bump = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const text of texts) {
    // two or more capitalised words in a row: a full name
    for (const m of text.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+)\b/g)) {
      const parts = m[1]!.split(/\s+/).filter((w) => !NOT_NAMES.has(w.toLowerCase()));
      if (parts.length >= 2) bump(parts.join(" "));
    }
    // a single capitalised word in the middle of a sentence
    for (const m of text.matchAll(/(?<=[a-z,;:'"]\s)([A-Z][a-z]{3,})\b(?!\s+[A-Z][a-z])/g)) if (!NOT_NAMES.has(m[1]!.toLowerCase())) bump(m[1]!);
  }
  // a first or last name alone ("Farriner") counts for the full name it belongs to
  const full = [...counts.keys()].filter((n) => n.includes(" "));
  for (const [name, n] of [...counts]) {
    if (name.includes(" ")) continue;
    const owner = full.find((f) => f.split(" ").some((part) => part.toLowerCase() === name.toLowerCase()));
    if (owner) { counts.set(owner, (counts.get(owner) ?? 0) + n); counts.delete(name); }
  }
  // a person of the film is named in the film itself: a capitalised phrase only the idea uses ("Great Fire") is a thing, not a person
  const inBeats = (name: string) => beats.some((b) => mentions(`${b.line ?? ""} ${(b.visual ?? "").replace(TAG, "")}`, name));
  return [...counts].filter(([name, n]) => (name.includes(" ") || n >= 2) && !NON_PERSON_TAIL.has(name.split(" ").pop()!.toLowerCase()) && inBeats(name)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name]) => name).slice(0, 4);
}

/** Does this text mention the person (any word of their name, case-insensitive, at least 4 letters)? */
function mentions(text: string, name: string): boolean {
  const lower = ` ${words(text).join(" ").toLowerCase()} `;
  return name.split(" ").some((part) => part.length >= 4 && lower.includes(` ${part.toLowerCase()} `));
}

export type Figure = { /** The person's name, or null for the generic figure. */ name: string | null; /** Seed for the kit's seeded cast: the same person gets the same look on every card. */ seed: number };

/** FNV-1a over the name: a stable seed (never zero). */
export const seedOf = (text: string): number => {
  let h = 0x811c9dc5;
  for (const ch of text.toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h || 1;
};

/** The one generic figure of a film with no names. */
export const GENERIC_FIGURE: Figure = { name: null, seed: seedOf("a person from history") };

/**
 * The main figure of a beat: the person it names (its line or visual), else the person of the nearest earlier beat that names one (the story goes on
 * about the same person), else the film's most mentioned person, else the generic figure.
 */
export function figureForBeat(index: number, beats: readonly CardBeat[], names: readonly string[]): Figure {
  const named = (i: number) => names.find((n) => mentions(`${beats[i]?.line ?? ""} ${(beats[i]?.visual ?? "").replace(TAG, "")}`, n));
  for (let i = index; i >= 0; i--) { const n = named(i); if (n) return { name: n, seed: seedOf(n) }; }
  const main = names[0];
  return main ? { name: main, seed: seedOf(main) } : GENERIC_FIGURE;
}

// ------------------------------------------------------------------ poses
export type PoseName = "walk" | "holdOut" | "pointUp" | "sit" | "push" | "stand";

/** The beat's VISUAL to one named pose of the kit (K.pose): the first rule that matches wins; anything else stands. */
export const POSE_RULES: readonly (readonly [RegExp, PoseName])[] = [
  [/\b(sits?|sitting|seated|perch(?:es|ed)?)\b/i, "sit"],
  [/\b(walks?|walking|runs?|running|rush(?:es|ed)?|march(?:es|ed)?|strolls?|hurr(?:y|ies|ied)|flees?|fleeing|dash(?:es|ed)?|steps?|stumbl\w*)\b/i, "walk"],
  [/\b(push(?:es|ed|ing)?|shov(?:e|es|ed|ing)|drag(?:s|ged|ging)?|wheel(?:s|ed|ing)?)\b/i, "push"],
  [/\b(points?|pointing|gestures?|directs?|aims?)\b/i, "pointUp"],
  [/\b(holds?|holding|carr(?:y|ies|ied)|pulls?|pulling|places?|placing|sets?\s+down|hands?|offers?|lifts?|raises?|drops?|lights?|lit|bakes?|puts?)\b/i, "holdOut"],
  [/\b(yawns?|shrugs?|stands?|standing|waits?|watch(?:es|ed)?|looks?|stares?|sleeps?|smiles?|laughs?)\b/i, "stand"]
];
export const poseFor = (visual: string | null | undefined): PoseName => {
  const action = (visual ?? "").replace(TAG, "");
  for (const [rule, pose] of POSE_RULES) if (rule.test(action)) return pose;
  return "stand";
};

/** A beat that shows a crowd gets two or three figures (the main one in front, the rest smaller and behind). */
export const isCrowdBeat = (visual: string | null | undefined): boolean =>
  /\b(crowd|people|townspeople|villagers|neighbou?rs|everyone|soldiers|workers|citizens|men|women|children|kids|guards|mob|onlookers|spectators|audience|passers-?by|family|team)\b/i.test((visual ?? "").replace(TAG, ""));

export type Mood = "calm" | "grin" | "scared" | "angry" | "wow";
/** The face of the main figure from the visual: a few keywords, calm otherwise. */
export const moodFor = (visual: string | null | undefined): Mood => {
  const action = (visual ?? "").replace(TAG, "");
  if (/\b(laugh\w*|smil\w*|cheer\w*|celebrat\w*|grin\w*|dance\w*|delight\w*|proud)\b/i.test(action)) return "grin";
  if (/\b(fire|flames?|burn(?:s|ing|ed)?|blaz\w*|panic\w*|flee\w*|scream\w*|terrif\w*|scared|danger|collaps\w*|explod\w*|crash\w*)\b/i.test(action)) return "scared";
  if (/\b(angry|furious|shout\w*|yell\w*|argu\w*|storm\w*)\b/i.test(action)) return "angry";
  if (/\b(wow|amaz\w*|gasp\w*|shock\w*|surpris\w*|astonish\w*|stunn\w*|stares?)\b/i.test(action)) return "wow";
  return "calm";
};

/** Everything a card needs about its beat, from the script alone. */
export type CardPlan = { set: string | null; figure: Figure; pose: PoseName; mood: Mood; crowd: boolean; extras: number };

export function planCard(index: number, beats: readonly CardBeat[], names: readonly string[], knownSets: readonly string[]): CardPlan {
  const visual = beats[index]?.visual ?? null;
  const crowd = isCrowdBeat(visual);
  return { set: setOfBeat(index, beats, knownSets), figure: figureForBeat(index, beats, names), pose: poseFor(visual), mood: moodFor(visual), crowd, extras: crowd ? 2 : 0 };
}

/** What a card is drawn from: when none of this changes, the card is the same (so an unchanged beat is never redrawn). */
export const cardSignature = (plan: CardPlan, aspect: string, setHash: string): string =>
  JSON.stringify([plan.set, setHash, plan.figure.seed, plan.pose, plan.mood, plan.extras, aspect]);
