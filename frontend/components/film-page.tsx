"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PAINTED_SCRIPT_MAX,
  PAINTED_SCRIPT_MIN,
  paintedSeconds,
  renderCostMillitokens,
  tokensFromMilli,
  voices,
  type PaintedTimeline,
  type RenderJob,
  type VideoProject
} from "@videosaas/contracts";
import {
  animatePaintedProject,
  approveProject,
  changePaintedProjectScenes,
  generatePaintedProjectStoryboard,
  getMyTokens,
  getProject,
  getRenderJob,
  hydratePaintedProject,
  listPaintedLooks,
  outputUrl,
  paintedAudioUrl,
  patchPaintedProject,
  renderPaintedProject,
  watchRenderJob,
  type PaintedLookOption
} from "../lib/api";
import { useMediaToken } from "../lib/use-media-token";

type Step = 0 | 1 | 2 | 3;
const STEP_SCRIPT: Step = 0;
const STEP_STORYBOARD: Step = 1;
const STEP_ANIMATION: Step = 2;
const STEP_RENDER: Step = 3;

const FLOW_STEPS: [Step, string][] = [
  [STEP_SCRIPT, "Script"],
  [STEP_STORYBOARD, "Storyboard"],
  [STEP_ANIMATION, "Animation"],
  [STEP_RENDER, "Render"]
];

const BUSY_STAGES: Record<string, string> = {
  writing: "Writing your story script",
  directing: "Directing the scenes and camera",
  objects: "Drawing the props and places",
  voice: "Recording the narrator",
  music: "Composing the background music",
  mixing: "Mixing sound effects and timing"
};

const RENDER_STAGES: Record<string, string> = {
  queued: "Queued for a renderer",
  planning: "Preparing the studio",
  waiting: "Waiting for a free artist",
  preparing: "Setting up the studio",
  directing: "Reading the storyboard",
  objects: "Loading the props and places",
  voice: "Loading the voiceover",
  music: "Loading the music",
  painting: "Drawing and painting the film",
  frames: "Drawing and painting the film",
  encoding: "Encoding the final MP4",
  retrying: "Retrying render"
};

const STORYBOARD_SUGGESTIONS = [
  "Move this scene indoors",
  "Make it sunset with warm light",
  "Add falling snow",
  "Use a closer camera framing"
];

const ANIMATION_COMMENT_EXAMPLES = [
  "They should be inside the house",
  "Make it night time with stars",
  "Add a warm lantern beside them",
  "Make the weather snowy",
  "Use a close-up shot here"
];

const PIN_COLORS = ["#168BFF", "#FF5A1F", "#7C5CFF", "#16803C", "#B45309", "#0B1F4D"];

type TimedComment = { id: string; body: string; timestampSeconds: number };

const lookMedium = (id: string) => id.split(":")[1] ?? id;

/** Auto-growing textarea so multi-line Dialogue and Visual descriptions never clip or scroll inside themselves. */
function AutoTextarea({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  ariaLabel
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(32, el.scrollHeight)}px`;
  }, []);
  useEffect(() => {
    fit();
  }, [value, fit]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(() => fit());
    obs.observe(el);
    return () => obs.disconnect();
  }, [fit]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
    />
  );
}

function formatVideoTime(seconds: number) {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function rulerStep(duration: number) {
  return [1, 2, 5, 10, 15, 30, 60].find((s) => duration / s <= 6) ?? 120;
}

declare global {
  interface Window {
    initShort?: (spec: PaintedTimeline, canvasEl?: HTMLCanvasElement | null) => { renderer?: string };
    stillClean?: (index: number, at?: number) => string;
    playerFrame?: (t: number, draft?: boolean) => number;
    setDrawIn?: (mode: string) => void;
    PaintedPaint?: unknown;
  }
}

let runtimeLoadingPromise: Promise<void> | null = null;
function loadPaintedRuntime(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (typeof window.initShort === "function" && typeof window.stillClean === "function") return Promise.resolve();
  if (!runtimeLoadingPromise) {
    runtimeLoadingPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/painted/runtime.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        runtimeLoadingPromise = null;
        reject(new Error("Could not load the painted drawing runtime."));
      };
      document.head.appendChild(script);
    });
  }
  return runtimeLoadingPromise;
}

function defaultStepFor(project: VideoProject): Step {
  if (project.renderJobId && (project.state === "Rendering draft" || project.state === "Approved" || project.state === "Render needs attention")) {
    return STEP_RENDER;
  }
  if (project.painted?.busy?.phase === "animate" || project.painted?.audioVersion || project.state === "Ready for review") {
    return STEP_ANIMATION;
  }
  if (project.painted?.busy?.phase === "storyboard" || project.painted?.spec?.lines?.length) {
    return STEP_STORYBOARD;
  }
  return STEP_SCRIPT;
}

function maxReachableStep(project: VideoProject | null): Step {
  if (!project?.painted) return STEP_SCRIPT;
  if (project.renderJobId) return STEP_RENDER;
  if (
    project.painted.busy?.phase === "animate" ||
    project.painted.audioVersion ||
    project.state === "Ready for review" ||
    Boolean(project.painted.spec?.lines?.length)
  ) {
    return STEP_ANIMATION;
  }
  if (project.painted.busy?.phase === "storyboard") return STEP_STORYBOARD;
  return STEP_SCRIPT;
}

export function FilmPage() {
  useMediaToken();
  const router = useRouter();

  const [restored, setRestored] = useState(false);
  const [looks, setLooks] = useState<PaintedLookOption[]>([]);
  const [limits, setLimits] = useState({ min: PAINTED_SCRIPT_MIN, max: PAINTED_SCRIPT_MAX });
  const [project, setProject] = useState<VideoProject | null>(null);
  const [step, setStep] = useState<Step>(STEP_SCRIPT);
  const [mode, setMode] = useState<"idea" | "script">("script");
  const [look, setLook] = useState("doodle:marker");
  const [scriptText, setScriptText] = useState("");
  const [ideaText, setIdeaText] = useState("");
  const [editedScript, setEditedScript] = useState(false);
  const [continuous, setContinuous] = useState(true);
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [voice, setVoice] = useState("Charon");
  const [musicMood, setMusicMood] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);

  // Storyboard state
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [drawnFrames, setDrawnFrames] = useState<string[]>([]);
  const [drawnShots, setDrawnShots] = useState<string[][]>([]);
  const [pickedScenes, setPickedScenes] = useState<number[]>([]);
  const [storyboardAsk, setStoryboardAsk] = useState("");
  const [lineEdits, setLineEdits] = useState<Record<number, { say?: string; scene?: string }>>({});
  const lineSaveTimer = useRef<number | null>(null);

  // Animation step state (in-browser canvas player + scene comments)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [timedComments, setTimedComments] = useState<TimedComment[]>([]);
  const [activeCommentDraft, setActiveCommentDraft] = useState("");
  const scrubbingRef = useRef(false);

  // Final Render step state
  const [job, setJob] = useState<RenderJob | null>(null);
  const [approving, setApproving] = useState(false);
  const watchingRender = useRef<AbortController | null>(null);

  // Load runtime + looks + token balance
  useEffect(() => {
    let live = true;
    loadPaintedRuntime()
      .then(() => {
        if (live) setRuntimeReady(true);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load the drawing runtime.");
      });
    listPaintedLooks()
      .then((res) => {
        if (!live) return;
        setLooks(res.looks);
        setLimits({ min: res.scriptMin, max: res.scriptMax });
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load the looks.");
      });
    getMyTokens()
      .then((t) => {
        if (live) setBalance(t.remaining);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      watchingRender.current?.abort();
    };
  }, []);

  const chosenLook = looks.find((entry) => entry.id === look) ?? looks.find((entry) => entry.available);

  // Prefill the example script for the chosen look until the person writes their own or opens a saved project
  useEffect(() => {
    if (restored && chosenLook && !editedScript && !project) {
      setScriptText(chosenLook.script);
    }
  }, [restored, chosenLook, editedScript, project]);

  // Read URL (?p=<id>&step=<n> or ?look=<id>) once on mount, just like studio.tsx
  useEffect(() => {
    let live = true;
    const search = new URLSearchParams(window.location.search);
    const lookParam = search.get("look");
    if (lookParam) setLook(lookParam);
    const projectId = search.get("p");
    const stepParam = search.get("step");
    if (!projectId) {
      setRestored(true);
      return;
    }
    getProject(projectId)
      .then(async (loaded) => {
        if (!live) return;
        let active = loaded;
        const hasRealSpec = Boolean(
          active.painted?.spec?.lines?.some((l) => l.scene || l.shots?.some((s) => (s.subjects?.length ?? 0) + (s.props?.length ?? 0) > 0))
        );
        if (active.painted && !hasRealSpec && !active.painted.busy) {
          active = await hydratePaintedProject(active.id).catch(() => active);
        }
        if (!live) return;
        setProject(active);
        if (active.painted) {
          setLook(active.painted.look);
          setContinuous(active.painted.drawIn !== "each");
          setAspect(active.painted.aspect ?? "9:16");
          setVoice(active.painted.voice ?? "Charon");
          setMusicMood(active.painted.musicMood ?? "");
          setMode(active.painted.mode ?? "script");
          setScriptText(active.painted.script ?? "");
          setIdeaText(active.painted.idea ?? "");
          setEditedScript(true);
        }
        const targetStep =
          stepParam !== null && [0, 1, 2, 3].includes(Number(stepParam))
            ? (Math.min(Number(stepParam), maxReachableStep(active)) as Step)
            : defaultStepFor(active);
        setStep(targetStep);
        if (active.renderJobId) {
          getRenderJob(active.renderJobId)
            .then((found) => {
              if (live) setJob(found);
            })
            .catch(() => undefined);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load the project.");
      })
      .finally(() => {
        if (live) setRestored(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Keep URL query (?p=<id>&step=<n> or ?look=<id>) in sync once initial load has settled
  useEffect(() => {
    if (!restored) return;
    const query = new URLSearchParams();
    if (project) {
      query.set("p", project.id);
      query.set("step", String(step));
    } else if (look) {
      query.set("look", look);
    }
    const nextUrl = `${window.location.pathname}?${query.toString()}`;
    if (nextUrl !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [restored, project, step, look]);

  const busy = project?.painted?.busy ?? null;
  const isBusy = busy?.status === "running";

  // Elapsed timer while a backend job (`storyboard`, `animate`, `changes`) is running
  useEffect(() => {
    if (!isBusy || !busy?.startedAt) {
      setElapsed(0);
      return;
    }
    const base = Date.parse(busy.startedAt) || Date.now();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - base) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [isBusy, busy?.startedAt]);

  // Poll project while `painted.busy` is running
  const prevBusyPhase = useRef<string | null>(null);
  useEffect(() => {
    if (isBusy && busy) prevBusyPhase.current = busy.phase;
  }, [isBusy, busy]);

  useEffect(() => {
    if (!project?.id || !isBusy) return;
    let live = true;
    const timer = window.setInterval(async () => {
      try {
        const refreshed = await getProject(project.id);
        if (!live) return;
        setProject(refreshed);
        if (refreshed.painted?.script) setScriptText(refreshed.painted.script);
        const nextBusy = refreshed.painted?.busy;
        if (!nextBusy || nextBusy.status !== "running") {
          if (nextBusy?.status === "failed") {
            setError(nextBusy.error ?? "Something went wrong. Please try again.");
          } else {
            setError(null);
            if (prevBusyPhase.current === "storyboard") {
              setStep(STEP_STORYBOARD);
            }
          }
          prevBusyPhase.current = null;
        }
      } catch {
        /* Keep polling on transient network blip */
      }
    }, 1800);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [project?.id, isBusy]);

  // Draw Storyboard still frames in the browser whenever `project.painted.timeline` changes
  const timeline = project?.painted?.timeline ?? null;
  const spec = project?.painted?.spec ?? null;
  const coverSavedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!runtimeReady || !timeline || !timeline.beats.length || typeof window.initShort !== "function" || typeof window.stillClean !== "function") {
      return;
    }
    try {
      const offscreen = document.createElement("canvas");
      window.initShort(timeline, offscreen);
      const lineCount = spec?.lines?.length ?? 0;
      const frames: string[] = [];
      const shotsPerLine: string[][] = [];
      for (let li = 0; li < lineCount; li++) {
        const beatIndices = timeline.beats.map((b, idx) => (b.lineIndex === li ? idx : -1)).filter((idx) => idx >= 0);
        const targets = beatIndices.length ? beatIndices : [Math.min(li, timeline.beats.length - 1)];
        const lineImages = targets.map((bIdx) => window.stillClean!(bIdx, 0.65));
        shotsPerLine.push(lineImages);
        frames.push(lineImages[0] ?? "");
      }
      setDrawnShots(shotsPerLine);
      setDrawnFrames(frames);

      // Save frame 0 as the project's coverFrame so the Projects card in /studio shows the real drawn frame
      const firstFrame = frames[0];
      const coverKey = `${project?.id}:${timeline.look}:${timeline.doodle ?? ""}:${firstFrame?.slice(0, 64) ?? ""}`;
      if (project?.id && firstFrame && coverSavedRef.current !== coverKey) {
        coverSavedRef.current = coverKey;
        void patchPaintedProject(project.id, { coverFrame: firstFrame }).then(setProject).catch(() => undefined);
      }
    } catch (err) {
      console.warn("Could not draw storyboard frames:", err);
    }
  }, [runtimeReady, timeline, spec?.lines?.length, project?.id]);

  // Follow final MP4 render job when on Step 4 (Render)
  const followRender = useCallback(
    async (jobId: string, projectId: string) => {
      watchingRender.current?.abort();
      const abort = new AbortController();
      watchingRender.current = abort;
      const settle = async (last: RenderJob) => {
        setJob(last);
        if (last.state === "ready" || last.state === "failed") {
          const updated = await getProject(projectId).catch(() => null);
          if (updated) setProject(updated);
          getMyTokens()
            .then((t) => setBalance(t.remaining))
            .catch(() => undefined);
        }
      };
      try {
        const finished = await watchRenderJob(jobId, setJob, abort.signal);
        await settle(finished);
      } catch {
        for (let i = 0; i < 240 && !abort.signal.aborted; i++) {
          await new Promise((r) => setTimeout(r, 4000));
          const next = await getRenderJob(jobId).catch(() => null);
          if (next) {
            setJob(next);
            if (next.state === "ready" || next.state === "failed") {
              await settle(next);
              return;
            }
          }
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!job?.id || !project?.id || job.state === "ready" || job.state === "failed") return;
    void followRender(job.id, project.id);
  }, [job?.id, job?.state, project?.id, followRender]);

  // Step 1 -> Step 2: Generate Storyboard
  const activeInputText = mode === "idea" ? ideaText : scriptText;
  const estimatedSeconds = useMemo(
    () => (timeline?.duration ? Math.ceil(timeline.duration) : mode === "script" ? paintedSeconds(scriptText) : 35),
    [timeline?.duration, mode, scriptText]
  );
  const estimatedTokens = useMemo(() => tokensFromMilli(renderCostMillitokens(estimatedSeconds)), [estimatedSeconds]);

  const handleGenerateStoryboard = async () => {
    if (!chosenLook) return;
    setSubmitting(true);
    setError(null);
    try {
      const started = await generatePaintedProjectStoryboard({
        ...(project?.id ? { projectId: project.id } : {}),
        mode,
        text: activeInputText.trim(),
        look: chosenLook.id,
        drawIn: continuous ? "opening" : "each",
        aspect,
        voice,
        ...(musicMood.trim() ? { musicMood: musicMood.trim() } : {})
      });
      setProject(started);
      setStep(STEP_STORYBOARD);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the storyboard.");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2: Inline edits to dialogue (`say`) or scene description (`scene`)
  const handleLineEdit = (index: number, patch: { say?: string; scene?: string }) => {
    if (!project?.painted?.spec) return;
    setLineEdits((prev) => ({ ...prev, [index]: { ...prev[index], ...patch } }));
    const nextLines = project.painted.spec.lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    setProject((curr) =>
      curr?.painted?.spec
        ? { ...curr, painted: { ...curr.painted, spec: { ...curr.painted.spec, lines: nextLines } } }
        : curr
    );
    if (lineSaveTimer.current) window.clearTimeout(lineSaveTimer.current);
    lineSaveTimer.current = window.setTimeout(async () => {
      if (!project?.id) return;
      try {
        const saved = await patchPaintedProject(project.id, {
          lines: [{ index, ...patch }]
        });
        setProject(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save your edit.");
      }
    }, 650);
  };

  // Changing look or drawIn on Storyboard or Animation updates immediately
  const handleChangeLookOrDrawIn = async (nextLookId: string, nextContinuous: boolean) => {
    setLook(nextLookId);
    setContinuous(nextContinuous);
    if (window.setDrawIn) window.setDrawIn(nextContinuous ? "opening" : "each");
    if (!project?.id) return;
    try {
      const saved = await patchPaintedProject(project.id, {
        look: nextLookId,
        drawIn: nextContinuous ? "opening" : "each"
      });
      setProject(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the look.");
    }
  };

  // Step 2 or Step 3: Ask AI to change 1..5 scenes
  const handleApplySceneComments = async (list: { line: number; text: string }[]) => {
    if (!project?.id || !list.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const started = await changePaintedProjectScenes(project.id, list);
      setProject(started);
      setTimedComments([]);
      setActiveCommentDraft("");
      setStoryboardAsk("");
      setPickedScenes([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the changes.");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 -> Step 3: Create Animation (in-browser animation + voiceover & music)
  const handleProceedToAnimation = async () => {
    if (!project?.id) return;
    setError(null);
    setStep(STEP_ANIMATION);
    if (project.painted?.audioVersion && !project.painted?.busy) return;
    setSubmitting(true);
    try {
      const started = await animatePaintedProject(project.id);
      setProject(started);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the animation.");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3 -> Step 4: Final Render (worker MP4 encode)
  const handleStartFinalRender = async () => {
    if (!project?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      if (audioRef.current) audioRef.current.pause();
      setPlaying(false);
      const res = await renderPaintedProject(project.id);
      setProject(res.project);
      setJob(res.job);
      setStep(STEP_RENDER);
      void followRender(res.job.id, project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the final render.");
    } finally {
      setSubmitting(false);
    }
  };

  // Step 4: Approve final video
  const handleApprove = async () => {
    if (!project?.id || approving) return;
    setApproving(true);
    setError(null);
    try {
      const saved = await approveProject(project.id);
      setProject(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve the film.");
    } finally {
      setApproving(false);
    }
  };

  // ---- Step 3 In-Browser Live Canvas Player ----
  const duration = timeline?.duration ?? 30;
  const lineTimings = useMemo(() => {
    const lines = spec?.lines ?? [];
    if (!lines.length || !timeline?.beats.length) return [];
    return lines.map((line, li) => {
      const lineBeats = timeline.beats.filter((b) => b.lineIndex === li);
      const start = lineBeats[0]?.t0 ?? (li / lines.length) * duration;
      const end = lineBeats[lineBeats.length - 1]?.t1 ?? ((li + 1) / lines.length) * duration;
      return { index: li, say: line.say, scene: line.scene, start, end };
    });
  }, [spec?.lines, timeline?.beats, duration]);

  const sceneIndexAt = useCallback(
    (seconds: number) => {
      if (!lineTimings.length) return 0;
      const found = lineTimings.findIndex((seg, idx) => seconds < seg.end || idx === lineTimings.length - 1);
      return Math.max(0, found);
    },
    [lineTimings]
  );

  const activeSceneIndex = useMemo(() => sceneIndexAt(currentTime), [sceneIndexAt, currentTime]);

  const ensureCanvasInitialized = useCallback(() => {
    if (!runtimeReady || !timeline || !canvasRef.current || typeof window.initShort !== "function") return false;
    if (canvasRef.current.dataset.initKey !== `${timeline.W}x${timeline.H}:${timeline.duration}:${timeline.look}:${timeline.doodle ?? ""}`) {
      window.initShort(timeline, canvasRef.current);
      canvasRef.current.dataset.initKey = `${timeline.W}x${timeline.H}:${timeline.duration}:${timeline.look}:${timeline.doodle ?? ""}`;
    }
    return true;
  }, [runtimeReady, timeline]);

  // Initialize and draw the in-browser player canvas whenever Step 3 (Animation) is open
  useEffect(() => {
    if (step !== STEP_ANIMATION || !ensureCanvasInitialized()) return;
    try {
      const displayTime = !playing && currentTime < 0.4 ? Math.min(1.5, duration * 0.15) : currentTime;
      window.playerFrame?.(displayTime, false);
    } catch (err) {
      console.warn("Player init error:", err);
    }
  }, [step, ensureCanvasInitialized, currentTime, playing, duration]);

  // Animation loop driven by <audio> (or wall clock fallback if audio is still loading)
  useEffect(() => {
    if (step !== STEP_ANIMATION || !playing || !runtimeReady || !timeline) return;
    let raf = 0;
    let lastDrawing = -1;
    let wallStart = performance.now() - currentTime * 1000;
    const audio = audioRef.current;
    const hasAudio = Boolean(project?.painted?.audioVersion && audio);

    const tick = () => {
      const t = hasAudio && audio && !audio.paused ? audio.currentTime : (performance.now() - wallStart) / 1000;
      if (t >= timeline.duration - 0.04) {
        if (audio) audio.pause();
        setPlaying(false);
        setCurrentTime(0);
        window.playerFrame?.(0, false);
        return;
      }
      setCurrentTime(t);
      const d = Math.floor((t * timeline.fps) / timeline.twos);
      if (d !== lastDrawing) {
        lastDrawing = d;
        try {
          window.playerFrame?.(t, false);
        } catch {
          /* ignore */
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [step, playing, runtimeReady, timeline, project?.painted?.audioVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const node = audioRef.current;
    if (node) {
      node.volume = volume;
      node.muted = muted;
    }
  }, [volume, muted, project?.painted?.audioVersion]);

  const togglePlay = () => {
    if (!timeline) return;
    const audio = audioRef.current;
    if (playing) {
      audio?.pause();
      setPlaying(false);
      return;
    }
    const nextStart = currentTime >= timeline.duration - 0.1 ? 0 : currentTime;
    setCurrentTime(nextStart);
    if (audio && project?.painted?.audioVersion) {
      audio.currentTime = nextStart;
      void audio.play().catch(() => undefined);
    }
    setPlaying(true);
  };

  const seekAnimation = (seconds: number) => {
    const clamped = Math.max(0, Math.min(seconds, duration));
    setCurrentTime(clamped);
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
    }
    if (step === STEP_ANIMATION && runtimeReady && timeline && canvasRef.current) {
      try {
        window.playerFrame?.(clamped, false);
      } catch {
        /* ignore */
      }
    }
  };

  const reachable = maxReachableStep(project);
  const groupLooks = (engine: "doodle" | "oil") => looks.filter((entry) => entry.engine === engine);
  const wordsCount = (spec?.lines ?? []).reduce((sum, l) => sum + (l.say ? l.say.trim().split(/\s+/).filter(Boolean).length : 0), 0);
  const sortedComments = useMemo(
    () => [...timedComments].sort((a, b) => a.timestampSeconds - b.timestampSeconds),
    [timedComments]
  );

  const addTimedComment = () => {
    const body = activeCommentDraft.trim();
    if (body.length < 3 || isBusy || submitting) return;
    setTimedComments((curr) => [
      ...curr,
      { id: crypto.randomUUID(), body, timestampSeconds: Math.round(currentTime * 10) / 10 }
    ]);
    setActiveCommentDraft("");
  };

  const applyTimedComments = () => {
    if (!sortedComments.length) return;
    const byLine = new Map<number, string[]>();
    for (const c of sortedComments) {
      const lineIdx = sceneIndexAt(c.timestampSeconds);
      const list = byLine.get(lineIdx) ?? [];
      list.push(c.body);
      byLine.set(lineIdx, list);
    }
    const payload = [...byLine.entries()].slice(0, 5).map(([line, texts]) => ({ line, text: texts.join(". ") }));
    void handleApplySceneComments(payload);
  };

  return (
    <main
      className="relay-shell"
      style={
        step === STEP_ANIMATION
          ? { height: "100vh", maxHeight: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }
          : undefined
      }
    >
      <div className="ambient ambient-blue" />
      <div className="ambient ambient-peach" />

      {/* 4-Step Creation Header matching /studio */}
      <header className="creation-header" style={{ flexShrink: 0 }}>
        <div className="creation-project">
          <button type="button" onClick={() => router.push("/studio")}>
            ← Projects
          </button>
          <i />
          <strong>{project?.name ?? (chosenLook ? `${chosenLook.name} story film` : "Story film")}</strong>
          <span>{project?.state ?? "Ready to create"}</span>
        </div>
        <ol className="flow-steps">
          {FLOW_STEPS.map(([id, label], position) => (
            <li key={label}>
              <button
                type="button"
                className={id === step ? "current" : id <= reachable ? "complete" : ""}
                disabled={id > reachable}
                onClick={() => {
                  if (id === STEP_ANIMATION && project && !project.painted?.audioVersion && project.painted?.busy?.phase !== "animate") {
                    void handleProceedToAnimation();
                  } else {
                    setStep(id);
                  }
                }}
              >
                <b>{id !== step && id <= reachable ? "✓" : position + 1}</b>
                {label}
              </button>
              {position !== FLOW_STEPS.length - 1 && <i />}
            </li>
          ))}
        </ol>
      </header>

      {error && (
        <div className="workspace-error" role="alert" style={{ margin: "16px 24px 0" }}>
          {error}
        </div>
      )}

      {/* ==================== STEP 1: SCRIPT & STYLE ==================== */}
      {step === STEP_SCRIPT && (
        <div className="flow-page script-style">
          <div className="flow-title">
            <h1>Script &amp; style</h1>
            <p>
              Give an idea or write your script, then choose how the story film is drawn and voiced. We build the storyboard first so you can review the dialogues and drawn frames before creating the animation.
            </p>
          </div>

          {isBusy && busy?.phase === "storyboard" && (
            <div className="ss-writing" role="status" aria-live="polite">
              <div>
                <b>
                  {BUSY_STAGES[busy.stage] ?? "Building your storyboard"} · {elapsed}s
                </b>
                <span>Usually about 30–60 seconds. We are directing the scenes and drawing your storyboard frames.</span>
              </div>
              <i>
                <em style={{ width: `${Math.min(92, Math.max(12, Math.round((elapsed / 45) * 85)))}%` }} />
              </i>
            </div>
          )}

          <div className="ss-layout">
            <div className="ss-main">
              <section className="ss-card">
                <header>
                  <b>Story script</b>
                  <span>
                    {mode === "script"
                      ? "The narrator reads your script word for word, one scene per line."
                      : "We write a warm 8–12 scene story script from your idea."}
                  </span>
                </header>
                <div className="source-tabs">
                  <button
                    type="button"
                    className={mode === "idea" ? "selected" : ""}
                    onClick={() => setMode("idea")}
                  >
                    Describe an idea
                  </button>
                  <button
                    type="button"
                    className={mode === "script" ? "selected" : ""}
                    onClick={() => setMode("script")}
                  >
                    Write my script
                  </button>
                </div>
                {mode === "idea" ? (
                  <textarea
                    id="film-idea"
                    className="script-prompt"
                    rows={5}
                    maxLength={limits.max}
                    value={ideaText}
                    onChange={(event) => setIdeaText(event.target.value)}
                    aria-label="Your story idea"
                    placeholder="Describe the story idea or topic, e.g. An old baker opens her shop at dawn on a snowy street and gives a warm loaf of bread to a boy with a bicycle."
                  />
                ) : (
                  <textarea
                    id="film-script"
                    className="script-prompt"
                    rows={8}
                    maxLength={limits.max}
                    value={scriptText}
                    onChange={(event) => {
                      setScriptText(event.target.value);
                      setEditedScript(true);
                    }}
                    aria-label="Your story script"
                    placeholder="Write your story, one sentence per line. Each line becomes one narrated scene."
                  />
                )}
                <div className="ss-row-meta">
                  <span>
                    {activeInputText.trim().length < limits.min
                      ? `Write at least ${limits.min} characters`
                      : `About ${estimatedSeconds} seconds · ${estimatedTokens} tokens at final render`}
                  </span>
                  <small>
                    {activeInputText.length}/{limits.max}
                  </small>
                </div>
              </section>

              <section className="ss-card">
                <header>
                  <b>Look</b>
                  <span>Pick how every frame of your story is drawn</span>
                </header>
                <div className="film-looks">
                  {(["doodle", "oil"] as const).map(
                    (engine) =>
                      groupLooks(engine).length > 0 && (
                        <div key={engine}>
                          <h2>{engine === "doodle" ? "Hand-drawn looks" : "Painted looks"}</h2>
                          <div className="film-look-grid">
                            {groupLooks(engine).map((entry) => (
                              <button
                                key={entry.id}
                                type="button"
                                disabled={!entry.available}
                                className={`film-look${entry.id === chosenLook?.id ? " selected" : ""}`}
                                aria-pressed={entry.id === chosenLook?.id}
                                onClick={() => setLook(entry.id)}
                                title={entry.available ? entry.blurb : "Coming soon"}
                              >
                                <img
                                  src={`/painted/${lookMedium(entry.id)}.jpg`}
                                  alt=""
                                  loading="lazy"
                                  width={90}
                                  height={160}
                                />
                                <b>{entry.name}</b>
                                <small>{entry.available ? entry.blurb : "Coming soon"}</small>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                  )}
                </div>
              </section>
            </div>

            <aside className="ss-side">
              {chosenLook && (
                <section className="ss-card">
                  <header>
                    <b>Selected style · {chosenLook.name}</b>
                    <span>{chosenLook.engine === "doodle" ? "Hand-drawn" : "Painted"}</span>
                  </header>
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <video
                      key={chosenLook.id}
                      src={`/painted/${lookMedium(chosenLook.id)}.mp4`}
                      poster={`/painted/${lookMedium(chosenLook.id)}.jpg`}
                      muted
                      loop
                      autoPlay
                      playsInline
                      style={{ width: 108, height: 192, borderRadius: 10, objectFit: "cover", background: "#111", flexShrink: 0 }}
                    />
                    <div>
                      <p style={{ margin: "0 0 8px", fontSize: 13, lineHeight: 1.5 }}>{chosenLook.blurb}</p>
                      <small style={{ color: "var(--muted)", display: "block", lineHeight: 1.45 }}>
                        1. Write or generate the script
                        <br />
                        2. Review dialogues &amp; drawn frames in Storyboard
                        <br />
                        3. Watch &amp; edit the live Animation in your browser
                        <br />
                        4. Export the final MP4 in Render
                      </small>
                    </div>
                  </div>
                </section>
              )}

              <section className="ss-card">
                <header>
                  <b>Shape &amp; motion</b>
                  <span>Canvas format and how scenes transition</span>
                </header>
                <div className="ss-field">
                  <b>Aspect ratio</b>
                  <div className="ss-chips">
                    {(["9:16", "16:9"] as const).map((ratio) => (
                      <button
                        type="button"
                        key={ratio}
                        className={aspect === ratio ? "selected" : ""}
                        onClick={() => setAspect(ratio)}
                      >
                        <i className={"ss-shape " + (ratio === "9:16" ? "portrait" : "landscape")} />
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>
                {chosenLook?.engine === "doodle" && (
                  <label className="ss-lock" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={continuous}
                      onChange={(event) => setContinuous(event.target.checked)}
                    />
                    <span>
                      <b>One continuous scene</b> Draw the scene in at the opening and carry on across cuts (uncheck to draw every scene again at each cut)
                    </span>
                  </label>
                )}
              </section>

              <section className="ss-card">
                <header>
                  <b>Narrator &amp; music</b>
                  <span>Spoken voiceover and background score</span>
                </header>
                <div className="ss-inline-fields">
                  <label>
                    <span>Narrator voice</span>
                    <select value={voice} onChange={(event) => setVoice(event.target.value)}>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label} · {v.character}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>
                      Music mood <em>optional</em>
                    </span>
                    <input
                      value={musicMood}
                      maxLength={60}
                      onChange={(event) => setMusicMood(event.target.value)}
                      placeholder="Gentle acoustic guitar and warm strings"
                    />
                  </label>
                </div>
              </section>
            </aside>
          </div>

          <div className="flow-footer">
            {isBusy && busy?.phase === "storyboard" ? (
              <span className="ss-progress">
                <i />
                {BUSY_STAGES[busy.stage] ?? "Building your storyboard"}… {elapsed}s
              </span>
            ) : (
              <span className={activeInputText.trim().length >= limits.min ? "ready" : ""}>
                <i />
                {activeInputText.trim().length < limits.min
                  ? `Write at least ${limits.min} characters to generate the storyboard.`
                  : project?.painted?.spec
                  ? "Your storyboard is saved. Continue to it, or regenerate from this script."
                  : "Ready. Generate the storyboard to see the dialogues and drawn frames."}
              </span>
            )}
            <div>
              <button type="button" className="secondary-button" onClick={() => router.push("/studio")}>
                Back
              </button>
              {project?.painted?.spec && !isBusy && (
                <button type="button" className="secondary-button" onClick={() => setStep(STEP_STORYBOARD)}>
                  Continue to storyboard
                </button>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={submitting || isBusy || !chosenLook?.available || activeInputText.trim().length < limits.min}
                onClick={() => void handleGenerateStoryboard()}
              >
                {submitting || (isBusy && busy?.phase === "storyboard")
                  ? "Generating storyboard…"
                  : project?.painted?.spec
                  ? "Regenerate storyboard"
                  : "Generate storyboard"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== STEP 2: STORYBOARD ==================== */}
      {step === STEP_STORYBOARD && (
        <div className="script-canvas">
          <header className="sc-head">
            <div>
              <h1>Storyboard</h1>
              <p role="status" aria-live="polite">
                {isBusy ? (
                  <>
                    <i className="sc-live" />
                    {BUSY_STAGES[busy?.stage ?? "directing"] ?? "Updating storyboard"}… {elapsed}s
                  </>
                ) : spec?.lines?.length ? (
                  `${spec.lines.length} scenes · ${wordsCount} spoken words · about ${Math.round(timeline?.duration ?? estimatedSeconds)}s · ${chosenLook?.name ?? look} style`
                ) : (
                  "Preparing your storyboard…"
                )}
              </p>
            </div>
            <div className="sc-actions">
              <button type="button" className="secondary-button" onClick={() => setStep(STEP_SCRIPT)}>
                Edit script &amp; look
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={submitting || !spec?.lines?.length}
                onClick={() => void handleProceedToAnimation()}
              >
                {project?.painted?.audioVersion ? "Open animation →" : "Create animation →"}
              </button>
            </div>
          </header>

          <div
            className="sc-doc-head"
            aria-hidden="true"
            style={{
              gridTemplateColumns: aspect === "9:16" ? "minmax(0, 1fr) 150px" : "minmax(0, 1fr) 280px"
            }}
          >
            <span>Dialogues &amp; scenes</span>
            <span>Drawn frames · {chosenLook?.name ?? look} style</span>
          </div>

          <ol className="sc-doc">
            {(spec?.lines ?? []).map((line, index) => {
              const isPicked = pickedScenes.includes(index);
              const shot = line.shots?.[0];
              const shotSummary = shot
                ? [shot.place, shot.room, shot.time, shot.weather && shot.weather !== "clear" ? shot.weather : null]
                    .filter(Boolean)
                    .join(" · ")
                : "meadow · day";
              const frameUrl = drawnFrames[index] ?? drawnShots[index]?.[0];
              const sayValue = lineEdits[index]?.say ?? line.say ?? "";
              const sceneValue = lineEdits[index]?.scene ?? line.scene ?? "";
              const toggleScene = () =>
                setPickedScenes((curr) =>
                  curr.includes(index) ? curr.filter((i) => i !== index) : [...curr, index].sort((a, b) => a - b)
                );

              return (
                <li
                  key={index}
                  className={`sc-beat${isBusy && !spec?.lines?.length ? " writing" : ""}${isPicked ? " picked" : ""}`}
                  style={{
                    gridTemplateColumns: aspect === "9:16" ? "minmax(0, 1fr) 150px" : "minmax(0, 1fr) 280px",
                    padding: "16px 6px",
                    alignItems: "center"
                  }}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button, textarea, input")) return;
                    const add = event.metaKey || event.ctrlKey || event.shiftKey;
                    setPickedScenes((curr) =>
                      add ? (curr.includes(index) ? curr : [...curr, index].sort((a, b) => a - b)) : [index]
                    );
                  }}
                >
                  <div className="sc-text">
                    <div className="sc-title-row">
                      <button
                        type="button"
                        className="sc-num"
                        aria-pressed={isPicked}
                        onClick={toggleScene}
                        title={isPicked ? "Remove from prompt" : "Refer to this scene in the prompt"}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </button>
                      <span className="sc-keyword" style={{ fontWeight: 600 }}>
                        Scene {index + 1} · <small style={{ fontWeight: 400, color: "var(--muted)" }}>{shotSummary}</small>
                      </span>
                      <div className="sc-beat-tools">
                        <button
                          type="button"
                          className="sc-reimagine"
                          disabled={submitting}
                          onClick={() =>
                            void handleApplySceneComments([
                              {
                                line: index,
                                text: "Reimagine this scene with a clearer, more expressive visual staging and camera angle while keeping the story continuity."
                              }
                            ])
                          }
                        >
                          Reimagine
                        </button>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>Dialogue</dt>
                        <dd>
                          <AutoTextarea
                            className="sc-line"
                            value={sayValue}
                            ariaLabel={`Scene ${index + 1} dialogue`}
                            onChange={(val) => handleLineEdit(index, { say: val })}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Visual</dt>
                        <dd>
                          <AutoTextarea
                            className="sc-visual"
                            value={sceneValue}
                            placeholder="What is drawn in this scene"
                            ariaLabel={`Scene ${index + 1} visual`}
                            onChange={(val) => handleLineEdit(index, { scene: val })}
                          />
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <figure
                    className={`sc-frame ${frameUrl ? "ready" : "sc-frame-wait"}`}
                    style={
                      aspect === "9:16"
                        ? { width: 132, height: 235, borderRadius: 12, justifySelf: "end" }
                        : { width: 280, height: 158, borderRadius: 12, justifySelf: "end" }
                    }
                  >
                    {frameUrl ? (
                      <button
                        type="button"
                        className="sc-frame-pick"
                        aria-pressed={isPicked}
                        onClick={toggleScene}
                        title={`Scene ${index + 1}`}
                      >
                        <img
                          src={frameUrl}
                          alt={`Drawn frame for scene ${index + 1}`}
                          draggable={false}
                          style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                      </button>
                    ) : (
                      <span>Drawing frame…</span>
                    )}
                  </figure>
                </li>
              );
            })}

            {isBusy && (!spec?.lines || spec.lines.length === 0) &&
              Array.from({ length: 4 }, (_, idx) => (
                <li key={`sk-${idx}`} className="sc-beat sc-skeleton" aria-hidden="true">
                  <div className="sc-text">
                    <i />
                    <i className="short" />
                    <i className="long" />
                  </div>
                  <div className="sc-frame sc-frame-wait" style={{ aspectRatio: aspect === "16:9" ? "16 / 9" : "9 / 16" }} />
                </li>
              ))}
          </ol>

          <form
            className="sc-ask"
            onSubmit={(event) => {
              event.preventDefault();
              const text = storyboardAsk.trim();
              if (text.length < 3 || isBusy || !spec?.lines?.length) return;
              const targets = pickedScenes.length ? pickedScenes : [0];
              void handleApplySceneComments(targets.map((line) => ({ line, text })));
            }}
          >
            {(pickedScenes.length > 0 || !storyboardAsk) && (
              <div className="sc-chips">
                {pickedScenes.map((index) => (
                  <span className="sc-chip" key={index}>
                    Scene {index + 1}
                    <button
                      type="button"
                      aria-label={`Stop referring to scene ${index + 1}`}
                      onClick={() => setPickedScenes((curr) => curr.filter((i) => i !== index))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {!storyboardAsk &&
                  STORYBOARD_SUGGESTIONS.map((label) => (
                    <button
                      type="button"
                      className="sc-suggest"
                      key={label}
                      disabled={isBusy || !spec?.lines?.length}
                      onClick={() => {
                        const targets = pickedScenes.length ? pickedScenes : [0];
                        void handleApplySceneComments(targets.map((line) => ({ line, text: label })));
                      }}
                    >
                      {label}
                    </button>
                  ))}
              </div>
            )}
            <div className="sc-ask-row">
              <input
                value={storyboardAsk}
                onChange={(event) => setStoryboardAsk(event.target.value)}
                disabled={isBusy || !spec?.lines?.length}
                maxLength={300}
                aria-label="Ask the AI to change a scene"
                placeholder={
                  isBusy
                    ? "Updating storyboard…"
                    : pickedScenes.length
                    ? `What should change in ${pickedScenes.length === 1 ? `Scene ${pickedScenes[0]! + 1}` : "these scenes"}?`
                    : "Click a scene above or describe what to change in Scene 1…"
                }
              />
              <button
                className="sc-send"
                type="submit"
                aria-label="Send"
                disabled={isBusy || storyboardAsk.trim().length < 3}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M10 15V5M5 10l5-5 5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== STEP 3: IN-BROWSER ANIMATION & COMMENT EDITING ==================== */}
      {step === STEP_ANIMATION && (
        <div
          style={{
            flex: "1 1 0",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: "12px 24px 16px",
            boxSizing: "border-box",
            gap: 10
          }}
        >
          {/* Top workspace row: Animation title on the left, Final render button on the far top right */}
          <div
            className="ce-heading"
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16
            }}
          >
            <div>
              <h1>Animation</h1>
              <p>Playing live in your browser — no video rendering needed. Pause, pick a moment, and comment to edit.</p>
            </div>
            <div className="ce-actions" style={{ flexShrink: 0 }}>
              <button
                type="button"
                className="ce-approve"
                disabled={isBusy || submitting || !spec?.lines?.length}
                onClick={() => void handleStartFinalRender()}
              >
                {submitting ? "Starting render…" : `Final render · ${estimatedTokens} tokens`}
              </button>
            </div>
          </div>

          <div
            className="review-workspace ce-workspace"
            style={{
              flex: "1 1 0",
              minHeight: 0,
              overflow: "hidden",
              padding: 0,
              boxSizing: "border-box",
              alignItems: "stretch"
            }}
          >
            <section
              className="ce-left"
              style={{
                height: "100%",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                overflow: "hidden"
              }}
            >
              {isBusy && (
                <div className="ce-stale" role="status" style={{ flexShrink: 0, padding: "8px 14px" }}>
                  <span>
                    <b>{BUSY_STAGES[busy?.stage ?? "voice"] ?? "Updating animation"}… ({elapsed}s)</b>{" "}
                    {busy?.phase === "animate"
                      ? "Recording the narrator and mixing background music for the browser player."
                      : "Rewriting the commented scenes and updating the live animation."}
                  </span>
                </div>
              )}

              <div
                className={"ce-player" + (aspect === "9:16" ? " portrait" : "")}
                style={{
                  flex: "1 1 0",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 10
                }}
              >
                <div
                  className="ce-stage"
                  style={{
                    position: "relative",
                    flex: "1 1 0",
                    minHeight: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden"
                  }}
                >
                  <canvas
                    id="out"
                    ref={canvasRef}
                    onClick={togglePlay}
                    style={{
                      display: "block",
                      margin: "0 auto",
                      maxWidth: "100%",
                      maxHeight: "100%",
                      height: "100%",
                      width: "auto",
                      objectFit: "contain",
                      cursor: "pointer",
                      borderRadius: 10
                    }}
                  />
                  {project?.painted?.audioVersion && project.id && (
                    <audio
                      ref={audioRef}
                      src={paintedAudioUrl(project.id, project.painted.audioVersion)}
                      preload="auto"
                      onEnded={() => setPlaying(false)}
                    />
                  )}
                  {!playing && !isBusy && <span className="ce-hint">Paused · comment on this moment</span>}
                </div>

                <div className="ce-controls" style={{ flexShrink: 0 }}>
                  <button type="button" aria-label={playing ? "Pause" : "Play"} disabled={!timeline} onClick={togglePlay}>
                    {playing ? "❚❚" : "▶"}
                  </button>
                  <span className="ce-clock">
                    <b>{formatVideoTime(currentTime)}</b> / {formatVideoTime(duration)}
                  </span>
                  <span className="ce-volume">
                    <button
                      type="button"
                      aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                      onClick={() => setMuted((m) => !m)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" stroke="none" />
                        {muted || volume === 0 ? (
                          <path d="M16 9.5l5 5M21 9.5l-5 5" />
                        ) : (
                          <>
                            <path d="M15.5 9.2a4 4 0 010 5.6" />
                            {volume >= 0.5 ? <path d="M18.3 6.5a8 8 0 010 11" /> : null}
                          </>
                        )}
                      </svg>
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={muted ? 0 : volume}
                      aria-label="Volume"
                      onChange={(event) => {
                        const v = Number(event.target.value);
                        setVolume(v);
                        setMuted(v === 0);
                      }}
                    />
                  </span>
                  {chosenLook?.engine === "doodle" && (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#d4d8e1", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={continuous}
                        onChange={(event) => void handleChangeLookOrDrawIn(look, event.target.checked)}
                      />
                      Continuous scene
                    </label>
                  )}
                  <span className="ce-scene">
                    {lineTimings[activeSceneIndex] ? `Scene ${activeSceneIndex + 1} of ${lineTimings.length}` : ""}
                  </span>
                </div>
              </div>

              <div className="ce-timeline" style={{ flexShrink: 0, padding: "10px 14px" }}>
                <header>
                  <b>Timeline</b>
                  <span>Click to jump · drag to scrub</span>
                </header>
                <div
                  className="ce-track"
                  role="slider"
                  tabIndex={0}
                  aria-label="Animation timeline"
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={Math.round(currentTime * 10) / 10}
                  aria-valuetext={formatVideoTime(currentTime)}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    scrubbingRef.current = true;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    seekAnimation(((event.clientX - bounds.left) / bounds.width) * duration);
                  }}
                  onPointerMove={(event) => {
                    if (!scrubbingRef.current) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    seekAnimation(((event.clientX - bounds.left) / bounds.width) * duration);
                  }}
                  onPointerUp={() => {
                    scrubbingRef.current = false;
                  }}
                  onPointerCancel={() => {
                    scrubbingRef.current = false;
                  }}
                >
                  <div className="ce-ruler">
                    {Array.from({ length: Math.floor(duration / rulerStep(duration)) + 1 }, (_, i) => i * rulerStep(duration)).map(
                      (s) => (
                        <span key={s} style={{ left: `${Math.min(100, (s / Math.max(duration, 0.1)) * 100)}%` }}>
                          {formatVideoTime(s)}
                        </span>
                      )
                    )}
                  </div>
                  <div className="ce-pins">
                    {sortedComments.map((comment, index) => (
                      <button
                        key={comment.id}
                        type="button"
                        title={comment.body}
                        style={{
                          left: `${Math.min(100, Math.max(0, (comment.timestampSeconds / Math.max(duration, 0.1)) * 100))}%`,
                          background: PIN_COLORS[index % PIN_COLORS.length]
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          seekAnimation(comment.timestampSeconds);
                        }}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </div>
                  <div className="ce-strip">
                    {lineTimings.map((seg, index) => (
                      <div
                        key={index}
                        style={{ flex: Math.max(0.01, seg.end - seg.start) }}
                        className={index === activeSceneIndex ? "active" : ""}
                        onClick={(event) => {
                          event.stopPropagation();
                          seekAnimation(seg.start + 0.05);
                        }}
                      >
                        <b>
                          {String(index + 1).padStart(2, "0")} · Scene {index + 1}
                        </b>
                        <small>
                          {formatVideoTime(seg.start)}–{formatVideoTime(seg.end)}
                        </small>
                      </div>
                    ))}
                  </div>
                  <i
                    className="ce-playhead"
                    style={{ left: `${Math.min(100, Math.max(0, (currentTime / Math.max(duration, 0.1)) * 100))}%` }}
                  />
                </div>
              </div>
            </section>

            <aside
              className="ce-aside"
              style={{
                height: "100%",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                overflow: "hidden"
              }}
            >
              <div className="ce-composer" style={{ flexShrink: 0, padding: 12 }}>
                <div className="ce-anchor">
                  <span className="ce-chip-time">At {formatVideoTime(currentTime)}</span>
                  <span className="ce-chip-scene">Scene {activeSceneIndex + 1}</span>
                  <button
                    type="button"
                    className="ce-add"
                    disabled={isBusy || submitting || activeCommentDraft.trim().length < 3}
                    onClick={addTimedComment}
                  >
                    Add
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={activeCommentDraft}
                  maxLength={300}
                  onChange={(event) => setActiveCommentDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      addTimedComment();
                    }
                  }}
                  placeholder="What should change here?"
                  aria-label="Review comment"
                />
                <div className="ce-examples">
                  {ANIMATION_COMMENT_EXAMPLES.map((example) => (
                    <button type="button" key={example} onClick={() => setActiveCommentDraft(example)}>
                      {example}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="ce-comments"
                style={{
                  flex: "1 1 0",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden"
                }}
              >
                <header style={{ flexShrink: 0 }}>
                  <b>Comments</b>
                  <span>{sortedComments.length} open</span>
                </header>
                <div className="ce-list" style={{ flex: "1 1 0", minHeight: 0, maxHeight: "none", overflowY: "auto" }}>
                  {sortedComments.length === 0 ? (
                    <p className="ce-empty">No comments yet. Pause the video and add one.</p>
                  ) : (
                    sortedComments.map((comment, index) => (
                      <div className="ce-comment" key={comment.id}>
                        <div>
                          <span className="ce-pin" style={{ background: PIN_COLORS[index % PIN_COLORS.length] }}>
                            {index + 1}
                          </span>
                          <button
                            type="button"
                            className="ce-when"
                            onClick={() => seekAnimation(comment.timestampSeconds)}
                          >
                            {formatVideoTime(comment.timestampSeconds)}
                          </button>
                          <small>Scene {sceneIndexAt(comment.timestampSeconds) + 1}</small>
                        </div>
                        <p>{comment.body}</p>
                        <button
                          type="button"
                          className="ce-remove"
                          aria-label="Delete comment"
                          disabled={isBusy || submitting}
                          onClick={() => setTimedComments((curr) => curr.filter((c) => c.id !== comment.id))}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <footer style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className="ce-apply"
                    disabled={isBusy || submitting || sortedComments.length === 0}
                    onClick={applyTimedComments}
                  >
                    {isBusy && busy?.phase === "changes"
                      ? "Applying with AI…"
                      : sortedComments.length
                      ? `Apply ${sortedComments.length} with AI`
                      : "Apply with AI"}
                  </button>
                  <span>Each comment becomes one proposed change.</span>
                </footer>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* ==================== STEP 4: FINAL RENDER ==================== */}
      {step === STEP_RENDER && (
        <>
          {job?.state === "ready" && job.output ? (
            <div className="review-workspace ce-workspace">
              <section className="ce-left">
                <div className="ce-heading">
                  <div>
                    <h1>Final rendered video</h1>
                    <p>Your story film has been rendered to an MP4 video. Download it or return to Animation to make further edits.</p>
                  </div>
                  <div className="ce-actions">
                    <button type="button" className="ce-download" onClick={() => setStep(STEP_ANIMATION)}>
                      ← Back to Animation
                    </button>
                    <a className="ce-download" href={outputUrl(job.output.url)} download>
                      Download MP4
                    </a>
                    {project?.state === "Approved" ? (
                      <span className="ce-locked">✓ Approved · locked</span>
                    ) : (
                      <button
                        type="button"
                        className="ce-approve"
                        disabled={approving}
                        onClick={() => void handleApprove()}
                      >
                        {approving ? "Approving…" : "Approve final"}
                      </button>
                    )}
                  </div>
                </div>
                <div className={"ce-player" + (aspect === "9:16" ? " portrait" : "")}>
                  <div className="ce-stage">
                    <video
                      src={outputUrl(job.output.url)}
                      controls
                      playsInline
                      className="film-video"
                      style={{ maxHeight: "70vh", margin: "0 auto", display: "block" }}
                    />
                  </div>
                </div>
              </section>
              <aside className="ce-aside">
                <div className="ce-comments">
                  <header>
                    <b>Story scenes</b>
                    <span>{spec?.lines?.length ?? 0} scenes</span>
                  </header>
                  <div className="ce-list">
                    {(spec?.lines ?? []).map((line, idx) => (
                      <div className="ce-comment" key={idx}>
                        <div>
                          <small>Scene {idx + 1}</small>
                        </div>
                        <p>{line.say}</p>
                      </div>
                    ))}
                  </div>
                  <footer>
                    <button type="button" className="ce-apply" onClick={() => setStep(STEP_ANIMATION)}>
                      Edit in Animation player
                    </button>
                    <span>Need a change? Edit scenes in the browser Animation player before re-rendering.</span>
                  </footer>
                </div>
              </aside>
            </div>
          ) : (
            <div className="render-workspace">
              <section className="workspace-player">
                {drawnFrames.length > 0 ? (
                  <div className="frame-reel">
                    <div className="frame-reel-stage">
                      <img src={drawnFrames[0]} alt="Storyboard frame" className="on" draggable={false} />
                    </div>
                    <ol className="frame-reel-strip">
                      {drawnFrames.map((src, i) => (
                        <li key={i}>
                          <img src={src} alt={`Scene ${i + 1}`} draggable={false} />
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <div className="scene-mock">
                    <div className="scene-copy">
                      <small>{(project?.name ?? "STORY FILM").toUpperCase()}</small>
                      <h2>Rendering your final MP4 video</h2>
                      <p>Frames are being painted and encoded on our render worker.</p>
                    </div>
                  </div>
                )}
              </section>
              <aside className="render-card">
                <header>
                  <b>{job?.state === "failed" ? "Render needs attention" : "Rendering final MP4"}</b>
                  <span>{aspect}</span>
                </header>
                {job?.state === "failed" ? (
                  <div className="render-error">
                    <b>We could not render this film.</b>
                    <p>{job.error?.message ?? "Your tokens were returned. Please try again."}</p>
                    <div className="render-error-actions">
                      <button type="button" disabled={submitting} onClick={() => void handleStartFinalRender()}>
                        {submitting ? "Starting…" : "Try again"}
                      </button>
                      <button type="button" className="render-error-back" onClick={() => setStep(STEP_ANIMATION)}>
                        Back to Animation
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="render-walkaway">
                      <b>You can walk away.</b> Final MP4 encoding keeps running on our servers whether or not this page is open. This project is saved in Projects ({balance !== null ? `${balance} tokens remaining` : ""}).
                    </p>
                    <div style={{ margin: "16px 0" }}>
                      <b>{RENDER_STAGES[job?.stage ?? "waiting"] ?? "Working"}…</b>
                      <progress max={100} value={job?.progress ?? 45} style={{ width: "100%", marginTop: 8 }} />
                    </div>
                    <button type="button" className="secondary-button" onClick={() => setStep(STEP_ANIMATION)}>
                      ← Back to browser Animation
                    </button>
                  </>
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </main>
  );
}
