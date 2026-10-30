"use client";

import { useRouter } from "next/navigation";
import { optimisticUpdate } from "../lib/optimistic";
import { useCallback, useEffect, useRef, useState, createElement } from "react";
import type { HyperframesPlayer } from "@hyperframes/player";
import { aspectToFormat, beatCountRange, scriptSeconds, bundledFonts, findGalleryTemplate, wordBudget, scriptFrameKey, voiceText, getLook, getStyleFamily, defaultTemplateId, deriveBrandTheme, findTemplate, findTheme, paintedLookById, parseScriptBrief, parseScriptStream, renderCostMillitokens, tokensFromMilli, templates, themes, type BeatPlan, type BrandKit, type ScriptBeat, type ScriptNotes, type GalleryCard, type ProjectStudioDraft, type RenderJob, type RenderStage, type RenderRequest, type ScriptBrief, type Template, type VideoProject } from "@videosaas/contracts";
import { GalleryGrid, useGalleryShelf } from "./template-gallery";
import { AppHeader } from "./app-shell";
import { StudioEditor, type StudioDraftInput } from "./studio-editor";
import { defaultBrief, ScriptStyleStep, type SiteState } from "./script-style";
import { BeatStoryboardStep, FrameCard, type FrameLook } from "./beat-storyboard";
import { ScriptCanvas, TokenModal, svgSrc, type FrameSlot, type StoryboardState, type VoiceState } from "./script-canvas";
import { createClient } from "../utils/supabase/client";
import { useMediaToken } from "../lib/use-media-token";
import { cancelPlanJob, deleteProject, ensureMediaToken, generatePlanAudio, getComposition, getGalleryTemplate, getMyTokens, getProject, planVoiceUrl, streamFrames, streamScript, streamScriptAnimate, streamScriptVoice, type ScriptFlag, addProjectReviewComment, applyProjectReviewComments, approveProject, createProject, editPlan, getRenderJob, listBrandKits, listProjects, outputUrl, projectScreenshotUrl, removeProjectReviewComment, planProject, readProductSite, removeProjectScreenshot, renderProject, saveBrandKit, saveProjectStudio, updateProject, uploadProjectScreenshot, watchRenderJob } from "../lib/api";

type View = "projects" | "create" | "studio";
type Step = 0 | 1 | 2 | 3;
// Unified 4-step flow: 1 Brief → 2 Storyboard → 3 Animation (in-browser live player & comment review) → 4 Render (final MP4 encode).
const SCRIPT_STYLE: Step = 0, STORYBOARD: Step = 1, RENDER: Step = 2, REVIEW: Step = 3;
const flowSteps: [Step, string][] = [[SCRIPT_STYLE, "Brief"], [STORYBOARD, "Storyboard"], [RENDER, "Animation"], [REVIEW, "Render"]];
const imageFor = (template: Template) => "/templates/" + template.id + ".jpg";

function statusStep(project: VideoProject): Step {
  if (project.renderJobId && (project.state === "Rendering draft" || project.state === "Approved" || project.state === "Render needs attention")) return REVIEW;
  if (project.state === "Ready for review" || project.state === "Revisions needed" || project.filmMotion?.length) return RENDER;
  if (project.beatPlan || project.brief?.scriptBeats?.length) return STORYBOARD;
  return SCRIPT_STYLE;
}

/** Motion profile → the render pipeline's existing style until motion direction ships. */
const styleFor = (profile: ScriptBrief["motionProfile"]): RenderRequest["style"] => profile === "smooth" ? "clean" : "kinetic";

/** Older projects have no brief; start one from their saved request. */
function briefFrom(project: VideoProject): ScriptBrief {
  if (project.brief) return project.brief;
  const audio = project.request.audio;
  return {
    ...defaultBrief,
    text: project.request.prompt,
    aspect: project.request.format === "portrait" ? "9:16" : "16:9",
    audio: { mode: audio?.music && audio?.voiceover ? "both" : audio?.voiceover ? "voiceover" : audio?.music ? "music" : "none", voice: audio?.voice ?? "Kore" },
    theme: project.request.theme,
    ...(project.request.brandId ? { brandId: project.request.brandId } : {})
  };
}

/** The colours and type frame cards are drawn with: the brand kit's derived theme, or the chosen gallery theme. */
/** White or near-black, whichever reads better on the brand colour (WCAG relative luminance). */
function readableOnBrand(hex: string): "#fff" | "#0a0d12" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const channel = (i: number) => { const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? "#0a0d12" : "#fff";
}

function lookFor(brief: ScriptBrief, brands: BrandKit[]): FrameLook {
  const kit = brands.find((brand) => brand.id === brief.brandId);
  const tokens = kit ? deriveBrandTheme(kit).theme.tokens : (findTheme(brief.theme ?? "neutral") ?? themes[0]!).tokens;
  return { bg: tokens.bg, fg: tokens.fg, muted: tokens.muted, brand: tokens.brand, accent: tokens.accent, font: tokens.fontDisplay };
}

/** What the person chose on Script & style is kept per project (or per unsaved draft) in this browser, so leaving and coming back by URL restores it. */
type Draft = { brief: ScriptBrief; request: RenderRequest; motionBlur: boolean; savedAt: number };
const draftKey = (id: string) => "gm-draft:" + id;
function readDraft(id: string): Draft | null {
  try { const raw = window.localStorage.getItem(draftKey(id)); const value = raw ? JSON.parse(raw) as Draft : null; return value?.brief && value.request ? value : null; } catch { return null; }
}
function writeDraft(id: string, draft: Draft) { try { window.localStorage.setItem(draftKey(id), JSON.stringify(draft)); } catch { /* Storage full or blocked: the URL still reopens the saved project. */ } }
function dropDraft(id: string) { try { window.localStorage.removeItem(draftKey(id)); } catch { /* Nothing stored. */ } }
type UrlState = { project: string | null; draft: string | null; step: Step; studio: boolean };

export function Studio() {
  const router = useRouter();
  // Re-renders the workspace (screenshots, logos, videos) when the media token arrives or renews.
  useMediaToken();
  const [view, setView] = useState<View>("projects");
  const [step, setStep] = useState<Step>(0);
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const openingProject = useRef(0);
  const mutationEpoch = useRef(0);
  const pendingMutation = useRef(false);
  const [brands, setBrands] = useState<BrandKit[]>([]);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [request, setRequest] = useState<RenderRequest>({ prompt: "", format: "landscape", style: "clean", theme: findTemplate(defaultTemplateId)!.defaultTheme, template: defaultTemplateId, audio: { music: false, voiceover: false, voice: "Kore" } });
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Chosen on the storyboard's Submit; kept for a retry or a re-render. Previews never use it.
  const [motionBlur, setMotionBlur] = useState(false);
  const [brief, setBrief] = useState<ScriptBrief>(defaultBrief);
  const [planWarnings, setPlanWarnings] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [site, setSite] = useState<SiteState>({ reading: false, shots: 0, warnings: [] });
  const template = findTemplate(request.template) ?? findTemplate(defaultTemplateId)!;
  // The address names the open project (?p=) or an unsaved draft (?d=), plus the step, so a reload or a later visit lands back here.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // The script canvas (see writeScript below): declared early because the plan watcher reads it.
  /** `writing`: the beat the words are streaming into (a scoped change writes only its beats). */
  type Canvas = { beats: ScriptBeat[]; previous: ScriptBeat[]; open: keyof ScriptBeat | null; writing: number | null; scoped?: boolean; /** The writer's idea and worked example, shared by every frame and change. */ notes?: ScriptNotes | null; streaming: boolean; startedAt: number; firstAt?: number; flags: ScriptFlag[]; error: string | null };
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const wanted = useRef<UrlState | null>(null);

  const refresh = useCallback(async () => {
    const epoch = mutationEpoch.current;
    const [projectResult, brandResult] = await Promise.allSettled([listProjects(), listBrandKits()]);
    const failures: string[] = [];
    if (projectResult.status === "fulfilled") {
      const savedProjects = projectResult.value;
      if (epoch === mutationEpoch.current && !pendingMutation.current) setProjects(savedProjects);
      setProjectsLoaded(true);
      // Keep the open project in step with the server (e.g. "Rendering draft" → "Ready for review").
      if (epoch === mutationEpoch.current && !pendingMutation.current) setProject((current) => current ? savedProjects.find((item) => item.id === current.id && item.updatedAt !== current.updatedAt) ?? current : current);
    } else failures.push(projectResult.reason instanceof Error ? projectResult.reason.message : "Could not load projects.");
    if (brandResult.status === "fulfilled") setBrands(brandResult.value);
    else failures.push("Could not refresh brand kits.");
    setLoadError(failures.join(" ") || null);
    setLoadingProjects(false);
  }, []);
  useEffect(() => { void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the workspace.")); }, [refresh]);
  // Polling while a script is written or a video renders reads only the open project, not every project and brand kit.
  const refreshOpen = useCallback(async (id: string) => {
    const epoch = mutationEpoch.current;
    const saved = await getProject(id);
    if (epoch !== mutationEpoch.current || pendingMutation.current) return;
    setProject((current) => current?.id === saved.id && current.updatedAt !== saved.updatedAt ? saved : current);
    setProjects((current) => current.map((item) => item.id === saved.id ? saved : item));
  }, []);
  const openId = project?.id;
  // A finished render's project is marked by a queue consumer just after the job (render-finished); read it until it is.
  const settleProject = useCallback(async (id: string) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const epoch = mutationEpoch.current;
        const saved = await getProject(id);
        if (epoch === mutationEpoch.current && !pendingMutation.current) {
          setProject((current) => current?.id === saved.id ? saved : current);
          setProjects((current) => current.map((item) => item.id === saved.id ? saved : item));
        }
        if (saved.state !== "Rendering draft") return;
      } catch { /* The next look may succeed; the job itself is already shown. */ }
      await new Promise((resolve) => window.setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }, []);
  // A running render is followed as the server pushes it. If the stream drops, a slow poll keeps the page current while the
  // stream reconnects. The project row is large (storyboard, frames, motion), so it is read once, when the render ends.
  const jobId = job?.id;
  const jobLive = Boolean(job && !["ready", "failed"].includes(job.state));
  useEffect(() => {
    if (!jobId || !jobLive) return;
    const controller = new AbortController();
    let poll: number | undefined;
    let retry: number | undefined;
    let wait = 3000;
    const take = (next: RenderJob) => {
      if (controller.signal.aborted) return;
      setJob(next);
      if ((next.state === "ready" || next.state === "failed") && openId) void settleProject(openId);
    };
    const follow = () => {
      watchRenderJob(jobId, (next) => { wait = 3000; window.clearInterval(poll); poll = undefined; take(next); }, controller.signal).catch(() => {
        if (controller.signal.aborted) return;
        poll ??= window.setInterval(async () => { try { take(await getRenderJob(jobId)); } catch { /* Keep the last known server state visible. */ } }, 15_000);
        retry = window.setTimeout(follow, wait);
        wait = Math.min(wait * 2, 60_000);
      });
    };
    follow();
    return () => { controller.abort(); window.clearInterval(poll); window.clearTimeout(retry); };
  }, [jobId, jobLive, openId, settleProject]);
  // A render that finishes while its page is open moves on to Review. Opening a finished project does not: the address says where to land.
  const jobWas = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = jobWas.current;
    jobWas.current = job?.state;
    if (job?.state === "ready" && before !== undefined && before !== "ready" && step === RENDER) setStep(REVIEW);
  }, [job?.state, step]);
  // The script director runs on the server, so it keeps going if this page is closed; the project says whether it is still writing.
  // A job record older than the director's own deadline means the server restarted and lost it.
  const planning = project?.planning;
  const running = planning?.status === "running" && Date.now() - Date.parse(planning.startedAt) < 270_000;
  const generating = starting || running;
  const watching = useRef<string | null>(null);
  useEffect(() => {
    if (step !== SCRIPT_STYLE) setConfirmRegenerate(false);
    window.scrollTo(0, 0);
  }, [step, view]);
  // Elapsed time is counted from the server's start time, so it is right after leaving and coming back.
  useEffect(() => {
    if (!generating) return;
    const base = planning?.startedAt ? Date.parse(planning.startedAt) : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - base) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [generating, planning?.startedAt]);
  useEffect(() => {
    if (!running || !openId) return;
    const timer = window.setInterval(() => { void refreshOpen(openId).catch(() => undefined); }, 2000);
    return () => window.clearInterval(timer);
  }, [running, openId, refreshOpen]);
  // Watch a job we started (or found running); when it ends, show the storyboard, or say why not.
  // A storyboard built behind the script canvas is not watched: the page stays on the script until the person continues.
  useEffect(() => { if (running && planning && !canvas && !project?.brief?.scriptBeats?.length) watching.current = planning.startedAt; }, [running, planning, canvas, project?.brief?.scriptBeats?.length]);
  useEffect(() => {
    if (!watching.current || starting || running) return;
    watching.current = null;
    if (planning?.status === "failed") setError(planning.error ?? "Could not write the script.");
    // Still "running" past the deadline: the server restarted and lost the job. Say so instead of quietly resetting.
    else if (planning?.status === "running") setError("Writing was interrupted because our service restarted. Generate again; nothing was charged.");
    else if (planning?.status !== "cancelled" && project?.beatPlan && !project.brief?.scriptBeats?.length) { setPlanWarnings([]); setStep(STORYBOARD); }
  }, [project, planning, starting, running]);

  const replaceProject = useCallback((saved: VideoProject) => {
    setProject(saved);
    setProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
  }, []);
  // A drawing-style change on an existing storyboard is saved straight away (visual only, no replanning), so the
  // preview and the render use it.
  const savedLook = project?.brief?.look ?? "clean";
  const chosenLook = brief.look ?? "clean";
  const savedFamily = project?.brief?.styleFamily ?? null;
  const chosenFamily = brief.styleFamily ?? null;
  useEffect(() => {
    if (!project?.beatPlan || !project.brief || (chosenLook === savedLook && chosenFamily === savedFamily)) return;
    void editPlan(project.id, { look: chosenLook, styleFamily: chosenFamily }).then(replaceProject).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not save the drawing style."));
  }, [project?.id, project?.beatPlan, project?.brief, chosenLook, savedLook, chosenFamily, savedFamily, replaceProject]);

  const saveProject = useCallback(async (patch: Partial<Pick<VideoProject, "name" | "state" | "request" | "script" | "approvedAt">>) => {
    if (!project) return null;
    const saved = await updateProject(project.id, patch);
    replaceProject(saved);
    return saved;
  }, [project, replaceProject]);

  const saveStudio = useCallback(async (draft: StudioDraftInput): Promise<VideoProject> => {
    if (!project) throw new Error("Choose a project before opening Studio.");
    const saved = await saveProjectStudio(project.id, draft satisfies Pick<ProjectStudioDraft, "values" | "assets">);
    replaceProject(saved);
    return saved;
  }, [project, replaceProject]);
  /** Starts a new brief. A gallery entry or a style passes `preset`, so the prompt, skill, look, length and sound arrive filled in. */
  const begin = async (templateId?: string, preset?: Partial<ScriptBrief>) => {
    ++openingProject.current;
    const selected = templateId ? findTemplate(templateId) : template;
    if (!selected) return;
    const nextRequest = { ...request, template: selected.id, theme: selected.defaultTheme };
    setRequest(nextRequest);
    setBrief({ ...defaultBrief, theme: selected.defaultTheme, ...preset });
    setSite({ reading: false, shots: 0, warnings: [] });
    setPlanWarnings([]);
    setProject(null);
    setDraftId(crypto.randomUUID());
    setJob(null);
    setError(null);
    setStep(SCRIPT_STYLE);
    setView("create");
  };
  // A card carries no prompt: the backend returns the starting values (prompt, skill, look, length, sound) for the one chosen.
  const [galleryBusy, setGalleryBusy] = useState(false);
  const beginFromGallery = async (item: { id: string }) => {
    setGalleryBusy(true);
    try {
      const picked = await getGalleryTemplate(item.id);
      await begin(picked.starterId, picked.brief);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open that template."); }
    finally { setGalleryBusy(false); }
  };
  // The landing page sends visitors here as /studio?template=<id> after sign-up; open that template's brief once.
  const startedFromUrl = useRef(false);
  useEffect(() => {
    if (startedFromUrl.current) return;
    startedFromUrl.current = true;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("template");
    if (id) {
      window.history.replaceState(null, "", window.location.pathname);
      setRestored(true);
      void beginFromGallery({ id });
      return;
    }
    const stepParam = Number(params.get("step"));
    const step = (Number.isInteger(stepParam) && stepParam >= 0 && stepParam <= REVIEW ? stepParam : SCRIPT_STYLE) as Step;
    const studio = params.get("view") === "studio";
    const draft = params.get("d");
    if (draft && /^[0-9a-f-]{36}$/i.test(draft)) {
      const saved = readDraft(draft);
      if (saved) {
        setDraftId(draft);
        setRequest(saved.request);
        setBrief(saved.brief);
        setMotionBlur(saved.motionBlur);
        setStep(SCRIPT_STYLE);
        setView("create");
      }
      setRestored(true);
      return;
    }
    const projectId = params.get("p");
    if (projectId) { wanted.current = { project: projectId, draft: null, step, studio }; return; }
    setRestored(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A project named in the address opens once the list has loaded, at the step the URL names (never past what it has reached).
  useEffect(() => {
    const target = wanted.current;
    if (!target || !projectsLoaded) return;
    wanted.current = null;
    const found = projects.find((item) => item.id === target.project);
    if (found) {
      void openProject(found);
      const reached = found.beatPlan ? Math.max(statusStep(found), STORYBOARD) : statusStep(found);
      setStep(Math.min(target.step, reached) as Step);
      if (target.studio && found.script) setView("studio");
    }
    setRestored(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsLoaded, projects]);
  // Keep the address in step with where the person is.
  useEffect(() => {
    if (!restored) return;
    const id = project?.id ?? draftId;
    const params = new URLSearchParams();
    if (view !== "projects" && id) {
      params.set(project ? "p" : "d", id);
      params.set("step", String(step));
      if (view === "studio") params.set("view", "studio");
    }
    const query = params.toString();
    const next = window.location.pathname + (query ? "?" + query : "");
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, "", next);
  }, [restored, view, step, project?.id, draftId]);
  // Save the brief as it is edited.
  useEffect(() => {
    if (!restored || view === "projects") return;
    const id = project?.id ?? draftId;
    if (id) writeDraft(id, { brief, request, motionBlur, savedAt: Date.now() });
  }, [restored, view, project?.id, draftId, brief, request, motionBlur]);
  const openProject = async (saved: VideoProject) => {
    if (saved.painted) {
      router.push(`/film?p=${encodeURIComponent(saved.id)}`);
      return;
    }
    const opening = ++openingProject.current;
    setProject(saved);
    setRequest(saved.request);
    // Choices made after the last save (and not yet generated) are kept in this browser; they win when newer.
    const draft = readDraft(saved.id);
    const newer = draft && draft.savedAt >= Date.parse(saved.updatedAt);
    setBrief(newer ? draft.brief : briefFrom(saved));
    if (newer) setMotionBlur(draft.motionBlur);
    setDraftId(null);
    // The brand found on the site isn't stored (only offered for review), so a reopened project shows the facts and shots.
    setSite({ reading: false, site: saved.site ?? null, brand: null, shots: saved.screenshots.filter((shot) => shot.name.startsWith("Site · ")).length, warnings: [] });
    setPlanWarnings([]);
    setError(null);
    setStep(statusStep(saved));
    setView("create");
    if (saved.renderJobId) {
      setJob(null);
      try { const nextJob = await getRenderJob(saved.renderJobId); if (opening === openingProject.current) setJob(nextJob); } catch { /* The project stays open while its render status is unavailable. */ }
    } else setJob(null);
  };
  const openStudio = () => {
    if (!project?.script) {
      setError("Generate the script and storyboard before opening Studio.");
      return;
    }
    setError(null);
    setView("studio");
  };
  const openProjectStudio = async (saved: VideoProject) => {
    if (!saved.script) {
      setError("Generate the script and storyboard before opening Studio.");
      return;
    }
    void openProject(saved);
    setView("studio");
  };
  /** The render request the current pipeline still reads, kept in step with the brief. */
  const requestFromBrief = (current: RenderRequest, next: ScriptBrief): RenderRequest => {
    const prompt = next.text.trim().replace(/\s+/g, " ").slice(0, 600);
    return {
      ...current,
      prompt: prompt.length >= 12 ? prompt : current.prompt.length >= 12 ? current.prompt : "Draft product video",
      format: aspectToFormat(next.aspect),
      style: styleFor(next.motionProfile),
      theme: next.theme ?? current.theme,
      brandId: next.brandId
    };
  };
  /** Projects are created on first need (a screenshot upload or Generate), so nothing empty is saved. */
  const ensureProject = async (): Promise<VideoProject> => {
    if (project) return project;
    const nextRequest = requestFromBrief(request, brief);
    const name = (brief.productName?.trim() || brief.text.trim().split(/[.!?\n]/)[0]?.slice(0, 80) || "Untitled video").trim();
    const created = await createProject({ name, request: nextRequest });
    setRequest(nextRequest);
    if (draftId) { dropDraft(draftId); setDraftId(null); }
    replaceProject(created);
    return created;
  };
  const generatePlan = async () => {
    const checked = parseScriptBrief(brief);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const active = await ensureProject();
      const nextRequest = requestFromBrief(active.request, brief);
      await updateProject(active.id, { request: nextRequest });
      setRequest(nextRequest);
      const result = await planProject(active.id, { ...checked.brief, screenshotIds: active.screenshots.map((shot) => shot.id) });
      watching.current = result.project.planning?.startedAt ?? null;
      replaceProject(result.project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not write the script.");
    } finally {
      setStarting(false);
    }
  };
  // ---------- Script canvas: the script streams in first; the storyboard is built from it in the background ----------
  const [continueWhenReady, setContinueWhenReady] = useState(false);
  const canvasStop = useRef<AbortController | null>(null);
  // Reference frames, cached by what they draw (scriptFrameKey): a beat the AI did not change keeps its frame, and frames
  // saved on the project are seeded in when it opens, so reopening does not redraw them. `frameAt` remembers the
  // last drawing at each position, shown (marked stale) after an edit until it is redrawn.
  const frameCache = useRef<Record<string, FrameSlot>>({});
  const [frameAt, setFrameAt] = useState<Record<number, string>>({});
  const [, setFrameTick] = useState(0);
  const frameKey = (beat: ScriptBeat) => scriptFrameKey(beat, brief);
  const putFrames = (entries: [string, FrameSlot][]) => { for (const [key, slot] of entries) frameCache.current[key] = slot; setFrameTick((tick) => tick + 1); };
  /** Draws the frames for `indices` (skipping ones drawn or drawing unless `force`), streaming each in as it lands. */
  const notesRef = useRef<ScriptNotes | null>(null);
  const drawFrames = (active: VideoProject, beats: ScriptBeat[], indices: number[], force = false) => {
    const checked = parseScriptBrief(brief);
    if ("error" in checked) return;
    const todo = indices.filter((i) => beats[i] && (force || !frameCache.current[frameKey(beats[i]!)] || frameCache.current[frameKey(beats[i]!)]!.state === "failed"));
    if (todo.length === 0) return;
    putFrames(todo.map((i) => [frameKey(beats[i]!), { state: "drawing", ...(frameCache.current[frameKey(beats[i]!)]?.svg ? { svg: frameCache.current[frameKey(beats[i]!)]!.svg } : {}) }]));
    void streamFrames(active.id, { brief: checked.brief, beats, indices: todo, ...(notesRef.current ? { notes: notesRef.current } : {}) }, ({ index, svg, error }) => {
      if (!beats[index]) return;
      putFrames([[frameKey(beats[index]!), svg ? { state: "ready", svg } : { state: "failed", error: error ?? "Could not draw this frame." }]]);
      if (svg) setFrameAt((current) => ({ ...current, [index]: svg }));
    }).catch((caught) => {
      const message = caught instanceof Error ? caught.message : "Could not draw the frames.";
      putFrames(todo.map((i) => frameKey(beats[i]!)).filter((key) => frameCache.current[key]?.state === "drawing").map((key) => [key, { state: "failed", error: message }]));
    });
  };
  /** Builds the storyboard from the script (its words fixed) as a server job; the page stays on the script. */
  const buildStoryboard = async (active: VideoProject, beats: ScriptBeat[], notes: ScriptNotes | null = notesRef.current) => {
    const checked = parseScriptBrief(brief);
    if ("error" in checked) return;
    try { replaceProject((await planProject(active.id, { ...checked.brief, scriptBeats: beats, ...(notes ? { scriptNotes: notes } : {}), screenshotIds: active.screenshots.map((shot) => shot.id) })).project); }
    catch (caught) { setCanvas((current) => current && { ...current, error: caught instanceof Error ? caught.message : "Could not start the storyboard." }); }
  };
  /** Streams a new script, or with `instruction` a changed one, into the canvas. */
  // Every AI version of a beat is kept (Reimagine, or a change to picked beats) so the person can go back to one.
  const [versions, setVersions] = useState<Record<number, { list: ScriptBeat[]; at: number }>>({});
  /** Streams a new script, or with `instruction` a changed one; with `only`, just those beats are rewritten. */
  const writeScript = async (instruction?: string, override?: Partial<ScriptBrief>, only?: number[]) => {
    const checked = parseScriptBrief(override ? { ...brief, ...override } : brief);
    if ("error" in checked) { setError(checked.error); return; }
    setError(null);
    const previous = instruction && canvas ? canvas.beats : [];
    setStep(STORYBOARD);
    const scope = instruction && only?.length ? only : undefined;
    const notes = instruction ? canvas?.notes ?? null : null;
    setCanvas({ beats: previous, previous, notes, open: null, writing: scope ? scope[0]! : null, scoped: Boolean(scope), streaming: true, startedAt: Date.now(), flags: [], error: null });
    canvasStop.current?.abort();
    const stop = new AbortController();
    canvasStop.current = stop;
    try {
      const active = await ensureProject();
      const nextRequest = requestFromBrief(active.request, brief);
      void updateProject(active.id, { request: nextRequest }).then(() => setRequest(nextRequest)).catch(() => undefined);
      let text = "";
      let early = false;
      const result = await streamScript(active.id, { brief: checked.brief, ...(instruction ? { change: { instruction, previous, notes, ...(scope ? { only: scope } : {}) } } : {}) }, (piece) => {
        text += piece;
        const parsed = parseScriptStream(text);
        if (scope) {
          // Only the picked beats are written: each streamed beat goes to its place, and every other beat stays as it is.
          const writing = parsed.beats.length ? scope[parsed.beats.length - 1] ?? null : scope[0]!;
          setCanvas((current) => current && { ...current, beats: current.previous.map((beat, i) => scope.includes(i) ? parsed.beats[scope.indexOf(i)] ?? beat : beat), open: parsed.open, writing, firstAt: current.firstAt ?? Date.now() });
          return;
        }
        // The plan (IDEA, EXAMPLE) comes before the first beat, so the early frames already share the example.
        if (parsed.notes.example) notesRef.current = parsed.notes;
        // A beat is complete once the next one starts: the first four go to the artist while the rest are still being written.
        if (!early && parsed.beats.length > 4) { early = true; drawFrames(active, parsed.beats.slice(0, 4), [0, 1, 2, 3]); }
        // A change streams the whole script again: beats not rewritten yet keep showing their current words.
        setCanvas((current) => current && { ...current, beats: [...parsed.beats, ...current.previous.slice(parsed.beats.length)], open: parsed.open, writing: parsed.beats.length ? parsed.beats.length - 1 : null, firstAt: current.firstAt ?? Date.now() });
      }, stop.signal);
      notesRef.current = result.notes;
      setCanvas((current) => current && { ...current, beats: result.beats, notes: result.notes, previous: [], open: null, writing: null, streaming: false, flags: result.flags });
      setVersions((current) => {
        if (!scope) return {};
        const next = { ...current };
        for (const i of scope) {
          const entry = current[i] ?? { list: [previous[i]!], at: 0 };
          const list = [...entry.list];
          list[entry.at] = previous[i]!;
          next[i] = { list: [...list, result.beats[i]!], at: list.length };
        }
        return next;
      });
      void buildStoryboard(active, result.beats, result.notes);
      drawFrames(active, result.beats, result.beats.map((_, i) => i));
    } catch (caught) {
      if (stop.signal.aborted) { setCanvas((current) => current && { ...current, streaming: false, open: null, writing: null, beats: scope ? current.previous : current.beats.length ? current.beats : current.previous }); return; }
      setCanvas((current) => current && { ...current, streaming: false, open: null, writing: null, beats: current.previous.length ? current.previous : current.beats, error: caught instanceof Error ? caught.message : "Could not write the script." });
    }
  };
  /** Reimagine: a new way to show one beat (the way a scoped change improved beat 8), kept beside the earlier versions. */
  const reimagineBeat = (index: number) => {
    if (!canvas) return;
    const tried = (versions[index]?.list ?? [canvas.beats[index]!]).map((beat) => beat.visual).filter(Boolean);
    void writeScript([
      "Reimagine this beat. Show its idea with a more vivid, concrete visual: objects that transform, split, stack or move to make the point, in the template's style.",
      "Rewrite its voiceover so it lands as a small reveal and still flows from the beat before into the beat after.",
      "Keep its place in the story and the film's example; keep the key phrase and on-screen words unless the new visual needs different ones.",
      tried.length ? `Do something different from these earlier visuals: ${tried.map((visual) => `"${visual}"`).join("; ")}.` : ""
    ].join(" "), undefined, [index]);
  };
  /** Shows another kept version of a beat; the one on screen (with any hand edits) is kept in its place. */
  const showVersion = (index: number, at: number) => {
    const entry = versions[index];
    if (!canvas || !entry || !entry.list[at]) return;
    const list = [...entry.list];
    list[entry.at] = canvas.beats[index]!;
    setVersions((current) => ({ ...current, [index]: { list, at } }));
    setCanvas((current) => current && { ...current, beats: current.beats.map((beat, i) => i === index ? list[at]! : beat), flags: current.flags.filter((flag) => flag.beat !== index) });
  };
  /** "Fit to N s": rewrites the script to the chosen length and holds later changes to it. */
  const fitScript = () => {
    const range = beatCountRange(brief.durationSeconds, brief.pace, brief.styleFamily);
    const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
    setBrief((current) => ({ ...current, lockDuration: true }));
    void writeScript(`Fit the whole script to about ${brief.durationSeconds} seconds: ${range.min}–${range.max} beats${voiced ? ` and at most ${wordBudget(brief.durationSeconds, brief.pace)} spoken words in total` : ""}. Keep the hook, the key idea, the essential steps of the example and the payoff; merge or cut the rest, and keep the lines flowing into each other.`, { lockDuration: true });
  };
  const editScriptBeat = (index: number, patch: Partial<ScriptBeat>) => setCanvas((current) => current && { ...current, beats: current.beats.map((beat, i) => i === index ? { ...beat, ...patch } : beat), flags: current.flags.filter((flag) => flag.beat !== index) });
  // The storyboard is "ready" only while it still carries the script's exact words; any edit makes it stale.
  const planMatchesScript = (plan: BeatPlan | undefined, beats: ScriptBeat[]) => Boolean(plan && plan.beats.length === beats.length && plan.beats.every((beat, i) => beat.keyword === beats[i]!.keyword && (beat.on_screen ?? null) === beats[i]!.onScreen && (beat.line ?? null) === beats[i]!.line));
  const visualsMatch = (beats: ScriptBeat[]) => (project?.brief?.scriptBeats ?? []).length === beats.length && project!.brief!.scriptBeats!.every((beat, i) => (beat.visual ?? null) === (beats[i]!.visual ?? null));
  const storyboardState: StoryboardState = !canvas || canvas.streaming
    ? { state: "waiting" }
    : running ? { state: "building", ...(planning?.startedAt ? { startedAt: Date.parse(planning.startedAt) } : {}) }
    : planning?.status === "failed" ? { state: "failed", error: planning.error ?? "Could not build the storyboard." }
    : project?.beatPlan ? { state: planMatchesScript(project.beatPlan, canvas.beats) && visualsMatch(canvas.beats) ? "ready" : "stale", plan: project.beatPlan }
    : { state: "waiting" };
  const continueFromScript = () => {
    if (!canvas || !project) return;
    if (storyboardState.state === "ready") { setStep(STORYBOARD); return; }
    setContinueWhenReady(true);
    if (storyboardState.state !== "building") void buildStoryboard(project, canvas.beats);
  };
  useEffect(() => {
    if (continueWhenReady && storyboardState.state === "ready") { setContinueWhenReady(false); setStep(STORYBOARD); }
    if (continueWhenReady && storyboardState.state === "failed") setContinueWhenReady(false);
  }, [continueWhenReady, storyboardState.state]);
  // Confirm script → voiceover. Streams takes scene-by-scene in parallel immediately (without waiting for beatPlan).
  const [voiceRun, setVoiceRun] = useState<{ state: "idle" | "storyboard" | "voicing" | "failed"; error?: string }>({ state: "idle" });
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [voicingIndices, setVoicingIndices] = useState<number[]>([]);
  const [voiceErrors, setVoiceErrors] = useState<Record<number, string>>({});
  const [streamedTakeFiles, setStreamedTakeFiles] = useState<Record<string, string>>({});
  const [streamedMusicReady, setStreamedMusicReady] = useState(false);

  // Smoothly advance the progress bar between server events so the user sees continuous 0 -> 100 feedback
  useEffect(() => {
    if (voiceRun.state !== "voicing") return;
    const timer = window.setInterval(() => {
      setVoiceProgress((curr) => (curr < 92 ? curr + 1 : curr));
    }, 350);
    return () => window.clearInterval(timer);
  }, [voiceRun.state]);

  const voicedBrief = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  // Takes are matched by their words, so a beat the person did not change keeps its take after another beat is edited.
  const voiceTakes = (canvas?.beats ?? []).map((beat) => {
    const text = voiceText(beat.line);
    if (!text || !project) return null;
    const streamedFile = streamedTakeFiles[text];
    if (streamedFile) return planVoiceUrl(project.id, streamedFile);
    const take = project.planAudio?.voice?.lines.find((line) => line.text === text);
    return take ? planVoiceUrl(project.id, take.file) : null;
  });
  // The film's sound is ready when every line has its take and, if the brief has music, the bed exists: only then can it render.
  const musicBrief = brief.audio.mode === "music" || brief.audio.mode === "both";
  const hasMusicBed = Boolean(project?.planAudio?.music) || streamedMusicReady;
  const allVoiced = Boolean(canvas?.beats.length) && canvas!.beats.every((beat, i) => !voiceText(beat.line) || Boolean(voiceTakes[i])) && (!musicBrief || hasMusicBed);
  const voice: VoiceState = {
    state: voiceRun.state === "voicing" ? "voicing" : voiceRun.state === "failed" ? "failed" : allVoiced ? "ready" : voiceRun.state,
    takes: voiceTakes,
    progress: voiceProgress,
    busyIndices: voicingIndices,
    errors: voiceErrors,
    ...(voiceRun.error ? { error: voiceRun.error } : {})
  };
  const recordVoice = async (active: VideoProject, indices?: number[], force = false) => {
    if (!canvas) return;
    const checked = parseScriptBrief(brief);
    if ("error" in checked) {
      setVoiceRun({ state: "failed", error: checked.error });
      return;
    }
    const targetIndices = indices ?? canvas.beats.map((_, i) => i).filter((i) => Boolean(voiceText(canvas.beats[i]?.line)));
    setVoiceRun({ state: "voicing" });
    setVoiceProgress(3);
    setVoicingIndices(targetIndices);
    if (indices) {
      setVoiceErrors((curr) => {
        const next = { ...curr };
        for (const idx of indices) delete next[idx];
        return next;
      });
    } else {
      setVoiceErrors({});
    }
    try {
      const updated = await streamScriptVoice(
        active.id,
        {
          brief: checked.brief,
          beats: canvas.beats,
          ...(indices ? { indices } : {}),
          ...(force ? { force: true } : {}),
          includeMusic: !indices && musicBrief
        },
        (ev) => {
          if (typeof ev.progress === "number") {
            setVoiceProgress((curr) => Math.max(curr, ev.progress));
          }
          if (ev.type === "take") {
            const text = voiceText(canvas.beats[ev.index]?.line);
            if (text) {
              setStreamedTakeFiles((curr) => ({ ...curr, [text]: ev.file }));
            }
            setVoicingIndices((curr) => curr.filter((i) => i !== ev.index));
          } else if (ev.type === "take-error") {
            setVoicingIndices((curr) => curr.filter((i) => i !== ev.index));
            setVoiceErrors((curr) => ({ ...curr, [ev.index]: ev.error }));
          } else if (ev.type === "music") {
            setStreamedMusicReady(true);
          } else if (ev.type === "done" && ev.project) {
            replaceProject(ev.project);
          }
        }
      );
      if (updated) replaceProject(updated);
      setVoicingIndices([]);
      setVoiceProgress(100);
      setVoiceRun({ state: "idle" });
    } catch (caught) {
      setVoicingIndices([]);
      setVoiceRun({ state: "failed", error: caught instanceof Error ? caught.message : "Could not record the voiceover." });
    }
  };
  const confirmScript = () => {
    if (!canvas || !project) return;
    void recordVoice(project);
    if (storyboardState.state !== "ready" && storyboardState.state !== "building") {
      void buildStoryboard(project, canvas.beats);
    }
  };
  const retryVoice = (index?: number) => {
    if (!canvas || !project) return;
    if (typeof index === "number") {
      void recordVoice(project, [index], true);
      return;
    }
    const missingOrFailed = canvas.beats
      .map((b, i) => (voiceText(b.line) && (!voiceTakes[i] || voiceErrors[i]) ? i : -1))
      .filter((i) => i >= 0);
    if (missingOrFailed.length > 0) {
      void recordVoice(project, missingOrFailed, true);
    } else {
      void recordVoice(project, undefined, true);
    }
  };
  // Step 2 (Storyboard) -> Step 3 (Animation): prepares ONLY the in-browser animation (no MP4 worker encoding!),
  // streaming 0 -> 100% progress as missing frames, voiceover/music, and per-scene SVG motion finish in parallel.
  const [animating, setAnimating] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [animStage, setAnimStage] = useState<"frames" | "voice" | "motion">("motion");
  const [animScenesDone, setAnimScenesDone] = useState<number[]>([]);
  const [animError, setAnimError] = useState<string | null>(null);
  const [animVersion, setAnimVersion] = useState(0);

  useEffect(() => {
    if (!animating) return;
    const timer = window.setInterval(() => {
      setAnimProgress((curr) => (curr < 94 ? curr + 1 : curr));
    }, 350);
    return () => window.clearInterval(timer);
  }, [animating]);

  const needsSound = voicedBrief || musicBrief;
  const startBrowserAnimation = async (beatsOverride?: ScriptBeat[]) => {
    const activeBeats = beatsOverride ?? canvas?.beats;
    if (!activeBeats?.length || !project) return;
    const checked = parseScriptBrief(brief);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setError(null);
    setAnimError(null);
    setStep(RENDER);
    setAnimating(true);
    setAnimProgress(4);
    setAnimStage("frames");
    setAnimScenesDone([]);
    try {
      const updated = await streamScriptAnimate(
        project.id,
        { brief: checked.brief, beats: activeBeats },
        (ev) => {
          if ("progress" in ev && typeof ev.progress === "number") {
            setAnimProgress((curr) => Math.max(curr, ev.progress));
          }
          if (ev.type === "stage") {
            setAnimStage(ev.stage);
          } else if (ev.type === "frame") {
            setAnimStage("frames");
          } else if (ev.type === "voice" || ev.type === "music") {
            setAnimStage("voice");
          } else if (ev.type === "motion") {
            setAnimStage("motion");
            setAnimScenesDone((curr) => (curr.includes(ev.index) ? curr : [...curr, ev.index]));
          } else if (ev.type === "done" && ev.project) {
            replaceProject(ev.project);
          }
        }
      );
      if (updated) replaceProject(updated);
      setAnimProgress(100);
      setAnimVersion((v) => v + 1);
    } catch (caught) {
      setAnimError(caught instanceof Error ? caught.message : "Could not prepare the browser animation.");
    } finally {
      setAnimating(false);
    }
  };
  const renderFromScript = () => {
    void startBrowserAnimation();
  };
  // The Render or Review step without a job in hand (a reload mid-render, an approved project reopened, or state lost) picks up
  // the project's own render, so an approved film can still be watched.
  useEffect(() => {
    if (step !== REVIEW || job || !project?.renderJobId) return;
    let live = true;
    getRenderJob(project.renderJobId).then((found) => { if (live) setJob(found); }).catch(() => undefined);
    return () => { live = false; };
  }, [step, job, project?.renderJobId]); // eslint-disable-line react-hooks/exhaustive-deps
  const frameSlots = (canvas?.beats ?? []).map((beat, i): FrameSlot | undefined => {
    const slot = frameCache.current[frameKey(beat)];
    if (slot) return slot.svg || slot.state !== "drawing" || frameAt[i] === undefined ? slot : { state: "drawing", svg: frameAt[i] };
    return frameAt[i] !== undefined ? { state: "stale", svg: frameAt[i] } : undefined;
  });
  // A project reopened after its script was written opens on its script.
  useEffect(() => {
    if (!canvas && project?.brief?.scriptBeats?.length) notesRef.current = project.brief?.scriptNotes ?? null;
    // Older projects have a plan but no script beats: their script page is built from the plan's own words.
    const planned = project?.beatPlan && !project.brief?.scriptBeats?.length ? project.beatPlan.beats.map((beat) => ({ keyword: beat.keyword, visual: null, onScreen: beat.on_screen ?? null, line: beat.line ?? null })) : null;
    if (!canvas && planned) setCanvas({ beats: planned, notes: null, previous: [], open: null, writing: null, streaming: false, startedAt: Date.now(), flags: [], error: null });
    if (!canvas && project?.brief?.scriptBeats?.length) setCanvas({ beats: project.brief.scriptBeats, notes: project.brief.scriptNotes ?? null, previous: [], open: null, writing: null, streaming: false, startedAt: Date.now(), flags: [], error: null });
    if (!project) { canvasStop.current?.abort(); setCanvas(null); }
    frameCache.current = {}; setFrameAt({}); setVoiceRun({ state: "idle" }); setVersions({});
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The project list leaves the frames out, so only a fuller copy adds to the cache; nothing here removes from it.
  useEffect(() => {
    const saved = (project?.scriptFrames ?? []).filter((frame) => frameCache.current[frame.key]?.state !== "ready");
    if (saved.length) putFrames(saved.map((frame) => [frame.key, { state: "ready", svg: frame.svg }]));
  }, [project?.id, project?.scriptFrames]); // eslint-disable-line react-hooks/exhaustive-deps
  // Frames for a script that was never drawn here (a reopened project): drawn once, not after every edit.
  useEffect(() => {
    if (!canvas || canvas.streaming || !project) return;
    const missing = canvas.beats.map((_, i) => i).filter((i) => frameAt[i] === undefined && !frameCache.current[frameKey(canvas.beats[i]!)]);
    if (missing.length) drawFrames(project, canvas.beats, missing);
  }, [project?.id, canvas?.streaming, canvas?.beats.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Stops the director on the server; the brief stays as it is. */
  const cancelPlan = async () => {
    if (!project) return;
    watching.current = null;
    try { replaceProject((await cancelPlanJob(project.id)).project); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not cancel the script."); }
  };
  /** Reads the product site: facts for the director, a brand to review, and section screenshots on the project. */
  const readSite = async (url: string) => {
    setSite((current) => ({ ...current, reading: true, error: null, warnings: [] }));
    try {
      const active = await ensureProject();
      const result = await readProductSite(active.id, url);
      replaceProject(result.project);
      // A kit already saved for this site is selected, unless the user picked one for this project.
      // A kit the previous read chose automatically doesn't count as the user's pick.
      const userPicked = Boolean(brief.brandId && !(site.autoKit && site.savedBrand?.id === brief.brandId));
      const autoKit = Boolean(result.savedBrand && !userPicked);
      setSite({ reading: false, site: result.site, brand: result.brand, savedBrand: result.savedBrand, autoKit, shots: result.screenshots.length, warnings: result.warnings });
      // The director only uses the site when productUrl matches its host; send the normalised https URL.
      setBrief((current) => ({
        ...current,
        productUrl: result.site.url,
        ...(!current.productName && (result.savedBrand?.name ?? result.brand?.name) ? { productName: result.savedBrand?.name ?? result.brand?.name } : {}),
        ...(autoKit && result.savedBrand ? { brandId: result.savedBrand.id } : !userPicked ? { brandId: undefined } : {})
      }));
    } catch (caught) {
      setSite((current) => ({ ...current, reading: false, error: caught instanceof Error ? caught.message : "Could not read that website." }));
    }
  };
  const uploadScreenshot = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const active = await ensureProject();
      const saved = await uploadProjectScreenshot(active.id, file);
      setProject(saved);
      setProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload the screenshot.");
    } finally {
      setBusy(false);
    }
  };
  const removeScreenshot = async (screenshotId: string) => {
    if (!project) return;
    setBusy(true);
    setError(null);
    try { replaceProject(await removeProjectScreenshot(project.id, screenshotId)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove the screenshot."); }
    finally { setBusy(false); }
  };
  const submit = async (): Promise<boolean> => {
    if (!project) return false;
    setBusy(true);
    setError(null);
    setJob(null);
    setStep(REVIEW);
    try {
      if (project.script && !project.script.confirmed) replaceProject(await updateProject(project.id, { script: { ...project.script, confirmed: true, updatedAt: new Date().toISOString() } }));
      const started = await renderProject(project.id, { motionBlur });
      setJob(started);
      // The server has marked the project as rendering this job; mirror it here instead of reading the project back.
      const rendering = (item: VideoProject) => item.id === project.id ? { ...item, state: "Rendering draft" as const, renderJobId: started.id } : item;
      setProject((current) => current && rendering(current));
      setProjects((current) => current.map(rendering));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the render.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (!project) return;
    const saved = await approveProject(project.id);
    setProject(saved);
    setProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
  };
  // Patch only comments so a response cannot replace a newly opened project or newer editor fields.
  const changeComments = async (comments: VideoProject["comments"], persist: () => Promise<VideoProject>) => {
    if (!project) return;
    if (pendingMutation.current) throw new Error("Please wait for the current save to finish.");
    const before = project;
    pendingMutation.current = true;
    ++mutationEpoch.current;
    const patch = (next: VideoProject["comments"], state?: VideoProject["state"]) => {
      const apply = (item: VideoProject) => item.id === before.id ? { ...item, comments: next, ...(state ? { state } : {}) } : item;
      setProject((current) => current ? apply(current) : current);
      setProjects((current) => current.map(apply));
    };
    try {
      await optimisticUpdate({
        apply: () => patch(comments),
        persist,
        reconcile: (saved) => patch(saved.comments, saved.state),
        rollback: () => patch(before.comments)
      });
    } finally {
      pendingMutation.current = false;
      ++mutationEpoch.current;
    }
  };
  const addReviewComment = async (input: { body: string; timestampSeconds: number }) => {
    if (!project) return;
    await changeComments([...project.comments, { ...input, id: "pending-" + crypto.randomUUID(), createdAt: new Date().toISOString() }], () => addProjectReviewComment(project.id, input));
  };
  const removeReviewComment = async (commentId: string) => {
    if (!project) return;
    await changeComments(project.comments.filter((comment) => comment.id !== commentId), () => removeProjectReviewComment(project.id, commentId));
  };
  const applyReviewComments = async () => {
    if (!project) return;
    setError(null);
    const result = await applyProjectReviewComments(project.id);
    setProject(result.project);
    setProjects((current) => [result.project, ...current.filter((item) => item.id !== result.project.id)]);
    setJob(result.job);
    setStep(RENDER);
  };

  return <main
    className="relay-shell"
    style={
      view === "create" && (step === RENDER || step === REVIEW)
        ? { height: "100vh", maxHeight: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }
        : undefined
    }
  >
    <div className="ambient ambient-blue" /><div className="ambient ambient-peach" />
    {view === "studio" ? project ? <StudioEditor
      project={project}
      initialValues={project.studio ? undefined : job?.revision.values}
      onSave={saveStudio}
      onRender={async () => { if (await submit()) setView("create"); }}
      onBack={() => setView("create")}
      screenshotUrl={projectScreenshotUrl}
    /> : null : view === "create" ? <><CreationHeader name={project?.name ?? "Untitled video"} state={project?.state ?? "Ready to create"} step={step} back={() => setView("projects")} reachable={project ? Math.max(step, statusStep(project), project.beatPlan || canvas ? STORYBOARD : SCRIPT_STYLE) : step} go={(target) => setStep(target as Step)} openStudio={project?.script && !project.beatPlan ? openStudio : undefined} />
      {error && step !== SCRIPT_STYLE && !(step === STORYBOARD && canvas) && step !== RENDER && step !== REVIEW && <p className="workspace-error">{error}</p>}
      {step === STORYBOARD && canvas && <ScriptCanvas
        beats={canvas.beats} open={canvas.open} streaming={canvas.streaming} startedAt={canvas.startedAt} firstAt={canvas.firstAt} flags={canvas.flags} error={canvas.error ?? error}
        voiced={voicedBrief}
        length={{ seconds: brief.durationSeconds, pace: brief.pace, locked: Boolean(brief.lockDuration) }}
        onFit={fitScript}
        onEdit={editScriptBeat} onAsk={(instruction, only) => void writeScript(instruction, undefined, only)} writing={canvas.writing} scoped={Boolean(canvas.scoped)}
        versions={canvas.beats.map((_, i) => versions[i] ? { count: versions[i]!.list.length, at: versions[i]!.at } : null)}
        onReimagine={reimagineBeat} onVersion={showVersion} onCancel={() => canvasStop.current?.abort()}
        frames={frameSlots} aspect={brief.aspect} styleName={findGalleryTemplate(brief.styleExample)?.name}
        onRedraw={(index) => { if (project) drawFrames(project, canvas.beats, [index], true); }}
        voice={voice} onConfirm={confirmScript} onRetryVoice={retryVoice} music={musicBrief}
        onRender={renderFromScript} rendering={busy || animating}
        storyboard={storyboardState} onContinue={continueFromScript} continuing={continueWhenReady} />}
      {step === STORYBOARD && !canvas && <div className="flow-page"><div className="flow-title"><h1>No storyboard yet.</h1><p>Describe the film in the brief, then generate the storyboard.</p></div><button className="primary-button" onClick={() => setStep(SCRIPT_STYLE)}>Go to the brief</button></div>}
      {step === SCRIPT_STYLE && <ScriptStyleStep brief={brief} update={(patch) => setBrief((current) => ({ ...current, ...patch }))} site={site} readSite={(url) => void readSite(url)} screenshots={<Screenshots project={project} busy={busy} upload={uploadScreenshot} remove={removeScreenshot} />} generating={generating && !canvas} elapsed={elapsed} error={error} generate={() => void writeScript()} cancel={() => void cancelPlan()} hasPlan={Boolean(project?.beatPlan || canvas)} confirmRegenerate={confirmRegenerate} setConfirmRegenerate={setConfirmRegenerate} continueToStoryboard={() => setStep(STORYBOARD)} back={() => setView("projects")} />}
      {step === RENDER && project && <BrowserAnimationStep
        project={project}
        beats={canvas?.beats ?? []}
        frames={frameSlots.map((slot) => slot?.svg).filter((svg): svg is string => Boolean(svg))}
        aspect={brief.aspect}
        animating={animating}
        animProgress={animProgress}
        animStage={animStage}
        animScenesDone={animScenesDone}
        animError={animError ?? error}
        animVersion={animVersion}
        busy={busy}
        onRetryAnimate={() => void startBrowserAnimation()}
        onBackToStoryboard={() => setStep(STORYBOARD)}
        onStartFinalRender={() => void submit()}
        onApplySceneComments={async (items) => {
          if (!canvas || !items.length) return;
          const instruction = items.map((c) => `Scene ${c.line + 1}: ${c.text}`).join("\n");
          const only = [...new Set(items.map((c) => c.line))];
          await writeScript(instruction, undefined, only);
        }}
      />}
      {step === REVIEW && project && <FinalRenderStep
        project={project}
        job={job}
        frames={frameSlots.map((slot) => slot?.svg).filter((svg): svg is string => Boolean(svg))}
        aspect={brief.aspect}
        look={lookFor(brief, brands)}
        error={error}
        busy={busy}
        retry={async () => { await submit(); }}
        backToAnimation={() => setStep(RENDER)}
        approve={approve}
      />}
    </> : <><AppHeader active="projects" />
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {loadError && <div className="workspace-error" role="alert">{loadError} <button disabled={loadingProjects} onClick={() => { setLoadingProjects(true); void refresh(); }}>{loadingProjects ? "Retrying…" : "Try again"}</button></div>}
      {view === "projects" && <Projects brands={brands} projects={projects} loading={loadingProjects} loaded={projectsLoaded} busy={busy} create={() => void begin()} startTemplate={(item) => void beginFromGallery(item)} browseTemplates={() => router.push("/templates")} open={(item) => void openProject(item)} openStudio={(item) => void openProjectStudio(item)} archive={async (item, nextArchived) => { const saved = await updateProject(item.id, { archived: nextArchived }); setProjects((current) => current.map((entry) => (entry.id === item.id ? saved : entry))); }} remove={async (item) => { await deleteProject(item.id); setProjects((current) => current.filter((entry) => entry.id !== item.id)); }} />}
    </>}
  </main>;
}

function CreationHeader({ name, state, step, reachable, back, go, openStudio }: { name: string; state: string; step: Step; reachable: number; back: () => void; go: (step: number) => void; openStudio?: () => void }) {
  return <header className="creation-header"><div className="creation-project"><button onClick={back}>← Projects</button><i /><strong>{name}</strong><span>{state}</span>{openStudio && <button className="creation-studio" style={{ marginLeft: "auto", padding: "6px 10px", border: "1px solid var(--d-bd-d6e4f2)", borderRadius: 999, background: "var(--d-bg-ffffff)", color: "var(--d-tx-0058bd)" }} onClick={openStudio}>Open Studio</button>}</div><ol className="flow-steps">{flowSteps.map(([id, label], position) => <li key={label}><button className={id === step ? "current" : id <= reachable ? "complete" : ""} disabled={id > reachable} onClick={() => go(id)}><b>{id !== step && id <= reachable ? "✓" : position + 1}</b>{label}</button>{position !== flowSteps.length - 1 && <i />}</li>)}</ol></header>;
}

/** The first templates, shown under the empty Projects page. Fetched from the backend: one row that fades out, so it feels like a library. */
function TemplateShelf({ startTemplate, browseTemplates, busy }: { startTemplate: (item: GalleryCard) => void; browseTemplates: () => void; busy: boolean }) {
  const { items, loading } = useGalleryShelf({ limit: 10 });
  return <div className="gallery-shelf"><div className="gallery-shelf-head"><div><h2>Start from a template</h2><p>Each one fills in the script prompt, structure and style for you. Edit anything before you generate.</p></div><button className="secondary-button" onClick={browseTemplates}>Browse all templates</button></div><GalleryGrid row onMore={browseTemplates} items={items} onUse={startTemplate} busy={busy} loading={loading} skeletons={4} /></div>;
}

function Projects({ brands, projects, loading, loaded, busy, create, startTemplate, browseTemplates, open, openStudio, archive, remove }: { projects: VideoProject[]; loading: boolean; loaded: boolean; busy: boolean; create: () => void; startTemplate: (item: GalleryCard) => void; browseTemplates: () => void; open: (project: VideoProject) => void; openStudio: (project: VideoProject) => void; archive: (project: VideoProject, archived: boolean) => Promise<void>; remove: (project: VideoProject) => Promise<void>; brands: BrandKit[] }) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [deletingProject, setDeletingProject] = useState<VideoProject | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const activeProjects = projects.filter((item) => !item.archived);
  const archivedProjects = projects.filter((item) => Boolean(item.archived));
  const groups = {
    All: activeProjects,
    Drafts: activeProjects.filter((item) => !["Ready for review", "Approved"].includes(item.state)),
    Review: activeProjects.filter((item) => item.state === "Ready for review"),
    Approved: activeProjects.filter((item) => item.state === "Approved"),
    ...(archivedProjects.length > 0 || filter === "Archived" ? { Archived: archivedProjects } : {})
  };
  const visibleProjects = groups[filter as keyof typeof groups] ?? activeProjects;
  const confirmDelete = async () => {
    if (!deletingProject || deletingBusy) return;
    setDeletingBusy(true);
    setDeleteError(null);
    try {
      await remove(deletingProject);
      setDeletingProject(null);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Could not delete the project.");
    } finally {
      setDeletingBusy(false);
    }
  };
  return <section className="page-container"><div className="page-heading"><div><h1>Projects</h1><p>Turn product updates into customer-ready videos.</p></div><div><button className="primary-button" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create a video"}</button></div></div><div className="filter-tabs">{Object.entries(groups).map(([label, items]) => <button key={label} className={filter === label ? "selected" : ""} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label} {(loaded || projects.length > 0) && <span>{items?.length ?? 0}</span>}</button>)}</div>{projects.length === 0 && !loaded ? loading ? <ProjectSkeletons /> : <div className="workspace-message" role="status">Projects could not be loaded. Use Try again above.</div> : projects.length === 0 ? <><div className="empty-workspace"><b>No projects yet.</b><p>Create a video to save a real brief, script, screenshots, and render history, or start from a template below.</p><button className="primary-button" onClick={create}>Create a video</button></div><TemplateShelf startTemplate={startTemplate} browseTemplates={browseTemplates} busy={busy} /></> : <div className="project-grid">{visibleProjects.length === 0 && <p role="status">No projects in this view.</p>}{visibleProjects.map((project) => <ProjectCard brands={brands} key={project.id} project={project} open={open} openStudio={openStudio} onArchive={() => void archive(project, !project.archived)} onDelete={() => { setDeleteError(null); setDeletingProject(project); }} menuOpen={openMenuId === project.id} setMenuOpen={(next) => setOpenMenuId(next ? project.id : null)} />)}</div>}
    {deletingProject && <div className="sc-modal-backdrop" onClick={() => { if (!deletingBusy) setDeletingProject(null); }}>
      <div className="sc-modal" role="dialog" aria-modal="true" aria-labelledby="delete-project-title" style={{ width: "min(440px, 100%)" }} onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="delete-project-title">Delete project?</h2>
          <button type="button" className="sc-modal-close" aria-label="Close" disabled={deletingBusy} onClick={() => setDeletingProject(null)}>×</button>
        </header>
        <p className="sc-modal-sum">Are you sure you want to delete <b>{deletingProject.name}</b>? This will permanently remove its storyboard, scenes, and rendered video.</p>
        {deleteError && <p className="sc-modal-error" role="alert">{deleteError}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
          <button type="button" className="secondary-button" disabled={deletingBusy} onClick={() => setDeletingProject(null)}>Cancel</button>
          <button type="button" className="primary-button" disabled={deletingBusy} style={{ background: "#dc2626", borderColor: "#dc2626", color: "#fff" }} onClick={() => void confirmDelete()}>{deletingBusy ? "Deleting…" : "Delete project"}</button>
        </div>
      </div>
    </div>}
  </section>;
}

/** Placeholder cards shaped like ProjectCard, so the grid is there before the projects arrive. */
function ProjectSkeletons() {
  return <div className="project-grid" role="status" aria-busy="true" aria-label="Loading your projects">{Array.from({ length: 3 }, (_, index) => <article className="project-card project-skeleton" key={index} aria-hidden="true"><span className="card-image" /><div className="project-content"><i /><i className="short" /><div className="project-meta"><i className="pill" /><i className="date" /></div></div></article>)}</div>;
}

function ProjectCard({ brands, project, open, openStudio, onArchive, onDelete, menuOpen, setMenuOpen }: { project: VideoProject; open: (project: VideoProject) => void; openStudio: (project: VideoProject) => void; onArchive: () => void; onDelete: () => void; menuOpen: boolean; setMenuOpen: (next: boolean) => void; brands: BrandKit[] }) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const template = findTemplate(project.request.template);
  const image = project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : imageFor(template ?? templates[0]);
  const firstBeat = project.beatPlan?.beats[0];
  // A project started from the gallery keeps the default starter in request.template, so name and length come from the brief and plan.
  const paintedLook = project.painted ? paintedLookById(project.painted.look) : undefined;
  const kind = project.painted ? `Story film · ${paintedLook?.name ?? project.painted.look}` : getStyleFamily(project.brief?.styleFamily)?.name ?? template?.name ?? "Template";
  // The real length once rendered, else the script's estimate, else the target the brief asked for.
  const seconds = project.filmSeconds ?? (project.painted?.timeline?.duration ? Math.round(project.painted.timeline.duration) : null) ?? (project.brief?.scriptBeats?.length ? scriptSeconds(project.brief.scriptBeats, project.brief.pace) : null) ?? project.beatPlan?.target_duration_s ?? project.brief?.durationSeconds ?? template?.durationSeconds ?? 0;
  const status = project.state === "Approved" ? "approved" : project.state === "Ready for review" ? "review" : "draft";
  const choose = (action: () => void) => { setMenuOpen(false); action(); };
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionsRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen, setMenuOpen]);
  return <article className={menuOpen ? "project-card menu-open" : "project-card"}><button className="card-image" onClick={() => open(project)}>{project.coverFrame ? <i className="card-frame"><img className="card-cover" src={svgSrc(project.coverFrame)} alt="" draggable={false} /></i> : firstBeat && project.brief ? <i className="card-frame"><FrameCard family={project.brief.styleFamily} beat={firstBeat} index={0} canvas={project.beatPlan!.canvas} look={lookFor(project.brief, brands)} lookId={project.brief.look ?? "clean"} screenshot={firstBeat.kind === "ui" && project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : undefined} /></i> : project.brief && !project.screenshots[0] ? <i className="card-placeholder">{kind}</i> : <img src={image} alt="" />}<span className="card-badge">{project.request.format === "portrait" ? "9:16" : "16:9"} · {Math.floor(seconds / 60)}:{String(Math.round(seconds % 60)).padStart(2, "0")}</span></button><div className="project-content"><div className="project-title"><h2>{project.name}</h2><p>{kind} · {project.request.brandId ? "Brand kit" : "No branding"}</p></div><div className="project-actions" ref={actionsRef}><button className="dots" type="button" aria-label={`Project actions for ${project.name}`} aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(!menuOpen)}><span className="dots-mark" aria-hidden="true"><i /><i /><i /></span></button>{menuOpen && <div className="project-menu" role="menu" aria-label={`Actions for ${project.name}`}><button type="button" role="menuitem" onClick={() => choose(() => open(project))}>Open project</button>{project.script && !project.beatPlan && <button type="button" role="menuitem" onClick={() => choose(() => openStudio(project))}>Open Studio</button>}<button type="button" role="menuitem" onClick={() => choose(onArchive)}>{project.archived ? "Unarchive project" : "Archive project"}</button><button type="button" role="menuitem" className="danger" onClick={() => choose(onDelete)}>Delete project</button></div>}</div><div className="project-meta"><b className={"status " + status}>{project.state}</b><time>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(project.updatedAt))}</time></div></div></article>;
}

function Screenshots({ project, busy, upload, remove }: { project: VideoProject | null; busy: boolean; upload: (file: File) => Promise<void>; remove: (id: string) => Promise<void> }) {
  const screenshots = project?.screenshots ?? [];
  const [viewing, setViewing] = useState<string | null>(null);
  const viewedIndex = screenshots.findIndex((shot) => shot.id === viewing);
  const viewed = project && viewedIndex >= 0 ? screenshots[viewedIndex] : undefined;
  return <aside className="screenshots-panel"><header><b>Screenshots</b><span>Drag to reorder</span></header><label className="drop-zone"><b>Drop screenshots here or <em>browse</em></b><small>PNG or JPG · at least 640 px wide</small><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} disabled={busy} /></label><ul>{project && screenshots.map((screenshot) => <li key={screenshot.id}><button type="button" className="shot-open" aria-label={"View " + screenshot.name} onClick={() => setViewing(screenshot.id)}><img className="shot-preview" src={projectScreenshotUrl(project.id, screenshot.id)} alt="" /></button><div><b>{screenshot.name}</b><small>✓ {screenshot.width} × {screenshot.height}</small></div><span>{screenshot.name.startsWith("Site · ") ? "From site" : screenshot.purpose}</span><button onClick={() => void remove(screenshot.id)}>×</button></li>)}</ul>{screenshots.length === 0 && <p className="empty-list">{project ? "No screenshots uploaded yet." : "Adding the first screenshot saves this project."} Product screens become the UI beats.</p>}{project && viewed && <ShotViewer name={viewed.name} size={viewed.width + " × " + viewed.height} src={projectScreenshotUrl(project.id, viewed.id)} position={viewedIndex + 1} total={screenshots.length} step={(by) => setViewing(screenshots[(viewedIndex + by + screenshots.length) % screenshots.length]!.id)} onClose={() => setViewing(null)} />}</aside>;
}

/** A screenshot at reading size, in a modal the person closes with ×, Esc or a click outside, and pages through with the arrow buttons or ← →. */
function ShotViewer({ name, size, src, position, total, step, onClose }: { name: string; size: string; src: string; position: number; total: number; step: (by: number) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); }, []);
  const arrow = (by: number, label: string, path: string) => <button type="button" className={"shot-arrow " + (by < 0 ? "prev" : "next")} aria-label={label} onClick={() => step(by)}><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d={path} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg></button>;
  return <dialog ref={dialog} className="shot-dialog" aria-label={name} onClose={onClose}
    onKeyDown={(event) => { if (total < 2) return; if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); } else if (event.key === "ArrowRight") { event.preventDefault(); step(1); } }}
    onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
    <button type="button" className="gallery-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg></button>
    {total > 1 && arrow(-1, "Previous screenshot", "M11 3L5 9l6 6")}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={name} />
    {total > 1 && arrow(1, "Next screenshot", "M7 3l6 6-6 6")}
    <p><b>{name}</b><span>{total > 1 ? position + " / " + total + " · " : ""}{size}</span></p>
  </dialog>;
}

const renderSteps: { key: string; label: string; stages: RenderStage[] }[] = [
  { key: "plan", label: "Writing the storyboard", stages: ["queued", "planning"] },
  { key: "audio", label: "Making music and voiceover", stages: ["audio"] },
  { key: "wait", label: "Getting your video ready", stages: ["waiting"] },
  { key: "prepare", label: "Preparing composition", stages: ["preparing", "retrying"] },
  { key: "frames", label: "Rendering frames", stages: ["frames"] },
  { key: "encode", label: "Adding audio and encoding", stages: ["encoding"] }
];

type RenderPrep = "sound" | "scenes" | "motion" | null;

/** The storyboard's own frames while the film renders: one large, stepping through them, and the whole strip below. */
function FrameReel({ frames }: { frames: string[] }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (frames.length < 2) return;
    const timer = window.setInterval(() => setAt((current) => (current + 1) % frames.length), 2500);
    return () => window.clearInterval(timer);
  }, [frames.length]);
  return <div className="frame-reel">
    <div className="frame-reel-stage">{frames.map((svg, i) => <img key={i} className={i === at ? "on" : ""} src={svgSrc(svg)} alt={i === at ? `Storyboard frame ${i + 1} of ${frames.length}` : ""} draggable={false} />)}</div>
    <ol className="frame-reel-strip">{frames.map((svg, i) => <li key={i}><button type="button" aria-label={`Show frame ${i + 1}`} aria-current={i === at} onClick={() => setAt(i)}><img src={svgSrc(svg)} alt="" draggable={false} /></button></li>)}</ol>
  </div>;
}

function formatVideoTime(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return Math.floor(wholeSeconds / 60) + ":" + String(wholeSeconds % 60).padStart(2, "0");
}

const pinColors = ["#168BFF", "#FF5A1F", "#7C5CFF", "#16803C", "#B45309", "#0B1F4D"];
const commentExamples = [
  "Make this headline shorter.",
  "Use a clearer diagram here.",
  "Show this step for a bit longer.",
  "Make the transition smoother.",
  "Explain this idea with a simpler example."
];

function rulerStep(duration: number) {
  return [1, 2, 5, 10, 15, 30, 60].find((step) => duration / step <= 6) ?? 120;
}

/**
 * Step 3 (Animation): Vertically locked (100vh) in-browser animation & review workspace.
 * While preparing, shows the compact FrameReel on the left and a 0->100% progress bar + parallel per-scene
 * animation checklist on the right. Once ready, plays the live HyperFrames animation in the browser
 * (zero MP4 encoding) with timestamped comments and the top-right "Final render" button.
 */
function BrowserAnimationStep({
  project,
  beats,
  frames,
  aspect,
  animating,
  animProgress,
  animStage,
  animScenesDone,
  animError,
  animVersion,
  busy,
  onRetryAnimate,
  onBackToStoryboard,
  onStartFinalRender,
  onApplySceneComments
}: {
  project: VideoProject;
  beats: ScriptBeat[];
  frames: string[];
  aspect: string;
  animating: boolean;
  animProgress: number;
  animStage: "frames" | "voice" | "motion";
  animScenesDone: number[];
  animError: string | null;
  animVersion: number;
  busy: boolean;
  onRetryAnimate: () => void;
  onBackToStoryboard: () => void;
  onStartFinalRender: () => void;
  onApplySceneComments: (items: { line: number; text: string }[]) => Promise<void>;
}) {
  const playerRef = useRef<HyperframesPlayer | null>(null);
  const scrubbingRef = useRef(false);
  const autoTriggered = useRef(false);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(project.beatPlan?.target_duration_s ?? project.brief?.durationSeconds ?? 30);
  const [beatSpans, setBeatSpans] = useState<{ label: string; start: number; end: number }[]>([]);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [draft, setDraft] = useState("");
  const [timedComments, setTimedComments] = useState<{ id: string; body: string; timestampSeconds: number }[]>([]);
  const [applyingComments, setApplyingComments] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [buyingTokens, setBuyingTokens] = useState(false);

  useEffect(() => {
    let live = true;
    void import("@hyperframes/player")
      .then(() => {
        if (live) setPlayerLoaded(true);
      })
      .catch(() => undefined);
    getMyTokens()
      .then((t) => {
        if (live) setBalance(t.remaining);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // If the user jumped to Step 3 (Animation) before beatPlan was built, kick off the parallel animation preparation once
  useEffect(() => {
    if (!project.beatPlan && beats.length > 0 && !animating && !animError && !autoTriggered.current) {
      autoTriggered.current = true;
      onRetryAnimate();
    }
  }, [project.beatPlan, beats.length, animating, animError, onRetryAnimate]);

  // Load the live HyperFrames composition HTML (/api/preview/plans/:id) once animation preparation finishes
  useEffect(() => {
    if (animating || !project.beatPlan) return;
    let live = true;
    const controller = new AbortController();
    setPreviewError(null);
    void (async () => {
      try {
        const comp = await getComposition(project.id);
        const token = encodeURIComponent(await ensureMediaToken());
        const res = await fetch(`${comp.baseUrl.replace(/^\/v1\/preview\//, "/api/preview/")}?t=${token}&v=${animVersion}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`Preview returned ${res.status}.`);
        const html = await res.text();
        if (!live) return;
        setDuration(comp.durationSeconds || project.beatPlan?.target_duration_s || 30);
        const spans = (project.beatPlan?.beats ?? []).map((b, i) => {
          const bt = comp.beatTimes?.[b.id];
          return {
            label: b.keyword || `Scene ${i + 1}`,
            start: bt?.start ?? (i / Math.max(1, project.beatPlan!.beats.length)) * comp.durationSeconds,
            end: bt?.end ?? ((i + 1) / Math.max(1, project.beatPlan!.beats.length)) * comp.durationSeconds
          };
        });
        setBeatSpans(spans);
        setPreviewHtml(html);
      } catch (caught) {
        if (!live || controller.signal.aborted) return;
        setPreviewError(caught instanceof Error ? caught.message : "Could not load the browser animation.");
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [animating, project.id, project.beatPlan, animVersion]);

  // Wire <hyperframes-player> events and srcdoc
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerLoaded || !previewHtml) return;
    const onReady = (ev: Event) => {
      const d = (ev as CustomEvent<{ duration: number }>).detail?.duration;
      if (typeof d === "number" && d > 0) setDuration(d);
    };
    const onTime = (ev: Event) => {
      if (!scrubbingRef.current) {
        const t = (ev as CustomEvent<{ currentTime: number }>).detail?.currentTime;
        if (typeof t === "number") setCurrentTime(t);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    player.addEventListener("ready", onReady);
    player.addEventListener("timeupdate", onTime);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    player.setAttribute("srcdoc", previewHtml);
    player.muted = muted;
    player.volume = volume;
    return () => {
      player.removeEventListener("ready", onReady);
      player.removeEventListener("timeupdate", onTime);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
    };
  }, [playerLoaded, previewHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.muted = muted;
    player.volume = volume;
  }, [muted, volume]);

  const togglePlay = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.muted = muted;
      player.volume = volume;
      player.play();
      setPlaying(true);
    }
  };

  const seek = (seconds: number) => {
    const clamped = Math.max(0, Math.min(duration, seconds));
    setCurrentTime(clamped);
    const player = playerRef.current;
    if (player) {
      player.pause();
      setPlaying(false);
      player.currentTime = clamped;
    }
  };

  const segments = beatSpans.length
    ? beatSpans
    : (beats.length ? beats : [{ keyword: "Scene 1", onScreen: null, line: null, visual: null }]).map((b, i, arr) => ({
        label: b.keyword || `Scene ${i + 1}`,
        start: (i / arr.length) * duration,
        end: ((i + 1) / arr.length) * duration
      }));

  const sceneAt = (sec: number) =>
    Math.max(0, segments.findIndex((seg, idx) => sec < seg.end || idx === segments.length - 1));
  const activeSceneIndex = sceneAt(currentTime);
  const sortedComments = [...timedComments].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const stepRuler = rulerStep(duration);
  const ruler = Array.from({ length: Math.floor(duration / stepRuler) + 1 }, (_, i) => i * stepRuler);
  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / Math.max(duration, 0.1)) * 100))}%`;

  const cost = tokensFromMilli(renderCostMillitokens(Math.max(5, Math.round(duration))));
  const shortTokens = balance !== null && balance < cost;

  const addComment = () => {
    const body = draft.trim();
    if (body.length < 3 || animating || applyingComments) return;
    setTimedComments((curr) => [
      ...curr,
      { id: crypto.randomUUID(), body, timestampSeconds: Math.round(currentTime * 10) / 10 }
    ]);
    setDraft("");
  };

  const applyComments = async () => {
    if (!sortedComments.length || animating || applyingComments) return;
    setApplyingComments(true);
    try {
      const byLine = new Map<number, string[]>();
      for (const c of sortedComments) {
        const lineIdx = sceneAt(c.timestampSeconds);
        const list = byLine.get(lineIdx) ?? [];
        list.push(c.body);
        byLine.set(lineIdx, list);
      }
      const payload = [...byLine.entries()].map(([line, texts]) => ({ line, text: texts.join(". ") }));
      setTimedComments([]);
      await onApplySceneComments(payload);
      onRetryAnimate();
    } finally {
      setApplyingComments(false);
    }
  };

  // While preparing the browser animation (or if an error occurred before previewHtml is ready):
  // show the vertically locked two-column Animation Prep screen with 0->100% progress bar & parallel scene status
  if (animating || animError || (!previewHtml && !project.beatPlan)) {
    const pctNum = Math.max(0, Math.min(100, Math.round(animProgress)));
    const sceneCount = Math.max(beats.length, project.beatPlan?.beats.length ?? 0, frames.length);
    const stageLabel =
      animStage === "frames"
        ? "Drawing missing reference frames in parallel…"
        : animStage === "voice"
        ? "Recording voiceover & background music in parallel…"
        : `Directing scene animations in parallel (${animScenesDone.length}/${sceneCount || 1} scenes ready)…`;

    return (
      <div
        className="render-workspace"
        style={{
          flex: "1 1 0",
          minHeight: 0,
          overflow: "hidden",
          padding: "16px 28px 20px",
          boxSizing: "border-box",
          alignItems: "stretch"
        }}
      >
        <section
          className="workspace-player"
          style={{
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column"
          }}
        >
          {frames.length > 0 ? (
            <FrameReel frames={frames} />
          ) : (
            <Preview
              project={project}
              title={project.name}
              screenshot={project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : undefined}
            />
          )}
        </section>

        <aside
          className="render-card"
          style={{
            height: "100%",
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 14
          }}
        >
          <header>
            <b>{animError ? "Animation needs attention" : "Preparing browser animation"}</b>
            <span>{aspect}</span>
          </header>

          {animError ? (
            <div className="render-error">
              <b>We could not prepare the browser animation.</b>
              <p>{animError}</p>
              <div className="render-error-actions">
                <button type="button" disabled={animating} onClick={onRetryAnimate}>
                  Try again
                </button>
                <button type="button" className="render-error-back" onClick={onBackToStoryboard}>
                  Back to storyboard
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="render-walkaway" style={{ margin: 0 }}>
                <b>No video encoding yet.</b> We are directing the live browser animation across all {sceneCount} scenes in parallel so you can watch and edit it immediately before rendering the final MP4.
              </p>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                    <i className="sc-live" />
                    {stageLabel}
                  </span>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{pctNum}%</b>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pctNum}
                  style={{
                    height: 10,
                    borderRadius: 999,
                    background: "rgba(148, 163, 184, 0.22)",
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      width: `${pctNum}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: "linear-gradient(90deg, #168bff, #0a6cff)",
                      transition: "width 0.28s ease"
                    }}
                  />
                </div>
              </div>

              {sceneCount > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  <small style={{ color: "var(--muted)", fontWeight: 600, fontSize: 12 }}>
                    Parallel scene animation status ({animScenesDone.length}/{sceneCount})
                  </small>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6 }}>
                    {Array.from({ length: sceneCount }, (_, idx) => {
                      const done = animScenesDone.includes(idx);
                      return (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 10px",
                            borderRadius: 10,
                            fontSize: 12,
                            fontWeight: 600,
                            background: done ? "rgba(22, 128, 60, 0.16)" : "rgba(148, 163, 184, 0.12)",
                            color: done ? "#22c55e" : "var(--muted)"
                          }}
                        >
                          <span>{done ? "✓" : "⋯"}</span>
                          <span>Scene {idx + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: "auto" }}
                onClick={onBackToStoryboard}
              >
                ← Back to Storyboard
              </button>
            </>
          )}
        </aside>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: "1 1 0",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        padding: "12px 24px 16px",
        boxSizing: "border-box",
        gap: 10,
        width: "min(1440px, 100%)",
        margin: "0 auto"
      }}
    >
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
          <button type="button" className="ce-download" onClick={onRetryAnimate} disabled={busy || applyingComments}>
            ↻ Rebuild animation
          </button>
          {shortTokens ? (
            <button type="button" className="ce-approve" onClick={() => setBuyingTokens(true)}>
              Add tokens for Final render · {cost} tokens
            </button>
          ) : (
            <button
              type="button"
              className="ce-approve"
              disabled={busy || applyingComments}
              onClick={onStartFinalRender}
            >
              {busy ? "Starting render…" : `Final render · ${cost} tokens`}
            </button>
          )}
        </div>
      </div>

      {buyingTokens && balance !== null && (
        <TokenModal cost={cost} balance={balance} onClose={() => setBuyingTokens(false)} />
      )}

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
              onClick={togglePlay}
              style={{
                position: "relative",
                flex: "1 1 0",
                minHeight: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                cursor: "pointer"
              }}
            >
              {previewError ? (
                <div className="render-error" style={{ padding: 24, textAlign: "center" }}>
                  <b>{previewError}</b>
                  <div className="render-error-actions" style={{ justifyContent: "center", marginTop: 12 }}>
                    <button type="button" onClick={onRetryAnimate}>
                      Reload animation
                    </button>
                  </div>
                </div>
              ) : playerLoaded && previewHtml ? (
                <div
                  className="ce-frame-box"
                  style={{
                    height: "100%",
                    maxHeight: "100%",
                    width: aspect === "9:16" ? "auto" : "100%",
                    maxWidth: "100%",
                    aspectRatio: aspect === "9:16" ? "9 / 16" : aspect === "1:1" ? "1 / 1" : "16 / 9",
                    position: "relative",
                    borderRadius: 14,
                    overflow: "hidden",
                    background: "#05070b"
                  }}
                >
                  {createElement("hyperframes-player", {
                    ref: playerRef,
                    className: "studio-hyperframes-player",
                    "disable-click-to-play": "",
                    "assets-loading-ui": "none",
                    "aria-label": "In-browser animation preview",
                    style: { width: "100%", height: "100%", display: "block" }
                  })}
                </div>
              ) : (
                <div style={{ color: "#93979f", fontSize: 13 }}>Loading browser animation…</div>
              )}
              {!playing && !previewError && <span className="ce-hint">Paused · comment on this moment</span>}
            </div>

            <div className="ce-controls" style={{ flexShrink: 0 }}>
              <button type="button" aria-label={playing ? "Pause" : "Play"} disabled={!previewHtml} onClick={togglePlay}>
                {playing ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.14v14l11-7-11-7z" />
                  </svg>
                )}
              </button>
              <span className="ce-clock">
                <b>{formatVideoTime(currentTime)}</b> / {formatVideoTime(duration)}
              </span>
              <div
                className="ce-scrubber"
                role="slider"
                tabIndex={0}
                aria-label="Seek animation"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={Math.round(currentTime * 10) / 10}
                onPointerDown={(ev) => {
                  ev.currentTarget.setPointerCapture(ev.pointerId);
                  scrubbingRef.current = true;
                  const bounds = ev.currentTarget.getBoundingClientRect();
                  seek(((ev.clientX - bounds.left) / bounds.width) * duration);
                }}
                onPointerMove={(ev) => {
                  if (!scrubbingRef.current) return;
                  const bounds = ev.currentTarget.getBoundingClientRect();
                  seek(((ev.clientX - bounds.left) / bounds.width) * duration);
                }}
                onPointerUp={() => {
                  scrubbingRef.current = false;
                }}
                onPointerCancel={() => {
                  scrubbingRef.current = false;
                }}
              >
                <div className="ce-scrubber-fill" style={{ width: pct(currentTime) }} />
                <div className="ce-scrubber-thumb" style={{ left: pct(currentTime) }} />
              </div>
              <span className="ce-volume">
                <button
                  type="button"
                  className="ce-icon-btn"
                  aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                  onClick={() => setMuted((m) => !m)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
                  onChange={(ev) => {
                    const v = Number(ev.target.value);
                    setVolume(v);
                    setMuted(v === 0);
                  }}
                />
              </span>
              <span className="ce-badge-ratio">{aspect}</span>
              <span className="ce-scene">
                {segments[activeSceneIndex] ? `Scene ${activeSceneIndex + 1}/${segments.length}` : ""}
              </span>
            </div>
          </div>

          <div className="ce-timeline" style={{ flexShrink: 0, padding: "8px 14px" }}>
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
              onPointerDown={(ev) => {
                ev.currentTarget.setPointerCapture(ev.pointerId);
                scrubbingRef.current = true;
                const bounds = ev.currentTarget.getBoundingClientRect();
                seek(((ev.clientX - bounds.left) / bounds.width) * duration);
              }}
              onPointerMove={(ev) => {
                if (!scrubbingRef.current) return;
                const bounds = ev.currentTarget.getBoundingClientRect();
                seek(((ev.clientX - bounds.left) / bounds.width) * duration);
              }}
              onPointerUp={() => {
                scrubbingRef.current = false;
              }}
              onPointerCancel={() => {
                scrubbingRef.current = false;
              }}
            >
              <div className="ce-ruler">
                {ruler.map((sec) => (
                  <span key={sec} style={{ left: pct(sec) }}>
                    {formatVideoTime(sec)}
                  </span>
                ))}
              </div>
              {sortedComments.length > 0 && (
                <div className="ce-pins">
                  {sortedComments.map((c, idx) => (
                    <button
                      key={c.id}
                      type="button"
                      title={c.body}
                      style={{ left: pct(c.timestampSeconds), background: pinColors[idx % pinColors.length] }}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        seek(c.timestampSeconds);
                      }}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              )}
              <div className="ce-strip" style={{ height: 38 }}>
                {segments.map((seg, idx) => (
                  <div
                    key={idx}
                    style={{ flex: Math.max(0.01, seg.end - seg.start) }}
                    className={idx === activeSceneIndex ? "active" : ""}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      seek(seg.start + 0.05);
                    }}
                  >
                    <b>
                      {String(idx + 1).padStart(2, "0")} · {seg.label}
                    </b>
                    <small>
                      {formatVideoTime(seg.start)}–{formatVideoTime(seg.end)}
                    </small>
                  </div>
                ))}
              </div>
              <i className="ce-playhead" style={{ left: pct(currentTime) }} />
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
                disabled={animating || applyingComments || draft.trim().length < 3}
                onClick={addComment}
              >
                Add
              </button>
            </div>
            <textarea
              rows={2}
              value={draft}
              maxLength={400}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) addComment();
              }}
              placeholder="What should change here?"
              aria-label="Review comment"
            />
            <div className="ce-examples">
              {commentExamples.map((ex) => (
                <button type="button" key={ex} onClick={() => setDraft(ex)}>
                  {ex}
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
                sortedComments.map((c, idx) => (
                  <div className="ce-comment" key={c.id}>
                    <div>
                      <span className="ce-pin" style={{ background: pinColors[idx % pinColors.length] }}>
                        {idx + 1}
                      </span>
                      <button type="button" className="ce-when" onClick={() => seek(c.timestampSeconds)}>
                        {formatVideoTime(c.timestampSeconds)}
                      </button>
                      <small>Scene {sceneAt(c.timestampSeconds) + 1}</small>
                    </div>
                    <p>{c.body}</p>
                    <button
                      type="button"
                      className="ce-remove"
                      aria-label="Delete comment"
                      onClick={() => setTimedComments((curr) => curr.filter((item) => item.id !== c.id))}
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
                disabled={animating || applyingComments || sortedComments.length === 0}
                onClick={() => void applyComments()}
              >
                {applyingComments
                  ? "Applying with AI…"
                  : sortedComments.length
                  ? `Apply ${sortedComments.length} with AI`
                  : "Apply with AI"}
              </button>
              <span>Each comment updates the scene and refreshes the browser animation.</span>
            </footer>
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Step 4 (Render): Vertically locked (100vh) final MP4 encoding & download/approval view.
 * Reached after the user reviews the browser animation in Step 3 and clicks "Final render".
 */
function FinalRenderStep({
  project,
  job,
  frames,
  aspect,
  look,
  error,
  busy,
  retry,
  backToAnimation,
  approve
}: {
  project: VideoProject;
  job: RenderJob | null;
  frames: string[];
  aspect: string;
  look?: FrameLook;
  error: string | null;
  busy: boolean;
  retry: () => Promise<void>;
  backToAnimation: () => void;
  approve: () => Promise<void>;
}) {
  const [approving, setApproving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubbingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    job?.output?.durationSeconds ?? project.filmSeconds ?? project.beatPlan?.target_duration_s ?? project.brief?.durationSeconds ?? 30
  );
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const node = videoRef.current;
    if (node) {
      node.volume = volume;
      node.muted = muted;
    }
  }, [volume, muted, job?.output]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const seek = (sec: number) => {
    const clamped = Math.max(0, Math.min(duration, sec));
    setCurrentTime(clamped);
    const v = videoRef.current;
    if (v) v.currentTime = clamped;
  };

  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / Math.max(duration, 0.1)) * 100))}%`;

  if (job?.state === "ready" && job.output) {
    const scenes = project.beatPlan?.beats ?? [];
    return (
      <div
        style={{
          flex: "1 1 0",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: "12px 24px 16px",
          boxSizing: "border-box",
          gap: 10,
          width: "min(1440px, 100%)",
          margin: "0 auto"
        }}
      >
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
            <h1>Final rendered video</h1>
            <p>Your video has been rendered to an MP4 file. Download it or return to Animation to make further edits.</p>
          </div>
          <div className="ce-actions" style={{ flexShrink: 0 }}>
            <button type="button" className="ce-download" onClick={backToAnimation}>
              ← Back to Animation
            </button>
            <a className="ce-download" href={outputUrl(job.output.url)} download>
              Download MP4
            </a>
            {project.state === "Approved" ? (
              <span className="ce-locked">✓ Approved · locked</span>
            ) : (
              <button
                type="button"
                className="ce-approve"
                disabled={approving}
                onClick={async () => {
                  setApproving(true);
                  try {
                    await approve();
                  } finally {
                    setApproving(false);
                  }
                }}
              >
                {approving ? "Approving…" : "Approve final"}
              </button>
            )}
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
              overflow: "hidden"
            }}
          >
            <div
              className={"ce-player" + (aspect === "9:16" ? " portrait" : "")}
              style={{
                flex: "1 1 0",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: 12
              }}
            >
              <div
                className="ce-stage"
                onClick={togglePlay}
                style={{
                  flex: "1 1 0",
                  minHeight: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  cursor: "pointer"
                }}
              >
                <video
                  ref={videoRef}
                  src={outputUrl(job.output.url)}
                  poster={frames[0] ? svgSrc(frames[0]) : project.coverFrame ? svgSrc(project.coverFrame) : undefined}
                  playsInline
                  preload="metadata"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onLoadedMetadata={(ev) => {
                    if (ev.currentTarget.duration > 0) setDuration(ev.currentTarget.duration);
                  }}
                  onTimeUpdate={(ev) => {
                    if (!scrubbingRef.current) setCurrentTime(ev.currentTarget.currentTime);
                  }}
                  style={{
                    height: "100%",
                    maxHeight: "100%",
                    width: aspect === "9:16" ? "auto" : "100%",
                    maxWidth: "100%",
                    aspectRatio: aspect === "9:16" ? "9 / 16" : aspect === "1:1" ? "1 / 1" : "16 / 9",
                    objectFit: "contain",
                    borderRadius: 14,
                    background: "#05070b",
                    display: "block",
                    margin: "0 auto"
                  }}
                />
                {!playing && <span className="ce-hint">Click to play</span>}
              </div>

              <div className="ce-controls" style={{ flexShrink: 0 }}>
                <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
                  {playing ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="6" y="4" width="4" height="16" rx="1" />
                      <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5.14v14l11-7-11-7z" />
                    </svg>
                  )}
                </button>
                <span className="ce-clock">
                  <b>{formatVideoTime(currentTime)}</b> / {formatVideoTime(duration)}
                </span>
                <div
                  className="ce-scrubber"
                  role="slider"
                  tabIndex={0}
                  aria-label="Seek video"
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={Math.round(currentTime * 10) / 10}
                  onPointerDown={(ev) => {
                    ev.currentTarget.setPointerCapture(ev.pointerId);
                    scrubbingRef.current = true;
                    const bounds = ev.currentTarget.getBoundingClientRect();
                    seek(((ev.clientX - bounds.left) / bounds.width) * duration);
                  }}
                  onPointerMove={(ev) => {
                    if (!scrubbingRef.current) return;
                    const bounds = ev.currentTarget.getBoundingClientRect();
                    seek(((ev.clientX - bounds.left) / bounds.width) * duration);
                  }}
                  onPointerUp={() => {
                    scrubbingRef.current = false;
                  }}
                  onPointerCancel={() => {
                    scrubbingRef.current = false;
                  }}
                >
                  <div className="ce-scrubber-fill" style={{ width: pct(currentTime) }} />
                  <div className="ce-scrubber-thumb" style={{ left: pct(currentTime) }} />
                </div>
                <span className="ce-volume">
                  <button
                    type="button"
                    className="ce-icon-btn"
                    aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                    onClick={() => setMuted((m) => !m)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
                    onChange={(ev) => {
                      const v = Number(ev.target.value);
                      setVolume(v);
                      setMuted(v === 0);
                    }}
                  />
                </span>
                <span className="ce-badge-ratio">{aspect}</span>
                <button
                  type="button"
                  className="ce-icon-btn"
                  aria-label="Fullscreen"
                  title="Fullscreen"
                  onClick={() => {
                    void videoRef.current?.requestFullscreen?.();
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
                  </svg>
                </button>
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
              overflow: "hidden"
            }}
          >
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
                <b>Scenes</b>
                <span>{scenes.length} scenes</span>
              </header>
              <div className="ce-list" style={{ flex: "1 1 0", minHeight: 0, maxHeight: "none", overflowY: "auto" }}>
                {scenes.map((beat, idx) => (
                  <div className="ce-comment" key={beat.id}>
                    <div>
                      <small>
                        Scene {idx + 1} · {beat.keyword}
                      </small>
                    </div>
                    {beat.line && <p>{beat.line}</p>}
                  </div>
                ))}
              </div>
              <footer style={{ flexShrink: 0 }}>
                <button type="button" className="ce-apply" onClick={backToAnimation}>
                  Edit in Animation player
                </button>
                <span>Need a change? Edit scenes in the browser Animation player before re-rendering.</span>
              </footer>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  const title = project.script?.lines[0]?.onScreen || "Your video is rendering.";
  const failed = Boolean(error) || job?.state === "failed";
  const steps = renderSteps.filter((item) => item.key !== "plan" && item.key !== "audio");
  const stage: RenderStage = job?.stage ?? (job?.state === "ready" ? "done" : job?.state === "rendering" ? "preparing" : "queued");
  const current = stage === "done" ? steps.length : Math.max(0, steps.findIndex((item) => item.stages.includes(stage)));
  const detail = (key: string) => {
    if (key === "wait" && stage === "waiting") return job?.queuePosition ? `${job.queuePosition} ahead` : "Usually under a minute";
    if (key === "frames" && job?.frames) return `${job.frames.done} / ${job.frames.total}`;
    return null;
  };

  return (
    <div
      className="render-workspace"
      style={{
        flex: "1 1 0",
        minHeight: 0,
        overflow: "hidden",
        padding: "16px 28px 20px",
        boxSizing: "border-box",
        alignItems: "stretch"
      }}
    >
      <section
        className="workspace-player"
        style={{
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        {frames.length ? (
          <FrameReel frames={frames} />
        ) : (
          <Preview
            project={project}
            title={title}
            look={look}
            screenshot={project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : undefined}
          />
        )}
      </section>
      <aside
        className="render-card"
        style={{
          ...(look ? ({ "--rc": look.brand, "--rc-on": readableOnBrand(look.brand) } as React.CSSProperties) : {}),
          height: "100%",
          minHeight: 0,
          overflowY: "auto"
        }}
      >
        <header>
          <b>{failed ? "Render needs attention" : "Rendering final MP4"}</b>
          <span>{aspect}</span>
        </header>
        {failed ? (
          <div className="render-error">
            <b>We could not render this project.</b>
            <p>{error || job?.error?.message}</p>
            <div className="render-error-actions">
              <button disabled={busy} onClick={() => void retry()}>
                {busy ? "Starting…" : "Try again"}
              </button>
              <button className="render-error-back" onClick={backToAnimation}>
                Back to Animation
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="render-walkaway">
              <b>You can walk away.</b> Final MP4 encoding keeps going on our servers whether or not this page is open.
            </p>
            <ol>
              {steps.map((item, index) => (
                <li className={index < current ? "done" : index === current ? "current" : ""} key={item.key}>
                  <i>{index < current ? "✓" : index + 1}</i>
                  <span>{item.label}</span>
                  {index === current && detail(item.key) && <small>{detail(item.key)}</small>}
                </li>
              ))}
            </ol>
            {stage === "retrying" && (
              <p className="render-retry">Attempt {job?.attempt ?? 1} hit a renderer error. Trying again automatically.</p>
            )}
            <button type="button" className="secondary-button" style={{ marginTop: 12 }} onClick={backToAnimation}>
              ← Back to browser Animation
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

function Preview({ project, title, screenshot, look }: { project: VideoProject; title: string; screenshot?: string; look?: FrameLook }) {
  // In the project's own colours and type (brand kit or theme), so this stand-in matches the film that is being made.
  const branded = look ? ({ "--sm-bg": look.bg, "--sm-fg": look.fg, "--sm-muted": look.muted, "--sm-brand": look.brand, "--sm-font": look.font } as React.CSSProperties) : undefined;
  return <div className={look ? "scene-mock branded" : "scene-mock"} style={branded}><div className="scene-browser"><span /><span /><span /></div><div className="scene-copy"><small>{project.name.toUpperCase()}</small><h2>{title}</h2><p>{project.script?.lines[0]?.voiceover || "This preview reflects the saved project inputs."}</p></div>{screenshot ? <img className="scene-screenshot" src={screenshot} alt="" /> : <div className="scene-product"><b>No screenshot yet</b><span>Upload a real product screenshot in the Script step.</span></div>}</div>;
}
