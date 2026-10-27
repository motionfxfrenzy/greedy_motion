"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { videoTypeLabels, videoTypes, wordBudget, type Pace, type ProjectScript, type ProjectScriptLine, type ProjectScreenshot, type VideoType } from "@videosaas/contracts";
import { projectScreenshotUrl } from "../lib/api";

const words = (text: string | undefined) => (text ?? "").trim().split(/\s+/).filter(Boolean).length;
const roleName = (line: ProjectScriptLine) => line.label;

/**
 * The written script as an editable document, before any storyboard exists: scene by scene, with the voiceover, the words
 * on screen, what the viewer sees and which screenshot is shown. Edits save as the person types; "ask for a change" rewrites
 * the whole script from an instruction; "Generate storyboard" builds the film from exactly this script.
 */
export function ScriptCanvas({ projectId, script, screenshots, durationSeconds, pace, busy, error, save, revise, setType, back, generate }: {
  projectId: string;
  script: ProjectScript;
  screenshots: ProjectScreenshot[];
  durationSeconds: number;
  pace: Pace;
  /** "revise": an instruction is being applied; "plan": the storyboard is being written. */
  busy: null | "revise" | "plan";
  error: string | null;
  save: (script: ProjectScript) => Promise<void>;
  revise: (instruction: string) => Promise<void>;
  setType: (type: VideoType) => Promise<void>;
  back: () => void;
  generate: (script: ProjectScript) => void;
}) {
  const [draft, setDraft] = useState<ProjectScript>(script);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const [instruction, setInstruction] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  latest.current = draft;
  // A rewrite from the server replaces what is on screen; the person's typing never does.
  const serverStamp = useRef(script.updatedAt);
  useEffect(() => { if (script.updatedAt !== serverStamp.current) { serverStamp.current = script.updatedAt; setDraft(script); setSaved("saved"); } }, [script]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const change = (next: ProjectScript) => {
    setDraft(next);
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(latest.current).then(() => setSaved("saved"), () => setSaved("error")); }, 700);
  };
  const edit = (index: number, patch: Partial<ProjectScriptLine>) => change({ ...draft, lines: draft.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) });
  const move = (index: number, by: -1 | 1) => { const lines = [...draft.lines]; const target = index + by; if (target < 0 || target >= lines.length) return; [lines[index], lines[target]] = [lines[target]!, lines[index]!]; change({ ...draft, lines }); };
  const remove = (index: number) => draft.lines.length > 1 && change({ ...draft, lines: draft.lines.filter((_, i) => i !== index) });
  const add = () => draft.lines.length < 12 && change({ ...draft, lines: [...draft.lines, { label: "Step", role: "step", onScreen: "New scene", voiceover: "", visual: "", screenshotId: null }] });

  const totalWords = draft.lines.reduce((sum, line) => sum + words(line.voiceover), 0);
  const budget = wordBudget(durationSeconds, pace);
  const used = useMemo(() => new Map(screenshots.map((shot) => [shot.id, draft.lines.map((line, i) => (line.screenshotId === shot.id ? i + 1 : 0)).filter(Boolean)])), [screenshots, draft.lines]);
  const unused = screenshots.filter((shot) => !(used.get(shot.id)?.length));
  const type = draft.videoType;
  const working = busy !== null;

  return <div className="flow-page script-canvas">
    <div className="flow-title"><h1>Your script</h1><p>Read it, change anything, and ask for bigger changes in plain words. The storyboard is built from exactly this.</p></div>
    <div className="sc-layout">
      <div className="sc-doc">
        <header className="sc-doc-head">
          <input className="sc-title" value={draft.title ?? ""} placeholder="Untitled script" maxLength={80} aria-label="Script title" onChange={(event) => change({ ...draft, title: event.target.value })} />
          <label className="sc-type"><span>Kind of film</span>
            <select value={type ?? "explainer"} disabled={working} onChange={(event) => void setType(event.target.value as VideoType)} aria-label="Kind of film">{videoTypes.map((id) => <option key={id} value={id}>{videoTypeLabels[id]}</option>)}</select>
          </label>
          <span className={"sc-save " + saved}>{saved === "saved" ? "All changes saved" : saved === "saving" ? "Saving…" : "Could not save"}</span>
        </header>
        <ol className={"sc-scenes" + (busy === "revise" ? " working" : "")}>
          {draft.lines.map((line, index) => {
            const shot = screenshots.find((item) => item.id === line.screenshotId);
            return <li key={index} className="sc-scene">
              <div className="sc-scene-head"><b>{index + 1}</b><span className={"bs-role " + (line.role ?? "")}>{roleName(line)}</span>
                <span className="sc-tools"><button type="button" aria-label={`Move scene ${index + 1} up`} disabled={index === 0 || working} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Move scene ${index + 1} down`} disabled={index === draft.lines.length - 1 || working} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`Delete scene ${index + 1}`} disabled={draft.lines.length < 2 || working} onClick={() => remove(index)}>✕</button></span></div>
              <label className="sc-field"><span>Voiceover <small>{words(line.voiceover)} words</small></span><textarea rows={2} value={line.voiceover ?? ""} maxLength={240} placeholder="Silent scene" onChange={(event) => edit(index, { voiceover: event.target.value })} /></label>
              {index === 0 && (draft.hooks?.length ?? 0) > 0 && <div className="sc-hooks" role="group" aria-label="Other ways to open"><span>Other ways to open</span>{draft.hooks!.filter((hook) => hook !== line.voiceover).map((hook) => <button type="button" key={hook} disabled={working} onClick={() => edit(0, { voiceover: hook })}>{hook}</button>)}</div>}
              <div className="sc-row">
                <label className="sc-field"><span>On screen</span><input value={line.onScreen} maxLength={60} onChange={(event) => edit(index, { onScreen: event.target.value })} /></label>
                <label className="sc-field wide"><span>What the viewer sees</span><input value={line.visual ?? ""} maxLength={240} placeholder="Describe the picture" onChange={(event) => edit(index, { visual: event.target.value })} /></label>
              </div>
              {screenshots.length > 0 && <div className="sc-shots" role="radiogroup" aria-label={`Screenshot for scene ${index + 1}`}>
                <button type="button" role="radio" aria-checked={!shot} className={!shot ? "selected none" : "none"} onClick={() => edit(index, { screenshotId: null })}>No screenshot</button>
                {screenshots.map((item) => <button type="button" role="radio" aria-checked={shot?.id === item.id} key={item.id} className={shot?.id === item.id ? "selected" : ""} title={item.analysis ? `${item.analysis.title}: ${item.analysis.summary}` : item.name} onClick={() => edit(index, { screenshotId: item.id })}><img src={projectScreenshotUrl(projectId, item.id)} alt="" /><span>{item.analysis?.title ?? item.name}</span></button>)}
              </div>}
            </li>;
          })}
        </ol>
        <button type="button" className="secondary-button sc-add" disabled={draft.lines.length >= 12 || working} onClick={add}>+ Add scene</button>
        <form className="sc-ask" onSubmit={(event) => { event.preventDefault(); const text = instruction.trim(); if (text.length >= 3 && !working) { void revise(text).then(() => setInstruction("")); } }}>
          <input value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={500} disabled={working} placeholder="Ask for a change: “make it shorter”, “add a scene about pricing”, “more playful”…" aria-label="Ask for a change to the script" />
          <button className="secondary-button" disabled={working || instruction.trim().length < 3}>{busy === "revise" ? "Rewriting…" : "Rewrite"}</button>
        </form>
      </div>
      <aside className="sc-side">
        <section className="ss-card">
          <header><b>Length</b><span>{totalWords} of about {budget} spoken words</span></header>
          <div className={"sc-meter" + (totalWords > budget * 1.1 ? " over" : "")}><i style={{ width: `${Math.min(100, (totalWords / Math.max(1, budget)) * 100)}%` }} /></div>
          <p className="sc-hint">{totalWords > budget * 1.1 ? "Longer than the film allows: the voice would run past the end. Trim a line, or ask for it shorter." : `${draft.lines.length} scenes for a ${durationSeconds}-second film.`}</p>
        </section>
        <section className="ss-card">
          <header><b>Post caption</b><span>Ready to paste with the video</span></header>
          <textarea className="sc-caption" rows={3} maxLength={400} value={draft.caption ?? ""} placeholder="A caption that names your product" aria-label="Post caption" onChange={(event) => change({ ...draft, caption: event.target.value })} />
        </section>
        {screenshots.length > 0 && <section className="ss-card">
          <header><b>What we understood</b><span>{screenshots.length} screenshot{screenshots.length === 1 ? "" : "s"}</span></header>
          <ul className="sc-understood">{screenshots.map((shot) => <li key={shot.id}><img src={projectScreenshotUrl(projectId, shot.id)} alt="" /><div><b>{shot.analysis?.title ?? shot.name}</b><small>{shot.analysis ? shot.analysis.summary : "Reading this screenshot…"}</small><em>{used.get(shot.id)?.length ? `Used in scene ${used.get(shot.id)!.join(", ")}` : "Not used yet"}</em></div></li>)}</ul>
          {unused.length > 0 && <p className="sc-hint warn">{unused.length === 1 ? "One screenshot isn't in the script yet." : `${unused.length} screenshots aren't in the script yet.`} The storyboard adds each one to the scene that talks about it, or pick one above.</p>}
        </section>}
      </aside>
    </div>
    {error && <p className="workspace-error">{error}</p>}
    <div className="flow-footer">
      <span className={busy ? "ss-progress" : "ready"}><i />{busy === "plan" ? "Building the storyboard…" : busy === "revise" ? "Rewriting the script…" : "Happy with it? The storyboard comes next."}</span>
      <div><button className="secondary-button" disabled={working} onClick={back}>Edit brief</button><button className="primary-button" disabled={working || draft.lines.every((line) => !line.voiceover?.trim() && !line.onScreen.trim())} onClick={() => generate(latest.current)}>Generate storyboard</button></div>
    </div>
  </div>;
}
