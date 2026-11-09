"use client";

import { useRouter } from "next/navigation";
import { optimisticUpdate } from "../lib/optimistic";
import { useCallback, useEffect, useRef, useState } from "react";
import { aspectToFormat, beatCountRange, briefAspects, effectiveBriefDurationSeconds, ensureScriptBeatIds, isScriptLedDuration, remapFlagsOnInsert, remapFlagsOnRemove, remapIndicesOnInsert, remapIndicesOnRemove, remapRecordOnInsert, remapRecordOnRemove, SCRIPT_BEATS_MAX, SCRIPT_BEATS_MIN, scriptSeconds, bundledFonts, findGalleryTemplate, isFilmBrief, wordBudget, scriptFrameKey, voiceText, getLook, getStyleFamily, defaultTemplateId, deriveBrandTheme, findTemplate, findTheme, parseScriptBrief, parseScriptStream, templates, themes, type Beat, type BeatPlan, type BrandKit, type ScriptBeat, type ScriptNotes, type GalleryCard, type ProjectStudioDraft, type RenderJob, type RenderRequest, type ScriptBrief, type Template, type VideoProject } from "@videosaas/contracts";
import { GalleryGrid, useGalleryShelf } from "./template-gallery";
import { PlateFinal, PlatePreview } from "./plate-preview";
import { BrowserAnimationStep } from "./browser-animation-step";
import { FinalRenderStep } from "./final-render-step";
import { AppHeader } from "./app-shell";
import { StudioEditor, type StudioDraftInput } from "./studio-editor";
import { defaultBrief, ScriptStyleStep, type SiteState } from "./script-style";
import { FilmBrief } from "./film-brief";
import { BeatStoryboardStep, FrameCard, type FrameLook } from "./beat-storyboard";
import { ScriptCanvas, PlanLimitModal, svgSrc, type FrameSlot, type StoryboardState, type VoiceState } from "./script-canvas";
import { createClient } from "../utils/supabase/client";
import { useMediaToken } from "../lib/use-media-token";
import { PLATE_CONFIRM_FALSE_DELAY_MS, PLATE_FALLBACK_NOTICE, nextPlateAnswer, plateRetryDelayMs, resolvePlateRouting, type PlateAnswerState } from "../lib/plate-availability";
import { LimitError, getPlates, getRenderQuote, cancelPlanJob, deleteProject, generatePlanAudio, getGalleryTemplate, getProject, insertScriptScene, planVoiceUrl, removeScriptScene, restoreScriptScene, streamFrames, streamScript, streamScriptAnimate, streamScriptVoice, type ScriptFlag, addProjectReviewComment, applyProjectReviewComments, approveProject, createProject, editPlan, getRenderJob, listBrandKits, listProjects, outputUrl, projectScreenshotUrl, removeProjectReviewComment, planProject, readProductSite, removeProjectScreenshot, renderProject, saveBrandKit, saveProjectStudio, updateProject, uploadProjectScreenshot, watchRenderJob } from "../lib/api";

type View = "projects" | "create" | "studio";
type Step = 0 | 1 | 2 | 3;
// Unified 4-step flow: 1 Brief → 2 Storyboard → 3 Animation (in-browser live player & comment review) → 4 Render (final MP4 encode).
const SCRIPT_STYLE: Step = 0, STORYBOARD: Step = 1, RENDER: Step = 2, REVIEW: Step = 3;
const flowSteps: [Step, string][] = [[SCRIPT_STYLE, "Brief"], [STORYBOARD, "Storyboard"], [RENDER, "Animation"], [REVIEW, "Render"]];
const imageFor = (template: Template) => "/templates/" + template.id + ".jpg";
/** A film (story or explainer) is made from the idea alone: product facts and the brand kit never reach its script or storyboard. */
const filmSafe = (value: ScriptBrief): ScriptBrief => isFilmBrief(value) ? { ...value, productUrl: undefined, productName: undefined, audience: undefined, brandId: undefined } : value;

function statusStep(project: VideoProject): Step {
  if (project.renderJobId && (project.state === "Rendering draft" || project.state === "Approved" || project.state === "Render needs attention")) return REVIEW;
  if (project.state === "Ready for review" || project.state === "Revisions needed" || (project.state !== "Draft storyboard" && project.filmMotion?.length)) return RENDER;
  if (project.beatPlan || project.brief?.scriptBeats?.length) return STORYBOARD;
  return SCRIPT_STYLE;
}

/** Motion profile → the render pipeline's existing style until motion direction ships. */
const styleFor = (profile: ScriptBrief["motionProfile"]): RenderRequest["style"] => profile === "smooth" ? "clean" : "kinetic";

/** Older projects have no brief; start one from their saved request. */
function briefFrom(project: VideoProject): ScriptBrief {
  if (project.brief) return project.keepOverLength && !project.brief.keepOverLength ? { ...project.brief, keepOverLength: true } : project.brief;
  const audio = project.request.audio;
  return {
    ...defaultBrief,
    text: project.request.prompt,
    aspect: project.request.format === "portrait" ? "9:16" : "16:9",
    audio: { mode: audio?.music && audio?.voiceover ? "both" : audio?.voiceover ? "voiceover" : audio?.music ? "music" : "none", voice: audio?.voice ?? "Kore" },
    theme: project.request.theme,
    ...(project.request.brandId ? { brandId: project.request.brandId } : {}),
    ...(project.keepOverLength ? { keepOverLength: true } : {})
  };
}

/** The colours and type frame cards are drawn with: the brand kit's derived theme, or the chosen gallery theme. */
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
  // The plan's allowance is used up (free previews, a month's films): answered with a plan choice, not an error line.
  const [limit, setLimit] = useState<LimitError | null>(null);
  const [seePlans, setSeePlans] = useState(false);
  /** A refusal for allowance or tokens opens the plan dialog (and is remembered for the storyboard page); returns whether it was one. */
  const showLimit = (caught: unknown) => { if (!(caught instanceof LimitError)) return false; setLimit(caught); setSeePlans(true); return true; };
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
  const canvasRef = useRef<Canvas | null>(null);
  canvasRef.current = canvas;
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
  const savedExample = project?.brief?.styleExample ?? null;
  const chosenExample = brief.styleExample ?? null;
  useEffect(() => {
    if (!project?.beatPlan || !project.brief || (chosenLook === savedLook && chosenFamily === savedFamily && chosenExample === savedExample)) return;
    void editPlan(project.id, { look: chosenLook, styleFamily: chosenFamily, styleExample: chosenExample }).then(replaceProject).catch((caught) => { showLimit(caught); setError(caught instanceof Error ? caught.message : "Could not save the drawing style."); });
  }, [project?.id, project?.beatPlan, project?.brief, chosenLook, savedLook, chosenFamily, savedFamily, chosenExample, savedExample, replaceProject]);

  // Keep format selections (aspect / aspects) and duration settings (durationMode / durationSeconds / lockDuration)
  // persisted on the saved project when edited in Brief so Storyboard, Animation, Render quote and Export stay in sync.
  const savedAspectsKey = project?.brief ? `${project.brief.aspect}|${briefAspects(project.brief).join(",")}` : "";
  const chosenAspectsKey = `${brief.aspect}|${briefAspects(brief).join(",")}`;
  const savedDurationKey = project?.brief ? `${project.brief.durationMode ?? ""}|${project.brief.durationSeconds}|${Boolean(project.brief.lockDuration)}` : "";
  const chosenDurationKey = `${brief.durationMode ?? ""}|${brief.durationSeconds}|${Boolean(brief.lockDuration)}`;
  useEffect(() => {
    if (!project?.id || !project.brief) return;
    if (savedAspectsKey === chosenAspectsKey && savedDurationKey === chosenDurationKey) return;
    const checked = parseScriptBrief(filmSafe(brief));
    if ("error" in checked) return;
    const timer = window.setTimeout(() => {
      void updateProject(project.id, {
        brief: {
          ...project.brief,
          ...checked.brief,
          ...(project.brief?.scriptBeats ? { scriptBeats: project.brief.scriptBeats } : {}),
          ...(project.brief?.scriptNotes ? { scriptNotes: project.brief.scriptNotes } : {})
        }
      })
        .then(replaceProject)
        .catch(() => undefined);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [project?.id, project?.brief, savedAspectsKey, chosenAspectsKey, savedDurationKey, chosenDurationKey, brief, replaceProject]);

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
    const opening = ++openingProject.current;
    setProject(saved);
    setRequest(saved.request);
    // Choices made after the last save (and not yet generated) are kept in this browser; they win when newer.
    const draft = readDraft(saved.id);
    const newer = draft && draft.savedAt >= Date.parse(saved.updatedAt);
    const nextBrief = newer ? draft.brief : briefFrom(saved);
    const keepOverLength = Boolean(saved.keepOverLength || saved.brief?.keepOverLength || nextBrief.keepOverLength);
    setBrief(keepOverLength && !nextBrief.keepOverLength ? { ...nextBrief, keepOverLength: true } : nextBrief);
    if (newer) setMotionBlur(draft.motionBlur);
    setDraftId(null);
    // The brand found on the site isn't stored (only offered for review), so a reopened project shows the facts and shots.
    setSite({ reading: false, site: saved.site ?? null, brand: null, shots: saved.screenshots.filter((shot) => shot.name.startsWith("Site · ")).length, warnings: [] });
    setPlanWarnings([]);
    setError(null);
    setStep(statusStep(saved));
    setView("create");
    if (saved.scriptFrames === undefined) {
      void getProject(saved.id)
        .then((full) => {
          if (opening !== openingProject.current || pendingMutation.current) return;
          setProject((current) => (current?.id === full.id ? { ...current, scriptFrames: full.scriptFrames ?? [] } : current));
          setProjects((current) => current.map((item) => (item.id === full.id ? { ...item, scriptFrames: full.scriptFrames ?? [] } : item)));
        })
        .catch(() => undefined);
    }
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
      showLimit(caught);
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
    const withIds = ensureScriptBeatIds(beats);
    const todo = indices.filter((i) => withIds[i] && (force || !frameCache.current[frameKey(withIds[i]!)] || frameCache.current[frameKey(withIds[i]!)]!.state === "failed"));
    if (todo.length === 0) return;
    const identityByIndex = new Map(todo.map((i) => [i, { id: withIds[i]!.id, key: frameKey(withIds[i]!), beat: withIds[i]! }]));
    putFrames(todo.map((i) => [frameKey(withIds[i]!), { state: "drawing", ...(frameCache.current[frameKey(withIds[i]!)]?.svg ? { svg: frameCache.current[frameKey(withIds[i]!)]!.svg } : {}) }]));
    void streamFrames(active.id, { brief: checked.brief, beats: withIds, indices: todo, ...(notesRef.current ? { notes: notesRef.current } : {}) }, ({ index, svg, error }) => {
      const info = identityByIndex.get(index);
      if (!info) return;
      putFrames([[info.key, svg ? { state: "ready", svg } : { state: "failed", error: error ?? "Could not draw this frame." }]]);
      if (svg) {
        const liveBeats = canvasRef.current?.beats ?? [];
        const liveIdx = info.id
          ? liveBeats.findIndex((b) => b.id === info.id)
          : liveBeats[index] && frameKey(liveBeats[index]!) === info.key
            ? index
            : -1;
        if (liveIdx >= 0) {
          setFrameAt((current) => ({ ...current, [liveIdx]: svg }));
        }
      }
    }).catch((caught) => {
      showLimit(caught); const message = caught instanceof Error ? caught.message : "Could not draw the frames.";
      putFrames(todo.map((i) => frameKey(withIds[i]!)).filter((key) => frameCache.current[key]?.state === "drawing").map((key) => [key, { state: "failed", error: message }]));
    });
  };
  /** Builds the storyboard from the script (its words fixed) as a server job; the page stays on the script. */
  const buildStoryboard = async (active: VideoProject, beats: ScriptBeat[], notes: ScriptNotes | null = notesRef.current) => {
    const checked = parseScriptBrief(filmSafe(brief));
    if ("error" in checked) return;
    // A film is made from the idea alone: no product screenshots reach its storyboard.
    const shots = isFilmBrief(brief) ? {} : { screenshotIds: active.screenshots.map((shot) => shot.id) };
    try { replaceProject((await planProject(active.id, { ...checked.brief, scriptBeats: beats, ...(notes ? { scriptNotes: notes } : {}), ...shots })).project); }
    catch (caught) { setCanvas((current) => current && { ...current, error: caught instanceof Error ? caught.message : "Could not start the storyboard." }); }
  };
  /** Streams a new script, or with `instruction` a changed one, into the canvas. */
  // Every AI version of a beat is kept (Reimagine, or a change to picked beats) so the person can go back to one.
  const [versions, setVersions] = useState<Record<number, { list: ScriptBeat[]; at: number }>>({});
  /**
   * Streams a new script, or with `instruction` a changed one; with `only`, just those beats are rewritten. With `draft`
   * (a film's Brief page) it stays on the page and starts nothing else: the storyboard and frames wait for `continueDraft`.
   */
  const writeScript = async (instruction?: string, override?: Partial<ScriptBrief>, only?: number[], draft = false) => {
    const checked = parseScriptBrief(filmSafe(override ? { ...brief, ...override } : brief));
    if ("error" in checked) { setError(checked.error); return; }
    setError(null);
    setLimit(null);
    const previous = instruction && canvas ? canvas.beats : [];
    if (!draft) setStep(STORYBOARD);
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
        if (!draft && !early && parsed.beats.length > 4) { early = true; drawFrames(active, parsed.beats.slice(0, 4), [0, 1, 2, 3]); }
        // A change streams the whole script again: beats not rewritten yet keep showing their current words.
        setCanvas((current) => current && { ...current, beats: [...parsed.beats, ...current.previous.slice(parsed.beats.length)], open: parsed.open, writing: parsed.beats.length ? parsed.beats.length - 1 : null, firstAt: current.firstAt ?? Date.now() });
      }, stop.signal);
      notesRef.current = result.notes;
      const finishedBeats = ensureScriptBeatIds(
        result.beats.map((b, i) => (scope && scope.includes(i) && previous[i]?.id ? { ...b, id: previous[i]!.id } : previous[i]?.id && !scope ? b : previous[i]?.id ? { ...b, id: previous[i]!.id } : b))
      );
      setCanvas((current) => current && { ...current, beats: finishedBeats, notes: result.notes, previous: [], open: null, writing: null, streaming: false, flags: result.flags });
      setVersions((current) => {
        if (!scope) return {};
        const next = { ...current };
        for (const i of scope) {
          const entry = current[i] ?? { list: [previous[i]!], at: 0 };
          const list = [...entry.list];
          list[entry.at] = previous[i]!;
          next[i] = { list: [...list, finishedBeats[i]!], at: list.length };
        }
        return next;
      });
      // A draft on the Brief page costs only the script: the storyboard and frames start when the person continues.
      if (!draft) {
        void buildStoryboard(active, finishedBeats, result.notes);
        drawFrames(active, finishedBeats, finishedBeats.map((_, i) => i));
      }
    } catch (caught) {
      if (stop.signal.aborted) { setCanvas((current) => current && { ...current, streaming: false, open: null, writing: null, beats: scope ? current.previous : current.beats.length ? current.beats : current.previous }); return; }
      showLimit(caught);
      setCanvas((current) => current && { ...current, streaming: false, open: null, writing: null, beats: current.previous.length ? current.previous : current.beats, error: caught instanceof Error ? caught.message : "Could not write the script." });
    }
  };
  /** A film's script drafted on the Brief page goes to the storyboard as written: page 2 shows it and draws it. */
  const continueDraft = async () => {
    if (!canvas?.beats.length || canvas.streaming) return;
    const beats = canvas.beats;
    try {
      const active = await ensureProject();
      void buildStoryboard(active, beats, notesRef.current);
      drawFrames(active, beats, beats.map((_, i) => i));
      setStep(STORYBOARD);
    } catch (caught) {
      setCanvas((current) => current && { ...current, error: caught instanceof Error ? caught.message : "Could not start the storyboard." });
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
    const targetSec = brief.durationSeconds;
    const nextDurationMode = brief.durationMode === "script" ? ("custom" as const) : brief.durationMode;
    const range = beatCountRange(targetSec, brief.pace, brief.styleFamily);
    const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
    setBrief((current) => ({ ...current, durationSeconds: targetSec, ...(nextDurationMode ? { durationMode: nextDurationMode } : {}), lockDuration: true }));
    void writeScript(`Fit the whole script to about ${targetSec} seconds: ${range.min}–${range.max} beats${voiced ? ` and at most ${wordBudget(targetSec, brief.pace)} spoken words in total` : ""}. Keep the hook, the key idea, the essential steps of the example and the payoff; merge or cut the rest, and keep the lines flowing into each other.`, { durationSeconds: targetSec, ...(nextDurationMode ? { durationMode: nextDurationMode } : {}), lockDuration: true });
  };
  /** "Keep N s": remembers for this project that the user accepted a longer script, without rewriting or spending tokens. */
  const keepingOverLength = useRef<Set<string>>(new Set());
  const acceptOverLength = useCallback(async () => {
    const activeId = project?.id;
    if (!activeId) {
      setBrief((current) => ({ ...current, keepOverLength: true }));
      return;
    }
    if (keepingOverLength.current.has(activeId)) return;
    keepingOverLength.current.add(activeId);
    const hadKeep = Boolean(project.keepOverLength || project.brief?.keepOverLength || brief.keepOverLength);
    const patchKeep = (nextKeep: boolean) => {
      const applyProject = (item: VideoProject): VideoProject => {
        if (item.id !== activeId) return item;
        const nextBrief = item.brief
          ? (() => {
              const { keepOverLength: _old, ...rest } = item.brief;
              return nextKeep ? { ...rest, keepOverLength: true } : rest;
            })()
          : item.brief;
        const { keepOverLength: _oldProjectKeep, ...restProject } = item;
        return {
          ...restProject,
          ...(nextBrief ? { brief: nextBrief } : {}),
          ...(nextKeep ? { keepOverLength: true } : {})
        };
      };
      setProject((current) => {
        if (!current || current.id !== activeId) return current;
        setBrief((currBrief) => {
          const { keepOverLength: _old, ...rest } = currBrief;
          return nextKeep ? { ...rest, keepOverLength: true } : rest;
        });
        return applyProject(current);
      });
      setProjects((current) => current.map(applyProject));
    };
    ++mutationEpoch.current;
    try {
      await optimisticUpdate({
        apply: () => patchKeep(true),
        persist: () => updateProject(activeId, { keepOverLength: true }),
        reconcile: (saved) => patchKeep(Boolean(saved.keepOverLength ?? saved.brief?.keepOverLength ?? true)),
        rollback: () => patchKeep(hadKeep)
      });
    } finally {
      keepingOverLength.current.delete(activeId);
      ++mutationEpoch.current;
    }
  }, [project, brief.keepOverLength]);
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
    const requestBeats = ensureScriptBeatIds(canvas.beats);
    const targetIndices = indices ?? requestBeats.map((_, i) => i).filter((i) => Boolean(voiceText(requestBeats[i]?.line)));
    const identityByIndex = new Map(targetIndices.map((i) => [i, { id: requestBeats[i]?.id, text: voiceText(requestBeats[i]?.line) }]));
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
          beats: requestBeats,
          ...(indices ? { indices } : {}),
          ...(force ? { force: true } : {}),
          includeMusic: !indices && musicBrief
        },
        (ev) => {
          if (typeof ev.progress === "number") {
            setVoiceProgress((curr) => Math.max(curr, ev.progress));
          }
          if (ev.type === "take" || ev.type === "take-error") {
            const info = identityByIndex.get(ev.index);
            const liveBeats = canvasRef.current?.beats ?? [];
            const liveIdx = info?.id
              ? liveBeats.findIndex((b) => b.id === info.id)
              : info?.text
                ? liveBeats.findIndex((b) => voiceText(b.line) === info.text)
                : -1;
            if (ev.type === "take") {
              const text = info?.text ?? voiceText(requestBeats[ev.index]?.line);
              if (text && liveIdx >= 0) {
                setStreamedTakeFiles((curr) => ({ ...curr, [text]: ev.file }));
              }
              setVoicingIndices((curr) => curr.filter((i) => i !== ev.index && i !== liveIdx));
            } else {
              setVoicingIndices((curr) => curr.filter((i) => i !== ev.index && i !== liveIdx));
              if (liveIdx >= 0) {
                setVoiceErrors((curr) => ({ ...curr, [liveIdx]: ev.error }));
              }
            }
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
      showLimit(caught); setVoiceRun({ state: "failed", error: caught instanceof Error ? caught.message : "Could not record the voiceover." });
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
  type UndoSceneState = {
    projectId: string;
    index: number;
    beat: ScriptBeat;
    planBeat: Beat | null;
    overrides: Record<string, unknown>;
    versionEntry?: { list: ScriptBeat[]; at: number };
    frameSvg?: string;
    voiceError?: string;
    flags: ScriptFlag[];
    busy?: boolean;
    error?: string | null;
  };
  const [undoSceneState, setUndoSceneState] = useState<UndoSceneState | null>(null);

  const insertSceneAt = async (position: number, prompt: string, signal?: AbortSignal) => {
    if (!canvas || canvas.streaming) return;
    if (canvas.beats.length >= SCRIPT_BEATS_MAX) {
      throw new Error(`A storyboard can have at most ${SCRIPT_BEATS_MAX} scenes.`);
    }
    const checked = parseScriptBrief(filmSafe(brief));
    if ("error" in checked) {
      throw new Error(checked.error);
    }
    setError(null);
    setLimit(null);
    const active = await ensureProject();
    const currentBeats = ensureScriptBeatIds(canvas.beats);
    const idempotencyKey = crypto.randomUUID();
    pendingMutation.current = true;
    ++mutationEpoch.current;
    try {
      const result = await insertScriptScene(
        active.id,
        {
          brief: checked.brief,
          previous: currentBeats,
          position,
          prompt,
          notes: canvas.notes ?? notesRef.current,
          idempotencyKey
        },
        signal
      );
      if (signal?.aborted) return;
      const nextBeats = ensureScriptBeatIds(
        result.beats.map((b, i) => {
          if (i === position) return result.insertedBeat.id ? b : { ...b, id: `sb-${crypto.randomUUID().slice(0, 8)}` };
          const oldIdx = i > position ? i - 1 : i;
          return currentBeats[oldIdx]?.id ? { ...b, id: currentBeats[oldIdx]!.id } : b;
        })
      );
      notesRef.current = result.notes ?? notesRef.current;
      setVersions((curr) => remapRecordOnInsert(curr, position));
      setFrameAt((curr) => remapRecordOnInsert(curr, position));
      setVoiceErrors((curr) => remapRecordOnInsert(curr, position));
      setVoicingIndices((curr) => remapIndicesOnInsert(curr, position));
      setUndoSceneState(null);
      setCanvas((curr) =>
        curr && {
          ...curr,
          beats: nextBeats,
          notes: result.notes ?? curr.notes,
          flags: result.flags,
          error: null
        }
      );
      setBrief((curr) => ({
        ...curr,
        scriptBeats: nextBeats,
        ...(result.project.keepOverLength || curr.keepOverLength ? { keepOverLength: true } : {})
      }));
      replaceProject(result.project);
      if (result.project.state === "Draft storyboard") {
        setJob(null);
      }
      drawFrames(result.project, nextBeats, [position]);
    } catch (caught) {
      if (!signal?.aborted) {
        showLimit(caught);
      }
      throw caught;
    } finally {
      pendingMutation.current = false;
      ++mutationEpoch.current;
    }
  };

  const removeSceneAt = async (index: number) => {
    if (!canvas || canvas.streaming) return;
    if (canvas.beats.length <= SCRIPT_BEATS_MIN) {
      throw new Error("A storyboard needs at least one scene.");
    }
    const checked = parseScriptBrief(filmSafe(brief));
    if ("error" in checked) {
      throw new Error(checked.error);
    }
    const active = await ensureProject();
    const currentBeats = ensureScriptBeatIds(canvas.beats);
    const removedBeat = currentBeats[index];
    if (!removedBeat) {
      throw new Error("Choose an existing scene to remove.");
    }
    const versionSnap = remapRecordOnRemove(versions, index);
    const frameAtSnap = remapRecordOnRemove(frameAt, index);
    const voiceErrSnap = remapRecordOnRemove(voiceErrors, index);
    const flagsSnap = remapFlagsOnRemove(canvas.flags, index);
    const cachedFrameSvg = frameAtSnap.removed ?? frameCache.current[frameKey(removedBeat)]?.svg;

    pendingMutation.current = true;
    ++mutationEpoch.current;
    try {
      const result = await removeScriptScene(active.id, {
        index,
        brief: checked.brief,
        beats: currentBeats
      });
      const survivingIds = [...currentBeats.slice(0, index), ...currentBeats.slice(index + 1)];
      const nextBeats = ensureScriptBeatIds(
        result.beats.map((b, i) => (survivingIds[i]?.id ? { ...b, id: survivingIds[i]!.id } : b))
      );
      setVersions(versionSnap.next);
      setFrameAt(frameAtSnap.next);
      setVoiceErrors(voiceErrSnap.next);
      setVoicingIndices((curr) => remapIndicesOnRemove(curr, index));
      setCanvas((curr) =>
        curr && {
          ...curr,
          beats: nextBeats,
          flags: flagsSnap.next,
          error: null
        }
      );
      setBrief((curr) => ({
        ...curr,
        scriptBeats: nextBeats,
        ...(result.project.keepOverLength || curr.keepOverLength ? { keepOverLength: true } : {})
      }));
      replaceProject(result.project);
      if (result.project.state === "Draft storyboard") {
        setJob(null);
      }
      setUndoSceneState({
        projectId: active.id,
        index,
        beat: removedBeat,
        planBeat: result.removedPlanBeat,
        overrides: result.removedOverrides,
        ...(versionSnap.removed ? { versionEntry: versionSnap.removed } : {}),
        ...(cachedFrameSvg ? { frameSvg: cachedFrameSvg } : {}),
        ...(voiceErrSnap.removed ? { voiceError: voiceErrSnap.removed } : {}),
        flags: flagsSnap.removed
      });
    } finally {
      pendingMutation.current = false;
      ++mutationEpoch.current;
    }
  };

  const undoRemoveScene = async () => {
    if (!canvas || canvas.streaming || !undoSceneState || undoSceneState.busy) return;
    if (project && undoSceneState.projectId !== project.id) return;
    const snap = undoSceneState;
    const checked = parseScriptBrief(filmSafe(brief));
    if ("error" in checked) {
      throw new Error(checked.error);
    }
    setUndoSceneState((curr) => (curr ? { ...curr, busy: true, error: null } : null));
    const active = await ensureProject();
    const currentBeats = ensureScriptBeatIds(canvas.beats);
    pendingMutation.current = true;
    ++mutationEpoch.current;
    try {
      const result = await restoreScriptScene(active.id, {
        index: snap.index,
        beat: snap.beat,
        planBeat: snap.planBeat,
        overrides: snap.overrides,
        brief: checked.brief,
        beats: currentBeats
      });
      const expectedIds = [
        ...currentBeats.slice(0, snap.index),
        snap.beat,
        ...currentBeats.slice(snap.index)
      ];
      const nextBeats = ensureScriptBeatIds(
        result.beats.map((b, i) => (expectedIds[i]?.id ? { ...b, id: expectedIds[i]!.id } : b))
      );
      if (snap.frameSvg) {
        putFrames([[frameKey(snap.beat), { state: "ready", svg: snap.frameSvg }]]);
      }
      setVersions((curr) => {
        const shifted = remapRecordOnInsert(curr, snap.index);
        if (snap.versionEntry) shifted[snap.index] = snap.versionEntry;
        return shifted;
      });
      setFrameAt((curr) => {
        const shifted = remapRecordOnInsert(curr, snap.index);
        if (snap.frameSvg) shifted[snap.index] = snap.frameSvg;
        return shifted;
      });
      setVoiceErrors((curr) => {
        const shifted = remapRecordOnInsert(curr, snap.index);
        if (snap.voiceError) shifted[snap.index] = snap.voiceError;
        return shifted;
      });
      setVoicingIndices((curr) => remapIndicesOnInsert(curr, snap.index));
      setCanvas((curr) =>
        curr && {
          ...curr,
          beats: nextBeats,
          flags: remapFlagsOnInsert(curr.flags, snap.index, snap.flags),
          error: null
        }
      );
      setBrief((curr) => ({
        ...curr,
        scriptBeats: nextBeats,
        ...(result.project.keepOverLength || curr.keepOverLength ? { keepOverLength: true } : {})
      }));
      replaceProject(result.project);
      setUndoSceneState(null);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : "Could not restore the scene.";
      setUndoSceneState((curr) => (curr ? { ...curr, busy: false, error: msg } : null));
      throw caught;
    } finally {
      pendingMutation.current = false;
      ++mutationEpoch.current;
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
  const [plateAutoStart, setPlateAutoStart] = useState(false);

  const syncCurrentBriefToProject = useCallback(async () => {
    if (!project) return;
    const checked = parseScriptBrief(filmSafe(brief));
    if ("error" in checked) return;
    const nextBeats = canvas?.beats?.length ? ensureScriptBeatIds(canvas.beats) : project.brief?.scriptBeats;
    const saved = await updateProject(project.id, {
      brief: {
        ...project.brief,
        ...checked.brief,
        ...(nextBeats?.length ? { scriptBeats: nextBeats } : {}),
        ...(canvas?.notes ?? project.brief?.scriptNotes ? { scriptNotes: canvas?.notes ?? project.brief?.scriptNotes } : {})
      }
    });
    replaceProject(saved);
  }, [project, brief, canvas?.beats, canvas?.notes, replaceProject]);

  useEffect(() => {
    if (!animating) return;
    const timer = window.setInterval(() => {
      setAnimProgress((curr) => (curr < 94 ? curr + 1 : curr));
    }, 350);
    return () => window.clearInterval(timer);
  }, [animating]);

  // Code-drawn plate styles draw their scenes in PlatePreview (drawing, verification and assembly run on the render worker).
  // Only where the backend has the plate pipeline on (PLATE_PIPELINE=worker): elsewhere these styles keep their previous behaviour.
  const effectiveLook = project?.brief?.look ?? brief.look ?? null;
  const plateLook = Boolean(effectiveLook?.startsWith("illus-"));
  // The answer is kept with the project it belongs to, so there is no render in which a plate project is "not yet known" and the
  // previous animation editor flashes up.
  const [plateAnswer, setPlateAnswer] = useState<PlateAnswerState | null>(null);
  const plateAnswerRef = useRef<PlateAnswerState | null>(null);
  plateAnswerRef.current = plateAnswer;
  const prevAnimatingForPlateRef = useRef<boolean>(animating);
  const prevProjectLookForPlateRef = useRef<string | undefined>(project?.brief?.look);
  useEffect(() => {
    const wasAnimating = prevAnimatingForPlateRef.current;
    prevAnimatingForPlateRef.current = animating;
    const prevLook = prevProjectLookForPlateRef.current;
    prevProjectLookForPlateRef.current = project?.brief?.look;
    const animatingFinished = wasAnimating && !animating;
    const lookChanged = prevLook !== project?.brief?.look;
    const stepIsRender = step === RENDER;

    if (!plateLook || !project?.id) return;
    if (
      plateAnswerRef.current?.id === project.id &&
      plateAnswerRef.current.available === true &&
      !animatingFinished &&
      !lookChanged
    ) {
      return;
    }

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = project.id;
    const startedAt = Date.now();
    let errorAttempts = 0;

    if (
      (animatingFinished || lookChanged || stepIsRender) &&
      plateAnswerRef.current?.id === id &&
      plateAnswerRef.current.available === false
    ) {
      const resetState: PlateAnswerState = { id, available: null, falseCount: 0 };
      plateAnswerRef.current = resetState;
      setPlateAnswer(resetState);
    }

    const check = () => {
      getPlates(id)
        .then((status) => {
          if (!live) return;
          errorAttempts = 0;
          const next = nextPlateAnswer(
            plateAnswerRef.current,
            id,
            { ok: true, available: status.available, look: status.look },
            effectiveLook
          );
          plateAnswerRef.current = next;
          setPlateAnswer(next);
          if (next && next.available === null && next.falseCount === 1) {
            timer = setTimeout(() => {
              if (live) check();
            }, PLATE_CONFIRM_FALSE_DELAY_MS);
          }
        })
        .catch(() => {
          if (!live) return;
          const next = nextPlateAnswer(
            plateAnswerRef.current,
            id,
            { ok: false },
            effectiveLook
          );
          plateAnswerRef.current = next;
          setPlateAnswer(next);
          const delay = plateRetryDelayMs(errorAttempts, Date.now() - startedAt);
          errorAttempts += 1;
          if (delay !== null) {
            timer = setTimeout(() => {
              if (live) check();
            }, delay);
          }
        });
    };

    check();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [plateLook, project?.id, project?.brief?.look, effectiveLook, step, animating]);
  const { plateKnown, isPlateStyle, plateChecking } = resolvePlateRouting(plateLook, project?.id, plateAnswer);
  const plateFallbackNotice = plateLook && plateKnown && plateAnswer?.available === false ? PLATE_FALLBACK_NOTICE : null;
  const [plateTokens, setPlateTokens] = useState<number | null>(null);
  useEffect(() => {
    if (!isPlateStyle || !project?.id || !project.beatPlan) { setPlateTokens(null); return; }
    let live = true;
    getRenderQuote(project.id).then((quote) => { if (live) setPlateTokens(quote.tokens); }).catch(() => { if (live) setPlateTokens(null); });
    return () => { live = false; };
  }, [isPlateStyle, project?.id, project?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setPlateAutoStart(true);
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
      showLimit(caught); setAnimError(caught instanceof Error ? caught.message : "Could not prepare the browser animation.");
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
    const planned = project?.beatPlan && !project.brief?.scriptBeats?.length ? ensureScriptBeatIds(project.beatPlan.beats.map((beat) => ({ keyword: beat.keyword, visual: null, onScreen: beat.on_screen ?? null, line: beat.line ?? null }))) : null;
    if (!canvas && planned) setCanvas({ beats: planned, notes: null, previous: [], open: null, writing: null, streaming: false, startedAt: Date.now(), flags: [], error: null });
    if (!canvas && project?.brief?.scriptBeats?.length) setCanvas({ beats: ensureScriptBeatIds(project.brief.scriptBeats), notes: project.brief.scriptNotes ?? null, previous: [], open: null, writing: null, streaming: false, startedAt: Date.now(), flags: [], error: null });
    if (!project) { canvasStop.current?.abort(); setCanvas(null); }
    frameCache.current = {}; setFrameAt({}); setVoiceRun({ state: "idle" }); setVersions({}); setUndoSceneState(null);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The project list leaves the frames out, so only a fuller copy adds to the cache; nothing here removes from it.
  useEffect(() => {
    const saved = (project?.scriptFrames ?? []).filter((frame) => frameCache.current[frame.key]?.state !== "ready");
    if (saved.length) putFrames(saved.map((frame) => [frame.key, { state: "ready", svg: frame.svg }]));
  }, [project?.id, project?.scriptFrames]); // eslint-disable-line react-hooks/exhaustive-deps
  // Frames for a script that was never drawn here (a reopened project): drawn once, not after every edit.
  useEffect(() => {
    if (step !== STORYBOARD || !canvas || canvas.streaming || !project) return;
    const missing = canvas.beats.map((_, i) => i).filter((i) => frameAt[i] === undefined && !frameCache.current[frameKey(canvas.beats[i]!)]);
    if (missing.length) drawFrames(project, canvas.beats, missing);
  }, [step, project?.id, canvas?.streaming, canvas?.beats.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const prevStep = step;
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
      if (prevStep === RENDER) setStep(RENDER);
      showLimit(caught); setError(caught instanceof Error ? caught.message : "Could not start the render.");
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

  const isFilmBriefView = view === "create" && step === SCRIPT_STYLE && isFilmBrief(brief);
  const isStoryboardView = view === "create" && step === STORYBOARD && Boolean(canvas);
  const isAnimationView = view === "create" && step === RENDER;

  return <main
    className={
      isFilmBriefView
        ? "relay-shell relay-shell--film-brief"
        : isStoryboardView
          ? "relay-shell relay-shell--storyboard"
          : isAnimationView
            ? "relay-shell relay-shell--animation"
            : "relay-shell"
    }
    style={
      view === "create" && step === REVIEW
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
    /> : null : view === "create" ? <><CreationHeader name={project?.name ?? "Untitled video"} state={project?.state ?? "Ready to create"} step={step} back={() => setView("projects")} reachable={project ? Math.max(step, statusStep(project), project.beatPlan || (canvas && (!isFilmBrief(brief) || step !== SCRIPT_STYLE)) ? STORYBOARD : SCRIPT_STYLE, project.renderJobId && (project.state === "Ready for review" || project.state === "Revisions needed") ? REVIEW : SCRIPT_STYLE) : step} go={(target) => setStep(target as Step)} openStudio={project?.script && !project.beatPlan ? openStudio : undefined} />
      {error && step !== SCRIPT_STYLE && !(step === STORYBOARD && canvas) && step !== RENDER && step !== REVIEW && <p className="workspace-error">{error}</p>}
      {step === STORYBOARD && canvas && <ScriptCanvas
        projectId={project?.id ?? draftId ?? undefined}
        keepOverLength={Boolean(project?.keepOverLength || project?.brief?.keepOverLength || brief.keepOverLength)}
        onKeepOverLength={acceptOverLength}
        beats={canvas.beats} open={canvas.open} streaming={canvas.streaming} startedAt={canvas.startedAt} firstAt={canvas.firstAt} flags={canvas.flags} error={canvas.error ?? error}
        limit={limit} onTryAgain={() => void writeScript()} onBackToBrief={() => setStep(SCRIPT_STYLE)}
        voiced={voicedBrief}
        length={{ seconds: brief.durationSeconds, pace: brief.pace, locked: Boolean(brief.lockDuration), scriptLed: isScriptLedDuration(brief), keepOverLength: Boolean(project?.keepOverLength || project?.brief?.keepOverLength || brief.keepOverLength) }}
        onFit={fitScript}
        onEdit={editScriptBeat} onAsk={(instruction, only) => void writeScript(instruction, undefined, only)} writing={canvas.writing} scoped={Boolean(canvas.scoped)}
        versions={canvas.beats.map((_, i) => versions[i] ? { count: versions[i]!.list.length, at: versions[i]!.at } : null)}
        onReimagine={reimagineBeat} onVersion={showVersion} onCancel={() => canvasStop.current?.abort()}
        frames={frameSlots} aspect={brief.aspect} styleName={findGalleryTemplate(brief.styleExample)?.name}
        onRedraw={(index) => { if (project) drawFrames(project, canvas.beats, [index], true); }}
        voice={voice} onConfirm={confirmScript} onRetryVoice={retryVoice} music={musicBrief}
        onRender={renderFromScript} rendering={busy || animating}
        storyboard={storyboardState} onContinue={continueFromScript} continuing={continueWhenReady}
        onInsertScene={insertSceneAt}
        onRemoveScene={removeSceneAt}
        undoScene={undoSceneState && (!project || undoSceneState.projectId === project.id) ? { index: undoSceneState.index, keyword: undoSceneState.beat.keyword, busy: undoSceneState.busy, error: undoSceneState.error } : null}
        onUndoRemoveScene={undoRemoveScene}
        onDismissUndoScene={() => setUndoSceneState(null)} />}
      {seePlans && limit && <PlanLimitModal limit={limit} onClose={() => setSeePlans(false)} onBack={step === STORYBOARD ? () => { setSeePlans(false); setStep(SCRIPT_STYLE); } : undefined} />}
      {step === STORYBOARD && !canvas && <div className="flow-page"><div className="flow-title"><h1>No storyboard yet.</h1><p>Describe the film in the brief, then generate the storyboard.</p></div><button className="primary-button" onClick={() => setStep(SCRIPT_STYLE)}>Go to the brief</button></div>}
      {step === SCRIPT_STYLE && isFilmBrief(brief) && <FilmBrief brief={brief} update={(patch) => setBrief((current) => ({ ...current, ...patch }))} error={error} back={() => setView("projects")}
        draft={canvas} writeDraft={(instruction) => void writeScript(instruction, undefined, undefined, true)} editDraft={editScriptBeat} stopDraft={() => canvasStop.current?.abort()} continueDraft={() => void continueDraft()} continueToStoryboard={() => setStep(STORYBOARD)} hasStoryboard={Boolean(project?.beatPlan)} />}
      {step === SCRIPT_STYLE && !isFilmBrief(brief) && <ScriptStyleStep brief={brief} update={(patch) => setBrief((current) => ({ ...current, ...patch }))} site={site} readSite={(url) => void readSite(url)} screenshots={<Screenshots project={project} busy={busy} upload={uploadScreenshot} remove={removeScreenshot} />} generating={generating && !canvas} elapsed={elapsed} error={error} generate={() => void writeScript()} cancel={() => void cancelPlan()} hasPlan={Boolean(project?.beatPlan || (canvas && canvas.beats.length > 0))} confirmRegenerate={confirmRegenerate} setConfirmRegenerate={setConfirmRegenerate} continueToStoryboard={() => setStep(STORYBOARD)} back={() => setView("projects")} />}
      {step === RENDER && project && plateChecking && !animating && <div className="workspace-message" role="status">Opening your scenes…</div>}
      {step === RENDER && project && isPlateStyle && !animating && project.beatPlan && <PlatePreview
        project={{
          ...project,
          brief: {
            ...(project.brief ?? brief),
            ...(brief.look ? { look: brief.look } : {}),
            ...(brief.styleFamily !== undefined ? { styleFamily: brief.styleFamily } : {}),
            ...(brief.styleExample !== undefined ? { styleExample: brief.styleExample } : {}),
            ...(brief.text ? { text: brief.text } : {}),
            ...(canvas?.beats?.length ? { scriptBeats: canvas.beats } : {}),
            aspect: brief.aspect,
            ...(brief.aspects?.length ? { aspects: brief.aspects } : {}),
            durationSeconds: brief.durationSeconds,
            ...(brief.durationMode ? { durationMode: brief.durationMode } : {})
          }
        }}
        autoStart={plateAutoStart}
        onBeforeDraw={syncCurrentBriefToProject}
        onBack={() => { setPlateAutoStart(false); setStep(STORYBOARD); }}
        onRender={() => void submit()}
        rendering={busy}
        renderError={error}
        {...(plateTokens !== null ? { cost: plateTokens } : {})}
      />}
      {step === RENDER && project && !plateChecking && !(isPlateStyle && !animating && project.beatPlan) && <BrowserAnimationStep
        project={{ ...project, brief: { ...(project.brief ?? brief), aspect: brief.aspect, ...(brief.aspects?.length ? { aspects: brief.aspects } : {}), durationSeconds: brief.durationSeconds, ...(brief.durationMode ? { durationMode: brief.durationMode } : {}) } }}
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
        motionBlur={motionBlur}
        setMotionBlur={setMotionBlur}
        notice={plateFallbackNotice}
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
      {step === REVIEW && project && isPlateStyle && job?.state === "ready" && job.output && <PlateFinal project={{ ...project, brief: { ...(project.brief ?? brief), aspect: brief.aspect, ...(brief.aspects?.length ? { aspects: brief.aspects } : {}) } }} finalUrl={outputUrl(job.output.url)} onBack={() => setStep(RENDER)} onApprove={approve} approved={project.state === "Approved"} />}
      {step === REVIEW && project && plateChecking && <div className="workspace-message" role="status">Opening your film…</div>}
      {step === REVIEW && project && !plateChecking && !(isPlateStyle && job?.state === "ready" && job.output) && <FinalRenderStep
        project={project}
        job={job}
        frames={frameSlots.map((slot) => slot?.svg ?? null)}
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
      {view === "projects" && <Projects brands={brands} projects={projects.filter((item) => !(item as { painted?: unknown }).painted)} loading={loadingProjects} loaded={projectsLoaded} busy={busy} create={() => void begin()} startTemplate={(item) => void beginFromGallery(item)} browseTemplates={() => router.push("/templates")} open={(item) => void openProject(item)} openStudio={(item) => void openProjectStudio(item)} archive={async (item, nextArchived) => { const saved = await updateProject(item.id, { archived: nextArchived }); setProjects((current) => current.map((entry) => (entry.id === item.id ? saved : entry))); }} remove={async (item) => { await deleteProject(item.id); setProjects((current) => current.filter((entry) => entry.id !== item.id)); }} />}
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
  const kind = getStyleFamily(project.brief?.styleFamily)?.name ?? template?.name ?? "Template";
  // The real length once rendered, else the script's estimate, else the target the brief asked for.
  const seconds = project.filmSeconds ?? (project.brief?.scriptBeats?.length ? scriptSeconds(project.brief.scriptBeats, project.brief.pace) : null) ?? project.beatPlan?.target_duration_s ?? project.brief?.durationSeconds ?? template?.durationSeconds ?? 0;
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

