/*
 * The rule layer between the director (an LLM, so never fully reliable) and the painter: every spec passes through here.
 * It repairs what is always wrong, and reports what it changed, so a future film cannot repeat a mistake we have already seen.
 *
 *   normalize(spec) -> { spec, notes }     (pure; the input is not changed)
 */
import { PLATES, PLATE_FITS, PLACES as V_PLACES, TIMES, WEATHERS as V_WEATHERS, POSES, PROPS as V_PROPS, ROOMS, HOUSE_STYLES, SEASONS } from "./vocab.mjs";
import { expandSceneGraph } from "./scene-graph.mjs";
import { castSubjects, giveCharacter } from "./people.mjs";
import { applyRelations } from "./relations.mjs";
import { applyDressing } from "./dressing.mjs";
const PLACES = Object.keys(V_PLACES), WEATHERS = Object.keys(V_WEATHERS), PROPS = Object.keys(V_PROPS);
const GROUNDED = ["lamp", "house", "tree", "boat", "lighthouse", "cross", "sprout", "table", "jar"];   // always stand on the ground or water: never given a height
const STORMY = ["rain", "storm", "blizzard", "sandstorm", "snow"];


// The painter needs colours as #rrggbb and hair as a style. A director writes "heavy wool coat" or hair "grey": painted as written, the coat is transparent (a person with no body).
const HAIR_STYLES = ["short", "long", "bun", "beard", "hood"];
const COLOUR_WORDS = [["grey|gray|silver", "#8d8f94"], ["white|cream|ivory", "#efeae0"], ["black|charcoal", "#1f1f24"], ["navy|dark blue", "#243457"], ["blue", "#2f5ea8"], ["green|olive", "#3f6f45"], ["red|crimson|scarlet", "#a8362f"], ["yellow|gold|mustard", "#d9ad3a"], ["orange", "#d9742f"], ["purple|violet", "#6d4a8a"], ["pink", "#d98aa6"], ["brown|tan|beige|khaki|leather", "#6b4a32"], ["blonde|blond", "#d8b66a"], ["auburn|ginger", "#8a4a2a"]];
const GARMENTS = [["coat|jacket|oilskin|cloak|parka|sweater|jumper|wool|vest", "#4f5a66"], ["dress|robe|gown|shirt|tunic|blouse", "#6a5a7a"], ["trousers|pants|jeans|breeches", "#2f3a55"]];
const HEXC = /^#[0-9a-f]{6}$/i;
function colourOf(text, table = COLOUR_WORDS) { const t = String(text).toLowerCase(); for (const [words, hex] of table) if (new RegExp(`\\b(${words})\\b`).test(t)) return hex; return null; }
function repairClothes(s, say) {
  if (s.hair && !HAIR_STYLES.includes(s.hair)) {
    const c = colourOf(s.hair); if (c && !HEXC.test(s.hairColor ?? "")) s.hairColor = c;
    say(`hair "${s.hair}" is not a style${c ? ": used as the hair colour" : ""}`); delete s.hair;
  }
  for (const key of ["top", "bottom", "skin", "hairColor"]) {
    if (s[key] === undefined || HEXC.test(s[key])) continue;
    const c = colourOf(s[key]) ?? (key === "top" || key === "bottom" ? colourOf(s[key], GARMENTS) : null), was = s[key];
    if (c) s[key] = c; else delete s[key];
    say(`${key} "${was}" is not a colour: ${c ? "painted as " + c : "the default is used"}`);
  }
}

// Keywords that send a plate request we cannot serve to the painted place that reads closest.
const PLATE_FALLBACK = [["sea|ocean|boat|ship|harbo|wave|fish|koi|pond|whale", "sea"], ["lake|pond|swan", "lake"], ["river|stream|bridge", "river"], ["mountain|peak|alp", "mountains"], ["forest|wood|tree|bamboo|wren|bird", "forest"], ["city|town|street|skyline|train|viaduct", "city"], ["desert|dune|sand", "desert"], ["field|farm|crop|honey|bee|flower", "field"], ["sky|moon|star|cloud|balloon|kite", "sky"], ["house|room|kitchen|indoor|inside", "interior"]];
/** Nearest painted place for a plate we do not have: by the words of the request (plate name, description, the line), else a meadow. */
export function nearestPlace(...words) {
  const text = words.filter(Boolean).join(" ").toLowerCase();
  for (const [re, place] of PLATE_FALLBACK) if (new RegExp(`\\b(${re})`).test(text)) return place;
  return "meadow";
}
/** A plate shot is repaired, never dropped: an unknown film becomes the nearest painted place; fit, focus, from/to and plateLook get safe defaults. Mutates the shot. */
export function repairPlate(shot, say, note) {
  const meta = PLATES[shot.plate]; shot.time ??= "day";
  if (!meta) {
    const place = nearestPlace(shot.plate, shot.describe, say); note(`unknown plate "${shot.plate}" -> painted "${place}"`);
    shot.describe ??= String(shot.plate ?? "").replace(/[_-]+/g, " ").trim() || undefined; if (shot.describe === undefined) delete shot.describe;
    for (const k of ["plate", "fit", "focus", "from", "to", "loop", "plateLook"]) delete shot[k]; shot.place = place; return;
  }
  if (!PLATE_FITS.includes(shot.fit)) { if (shot.fit !== undefined) note(`unknown fit "${shot.fit}" -> cover`); shot.fit = "cover"; }
  const f = Array.isArray(shot.focus) && shot.focus.length === 2 && shot.focus.every(Number.isFinite) ? shot.focus.map((x) => Math.min(1, Math.max(0, x))) : [0.5, 0.5];
  if (shot.focus !== undefined && JSON.stringify(f) !== JSON.stringify(shot.focus)) note("focus -> kept inside the plate");
  shot.focus = f;
  const last = meta.frames - 1, num = (v, d) => (Number.isFinite(v) ? Math.min(last, Math.max(0, Math.round(v))) : d);
  shot.from = num(shot.from, 0); shot.to = num(shot.to, last);
  if (shot.from > shot.to) { note("from/to out of order -> swapped"); [shot.from, shot.to] = [shot.to, shot.from]; }
  if (shot.plateLook !== undefined && !["plate", "oil", "pastel", "watercolor", "ink", "gouache"].includes(shot.plateLook)) { note(`unknown plateLook "${shot.plateLook}" -> plate`); shot.plateLook = "plate"; }
  shot.plateLook ??= "plate";
}

/** A tree the words show bearing fruit ("heavy yellow lemons pull the branches down") gets that fruit in its crown from that line on, until winter. */
const FRUIT_WORDS = /\b(lemon|orange|apple|cherr(?:y|ies)|plum|pear|peach|fig)s?\b/i;
export function applyFruit(spec, say) {
  let fruit = null; const FIX = { cherries: "cherry" };
  const named = String((spec.lines ?? []).map((l) => l.say).join(" ")).match(FRUIT_WORDS);
  const kind = named ? (FIX[named[1].toLowerCase()] ?? named[1].toLowerCase().replace(/ies$/, "y")) : null;
  for (const [li, line] of (spec.lines ?? []).entries()) {
    const bears = kind && FRUIT_WORDS.test(line.say) && /\b(heavy|ripe|hang|hangs|hanging|pull|pulls|bright|golden|yellow|fruit|twist|twists|pick|picked|harvest|bear|bears|bearing)\b/i.test(line.say);   // only the narrator's words: a scene note that names the tree is not fruit
    if (bears) fruit = kind;
    for (const [si, shot] of (line.shots ?? []).entries()) {
      if (shot.season === "winter") { fruit = null; continue; }
      if (!fruit) continue;
      for (const p of shot.props ?? []) if (p.kind === "tree" && !p.fruit && shot.season !== "spring") { p.fruit = fruit; say(`line ${li} shot ${si}`, `the ${fruit} tree bears fruit`); }
    }
  }
}

/**
 * Where people and big things stand is a fact of the place, not a choice per shot: the director writes an x for every shot, and a grandfather who is at 0.6, then 0.7, then 0.3,
 * then back, seems to jump around the hill. Within a run of shots in one place a person keeps the x of their first shot, and a tree, house or lamp keeps its own, unless the
 * narrator's words move them (walks, crosses, climbs...). A tree is moved (in every shot of the run, so it stays put) if it would stand where someone sits.
 */
const MOVES = /\b(walk|walks|walked|step|steps|stepped|cross|crosses|run|runs|ran|move|moves|moved|come|comes|came|go|goes|went|climb|climbs|leave|leaves|left|approach|approaches|return|returns|returned|head|heads|hurry|hurries|follow|follows|enter|enters|exit|exits|race|races|wander|wanders|stride|strides)\b/i;
const STILL_KINDS = ["tree", "house", "lamp", "rock", "lighthouse", "cross", "table", "sprout"];
export function applyContinuity(spec, say) {
  let place = null, who = new Map(), things = new Map(), run = [];
  const settle = () => {                                                                // end of a run: keep the trees clear of the people who sit
    for (const [key, thing] of things) {
      if (thing.kind === "sprout") {                                                      // a seedling is never planted between someone's feet: it stands clear of every person in the run
        const xs = new Set(); for (const { shot } of run) for (const p of shot.subjects ?? []) if (p.x !== undefined) xs.add(p.x);
        if ([...xs].every((x) => Math.abs(x - thing.x) >= 0.16)) continue;
        const best = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85].filter((c) => [...xs].every((x) => Math.abs(x - c) >= 0.16)).sort((a, b) => Math.abs(a - thing.x) - Math.abs(b - thing.x))[0];
        if (best === undefined) continue;
        for (const { shot } of run) for (const p of shot.props ?? []) if (thingKey(p, shot) === key) p.x = best;
        say(run[0].where, `the seedling is at ${best}: clear of the people`); continue;
      }
      if (thing.kind !== "tree") continue;
      const sitters = new Set(), people = new Set(); for (const { shot } of run) for (const [i, p] of (shot.subjects ?? []).entries()) { people.add(p.x); if (["sit", "kneel"].includes(p.pose) && !p.on) sitters.add(p.x); }
      if (![...sitters].some((x) => Math.abs(x - thing.x) < 0.16)) continue;
      const cands = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85].filter((c) => [...sitters].every((x) => Math.abs(x - c) >= 0.2));
      const best = cands.sort((a, b) => Math.abs(a - thing.x) - Math.abs(b - thing.x))[0];                  // the nearest free place to where the director put it
      if (best === undefined) continue;
      for (const { shot, where } of run) for (const p of shot.props ?? []) if (thingKey(p, shot) === key && p.x !== best) { p.x = best; }
      say(run[0].where, `the tree stands at ${best}: not where someone sits`);
    }
  };
  const thingKey = (p, shot) => p.id ?? `${p.kind}#${(shot.props ?? []).filter((q) => q.kind === p.kind).indexOf(p)}`;
  for (const [li, line] of (spec.lines ?? []).entries()) for (const [si, shot] of (line.shots ?? []).entries()) {
    const where = `line ${li} shot ${si}`;
    if (shot.place !== place) { settle(); place = shot.place; who = new Map(); things = new Map(); run = []; }
    run.push({ shot, where });
    const moving = MOVES.test(line.say ?? ""), walkers = (shot.subjects ?? []).filter((p) => ["walk", "climb"].includes(p.pose)).length;
    for (const p of shot.subjects ?? []) {
      if (!p.who) continue;
      const was = who.get(p.who), travelling = ["walk", "climb"].includes(p.pose);
      // someone walking is free to move; so is the one person who the words move when nobody is posed walking (a "comes to the bench" line with a single mover is not guessable, so people only move when posed walking)
      if (was !== undefined && !travelling && p.x !== was && !(moving && walkers === 0 && (shot.subjects ?? []).length === 1)) { say(where, `${p.who} stays where they stood (x ${p.x ?? "auto"} -> ${was})`); p.x = was; }
      else if (p.x !== undefined) who.set(p.who, p.x);
    }
    for (const p of shot.props ?? []) {
      if (!STILL_KINDS.includes(p.kind) || p.dressing || p.on) continue;
      if (p.kind === "sprout" && p.x === undefined) p.x = 0.5;                       // the default place of a seedling, made explicit so it can be kept clear of people
      const key = thingKey(p, shot), was = things.get(key);
      if (was !== undefined && p.x !== was.x) p.x = was.x;
      else if (p.x !== undefined) things.set(key, { x: p.x, kind: p.kind });
    }
  }
  settle();
}

/**
 * Nobody sits on air. A person posed "sit" sits ON something: a seat in the shot (bench, chair, stool, rock, log, step...), or a seat the words name that the director forgot
 * (it is added beside them), or the ground itself (drawn cross-legged, ground: true). A child is never put on an adult's lap (only a baby is carried): a person cannot sit "on" a person.
 */
const SEAT = /\b(bench|armchair|chair|stool|seat|sofa|couch|rock|boulder|log|stump|step|steps|wall|ledge|crate|bed)\b/i;
export function applySeating(spec, say) {
  for (const [li, line] of (spec.lines ?? []).entries()) for (const [si, shot] of (line.shots ?? []).entries()) {
    const props = shot.props ?? [], people = shot.subjects ?? [], where = `line ${li} shot ${si}`;
    props.forEach((p, i) => { if (SEAT.test(`${p.kind} ${p.describe ?? ""} ${p.id ?? ""}`) && !p.id) p.id = `${p.kind === "custom" ? "seat" : p.kind}${i}`; });
    const seats = props.filter((p) => p.id && !p.dressing && SEAT.test(`${p.kind} ${p.describe ?? ""} ${p.id}`));
    const named = /\b(bench|armchair|chair|stool|sofa|couch|log|stump|crate)\b/i.exec(`${line.say ?? ""} ${line.scene ?? ""}`)?.[1];
    for (const s of people) {                                                              // "on" a chair means sitting in it: a person is never stood on a seat (the gesture, hold or reach, stays as the arms)
      const parent = s.on && props.find((p) => p.id === s.on);
      if (parent && /\b(bench|armchair|chair|stool|seat|sofa|couch|bed)\b/i.test(`${parent.kind} ${parent.describe ?? ""} ${parent.id}`) && s.pose !== "sit" && s.pose !== "kneel") {
        if (s.pose !== "stand") s.gesture = s.pose;
        say(where, `${s.who ?? "a person"} sits in the ${parent.id} (was ${s.pose} on it)`); s.pose = "sit";
      }
    }
    for (const s of people) {
      if (s.pose !== "sit") continue;
      const ids = new Set(props.map((p) => p.id)), onPerson = people.some((o) => o.who && o.who === s.on);
      if (s.on && ids.has(s.on) && !onPerson) { delete s.ground; continue; }              // sits on a seat that is in the shot
      if (onPerson) { delete s.on; say(where, `${s.who ?? "a person"} cannot sit on a person (only a baby is carried): sits apart`); }
      else if (s.on && !ids.has(s.on)) delete s.on;
      const near = seats.filter((p) => !people.some((o) => o !== s && o.on === p.id)).sort((a, b) => Math.abs((a.x ?? 0.5) - (s.x ?? 0.5)) - Math.abs((b.x ?? 0.5) - (s.x ?? 0.5)))[0];
      if (near && Math.abs((near.x ?? 0.5) - (s.x ?? 0.5)) < 0.3) { s.on = near.id; delete s.ground; say(where, `${s.who ?? "a person"} sits on the ${near.id}`); continue; }
      if (named && shot.place !== "plate") {                                                // the words name a seat that is not in the picture: it is added where they sit
        const id = `seat_${s.who ?? "p"}`; props.push({ kind: "custom", id, describe: `a wooden ${/chair|stool|bench|sofa|couch/i.test(named) ? named.toLowerCase() : "stool"}`, x: s.x ?? 0.5 }); shot.props = props;
        s.on = id; delete s.ground; say(where, `${s.who ?? "a person"} sits on a ${named.toLowerCase()} that was missing`); continue;
      }
      s.ground = true; say(where, `${s.who ?? "a person"} sits on the ground (no seat): drawn cross-legged`);
    }
  }
}

/**
 * "She holds it" puts the thing in her hand. When the narrator's words say someone holds, carries or offers an object that is in the shot (a hat, a book, a cup...), the object is drawn
 * in that person's hand (`heldBy`), not on the ground at the edge of the picture where it cannot be seen. The holder is read from the pronoun (she / he), else the person posed to hold.
 */
const HOLD_VERB = /\b(holds?|holding|held|carr(?:y|ies|ying)|clutch\w*|grips?|gripp\w*|offers?|hands\s+(?:it|him|her|them|the)|presses|passes)\b/i;
const FEMALE = /\b(girl|woman|mother|mum|daughter|sister|lady|grandmother|grandma|young_woman)\b|girl|woman|mother|daughter|sister|lady/i, MALE = /boy|man|father|dad|son|brother|grandfather|grandpa/i;
export function applyHolding(spec, say) {
  for (const [li, line] of (spec.lines ?? []).entries()) {
    const text = line.say ?? ""; if (!HOLD_VERB.test(text)) continue;
    const verb = HOLD_VERB.exec(text), before = text.slice(0, verb.index), pron = [...before.matchAll(/\b(she|her|he|his|him)\b/gi)].at(-1)?.[1]?.toLowerCase();
    for (const [si, shot] of (line.shots ?? []).entries()) {
      const people = shot.subjects ?? [];
      const holder = people.find((s) => s.who && pron && (/^(she|her)$/.test(pron) ? FEMALE.test(s.who) || s.dress : MALE.test(s.who) && !FEMALE.test(s.who))) ?? people.find((s) => (s.gesture || s.pose) === "hold") ?? people.find((s) => (s.gesture || s.pose) === "reach");
      if (!holder?.who) continue;
      for (const p of shot.props ?? []) {
        if (p.kind !== "custom" || p.heldBy || p.tether || p.on || p.dressing) continue;
        const words = `${p.describe ?? ""} ${p.id ?? ""}`.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "old", "small", "big", "brown", "green", "with", "and", "wide", "narrow"].includes(w));
        const noun = words.find((w) => new RegExp(`\\b${w}s?\\b`, "i").test(text));
        if (!noun || /\b(chair|bench|stool|fence|tree|well|shelf|house|rock|hole|pit|ditch|mound|puddle|pond|path|road|blossoms?)\b/i.test(`${p.describe} ${p.id}`)) continue;
        p.heldBy = { who: holder.who, hand: "right" };
        if (holder.pose === "stand") holder.gesture = "hold";
        say(`line ${li} shot ${si}`, `${holder.who} holds the ${p.id ?? noun} in their hand`);
      }
    }
  }
}

/** Hills are drawn with a path down the middle only when the story has one: planting a tree on a path in the middle of the picture is wrong. */
export function applyPath(spec, say) {
  // A road or path is drawn only in the lines whose spoken words name one. Hills and meadows are walked on the ground; a road down the middle of every shot is wrong.
  const PATH = /\b(path|paths|trail|track|road|roads|lane|walkway|footpath|pathway)\b/i;
  for (const [li, line] of (spec.lines ?? []).entries()) for (const [si, shot] of (line.shots ?? []).entries()) {
    if (shot.place !== "hills" && shot.place !== "meadow") continue;
    const named = PATH.test(line.say ?? "");
    shot.path = named;                                                                   // the director's own path: true does not count: only the narrator's words do
    if (!shot.path && si === 0) say(`line ${li} shot ${si}`, `${shot.place} without a road: walked on the ground`);
  }
}

/**
 * People turn towards what they are doing, not away from it: someone seen from the side faces the thing the shot is about (the seedling, the jar, the thing in the picture),
 * or the other person. The director often writes "facing right" for both people, which turns one of them away from everything.
 */
const NOT_FOCUS = /\b(cane|stick|staff|bench|rock|fence|post|stake|bucket|can|shovel|spade|hat|scarf|blanket|burlap|cloth)\b/i;
export function applyGaze(spec, say) {
  for (const [li, line] of (spec.lines ?? []).entries()) for (const [si, shot] of (line.shots ?? []).entries()) {
    const people = shot.subjects ?? [], props = shot.props ?? [];
    const focus = props.find((p) => p.kind === "sprout") ?? props.find((p) => p.id && p.id === shot.detailOf) ?? props.find((p) => p.kind === "custom" && !p.dressing && !p.on && !NOT_FOCUS.test(`${p.describe ?? ""} ${p.id ?? ""}`) && p.x !== undefined) ?? props.find((p) => p.kind === "tree" && !p.dressing);
    people.forEach((s, i) => {
      if (!["left", "right"].includes(s.facing) || s.lookAt) return;
      const sx = s.x ?? (people.length > 1 ? 0.3 + (i * 0.4) / (people.length - 1) : 0.5);
      const others = people.filter((o) => o !== s);
      const tx = focus ? (focus.x ?? 0.5) : others.length ? others.reduce((a, o) => a + (o.x ?? 0.5), 0) / others.length : null;
      if (tx === null || Math.abs(tx - sx) < 0.05) return;
      const to = tx > sx ? "right" : "left";
      if (to !== s.facing) { say(`line ${li} shot ${si}`, `${s.who ?? "a person"} faces the ${focus ? (focus.kind === "custom" ? focus.id ?? "object" : focus.kind) : "other person"}, not away from it`); s.facing = to; }
    });
  }
}

/** Someone sitting or kneeling is not put in front of a trunk (a dark coat against bark disappears): they sit beside the tree, on the side with more room. */
export function applyClearance(spec, say) {
  for (const [li, line] of (spec.lines ?? []).entries()) for (const [si, shot] of (line.shots ?? []).entries()) {
    const trunks = (shot.props ?? []).filter((p) => p.kind === "tree" && !p.dressing && !p.on), people = shot.subjects ?? [];
    for (const tree of trunks) {
      const tx = tree.x ?? 0.5;
      people.forEach((s, i) => {
        if (!["sit", "kneel"].includes(s.pose) || s.on) return;
        const sx = s.x ?? (people.length > 1 ? 0.3 + (i * 0.4) / (people.length - 1) : 0.5);
        if (Math.abs(sx - tx) >= 0.14) return;
        const others = people.filter((o) => o !== s).map((o, j) => o.x ?? 0.5);
        const free = (x) => x > 0.1 && x < 0.9 && others.every((ox) => Math.abs(ox - x) > 0.14);
        const pref = sx >= tx ? 1 : -1, options = [tx + pref * 0.22, tx - pref * 0.22, tx + pref * 0.3, tx - pref * 0.3];
        const to = options.find(free);
        if (to !== undefined) { s.x = +to.toFixed(2); say(`line ${li} shot ${si}`, `${s.who ?? "a person"} sits beside the tree trunk, not in front of it`); }
      });
    }
  }
}

export function normalize(input) {
  const spec = structuredClone(input), notes = [];
  expandSceneGraph(spec, notes);
  const note = (where, msg) => notes.push(`${where}: ${msg}`);
  const shots = [];
  (spec.lines ?? []).forEach((line, li) => {
    line.shots = (line.shots?.length ? line.shots : [{ place: "meadow", time: "day" }]).slice(0, 3);
    line.shots.forEach((shot, si) => { shots.push({ shot, where: `line ${li} shot ${si}` });
      if (/\b(by the fire|by the fireplace|inside the (house|cabin|hut|home|room|lighthouse|tower)|climbed the stairs|up the (spiral )?stairs|in the (kitchen|cabin)|at the table|indoors)\b/i.test(line.say ?? "") && !line.shots.some((x) => x.place === "interior") && shot.place !== "plate") {   // only when the director gave the line no indoor shot at all
         note(`line ${li} shot ${si}`, `"${shot.place}" -> interior (the words say indoors)`); shot.place = "interior"; }
      if (/\b(river|stream|creek|brook)\b/i.test(line.say ?? "") && ["lake", "sea", "shore"].includes(shot.place)) { note(`line ${li} shot ${si}`, `"${shot.place}" -> river (the words say river)`); shot.place = "river"; } });
  });

  for (const { shot, where } of shots) {
    if (shot.place === "plate" && spec.style === "doodle") { const line = spec.lines.find((l) => l.shots.includes(shot)), p = nearestPlace(shot.plate, shot.describe, line?.say); note(where, `plate "${shot.plate}" is another film's style: a doodle film draws the place itself ("${p}")`); for (const k of ["plate", "fit", "focus", "from", "to", "loop", "plateLook"]) delete shot[k]; shot.place = p; }
    if (shot.place === "plate") { const line = spec.lines.find((l) => l.shots.includes(shot)); repairPlate(shot, line?.say, (m) => note(where, m)); }
    if (!PLACES.includes(shot.place) && shot.place !== "plate") { note(where, `unknown place "${shot.place}" -> custom: the AI will be asked to draw it`); shot.describe ??= String(shot.place).replace(/[_-]+/g, " "); shot.place = "custom"; }
    if (!TIMES.includes(shot.time)) { note(where, `unknown time "${shot.time}" -> day`); shot.time = "day"; }
    if (shot.weather && !WEATHERS.includes(shot.weather)) { note(where, `unknown weather "${shot.weather}" -> clear`); shot.weather = "clear"; }
    shot.subjects = (shot.subjects ?? []).slice(0, 6);
    for (const s of shot.subjects) {
      if (s.pose && !POSES.includes(s.pose)) { note(where, `unknown pose "${s.pose}" -> stand`); s.pose = "stand"; }
      if ("y" in s) { delete s.y; note(where, "removed a person's y (people stand on what is under them)"); }
    }
    shot.props = shot.props ?? [];
    for (const p of shot.props ?? []) if (!PROPS.includes(p.kind)) { note(where, `unknown prop "${p.kind}" -> custom: the AI will be asked to draw it`); p.describe ??= String(p.kind).replace(/[_-]+/g, " "); p.kind = "custom"; }
    if (shot.room && !(shot.room in ROOMS)) { note(where, `unknown room "${shot.room}" -> cabin`); shot.room = "cabin"; }
    for (const p of shot.props ?? []) if (p.kind === "house" && p.style && !HOUSE_STYLES.includes(p.style)) { note(where, `unknown house style "${p.style}" -> cottage`); delete p.style; }
    for (const p of shot.props) if (GROUNDED.includes(p.kind) && "y" in p) { delete p.y; note(where, `removed ${p.kind}'s y (it stands on the ground)`); }
    // one light: a lighthouse in the shot IS the golden light, so a separate beam would be a second one
    if (shot.props.some((p) => p.kind === "lighthouse") && shot.props.some((p) => p.kind === "beam")) { shot.props = shot.props.filter((p) => p.kind !== "beam"); note(where, "beam dropped: the lighthouse is the light"); }
    for (const kind of ["moon", "sun", "lighthouse", "beam"]) if (shot.props.filter((p) => p.kind === kind).length > 1) { const first = shot.props.findIndex((p) => p.kind === kind); shot.props = shot.props.filter((p, i) => p.kind !== kind || i === first || p.id); note(where, `more than one ${kind}: kept the first`); }
    if (shot.props.some((p) => p.kind === "moon") && shot.props.some((p) => p.kind === "sun")) { shot.props = shot.props.filter((p) => p.kind !== (["night", "dusk"].includes(shot.time) ? "sun" : "moon")); note(where, "a moon and a sun together: kept the one that fits the time of day"); }
    if (shot.props.filter((p) => p.kind === "boat").length > 1) { const first = shot.props.findIndex((p) => p.kind === "boat"); shot.props = shot.props.filter((p, i) => p.kind !== "boat" || i === first || p.id); note(where, "more than one boat: kept the first"); }
  }

  // A named story object has to be SHOWN: when the words name it and none of the line's shots has it, it is added to the first shot with people (else the first).
  const OBJECTS = [["jar", /\b(jar|pitcher|urn)\b/i], ["boat", /\b(boat|ship|canoe)\b/i], ["lighthouse", /\blighthouse\b/i], ["lamp", /\b(lantern|lamp)s?\b/i], ["sprout", /\b(seedling|sapling|shoot)\b/i]];
  (spec.lines ?? []).forEach((line, li) => {
    for (const [kind, re] of OBJECTS) {
      if (!re.test(line.say ?? "") || line.shots.some((s) => (s.props ?? []).some((p) => p.kind === kind))) continue;
      if (["boat", "lighthouse"].includes(kind) && !line.shots.some((s) => ["sea", "lake", "shore", "river"].includes(s.place))) continue;
      const target = line.shots.find((s) => (s.subjects ?? []).length) ?? line.shots[0];
      (target.props ??= []).push({ kind }); note(`line ${li}`, `"${kind}" is in the words but not in the picture: added`);
    }
  });

  // A fishing boat has someone in it: when the words say fishing boat, fisherman, sailor or crew and the boat is on the water with nobody aboard, a person stands in it.
  (spec.lines ?? []).forEach((line, li) => {
    if (!/\b(fishing boat|fisher(man|men|woman|women)?|sailors?|crew|skipper|captain)\b/i.test(line.say ?? "")) return;
    for (const shot of line.shots) {
      const boat = (shot.props ?? []).find((p) => p.kind === "boat" && !p.on);
      if (!boat || !["sea", "lake", "river"].includes(shot.place) || (shot.subjects ?? []).some((s) => Math.abs((s.x ?? 0.5) - (boat.x ?? 0.5)) < 0.18)) continue;
      (shot.subjects ??= []).push({ pose: "stand", x: boat.x ?? 0.5 }); note(`line ${li}`, "the words put someone in the boat: a person added aboard");
    }
  });

  // Every person is somebody from the people library (boy, girl, young or old man or woman, five each), the same person in every shot of a story, different people in a crowd.
  // The library fills every look the painter can draw; the director's own hex colours win, its words ("wool coat") do not.
  // How people are drawn outdoors: "lit" (default: colours, faces, a rim of light) or "silhouette" (black cut-outs). The film sets it (spec.people), a shot may override it.
  if (spec.people !== undefined && !["lit", "silhouette"].includes(spec.people)) { note("spec", `unknown people style "${spec.people}" -> lit`); spec.people = "lit"; }
  for (const { shot, where } of shots) {
    if (shot.people !== undefined && !["lit", "silhouette"].includes(shot.people)) { note(where, `unknown people style "${shot.people}" -> the film's`); delete shot.people; }
    if (shot.people === undefined && spec.people) shot.people = spec.people;
  }
  castSubjects(spec, (where, msg) => note(where, msg));
  giveCharacter(spec, (where, msg) => note(where, msg));
  applyRelations(spec, (where, msg) => note(where, msg));
  applyDressing(spec, (where, msg) => note(where, msg));
  applyFruit(spec, (where, msg) => note(where, msg));
  applySeating(spec, (where, msg) => note(where, msg));
  applyHolding(spec, (where, msg) => note(where, msg));
  applyContinuity(spec, (where, msg) => note(where, msg));
  applyGaze(spec, (where, msg) => note(where, msg));
  applyPath(spec, (where, msg) => note(where, msg));
  applyClearance(spec, (where, msg) => note(where, msg));
  for (const { shot, where } of shots) for (const s of shot.subjects ?? []) repairClothes(s, (m) => note(where, m));

  // A carried thing stays with the people carrying it: once the jar is in the story it is in every shot with people until the words put it down.
  const CARRIED = [["jar", /\b(jar|pitcher|urn)\b/i, /\b(set|put|laid) (it|the \w+) (down|aside)|dropped|poured|sold|delivered|gave (it|the \w+) (to|away)|opened the jar|handed (it|the \w+) over\b/i]];
  for (const [kind, , ended] of CARRIED) {
    let carrying = false;
    (spec.lines ?? []).forEach((line, li) => {
      if (line.shots.some((s) => (s.props ?? []).some((p) => p.kind === kind && !p.on))) carrying = true;
      if (carrying) line.shots.forEach((s) => { if ((s.subjects ?? []).length && !(s.props ?? []).some((p) => p.kind === kind)) { (s.props ??= []).push({ kind }); note(`line ${li}`, `"${kind}" stays with the people carrying it`); } });
      if (ended.test(line.say ?? "")) carrying = false;
    });
  }

  // The season belongs to the story: the words set it ("every winter", "the snow came early"), and it holds for every outdoor shot after until the words change it.
  const SEASON_WORDS = [["winter", /\b(winter|snow(y|ed|ing)?|frost(y)?|blizzard|icy|freez(e|ing))\b/i], ["autumn", /\b(autumn|fall harvest|harvest|falling leaves)\b/i], ["spring", /\b(spring|blossom\w*|bloom(ed|ing)?)\b/i], ["summer", /\b(summer|heatwave|scorching)\b/i]];
  let season = null;
  (spec.lines ?? []).forEach((line, li) => {
    const found = SEASON_WORDS.find(([, re]) => re.test(line.say ?? ""));
    if (found) season = found[0];
    for (let si = 0; si < line.shots.length; si++) {
      const shot = line.shots[si];
      if (shot.season && !SEASONS.includes(shot.season)) delete shot.season;
      if (season && !shot.season && shot.place !== "interior" && shot.place !== "sky") { shot.season = season; if (si === 0 && li === (spec.lines.findIndex((l) => l === line))) { /* noted once per change below */ } }
    }
    if (found) note(`line ${li}`, `season is ${season} from here on`);
  });

  // A room is named by the words: "the stairs of his lighthouse" is a lighthouse interior, "in the kitchen" a kitchen.
  const ROOM_WORDS = [["lighthouse", /\b(lighthouse|lamp room)\b/i], ["kitchen", /\b(kitchen|stove|cooked|baking)\b/i], ["bedroom", /\b(bedroom|bed\b|slept|sleeping)\b/i], ["workshop", /\b(workshop|workbench|forge)\b/i], ["church", /\b(church|chapel|prayer hall)\b/i], ["shop", /\b(shop|store|market stall|counter)\b/i]];
  (spec.lines ?? []).forEach((line, li) => line.shots.forEach((shot, si) => {
    if (shot.place !== "interior" || shot.room) return;
    const hit = ROOM_WORDS.find(([, re]) => re.test(line.say ?? "")); if (hit) { shot.room = hit[0]; note(`line ${li} shot ${si}`, `room is ${hit[0]} (from the words)`); }
  }));

  // Where the characters are belongs to the story: once a door is opened for them (or they go in), everything with people in it happens inside, with the
  // weather left outside the window, until the words take them out again. Shots without people (an establishing look at the house) stay as the director drew them.
  const ENTER = /\b(opened (it|the door|up)|let (her|him|them|us) in|came in(side)?|went in(side)?|stepped in(side)?|entered|walked in|welcomed (her|him|them) in|invited (her|him|them) in)\b/i;
  const EXIT = /\b(left|leaving|walked out|went out|stepped out|outside|next (day|morning)|morning came|went home|set off|said goodbye)\b/i;
  const INDOOR_ACTS = /\b(hug(ged|s|ging)?|embrace[sd]?|by the fire|warm(ed|ing)? (her|him|them|himself|herself|themselves|by|up)|shared the (bread|meal|soup)|at the table|gave (her|him|them) the|handed)\b/i;
  let inside = false, sawDoor = -9, outdoor = { weather: "clear", time: "day" };
  (spec.lines ?? []).forEach((line, li) => {
    const say = line.say ?? "";
    if (/\b(knock(ed|s)?|door)\b/i.test(say)) sawDoor = li;
    const entering = ENTER.test(say) || (INDOOR_ACTS.test(say) && li - sawDoor <= 3 && sawDoor >= 0);
    if (!inside && entering) inside = true;
    else if (inside && EXIT.test(say) && !ENTER.test(say)) inside = false;
    for (let si = 0; si < line.shots.length; si++) {
      const shot = line.shots[si], where = `line ${li} shot ${si}`;
      if (shot.place !== "interior") outdoor = { weather: shot.weather ?? outdoor.weather, time: shot.time ?? outdoor.time };
      if (inside && shot.place !== "interior" && (shot.subjects ?? []).length) {
        note(where, `"${shot.place}" -> interior (they are inside by now; the cold stays outside the window)`);
        shot.place = "interior"; shot.time = shot.time ?? outdoor.time; if (!shot.weather || shot.weather === "clear") shot.weather = outdoor.weather;
        shot.props = (shot.props ?? []).filter((p) => ["lamp", "table", "heart"].includes(p.kind)); if (/\b(bread|meal|soup|eat|ate|shared)\b/i.test(say) && !shot.props.some((p) => p.kind === "table")) shot.props.push({ kind: "table", x: 0.45 });
      }
    }
  });

  // A boat and an island in one sea shot: the island is the far thing and the boat the near one. Left at the same depth, the boat sits on the island's baseline,
  // cropped by the frame's bottom and overlapping the rock; with the island pushed back the boat is whole, in front, and the island keeps its place.
  for (const { shot, where } of shots) {
    if (!["sea", "lake"].includes(shot.place)) continue;
    const boat = (shot.props ?? []).find((p) => p.kind === "boat" && !p.on), island = (shot.props ?? []).filter((p) => !p.on && (p.kind === "rock" || p.kind === "lighthouse"));
    if (!boat || !island.length || island.some((p) => p.depth !== undefined) || boat.depth !== undefined) continue;
    for (const p of island) p.depth = 0.6;
    boat.dimensions = { width: (boat.dimensions?.width ?? 3.8) * 1.8, height: (boat.dimensions?.height ?? 3.3) * 1.8 };   // runs once: the depth guard above stops a second pass   // a little unreal, so the boat reads beside a tower
    const ix = island.find((p) => p.x !== undefined)?.x ?? 0.5;
    if (Math.abs((boat.x ?? 0.5) - ix) < 0.28) boat.x = Math.min(0.74, Math.max(0.34, ix + ((boat.x ?? 0.5) >= ix ? 0.3 : -0.3)));
    note(where, "the boat is in front of the island: the island is set back and the boat stands clear of it");
  }

  // "climbed the stairs": inside a lighthouse the person is shown climbing (travelling up the stair), not standing or walking on the spot.
  (spec.lines ?? []).forEach((line, li) => {
    if (!/\bclimb(s|ed|ing)?\b/i.test(line.say ?? "")) return;
    for (const shot of line.shots) if (shot.place === "interior" && shot.room === "lighthouse") for (const s of shot.subjects ?? []) if (!s.pose || ["walk", "stand"].includes(s.pose)) { s.pose = "climb"; if (shot.framing !== "wide") { shot.framing = "wide"; } note(`line ${li}`, "the words climb the stairs: pose -> climb, framed wide so the whole climb stays in frame"); }
  });

  // weather belongs to the story: a clear or cloudy shot between two stormy ones in the same night is the storm too
  for (let i = 1; i < shots.length - 1; i++) {
    const a = shots[i - 1].shot, b = shots[i].shot, c = shots[i + 1].shot;
    if (STORMY.includes(a.weather) && STORMY.includes(c.weather) && !STORMY.includes(b.weather) && ["night", "dusk"].includes(b.time ?? "")) {
      note(shots[i].where, `weather "${b.weather ?? "clear"}" between "${a.weather}" shots -> ${a.weather}`); b.weather = a.weather;
    }
  }
  return { spec, notes };
}
