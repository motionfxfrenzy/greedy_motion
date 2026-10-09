"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatShortcut } from "../../lib/editor/actions.ts";
import { runCheck, startRender } from "../../lib/editor/commands.ts";
import { readClips } from "../../lib/editor/clips-model.ts";
import { makeLayer, newId } from "../../lib/editor/fixtures.ts";
import { useEditor, useEditorState } from "../../lib/editor/store.ts";
import { formatTime } from "../../lib/editor/time.ts";
import { Icon } from "./icons.tsx";
import { useRegistry } from "./registry.ts";

const mac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

function Modal({ title, onClose, children, width = 520, labelledBy }: { title: string; onClose: () => void; children: ReactNode; width?: number; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,textarea,button,select")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled),input,textarea,select,[tabindex='0']")];
        if (!items.length) return;
        const first = items[0]!; const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="ed-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="ed-modal" role="dialog" aria-modal="true" aria-label={labelledBy ?? title} style={{ width }}>
        <div className="ed-modal-h"><h2>{title}</h2><button type="button" className="ed-ibtn" aria-label="Close" onClick={onClose}><Icon name="close" size={14} /></button></div>
        {children}
      </div>
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const registry = useRegistry();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const items = useMemo(() => registry.search(q).filter((a) => a.id !== "delete2"), [registry, q]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setAt(0), [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest" }); }, [at]);
  const run = (i: number) => { const a = items[i]; if (!a) return; onClose(); setTimeout(() => registry.run(a.id), 0); };
  let lastGroup = "";
  return (
    <div className="ed-backdrop blur" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ed-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command" role="combobox" aria-expanded="true" aria-controls="ed-pal-list" aria-activedescendant={items[at] ? `pal-${items[at]!.id}` : undefined}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((v) => Math.min(items.length - 1, v + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setAt((v) => Math.max(0, v - 1)); }
            if (e.key === "Enter") { e.preventDefault(); run(at); }
            if (e.key === "Escape") onClose();
          }} />
        <div className="ed-pal-list" id="ed-pal-list" role="listbox" ref={list}>
          {items.map((a, i) => {
            const head = a.group !== lastGroup ? <div key={`h-${a.group}-${i}`} className="ed-cap pal">{a.group}</div> : null;
            lastGroup = a.group;
            return [head, <button key={a.id} id={`pal-${a.id}`} type="button" role="option" aria-selected={i === at} className={`ed-pal-row ${i === at ? "on" : ""}`} onMouseMove={() => setAt(i)} onClick={() => run(i)}><span>{a.label}</span>{a.shortcut ? <kbd>{formatShortcut(a.shortcut, mac())}</kbd> : null}</button>];
          })}
          {!items.length ? <div className="ed-empty small">No command matches “{q}”.</div> : null}
        </div>
        <div className="ed-pal-foot">↑↓ move · Enter runs · Esc closes</div>
      </div>
    </div>
  );
}

function RenderPopover() {
  const registry = useRegistry();
  const { mode, jobs, renderOpen, canvas } = useEditorState();
  const ui = useEditor((s) => s.ui);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!renderOpen) return;
    const away = (e: PointerEvent) => { const t = e.target; if (!(t instanceof Element)) return; if (!ref.current?.contains(t) && !t.closest(".ed-btn.primary")) ui({ renderOpen: false }); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && ui({ renderOpen: false });
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [renderOpen, ui]);
  if (!renderOpen) return null;
  const active = jobs.filter((j) => j.state === "running" || j.state === "queued");
  const history = jobs.filter((j) => j.state === "done" || j.state === "failed");
  const options = mode === "layers" ? [["render.preview", "Preview · 540p", `${Math.round(canvas.width / 2)}×${Math.round(canvas.height / 2)} · fast and cheap`], ["render.full", "Full render", `${canvas.width}×${canvas.height} · original assets`]] : [["render.preview", "Preview · 540p", "Low resolution to check timing"], ["render.mp4", "Render MP4", "Final quality"], ["render.alpha", "Render transparent", "ProRes 4444 with alpha"]];
  const job = (j: (typeof jobs)[number]) => (
    <div key={j.id} className={`ed-job ${j.state}`}>
      <div className="ed-job-h"><b>{j.kind}</b><span className="ed-mono ed-muted">{j.state === "queued" ? "Queued" : j.state === "done" ? "Done" : j.state === "failed" ? "Failed" : `${Math.round(j.pct)}%`}</span></div>
      <div className="ed-prog"><i style={{ width: `${j.pct}%` }} /></div>
      <div className="ed-job-s">{j.state === "running" ? `Rendering frames ${Math.round((j.pct / 100) * j.frames)} / ${j.frames}` : j.state === "queued" ? "Waiting for the running render" : j.state === "done" ? `${j.frames} frames` : j.err ?? "Out of memory while rendering"}</div>
      <div className="ed-job-a">
        {j.state === "done" ? <><button type="button" className="ed-linkbtn" onClick={() => ui({ modal: "player", renderOpen: false })}>Open</button><button type="button" className="ed-linkbtn" onClick={() => useEditor.getState().say("Download starts in the real app.")}>Download</button></> : null}
        {j.state === "failed" ? <button type="button" className="ed-linkbtn" onClick={() => startRender(j.kind)}>Retry</button> : null}
        {j.state === "running" || j.state === "queued" ? <button type="button" className="ed-linkbtn danger" onClick={() => { ui({ jobs: useEditor.getState().jobs.filter((x) => x.id !== j.id) }); useEditor.getState().say("Render cancelled."); }}>Cancel</button> : null}
      </div>
    </div>
  );
  return (
    <div className="ed-renderpop" ref={ref} role="dialog" aria-label="Render">
      <div className="ed-cap">Render</div>
      <div className="ed-ropts">{options.map(([id, label, sub]) => <button key={id} type="button" onClick={() => registry.run(id!)}><b>{label}</b><span>{sub}</span></button>)}</div>
      {active.length ? <><div className="ed-cap">Queue</div>{active.map(job)}</> : null}
      {history.length ? <><div className="ed-cap">History</div>{history.map(job)}</> : null}
      {!jobs.length ? <p className="ed-note">Renders run in the background. You can keep editing.</p> : null}
    </div>
  );
}

function Menus() {
  const { menu, theme } = useEditorState();
  const ui = useEditor((s) => s.ui);
  const registry = useRegistry();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { const t = e.target; if (t instanceof Node && !ref.current?.contains(t)) ui({ menu: null }); };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [menu, ui]);
  if (!menu) return null;
  const item = (label: string, run: () => void, shortcut?: string, danger?: boolean) => <button key={label} type="button" role="menuitem" className={danger ? "danger" : ""} onClick={() => { ui({ menu: null }); setTimeout(run, 0); }}><span>{label}</span>{shortcut ? <kbd>{formatShortcut(shortcut, mac())}</kbd> : null}</button>;
  const style = { left: Math.min(menu.x, (typeof window === "undefined" ? 1200 : window.innerWidth) - 240), top: menu.y };
  if (menu.kind === "layer") {
    return <div ref={ref} className="ed-menu small" style={style} role="menu" aria-label="Layer actions">
      {item("Rename", () => document.querySelector<HTMLInputElement>(".ed-name")?.focus(), "Enter")}
      {item("Duplicate", () => registry.run("duplicate"), "Mod+D")}
      {item("Pre-compose", () => registry.run("precompose"), "Mod+Shift+C")}
      {item("Delete", () => registry.run("delete"), "Backspace", true)}
    </div>;
  }
  return <div ref={ref} className="ed-menu" style={style} role="menu" aria-label="Project">
    {item("Open project…", () => registry.run("open"), "Mod+O")}
    {item("Save", () => registry.run("save"), "Mod+S")}
    {item("Save as…", () => registry.run("saveas"), "Mod+Shift+S")}
    {item("Publish as template…", () => registry.run("publish"))}
    <hr />
    {item(theme === "dark" ? "Light theme" : "Dark theme", () => ui({ theme: theme === "dark" ? "light" : "dark" }))}
    {item("Keyboard shortcuts", () => registry.run("shortcuts"), "Shift+?")}
  </div>;
}

function Keys({ onClose }: { onClose: () => void }) {
  const registry = useRegistry();
  const groups = new Map<string, { label: string; shortcut: string }[]>();
  for (const a of registry.all()) if (a.shortcut && a.id !== "delete2") groups.set(a.group, [...(groups.get(a.group) ?? []), { label: a.label, shortcut: a.shortcut }]);
  const extra: [string, string, string][] = [["Layer", "Nudge 1 px", "Arrows"], ["Layer", "Nudge 10 px", "Shift+Arrows"], ["Playback", "Step one frame (nothing selected)", "Left / Right"], ["Canvas", "Constrain axis while dragging", "Shift"], ["Canvas", "Skip snapping while dragging", "Mod"], ["Timeline", "Copy keyframe while dragging", "Alt"], ["Region", "Cycle panels", "F6"]];
  for (const [g, label, shortcut] of extra) groups.set(g, [...(groups.get(g) ?? []), { label, shortcut }]);
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={640}>
      <div className="ed-keys">{[...groups].map(([g, rows]) => <section key={g}><div className="ed-cap">{g}</div>{rows.map((r) => <div key={r.label + r.shortcut} className="ed-krow"><span>{r.label}</span><kbd>{/^(Arrows|Shift\+Arrows|Left \/ Right|Shift|Mod|Alt|F6)$/.test(r.shortcut) ? r.shortcut.replace("Mod", mac() ? "⌘" : "Ctrl") : formatShortcut(r.shortcut, mac())}</kbd></div>)}</section>)}</div>
    </Modal>
  );
}

function Bridge({ onClose }: { onClose: () => void }) {
  const { doc, clipSel } = useEditorState();
  const clips = readClips(doc.html).clips.filter((c) => c.kind !== "audio");
  const [id, setId] = useState(clipSel[0] && clips.some((c) => c.id === clipSel[0]) ? clipSel[0] : clips[0]?.id ?? "");
  const [threeD, setThreeD] = useState(true);
  const send = () => {
    const s = useEditor.getState();
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    const newLayer = newId("bridge");
    s.edit("Send clip to Layers", (d) => { d.layers.unshift(makeLayer({ id: newLayer, name: `${clip.id}-layer`, type: "precomp", label: "violet", threeD, w: 880, h: 495, pos: [960, 540], inP: 0, outP: s.duration, src: "HyperFrames · transparent", img: clip.src || "/assets/templates/product-launch.jpg" })); });
    s.setMode("layers");
    s.ui({ sel: [newLayer] });
    s.say(`#${clip.id} is now a transparent layer in Layers.`);
    onClose();
  };
  return (
    <Modal title="Send to Layers" onClose={onClose} width={480}>
      <div className="ed-form">
        <label>Clip<select value={id} onChange={(e) => setId(e.target.value)}>{clips.map((c) => <option key={c.id} value={c.id}>#{c.id}</option>)}</select></label>
        <label className="inline"><input type="checkbox" checked={threeD} onChange={(e) => setThreeD(e.target.checked)} />Place as a 3D layer</label>
        <p className="ed-note">The clip renders as a transparent video and arrives as a layer you can move, rotate and light.</p>
        <div className="ed-modal-f"><button type="button" className="ed-btn" onClick={onClose}>Cancel</button><button type="button" className="ed-btn primary" disabled={!id} onClick={send}>Send</button></div>
      </div>
    </Modal>
  );
}

function SimpleDialog({ title, onClose, body, action, onAction, input }: { title: string; onClose: () => void; body: ReactNode; action: string; onAction: (value: string) => void; input?: string }) {
  const [value, setValue] = useState(input ?? "");
  return (
    <Modal title={title} onClose={onClose} width={460}>
      <div className="ed-form">
        {input !== undefined ? <label>Name<input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onAction(value); }} /></label> : null}
        {body}
        <div className="ed-modal-f"><button type="button" className="ed-btn" onClick={onClose}>Cancel</button><button type="button" className="ed-btn primary" disabled={input !== undefined && !value.trim()} onClick={() => onAction(value)}>{action}</button></div>
      </div>
    </Modal>
  );
}

function Player({ onClose }: { onClose: () => void }) {
  const { duration, doc, jobs } = useEditorState();
  const video = jobs.find((j) => j.state === "done" && j.url)?.url;
  const [t, setT] = useState(0);
  const [text, setText] = useState("");
  return (
    <Modal title="Preview render" onClose={onClose} width={880}>
      <div className="ed-player">
        {video ? <video src={video} controls autoPlay playsInline aria-label="Rendered video" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} /> : <img src="/assets/templates/product-launch.jpg" alt="Rendered preview frame" />}
        <div className="ed-scrub">
          <input type="range" min={0} max={duration} step={1 / 30} value={t} aria-label="Scrub" onChange={(e) => setT(Number(e.target.value))} />
          {doc.comments.map((c) => <button key={c.id} type="button" className="ed-pin" style={{ left: `${(c.at / duration) * 100}%` }} aria-label={`${c.who} at ${formatTime(c.at)}`} title={c.text} onClick={() => setT(c.at)}><span>{c.ini}</span></button>)}
        </div>
        <div className="ed-player-row"><span className="ed-timechip ed-mono">{formatTime(t)}</span><input placeholder="Comment at this time" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><button type="button" className="ed-btn primary" disabled={!text.trim()} onClick={() => { useEditor.getState().edit("Post comment", (d) => { d.comments.push({ id: newId("c"), who: "You", ini: "OE", at: t, text: text.trim(), resolved: false }); }); setText(""); }}>Post comment</button></div>
      </div>
    </Modal>
  );
}

export function Overlays() {
  const { modal, toast, vars } = { ...useEditorState(), vars: useEditor((s) => s.doc.vars) };
  const ui = useEditor((s) => s.ui);
  const close = () => ui({ modal: null });
  void runCheck;
  const on = Object.values(vars).filter(Boolean).length;
  return (
    <>
      <RenderPopover />
      <Menus />
      {modal === "palette" ? <Palette onClose={close} /> : null}
      {modal === "keys" ? <Keys onClose={close} /> : null}
      {modal === "bridge" ? <Bridge onClose={close} /> : null}
      {modal === "player" ? <Player onClose={close} /> : null}
      {modal === "open" ? <SimpleDialog title="Open project" onClose={close} action="Open" onAction={() => { close(); useEditor.getState().say("Project opening is wired up with the backend."); }} body={<ul className="ed-plist"><li><b>ui-layer-copy</b><span className="ed-muted">Edited just now</span></li><li><b>product-launch</b><span className="ed-muted">Edited yesterday</span></li></ul>} /> : null}
      {modal === "saveas" ? <SimpleDialog title="Save as" onClose={close} input="ui-layer-copy v2" action="Save" onAction={(name) => { close(); useEditor.getState().ui({ projectName: name.trim(), dirty: false }); useEditor.getState().say(`Saved as ${name.trim()}.`); }} body={null} /> : null}
      {modal === "publish" ? <SimpleDialog title="Publish as template" onClose={close} action="Publish" onAction={() => { close(); useEditor.getState().say("Template published. Guided editors can change the ticked fields."); }} body={<p className="ed-note">Guided editors will be able to change {on} field{on === 1 ? "" : "s"}. Everything else stays locked.</p>} /> : null}
      <div className="ed-toast" role="status" aria-live="polite">{toast ? <span key={toast.id}>{toast.msg}</span> : null}</div>
    </>
  );
}
