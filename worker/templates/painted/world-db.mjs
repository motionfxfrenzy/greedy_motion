/*
 * Shared World & Cinema Intelligence Store (`world-db.mjs`).
 *
 * Sits ABOVE all rendering engines (Doodle, Oil/Painted, Anidoodle Plates, Rough-SVG, future 3D).
 * During local testing it persists to JSON files in `var/painted-cache/world-db/` (or a custom `dbDir`).
 * In production it maps 1-to-1 to the Postgres tables in `backend/src/db/migrations/010_world_intelligence.sql`:
 *   - world_objects     (Layer 1: physical dimensions, placement zone, support surfaces, anchors)
 *   - staging_rules     (Layer 1/2: verb/relationship invariants enforced across all engines)
 *   - camera_exemplars  (Layer 2: gold-standard shot coverage retrieved by beat similarity)
 *   - scene_edit_events (Learning telemetry: classifies user `--fix` / Studio edits into preference vs engine knowledge)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_WORLD_DB_DIR = process.env.PAINTED_WORLD_DB || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../var/painted-cache/world-db");

/**
 * Layer 1: Universal Object Ontology.
 * Every engine (Doodle, Oil, Anidoodle, 3D) shares these physical dimensions (in metres),
 * placement zones ("grounded" | "floating" | "airborne" | "wall" | "handheld"), and support surfaces.
 */
export const BUILTIN_WORLD_OBJECTS = {
  kite:         { slug: "kite",         aliases: ["kite", "diamond kite"],                       zone: "airborne", dimensions: { width: 0.7, height: 0.9 }, anchors: { tether: [0.5, 0.9] } },
  balloon:      { slug: "balloon",      aliases: ["balloon", "hot air balloon"],                 zone: "airborne", dimensions: { width: 0.4, height: 0.5 }, anchors: { tether: [0.5, 1.0] } },
  toy_boat:     { slug: "toy_boat",     aliases: ["toy boat", "toy sailboat", "paper boat"],     zone: "floating", dimensions: { width: 0.28, height: 0.32 }, anchors: { tether: [0.5, 0.75] } },
  lemon:        { slug: "lemon",        aliases: ["lemon", "orange", "apple", "peach", "pear"],  zone: "handheld", dimensions: { width: 0.08, height: 0.09 }, nativeDoodle: true },
  fence:        { slug: "fence",        aliases: ["fence", "railing", "paling"],                 zone: "grounded", dimensions: { width: 3.0, height: 1.1 }, nativeDoodle: true },
  chair:        { slug: "chair",        aliases: ["armchair", "chair", "bench", "stool", "seat"], zone: "grounded", dimensions: { width: 0.75, height: 0.95 }, surface: { x: 0.5, y: 0.5, w: 0.8 }, nativeDoodle: true },
  watering_can: { slug: "watering_can", aliases: ["watering can"],                               zone: "grounded", dimensions: { width: 0.38, height: 0.32 }, nativeDoodle: true },
  burlap:       { slug: "burlap",       aliases: ["burlap", "cloth wrap", "trunk wrap"],         zone: "grounded", dimensions: { width: 0.28, height: 0.55 }, nativeDoodle: true },
  cane:         { slug: "cane",         aliases: ["walking cane", "wooden cane", "walking stick"], zone: "grounded", dimensions: { width: 0.12, height: 0.88 }, nativeDoodle: true },
  shelf:        { slug: "shelf",        aliases: ["shelf", "shelves", "bookcase", "cupboard"],   zone: "wall",     dimensions: { width: 0.85, height: 0.45 }, surface: { x: 0.5, y: 0.2, w: 0.85 }, nativeDoodle: true },
  book:         { slug: "book",         aliases: ["book", "notebook", "journal", "diary"],       zone: "grounded", dimensions: { width: 0.26, height: 0.18 }, nativeDoodle: true },
  letter:       { slug: "letter",       aliases: ["letter", "envelope", "scroll", "map"],        zone: "handheld", dimensions: { width: 0.22, height: 0.15 }, nativeDoodle: true },
  basket:       { slug: "basket",       aliases: ["basket", "crate", "hamper", "bucket", "pail"], zone: "grounded", dimensions: { width: 0.42, height: 0.36 }, nativeDoodle: true },
  flowerpot:    { slug: "flowerpot",    aliases: ["flowerpot", "flower pot", "potted plant"],    zone: "grounded", dimensions: { width: 0.28, height: 0.42 }, nativeDoodle: true },
  clock:        { slug: "clock",        aliases: ["clock", "pocket watch", "hourglass", "compass"], zone: "grounded", dimensions: { width: 0.24, height: 0.26 }, nativeDoodle: true },
  cup:          { slug: "cup",          aliases: ["teacup", "mug", "teapot", "kettle", "bowl"],  zone: "grounded", dimensions: { width: 0.16, height: 0.14 }, nativeDoodle: true },
  campfire:     { slug: "campfire",     aliases: ["campfire", "bonfire", "fire pit"],            zone: "grounded", dimensions: { width: 0.75, height: 0.55 }, nativeDoodle: true },
  well:         { slug: "well",         aliases: ["stone well", "water well", "well"],           zone: "grounded", dimensions: { width: 1.2, height: 1.6 }, nativeDoodle: true },
  signpost:     { slug: "signpost",     aliases: ["signpost", "wooden sign", "milestone"],       zone: "grounded", dimensions: { width: 0.65, height: 1.5 }, nativeDoodle: true },
  bicycle:      { slug: "bicycle",      aliases: ["bicycle", "bike"],                            zone: "grounded", dimensions: { width: 1.5, height: 1.0 }, nativeDoodle: true },
  loaves:       { slug: "loaves",       aliases: ["loaf", "loaves", "bread", "warm loaves"],     zone: "handheld", dimensions: { width: 0.45, height: 0.18 }, nativeDoodle: true },
};

/**
 * Layer 2: Universal Staging & Continuity Invariants.
 * Shared across all engines so any spatial/camera fix learned once applies everywhere.
 */
export const BUILTIN_STAGING_RULES = [
  { id: "place_on_support", category: "spatial_invariant", trigger: "\\b(placed|set|laid|rested|put)\\b.*\\bon\\b", invariant: { kind: "attach_on", insertDetailShot: true }, approvals: 10 },
  { id: "watch_ahead_rear", category: "camera_grammar",    trigger: "\\b(watched|looked\\s+at)\\b.*\\b(ahead|beyond|distance)\\b", invariant: { kind: "facing_by_depth", facing: "back", minTargetDepth: 0.6 }, approvals: 10 },
  { id: "beside_profile",   category: "camera_grammar",    trigger: "\\b(beside|next\\s+to)\\b", invariant: { kind: "look_at_target" }, approvals: 10 },
  { id: "emotion_portrait", category: "camera_grammar",    trigger: "\\b(whispered|promised|smiled|cried|wept|murmured)\\b", invariant: { kind: "portrait_on_emotion", framing: "close" }, approvals: 10 },
  { id: "profile_arm_order", category: "anatomy_rig",      trigger: "facing:left|right", invariant: { kind: "far_limb_behind_torso" }, approvals: 10 },
];

const readJson = (file, fallback) => { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; } catch { return fallback; } };
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); };

/** Loads the merged World Intelligence state (built-ins + learned records from `dbDir`). */
export function loadWorldDb(dbDir = DEFAULT_WORLD_DB_DIR) {
  const learnedObjects = readJson(path.join(dbDir, "world_objects.json"), {});
  const learnedRules = readJson(path.join(dbDir, "staging_rules.json"), []);
  const exemplars = readJson(path.join(dbDir, "camera_exemplars.json"), []);
  const demand = readJson(path.join(dbDir, "prop_demand.json"), {});
  const objects = { ...BUILTIN_WORLD_OBJECTS, ...learnedObjects };
  const ruleMap = new Map(BUILTIN_STAGING_RULES.map((r) => [r.id, r]));
  for (const r of learnedRules) ruleMap.set(r.id, r);
  return { dbDir, objects, rules: [...ruleMap.values()], exemplars, demand };
}

/** Matches a free-text custom prop description + id against known `world_objects`. */
export function matchWorldObject(describe = "", id = "", db = loadWorldDb()) {
  const text = `${describe} ${id}`.toLowerCase();
  if (/\btree\b/.test(text) && !/\bburlap\b/.test(text)) return null;
  for (const obj of Object.values(db.objects)) {
    for (const alias of obj.aliases || [obj.slug]) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return obj;
    }
  }
  return null;
}

const PREF_FIELDS = new Set(["top", "bottom", "hairColor", "skin", "color", "time", "weather", "season", "doodle", "look", "move"]);

/**
 * Classifies a `(shotBefore, shotAfter, say, instruction)` diff from a user `--fix` or Studio edit.
 * Separates personal taste ("make the rock black", "make her sweater red") from real engine intelligence:
 *   - "user_preference"    -> personal colour/style/time choice; never pollutes global engine rules
 *   - "spatial_invariant"  -> added `on` support, `tether`, `aboard`, or resolved a collision/facing bug
 *   - "object_ontology"    -> fixed object dimensions, support surface, or placement zone
 *   - "camera_grammar"     -> upgraded framing to `portraitOf`, `detailOf`, or `lookAt`
 *   - "missing_prop_asset" -> added a new custom object the story needed
 */
export function classifyEditDiff({ say = "", instruction = "", shotBefore = {}, shotAfter = {} }) {
  const changes = [], reasons = [];
  const subsBefore = shotBefore.subjects ?? [], subsAfter = shotAfter.subjects ?? [];
  const propsBefore = shotBefore.props ?? [], propsAfter = shotAfter.props ?? [];

  // 1. Check for new custom props (Missing Prop Asset)
  const newCustom = propsAfter.filter((p) => p.kind === "custom" && !propsBefore.some((q) => (q.id && q.id === p.id) || q.describe === p.describe));
  if (newCustom.length) {
    changes.push({ type: "missing_prop_asset", props: newCustom.map((p) => ({ id: p.id, describe: p.describe, dimensions: p.dimensions })) });
    reasons.push(`added custom prop: ${newCustom.map((p) => p.describe || p.id).join(", ")}`);
  }

  // 2. Check for support (`on`) or `tether` or `aboard` fixes (Spatial Invariant)
  for (const pAfter of propsAfter) {
    const pBefore = propsBefore.find((q) => (pAfter.id && q.id === pAfter.id) || q.kind === pAfter.kind);
    if (pAfter.on && pBefore?.on !== pAfter.on) {
      changes.push({ type: "spatial_invariant", kind: "attach_on", child: pAfter.id || pAfter.describe || pAfter.kind, parent: pAfter.on });
      reasons.push(`attached ${pAfter.id || pAfter.kind} on ${pAfter.on}`);
    }
    if (pAfter.tether && JSON.stringify(pBefore?.tether) !== JSON.stringify(pAfter.tether)) {
      changes.push({ type: "spatial_invariant", kind: "tether", prop: pAfter.id || pAfter.kind, tether: pAfter.tether });
      reasons.push(`tethered ${pAfter.id || pAfter.kind} to ${pAfter.tether.who}`);
    }
    if (pAfter.dimensions && pBefore?.dimensions && JSON.stringify(pBefore.dimensions) !== JSON.stringify(pAfter.dimensions)) {
      changes.push({ type: "object_ontology", kind: "dimensions", prop: pAfter.id || pAfter.describe || pAfter.kind, dimensions: pAfter.dimensions });
      reasons.push(`resized ${pAfter.id || pAfter.kind}`);
    }
  }

  // 3. Check for indoor/outdoor or pond/lake place corrections (Spatial Invariant)
  if (shotBefore.place !== shotAfter.place && shotAfter.place) {
    const pondFix = ["lake", "sea", "river"].includes(shotBefore.place) && propsAfter.some((p) => p.kind === "pond");
    const indoorFix = shotAfter.place === "interior" && /\b(inside|room|cabin|house|window|chair|table|fire)\b/i.test(`${say} ${instruction}`);
    if (pondFix || indoorFix) {
      changes.push({ type: "spatial_invariant", kind: "place_correction", from: shotBefore.place, to: shotAfter.place, room: shotAfter.room });
      reasons.push(`corrected place ${shotBefore.place} -> ${shotAfter.place}`);
    }
  }

  // 4. Check for Camera & Acting Grammar (`portraitOf`, `detailOf`, `lookAt`, `facing`)
  if (!shotBefore.portraitOf && shotAfter.portraitOf) {
    changes.push({ type: "camera_grammar", kind: "portraitOf", subject: shotAfter.portraitOf, say });
    reasons.push(`added portrait close-up of ${shotAfter.portraitOf}`);
  }
  if (!shotBefore.detailOf && shotAfter.detailOf) {
    changes.push({ type: "camera_grammar", kind: "detailOf", object: shotAfter.detailOf, say });
    reasons.push(`added object detail close-up of ${shotAfter.detailOf}`);
  }
  subsAfter.forEach((sAfter, i) => {
    const sBefore = subsBefore.find((q) => q.who && q.who === sAfter.who) ?? subsBefore[i];
    if (!sBefore) return;
    if (sAfter.lookAt && sBefore.lookAt !== sAfter.lookAt) {
      changes.push({ type: "camera_grammar", kind: "lookAt", who: sAfter.who, target: sAfter.lookAt });
      reasons.push(`${sAfter.who} lookAt -> ${sAfter.lookAt}`);
    } else if (sAfter.facing && sBefore.facing !== sAfter.facing) {
      changes.push({ type: "spatial_invariant", kind: "facing", who: sAfter.who, from: sBefore.facing, to: sAfter.facing });
      reasons.push(`${sAfter.who} facing ${sBefore.facing ?? "auto"} -> ${sAfter.facing}`);
    }
  });

  // 5. If none of the structural/camera/ontology rules fired, check if it's purely a colour/lighting/taste preference
  if (!changes.length) {
    const colorMention = /\b(black|brown|red|blue|green|yellow|purple|pink|orange|white|dark|light|bright|warmer|cooler|sunset|night|dawn)\b/i.test(instruction);
    const touchedOnlyPrefs = Object.keys({ ...shotBefore, ...shotAfter }).every((k) => JSON.stringify(shotBefore[k]) === JSON.stringify(shotAfter[k]) || PREF_FIELDS.has(k) || k === "subjects" || k === "props");
    return {
      classification: "user_preference",
      promoteToEngine: false,
      changes: [{ type: "user_preference", note: instruction || "style/colour/position preference" }],
      summary: colorMention ? `Personal colour/style preference ("${instruction}")` : "Shot-local preference; kept out of global engine rules",
    };
  }

  const priority = ["spatial_invariant", "camera_grammar", "object_ontology", "missing_prop_asset"];
  const primary = priority.find((p) => changes.some((c) => c.type === p)) || changes[0].type;
  return {
    classification: primary,
    promoteToEngine: true,
    changes,
    summary: reasons.join("; "),
  };
}

/**
 * Records a user edit (or approved scene diff) into the World Intelligence store.
 * - Preferences are written ONLY to `user_preferences.jsonl` (never polluting global engine rules).
 * - Structural invariants, object ontology updates, prop demand, and camera exemplars update the shared DB.
 */
export function recordEditEvent({ engine = "doodle", userId = "local", projectId = "local", say = "", scene = "", instruction = "", shotsBefore = [], shotsAfter = [], exported = true }, dbDir = DEFAULT_WORLD_DB_DIR) {
  const sBefore = shotsBefore[0] ?? {}, sAfter = shotsAfter[0] ?? {};
  const verdict = classifyEditDiff({ say, instruction, shotBefore: sBefore, shotAfter: sAfter });
  const event = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    engine,
    userId,
    projectId,
    say,
    instruction,
    classification: verdict.classification,
    promoteToEngine: verdict.promoteToEngine,
    summary: verdict.summary,
    changes: verdict.changes,
    shotBefore: sBefore,
    shotAfter: sAfter,
    exported,
  };

  fs.mkdirSync(dbDir, { recursive: true });
  const logFile = path.join(dbDir, verdict.promoteToEngine ? "engine_edit_events.jsonl" : "user_preferences.jsonl");
  fs.appendFileSync(logFile, JSON.stringify(event) + "\n");

  if (!exported || !verdict.promoteToEngine) return event;

  // Promote learned knowledge to the shared tables when exported
  if (verdict.changes.some((c) => c.type === "camera_grammar")) {
    const exFile = path.join(dbDir, "camera_exemplars.json");
    const exemplars = readJson(exFile, []);
    if (say && !exemplars.some((e) => e.say === say)) {
      exemplars.push({ id: event.id, engine, say, scene, instruction, shots: shotsAfter, createdAt: event.at });
      writeJson(exFile, exemplars.slice(-100));
    }
  }

  for (const c of verdict.changes) {
    if (c.type === "missing_prop_asset") {
      const dFile = path.join(dbDir, "prop_demand.json"), demand = readJson(dFile, {});
      for (const p of c.props) {
        const key = (p.describe || p.id || "unknown").toLowerCase().trim();
        demand[key] = { count: (demand[key]?.count ?? 0) + 1, dimensions: p.dimensions ?? demand[key]?.dimensions, lastSeen: event.at };
      }
      writeJson(dFile, demand);
    }
    if (c.type === "object_ontology" && c.prop && c.dimensions) {
      const oFile = path.join(dbDir, "world_objects.json"), objs = readJson(oFile, {});
      const slug = c.prop.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      objs[slug] = { ...(objs[slug] ?? { slug, aliases: [c.prop.toLowerCase()], zone: "grounded" }), dimensions: c.dimensions };
      writeJson(oFile, objs);
    }
  }

  return event;
}

/** Retrieves up to `limit` gold-standard camera exemplars whose narration shares concrete words with `script`. */
export function retrieveCameraExemplars(script = "", { dbDir = DEFAULT_WORLD_DB_DIR, limit = 2 } = {}) {
  const exemplars = readJson(path.join(dbDir, "camera_exemplars.json"), []);
  if (!exemplars.length) return [];
  const words = new Set(String(script).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  return exemplars
    .map((ex) => {
      const score = String(ex.say).toLowerCase().split(/\W+/).filter((w) => words.has(w)).length;
      return { ex, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.ex);
}
