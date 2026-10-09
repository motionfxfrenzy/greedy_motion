/**
 * Autosave for a project opened from the backend. The composition HTML is written against the revision we hold; a
 * 409 means another tab or session changed it, so saving stops and the user is told, rather than overwriting it.
 * Saves are serialised (one in flight), and edits made while one is in flight go out in the next.
 */
import { readClips } from "./clips-model.ts";
import { useEditor } from "./store.ts";

export type WriteFiles = (projectId: string, baseRev: number, files: { path: string; content: string }[]) => Promise<{ rev: number }>;

const status = (error: unknown) => (error as { status?: number } | null)?.status;
const codeOf = (error: unknown) => (error as { code?: string } | null)?.code;

export function createAutosave(write: WriteFiles, delayMs = 800) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let saved: string | null = null;
  let unsubscribe: (() => void) | null = null;

  const state = () => useEditor.getState();
  const setRemote = (patch: Partial<NonNullable<ReturnType<typeof state>["remote"]>>) => { const r = state().remote; if (r) state().ui({ remote: { ...r, ...patch } }); };

  async function once(): Promise<void> {
    const remote = state().remote;
    if (!remote || remote.status === "conflict" || remote.status === "readonly") return;
    const html = state().doc.html;
    if (html === saved) { state().ui({ dirty: false }); return; }
    setRemote({ status: "saving" });
    try {
      const result = await write(remote.projectId, remote.rev, [{ path: remote.entry, content: html }]);
      saved = html;
      setRemote({ rev: result.rev, status: "idle" });
      state().ui({ dirty: state().doc.html !== html });
    } catch (error) {
      if (status(error) === 403 && codeOf(error) === "read_only") {
        // The plan ended while the editor was open. Keep what is on screen, stop saving, and say so; nothing is lost on the server.
        setRemote({ status: "readonly" });
        state().ui({ readOnly: true });
        state().say("Your Pro plan has ended, so this project is now view-only. Your last edit was not saved.");
      } else if (status(error) === 409) {
        setRemote({ status: "conflict" });
        state().say("This project changed somewhere else. Reload to continue; nothing was overwritten.");
      } else {
        setRemote({ status: "error" });
        state().say(error instanceof Error ? error.message : "Could not save. Trying again shortly.");
        schedule(5000);
      }
    }
  }

  async function run(): Promise<void> {
    while (state().remote && state().remote!.status !== "conflict" && state().remote!.status !== "readonly" && state().doc.html !== saved) {
      if (inFlight) { await inFlight; continue; }
      inFlight = once().finally(() => { inFlight = null; });
      await inFlight;
      if (state().remote?.status === "error") return; // retried by the timer
    }
  }

  function schedule(ms = delayMs) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void run(); }, ms);
  }

  return {
    /** Start watching the document. `initial` is the HTML already on the server. */
    attach(initial: string) {
      saved = initial;
      unsubscribe = useEditor.subscribe((s, prev) => {
        if (!s.remote || s.doc.html === prev.doc.html) return;
        // Duration and canvas follow the composition's own root attributes.
        const model = readClips(s.doc.html);
        if (model.duration !== s.duration || model.canvas.width !== s.canvas.width || model.canvas.height !== s.canvas.height) s.ui({ duration: model.duration || s.duration, canvas: model.canvas });
        schedule();
      });
    },
    /** Save now. Resolves true when the server holds the editor's current document. */
    async flush(): Promise<boolean> {
      if (timer) { clearTimeout(timer); timer = null; }
      await run();
      return state().doc.html === saved;
    },
    dispose() { if (timer) clearTimeout(timer); unsubscribe?.(); unsubscribe = null; }
  };
}

export type Autosave = ReturnType<typeof createAutosave>;

let active: Autosave | null = null;
/** The autosave of the project currently open, so commands (Save, Render, Check) can flush it first. */
export const setActiveAutosave = (autosave: Autosave | null) => { active = autosave; };
export const activeAutosave = () => active;
