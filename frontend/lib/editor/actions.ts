/**
 * One registry of editor actions. The top bar, menus, context menus, keyboard handler and the ⌘K
 * palette all read from here, so a shortcut is defined once and the palette always shows it.
 */

export type ActionDef = {
  id: string;
  group: string;
  label: string;
  /** Shortcut in `Mod+Shift+D` form. `Mod` is ⌘ on macOS and Ctrl elsewhere. */
  shortcut?: string;
  /** Hidden from the palette when this returns false, and ignored by the key handler. */
  enabled?: () => boolean;
  run: () => void;
};

export type KeyLike = { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

type Parsed = { mod: boolean; shift: boolean; alt: boolean; key: string };

export function parseShortcut(shortcut: string): Parsed {
  const parts = shortcut.split("+");
  const key = parts.pop()!.toLowerCase();
  const names = new Set(parts.map((p) => p.toLowerCase()));
  return { mod: names.has("mod"), shift: names.has("shift"), alt: names.has("alt"), key };
}

const KEY_ALIASES: Record<string, string> = { " ": "space", arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down", escape: "esc", backspace: "backspace", delete: "delete" };

/** Does this key event trigger `shortcut`? Modifiers must match exactly. */
export function matchesShortcut(event: KeyLike, shortcut: string, isMac: boolean): boolean {
  const want = parseShortcut(shortcut);
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (want.mod !== mod || want.shift !== event.shiftKey || want.alt !== event.altKey) return false;
  const raw = event.key.toLowerCase();
  const key = KEY_ALIASES[raw] ?? raw;
  // Alt changes the produced character on macOS, so letters are compared by physical key then.
  const fromCode = event.altKey && event.code?.startsWith("Key") ? event.code.slice(3).toLowerCase() : null;
  return (fromCode ?? key) === want.key;
}

const MAC_GLYPH: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", left: "←", right: "→", up: "↑", down: "↓", backspace: "⌫", delete: "⌦", esc: "Esc", space: "Space", enter: "↵" };
const PC_GLYPH: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", left: "←", right: "→", up: "↑", down: "↓", backspace: "⌫", delete: "Del", esc: "Esc", space: "Space", enter: "Enter" };

export function formatShortcut(shortcut: string, isMac: boolean): string {
  const glyphs = isMac ? MAC_GLYPH : PC_GLYPH;
  const parts = shortcut.split("+").map((p) => p.toLowerCase());
  const mapped = parts.map((p) => glyphs[p] ?? (p.length === 1 ? p.toUpperCase() : p.toUpperCase()));
  return isMac ? mapped.join("") : mapped.join("+");
}

export class ActionRegistry {
  readonly #actions = new Map<string, ActionDef>();

  register(...defs: ActionDef[]): this {
    for (const def of defs) {
      if (this.#actions.has(def.id)) throw new Error(`Duplicate action: ${def.id}`);
      this.#actions.set(def.id, def);
    }
    return this;
  }

  get(id: string) { return this.#actions.get(id); }
  all() { return [...this.#actions.values()]; }

  run(id: string): boolean {
    const def = this.#actions.get(id);
    if (!def || def.enabled?.() === false) return false;
    def.run();
    return true;
  }

  /** The first enabled action bound to this key event, or undefined. */
  match(event: KeyLike, isMac: boolean): ActionDef | undefined {
    return this.all().find((a) => a.shortcut && a.enabled?.() !== false && matchesShortcut(event, a.shortcut, isMac));
  }

  /** Palette search: every word must appear in the label or group. Empty query lists all, grouped order kept. */
  search(query: string): ActionDef[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.all().filter((a) => a.enabled?.() !== false && words.every((w) => `${a.group} ${a.label}`.toLowerCase().includes(w)));
  }

  /** Shortcut collisions, so tests (and dev builds) can fail loudly on a duplicate binding. */
  conflicts(): [string, string][] {
    const seen = new Map<string, string>();
    const out: [string, string][] = [];
    for (const a of this.all()) {
      if (!a.shortcut) continue;
      const p = parseShortcut(a.shortcut);
      const sig = `${p.mod}${p.shift}${p.alt}${p.key}`;
      const other = seen.get(sig);
      if (other) out.push([other, a.id]);
      else seen.set(sig, a.id);
    }
    return out;
  }
}
