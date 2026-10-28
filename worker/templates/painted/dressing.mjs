/*
 * Set dressing: what a set decorator adds to a place that the script never says (a snowy park gets bare trees, a lamp post, a fence, a crow). The director lists a
 * line's "dressing" (3-5 background details fitting the place, season and time); the verifier removes any that contradict the story; this layer then:
 *   - keeps the dressing the SAME in every shot of the same scene (same place, room and season), so the set does not change between cuts;
 *   - places it at the edges and behind (never between or over the characters), small (depth), and marks it `dressing: true` so no renderer lets it
 *     decide the framing;
 *   - caps it (5 details, 2 of them custom: every custom detail is an AI drawing) and drops anything outside the vocabulary.
 * Pure: applyDressing(spec, note) edits the spec (lint.normalize calls it on a copy).
 */
import { PROPS } from "./vocab.mjs";

// Background dressing is modest: a tree is a garden tree, a rock a boulder, a lamp a street lamp (metres), whatever the vocabulary's full-size defaults are.
const SMALL = { tree: { width: 2.4, height: 3.6 }, rock: { width: 2.2, height: 0.8 }, lamp: { width: 0.5, height: 3 }, house: { width: 3.2, height: 2.6 }, cross: { width: 0.6, height: 1.4 } };
const MAX = 5, MAX_CUSTOM = 2, CLEAR = 0.14;
const NO_DRESS = new Set(["boat", "beam", "moon", "sun", "heart", "jar", "table", "sprout"]);      // story objects and sky things are never dressing
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** The clean dressing list of one line: vocabulary kinds, or custom with a description; at most MAX, at most MAX_CUSTOM custom. */
export function cleanDressing(list, note = () => {}) {
  const out = []; let custom = 0;
  for (const d of Array.isArray(list) ? list : []) {
    if (out.length >= MAX) break;
    if (!d || typeof d !== "object" || !(d.kind in PROPS) || NO_DRESS.has(d.kind)) { if (d?.kind) note(`dressing "${d.kind}" is not usable as set dressing: dropped`); continue; }
    if (d.kind === "custom") {
      const describe = typeof d.describe === "string" ? d.describe.trim().slice(0, 90) : ""; if (!describe) { note("a custom dressing item without a description: dropped"); continue; }
      if (custom >= MAX_CUSTOM) { note(`custom dressing "${describe}" over the limit of ${MAX_CUSTOM}: dropped`); continue; } custom++;
      const dims = d.dimensions && num(d.dimensions.width) && num(d.dimensions.height) ? { width: Math.min(40, Math.max(0.05, d.dimensions.width)), height: Math.min(40, Math.max(0.05, d.dimensions.height)) } : { width: 1, height: 1 };
      out.push({ kind: "custom", describe, dimensions: dims, x: Math.min(0.95, Math.max(0.05, num(d.x, 0.1))) });
    } else out.push({ kind: d.kind, ...(typeof d.style === "string" ? { style: d.style } : {}), x: Math.min(0.95, Math.max(0.05, num(d.x, 0.1))), dimensions: SMALL[d.kind] ? { ...SMALL[d.kind] } : undefined });
  }
  return out;
}

/** An x for a background detail: where the director asked if that is clear of the characters and the other objects, else the nearer edge. */
function clearX(x, taken) {
  const free = (v) => taken.every((t) => Math.abs(t - v) > CLEAR);
  if (free(x)) return x;
  for (const v of x < 0.5 ? [0.08, 0.16, 0.92, 0.84] : [0.92, 0.84, 0.08, 0.16]) if (free(v)) return v;
  return x < 0.5 ? 0.06 : 0.94;
}

export function applyDressing(spec, note) {
  let scene = null;                                                         // { key, items } of the scene we are in
  (spec.lines ?? []).forEach((line, li) => {
    const shots = (line.shots ?? []).filter((s) => s.place !== "plate" && s.place !== "sky"), first = shots[0];
    if (!first) return;
    const key = `${first.place}|${first.room ?? ""}|${first.season ?? ""}`, written = line.dressing ? cleanDressing(line.dressing, (m) => note(`line ${li}`, m)) : [];
    if (!scene || scene.key !== key) scene = written.length ? { key, items: written } : null;            // a new place: the director's list for it (or none)
    if (!scene) return;
    shots.forEach((shot, si) => {
      const props = (shot.props ??= []);
      for (const p of props) if (p.dressing && !p.dimensions && SMALL[p.kind]) p.dimensions = { ...SMALL[p.kind] };           // dressing already in a saved spec gets the modest sizes too
      const taken = [...(shot.subjects ?? []).map((s) => s.x ?? 0.5), ...props.filter((p) => !p.dressing).map((p) => p.x ?? 0.5)];
      for (const item of scene.items) {
        if (shot.place === "interior" && ["tree", "boat", "lighthouse", "rock"].includes(item.kind)) continue;      // not indoors
        const x = clearX(item.x, taken); taken.push(x);
        if (props.some(p => p.dressing && p.kind === item.kind && p.describe === item.describe && Math.abs((p.x ?? 0) - x) < 0.02)) continue;
        props.push({ ...structuredClone(item), x, depth: 0.5, dressing: true });
        if (props.at(-1).dimensions === undefined) delete props.at(-1).dimensions;
      }
      if (si === 0 && scene.items.length) note(`line ${li}`, `set dressing (${scene.items.map((i) => i.describe ?? i.kind).join(", ")}) kept at the edges, behind the characters`);
    });
  });
}
