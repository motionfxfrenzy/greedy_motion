/*
 * The people library, as the engine uses it. people/people.json (made from Gemini character sheets, see people/make-sheets.mjs and read-sheets.mjs) holds
 * five people for each of six groups: boy, girl, young_man, young_woman, old_man, old_woman. Each person is every trait the painter can draw.
 *
 *   - the director may name who is in a shot ("who": "old_man_3", or just a group, "old_man") and reuses that id for the same character in every shot;
 *   - when it does not, castSubjects() infers the group from the words (age, gender, "children", "the whole village"), keeps one character the same across
 *     the film, and gives the people in one crowd different faces.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { MOODS, EXTRAS, POSES } from "./vocab.mjs";

const LIB = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./people/people.json", import.meta.url)), "utf8"));
export const GROUPS = Object.fromEntries(Object.entries(LIB.groups).map(([g, v]) => [g, { age: v.age, gender: v.gender, heightM: v.heightM }]));
export const ARCHETYPES = Object.fromEntries(Object.entries(LIB.groups).flatMap(([g, v]) => v.people.map((p) => [p.id, { ...p, group: g, age: v.age, gender: v.gender }])));
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const CROWD = ["young_woman", "old_man", "boy", "young_man", "girl", "old_woman"];

/** One line per person for the director's brief. */
export function peopleBrief() {
  return Object.entries(LIB.groups).map(([g, v]) => `- ${g} (${v.age}, ${v.gender === "m" ? "male" : "female"}): ` + v.people.map((p) => `${p.id} = ${p.desc.replace(/\.$/, "")}`).join("; ")).join("\n");
}

const OLD = /\b(old|elderly|aged|grand(father|mother|pa|ma|dad|ad)|elder|keeper|veteran)\b/i, CHILD = /\b(child|children|kid|kids|boys?|girls?|little (one|boy|girl)|son|daughter|toddler)\b/i;
const FEMALE = /\b(she|her|hers|woman|women|lady|mother|mum|mom|grandmother|grandma|girl|girls|queen|wife|daughter|sister|aunt)\b/i, MALE = /\b(he|his|him|man|men|father|dad|grandfather|grandpa|boy|boys|king|husband|son|brother|uncle|keeper|fisherman|fishermen)\b/i;
const OLD_STRICT = /\b(old|elderly|aged|grand(father|mother|pa|ma|dad|ad)|elder|veteran)\b/i;

/** The group a subject belongs to, from the words of its line. Returns { group, specific } where specific means the words named this person, not a crowd. */
export function inferGroup(say, index, count, subject = {}) {
  const t = String(say ?? ""), female = FEMALE.test(t) && !(MALE.test(t) && !/\b(she|her|woman|mother|grandmother|girl)\b/i.test(t)), male = MALE.test(t) && !female;
  const old = OLD_STRICT.test(t) || (/\bkeeper\b/i.test(t) && !CHILD.test(t)), child = CHILD.test(t) || ["tiny", "small"].includes(subject.size) || subject.age === "child";
  const cued = old || child || female || male;
  if (count > 1 && index > 0 && !(subject.size === "tiny" || subject.size === "small")) return { group: CROWD[(hash(t) + index) % CROWD.length], specific: false };
  if (child) return { group: female ? "girl" : "boy", specific: cued };
  const sex = female ? "woman" : male ? "man" : hash(t) % 2 ? "woman" : "man";
  return { group: `${old ? "old" : "young"}_${sex}`, specific: cued, gender: female ? "f" : male ? "m" : null, old };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Gives the subject a person from the library. Colours the director wrote as real #rrggbb win over the library; words ("wool coat") never do. */
export function applyArchetype(s, id) {
  const a = ARCHETYPES[id]; if (!a) return false;
  const keep = {}; for (const k of ["top", "bottom", "skin", "hairColor"]) if (HEX.test(s[k] ?? "")) keep[k] = s[k];
  for (const k of ["hair", "hairColor", "skin", "top", "bottom", "dress", "build"]) s[k] = a[k];
  Object.assign(s, keep);
  s.extras = (a.extras ?? []).filter((x) => EXTRAS.includes(x));
  s.who = id; s.age = a.age; if (!Number.isFinite(s.heightM)) s.heightM = a.heightM;
  return true;
}

/**
 * Casts every subject of the film. `note(where, msg)` reports what was decided. Deterministic: the same script gives the same people.
 * A recurring character keeps its face: a pronoun-only line ("He lit the lamp") is the last single person of that gender; a crowd gets different people.
 */
export function castSubjects(spec, note) {
  const base = {}, lastSingle = {};
  const pick = (group, taken) => { base[group] ??= hash(group + (spec.seed ?? "")) % 5; const n = taken[group] = (taken[group] ?? -1) + 1; return `${group}_${((base[group] + n) % 5) + 1}`; };
  (spec.lines ?? []).forEach((line, li) => (line.shots ?? []).forEach((shot, si) => {
    const taken = {}, people = (shot.subjects ??= []).slice(0, 6); shot.subjects = people;
    people.forEach((s, i) => {
      const hadWho = Boolean(s.who && ARCHETYPES[s.who]);
      let id = s.who, group = null, why = "";
      if (id && !ARCHETYPES[id]) { if (GROUPS[id]) group = id; id = null; }
      if (!id && !group) {
        const g = inferGroup(line.say, i, people.length, s); group = g.group;
        const carry = people.length === 1 && g.gender && !g.old && lastSingle[g.gender] && group.startsWith("young_") ? lastSingle[g.gender] : null;
        if (carry) { id = carry; why = " (the same person as before)"; }
      }
      if (!id) id = pick(group, taken);
      if (applyArchetype(s, id)) {
        if (people.length === 1) { const a = ARCHETYPES[id]; if (a.gender) lastSingle[a.gender] = id; }
        if (!hadWho) note?.(`line ${li} shot ${si}`, `person ${i} is ${id}${why}`);
      }
    });
  }));
}

// Personality (a named feeling such as smiled, laughed or cried beats a judging word that may sit inside a quote): what the words say people feel shows on their faces and in how they stand. A crowd that gossips folds its arms and points; one that is thankful smiles and cheers.
const FEELINGS = [
  ["smile", /\b(thank\w*|smil\w*|celebrat\w*|joy\w*|happy|welcom\w*|grateful|proud|gather\w*|stood on the shore)\b/i, ["cheer", "wave", "stand", "cheer"]],
  ["laugh", /\b(laugh\w*|joke\w*|giggl\w*|chuckl\w*)\b/i, ["hip", "stand", "shrug"]],
  ["sad", /\b(sad|cried|cry\w*|grief|mourn\w*|farewell|goodbye|weep\w*)\b/i, ["stand", "hold"]],
  ["skeptical", /\b(wast\w*|fool\w*|mock\w*|scoff\w*|doubt\w*|silly|crazy|pointless|useless|laugh(ed|ing)? at|sneer\w*|complain\w*|grumbl\w*|whisper\w*|gossip\w*)\b/i, ["cross", "point", "hip", "shrug"]],
  ["worried", /\b(afraid|fear\w*|worr\w*|anxious|nervous|danger\w*|panic\w*)\b/i, ["hold", "stand", "cross"]],
  ["surprised", /\b(sudden\w*|surpris\w*|gasp\w*|shock\w*|amaz\w*)\b/i, ["open", "shrug", "stand"]]
];
const QUIET_POSES = ["stand", undefined];
/** Gives every person a mood (and a gesture when they would only stand) from the line's words. A mood the director wrote is kept. */
export function giveCharacter(spec, note) {
  (spec.lines ?? []).forEach((line, li) => (line.shots ?? []).forEach((shot, si) => {
    const feeling = FEELINGS.find(([, re]) => re.test(line.say ?? ""));
    (shot.subjects ?? []).forEach((s, i) => {
      if (s.mood && !MOODS.includes(s.mood)) { note?.(`line ${li} shot ${si}`, `unknown mood "${s.mood}" -> neutral`); s.mood = "neutral"; }
      if (!s.mood && feeling && ["boy", "girl", "young_man", "young_woman", "old_man", "old_woman"].some((g) => s.who?.startsWith(g))) {
        s.mood = feeling[0];
        if ((shot.subjects.length > 1 || !["smile", "laugh"].includes(s.mood)) && QUIET_POSES.includes(s.pose) && POSES.includes(feeling[2][(i + hash(line.say ?? "")) % feeling[2].length])) s.pose = feeling[2][(i + hash(line.say ?? "")) % feeling[2].length];
        note?.(`line ${li} shot ${si}`, `person ${i} looks ${s.mood}${s.pose && s.pose !== "stand" ? ", " + s.pose : ""}`);
      }
    });
  }));
}
