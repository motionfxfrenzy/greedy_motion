/*
 * The oracle. When the director (or the rule layer) names something the vocabulary cannot draw (a place or an object), the engine asks Gemini to describe it
 * as a RECIPE: a short list of drawing operations in the engine's own terms (rectangles, ellipses, polygons, glows, and the kit's named pieces).
 * The answer is validated against a whitelist (nothing Gemini writes is ever run as code), cached by description, and stored in the spec, so a description
 * is asked about once. If Gemini is unreachable the engine falls back to the nearest vocabulary word.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SHAPES = new Set(["fill", "rect", "ellipse", "poly", "line", "glow", "rays"]);
export const NAMED = new Set(["room", "window", "fireplace", "table", "building", "tree", "lamp", "lighthouse", "boat", "jar", "sprout", "cross", "heart", "moon", "sun", "stars", "clouds", "ridge", "ground", "water", "path", "city", "trunks", "haze", "furnish", "sky"]);
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v) => typeof v === "number" && Number.isFinite(v);

/** Checks a recipe from the model and returns a clean copy, or throws. Unknown operations are dropped, numbers clamped, colours must be #rrggbb. */
export function validateRecipe(raw, { kind, surface } = {}) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.layers)) throw new Error("recipe has no layers");
  const layers = [];
  for (const L of raw.layers.slice(0, 90)) {
    if (!L || typeof L !== "object" || !(SHAPES.has(L.op) || NAMED.has(L.op))) continue;
    const out = { op: L.op };
    for (const [k, v] of Object.entries(L)) {
      if (k === "op") continue;
      if (typeof v === "string") { if (HEX.test(v) || ["kind", "style", "room", "shape", "flower"].includes(k)) out[k] = v.slice(0, 40); }
      else if (num(v)) out[k] = Math.min(3, Math.max(-2, v));
      else if (typeof v === "boolean") out[k] = v;
      else if (Array.isArray(v) && k === "points") out[k] = v.slice(0, 40).filter((p) => Array.isArray(p) && num(p[0]) && num(p[1])).map(([x, y]) => [Math.min(3, Math.max(-2, x)), Math.min(3, Math.max(-2, y))]);
      else if (Array.isArray(v) && k === "stops") out[k] = v.filter((c) => typeof c === "string" && HEX.test(c)).slice(0, 6);
    }
    layers.push(out);
  }
  if (layers.length < 2) throw new Error("recipe has too few usable layers");
  const objectSpace = kind === "prop" || raw.space === "object";
  if (objectSpace) {
    if (raw.space !== "object") throw new Error("object recipe must declare local space");
    const required = { rect: ["x","y","w","h"], ellipse: ["x","y","rx","ry"], poly: [], line: ["x1","y1","x2","y2","width"], glow: ["x","y","r"] };
    const unit = (v) => Math.min(1, Math.max(0, v));
    for (const layer of layers) {
      if (!(layer.op in required)) throw new Error(`object recipe cannot use frame-wide operation ${layer.op}`);
      // Near-misses are repaired, not sent back to the artist (every retry is a minute): numbers are pulled into 0..1, an ellipse or rectangle that sticks out of its box is shrunk to fit.
      for (const key of required[layer.op]) if (num(layer[key])) layer[key] = unit(layer[key]);
      if (layer.op === "poly" && Array.isArray(layer.points)) layer.points = layer.points.map(([x, y]) => [unit(x), unit(y)]);
      if (layer.op === "ellipse" && [layer.x, layer.y, layer.rx, layer.ry].every(num)) { layer.rx = Math.min(layer.rx, layer.x, 1 - layer.x); layer.ry = Math.min(layer.ry, layer.y, 1 - layer.y); }
      if (layer.op === "rect" && [layer.x, layer.y, layer.w, layer.h].every(num)) { layer.w = Math.min(layer.w, 1 - layer.x); layer.h = Math.min(layer.h, 1 - layer.y); }
      for (const key of required[layer.op]) if (!num(layer[key]) || layer[key] < 0 || layer[key] > 1) throw new Error(`object ${layer.op}.${key} must be in local 0..1 coordinates`);
      if (layer.op === "poly" && (layer.points?.length < 3 || !layer.points || layer.points.some(p => p.some(v => v < 0 || v > 1)))) throw new Error("object polygon must have at least three local points");
      if (layer.op === "rect" && (layer.x + layer.w > 1.000001 || layer.y + layer.h > 1.000001)) throw new Error("object rectangle exceeds its local box");
      if (layer.op === "ellipse" && (layer.x - layer.rx < -0.000001 || layer.x + layer.rx > 1.000001 || layer.y - layer.ry < -0.000001 || layer.y + layer.ry > 1.000001)) throw new Error("object ellipse exceeds its local box");
      if (layer.op !== "glow" && !HEX.test(layer.color ?? "")) throw new Error("object layer needs a hex colour");
    }
    if (layers.length < 6 || new Set(layers.map(l => l.color).filter(Boolean)).size < 3) throw new Error("object needs at least six layers and three material tones, including highlights and shadows");
    const target = surface ?? (raw.surface && typeof raw.surface === "object" ? raw.surface : undefined);
    const support = target ? { x: target.x, y: target.y, w: target.w } : undefined;
    if (support && (!Object.values(support).every(v => num(v) && v >= 0 && v <= 1) || support.w <= 0 || support.x - support.w / 2 < 0 || support.x + support.w / 2 > 1)) {
      return { space: "object", layers };                       // a surface that does not fit the box is dropped, not retried
    }
    const fit = fitToBox(layers, support);
    return { space: "object", ...(fit.support ? { surface: fit.support } : {}), layers: fit.layers };
  }
  return { floor_y: num(raw.floor_y) ? Math.min(0.97, Math.max(0.5, raw.floor_y)) : 0.88, indoors: Boolean(raw.indoors), layers };
}

/**
 * The commonest verdict on an object is "too small": the artist draws the thing in the middle of its box with room all round. That needs no eyes to see, only the bounding box of the layers:
 * when the drawing fills less than 70% of the box in either direction it is stretched (about its bottom centre, at most 2.4 times) to fill about 94%.
 */
export function fitToBox(layers, support) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0; const see = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const L of layers) {
    if (L.op === "rect") { see(L.x, L.y); see(L.x + L.w, L.y + L.h); }
    else if (L.op === "ellipse") { see(L.x - L.rx, L.y - L.ry); see(L.x + L.rx, L.y + L.ry); }
    else if (L.op === "poly") for (const [x, y] of L.points ?? []) see(x, y);
    else if (L.op === "line") { see(L.x1, L.y1); see(L.x2, L.y2); }
  }
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0.02 && h > 0.02) || (w >= 0.7 && h >= 0.7)) return { layers, support };
  const sx = Math.min(2.4, Math.max(1, 0.94 / w)), sy = Math.min(2.4, Math.max(1, 0.94 / h));
  const cx = (x0 + x1) / 2, mapX = (x) => Math.min(1, Math.max(0, 0.5 + (x - cx) * sx)), mapY = (y) => Math.min(1, Math.max(0, 1 - (y1 - y) * sy - 0.03));      // x about the centre, y about the bottom edge (things stand on their base)
  const out = layers.map((L) => {
    const c = { ...L };
    if (L.op === "rect") { c.x = mapX(L.x); c.y = mapY(L.y); c.w = Math.min(L.w * sx, 1 - c.x); c.h = Math.min(L.h * sy, 1 - c.y); }
    else if (L.op === "ellipse") { c.x = mapX(L.x); c.y = mapY(L.y); c.rx = Math.min(L.rx * sx, c.x, 1 - c.x); c.ry = Math.min(L.ry * sy, c.y, 1 - c.y); }
    else if (L.op === "poly") c.points = (L.points ?? []).map(([x, y]) => [mapX(x), mapY(y)]);
    else if (L.op === "line") { c.x1 = mapX(L.x1); c.y1 = mapY(L.y1); c.x2 = mapX(L.x2); c.y2 = mapY(L.y2); }
    return c;
  });
  return { layers: out, support };                                   // the surface other things sit on is a contract with the story: it stays as it was written
}

const PROMPT = (kind, describe, context, surface) => `You are the scene artist of a 2D painted-film engine. Turn a description into a RECIPE: JSON with a list of drawing layers, drawn back to front on a portrait frame (9:16). The engine paints over your flat shapes with brush strokes, so use simple, bold shapes and good colour; fine detail is wasted.

Coordinates are FRACTIONS of the frame: x 0 (left) to 1 (right), y 0 (top) to 1 (bottom). Sizes w, h, rx, ry, r are fractions of the frame width (w, rx) or height (h, ry, r). Colours are "#rrggbb" only.

Shape layers:
- {"op":"fill","stops":["#top","#bottom"],"y0":0,"y1":1}  vertical gradient band
- {"op":"rect","x":0.1,"y":0.2,"w":0.3,"h":0.4,"color":"#..","a":1}  (x,y = top-left)
- {"op":"ellipse","x":0.5,"y":0.5,"rx":0.1,"ry":0.05,"color":"#.."}  (x,y = centre)
- {"op":"poly","points":[[x,y],[x,y],[x,y]],"color":"#.."}
- {"op":"line","x1":0,"y1":0,"x2":1,"y2":1,"color":"#..","width":0.004}
- {"op":"glow","x":0.5,"y":0.3,"r":0.2,"color":"#ffd36a","a":0.5,"flicker":0.2}  soft light; "flicker" makes it breathe
- {"op":"rays","x":0.5,"y":0,"angle":1.57,"spread":0.6,"n":7,"a":0.2,"width":0.05,"color":"#fff1b8"}
Ready-made pieces you can also call by name: ${[...NAMED].join(", ")} (for example {"op":"window","x":0.2,"y":0.34,"w":0.2,"h":0.22,"night":true}, {"op":"lamp","x":0.7,"y":0.8,"h":0.26}, {"op":"furnish","kind":"bed","x":0.7,"y":0.86}).

The recipe: ${kind === "prop" ? '{"space":"object","surface":<only when this object supports another>,"layers":[...]}' : '{"floor_y":<where feet stand, 0.5-0.97>,"indoors":<true for inside>,"layers":[...]}'}.
For objects the literal top-level field "space":"object" is REQUIRED. Do not copy the place schema.
${kind === "place"
  ? "This is a PLACE: it fills the whole frame (start with a fill or a room for the back wall/sky and floor/ground). Leave the middle of the frame open: people stand there. Everything below floor_y is floor/ground, and a rect or fill that reaches the bottom of the frame (y + h = 1) is carried on below it by the engine."
  : "This is a single OBJECT in LOCAL coordinates, not frame coordinates. Return space: object. Its bounding box is x 0..1 and y 0..1; base centre (0.5,1), top y=0. Draw to fill that box. The engine positions and scales it. Use ONLY rect, ellipse, poly, line and glow; no backgrounds, ground, sky, frame fills or named pieces. Use 8-30 purposeful layers with at least three material tones: illuminated planes, midtones, cool shadows, broad texture marks and a readable silhouette. Avoid a single dark triangle or flat black silhouette. Natural objects have asymmetric layered contours and broken edges. Architectural objects have coherent perspective and distinct structural parts. Keep every coordinate within 0..1. Build the contact base at y=1. Supports need a broad level usable top, not a pointed peak."}

Example, the place "inside a lighthouse tower":
{"floor_y":0.9,"indoors":true,"layers":[{"op":"fill","stops":["#4a4852","#6c6a72"],"y0":0,"y1":0.9},{"op":"rect","x":0,"y":0,"w":0.1,"h":0.9,"color":"#3f3d46"},{"op":"rect","x":0.9,"y":0,"w":0.1,"h":0.9,"color":"#3f3d46"},{"op":"ellipse","x":0.5,"y":0.28,"rx":0.09,"ry":0.07,"color":"#0a0e2c"},{"op":"glow","x":0.5,"y":0.05,"r":0.4,"color":"#ffd36a","a":0.5,"flicker":0.15},{"op":"poly","points":[[0.3,0.88],[0.7,0.62],[0.7,0.66],[0.3,0.92]],"color":"#4a3a2a"},{"op":"rect","x":0,"y":0.9,"w":1,"h":0.2,"color":"#35333b"}]}

ABSTRACT AND SCIENCE SUBJECTS (space, planets, atoms, forces, diagrams, anything you cannot literally photograph): draw ONE clear idea as a bold painted illustration, never a technical wireframe.
- Pick one hero shape and make it big: a planet or moon is ONE large circle (ellipse with rx = ry * frameH/frameW so it is round on the 9:16 frame: rx 0.18 pairs with ry 0.101), centred around y 0.3-0.45. Build rounded things from stacked ellipses: base colour, a lighter ellipse shifted toward the light, a darker ellipse shifted away (the shadow side), a few small darker ellipses for craters/continents/bands, and a soft glow behind for atmosphere.
- Space: a deep two-stop fill (#05060f to #14173a), 25+ tiny ellipses as stars (rx 0.002-0.004, mixed brightness), one soft glow for a nebula or the sun. Keep it dark and calm; no coloured shards.
- Show relationships with a few simple marks: an arrow is a line plus a small poly head; an orbit is a thin ring made from a larger lighter ellipse with a slightly smaller ellipse of the background colour on top; a force is an arrow. At most 3 such marks.
- Never use hexagons, wireframe outlines or fans of rays as decoration. Every layer must be part of the subject.
- Keep the bottom quarter of the frame (y > 0.75) calm and dark; captions sit there.
- Hot, glowing or molten things: a dark red-brown base, orange mid-tone, a small pale-yellow core and a soft glow; never fill the frame with saturated red and green.
Example, the place "Earth with the Moon beside it in space":
{"floor_y":0.9,"indoors":false,"layers":[{"op":"fill","stops":["#05060f","#151a3d"],"y0":0,"y1":1},{"op":"ellipse","x":0.12,"y":0.1,"rx":0.003,"ry":0.0017,"color":"#ffffff"},{"op":"ellipse","x":0.82,"y":0.18,"rx":0.003,"ry":0.0017,"color":"#cfd8ff"},{"op":"ellipse","x":0.3,"y":0.62,"rx":0.003,"ry":0.0017,"color":"#ffffff"},{"op":"ellipse","x":0.9,"y":0.5,"rx":0.003,"ry":0.0017,"color":"#ffffff"},{"op":"glow","x":0.38,"y":0.38,"r":0.3,"color":"#3a7bd5","a":0.35},{"op":"ellipse","x":0.38,"y":0.38,"rx":0.27,"ry":0.152,"color":"#1f5fae"},{"op":"ellipse","x":0.33,"y":0.35,"rx":0.2,"ry":0.112,"color":"#2f7fcf"},{"op":"ellipse","x":0.28,"y":0.33,"rx":0.07,"ry":0.04,"color":"#3f9a5a"},{"op":"ellipse","x":0.4,"y":0.42,"rx":0.06,"ry":0.034,"color":"#3f9a5a"},{"op":"ellipse","x":0.5,"y":0.44,"rx":0.15,"ry":0.085,"color":"#0e2f63","a":0.55},{"op":"ellipse","x":0.78,"y":0.24,"rx":0.08,"ry":0.045,"color":"#b9b9b4"},{"op":"ellipse","x":0.76,"y":0.23,"rx":0.055,"ry":0.031,"color":"#d8d8d2"},{"op":"ellipse","x":0.8,"y":0.25,"rx":0.02,"ry":0.011,"color":"#8d8d88"},{"op":"ellipse","x":0.84,"y":0.26,"rx":0.05,"ry":0.028,"color":"#6f6f6c","a":0.5}]}

${kind === "prop" && surface ? "REQUIRED support surface in local coordinates: " + JSON.stringify(surface) + ". Draw a visible level surface at exactly this y, centred at x, spanning w. Keep the space above it clear for the attached object. Return this surface metadata." : ""}
Kind: ${kind}. Description: ${describe}
${context ? "Story context: " + context : ""}
Answer with ONLY the JSON recipe.`;

export async function askGemini(prompt, { apiKey, model = process.env.PAINTED_ORACLE_MODEL || "gemini-3.1-pro-preview" } = {}) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(Number(process.env.PAINTED_ORACLE_TIMEOUT_MS) || 90_000),
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.4 } })
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(`Gemini ${model} failed (${res.status})${d.error?.message ? ": " + d.error.message.slice(0, 160) : ""}`); }
  const body = await res.json();
  if (process.env.PAINTED_TRACE) { try { fs.appendFileSync(process.env.PAINTED_TRACE, JSON.stringify({ at: new Date().toISOString(), engine: "gemini", model, what: "oracle", inTok: body.usageMetadata?.promptTokenCount, outTok: body.usageMetadata?.candidatesTokenCount, thinkTok: body.usageMetadata?.thoughtsTokenCount }) + "\n"); } catch {} }
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(text);
}

const SHARED_CACHE = process.env.PAINTED_RECIPE_CACHE || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../var/painted-cache/recipes");
const readCached = (key, dirs, opts) => {
  for (const d of dirs.filter(Boolean)) {
    const f = path.join(d, `${key}.json`);
    if (fs.existsSync(f)) return validateRecipe(JSON.parse(fs.readFileSync(f, "utf8")), opts);
  }
  return null;
};
const writeCached = (key, dirs, payload, jpg) => {
  for (const d of dirs.filter(Boolean)) {
    try {
      fs.mkdirSync(d, { recursive: true });
      const f = path.join(d, `${key}.json`);
      fs.writeFileSync(f, JSON.stringify(payload, null, 1));
      if (jpg) fs.writeFileSync(f.replace(/\.json$/, ".jpg"), jpg);
    } catch {}
  }
};

/** Recipe for one description: from the cache, else from Gemini (validated, then cached). */
export async function recipeFor(kind, describe, { cacheDir, apiKey, context, surface, review, maxRounds = 2, passScore = 5, log = () => {} }) {
  const key = crypto.createHash("sha1").update("local-v3" + "\u0000" + kind + "\u0000" + describe.toLowerCase().trim() + "\u0000" + JSON.stringify(surface ?? null)).digest("hex").slice(0, 16);
  const dirs = [cacheDir, SHARED_CACHE];
  try { const hit = readCached(key, dirs, { kind, surface }); if (hit) return hit; }
  catch (e) { log(`· rejected cached recipe: ${e.message}`); }
  const draw = async (extra) => {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { return validateRecipe(await askGemini(PROMPT(kind, describe, context, surface) + (extra ? "\n" + extra : "") + (lastError ? "\nPrevious attempt failed validation: " + lastError.message + ". Correct this in your next recipe." : ""), { apiKey }), { kind, surface }); }
      catch (e) { lastError = e; log(`· oracle attempt ${attempt} for "${describe.slice(0, 40)}": ${e.message}`); }
    }
    throw lastError;
  };
  // Draw, look at it (review paints it with the real renderer and a vision model judges the still), and redraw from the critique until it passes. Best attempt wins.
  let best = null, critique = "", firstError;
  for (let round = 1; round <= (review ? maxRounds : 1); round++) {
    let recipe; try { recipe = await draw(critique); } catch (e) { firstError ??= e; break; }
    const verdict = review ? await review(kind, recipe, describe) : null;
    if (!verdict) { best ??= { recipe, score: null }; break; }
    log(`· looked at "${describe.slice(0, 40)}": ${verdict.score}/10${verdict.problems[0] ? " - " + verdict.problems[0].slice(0, 90) : ""}`);
    if (!best || best.score === null || verdict.score > best.score) best = { recipe, score: verdict.score, jpg: verdict.jpg };
    if (verdict.score >= passScore) break;
    critique = `A render of your previous recipe scored ${verdict.score}/10. Problems: ${verdict.problems.join("; ")}. Fixes to apply: ${verdict.fixes.join("; ")}. Redraw the recipe from scratch, applying these fixes.`;
  }
  if (!best) throw firstError;
  writeCached(key, dirs, { describe, kind, ...(best.score !== null ? { score: best.score } : {}), ...best.recipe }, best.jpg);
  log(`· drew "${describe.slice(0, 60)}" (${best.recipe.layers.length} layers${best.score !== null ? ", " + best.score + "/10" : ""})`);
  return best.recipe;
}

const NATIVE_DOODLE_PROP = /\b(hat|cap|bonnet|beret|lemon|orange|apple|cherry|plum|pear|peach|fig|fence|railing|paling|armchair|chair|bench|stool|seat|watering\s*can|burlap|cloth\s+wrap|trunk\s+wrap|walking\s+cane|wooden\s+cane|\bcane\b|walking\s+stick|shelf|shelves|bookcase|cupboard|book|notebook|journal|diary|bible|letter|envelope|paper\s+note|scroll|map|basket|crate|hamper|bucket|pail|flower\s*pot|potted\s+plant|planter|clock|pocket\s*watch|hourglass|compass|teacup|mug|cup\s+of|teapot|kettle|bowl|campfire|bonfire|fire\s+pit|stone\s+well|water\s+well|\bwell\b|signpost|wooden\s+sign|milestone|bicycle|bike|loaf|loaves|bread|roll|rolls)\b/i;

/**
 * Draws many things with ONE look per round instead of one look per thing. Round 1 draws every missing thing at once (`concurrency` at a time) and `reviewBatch` judges all of them on a single sheet;
 * round 2 redraws only those that scored below `passScore`, from the critique, and judges them on a second sheet. At most two rounds, so at most two looks per film, however many objects it has.
 * items: [{ kind, describe, surface, context }]; returns a Map from the item to { recipe } or { error }.
 */
export async function drawMany(items, { cacheDir, apiKey, reviewBatch, concurrency = 4, passScore = 5, maxRounds = 2, log = () => {} }) {
  const keyOf = (it) => crypto.createHash("sha1").update("local-v3" + "\u0000" + it.kind + "\u0000" + it.describe.toLowerCase().trim() + "\u0000" + JSON.stringify(it.surface ?? null)).digest("hex").slice(0, 16);
  const dirs = [cacheDir, SHARED_CACHE], state = new Map(), pending = [];
  for (const it of items) {
    try { const hit = readCached(keyOf(it), dirs, { kind: it.kind, surface: it.surface }); if (hit) { state.set(it, { best: { recipe: hit, score: null } }); continue; } }
    catch (e) { log(`· rejected cached recipe: ${e.message}`); }
    state.set(it, { best: null }); pending.push(it);
  }
  const askArtist = async (it, extra) => {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { return validateRecipe(await askGemini(PROMPT(it.kind, it.describe, it.context, it.surface) + (extra ? "\n" + extra : "") + (lastError ? "\nPrevious attempt failed validation: " + lastError.message + ". Correct this in your next recipe." : ""), { apiKey }), { kind: it.kind, surface: it.surface }); }
      catch (e) { lastError = e; log(`· oracle attempt ${attempt} for "${it.describe.slice(0, 40)}": ${e.message}`); }
    }
    throw lastError;
  };
  let todo = pending;
  for (let round = 1; round <= (reviewBatch ? maxRounds : 1) && todo.length; round++) {
    const drawn = (await pool(todo.map((it) => async () => { try { return { it, recipe: await askArtist(it, state.get(it).critique) }; } catch (e) { return { it, error: e }; } }), concurrency));
    const ok = drawn.filter((d) => d.recipe);
    for (const d of drawn) if (d.error) state.get(d.it).error ??= d.error;
    if (!reviewBatch) { for (const d of ok) state.get(d.it).best = { recipe: d.recipe, score: null }; break; }
    const verdicts = ok.length ? await reviewBatch(ok.map((d) => ({ kind: d.it.kind, recipe: d.recipe, describe: d.it.describe }))) : [];
    todo = [];
    ok.forEach((d, i) => {
      const v = verdicts?.[i], st = state.get(d.it);
      if (!v) { st.best ??= { recipe: d.recipe, score: null }; return; }
      log(`· looked at "${d.it.describe.slice(0, 40)}" (round ${round}): ${v.score}/10${v.problems[0] ? " - " + v.problems[0].slice(0, 90) : ""}`);
      if (!st.best || st.best.score === null || v.score > st.best.score) st.best = { recipe: d.recipe, score: v.score, jpg: v.jpg };
      if (v.score < passScore) { st.critique = `A render of your previous recipe scored ${v.score}/10. Problems: ${v.problems.join("; ")}. Fixes to apply: ${v.fixes.join("; ")}. Redraw the recipe from scratch, applying these fixes.`; todo.push(d.it); }
    });
  }
  const out = new Map();
  for (const it of items) {
    const st = state.get(it);
    if (!st.best) { out.set(it, { error: st.error ?? new Error("no recipe") }); continue; }
    if (pending.includes(it)) {
      writeCached(keyOf(it), dirs, { describe: it.describe, kind: it.kind, ...(st.best.score !== null ? { score: st.best.score } : {}), ...st.best.recipe }, st.best.jpg);
      log(`· drew "${it.describe.slice(0, 60)}" (${st.best.recipe.layers.length} layers${st.best.score !== null ? ", " + st.best.score + "/10" : ""})`);
    }
    out.set(it, { recipe: st.best.recipe });
  }
  return out;
}

/** Runs async jobs with at most `n` at a time, keeping the order of the results. */
async function pool(jobs, n) {
  const out = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { for (let i = next++; i < jobs.length; i = next++) out[i] = await jobs[i](); }));
  return out;
}

/**
 * Fills in a recipe for every custom place and prop in the spec that has none yet. Falls back to the nearest vocabulary word when the oracle fails.
 * Each DIFFERENT thing is drawn once (the same object in ten shots is one drawing) and the drawings run `concurrency` at a time, so a film with seven objects costs
 * the time of the slowest two or three, not the sum of all seven. Each drawing has at most two draw-and-look rounds (recipeFor).
 */
export async function resolveCustom(spec, { cacheDir, apiKey, review, reviewBatch, log = console.log, concurrency = Number(process.env.PAINTED_ORACLE_PARALLEL) || 4 }) {
  const wanted = new Map();                                                    // key -> { kind, describe, surface, context, targets: [{ shot | prop }] }
  const want = (kind, describe, surface, context, target) => {
    const key = kind + "\u0000" + describe.toLowerCase().trim() + "\u0000" + JSON.stringify(surface ?? null);
    if (!wanted.has(key)) wanted.set(key, { kind, describe, surface, context, targets: [] });
    wanted.get(key).targets.push(target);
  };
  for (const line of spec.lines ?? []) for (const shot of line.shots ?? []) {
    if (shot.place === "custom" && !shot.recipe) want("place", shot.describe || line.say, undefined, `The line being narrated: "${line.say}"`, { shot });
    for (const p of shot.props ?? []) if (p.kind === "custom" && (!p.recipe || p.recipe.space !== "object")) {
      const describe = p.describe || "an object from the story", text = `${describe} ${p.id ?? ""}`;
      if (spec.style === "doodle" && (NATIVE_DOODLE_PROP.test(text) || /\btree\b/i.test(text))) continue;
      want("prop", describe, p.surface, `The line being narrated: "${line.say}"`, { prop: p });
    }
  }
  const list = [...wanted.values()];
  const results = reviewBatch
    ? await drawMany(list, { cacheDir, apiKey, reviewBatch, concurrency, log }).then((map) => list.map((w) => map.get(w)))
    : await pool(list.map((w) => async () => {
      try { return { recipe: await recipeFor(w.kind, w.describe, { cacheDir, apiKey, review, surface: w.surface, context: w.context, log }) }; }
      catch (e) { return { error: e }; }
    }), concurrency);
  const resolved = results;
  [...wanted.values()].forEach((w, i) => {
    const { recipe, error } = resolved[i];
    for (const t of w.targets) {
      if (t.shot) {
        if (recipe) t.shot.recipe = structuredClone(recipe);
        else { log(`· could not draw "${w.describe.slice(0, 50)}" (${error.message}); using the nearest place`); Object.assign(t.shot, /\b(inside|room|indoor|kitchen|cabin|tower)\b/i.test(w.describe) ? { place: "interior", room: "cabin" } : { place: "meadow" }); }
      } else if (recipe) t.prop.recipe = structuredClone(recipe);
      else throw new Error(`Could not resolve story object "${t.prop.id || w.describe}": ${error.message}`);
    }
  });
  for (const line of spec.lines ?? []) for (const shot of line.shots ?? []) shot.props = (shot.props ?? []).filter((p) => p.kind !== "dropped");
  return spec;
}
