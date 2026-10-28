/** Resolve reusable story objects before linting or paying for assets. No language heuristics. */
export function expandSceneGraph(spec, notes = []) {
  const objects = new Map(Object.entries(spec.objects ?? {}).map(([id, value]) => [id, { ...value, id }]));
  // Inline definitions can be referenced by later shots, too.
  for (const line of spec.lines ?? []) for (const shot of line.shots ?? [])
    for (const p of shot.props ?? []) if (p.id && p.kind && !objects.has(p.id)) objects.set(p.id, { ...p });
  const stable = ["kind", "describe", "dimensions", "surface", "style", "color", "shape", "tether"];
  // State is advanced only by explicit story events, never by camera overrides.
  const state = new Map(), people = new Map();
  const appearance = ["heightM", "age", "build", "hair", "hairColor", "skin", "top", "bottom", "dress", "extras"];

  for (const [li, line] of (spec.lines ?? []).entries()) {
    if (line.detail) {
      const { object, shot: index = 0 } = line.detail;
      const source = line.shots?.[index];
      // A director's mistake never aborts the film: what cannot be honoured is dropped, and said so in the notes.
      if (!source || typeof object !== "string" || !objects.has(object)) { notes.push(`line ${li}: dropped a detail request that names no known object or shot`); delete line.detail; }
      else if (!line.shots.some(s => s.detailOf === object)) {
        if (line.shots.length >= 3) notes.push(`line ${li}: no room for a detail shot of "${object}": skipped`);
        else {
        const close = structuredClone(source);
        close.framing = "close"; close.detailOf = object;
        close.required = [...new Set([...(close.required ?? []), object])];
        delete close.changes;
        line.shots.splice(index + 1, 0, close);
        notes.push(`line ${li}: added close shot for "${object}"`);
        }
      }
    }
  }
  for (const [li, line] of (spec.lines ?? []).entries()) for (const [si, shot] of (line.shots ?? []).entries()) {
    for (const person of shot.subjects ?? []) if (person.who) {
      const identity = people.get(person.who) ?? {};
      for (const key of appearance) {
        if (identity[key] === undefined && person[key] !== undefined) identity[key] = structuredClone(person[key]);
        if (identity[key] !== undefined) person[key] = structuredClone(identity[key]);
      }
      people.set(person.who, identity);
    }
    const where = `line ${li} shot ${si}`, nodes = new Map(), order = [], visiting = new Set();
    for (const [id, change] of Object.entries(shot.changes ?? {})) {
      if (!objects.has(id) || !change || typeof change !== "object" || Array.isArray(change)) { notes.push(`${where}: ignored an invalid change for "${id}"`); continue; }
      // A director's near-miss must not abort the film: "description" is "describe", and a key the engine has no meaning for is dropped (and said so) rather than a crash.
      if (change.description !== undefined && change.describe === undefined) change.describe = change.description;
      delete change.description;
      for (const k of Object.keys(change)) if (![...stable, "on", "offset", "lit", "open", "finished", "done"].includes(k)) { console.warn(`· ${where}: dropped unsupported state "${k}" of "${id}"`); delete change[k]; }
      state.set(id, { ...state.get(id), ...structuredClone(change) });
    }
    const definitionFor = id => {
      if (!objects.has(id)) return undefined;
      const base = objects.get(id), change = state.get(id) ?? {};
      const definition = { ...structuredClone(base), ...structuredClone(change) };
      if (change.describe !== undefined && change.describe !== base.describe) delete definition.recipe;
      return definition;
    };
    const props = [...(shot.props ?? [])];
    for (const id of shot.required ?? []) {
      if (typeof id !== "string" || !objects.has(id)) { notes.push(`${where}: ignored unknown required object "${id}"`); continue; }
      if (!props.some(p => p.id === id)) props.push({ id });
    }
    for (const p of props) {
      if (p.id && nodes.has(p.id)) { notes.push(`${where}: ignored a second "${p.id}" in one shot`); continue; }
      const definition = definitionFor(p.id);
      if (p.id && !p.kind && !definition) { notes.push(`${where}: dropped unknown object "${p.id}"`); continue; }
      const node = { ...structuredClone(definition ?? {}), ...p };
      if (definition) for (const key of [...stable, ...Object.keys(state.get(p.id) ?? {})]) {
        if (definition[key] !== undefined) {
          if (p[key] !== undefined && JSON.stringify(p[key]) !== JSON.stringify(definition[key])) notes.push(`${where}: restored ${p.id}.${key} from story definition`);
          node[key] = structuredClone(definition[key]);
        }
      }
      if (p.recipe && p.describe !== undefined && p.describe !== node.describe) delete node.recipe;
      if (typeof node.kind !== "string" || !node.kind.trim() || ["undefined", "null"].includes(node.kind)) { notes.push(`${where}: dropped object "${p.id ?? "unnamed"}" without a valid kind`); continue; }
      nodes.set(p.id || node, node);
    }
    function visit(p) {
      if (order.includes(p)) return;
      if (visiting.has(p)) { notes.push(`${where}: broke a cyclic support at "${p.id}"`); delete p.on; return; }
      visiting.add(p);
      if (p.on != null && (typeof p.on !== "string" || !p.on)) { notes.push(`${where}: ignored an invalid "on"`); delete p.on; }
      if (p.on != null) {
        let parent = nodes.get(p.on);
        if (!parent) {
          const definition = definitionFor(p.on);
          if (!definition) { notes.push(`${where}: "${p.id || p.kind}" is not on "${p.on}" (no such object)`); delete p.on; }
          else { parent = structuredClone(definition); nodes.set(p.on, parent); notes.push(`${where}: restored support "${p.on}" for "${p.id || p.kind}"`); }
        }
        if (parent) visit(parent);
      }
      visiting.delete(p); order.push(p);
    }
    for (const p of nodes.values()) visit(p);
    for (const subject of shot.subjects ?? []) if (subject.on) {
      let support = nodes.get(subject.on);
      if (!support && objects.has(subject.on)) { support = definitionFor(subject.on); nodes.set(subject.on, support); }
      if (!support) { notes.push(`${where}: ${subject.who ?? "a person"} is not on "${subject.on}" (no such object)`); delete subject.on; continue; }
      visit(support);
    }
    for (const p of order) if (p.tether != null) {
      const link = p.tether;
      if (typeof link !== "object" || !link.who || !["left", "right"].includes(link.hand ?? "right")) { notes.push(`${where}: dropped an invalid tether on "${p.id}"`); delete p.tether; continue; }
      if (!(shot.subjects ?? []).some(s => s.who === link.who)) { notes.push(`${where}: dropped the tether of "${p.id}": holder "${link.who}" is not in the shot`); delete p.tether; continue; }
    }
    for (const person of shot.subjects ?? []) if (person.lookAt) {
      const target = nodes.get(person.lookAt);
      if (!target) { notes.push(`${where}: ${person.who ?? "a person"} looks at nothing known ("${person.lookAt}")`); delete person.lookAt; continue; }
      let root = target; while (root.on) root = nodes.get(root.on);
      const dx = (root.x ?? .5) - (person.x ?? .5);
      person.facing = Math.abs(dx) > .13 ? (dx > 0 ? "right" : "left") : (root.depth ?? 0) > (person.depth ?? 0) ? "back" : "front";
    }
    if (shot.framing === "close" && !shot.detailOf && !shot.portraitOf && (shot.subjects ?? []).length === 1 && shot.subjects[0].who) shot.portraitOf = shot.subjects[0].who;
    if (shot.portraitOf && !(shot.subjects ?? []).some(p => p.who === shot.portraitOf)) { notes.push(`${where}: dropped the portrait of "${shot.portraitOf}" (not in the shot)`); delete shot.portraitOf; }
    shot.props = order;
  }
  return spec;
}
