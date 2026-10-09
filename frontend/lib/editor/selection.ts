/**
 * Selection rules shared by layers, clips and keyframes. Pure, so the same behaviour backs the layer list, the timeline,
 * the canvas and the keyboard:
 *  - click replaces the selection,
 *  - ⌘ / Ctrl-click adds or removes one item,
 *  - Shift-click selects the range from the anchor (the last plain or ⌘ click) to the item, in the order the user sees,
 *  - dragging a rectangle selects what it touches (⌘ / Shift keeps the current selection too).
 * The first id is the primary: the inspector shows it.
 */

export type Mods = { range?: boolean; toggle?: boolean };
export type KeyRef = { id: string; prop: string; t: number };
export type Box = { l: number; t: number; r: number; b: number };

export const modsOf = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): Mods => ({ range: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
export const isAdditive = (m: Mods) => Boolean(m.range || m.toggle);

const uniq = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** The selection after clicking `id`. `order` is the visible order of every selectable item. */
export function pick(current: readonly string[], anchor: string | null, id: string, order: readonly string[], mods: Mods): { ids: string[]; anchor: string | null } {
  if (mods.range) {
    const from = anchor && order.includes(anchor) ? anchor : current.find((c) => order.includes(c)) ?? id;
    const a = order.indexOf(from);
    const b = order.indexOf(id);
    if (a < 0 || b < 0) return { ids: [id], anchor: id };
    const span = a <= b ? order.slice(a, b + 1) : order.slice(b, a + 1).reverse();
    return { ids: mods.toggle ? uniq([...current, ...span]) : span, anchor: from };
  }
  if (mods.toggle) {
    const ids = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    return { ids, anchor: id };
  }
  return { ids: [id], anchor: id };
}

/** The selection after a rectangle touched `hit`. Additive keeps what was selected before the drag. */
export function withRect(before: readonly string[], hit: readonly string[], additive: boolean): string[] {
  return additive ? uniq([...before, ...hit]) : [...hit];
}

export const intersects = (a: Box, b: Box) => a.l <= b.r && a.r >= b.l && a.t <= b.b && a.b >= b.t;
export const boxOf = (x0: number, y0: number, x1: number, y1: number): Box => ({ l: Math.min(x0, x1), r: Math.max(x0, x1), t: Math.min(y0, y1), b: Math.max(y0, y1) });

// ---- keyframes

export const sameKey = (a: KeyRef, b: KeyRef) => a.id === b.id && a.prop === b.prop && Math.abs(a.t - b.t) < 1e-6;
export const hasKey = (refs: readonly KeyRef[], ref: KeyRef) => refs.some((r) => sameKey(r, ref));

/** Click on a key: plain replaces, ⌘ toggles, Shift adds. Keys have no linear order, so Shift behaves like ⌘ but never removes. */
export function pickKey(current: readonly KeyRef[], ref: KeyRef, mods: Mods): KeyRef[] {
  if (mods.toggle) return hasKey(current, ref) ? current.filter((r) => !sameKey(r, ref)) : [...current, ref];
  if (mods.range) return hasKey(current, ref) ? [...current] : [...current, ref];
  return [ref];
}

export function mergeKeys(before: readonly KeyRef[], hit: readonly KeyRef[], additive: boolean): KeyRef[] {
  if (!additive) return [...hit];
  const out = [...before];
  for (const ref of hit) if (!hasKey(out, ref)) out.push(ref);
  return out;
}

export const keyId = (r: KeyRef) => `${r.id}|${r.prop}|${Math.round(r.t * 1000)}`;
