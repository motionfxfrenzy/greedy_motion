/*
 * The story's relationships: who is in what, what belongs with whom, which room is which. The director is an LLM, so it forgets them from shot to shot; this layer
 * keeps them true and reports every change. Pure: applyRelations(spec, note) edits the spec (lint.normalize calls it on a copy).
 *
 *   vessel crew     a boat seen with people keeps those people aboard in every later shot of that boat (the same characters, never fewer, never strangers);
 *                   other people near it are on the shore (`aboard: false`), never aboard by accident. The crew stays until the words land them.
 *   rooms           the stairwell of a lighthouse and its lamp room (`lantern`) are two rooms: lighting or tending the lamp happens in the lantern.
 *   water           a boat needs water: on land it is moved to a shore.
 *   size            a toy or model is small and is not a vessel anyone stands in; a small boat (under 1.5 m) never has a crew.
 * The renderers read `subject.aboard` (the boat's id, or false) instead of guessing from how close two x values are.
 */
const NEAR = 0.18, WATER = ["sea", "lake", "river", "shore"];
const LANDED = /\b(ashore|landed|landing|stepped (off|out|onto)|jumped (off|out|ashore)|waded|disembark\w*|climbed (out|onto the (shore|dock|pier))|walked (up|onto) the (beach|shore|dock|pier)|tied (the|their) boat)\b/i;
const LAMP_WORK = /\b(lit|light(ed|s|ing)?|kindled|tended|trimmed|polished|filled|kept)\b[^.]{0,30}\b(lamp|lantern|light|flame|beam)\b|\b(lamp room|lantern room|great lamp|the lamp)\b/i;
const TOY = /\b(toy|model|miniature|tiny|paper|little wooden)\b/i;
const smallVessel = (b) => (b.dimensions?.height ?? 3.3) < 1.5;                                  // nobody stands in a thing smaller than a person
const STAIRS = /\b(stairs?|stairway|steps|climb\w*|spiral)\b/i;

export function applyRelations(spec, note) {
  const crews = new Map();                                              // boat id -> [subject copies]
  (spec.lines ?? []).forEach((line, li) => {
    const say = line.say ?? "";
    (line.shots ?? []).forEach((shot, si) => {
      const where = `line ${li} shot ${si}`, props = shot.props ?? [], subs = shot.subjects ?? [];
      // ---- a boat needs water
      if (props.some((p) => p.kind === "boat") && !WATER.includes(shot.place) && !["custom", "interior"].includes(shot.place)) { note(where, `a boat needs water: "${shot.place}" -> shore`); shot.place = "shore"; }
      // ---- the lighthouse's two rooms
      if (shot.place === "interior" && ["lighthouse", undefined].includes(shot.room)) {
        const climbing = subs.some((s) => s.pose === "climb") || STAIRS.test(say) && !LAMP_WORK.test(say);
        if (!climbing && (props.some((p) => p.kind === "lamp") || LAMP_WORK.test(say)) && shot.room === "lighthouse") { note(where, `room "lighthouse" (the stairwell) -> "lantern" (the lamp room: the lamp is lit and tended there)`); shot.room = "lantern"; }
      }
      // ---- a toy is not the real thing: when the story's boat is a toy (a custom object), a second, full-size boat is the director's duplicate and goes
      { const toy = props.find((p) => p.kind === "custom" && /boat|ship|sail/i.test(`${p.id ?? ""} ${p.describe ?? ""}`) && TOY.test(`${p.id ?? ""} ${p.describe ?? ""}`));
        const real = props.findIndex((p) => p.kind === "boat" && !p.id);
        if (toy && real >= 0) { props.splice(real, 1); note(where, `a toy boat ("${toy.id ?? toy.describe}") and a full-size boat in one shot: the story's boat is the toy one, the full-size boat is removed`); } }
      // ---- vessel crew
      for (const boat of props.filter((p) => p.kind === "boat" && !smallVessel(p))) {
        const key = boat.id ?? "boat", bx = boat.x ?? 0.5, near = (s) => !s.on && Math.abs((s.x ?? 0.5) - bx) < NEAR;
        const mine = (s) => s.aboard === key || s.aboard === true;
        if (!crews.has(key)) {
          const crew = subs.filter((s) => mine(s) || (s.aboard === undefined && near(s)));
          crews.set(key, crew.map((s) => structuredClone(s)));
          for (const s of subs) s.aboard = crew.includes(s) ? key : (s.aboard ?? false);
          if (crew.length) note(where, `${crew.length} aboard "${key}" (${crew.map((s) => s.who ?? "someone").join(", ")}): the same crew stays aboard from here`);
          continue;
        }
        const crew = crews.get(key);
        crew.forEach((c, k) => {
          let s = subs.find((x) => c.who && x.who === c.who);
          if (!s) { s = { ...structuredClone(c), pose: "hold", x: Math.min(0.95, Math.max(0.05, bx + (k - (crew.length - 1) / 2) * 0.08)) }; delete s.mood; subs.push(s); shot.subjects = subs; note(where, `"${c.who ?? "the crew member"}" was aboard "${key}" before: back aboard`); }
          s.aboard = key;
        });
        for (const s of subs) if (!crew.some((c) => c.who && c.who === s.who) && s.aboard === undefined) { s.aboard = false; if (near(s)) note(where, `${s.who ?? "someone"} is not part of "${key}"'s crew: on the shore, not aboard`); }
      }
    });
    if (LANDED.test(say)) crews.clear();                                  // the words put the crew ashore: they are free to walk from here
  });
}
