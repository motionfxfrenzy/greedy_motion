"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { proposeProEdit } from "../../lib/pro-api.ts";
import { valueAt, writeProperty } from "../../lib/editor/anim.ts";
import { readClips } from "../../lib/editor/clips-model.ts";
import { readTweens, setTiming, updateTween } from "../../lib/editor/html-source.ts";
import { useEditor } from "../../lib/editor/store.ts";
import type { EditorDoc } from "../../lib/editor/types.ts";
import { Icon } from "./icons.tsx";

type Proposal = { summary: string; lines: { before: string; after: string }[]; apply?: (d: EditorDoc) => void; stage?: string; skills?: number; original?: string };

/**
 * Local demo fallback. Real projects ask the hosted Claude author for a source diff and keep
 * the same review, undo and revisioned save flow.
 */
function propose(q: string): Proposal {
  const s = useEditor.getState();
  const text = q.toLowerCase();
  if (s.mode === "layers") {
    const layer = s.doc.layers.find((l) => l.id === s.sel[0]);
    if (!layer) return { summary: "Select a layer first, then tell me what to change.", lines: [] };
    if (/bigger|larger|grow/.test(text)) { const cur = valueAt(layer, "scale", s.t) as number[]; const next = cur.map((v) => Math.round(v * 1.2)); return { summary: `Make ${layer.name} 20% bigger`, lines: [{ before: `scale ${cur.join(" × ")}%`, after: `scale ${next.join(" × ")}%` }], apply: (d) => writeProperty(d.layers.find((l) => l.id === layer.id)!, "scale", next, s.t) }; }
    if (/smaller|shrink/.test(text)) { const cur = valueAt(layer, "scale", s.t) as number[]; const next = cur.map((v) => Math.round(v * 0.85)); return { summary: `Make ${layer.name} smaller`, lines: [{ before: `scale ${cur.join(" × ")}%`, after: `scale ${next.join(" × ")}%` }], apply: (d) => writeProperty(d.layers.find((l) => l.id === layer.id)!, "scale", next, s.t) }; }
    if (/earlier|sooner/.test(text)) { const to = Math.max(0, +(layer.inP - 0.3).toFixed(2)); return { summary: `Start ${layer.name} 0.3 s earlier`, lines: [{ before: `in ${layer.inP}s`, after: `in ${to}s` }], apply: (d) => { d.layers.find((l) => l.id === layer.id)!.inP = to; } }; }
    if (/later|delay/.test(text)) { const to = Math.min(layer.outP - 0.1, +(layer.inP + 0.3).toFixed(2)); return { summary: `Start ${layer.name} 0.3 s later`, lines: [{ before: `in ${layer.inP}s`, after: `in ${to}s` }], apply: (d) => { d.layers.find((l) => l.id === layer.id)!.inP = to; } }; }
    return { summary: "I can make a layer bigger or smaller, or start it earlier or later. Try one of those.", lines: [] };
  }
  const clip = readClips(s.doc.html).clips.find((c) => c.id === s.clipSel[0]);
  if (!clip) return { summary: "Select a clip first, then tell me what to change.", lines: [] };
  if (/faster|quick/.test(text)) {
    const tweens = readTweens(s.doc.html, clip.id, clip.start);
    if (!tweens.length) return { summary: `${clip.id} has no tweens to speed up.`, lines: [] };
    return { summary: `Speed up ${clip.id}'s animation by 30%`, lines: tweens.map((tw) => ({ before: `${tw.prop} ${tw.dur}s`, after: `${tw.prop} ${+(tw.dur * 0.7).toFixed(2)}s` })), apply: (d) => { for (const tw of readTweens(d.html, clip.id, clip.start)) d.html = updateTween(d.html, tw.id, clip.start, { dur: +(tw.dur * 0.7).toFixed(2) }); } };
  }
  if (/earlier|sooner/.test(text)) { const to = Math.max(0, +(clip.start - 0.3).toFixed(2)); return { summary: `Start ${clip.id} 0.3 s earlier`, lines: [{ before: `start ${clip.start}s`, after: `start ${to}s` }], apply: (d) => { d.html = setTiming(d.html, clip.id, { start: to }); } }; }
  if (/longer/.test(text)) { const to = +(clip.dur + 0.5).toFixed(2); return { summary: `Hold ${clip.id} 0.5 s longer`, lines: [{ before: `duration ${clip.dur}s`, after: `duration ${to}s` }], apply: (d) => { d.html = setTiming(d.html, clip.id, { dur: to }); } }; }
  return { summary: "I can speed up a clip's animation, start it earlier, or hold it longer. Try one of those.", lines: [] };
}

const CHIPS = ["Make it bigger", "Start it earlier", "Make it faster"];

/**
 * The agent is the last block of the inspector's own scroll area, so it reads as a continuation of the properties above it:
 * one native scroll covers both, wherever the pointer is. Its bar is sticky to the bottom edge, so it is always reachable;
 * scrolling down carries the rest of the panel up into view behind it.
 */
export function AgentDock({ target }: { target: string }) {
  const agent = useEditor((s) => s.agent);
  const ui = useEditor((s) => s.ui);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setAgent = (patch: Partial<typeof agent>) => ui({ agent: { ...useEditor.getState().agent, ...patch } });
  /** Bring the whole panel into view (smoothly), e.g. from the bar or when the agent starts working. */
  const reveal = () => root.current?.parentElement?.scrollTo({ top: root.current.parentElement.scrollHeight, behavior: "smooth" });
  useLayoutEffect(() => { if (agent.state !== "idle") reveal(); }, [agent.state, proposal]);

  const ask = async () => {
    const q = agent.q.trim();
    if (!q) return;
    setAgent({ state: "thinking" });
    const current = useEditor.getState();
    if (!current.remote) {
      timer.current = setTimeout(() => { setProposal(propose(q)); setAgent({ state: "proposed" }); }, 900);
      return;
    }
    try {
      const original = current.doc.html;
      const result = await proposeProEdit(current.remote.projectId, current.remote.rev, q, target, original);
      const lines = result.edits.map(edit => ({ before: edit.find.slice(0, 180), after: edit.replace.slice(0, 180) }));
      setProposal({ summary: result.summary, lines, stage: result.stage, skills: result.skills.length, original, apply: d => {
        if (d.html !== original) { useEditor.getState().say("The composition changed while Claude was working. Ask again on the current version."); return; }
        let next = d.html;
        for (const edit of result.edits) {
          const at = next.indexOf(edit.find);
          if (at < 0 || next.indexOf(edit.find, at + 1) >= 0) { useEditor.getState().say("Claude's edit no longer matches the source. Ask again."); return; }
          next = next.slice(0, at) + edit.replace + next.slice(at + edit.find.length);
        }
        d.html = next;
      } });
    } catch (error) {
      setProposal({ summary: error instanceof Error ? error.message : "Claude could not propose an edit.", lines: [] });
    }
    setAgent({ state: "proposed" });
  };
  const apply = () => {
    if (proposal?.apply) { if (proposal.original !== undefined && useEditor.getState().doc.html !== proposal.original) { useEditor.getState().say("The composition changed. Ask Claude again on the current version."); setProposal(null); setAgent({ state: "idle" }); return; } const fn = proposal.apply; useEditor.getState().edit(`Agent: ${proposal.summary}`, (d) => fn(d)); useEditor.getState().say("Applied. ⌘Z undoes the whole change."); }
    setProposal(null); setAgent({ state: "idle", q: "" });
  };

  return (
    // Bar and body are direct children of the scroller (no wrapper box): a sticky bar can only move inside its parent.
    <>
      <button type="button" ref={root} className="ed-agent-line" onClick={reveal} aria-label={`Ask agent about ${target}. Show the panel`}>
        <span className="ed-agent-ico"><Icon name="sparkle" size={13} /></span>
        <span className="ed-agent-label">Ask agent about <b>{target}</b></span>
        <Icon name="caretUp" size={13} />
      </button>
      <div className="ed-agent-body" role="region" aria-label="Ask agent">
        {agent.state === "idle" ? (
          <>
            <p className="ed-note">Describe a change. I will show it as a diff before anything is applied.</p>
            <textarea value={agent.q} aria-label="Ask the agent" placeholder="e.g. Make the title bigger" onChange={(e) => setAgent({ q: e.target.value })} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask(); }} />
            <div className="ed-chips">{CHIPS.map((c) => <button key={c} type="button" className="ed-pchip" onClick={() => setAgent({ q: c })}>{c}</button>)}</div>
            <button type="button" className="ed-btn primary" disabled={!agent.q.trim()} onClick={() => void ask()}>Send</button>
          </>
        ) : agent.state === "thinking" ? (
          <p className="ed-agent-state"><i className="ed-dot busy" />Thinking about “{agent.q}”…</p>
        ) : (
          <>
            <p className="ed-agent-state"><i className="ed-dot ok" />{proposal?.summary}</p>
            {proposal?.stage && <p className="ed-note">Claude used the {proposal.stage} stage and {proposal.skills} pinned skill references from the cloud bundle.</p>}
            {proposal?.lines.map((l, i) => <div key={i} className="ed-diff ed-mono"><s>{l.before}</s><b>{l.after}</b></div>)}
            <div className="ed-agent-actions">
              {proposal?.apply ? <button type="button" className="ed-btn primary" onClick={apply}>Apply</button> : null}
              <button type="button" className="ed-btn" onClick={() => { setProposal(null); setAgent({ state: "idle", q: proposal?.apply ? "" : agent.q }); }}>{proposal?.apply ? "Discard" : "Try again"}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
