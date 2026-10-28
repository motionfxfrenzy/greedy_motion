/*
 * The script supervisor: a second reading of the director's spec against the script, the way a film's continuity person watches the set. It does not know about
 * lighthouses or boats: it is asked to check every KIND of relationship a story has (who is where, what is inside what, which room is which, what the weather can
 * touch, who must be present, what must persist) and to answer with small, structured, validated fixes. Fixes are data (a fixed set of operations on vocabulary
 * fields), never code and never new words in the script. relations.mjs (deterministic) runs after it as the safety net for what it misses.
 *
 *   describeSpec(spec) -> text        what the supervisor reads
 *   applyFixes(spec, fixes) -> notes  validates and applies (pure, edits the spec)
 *   supervise({ spec, script, engine, ask }) -> { spec, notes }
 */
import { cleanDressing } from "./dressing.mjs";
import { PLACES, TIMES, WEATHERS, POSES, MOODS, ROOMS, PROPS, SEASONS } from "./vocab.mjs";

const SHOT_FIELDS = { place: Object.keys(PLACES), time: TIMES, weather: Object.keys(WEATHERS), season: SEASONS, room: Object.keys(ROOMS), framing: ["wide", "medium", "close"], ground: ["dry"] };
const SUBJECT_FIELDS = { pose: POSES, mood: MOODS, facing: ["front", "back", "left", "right"] };
const clip = (n) => Math.min(0.97, Math.max(0.03, n));

export function describeSpec(spec) {
  const objs = spec.objects ?? {};
  return (spec.lines ?? []).map((l, li) => `${li}: "${l.say}"\n   scene (the director's description): ${l.scene ?? "(none written)"}\n` + (l.dressing?.length ? `   dressing: ${l.dressing.map((d, i) => `[${i}]${d.kind === "custom" ? d.describe : d.kind}@${d.x ?? "auto"}`).join("; ")}\n` : "") + (l.shots ?? []).map((s, si) =>
    `   shot ${si}: ${s.place}${s.room ? "/" + s.room : ""} ${s.time ?? ""} ${s.weather ?? "clear"}${s.season ? " " + s.season : ""} | people: ${(s.subjects ?? []).map((p, i) => `[${i}]${p.who ?? "?"} ${p.pose ?? "stand"}@${p.x ?? "auto"}${p.aboard !== undefined ? " aboard=" + p.aboard : ""}${p.on ? " on=" + p.on : ""}`).join("; ") || "none"} | props: ${(s.props ?? []).map((p, i) => { const def = (p.id && objs[p.id]) || {}; const kind = p.kind ?? def.kind, on = p.on ?? def.on; return `[${i}]${kind}${p.id ? "#" + p.id : ""}@${p.x ?? def.x ?? "auto"}${on ? " on=" + on : ""}`; }).join("; ") || "none"}`).join("\n")).join("\n");
}

const find = (spec, line, shot) => spec.lines?.[line]?.shots?.[shot];

/** Applies the supervisor's fixes. Anything outside the vocabulary or the allowed operations is skipped and reported. */
export function applyFixes(spec, fixes, note = () => {}) {
  let applied = 0;
  for (const f of (Array.isArray(fixes) ? fixes : []).slice(0, 60)) {
    const where = `line ${f?.line} shot ${f?.shot}`, why = f?.reason ? ` (${String(f.reason).slice(0, 140)})` : "", lineOnly = f?.op === "removeDressing" || f?.op === "addDressing", shot = lineOnly ? { subjects: [], props: [] } : find(spec, f?.line, f?.shot);
    if (!shot) { note(where, `supervisor fix skipped: no such shot`); continue; }
    const subs = (shot.subjects ??= []), props = (shot.props ??= []);
    try {
      switch (f.op) {
        case "setShot": {
          const ok = SHOT_FIELDS[f.field]; if (!ok || !ok.includes(f.value)) throw new Error(`"${f.field}" = "${f.value}" is not in the vocabulary`);
          if (shot[f.field] !== f.value) { note(where, `supervisor: ${f.field} "${shot[f.field] ?? "-"}" -> "${f.value}"${why}`); shot[f.field] = f.value; applied++; } break;
        }
        case "setSubject": {
          const s = subs[f.index]; if (!s) throw new Error("no such person");
          if (f.field === "aboard") { if (f.value !== false && typeof f.value !== "string") throw new Error("aboard is a boat id or false"); }
          else if (f.field === "x") { if (!Number.isFinite(f.value)) throw new Error("x is a number"); f.value = clip(f.value); }
          else { const ok = SUBJECT_FIELDS[f.field]; if (!ok || !ok.includes(f.value)) throw new Error(`"${f.field}" = "${f.value}" is not in the vocabulary`); }
          if (s[f.field] !== f.value) { note(where, `supervisor: ${s.who ?? "person " + f.index} ${f.field} -> ${JSON.stringify(f.value)}${why}`); s[f.field] = f.value; applied++; } break;
        }
        case "addSubject": {
          const src = find(spec, f.copyFrom?.line, f.copyFrom?.shot)?.subjects?.[f.copyFrom?.index]; if (!src) throw new Error("no person to copy");
          if (subs.length >= 6) throw new Error("a shot holds at most 6 people"); if (src.who && subs.some((s) => s.who === src.who)) break;   // already there
          const set = f.set ?? {}, extra = {}; if ("pose" in set && POSES.includes(set.pose)) extra.pose = set.pose; if ("x" in set && Number.isFinite(set.x)) extra.x = clip(set.x); if ("aboard" in set && (set.aboard === false || typeof set.aboard === "string")) extra.aboard = set.aboard;
          subs.push({ ...structuredClone(src), ...extra }); note(where, `supervisor: ${src.who ?? "a person"} added (continuity)${why}`); applied++; break;
        }
        case "removeSubject": { const s = subs[f.index]; if (!s) throw new Error("no such person"); subs.splice(f.index, 1); note(where, `supervisor: ${s.who ?? "person " + f.index} removed${why}`); applied++; break; }
        case "addProp": {
          const p = f.prop; if (!p || !(p.kind in PROPS)) throw new Error("unknown prop kind");
          const custom = p.kind === "custom", describe = typeof p.describe === "string" ? p.describe.trim().slice(0, 90) : "";
          if (custom && !describe) throw new Error("a custom object needs a description (the oracle draws it)");
          if (props.some((q) => q.kind === p.kind && (q.id ?? null) === (p.id ?? null) && (!custom || q.describe === describe))) break;
          const dims = p.dimensions && Number.isFinite(p.dimensions.width) && Number.isFinite(p.dimensions.height) ? { width: Math.min(60, Math.max(0.02, p.dimensions.width)), height: Math.min(60, Math.max(0.02, p.dimensions.height)) } : undefined;
          const sf = p.surface && ["x", "y", "w"].every((k) => Number.isFinite(p.surface[k])) ? { x: clip(p.surface.x), y: Math.min(1, Math.max(0, p.surface.y)), w: Math.min(1, Math.max(0.05, p.surface.w)) } : undefined;
          const on = typeof p.on === "string" && props.some((q) => q.id === p.on) ? p.on : undefined;
          props.push({ kind: p.kind, ...(p.id ? { id: String(p.id) } : {}), ...(custom ? { describe } : {}), ...(Number.isFinite(p.x) ? { x: clip(p.x) } : {}), ...(dims ? { dimensions: dims } : {}), ...(sf ? { surface: sf } : {}), ...(on ? { on } : {}) });
          note(where, `supervisor: ${custom ? `"${describe}"` : p.kind} added${why}`); applied++; break;
        }
        case "removeDressing": { const l = spec.lines?.[f.line]; const d = l?.dressing?.[f.index]; if (!d) throw new Error("no such dressing"); l.dressing.splice(f.index, 1); note(`line ${f.line}`, `supervisor: dressing "${d.describe ?? d.kind}" removed${why}`); applied++; break; }
        case "addDressing": { const l = spec.lines?.[f.line]; if (!l || !f.item) throw new Error("no such line"); const before = (l.dressing ??= []).length; l.dressing.push(f.item); const kept = cleanDressing(l.dressing); if (kept.length > before) { l.dressing = kept; note(`line ${f.line}`, `supervisor: dressing "${f.item.describe ?? f.item.kind}" added${why}`); applied++; } else { l.dressing.pop(); throw new Error("not usable as set dressing"); } break; }
        case "setProp": {
          const p = props[f.index]; if (!p) throw new Error("no such prop");
          if (f.field === "on") { if (f.value !== null && !(typeof f.value === "string" && props.some((q) => q.id === f.value && q !== p))) throw new Error("on must be the id of another object in the shot"); }
          else if (f.field === "x") { if (!Number.isFinite(f.value)) throw new Error("x is a number"); f.value = clip(f.value); }
          else throw new Error(`"${f.field}" cannot be set on an object`);
          if (p[f.field] !== f.value) { if (f.value === null) delete p[f.field]; else p[f.field] = f.value; note(where, `supervisor: ${p.id ?? p.kind} ${f.field} -> ${JSON.stringify(f.value)}${why}`); applied++; } break;
        }
        case "removeProp": { const p = props[f.index]; if (!p) throw new Error("no such prop"); props.splice(f.index, 1); note(where, `supervisor: ${p.kind} removed${why}`); applied++; break; }
        default: throw new Error(`unknown operation "${f.op}"`);
      }
    } catch (e) { note(where, `supervisor fix skipped: ${e.message}`); }
  }
  return applied;
}

const SYSTEM = () => `You are the verifier of a painted short film: the continuity person who checks every shot against the script and the story so far. A director (another model) first read the script and wrote a plain-language SCENE description for each line, then built the shots. You verify, in this order: (1) that the scene descriptions are true to the script's words and to each other; (2) that the shots show EXACTLY what the scene description says: every person, object, piece of ground or water, structure and relationship it names is present in the shots (and nothing the scene does not say); (3) consistency from shot to shot. You answer with small fixes.

Check every kind of relationship a story has, in general (do not assume any particular story):
- Who is where: who is aboard a vessel, inside a building, on a support, in a crowd, alone. A vessel that carried people carries the SAME people (same ids, same number) in every shot it appears in until the words land or move them; people near it who are not crew are not aboard ("aboard":false). Set "aboard":"<boat id>" for crew.
- Which room is which: a building has different rooms for different activities, and each is a different picture. Choose the room the words and the action need from this list: ${Object.entries(ROOMS).map(([k, v]) => `${k} (${v})`).join("; ")}.
- Exposure: weather falls outdoors; indoors it is only seen through a window. A shot inside a building is place "interior" whenever the words put people inside.
- Presence: someone the words or an earlier shot put in a scene must still be in it; someone the words took away must not reappear without arriving.
- Persistence: things keep their place, state and ownership until the words change them (a light that is lit stays lit; a carried thing stays carried). This is for what the people carry, use or stand with. A place or thing only pointed at or mentioned (a pond across the park, a hill in the distance) is NOT added to every shot: add it only to the shots where the words put the people at it.
- Time, season, light and weather continue from shot to shot unless the words change them.
- Named things: for EVERY line, list the concrete things the words mention besides people (an object, a piece of ground or water, a structure, an animal) and check each is in the shots where the words use it. If one is missing, add it: a vocabulary kind when one fits, otherwise a "custom" object with a short "describe" and physical "dimensions" in metres (the engine draws it). If the words put one thing ON another (a boat on a puddle, a jar on a table) give the upper one "on":"<id of the lower one>" (the lower needs an "id" and, if custom, a "surface").
- Moments worth seeing: if a line is about someone making something happen (drawing a shape on the ground, lighting, planting, writing, handing over), that action must be shown in its own close shot with the thing being made (use a "groundmark" with a shape for a drawing on the ground). If it is only a small detail of a wide shot, add a close shot after it (copy the people and props; set framing close; add the groundmark or object).
- Set dressing: each line may carry the director's "dressing" (background details a set decorator would add). Remove any that contradicts the script or the scene (the wrong season or weather, a person or animal the story rules out, something the words say is absent, something that competes with a story object); add one only if the place is bare and a decorator would obviously fill it.
- Size of things: a pond or puddle is a small patch of water on land (the prop "pond"), not a lake that fills the picture; if a shot made a pond or puddle into place lake, river or sea, change the place to the land the pond is in (a park is a meadow) and add the "pond" prop with the people on the bank. The same for any small thing drawn too big.
- Scale and kind: a toy, model or miniature is small, held or set down, and is never a vessel or building that people stand in; do not draw both a toy and a full-size version of the same thing; an object the story names (a bench, a spool, a toy boat) must be in the shots where the words use it.
- Physical sense: people do not stand on open water, boats need water, a lit lamp at night shows its light.
Only fix what is wrong. Never change the script's words. Use only vocabulary values. Prefer few, precise fixes.

Vocabulary: places ${Object.keys(PLACES).join(", ")}; times ${TIMES.join(", ")}; weather ${Object.keys(WEATHERS).join(", ")}; seasons ${SEASONS.join(", ")}; poses ${POSES.join(", ")}; moods ${MOODS.join(", ")}.

Answer ONLY with JSON: {"fixes":[ ... ]} where each fix is one of
 {"line":N,"shot":M,"op":"setShot","field":"place|time|weather|season|room|framing|ground","value":"...","reason":"..."}
 {"line":N,"shot":M,"op":"setSubject","index":I,"field":"pose|mood|facing|x|aboard","value":...,"reason":"..."}
 {"line":N,"shot":M,"op":"addSubject","copyFrom":{"line":A,"shot":B,"index":C},"set":{"pose":"...","x":0.5,"aboard":"<id>"},"reason":"..."}
 {"line":N,"shot":M,"op":"removeSubject","index":I,"reason":"..."}
 {"line":N,"shot":M,"op":"addProp","prop":{"kind":"... or custom","id":"...","describe":"(custom only)","dimensions":{"width":1.2,"height":0.1},"surface":{"x":0.5,"y":0.3,"w":0.8},"on":"<id>","x":0.5},"reason":"..."}
 {"line":N,"op":"removeDressing","index":I,"reason":"..."}  /  {"line":N,"op":"addDressing","item":{"kind":"tree","x":0.1},"reason":"..."}
 {"line":N,"shot":M,"op":"setProp","index":I,"field":"on|x","value":"<id>"|0.5|null,"reason":"..."}
 {"line":N,"shot":M,"op":"removeProp","index":I,"reason":"..."}
An empty list is a good answer when nothing is wrong.`;

export async function supervise({ spec, script, engine, ask, notes = [] }) {
  const user = `Script:\n${script}\n\nThe director's shots (line: words; then each shot; people [index]who pose@x; props [index]kind#id@x):\n${describeSpec(spec)}`;
  const answer = await ask({ engine, what: "supervisor", system: SYSTEM(), user, maxTokens: 40000, temperature: 0.2 });
  const fixes = answer?.fixes ?? [];
  const applied = applyFixes(spec, fixes, (w, m) => notes.push(`${w}: ${m}`));
  return { spec, notes, applied, asked: fixes.length };
}
