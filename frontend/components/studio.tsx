"use client";

import { useRouter } from "next/navigation";
import { optimisticUpdate } from "../lib/optimistic";
import { useCallback, useEffect, useRef, useState } from "react";
import { aspectToFormat, beatCountRange, scriptSeconds, bundledFonts, findGalleryTemplate, wordBudget, scriptFrameKey, voiceText, getLook, getStyleFamily, defaultTemplateId, deriveBrandTheme, findTemplate, findTheme, parseScriptBrief, parseScriptStream, templates, themes, type BeatPlan, type BrandKit, type ScriptBeat, type ScriptNotes, type GalleryCard, type ProjectStudioDraft, type RenderJob, type RenderStage, type RenderRequest, type ScriptBrief, type Template, type VideoProject } from "@videosaas/contracts";
import { GalleryGrid, useGalleryShelf } from "./template-gallery";
import { AppHeader } from "./app-shell";
import { StudioEditor, type StudioDraftInput } from "./studio-editor";
import { defaultBrief, ScriptStyleStep, type SiteState } from "./script-style";
import { BeatStoryboardStep, FrameCard, type FrameLook } from "./beat-storyboard";
import { ScriptCanvas, svgSrc, type FrameSlot, type StoryboardState, type VoiceState } from "./script-canvas";
import { createClient } from "../utils/supabase/client";
import { useMediaToken } from "../lib/use-media-token";
import { cancelPlanJob, generatePlanAudio, getGalleryTemplate, getProject, planVoiceUrl, streamFrames, streamScript, type ScriptFlag, addProjectReviewComment, applyProjectReviewComments, approveProject, createProject, editPlan, getRenderJob, listBrandKits, listProjects, outputUrl, projectScreenshotUrl, removeProjectReviewComment, planProject, readProductSite, removeProjectScreenshot, renderProject, saveBrandKit, saveProjectStudio, updateProject, uploadProjectScreenshot, watchRenderJob } from "../lib/api";
import { proMenuEntry, useEntitlements } from "../lib/entitlements";

type View = "projects" | "create" | "studio";
type Step = 0 | 1 | 2 | 3;
// v2 flow (docs/PRODUCT_FLOW_V2.md): everything the film needs is chosen on Script & style.
// Brief → storyboard (the script page: script, reference frames, voice) → render → review.
const SCRIPT_STYLE: Step = 0, STORYBOARD: Step = 1, RENDER: Step = 2, REVIEW: Step = 3;
const flowSteps: [Step, string][] = [[SCRIPT_STYLE, "Brief"], [STORYBOARD, "Storyboard"], [RENDER, "Render"], [REVIEW, "Review"]];
const imageFor = (template: Template) => "/templates/" + template.id + ".jpg";

function statusStep(project: VideoProject): Step {
  if (project.state === "Approved" || project.state === "Ready for review" || project.state === "Revisions needed") return REVIEW;
  if (project.state === "Rendering draft" || project.state === "Render needs attention") return RENDER;
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
  useEffect(() => { if (step !== SCRIPT_STYLE) setConfirmRegenerate(false); }, [step]);
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
    else if (planning?.status === "running") setError("Writing was interrupted because our service restarted. Generate again — nothing was charged.");
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
  // Confirm script → voiceover. Voicing needs the beat plan (the takes are keyed to its beats), so it waits for the storyboard.
  const [voiceRun, setVoiceRun] = useState<{ state: "idle" | "storyboard" | "voicing" | "failed"; error?: string }>({ state: "idle" });
  const voicedBrief = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  // Takes are matched by their words, so a beat the person did not change keeps its take after another beat is edited.
  const voiceTakes = (canvas?.beats ?? []).map((beat) => {
    const text = voiceText(beat.line);
    const take = text ? project?.planAudio?.voice?.lines.find((line) => line.text === text) : undefined;
    return take && project ? planVoiceUrl(project.id, take.file) : null;
  });
  // The film's sound is ready when every line has its take and, if the brief has music, the bed exists: only then can it render.
  const musicBrief = brief.audio.mode === "music" || brief.audio.mode === "both";
  const allVoiced = Boolean(canvas?.beats.length) && canvas!.beats.every((beat, i) => !beat.line || voiceTakes[i]) && (!musicBrief || Boolean(project?.planAudio?.music));
  const voice: VoiceState = { state: allVoiced ? "ready" : voiceRun.state, takes: voiceTakes, ...(voiceRun.error ? { error: voiceRun.error } : {}) };
  const recordVoice = async (active: VideoProject) => {
    setVoiceRun({ state: "voicing" });
    try { replaceProject((await generatePlanAudio(active.id, musicBrief ? undefined : ["voice"])).project); setVoiceRun({ state: "idle" }); }
    catch (caught) { setVoiceRun({ state: "failed", error: caught instanceof Error ? caught.message : "Could not record the voiceover." }); }
  };
  const confirmScript = () => {
    if (!canvas || !project) return;
    if (storyboardState.state === "ready") { void recordVoice(project); return; }
    setVoiceRun({ state: "storyboard" });
    if (storyboardState.state !== "building") void buildStoryboard(project, canvas.beats);
  };
  useEffect(() => {
    if (voiceRun.state !== "storyboard" || !project) return;
    if (storyboardState.state === "ready") void recordVoice(project);
    if (storyboardState.state === "failed") setVoiceRun({ state: "failed", error: storyboardState.error ?? "Could not plan the beats." });
  }, [voiceRun.state, storyboardState.state]); // eslint-disable-line react-hooks/exhaustive-deps
  // Render straight from the script once its sound is made. The beat plan must match the script, so it waits for a rebuild
  // after edits; the server still checks every render rule (and refuses a film without its voiceover).
  const [renderWhenReady, setRenderWhenReady] = useState(false);
  // Render opens step 3 at once; until the job exists the page shows what is being prepared (sound, scene plan, motion).
  const [prepping, setPrepping] = useState(false);
  const startRender = async () => {
    setRenderWhenReady(false);
    await submit();
    setPrepping(false);
  };
  // Render works whether or not the sound was previewed: missing takes (and music) are made first, then the film renders.
  const needsSound = voicedBrief || musicBrief;
  const renderFromScript = () => {
    if (!canvas || !project) return;
    setJob(null);
    setError(null);
    setPrepping(true);
    setStep(RENDER);
    setRenderWhenReady(true);
    if (needsSound && !allVoiced) { if (voiceRun.state === "idle" || voiceRun.state === "failed") confirmScript(); return; }
    if (storyboardState.state !== "ready" && storyboardState.state !== "building") void buildStoryboard(project, canvas.beats);
  };
  useEffect(() => {
    if (!renderWhenReady) return;
    if (voiceRun.state === "failed" || storyboardState.state === "failed") {
      setRenderWhenReady(false);
      setPrepping(false);
      setError(voiceRun.state === "failed" ? voiceRun.error ?? "Could not make the voiceover." : storyboardState.error ?? "Could not plan the scenes.");
      return;
    }
    if (storyboardState.state === "ready" && (!needsSound || allVoiced) && voiceRun.state === "idle") void startRender();
  }, [renderWhenReady, storyboardState.state, allVoiced, voiceRun.state]); // eslint-disable-line react-hooks/exhaustive-deps
  // The Render step without a job in hand (a reload mid-render, or state lost) picks up the project's own render.
  useEffect(() => {
    if (step !== RENDER || job || prepping || !project?.renderJobId) return;
    let live = true;
    getRenderJob(project.renderJobId).then((found) => { if (live) setJob(found); }).catch(() => undefined);
    return () => { live = false; };
  }, [step, job, prepping, project?.renderJobId]); // eslint-disable-line react-hooks/exhaustive-deps
  const prepStage: RenderPrep = !prepping ? null : needsSound && !allVoiced ? "sound" : storyboardState.state !== "ready" ? "scenes" : "motion";
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
    try {
      if (project.script && !project.script.confirmed) replaceProject(await updateProject(project.id, { script: { ...project.script, confirmed: true, updatedAt: new Date().toISOString() } }));
      const started = await renderProject(project.id, { motionBlur });
      setJob(started);
      // The server has marked the project as rendering this job; mirror it here instead of reading the project back.
      const rendering = (item: VideoProject) => item.id === project.id ? { ...item, state: "Rendering draft" as const, renderJobId: started.id } : item;
      setProject((current) => current && rendering(current));
      setProjects((current) => current.map(rendering));
      setStep(RENDER);
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

  return <main className="relay-shell">
    <div className="ambient ambient-blue" /><div className="ambient ambient-peach" />
    {view === "studio" ? project ? <StudioEditor
      project={project}
      initialValues={project.studio ? undefined : job?.revision.values}
      onSave={saveStudio}
      onRender={async () => { if (await submit()) setView("create"); }}
      onBack={() => setView("create")}
      screenshotUrl={projectScreenshotUrl}
    /> : null : view === "create" ? <><CreationHeader name={project?.name ?? "Untitled video"} state={project?.state ?? "Ready to create"} step={step} back={() => setView("projects")} reachable={project ? Math.max(step, statusStep(project), project.beatPlan || canvas ? STORYBOARD : SCRIPT_STYLE) : step} go={(target) => setStep(target as Step)} openStudio={project?.script && !project.beatPlan ? openStudio : undefined} editorFor={project?.beatPlan ? project.id : undefined} />
      {error && step !== SCRIPT_STYLE && !(step === STORYBOARD && canvas) && <p className="workspace-error">{error}</p>}
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
        voice={voice} onConfirm={confirmScript} music={musicBrief}
        onRender={renderFromScript} rendering={busy || renderWhenReady}
        storyboard={storyboardState} onContinue={continueFromScript} continuing={continueWhenReady} />}
      {step === STORYBOARD && !canvas && <div className="flow-page"><div className="flow-title"><h1>No storyboard yet.</h1><p>Describe the film in the brief, then generate the storyboard.</p></div><button className="primary-button" onClick={() => setStep(SCRIPT_STYLE)}>Go to the brief</button></div>}
      {step === SCRIPT_STYLE && <ScriptStyleStep brief={brief} update={(patch) => setBrief((current) => ({ ...current, ...patch }))} site={site} readSite={(url) => void readSite(url)} screenshots={<Screenshots project={project} busy={busy} upload={uploadScreenshot} remove={removeScreenshot} />} generating={generating && !canvas} elapsed={elapsed} error={error} generate={() => void writeScript()} cancel={() => void cancelPlan()} hasPlan={Boolean(project?.beatPlan || canvas)} confirmRegenerate={confirmRegenerate} setConfirmRegenerate={setConfirmRegenerate} continueToStoryboard={() => setStep(STORYBOARD)} back={() => setView("projects")} />}
      {step === RENDER && project && <RenderStep frames={frameSlots.map((slot) => slot?.svg).filter((svg): svg is string => Boolean(svg))} prep={prepStage} prepSound={needsSound} fromStoryboard={Boolean(canvas)} look={lookFor(brief, brands)} project={project} job={job} error={error} busy={busy || prepping} retry={async () => { if (canvas) renderFromScript(); else await submit(); }} back={() => setStep(STORYBOARD)} />}
      {step === REVIEW && project && <ReviewStep project={project} job={job} approve={approve} rerender={async () => { await submit(); }} addComment={addReviewComment} removeComment={removeReviewComment} applyChanges={applyReviewComments} openStudio={openStudio} />}
    </> : <><AppHeader active="projects" />
      {error && <p className="workspace-error" role="alert">{error}</p>}
      {loadError && <div className="workspace-error" role="alert">{loadError} <button disabled={loadingProjects} onClick={() => { setLoadingProjects(true); void refresh(); }}>{loadingProjects ? "Retrying…" : "Try again"}</button></div>}
      {view === "projects" && <Projects brands={brands} projects={projects} loading={loadingProjects} loaded={projectsLoaded} busy={busy} create={() => void begin()} startTemplate={(item) => void beginFromGallery(item)} browseTemplates={() => router.push("/templates")} open={(item) => void openProject(item)} openStudio={(item) => void openProjectStudio(item)} />}
    </>}
  </main>;
}

function CreationHeader({ name, state, step, reachable, back, go, openStudio, editorFor }: { name: string; state: string; step: Step; reachable: number; back: () => void; go: (step: number) => void; openStudio?: () => void; editorFor?: string }) {
  const { state: planState, retry: retryPlan } = useEntitlements();
  const editorEntry = proMenuEntry(planState);
  return <header className="creation-header"><div className="creation-project"><button onClick={back}>← Projects</button><i /><strong>{name}</strong><span>{state}</span>{editorFor && <button className="creation-editor" disabled={Boolean(editorEntry?.disabled)} onClick={() => { if (editorEntry?.action === "retry") retryPlan(); else window.location.assign(`/editor/${editorFor}`); }}>{editorEntry?.action === "retry" ? "Editor: retry" : "Open in editor"}</button>}{openStudio && <button className="creation-studio" style={{ marginLeft: "auto", padding: "6px 10px", border: "1px solid var(--d-bd-d6e4f2)", borderRadius: 999, background: "var(--d-bg-ffffff)", color: "var(--d-tx-0058bd)" }} onClick={openStudio}>Open Studio</button>}</div><ol className="flow-steps">{flowSteps.map(([id, label], position) => <li key={label}><button className={id === step ? "current" : id <= reachable ? "complete" : ""} disabled={id > reachable} onClick={() => go(id)}><b>{id !== step && id <= reachable ? "✓" : position + 1}</b>{label}</button>{position !== flowSteps.length - 1 && <i />}</li>)}</ol></header>;
}

/** The first templates, shown under the empty Projects page. Fetched from the backend: one row that fades out, so it feels like a library. */
function TemplateShelf({ startTemplate, browseTemplates, busy }: { startTemplate: (item: GalleryCard) => void; browseTemplates: () => void; busy: boolean }) {
  const { items, loading } = useGalleryShelf({ limit: 10 });
  return <div className="gallery-shelf"><div className="gallery-shelf-head"><div><h2>Start from a template</h2><p>Each one fills in the script prompt, structure and style for you. Edit anything before you generate.</p></div><button className="secondary-button" onClick={browseTemplates}>Browse all templates</button></div><GalleryGrid row onMore={browseTemplates} items={items} onUse={startTemplate} busy={busy} loading={loading} skeletons={4} /></div>;
}

function Projects({ brands, projects, loading, loaded, busy, create, startTemplate, browseTemplates, open, openStudio }: { projects: VideoProject[]; loading: boolean; loaded: boolean; busy: boolean; create: () => void; startTemplate: (item: GalleryCard) => void; browseTemplates: () => void; open: (project: VideoProject) => void; openStudio: (project: VideoProject) => void; brands: BrandKit[] }) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const groups = {
    All: projects,
    Drafts: projects.filter((item) => !["Ready for review", "Approved"].includes(item.state)),
    Review: projects.filter((item) => item.state === "Ready for review"),
    Approved: projects.filter((item) => item.state === "Approved")
  };
  const visibleProjects = groups[filter as keyof typeof groups];
  return <section className="page-container"><div className="page-heading"><div><h1>Projects</h1><p>Turn product updates into customer-ready videos.</p></div><div><button className="primary-button" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create a video"}</button></div></div><div className="filter-tabs">{Object.entries(groups).map(([label, items]) => <button key={label} className={filter === label ? "selected" : ""} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label} {(loaded || projects.length > 0) && <span>{items.length}</span>}</button>)}</div>{projects.length === 0 && !loaded ? loading ? <ProjectSkeletons /> : <div className="workspace-message" role="status">Projects could not be loaded. Use Try again above.</div> : projects.length === 0 ? <><div className="empty-workspace"><b>No projects yet.</b><p>Create a video to save a real brief, script, screenshots, and render history, or start from a template below.</p><button className="primary-button" onClick={create}>Create a video</button></div><TemplateShelf startTemplate={startTemplate} browseTemplates={browseTemplates} busy={busy} /></> : <div className="project-grid">{visibleProjects.length === 0 && <p role="status">No projects in this view.</p>}{visibleProjects.map((project) => <ProjectCard brands={brands} key={project.id} project={project} open={open} openStudio={openStudio} menuOpen={openMenuId === project.id} setMenuOpen={(next) => setOpenMenuId(next ? project.id : null)} />)}</div>}</section>;
}

/** Placeholder cards shaped like ProjectCard, so the grid is there before the projects arrive. */
function ProjectSkeletons() {
  return <div className="project-grid" role="status" aria-busy="true" aria-label="Loading your projects">{Array.from({ length: 3 }, (_, index) => <article className="project-card project-skeleton" key={index} aria-hidden="true"><span className="card-image" /><div className="project-content"><i /><i className="short" /><div className="project-meta"><i className="pill" /><i className="date" /></div></div></article>)}</div>;
}

function ProjectCard({ brands, project, open, openStudio, menuOpen, setMenuOpen }: { project: VideoProject; open: (project: VideoProject) => void; openStudio: (project: VideoProject) => void; menuOpen: boolean; setMenuOpen: (next: boolean) => void; brands: BrandKit[] }) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const { state: planState, retry: retryPlan } = useEntitlements();
  const proEntry = proMenuEntry(planState);
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
  return <article className={menuOpen ? "project-card menu-open" : "project-card"}><button className="card-image" onClick={() => open(project)}>{project.coverFrame ? <i className="card-frame"><img className="card-cover" src={svgSrc(project.coverFrame)} alt="" draggable={false} /></i> : firstBeat && project.brief ? <i className="card-frame"><FrameCard family={project.brief.styleFamily} beat={firstBeat} index={0} canvas={project.beatPlan!.canvas} look={lookFor(project.brief, brands)} lookId={project.brief.look ?? "clean"} screenshot={firstBeat.kind === "ui" && project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : undefined} /></i> : project.brief && !project.screenshots[0] ? <i className="card-placeholder">{kind}</i> : <img src={image} alt="" />}<span className="card-badge">{project.request.format === "portrait" ? "9:16" : "16:9"} · {Math.floor(seconds / 60)}:{String(Math.round(seconds % 60)).padStart(2, "0")}</span></button><div className="project-content"><div className="project-title"><h2>{project.name}</h2><p>{kind} · {project.request.brandId ? "Brand kit" : "No branding"}</p></div><div className="project-actions" ref={actionsRef}><button className="dots" type="button" aria-label={`Project actions for ${project.name}`} aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(!menuOpen)}><span className="dots-mark" aria-hidden="true"><i /><i /><i /></span></button>{menuOpen && <div className="project-menu" role="menu" aria-label={`Actions for ${project.name}`}><button type="button" role="menuitem" onClick={() => choose(() => open(project))}>Open project</button>{project.script && !project.beatPlan && <button type="button" role="menuitem" onClick={() => choose(() => openStudio(project))}>Open Studio</button>}{proEntry && <button type="button" role="menuitem" disabled={proEntry.disabled} onClick={() => { if (proEntry.action === "retry") retryPlan(); else choose(() => window.location.assign(`/editor/${project.id}`)); }}>{proEntry.label}</button>}</div>}</div><div className="project-meta"><b className={"status " + status}>{project.state}</b><time>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(project.updatedAt))}</time></div></div></article>;
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

function RenderStep({ project, job, error, busy, retry, back, look, prep, prepSound, fromStoryboard, frames }: { frames: string[]; project: VideoProject; job: RenderJob | null; error: string | null; busy: boolean; retry: () => Promise<void>; back: () => void; look?: FrameLook; prep: RenderPrep; prepSound: boolean; fromStoryboard: boolean }) {
  const title = project.script?.lines[0]?.onScreen || "Your video is rendering.";
  const failed = Boolean(error) || job?.state === "failed";
  const wantsAudio = Boolean(project.request.audio?.music || project.request.audio?.voiceover);
  // A film from the storyboard page is prepared first: its sound and scene plan here, then its motion inside the render job.
  const prepSteps: { key: string; label: string; stages: RenderStage[] }[] = fromStoryboard
    ? [...(prepSound ? [{ key: "sound", label: "Making the voiceover and music", stages: [] }] : []), { key: "scenes", label: "Planning the scenes", stages: [] }, { key: "motion", label: "Directing the motion", stages: ["queued", "planning", "directing"] }]
    : [];
  const steps = [...prepSteps, ...renderSteps.filter((item) => project.beatPlan ? item.key !== "plan" && item.key !== "audio" : item.key !== "audio" || wantsAudio)];
  const stage: RenderStage = job?.stage ?? (job?.state === "ready" ? "done" : job?.state === "rendering" ? "preparing" : "queued");
  const current = prep ? Math.max(0, prepSteps.findIndex((item) => item.key === prep))
    : stage === "done" ? steps.length
    : !job && fromStoryboard ? prepSteps.length
    : Math.max(prepSteps.length, steps.findIndex((item) => item.stages.includes(stage)));
  const detail = (key: string) => {
    if (key === "wait" && stage === "waiting") return job?.queuePosition ? `${job.queuePosition} ahead` : "Usually under a minute";
    if (key === "frames" && job?.frames) return `${job.frames.done} / ${job.frames.total}`;
    return null;
  };
  // A film from the storyboard shows its own approved frames while it renders, not a generic card.
  return <div className="render-workspace"><section className="workspace-player">{frames.length
    ? <FrameReel frames={frames} />
    : <Preview project={project} title={title} look={look} screenshot={project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : undefined} />}</section><aside className="render-card" style={look ? ({ "--rc": look.brand, "--rc-on": readableOnBrand(look.brand) } as React.CSSProperties) : undefined}><header><b>{failed ? "Render needs attention" : job?.state === "ready" ? "Draft render ready" : "Rendering draft"}</b><span>{project.request.format === "portrait" ? "9:16" : "16:9"}</span></header>{failed ? <div className="render-error"><b>We could not render this project.</b><p>{error || job?.error?.message}</p><div className="render-error-actions"><button disabled={busy} onClick={() => void retry()}>{busy ? "Starting…" : "Try again"}</button><button className="render-error-back" onClick={back}>Back to storyboard</button></div></div> : <><p className="render-walkaway"><b>You can walk away.</b> Rendering keeps going on our servers whether or not this page is open. Close the tab, and come back later: this project is in Projects, and Review opens as soon as the draft is ready.</p><ol>{steps.map((item, index) => <li className={index < current ? "done" : index === current ? "current" : ""} key={item.key}><i>{index < current ? "✓" : index + 1}</i><span>{item.label}</span>{index === current && detail(item.key) && <small>{detail(item.key)}</small>}</li>)}</ol>{stage === "retrying" && <p className="render-retry">Attempt {job?.attempt ?? 1} hit a renderer error. Trying again automatically.</p>}</>}</aside></div>;
}

function formatVideoTime(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return Math.floor(wholeSeconds / 60) + ":" + String(wholeSeconds % 60).padStart(2, "0");
}

const pinColors = ["#168BFF", "#FF5A1F", "#7C5CFF", "#16803C", "#B45309", "#0B1F4D"];
const commentExamples = ["Make this headline shorter.", "Use our brand color here.", "Show the screenshot for longer.", "Make this part faster.", "Make the logo bigger."];

function rulerStep(duration: number) {
  return [1, 2, 5, 10, 15, 30, 60].find((step) => duration / step <= 6) ?? 120;
}

function ReviewStep({ project, job, approve, rerender, addComment, removeComment, applyChanges, openStudio }: { project: VideoProject; job: RenderJob | null; approve: () => Promise<void>; rerender: () => Promise<void>; addComment: (input: { body: string; timestampSeconds: number }) => Promise<void>; removeComment: (commentId: string) => Promise<void>; applyChanges: () => Promise<void>; openStudio: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubbing = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [approving, setApproving] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  // Volume and mute are remembered on this device, and applied whenever the video element appears.
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  useEffect(() => { try { const saved = Number(localStorage.getItem("gm-review-volume")); if (Number.isFinite(saved) && localStorage.getItem("gm-review-volume") !== null) setVolume(Math.min(1, Math.max(0, saved))); setMuted(localStorage.getItem("gm-review-muted") === "1"); } catch { /* storage unavailable: defaults */ } }, []);
  useEffect(() => { const node = videoRef.current; if (node) { node.volume = volume; node.muted = muted; } }, [volume, muted, job?.output]);
  const changeVolume = (next: number) => { setVolume(next); setMuted(next === 0); try { localStorage.setItem("gm-review-volume", String(next)); localStorage.setItem("gm-review-muted", next === 0 ? "1" : "0"); } catch { /* ignore */ } };
  const toggleMute = () => { const next = !muted; setMuted(next); if (!next && volume === 0) setVolume(0.6); try { localStorage.setItem("gm-review-muted", next ? "1" : "0"); } catch { /* ignore */ } };
  const done = project.state === "Approved";
  // The draft is out of date when the style was changed after it was rendered (older drafts did not record theirs, so a newer project edit counts).
  const projectLook = project.brief?.look ?? "clean";
  const staleLook = Boolean(job?.output && (job.revision.look ? job.revision.look !== projectLook : projectLook !== "clean" && Date.parse(project.updatedAt) > Date.parse(job.createdAt) + 60_000));
  const comments = [...(project.comments ?? [])].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  // Scenes with real start/end: a storyboard render carries each beat's duration; older renders split evenly.
  const timed = job?.revision.scenes.length && job.revision.scenes.every((scene) => scene.duration > 0) ? job.revision.scenes : null;
  const scenes = timed ? timed.map((scene) => ({ label: scene.label, onScreen: scene.detail })) : project.script?.lines ?? [];
  const duration = job?.output?.durationSeconds ?? project.beatPlan?.target_duration_s ?? project.brief?.durationSeconds ?? findTemplate(project.request.template)?.durationSeconds ?? 10;
  const pct = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / Math.max(duration, 0.1)) * 100))}%`;
  const segments = (() => {
    const list = scenes.length ? scenes : [{ label: "Draft", onScreen: "" }];
    if (timed) {
      const total = timed.reduce((sum, scene) => sum + scene.duration, 0) || 1;
      let start = 0;
      return list.map((scene, index) => { const length = (timed[index]!.duration / total) * duration; const segment = { ...scene, start, end: start + length }; start += length; return segment; });
    }
    return list.map((scene, index) => ({ ...scene, start: (index / list.length) * duration, end: ((index + 1) / list.length) * duration }));
  })();
  const sceneAt = (seconds: number) => scenes.length ? Math.max(0, segments.findIndex((segment, index) => seconds < segment.end || index === segments.length - 1)) : 0;
  const activeSceneIndex = sceneAt(currentTime);
  const activeScene = scenes[activeSceneIndex];
  const sceneName = (index: number) => scenes[index] ? `Scene ${index + 1} · ${scenes[index].label}` : "Whole video";
  const step = rulerStep(duration);
  const ruler = Array.from({ length: Math.floor(duration / step) + 1 }, (_, index) => index * step);
  const seek = (seconds: number) => {
    const next = Math.max(0, Math.min(seconds, duration));
    setCurrentTime(next);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = next;
    }
  };
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };
  const timeAtPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return ((event.clientX - bounds.left) / bounds.width) * duration;
  };
  const saveComment = async () => {
    if (saving || applying || approving || draft.trim().length < 3) return;
    setSaving(true);
    setCommentError(null);
    try {
      await addComment({ body: draft, timestampSeconds: currentTime });
      setDraft((current) => current === draft ? "" : current);
    } catch (caught) {
      setCommentError(caught instanceof Error ? caught.message : "Could not save the review comment.");
    } finally {
      setSaving(false);
    }
  };
  const deleteComment = async (commentId: string) => {
    if (saving || applying || approving) return;
    setSaving(true);
    setCommentError(null);
    try {
      await removeComment(commentId);
    } catch (caught) {
      setCommentError(caught instanceof Error ? caught.message : "Could not remove the review comment.");
    } finally {
      setSaving(false);
    }
  };
  const confirmApproval = async () => {
    if (saving || applying || approving) return;
    setApproving(true);
    setCommentError(null);
    try { await approve(); }
    catch (caught) { setCommentError(caught instanceof Error ? caught.message : "Could not approve the video."); }
    finally { setApproving(false); }
  };
  const apply = async () => {
    if (saving || applying || approving) return;
    setApplying(true);
    setCommentError(null);
    try {
      await applyChanges();
    } catch (caught) {
      setCommentError(caught instanceof Error ? caught.message : "Could not apply the review comments.");
      setApplying(false);
    }
  };

  return <div className="review-workspace ce-workspace">
    <section className="ce-left">
      {staleLook && !done && <div className="ce-stale" role="status"><span><b>This draft was made in a different style.</b> The project now uses {getLook(project.brief?.look).name}. Render a new draft to see it.</span><button className="ce-download" onClick={() => void rerender()}>Render new draft</button></div>}
      <div className="ce-heading">
        <div><h1>Comment on the video</h1><p>Pause, pick the moment, and say what to change. Nothing changes until you apply it.</p></div>
        <div className="ce-howto">{["Pause", "Pick a moment", "Comment"].map((label, index) => <span key={label}><i>{index + 1}</i>{label}</span>)}</div>
        <div className="ce-actions">
          {job?.output && <a className="ce-download" href={outputUrl(job.output.url)} download>Download draft</a>}
          {!project.beatPlan && <button className="ce-download" onClick={openStudio}>Open Studio</button>}
          {done ? <><span className="ce-locked">✓ Approved · locked</span><button className="ce-download" onClick={() => void rerender()}>Render new draft</button></> : <button className="ce-approve" disabled={saving || applying || approving || !job?.output || comments.length > 0} title={comments.length ? "Apply or remove open comments before approving." : undefined} onClick={() => void confirmApproval()}>{approving ? "Approving…" : "Approve final"}</button>}
        </div>
      </div>
      <div className={"ce-player" + (project.request.format === "portrait" ? " portrait" : "")}>
        <div className="ce-stage">
          {job?.output ? <video ref={videoRef} playsInline preload="metadata" src={outputUrl(job.output.url)} onClick={togglePlay} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(event) => { if (!scrubbing.current) setCurrentTime(event.currentTarget.currentTime); }} /> : <Preview project={project} title={project.script?.lines[0]?.onScreen || "Waiting for a completed render."} screenshot={project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : undefined} />}
          {job?.output && !playing && !done && <span className="ce-hint">Paused · comment on this moment</span>}
        </div>
        <div className="ce-controls">
          <button aria-label={playing ? "Pause" : "Play"} disabled={!job?.output} onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
          <span className="ce-clock"><b>{formatVideoTime(currentTime)}</b> / {formatVideoTime(duration)}</span>
          <span className="ce-volume">
            <button type="button" aria-label={muted || volume === 0 ? "Unmute" : "Mute"} disabled={!job?.output} onClick={toggleMute}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" stroke="none" />{muted || volume === 0 ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <><path d="M15.5 9.2a4 4 0 010 5.6" />{volume >= 0.5 ? <path d="M18.3 6.5a8 8 0 010 11" /> : null}</>}</svg></button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume" disabled={!job?.output} onChange={(event) => changeVolume(Number(event.target.value))} />
          </span>
          <span className="ce-scene">{activeScene ? `Scene ${activeSceneIndex + 1} — ${activeScene.label}` : ""}</span>
        </div>
      </div>
      <div className="ce-timeline">
        <header><b>Timeline</b><span>Click to jump · drag to scrub</span></header>
        <div className="ce-track" role="slider" tabIndex={0} aria-label="Video timeline" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(currentTime * 10) / 10} aria-valuetext={formatVideoTime(currentTime)}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); scrubbing.current = true; seek(timeAtPointer(event)); }}
          onPointerMove={(event) => { if (scrubbing.current) seek(timeAtPointer(event)); }}
          onPointerUp={() => { scrubbing.current = false; }}
          onPointerCancel={() => { scrubbing.current = false; }}
          onKeyDown={(event) => { if (event.key === "ArrowLeft") seek(currentTime - 0.5); if (event.key === "ArrowRight") seek(currentTime + 0.5); if (event.key === " ") { event.preventDefault(); togglePlay(); } }}>
          <div className="ce-ruler">{ruler.map((seconds) => <span key={seconds} style={{ left: pct(seconds) }}>{formatVideoTime(seconds)}</span>)}</div>
          <div className="ce-pins">{comments.map((comment, index) => <button key={comment.id} title={comment.body} style={{ left: pct(comment.timestampSeconds), background: pinColors[index % pinColors.length] }} onPointerDown={(event) => { event.stopPropagation(); seek(comment.timestampSeconds); }}>{index + 1}</button>)}</div>
          <div className="ce-strip">{segments.map((segment, index) => <div key={segment.label + index} style={{ flex: Math.max(0.01, segment.end - segment.start) }} className={index === activeSceneIndex ? "active" : ""}><b>{String(index + 1).padStart(2, "0")} · {segment.label}</b><small>{formatVideoTime(segment.start)}–{formatVideoTime(segment.end)}</small></div>)}</div>
          <i className="ce-playhead" style={{ left: pct(currentTime) }} />
        </div>
      </div>
    </section>
    <aside className="ce-aside">
      {!done && <div className="ce-composer">
        <div className="ce-anchor"><span className="ce-chip-time">At {formatVideoTime(currentTime)}</span><span className="ce-chip-scene">{sceneName(activeSceneIndex)}</span><button className="ce-add" disabled={saving || applying || approving || draft.trim().length < 3} onClick={() => void saveComment()}>{saving ? "Saving…" : "Add"}</button></div>
        <textarea rows={2} value={draft} maxLength={600} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void saveComment(); }} placeholder="What should change here?" aria-label="Review comment" />
        <div className="ce-examples">{commentExamples.map((example) => <button key={example} onClick={() => setDraft(example)}>{example}</button>)}</div>
        {commentError && <p className="ce-error">{commentError}</p>}
      </div>}
      <div className="ce-comments">
        <header><b>Comments</b><span>{comments.length} open</span></header>
        <div className="ce-list">
          {comments.length === 0 ? <p className="ce-empty">{done ? "This revision was approved without open comments." : "No comments yet. Pause the video and add one."}</p> : comments.map((comment, index) => <div className="ce-comment" key={comment.id}>
            <div><span className="ce-pin" style={{ background: pinColors[index % pinColors.length] }}>{index + 1}</span><button className="ce-when" onClick={() => seek(comment.timestampSeconds)}>{formatVideoTime(comment.timestampSeconds)}</button><small>{sceneName(sceneAt(comment.timestampSeconds))}</small></div>
            <p>{comment.body}</p>
            {!done && <button className="ce-remove" aria-label="Delete comment" disabled={saving || applying || approving} onClick={() => void deleteComment(comment.id)}>✕</button>}
          </div>)}
        </div>
        {!done && <footer><button className="ce-apply" disabled={saving || approving || applying || comments.length === 0 || !job?.output} onClick={() => void apply()}>{applying ? "Applying with AI…" : comments.length ? `Apply ${comments.length} with AI` : "Apply with AI"}</button><span>Each comment becomes one proposed change.</span></footer>}
      </div>
    </aside>
  </div>;
}

function Preview({ project, title, screenshot, look }: { project: VideoProject; title: string; screenshot?: string; look?: FrameLook }) {
  // In the project's own colours and type (brand kit or theme), so this stand-in matches the film that is being made.
  const branded = look ? ({ "--sm-bg": look.bg, "--sm-fg": look.fg, "--sm-muted": look.muted, "--sm-brand": look.brand, "--sm-font": look.font } as React.CSSProperties) : undefined;
  return <div className={look ? "scene-mock branded" : "scene-mock"} style={branded}><div className="scene-browser"><span /><span /><span /></div><div className="scene-copy"><small>{project.name.toUpperCase()}</small><h2>{title}</h2><p>{project.script?.lines[0]?.voiceover || "This preview reflects the saved project inputs."}</p></div>{screenshot ? <img className="scene-screenshot" src={screenshot} alt="" /> : <div className="scene-product"><b>No screenshot yet</b><span>Upload a real product screenshot in the Script step.</span></div>}</div>;
}
