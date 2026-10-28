"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PAINTED_SCRIPT_MAX, PAINTED_SCRIPT_MIN, paintedSeconds, renderCostMillitokens, type RenderJob } from "@videosaas/contracts";
import { changePaintedFilm, createPaintedFilm, getPaintedFilm, getRenderJob, listPaintedFilms, listPaintedLooks, outputUrl, watchRenderJob, type PaintedFilm, type PaintedLookOption } from "../lib/api";
import { useMediaToken } from "../lib/use-media-token";
import { AppShell } from "./app-shell";

const STAGES: Record<string, string> = {
  queued: "Getting ready", planning: "Getting ready", waiting: "Waiting for a free artist", preparing: "Setting up the studio",
  directing: "Writing the scenes", objects: "Drawing the props and places", voice: "Recording the narrator", music: "Composing the music",
  painting: "Drawing the film", frames: "Drawing the film", encoding: "Finishing the video", retrying: "Trying again"
};

/** What the person sees of a look: its sample frame (shipped with the app) and name. */
const lookMedium = (id: string) => id.split(":")[1] ?? id;

/**
 * The Story film page: a script, a look, one button. The look decides which drawing engine makes the film; the person
 * only ever picks a look. A finished film can be changed by commenting on a scene: only that scene is redrawn.
 */
export function FilmPage() {
  useMediaToken();
  const params = useSearchParams();
  const [looks, setLooks] = useState<PaintedLookOption[]>([]);
  const [limits, setLimits] = useState({ min: PAINTED_SCRIPT_MIN, max: PAINTED_SCRIPT_MAX });
  const [look, setLook] = useState(params.get("look") ?? "doodle:marker");
  const [script, setScript] = useState("");
  const [edited, setEdited] = useState(false);
  const [continuous, setContinuous] = useState(true);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [film, setFilm] = useState<PaintedFilm | null>(null);
  const [films, setFilms] = useState<PaintedFilm[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState<Record<number, string>>({});
  const watching = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    // A request cut off by a page change or a dropped connection is tried again, a few times, before the person sees an error.
    const retry = async <T,>(load: () => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        try { return await load(); } catch (e) { if (!live || attempt >= 3) throw e; await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); }
      }
    };
    retry(listPaintedLooks).then((result) => { if (live) { setLooks(result.looks); setLimits({ min: result.scriptMin, max: result.scriptMax }); } }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Could not load the looks."); });
    retry(listPaintedFilms).then((list) => { if (live) setFilms(list); }).catch(() => undefined);
    return () => { live = false; watching.current?.abort(); };
  }, []);

  const chosen = looks.find((entry) => entry.id === look) ?? looks.find((entry) => entry.available);
  // The sample script follows the look until the person writes their own.
  useEffect(() => { if (chosen && !edited) setScript(chosen.script); }, [chosen, edited]);

  const seconds = useMemo(() => paintedSeconds(script), [script]);
  const tokens = renderCostMillitokens(seconds) / 1000;
  const working = Boolean(job) && job!.state !== "ready" && job!.state !== "failed";

  const follow = useCallback(async (id: string) => {
    watching.current?.abort();
    const abort = new AbortController();
    watching.current = abort;
    const finished = async (last: RenderJob) => {
      setJob(last);
      if (last.state === "ready") setFilm(await getPaintedFilm(id).catch(() => null));
      else setError(last.error?.message ?? "The film could not be made. Your tokens were returned.");
      listPaintedFilms().then(setFilms).catch(() => undefined);
    };
    try {
      await finished(await watchRenderJob(id, setJob, abort.signal));
    } catch {
      // The stream dropped: poll until the job settles.
      for (let i = 0; i < 240 && !abort.signal.aborted; i++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const next = await getRenderJob(id).catch(() => null);
        if (next) { setJob(next); if (next.state === "ready" || next.state === "failed") { await finished(next); return; } }
      }
    }
  }, []);

  const start = async () => {
    if (!chosen) return;
    setBusy(true); setError(""); setFilm(null); setComments({});
    try {
      const created = await createPaintedFilm({ script, look: chosen.id, drawIn: continuous ? "opening" : "each" });
      setJob(created);
      void follow(created.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the film."); }
    finally { setBusy(false); }
  };

  const open = async (entry: PaintedFilm) => {
    setError(""); setComments({}); setFilm(null); setJob(null);
    if (entry.state === "ready") { setFilm(entry); setJob({ id: entry.id, state: "ready", progress: 100, createdAt: entry.createdAt, revision: { id: entry.id, title: "Story film", scenes: [] }, output: { url: `/v1/renders/${entry.id}`, format: "mp4", durationSeconds: entry.durationSeconds ?? 60 } } as RenderJob); }
    else if (entry.state === "failed") setError(entry.error ?? "That film could not be made.");
    else { setJob({ id: entry.id, state: entry.state, stage: entry.stage, progress: entry.progress } as RenderJob); void follow(entry.id); }
  };

  const applyChanges = async () => {
    if (!film) return;
    const list = Object.entries(comments).map(([line, text]) => ({ line: Number(line), text: text.trim() })).filter((entry) => entry.text.length >= 3);
    if (!list.length) return;
    setBusy(true); setError("");
    try {
      const created = await changePaintedFilm(film.id, list);
      setFilm(null); setComments({}); setJob(created);
      void follow(created.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply the changes."); }
    finally { setBusy(false); }
  };

  const pending = Object.values(comments).filter((text) => text.trim().length >= 3).length;
  const group = (engine: "doodle" | "oil") => looks.filter((entry) => entry.engine === engine);

  return <AppShell active="templates"><section className="page-container film-page">
    <div className="page-heading"><div><h1>Story film</h1><p>Write a short story. Pick how it is drawn. A narrated film comes back in a few minutes.</p></div></div>
    {error && <div className="workspace-error" role="alert">{error}</div>}

    {!working && !film && <div className="film-layout">
      <div className="film-form">
        <label className="panel-label" htmlFor="film-script">Your story, one sentence per line (the narrator reads it word for word)</label>
        <textarea id="film-script" className="script-prompt" rows={9} value={script} maxLength={limits.max} onChange={(event) => { setScript(event.target.value); setEdited(true); }} />
        <div className="prompt-actions"><span>{script.trim().length < limits.min ? `At least ${limits.min} characters` : `About ${seconds} seconds · ${tokens} tokens`}</span></div>
        {chosen?.engine === "doodle" && <label className="script-check"><input type="checkbox" checked={continuous} onChange={(event) => setContinuous(event.target.checked)} /> One continuous scene <small>(uncheck to draw every scene again at each cut)</small></label>}
        <button type="button" className="primary-button" disabled={busy || !chosen?.available || script.trim().length < limits.min} aria-busy={busy} onClick={() => void start()}>{busy ? "Starting…" : `Make the film · ${tokens} tokens`}</button>
      </div>
      <div className="film-looks">
        {(["doodle", "oil"] as const).map((engine) => group(engine).length > 0 && <div key={engine}>
          <h2>{engine === "doodle" ? "Hand-drawn looks" : "Painted looks"}</h2>
          <div className="film-look-grid">{group(engine).map((entry) => <button key={entry.id} type="button" disabled={!entry.available} className={`film-look${entry.id === chosen?.id ? " selected" : ""}`} aria-pressed={entry.id === chosen?.id} onClick={() => setLook(entry.id)} title={entry.available ? entry.blurb : "Coming soon"}>
            <img src={`/painted/${lookMedium(entry.id)}.jpg`} alt="" loading="lazy" width={90} height={160} />
            <b>{entry.name}</b><small>{entry.available ? entry.blurb : "Coming soon"}</small>
          </button>)}</div>
        </div>)}
      </div>
    </div>}

    {working && <div className="film-progress" role="status" aria-live="polite">
      <b>{STAGES[job?.stage ?? "queued"] ?? "Working"}…</b>
      <progress max={100} value={job?.progress ?? 5} />
      <small>This takes a few minutes. You can leave this page; the film appears under "Your films".</small>
    </div>}

    {film && job?.output && <div className="film-result">
      <video src={outputUrl(job.output.url)} controls playsInline className="film-video" />
      <div className="film-scenes">
        <h2>Change a scene</h2>
        <p>Comment on a scene, for example “they should be inside the house”. Only that scene is drawn again (1 token each).</p>
        {(film.lines ?? []).map((line, index) => <div key={index} className="film-scene"><span>{line}</span><input type="text" maxLength={300} placeholder="What should change?" value={comments[index] ?? ""} onChange={(event) => setComments((current) => ({ ...current, [index]: event.target.value }))} /></div>)}
        <div className="film-actions">
          <button type="button" className="primary-button" disabled={busy || pending === 0 || pending > 5} onClick={() => void applyChanges()}>{pending ? `Apply ${pending} change${pending > 1 ? "s" : ""} · ${pending} token${pending > 1 ? "s" : ""}` : "Apply changes"}</button>
          <button type="button" className="secondary-button" onClick={() => { setFilm(null); setJob(null); }}>Make another film</button>
        </div>
      </div>
    </div>}

    {films.length > 0 && <div className="film-history"><h2>Your films</h2><ul>{films.map((entry) => <li key={entry.id}><button type="button" className="secondary-button" onClick={() => void open(entry)}>{looks.find((l) => l.id === entry.look)?.name ?? entry.look} · {entry.script.split("\n")[0]?.slice(0, 48) || "Story film"} · {entry.state === "ready" ? "ready" : entry.state === "failed" ? "failed" : "in progress"}</button></li>)}</ul></div>}
  </section></AppShell>;
}
