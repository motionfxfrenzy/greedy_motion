/**
 * Editor state. One zustand store with two kinds of fields:
 *  - `doc` is the undoable document. It changes only through edit() or begin() / update() / commit() / cancel(),
 *    so a drag is one history step and Esc restores the state it started from.
 *  - everything else is UI state (selection, playhead, panel sizes, modals) and is never undoable.
 */
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { History } from "./history.ts";
import { pick, type KeyRef, type Mods } from "./selection.ts";
import { clamp, snapToFrame } from "./time.ts";
import type { CheckIssue, EditorDoc, EditorMode, Job } from "./types.ts";

export type Modal = null | "palette" | "bridge" | "keys" | "open" | "saveas" | "publish" | "player";
export type EngineState = "ready" | "updating" | "rendering" | "stopped";
export type AgentState = "idle" | "thinking" | "proposed";
export type LeftTab = "layers" | "comps" | "assets" | "library" | "history" | "clips";
export type RightTab = "properties" | "source" | "variables" | "review" | "checks";
/** A project opened from the backend (not the demo): where its composition is saved, and the last revision we hold. */
export type RemoteState = { projectId: string; rev: number; entry: string; status: "idle" | "saving" | "error" | "conflict" | "readonly"; /** URL of the preview frame shell, on the backend's origin. */ frameSrc: string };
export type MenuState = null | { kind: "project" | "layer"; x: number; y: number; id?: string };

export type EditorState = {
  doc: EditorDoc;
  /** Bumps on every history change so views over History re-render. */
  historyRev: number;
  mode: EditorMode;
  /** HyperFrames-only project: no mode switch, no bridge. */
  hfOnly: boolean;
  /** The caller's pro entitlement. Only pro users see the engine pill and mode switch. */
  pro: boolean;
  projectName: string;
  compName: string;
  duration: number;
  canvas: { width: number; height: number };
  fps: number;
  dirty: boolean;
  remote: RemoteState | null;
  /**
   * The plan has ended: the project opens for viewing only. Every change to the document is refused here, at the one
   * place edits go through, so no panel can forget to check. (The backend refuses writes as well; this is the interface.)
   */
  readOnly: boolean;

  /** Selected layers. The first is the primary one the inspector shows. */
  sel: string[];
  /** Selected clips (HTML clips mode); the first is the primary. */
  clipSel: string[];
  /** Selected keyframes, or the selected tween in HTML clips mode. */
  keySel: KeyRef[];
  /** Where a Shift-click range starts: the last item clicked without Shift. */
  anchor: string | null;
  t: number;
  playing: boolean;

  leftW: number; rightW: number; tlH: number; spW: number;
  leftOpen: boolean; leftFloat: boolean; rightOpen: boolean; tlOpen: boolean; speedOpen: boolean;
  leftTab: LeftTab; rightTab: RightTab;
  /** Speed graph edits every key of the property, not only the selected segment. */
  spAll: boolean;
  snapOn: boolean; rippleOn: boolean; safeOn: boolean; rulersOn: boolean;
  /** Timeline zoom: pixels per second. */
  pxPerSecond: number;
  grpClosed: Record<string, boolean>;

  engine: EngineState;
  frameStale: boolean;
  jobs: Job[];
  renderOpen: boolean;
  /** Final-render option chosen in the render popover. Previews never use it. */
  motionBlur: boolean;
  checks: CheckIssue[] | null;
  modal: Modal;
  theme: "light" | "dark";
  menu: MenuState;
  toast: { id: number; msg: string } | null;
  agent: { state: AgentState; q: string; open: boolean };
};

type Actions = {
  reset(init: Partial<EditorState> & { doc: EditorDoc }): void;
  ui(patch: Partial<EditorState>): void;
  setMode(mode: EditorMode): void;
  select(ids: string[], additive?: boolean): void;
  /** Click on a layer: plain replaces, ⌘ toggles, Shift selects the range in `order`. */
  pickLayer(id: string, order: readonly string[], mods: Mods): void;
  selectClip(id: string | null): void;
  pickClip(id: string, order: readonly string[], mods: Mods): void;
  selectClips(ids: string[]): void;
  selectKeys(refs: KeyRef[]): void;
  setT(t: number): void;
  say(msg: string): void;

  /** One-shot edit: clone, mutate, record one history step. */
  edit(label: string, fn: (draft: EditorDoc) => void): void;
  /** Transaction for drags: live updates, then one commit (or a cancel that restores the start). */
  begin(label: string): void;
  update(fn: (draft: EditorDoc) => void): void;
  /** Like update(), but applied to the document as it was when the transaction began (absolute, not cumulative, drags). */
  updateFromBase(fn: (draft: EditorDoc) => void): void;
  commit(): void;
  cancel(): void;
  inTransaction(): boolean;
  /** Replace the document without recording history (a load from the server). */
  load(doc: EditorDoc): void;

  undo(): void;
  redo(): void;
  jumpTo(index: number): void;
  switchBranch(id: number): void;
  history(): History<EditorDoc>;
  markEngineBusy(): void;
};

const EMPTY_DOC: EditorDoc = { layers: [], html: "", markers: [], workArea: [0, 12], comments: [], vars: {} };

let history = new History<EditorDoc>(EMPTY_DOC, 80);
let txBase: { doc: EditorDoc; label: string } | null = null;
let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let engineTimer: ReturnType<typeof setTimeout> | null = null;

const initial: EditorState = {
  doc: EMPTY_DOC, historyRev: 0, mode: "layers", hfOnly: false, pro: true,
  projectName: "Untitled", compName: "main", duration: 12, canvas: { width: 1920, height: 1080 }, fps: 30, dirty: false, remote: null, readOnly: false,
  sel: [], clipSel: [], keySel: [], anchor: null, t: 0, playing: false,
  leftW: 328, rightW: 336, tlH: 290, spW: 380,
  leftOpen: true, leftFloat: false, rightOpen: true, tlOpen: true, speedOpen: false,
  leftTab: "layers", rightTab: "properties", spAll: false,
  snapOn: true, rippleOn: false, safeOn: false, rulersOn: false,
  pxPerSecond: 64, grpClosed: {},
  engine: "ready", frameStale: false, jobs: [], renderOpen: false, motionBlur: false, checks: null,
  modal: null, theme: "light", menu: null, toast: null, agent: { state: "idle", q: "", open: false }
};

export const useEditor = create<EditorState & Actions>((set, get) => {
  const bump = () => set((s) => ({ historyRev: s.historyRev + 1 }));
  const refused = () => {
    if (!get().readOnly) return false;
    get().say("This project is view-only: your Pro plan has ended.");
    return true;
  };
  const markBusy = () => {
    set({ engine: get().engine === "stopped" ? "stopped" : "updating", frameStale: true, dirty: true });
    if (engineTimer) clearTimeout(engineTimer);
    // Placeholder latency; a real adapter clears this when its frame lands.
    engineTimer = setTimeout(() => { if (get().engine === "updating") set({ engine: "ready", frameStale: false }); }, 450);
  };

  return {
    ...initial,

    reset(init) {
      history = new History(init.doc, 80);
      txBase = null;
      set({ ...initial, ...init, historyRev: 0 });
    },
    ui(patch) { set(patch); },
    setMode(mode) {
      if (get().hfOnly && mode === "layers") return;
      set({ mode, sel: [], clipSel: [], keySel: [], anchor: null, leftTab: mode === "clips" ? "clips" : "layers", rightTab: "properties", speedOpen: false });
    },
    select(ids, additive = false) {
      const s = get();
      set({ sel: additive ? (ids.every((i) => s.sel.includes(i)) ? s.sel.filter((i) => !ids.includes(i)) : [...new Set([...s.sel, ...ids])]) : ids, keySel: [], anchor: ids[0] ?? null });
    },
    pickLayer(id, order, mods) { const r = pick(get().sel, get().anchor, id, order, mods); set({ sel: r.ids, anchor: r.anchor, keySel: [] }); },
    selectClip(id) { set({ clipSel: id ? [id] : [], keySel: [], anchor: id }); },
    pickClip(id, order, mods) { const r = pick(get().clipSel, get().anchor, id, order, mods); set({ clipSel: r.ids, anchor: r.anchor, keySel: [] }); },
    selectClips(ids) { set({ clipSel: ids, keySel: [] }); },
    selectKeys(refs) { set({ keySel: refs }); },
    setT(t) {
      const next = clamp(snapToFrame(t, get().fps), 0, get().duration);
      if (next !== get().t) set({ t: next });
    },
    say(msg) {
      if (toastTimer) clearTimeout(toastTimer);
      set({ toast: { id: ++toastId, msg } });
      toastTimer = setTimeout(() => set({ toast: null }), 2500);
    },

    edit(label, fn) {
      if (refused()) return;
      if (txBase) return; // a drag is in flight; the drag owns the history step
      const draft = structuredClone(get().doc);
      fn(draft);
      history.commit(label, draft);
      set({ doc: draft });
      bump();
      markBusy();
    },
    begin(label) { if (refused()) return; if (!txBase) txBase = { doc: get().doc, label }; },
    update(fn) {
      if (get().readOnly) return;
      const draft = structuredClone(get().doc);
      fn(draft);
      set({ doc: draft });
      markBusy();
    },
    updateFromBase(fn) {
      if (!txBase || get().readOnly) return;
      const draft = structuredClone(txBase.doc);
      fn(draft);
      set({ doc: draft });
      markBusy();
    },
    commit() {
      if (!txBase) return;
      const { doc, label } = { doc: get().doc, label: txBase.label };
      const changed = JSON.stringify(doc) !== JSON.stringify(txBase.doc);
      txBase = null;
      if (changed) { history.commit(label, doc); bump(); }
    },
    cancel() {
      if (!txBase) return;
      set({ doc: txBase.doc });
      txBase = null;
      markBusy();
    },
    inTransaction() { return txBase !== null; },
    load(doc) { history = new History(doc, 80); txBase = null; set({ doc, historyRev: 0, dirty: false }); },

    undo() {
      if (refused()) return;
      const step = history.undo();
      if (!step) return;
      set({ doc: step.state, keySel: [] });
      bump(); markBusy();
      get().say(`Undid ${step.label}.`);
    },
    redo() {
      if (refused()) return;
      const step = history.redo();
      if (!step) return;
      set({ doc: step.state });
      bump(); markBusy();
      get().say(`Redid ${step.label}.`);
    },
    jumpTo(index) { if (refused()) return; const doc = history.jumpTo(index); if (doc) { set({ doc }); bump(); markBusy(); } },
    switchBranch(id) { if (refused()) return; const doc = history.switchBranch(id); if (doc) { set({ doc }); bump(); markBusy(); get().say("Switched branch."); } },
    history() { return history; },
    markEngineBusy: markBusy
  };
});

export const selectUndoState = (s: EditorState) => ({ rev: s.historyRev });

const withoutPlayhead = ({ t: _t, ...rest }: EditorState & Actions) => rest;

/**
 * The whole editor state except the playhead. Panels use this instead of `useEditor()`: the playhead changes 30 times a second
 * during playback and must re-render only what shows time (the playhead, the canvas, animated property values), not every panel.
 */
export const useEditorState = () => useEditor(useShallow(withoutPlayhead));
