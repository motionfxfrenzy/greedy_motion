"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { HyperframesPlayer } from "@hyperframes/player";
import { create } from "zustand";
import { temporal } from "zundo";
import { findTemplate, templateValue, type TemplateScene, type TemplateValues, type TemplateVariable, type VideoProject } from "@videosaas/contracts";

export type StudioDraftInput = {
  /** Declared string/number template variables only. The backend validates these again. */
  values: TemplateValues;
  /** Image-variable id → uploaded project screenshot id. */
  assets: Record<string, string>;
};

/**
 * The contract is intentionally structural for now so the component can read
 * both older projects and the new persisted Studio revision without making the
 * browser store part of the shared server schema.
 */
type StudioRevision = StudioDraftInput & {
  revision?: number;
  updatedAt?: string;
};

type StudioProject = VideoProject & { studio?: StudioRevision };

export type StudioEditorProps = {
  project: VideoProject;
  /** Values from the latest render job are used only when no Studio revision exists yet. */
  initialValues?: TemplateValues;
  /** Persists an explicit revision; the browser never treats its local draft as export authority. */
  onSave: (draft: StudioDraftInput) => Promise<VideoProject>;
  /** Starts the normal backend render flow after the draft is saved. */
  onRender: () => Promise<void>;
  onBack?: () => void;
  /** Allows the caller to reuse its API URL helper without coupling the editor to it. */
  screenshotUrl?: (projectId: string, screenshotId: string) => string;
};

type StudioDraftStore = {
  projectId: string | null;
  values: TemplateValues;
  assets: Record<string, string>;
  dirty: boolean;
  setValue: (id: string, value: string | number) => void;
  setAsset: (id: string, screenshotId: string) => void;
  markSaved: () => void;
};

/**
 * Zundo is deliberately limited to browser-editable values and assets. Server
 * revisions, queued renders, and review state never enter this undo history.
 */
const useStudioDraft = create<StudioDraftStore>()(
  temporal(
    (set) => ({
      projectId: null,
      values: {},
      assets: {},
      dirty: false,
      setValue: (id, value) => set((current) => ({ values: { ...current.values, [id]: value }, dirty: true })),
      setAsset: (id, screenshotId) => set((current) => ({ assets: { ...current.assets, [id]: screenshotId }, dirty: true })),
      markSaved: () => set({ dirty: false })
    }),
    {
      partialize: (state) => ({ values: state.values, assets: state.assets }),
      limit: 50
    }
  )
);

type PlayerReadyDetail = { duration: number };
type PlayerTimeDetail = { currentTime: number };
type PlayerErrorDetail = { message?: string };

function editorSnapshot(values: TemplateValues, assets: Record<string, string>) {
  return JSON.stringify({ assets, values });
}

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function clampTime(seconds: number, duration: number) {
  return Math.max(0, Math.min(seconds, Math.max(duration, 0)));
}

function percent(seconds: number, duration: number) {
  return `${(clampTime(seconds, duration) / Math.max(duration, 0.001)) * 100}%`;
}

function sceneAt(scenes: readonly TemplateScene[], currentTime: number) {
  return scenes.find((scene) => currentTime >= scene.start && currentTime < scene.start + scene.duration) ?? scenes[scenes.length - 1];
}

function defaultScreenshotUrl(projectId: string, screenshotId: string) {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${origin}/v1/projects/${encodeURIComponent(projectId)}/screenshots/${encodeURIComponent(screenshotId)}`;
}

/**
 * Small adapter around the HyperFrames custom element. The fetched composition
 * is passed as `srcdoc`, so the preview uses the backend's exact template,
 * saved variables, theme, and project assets rather than a client-side mock.
 */
export function HyperframesPreview({
  srcdoc,
  muted = true,
  playerRef,
  onReady,
  onTimeChange,
  onPlayingChange,
  onError
}: {
  srcdoc: string;
  /** Starts muted (autoplay-safe); callers unmute from a user gesture such as Play. */
  muted?: boolean;
  playerRef: RefObject<HyperframesPlayer | null>;
  onReady: (duration: number) => void;
  onTimeChange: (seconds: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onError: (message: string) => void;
}) {
  const callbacks = useRef({ onReady, onTimeChange, onPlayingChange, onError });
  useEffect(() => {
    callbacks.current = { onReady, onTimeChange, onPlayingChange, onError };
  }, [onError, onPlayingChange, onReady, onTimeChange]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const ready = (event: Event) => callbacks.current.onReady((event as CustomEvent<PlayerReadyDetail>).detail.duration);
    const timeupdate = (event: Event) => callbacks.current.onTimeChange((event as CustomEvent<PlayerTimeDetail>).detail.currentTime);
    const play = () => callbacks.current.onPlayingChange(true);
    const pause = () => callbacks.current.onPlayingChange(false);
    const ended = () => callbacks.current.onPlayingChange(false);
    const error = (event: Event) => callbacks.current.onError((event as CustomEvent<PlayerErrorDetail>).detail?.message || "The Studio preview could not be loaded.");

    player.addEventListener("ready", ready);
    player.addEventListener("timeupdate", timeupdate);
    player.addEventListener("play", play);
    player.addEventListener("pause", pause);
    player.addEventListener("ended", ended);
    player.addEventListener("error", error);
    return () => {
      player.removeEventListener("ready", ready);
      player.removeEventListener("timeupdate", timeupdate);
      player.removeEventListener("play", play);
      player.removeEventListener("pause", pause);
      player.removeEventListener("ended", ended);
      player.removeEventListener("error", error);
    };
  }, [playerRef]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.setAttribute("srcdoc", srcdoc);
  }, [playerRef, srcdoc]);

  useEffect(() => {
    const player = playerRef.current;
    if (player) player.muted = muted;
  }, [muted, playerRef, srcdoc]);

  // React's generic createElement path keeps this client-only custom element
  // out of the server JSX type surface while the dynamic import registers it.
  return createElement("hyperframes-player", {
    ref: playerRef,
    className: "studio-hyperframes-player",
    "disable-click-to-play": "",
    muted: "",
    "assets-loading-ui": "none",
    "aria-label": "Studio composition preview"
  });
}

function VariableField({ variable, value, onChange }: { variable: TemplateVariable; value: string | number; onChange: (value: string | number) => void }) {
  const inputId = `studio-field-${variable.id}`;
  const number = variable.type === "number";
  return <label className="studio-field" htmlFor={inputId}>
    <span><b>{variable.label}</b>{variable.maxLength !== undefined && <small>{String(value).length}/{variable.maxLength}</small>}</span>
    {variable.description && <em>{variable.description}</em>}
    <input
      id={inputId}
      type={number ? "number" : "text"}
      value={String(value)}
      min={number ? variable.min : undefined}
      max={number ? variable.max : undefined}
      maxLength={!number ? variable.maxLength : undefined}
      onChange={(event) => onChange(number ? (event.currentTarget.value === "" ? "" : Number(event.currentTarget.value)) : event.currentTarget.value)}
    />
  </label>;
}

function AssetPicker({
  project,
  variable,
  selected,
  screenshotUrl,
  onSelect
}: {
  project: VideoProject;
  variable: TemplateVariable;
  selected?: string;
  screenshotUrl: (projectId: string, screenshotId: string) => string;
  onSelect: (screenshotId: string) => void;
}) {
  return <section className="studio-assets" aria-label={`${variable.label} asset picker`}>
    <header><div><small>ASSET</small><b>{variable.label}</b></div><span>{project.screenshots.length} uploaded</span></header>
    {variable.description && <p>{variable.description}</p>}
    {project.screenshots.length === 0 ? <div className="studio-empty-asset"><b>No uploaded product screens</b><span>Upload one in the Script step, then return to Studio to use it in the render.</span></div> : <div className="studio-asset-grid">{project.screenshots.map((screenshot) => <button type="button" key={screenshot.id} className={selected === screenshot.id ? "selected" : ""} onClick={() => onSelect(screenshot.id)} aria-pressed={selected === screenshot.id}>
      <img src={screenshotUrl(project.id, screenshot.id)} alt={screenshot.name} />
      <span><b>{screenshot.name}</b><small>{screenshot.width} × {screenshot.height}</small></span>
      {selected === screenshot.id && <i>Selected</i>}
    </button>)}</div>}
  </section>;
}

function PreviewPlaceholder({ message }: { message: string }) {
  return <div className="studio-preview-placeholder"><span className="studio-preview-mark">GM</span><b>{message}</b><p>The composition is generated by the project backend and loaded into HyperFrames here.</p></div>;
}

export function StudioEditor({ project, initialValues, onSave, onRender, onBack, screenshotUrl = defaultScreenshotUrl }: StudioEditorProps) {
  const template = findTemplate(project.request.template);
  const stored = (project as StudioProject).studio;
  const rootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HyperframesPlayer | null>(null);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const initialSaveRequired = useRef(false);
  const draftProjectId = useStudioDraft((state) => state.projectId);
  const values = useStudioDraft((state) => state.values);
  const assets = useStudioDraft((state) => state.assets);
  const dirty = useStudioDraft((state) => state.dirty);
  const setValue = useStudioDraft((state) => state.setValue);
  const setAsset = useStudioDraft((state) => state.setAsset);
  const markSaved = useStudioDraft((state) => state.markSaved);
  const [booted, setBooted] = useState(false);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(template?.durationSeconds ?? 10);
  const [playing, setPlaying] = useState(false);
  const [selectedSceneId, setSelectedSceneId] = useState(template?.scenes[0]?.id ?? "");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const available = booted && draftProjectId === project.id;
  const scene = template ? (template.scenes.find((item) => item.id === selectedSceneId) ?? template.scenes[0]) : undefined;
  const activeScene = template ? sceneAt(template.scenes, currentTime) : undefined;
  const effectiveDuration = Math.max(duration || 0, template?.durationSeconds ?? 0, 0.1);

  const visibleVariables = useMemo(() => {
    if (!template || !scene) return [];
    return scene.variables.map((id) => template.variables.find((variable) => variable.id === id)).filter((variable): variable is TemplateVariable => Boolean(variable));
  }, [scene, template]);

  const editableVariables = visibleVariables.filter((variable) => variable.type === "string" || variable.type === "number");
  const imageVariables = visibleVariables.filter((variable) => variable.type === "image");
  const ruler = useMemo(() => {
    const increment = effectiveDuration <= 12 ? 1 : effectiveDuration <= 30 ? 5 : 10;
    const points = Array.from({ length: Math.floor(effectiveDuration / increment) + 1 }, (_, index) => index * increment);
    return points[points.length - 1] === effectiveDuration ? points : [...points, effectiveDuration];
  }, [effectiveDuration]);

  useEffect(() => {
    let live = true;
    void import("@hyperframes/player")
      .then(() => { if (live) setPlayerLoaded(true); })
      .catch((caught) => { if (live) setPreviewError(caught instanceof Error ? caught.message : "The HyperFrames player could not be loaded."); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const temporalStore = useStudioDraft.temporal;
    const syncHistory = () => {
      const history = temporalStore.getState();
      setCanUndo(history.pastStates.length > 0);
      setCanRedo(history.futureStates.length > 0);
    };
    syncHistory();
    return temporalStore.subscribe(syncHistory);
  }, []);

  useEffect(() => {
    const nextValues = stored?.values ?? initialValues ?? {};
    const initialTemplate = findTemplate(project.request.template);
    const firstScreenshotId = project.screenshots[0]?.id;
    // Only template image slots with a supplied visual default represent
    // project screenshots. Brand-logo slots are renderer-managed and must not
    // be silently pointed at a product image.
    const defaultAssets = Object.fromEntries((initialTemplate?.variables ?? [])
      .filter((variable) => variable.type === "image" && typeof variable.default === "string" && variable.default.length > 0 && firstScreenshotId)
      .map((variable) => [variable.id, firstScreenshotId as string]));
    const nextAssets = { ...defaultAssets, ...(stored?.assets ?? {}) };
    const needsInitialDraft = !stored || Object.entries(defaultAssets).some(([id, screenshotId]) => stored?.assets?.[id] !== screenshotId);
    const temporalStore = useStudioDraft.temporal.getState();
    temporalStore.pause();
    useStudioDraft.setState({ projectId: project.id, values: { ...nextValues }, assets: { ...nextAssets }, dirty: needsInitialDraft });
    temporalStore.clear();
    temporalStore.resume();
    initialSaveRequired.current = needsInitialDraft;
    setSelectedSceneId(findTemplate(project.request.template)?.scenes[0]?.id ?? "");
    setCurrentTime(0);
    setDuration(findTemplate(project.request.template)?.durationSeconds ?? 10);
    setSaveState("saved");
    setSaveError(null);
    setBooted(true);
  // The project identity is the revision boundary. A successful save updates
  // the caller's project object, but must not clobber the local working draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const loadPreview = useCallback(async (signal?: AbortSignal) => {
    setPreviewError(null);
    const response = await fetch(`/api/preview/projects/${encodeURIComponent(project.id)}?revision=${previewVersion}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`The preview service returned ${response.status}.`);
    return response.text();
  }, [previewVersion, project.id]);

  useEffect(() => {
    const controller = new AbortController();
    setPreviewHtml(null);
    void loadPreview(controller.signal)
      .then((html) => setPreviewHtml(html))
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setPreviewError(caught instanceof Error ? caught.message : "The Studio preview could not be loaded.");
      });
    return () => controller.abort();
  }, [loadPreview]);

  const saveNow = useCallback(async (force = false): Promise<boolean> => {
    if (!available || (!useStudioDraft.getState().dirty && !force && !initialSaveRequired.current)) return true;
    if (savePromise.current) return savePromise.current;
    const snapshot = editorSnapshot(useStudioDraft.getState().values, useStudioDraft.getState().assets);
    setSaveState("saving");
    setSaveError(null);
    const pending = (async () => {
      try {
        const current = useStudioDraft.getState();
        await onSave({ values: current.values, assets: current.assets });
        const after = useStudioDraft.getState();
        if (snapshot === editorSnapshot(after.values, after.assets)) {
          markSaved();
          setPreviewVersion((version) => version + 1);
        }
        initialSaveRequired.current = false;
        // If another input landed while the request was in flight, leave the
        // draft dirty but release the saving state so the debounce queues the
        // next explicit revision instead of stranding it behind this request.
        setSaveState("saved");
        return true;
      } catch (caught) {
        setSaveState("error");
        setSaveError(caught instanceof Error ? caught.message : "Could not save the Studio draft.");
        return false;
      } finally {
        savePromise.current = null;
      }
    })();
    savePromise.current = pending;
    return pending;
  }, [available, markSaved, onSave]);

  useEffect(() => {
    if (!available || !dirty || saveState === "saving") return;
    const timer = window.setTimeout(() => { void saveNow(); }, 700);
    return () => window.clearTimeout(timer);
  }, [assets, available, dirty, saveNow, saveState, values]);

  const seek = useCallback((seconds: number) => {
    const next = clampTime(seconds, effectiveDuration);
    setCurrentTime(next);
    playerRef.current?.seek(next);
  }, [effectiveDuration]);

  const selectScene = (next: TemplateScene) => {
    setSelectedSceneId(next.id);
    seek(next.start);
  };

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) player.play();
    else player.pause();
  };

  const changeAtPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - bounds.left) / bounds.width) * effectiveDuration);
  };

  const undo = () => {
    useStudioDraft.temporal.getState().undo();
  };
  const redo = () => {
    useStudioDraft.temporal.getState().redo();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!rootRef.current?.contains(document.activeElement) || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const render = async () => {
    setRendering(true);
    setSaveError(null);
    try {
      // A quick second pass handles a keystroke made while the first save was in flight.
      for (let attempt = 0; attempt < 2 && (useStudioDraft.getState().dirty || initialSaveRequired.current); attempt += 1) {
        if (!await saveNow(true)) return;
      }
      if (useStudioDraft.getState().dirty || initialSaveRequired.current) {
        setSaveState("error");
        setSaveError("Your latest Studio change is still waiting to save. Try rendering again in a moment.");
        return;
      }
      await onRender();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not start a render from this Studio revision.");
    } finally {
      setRendering(false);
    }
  };

  const leaveStudio = async () => {
    // The editor is autosaved, but a navigation immediately after a keystroke
    // must not cancel the debounce and silently lose that explicit draft.
    if (await saveNow()) onBack?.();
  };

  if (!template) {
    return <section className="studio-unavailable"><h1>Studio is unavailable for this project</h1><p>The saved template no longer exists, so there is no safe composition to edit.</p>{onBack && <button className="secondary-button" onClick={onBack}>Back to project</button>}</section>;
  }

  return <section className="studio-editor" ref={rootRef} data-studio-editor>
    <header className="studio-editor-header">
      <div className="studio-editor-project">
        {onBack && <button className="studio-back" onClick={() => void leaveStudio()} disabled={saveState === "saving"}>← Project</button>}
        <span className="studio-brand-mark">GM</span>
        <div><small>STUDIO · {template.name.toUpperCase()}</small><h1>{project.name}</h1></div>
      </div>
      <div className="studio-editor-actions">
        <span className={saveState === "error" ? "studio-save-state error" : saveState === "saving" ? "studio-save-state saving" : "studio-save-state"}>{saveState === "saving" ? "Saving revision…" : saveState === "error" ? "Save needs attention" : `Saved${stored?.revision ? ` · revision ${stored.revision}` : ""}`}</span>
        <button className="studio-icon-button" disabled={!canUndo || !available} onClick={undo} title="Undo local change (⌘Z)">↶<span>Undo</span></button>
        <button className="studio-icon-button" disabled={!canRedo || !available} onClick={redo} title="Redo local change (⌘⇧Z)">↷<span>Redo</span></button>
        <button className="primary-button studio-render" disabled={!available || rendering || saveState === "saving"} onClick={() => void render()}>{rendering ? "Starting render…" : "Render draft"}</button>
      </div>
    </header>

    <div className="studio-editor-layout">
      <aside className="studio-scenes" aria-label="Scenes">
        <header><small>SCENES</small><span>{template.scenes.length} scenes · {formatTime(template.durationSeconds)}</span></header>
        <div>{template.scenes.map((item, index) => <button key={item.id} className={item.id === scene?.id ? "selected" : ""} onClick={() => selectScene(item)} aria-pressed={item.id === scene?.id}>
          <i>{String(index + 1).padStart(2, "0")}</i><span><b>{item.label}</b><small>{formatTime(item.start)}–{formatTime(item.start + item.duration)}</small></span>
        </button>)}</div>
        <footer><b>Template controls the layout</b><p>Copy and approved screen assets are editable. Scene durations and motion stay locked to this template.</p></footer>
      </aside>

      <main className="studio-canvas">
        <div className={"studio-preview-frame " + (project.request.format === "portrait" ? "portrait" : "landscape")}>
          {!available || !playerLoaded || !previewHtml ? <PreviewPlaceholder message={previewError || (!playerLoaded ? "Loading HyperFrames player…" : "Loading saved composition…")} /> : <HyperframesPreview
            srcdoc={previewHtml}
            playerRef={playerRef}
            onReady={(nextDuration) => setDuration(nextDuration || template.durationSeconds)}
            onTimeChange={setCurrentTime}
            onPlayingChange={setPlaying}
            onError={setPreviewError}
          />}
          {previewError && <div className="studio-preview-error"><b>Preview needs attention</b><span>{previewError}</span><button onClick={() => setPreviewVersion((version) => version + 1)}>Retry preview</button></div>}
        </div>
        <div className="studio-transport">
          <button aria-label={playing ? "Pause preview" : "Play preview"} onClick={togglePlayback} disabled={!previewHtml}>{playing ? "❚❚" : "▶"}</button>
          <span><b>{formatTime(currentTime)}</b> / {formatTime(effectiveDuration)}</span>
          <strong>{activeScene ? `Scene ${String(template.scenes.indexOf(activeScene) + 1).padStart(2, "0")} · ${activeScene.label}` : "Composition"}</strong>
          <button onClick={() => void playerRef.current?.requestFullscreen?.()} disabled={!previewHtml}>Fullscreen</button>
        </div>

        <section className="studio-timeline" aria-label="Template timeline">
          <header><div><small>TIMELINE</small><b>{template.name}</b></div><span>Saved scene timing · click a block to seek</span></header>
          <div className="studio-track" role="slider" tabIndex={0} aria-label="Composition timeline" aria-valuemin={0} aria-valuemax={effectiveDuration} aria-valuenow={Math.round(currentTime * 10) / 10} aria-valuetext={formatTime(currentTime)}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); changeAtPointer(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) changeAtPointer(event); }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onKeyDown={(event) => { if (event.key === "ArrowLeft") seek(currentTime - 0.25); if (event.key === "ArrowRight") seek(currentTime + 0.25); if (event.key === " ") { event.preventDefault(); togglePlayback(); } }}>
            <div className="studio-ruler">{ruler.map((second) => <span key={second} style={{ left: percent(second, effectiveDuration) }}>{formatTime(second)}</span>)}</div>
            <div className="studio-scene-track">{template.scenes.map((item, index) => <button key={item.id} className={item.id === scene?.id ? "selected" : item.id === activeScene?.id ? "active" : ""} style={{ left: percent(item.start, effectiveDuration), width: percent(item.duration, effectiveDuration) }} onPointerDown={(event) => event.stopPropagation()} onClick={() => selectScene(item)}>
              <small>{String(index + 1).padStart(2, "0")}</small><b>{item.label}</b><span>{formatTime(item.duration)}</span>
            </button>)}</div>
            {project.comments.length > 0 && <div className="studio-comment-pins" aria-label="Review comments">{project.comments.map((comment, index) => <button key={comment.id} style={{ left: percent(comment.timestampSeconds, effectiveDuration) }} title={comment.body} onPointerDown={(event) => event.stopPropagation()} onClick={() => seek(comment.timestampSeconds)}>{index + 1}</button>)}</div>}
            <i className="studio-playhead" style={{ left: percent(currentTime, effectiveDuration) }} />
          </div>
          <footer><span>{project.comments.length ? `${project.comments.length} saved review comment${project.comments.length === 1 ? "" : "s"} shown as pins` : "No review pins on this project yet"}</span><span>Duration and animation are template-owned in v1</span></footer>
        </section>
      </main>

      <aside className="studio-inspector">
        <header><div><small>INSPECTOR</small><h2>{scene?.label || "Scene"}</h2></div><span>{scene ? `${formatTime(scene.start)}–${formatTime(scene.start + scene.duration)}` : ""}</span></header>
        <div className="studio-inspector-tabs"><span className="active">Content</span><span>Assets</span></div>
        <section className="studio-inspector-section">
          <header><b>Approved copy</b><span>{editableVariables.length} field{editableVariables.length === 1 ? "" : "s"}</span></header>
          {editableVariables.length > 0 ? <div className="studio-fields">{editableVariables.map((variable) => <VariableField key={variable.id} variable={variable} value={templateValue(template, values, variable.id)} onChange={(value) => setValue(variable.id, value)} />)}</div> : <p className="studio-readonly">This scene has no copy fields. Its content is supplied by the selected asset or the active brand kit.</p>}
        </section>
        {imageVariables.map((variable) => <AssetPicker key={variable.id} project={project} variable={variable} selected={assets[variable.id] ?? project.screenshots[0]?.id} screenshotUrl={screenshotUrl} onSelect={(screenshotId) => setAsset(variable.id, screenshotId)} />)}
        {visibleVariables.some((variable) => variable.type === "boolean") && <section className="studio-managed"><b>Brand-managed fields</b><p>Logo and wordmark behavior are resolved by the saved brand kit at preview and render time.</p></section>}
        <section className="studio-render-note"><b>What renders</b><p>Render uses this saved Studio revision, the current brand kit, and selected uploaded product screens. Nothing in this panel is a mock export.</p></section>
        {saveError && <p className="studio-save-error">{saveError}</p>}
      </aside>
    </div>
  </section>;
}
