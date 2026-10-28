/*
 * The vocabulary of the painting engine: one source of truth. The director's brief is generated from it (brief.mjs), the rule layer checks against it
 * (lint.mjs), and test/vocab.test.mjs fails when the drawing code (runtime/) and this file disagree.
 */
export const PLACES = {
  meadow: "open grass with soft hills", hills: "rolling green hills, walked on the open ground (no road: the engine draws a path only in a line whose words name one)", lake: "a lake with far mountains and pines", sea: "open sea to the horizon",
  forest: "tall trunks and light shafts", city: "a skyline of towers with lit windows", street: "a street between houses", village: "a village: grass, a path, two houses",
  mountains: "peaks, pine slopes, snow caps", desert: "dunes", field: "farmland rows", shore: "a beach where land meets water", road: "a road to the horizon",
  sky: "only sky", river: "a winding river with banks", interior: "inside a building: a room with a window, a fireplace or stove and furniture (see `room`)",
  custom: "anything else: the engine asks an AI to describe it as a drawing recipe (give `describe`)"
};
export const TIMES = ["dawn", "morning", "day", "sunset", "dusk", "night"];
export const WEATHERS = {
  clear: "no weather", cloudy: "grey cloud", rain: "rain, choppy water", storm: "rain with thunder: wild waves, a boat thrown about, lightning, a shaking camera; the PEAK of a storm",
  blizzard: "heavy wind-driven snow, whiteout, howling wind, shaking camera", sandstorm: "desert storm: brown-orange air, blowing sand, no sun, shaking camera", fog: "thick fog that swallows the distance", snow: "a calm snowfall"
};
export const POSES = ["stand", "walk", "climb", "open", "reach", "pray", "kneel", "hug", "sit", "hold", "wave", "cheer", "cross", "point", "shrug", "hip"];
export const MOODS = ["neutral", "smile", "laugh", "skeptical", "worried", "surprised", "sad"];
export const EXTRAS = ["glasses", "hat", "cane", "scarf"];
export const PROPS = {
  rock: "a broad layered rock outcrop with a flat support surface; use w/h for a boulder, island or ledge",
  lamp: "a street lamp", house: "a house (`style`: cottage, tower, cabin, barn, shop, church)", tree: "a tree (`fruit`: lemon, orange, apple, cherry, plum, pear, peach or fig, when the words show ripe fruit hanging in it)", boat: "a sailing boat (people near it stand in it)", lighthouse: "a striped lighthouse with a lamp and beam",
  cross: "a cross", heart: "a heart in the sky", moon: "the moon", sun: "the sun", beam: "a golden light on the horizon", groundmark: "a shape drawn on the ground with a stick or a finger (in snow, sand or mud): `shape` is sun, heart, star, circle or spiral; it draws itself during the shot, and the person nearest it (pose point or reach) is the one drawing; give that shot framing close", pond: "a small pond or puddle sitting on the ground (not a lake): an oval of water, ice when it is cold; `w` sets its size; a boat or duck may float on it (`on`: the pond)", sprout: "a seedling (`h` 0.06 tiny to 0.2)",
  jar: "a clay jar carried by the people (in their hands, between two, or on the ground when their hands are busy)", table: "a table with bread (indoors)",
  custom: "anything else: the engine asks an AI to describe it as a drawing recipe (give `describe`)"
};
export const MOVES = ["push", "pull", "pan-left", "pan-right", "rise", "fall", "drift", "still"];
export const ROOMS = { cabin: "log walls, fireplace, table", kitchen: "stove, shelves, table", bedroom: "bed, window, lamp", workshop: "workbench, tools on the wall", lighthouse: "the stairwell of a lighthouse: round stone wall, spiral stair, a round window", lantern: "the lamp room at the top of a lighthouse: glass all round, the great lamp, the sea beyond", church: "pews, tall window, candles", shop: "counter, shelves of goods" };
export const HOUSE_STYLES = ["cottage", "tower", "cabin", "barn", "shop", "church"];
export const SFX = ["thunder", "crash", "splash", "chime", "bell", "cheer", "knock", "birds"];
export const SEASONS = ["winter", "spring", "summer", "autumn"];
export const GROUNDS = ["dry"];
export const SIZES = ["tiny", "small", "medium", "large", "huge"];

// Plates: anidoodle films a shot can use as its picture (place "plate"). plates.json is written by make-plates.mjs; the films themselves live outside the repository (ANIDOODLE_DIST).
import fs from "node:fs";
export const PLATES = JSON.parse(fs.readFileSync(new URL("./plates.json", import.meta.url), "utf8"));
export const PLATE_FITS = ["cover", "contain"];
/** Plates the director may ask for: films, not single stills. */
export const PLATE_CHOICES = Object.fromEntries(Object.entries(PLATES).filter(([, p]) => p.frames > 1).map(([k, p]) => [k, `${p.title}, ${(p.frames / p.fps).toFixed(0)} s${p.kind === "loop" ? ", loops" : ""}${p.W > p.H ? ", wide" : ""}`]));

// The director and renderer share the same physical-size defaults.
import "./runtime/layout.js";
export const PHYSICAL_SIZES = globalThis.PaintedLayout.DIMENSIONS;
export const FRAMING = Object.keys(globalThis.PaintedLayout.FRAMING);
