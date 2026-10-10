/**
 * Undo history with branches. States are treated as immutable snapshots.
 *
 * `entries[0]` is the initial state; `index` points at the present. Committing after an undo discards
 * the redo tail into a *branch* instead of losing it, and a branch can be switched back to later.
 * A drag is one step: the store keeps the live state outside the history until `commit`.
 */

export type HistoryEntry<T> = { id: number; label: string; state: T };
export type HistoryBranch<T> = { id: number; parentId: number; label: string; entries: HistoryEntry<T>[] };

export class History<T> {
  entries: HistoryEntry<T>[];
  index = 0;
  branches: HistoryBranch<T>[] = [];
  readonly limit: number;
  #nextId = 1;
  #nextBranchId = 1;

  constructor(initial: T, limit = 80) {
    this.limit = limit;
    this.entries = [{ id: 0, label: "Open project", state: initial }];
  }

  get present(): T { return this.entries[this.index]!.state; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  get undoLabel() { return this.canUndo ? this.entries[this.index]!.label : null; }
  get redoLabel() { return this.canRedo ? this.entries[this.index + 1]!.label : null; }

  /** Record `state` as the new present. Any redo tail becomes a branch. */
  commit(label: string, state: T): void {
    const tail = this.entries.splice(this.index + 1);
    if (tail.length) this.branches.push({ id: this.#nextBranchId++, parentId: this.entries[this.index]!.id, label: tail[0]!.label, entries: tail });
    this.entries.push({ id: this.#nextId++, label, state });
    this.index = this.entries.length - 1;
    this.#trim();
  }

  undo(): { label: string; state: T } | null {
    if (!this.canUndo) return null;
    const label = this.entries[this.index]!.label;
    this.index--;
    return { label, state: this.present };
  }

  redo(): { label: string; state: T } | null {
    if (!this.canRedo) return null;
    this.index++;
    return { label: this.entries[this.index]!.label, state: this.present };
  }

  /** Make a branch current. The tail it replaces is kept as a new branch, so nothing is lost. */
  switchBranch(branchId: number): T | null {
    const at = this.branches.findIndex((b) => b.id === branchId);
    if (at < 0) return null;
    const branch = this.branches[at]!;
    const parentIndex = this.entries.findIndex((e) => e.id === branch.parentId);
    if (parentIndex < 0) return null;
    this.branches.splice(at, 1);
    const tail = this.entries.splice(parentIndex + 1);
    if (tail.length) this.branches.push({ id: this.#nextBranchId++, parentId: branch.parentId, label: tail[0]!.label, entries: tail });
    this.entries.push(...branch.entries);
    this.index = this.entries.length - 1;
    return this.present;
  }

  /** Jump to any entry in the current line (the History tab). */
  jumpTo(index: number): T | null {
    if (index < 0 || index >= this.entries.length) return null;
    this.index = index;
    return this.present;
  }

  #trim() {
    // Keep `limit` undo steps. Branches whose parent was trimmed away can no longer be re-attached.
    while (this.entries.length > this.limit + 1) { this.entries.shift(); this.index--; }
    const alive = new Set(this.entries.map((e) => e.id));
    this.branches = this.branches.filter((b) => alive.has(b.parentId));
  }
}
