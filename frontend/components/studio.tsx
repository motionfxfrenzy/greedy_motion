"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { aspectToFormat, bundledFonts, defaultTemplateId, deriveBrandTheme, findTemplate, findTheme, parseScriptBrief, templates, themes, type BeatPlan, type BrandKit, type ProjectStudioDraft, type RenderJob, type RenderStage, type RenderRequest, type ScriptBrief, type Template, type VideoProject } from "@videosaas/contracts";
import { StudioEditor, type StudioDraftInput } from "./studio-editor";
import { defaultBrief, ScriptStyleStep, type SiteState } from "./script-style";
import { BeatStoryboardStep, type FrameLook } from "./beat-storyboard";
import { createClient } from "../utils/supabase/client";
import { addProjectReviewComment, applyProjectReviewComments, approveProject, createProject, getRenderJob, listBrandKits, listProjects, outputUrl, projectScreenshotUrl, removeProjectReviewComment, planProject, readProductSite, removeProjectScreenshot, renderProject, saveBrandKit, saveProjectStudio, updateProject, uploadProjectScreenshot } from "../lib/api";

type View = "projects" | "templates" | "brand-kits" | "library" | "create" | "studio";
type Step = 0 | 1 | 2 | 3;
// v2 flow (docs/PRODUCT_FLOW_V2.md): everything the film needs is chosen on Script & style.
const stepNames = ["Script & style", "Storyboard", "Render", "Review"];
const SCRIPT_STYLE: Step = 0, STORYBOARD: Step = 1, RENDER: Step = 2, REVIEW: Step = 3;
const imageFor = (template: Template) => "/templates/" + template.id + ".jpg";

function statusStep(project: VideoProject): Step {
  if (project.state === "Approved" || project.state === "Ready for review" || project.state === "Revisions needed") return REVIEW;
  if (project.state === "Rendering draft" || project.state === "Render needs attention") return RENDER;
  if (project.beatPlan) return STORYBOARD;
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
function lookFor(brief: ScriptBrief, brands: BrandKit[]): FrameLook {
  const kit = brands.find((brand) => brand.id === brief.brandId);
  const tokens = kit ? deriveBrandTheme(kit).theme.tokens : (findTheme(brief.theme ?? "neutral") ?? themes[0]!).tokens;
  return { bg: tokens.bg, fg: tokens.fg, muted: tokens.muted, brand: tokens.brand, font: tokens.fontDisplay };
}

export function Studio() {
  const [view, setView] = useState<View>("projects");
  const [step, setStep] = useState<Step>(0);
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [brands, setBrands] = useState<BrandKit[]>([]);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [request, setRequest] = useState<RenderRequest>({ prompt: "", format: "landscape", style: "clean", theme: findTemplate(defaultTemplateId)!.defaultTheme, template: defaultTemplateId, audio: { music: false, voiceover: false, voice: "Kore" } });
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<ScriptBrief>(defaultBrief);
  const [planWarnings, setPlanWarnings] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [site, setSite] = useState<SiteState>({ reading: false, shots: 0, warnings: [] });
  const template = findTemplate(request.template) ?? findTemplate(defaultTemplateId)!;

  const refresh = useCallback(async () => {
    const [savedProjects, savedBrands] = await Promise.all([listProjects(), listBrandKits()]);
    setProjects(savedProjects);
    setBrands(savedBrands);
    // Keep the open project in step with the server (e.g. "Rendering draft" → "Ready for review").
    setProject((current) => current ? savedProjects.find((item) => item.id === current.id && item.updatedAt !== current.updatedAt) ?? current : current);
    setError(null);
  }, []);
  useEffect(() => { void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the workspace.")); }, [refresh]);
  useEffect(() => {
    if (!job || ["ready", "failed"].includes(job.state)) return;
    const timer = window.setInterval(async () => {
      try { setJob(await getRenderJob(job.id)); await refresh(); } catch { /* Keep the last known server state visible. */ }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job, refresh]);
  useEffect(() => {
    if (job?.state === "ready") setStep(REVIEW);
  }, [job?.state]);
  // The director takes 30–60 s; show honest elapsed time rather than a fake percentage.
  useEffect(() => {
    if (!generating) return;
    setElapsed(0);
    const started = Date.now();
    const tick = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(tick);
  }, [generating]);

  const replaceProject = useCallback((saved: VideoProject) => {
    setProject(saved);
    setProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
  }, []);

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
  const begin = async (templateId?: string) => {
    const selected = templateId ? findTemplate(templateId) : template;
    if (!selected) return;
    const nextRequest = { ...request, template: selected.id, theme: selected.defaultTheme };
    setRequest(nextRequest);
    setBrief({ ...defaultBrief, theme: selected.defaultTheme });
    setSite({ reading: false, shots: 0, warnings: [] });
    setPlanWarnings([]);
    setProject(null);
    setJob(null);
    setError(null);
    setStep(SCRIPT_STYLE);
    setView("create");
  };
  const openProject = async (saved: VideoProject) => {
    setProject(saved);
    setRequest(saved.request);
    setBrief(briefFrom(saved));
    // The brand found on the site isn't stored (only offered for review), so a reopened project shows the facts and shots.
    setSite({ reading: false, site: saved.site ?? null, brand: null, shots: saved.screenshots.filter((shot) => shot.name.startsWith("Site · ")).length, warnings: [] });
    setPlanWarnings([]);
    setError(null);
    setStep(statusStep(saved));
    setView("create");
    if (saved.renderJobId) {
      try { setJob(await getRenderJob(saved.renderJobId)); } catch { setJob(null); }
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
    await openProject(saved);
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
    replaceProject(created);
    return created;
  };
  const generatePlan = async () => {
    const checked = parseScriptBrief(brief);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const active = await ensureProject();
      const nextRequest = requestFromBrief(active.request, brief);
      await updateProject(active.id, { request: nextRequest });
      setRequest(nextRequest);
      const result = await planProject(active.id, { ...checked.brief, screenshotIds: active.screenshots.map((shot) => shot.id) });
      replaceProject(result.project);
      setPlanWarnings(result.problems);
      setStep(STORYBOARD);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not write the script.");
    } finally {
      setGenerating(false);
    }
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
    const saved = await removeProjectScreenshot(project.id, screenshotId);
    setProject(saved);
    setProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
  };
  const submit = async (): Promise<boolean> => {
    if (!project) return false;
    setBusy(true);
    setError(null);
    try {
      if (project.script && !project.script.confirmed) replaceProject(await updateProject(project.id, { script: { ...project.script, confirmed: true, updatedAt: new Date().toISOString() } }));
      setJob(await renderProject(project.id));
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
  const addReviewComment = async (input: { body: string; timestampSeconds: number }) => {
    if (!project) return;
    const saved = await addProjectReviewComment(project.id, input);
    setProject(saved);
    setProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
  };
  const removeReviewComment = async (commentId: string) => {
    if (!project) return;
    const saved = await removeProjectReviewComment(project.id, commentId);
    setProject(saved);
    setProjects((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
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
    /> : null : view === "create" ? <><CreationHeader name={project?.name ?? "Untitled video"} state={project?.state ?? "Ready to create"} step={step} back={() => setView("projects")} reachable={project ? Math.max(step, statusStep(project), project.beatPlan ? STORYBOARD : SCRIPT_STYLE) : step} go={(target) => setStep(target as Step)} openStudio={project?.script ? openStudio : undefined} />
      {error && step !== SCRIPT_STYLE && <p className="workspace-error">{error}</p>}
      {step === SCRIPT_STYLE && <ScriptStyleStep brief={brief} update={(patch) => setBrief((current) => ({ ...current, ...patch }))} site={site} readSite={(url) => void readSite(url)} screenshots={<Screenshots project={project} busy={busy} upload={uploadScreenshot} remove={removeScreenshot} />} generating={generating} elapsed={elapsed} error={error} generate={() => void generatePlan()} back={() => setView("projects")} />}
      {step === STORYBOARD && project?.beatPlan && <BeatStoryboardStep project={project as VideoProject & { beatPlan: BeatPlan }} look={lookFor(brief, brands)} warnings={planWarnings} busy={busy} onSaved={replaceProject} back={() => setStep(SCRIPT_STYLE)} submit={() => { void submit(); }} openStudio={openStudio} />}
      {step === STORYBOARD && !project?.beatPlan && <div className="flow-page"><div className="flow-title"><h1>No storyboard yet.</h1><p>Generate the script and storyboard on Script &amp; style first.</p></div><button className="primary-button" onClick={() => setStep(SCRIPT_STYLE)}>Go to Script &amp; style</button></div>}
      {step === RENDER && project && <RenderStep project={project} job={job} error={error} busy={busy} retry={async () => { await submit(); }} back={() => setStep(STORYBOARD)} />}
      {step === REVIEW && project && <ReviewStep project={project} job={job} approve={approve} rerender={async () => { await submit(); }} addComment={addReviewComment} removeComment={removeReviewComment} applyChanges={applyReviewComments} openStudio={openStudio} />}
    </> : <><AppHeader view={view} setView={setView} />
      {error && <p className="workspace-error">{error}</p>}
      {view === "projects" && <Projects projects={projects} busy={busy} create={() => void begin()} open={(item) => void openProject(item)} openStudio={(item) => void openProjectStudio(item)} />}
      {view === "templates" && <Templates create={(id) => void begin(id)} />}
      {view === "brand-kits" && <BrandKits brands={brands} refresh={refresh} />}
      {view === "library" && <Library projects={projects} />}
    </>}
  </main>;
}

function AppHeader({ view, setView }: { view: View; setView: (view: View) => void }) {
  return <header className="relay-topbar"><button className="gm-brand" onClick={() => setView("projects")}><img src="/brand/gm-mark.svg" alt="" /><span><b>Greedy</b> <em>Motion</em></span></button><nav>{(["projects", "templates", "brand-kits", "library"] as const).map((item) => <button key={item} className={view === item ? "nav-active" : ""} onClick={() => setView(item)}>{item === "brand-kits" ? "Brand kits" : item[0].toUpperCase() + item.slice(1)}</button>)}</nav><button onClick={async () => { await createClient().auth.signOut(); window.location.href = "/auth"; }}>Sign out</button></header>;
}

function CreationHeader({ name, state, step, reachable, back, go, openStudio }: { name: string; state: string; step: Step; reachable: number; back: () => void; go: (step: number) => void; openStudio?: () => void }) {
  return <header className="creation-header"><div className="creation-project"><button onClick={back}>← Projects</button><i /><strong>{name}</strong><span>{state}</span>{openStudio && <button className="creation-studio" style={{ marginLeft: "auto", padding: "6px 10px", border: "1px solid #d6e4f2", borderRadius: 999, background: "#fff", color: "#0058bd" }} onClick={openStudio}>Open Studio</button>}</div><ol className="flow-steps">{stepNames.map((label, index) => <li key={label}><button className={index === step ? "current" : index <= reachable ? "complete" : ""} disabled={index > reachable} onClick={() => go(index)}><b>{index !== step && index <= reachable ? "✓" : index + 1}</b>{label}</button>{index !== stepNames.length - 1 && <i />}</li>)}</ol></header>;
}

function Projects({ projects, busy, create, open, openStudio }: { projects: VideoProject[]; busy: boolean; create: () => void; open: (project: VideoProject) => void; openStudio: (project: VideoProject) => void }) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  return <section className="page-container"><div className="page-heading"><div><h1>Projects</h1><p>Turn product updates into customer-ready videos.</p></div><div><button className="primary-button" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create a video"}</button></div></div><div className="filter-tabs"><button className="selected">All <span>{projects.length}</span></button><button>Drafts <span>{projects.filter((item) => !["Ready for review", "Approved"].includes(item.state)).length}</span></button><button>Review <span>{projects.filter((item) => item.state === "Ready for review").length}</span></button><button>Approved <span>{projects.filter((item) => item.state === "Approved").length}</span></button></div>{projects.length === 0 ? <div className="empty-workspace"><b>No projects yet.</b><p>Create a video to save a real brief, script, screenshots, and render history.</p><button className="primary-button" onClick={create}>Create a video</button></div> : <div className="project-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} open={open} openStudio={openStudio} menuOpen={openMenuId === project.id} setMenuOpen={(next) => setOpenMenuId(next ? project.id : null)} />)}</div>}</section>;
}

function ProjectCard({ project, open, openStudio, menuOpen, setMenuOpen }: { project: VideoProject; open: (project: VideoProject) => void; openStudio: (project: VideoProject) => void; menuOpen: boolean; setMenuOpen: (next: boolean) => void }) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const template = findTemplate(project.request.template);
  const image = project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : imageFor(template ?? templates[0]);
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
  return <article className={menuOpen ? "project-card menu-open" : "project-card"}><button className="card-image" onClick={() => open(project)}><img src={image} alt="" /><span>{project.request.format === "portrait" ? "9:16" : "16:9"} · 0:{String(template?.durationSeconds ?? 0).padStart(2, "0")}</span></button><div className="project-content"><div className="project-title"><h2>{project.name}</h2><p>{template?.name ?? "Template"} · {project.request.brandId ? "Brand kit" : "No branding"}</p></div><div className="project-actions" ref={actionsRef}><button className="dots" type="button" aria-label={`Project actions for ${project.name}`} aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(!menuOpen)}><span className="dots-mark" aria-hidden="true"><i /><i /><i /></span></button>{menuOpen && <div className="project-menu" role="menu" aria-label={`Actions for ${project.name}`}><button type="button" role="menuitem" onClick={() => choose(() => open(project))}>Open project</button>{project.script && <button type="button" role="menuitem" onClick={() => choose(() => openStudio(project))}>Open Studio</button>}</div>}</div><div className="project-meta"><b className={"status " + status}>{project.state}</b><time>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(project.updatedAt))}</time></div></div></article>;
}

function Templates({ create }: { create: (id: string) => void }) {
  return <section className="page-container"><div className="page-heading"><div><h1>Templates</h1><p>Each template sets the scenes, limits, and fields your team can change.</p></div></div><div className="template-grid">{templates.map((template) => <article className="template-card" key={template.id}><img src={imageFor(template)} alt="" /><div><h2>{template.name}</h2><p>{template.bestFor}</p><div className="template-chips">{template.scenes.map((scene) => <span key={scene.id}>{scene.label}</span>)}</div><button className="primary-button" onClick={() => create(template.id)}>Use template</button></div></article>)}</div></section>;
}

function BrandKits({ brands, refresh }: { brands: BrandKit[]; refresh: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState("");
  const [heading, setHeading] = useState("Inter");
  const [body, setBody] = useState("Inter");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const create = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await saveBrandKit({ name, colors: { primary }, fonts: { heading: { source: "bundled", family: heading }, body: { source: "bundled", family: body } } });
      await refresh();
      setCreating(false);
      setName("");
      setPrimary("");
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not save the brand kit.");
    } finally {
      setSaving(false);
    }
  };
  return <section className="page-container brand-page"><div className="page-heading"><div><h1>Brand kits</h1><p>Logos, colors, fonts, and approved language your videos follow.</p></div><button className="primary-button" onClick={() => setCreating((visible) => !visible)}>{creating ? "Cancel" : "New brand kit"}</button></div>{creating && <form className="brand-form" onSubmit={(event) => { event.preventDefault(); void create(); }}><label>Brand name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your company" required maxLength={28} /></label><label>Primary color<input value={primary} onChange={(event) => setPrimary(event.target.value)} placeholder="#635BFF" required /></label><label>Heading font<select value={heading} onChange={(event) => setHeading(event.target.value)}>{bundledFonts.map((font) => <option key={font} value={font}>{font}</option>)}</select></label><label>Body font<select value={body} onChange={(event) => setBody(event.target.value)}>{bundledFonts.map((font) => <option key={font} value={font}>{font}</option>)}</select></label>{formError && <p>{formError}</p>}<button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save brand kit"}</button></form>}{brands.length === 0 ? <div className="empty-workspace"><b>No brand kits yet.</b><p>Add a brand kit above to make it available in the creation flow.</p></div> : brands.map((brand) => <article className="brand-kit-detail" key={brand.id}><div className="kit-logo"><b>{brand.name.slice(0, 1).toUpperCase()}</b>{brand.name}</div><dl><div><dt>Primary color</dt><dd>{brand.colors.primary}</dd></div><div><dt>Fonts</dt><dd>{brand.fonts.heading.family} · {brand.fonts.body.family}</dd></div><div><dt>Website</dt><dd>{brand.url || "Not set"}</dd></div><div><dt>Approved language</dt><dd>{brand.description || "Not set"}</dd></div></dl></article>)}</section>;
}

function Library({ projects }: { projects: VideoProject[] }) {
  const screenshots = projects.flatMap((project) => project.screenshots.map((screenshot) => ({ project, screenshot })));
  return <section className="page-container"><div className="page-heading"><div><h1>Library</h1><p>Reusable assets for every project in this workspace.</p></div></div><div className="filter-tabs"><button className="selected">Screenshots <span>{screenshots.length}</span></button></div>{screenshots.length === 0 ? <div className="empty-workspace"><b>Your library is empty.</b><p>Uploaded screenshots appear here automatically.</p></div> : <div className="library-grid">{screenshots.map(({ project, screenshot }) => <article key={screenshot.id}><img className="asset-image" src={projectScreenshotUrl(project.id, screenshot.id)} alt="" /><b>{screenshot.name}</b><small>{screenshot.width} × {screenshot.height} · {project.name}</small></article>)}</div>}</section>;
}


function Screenshots({ project, busy, upload, remove }: { project: VideoProject | null; busy: boolean; upload: (file: File) => Promise<void>; remove: (id: string) => Promise<void> }) {
  const screenshots = project?.screenshots ?? [];
  return <aside className="screenshots-panel"><header><b>Screenshots</b><span>Drag to reorder</span></header><label className="drop-zone"><b>Drop screenshots here or <em>browse</em></b><small>PNG or JPG · at least 640 px wide</small><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} disabled={busy} /></label><ul>{project && screenshots.map((screenshot) => <li key={screenshot.id}><img className="shot-preview" src={projectScreenshotUrl(project.id, screenshot.id)} alt="" /><div><b>{screenshot.name}</b><small>✓ {screenshot.width} × {screenshot.height}</small></div><span>{screenshot.name.startsWith("Site · ") ? "From site" : screenshot.purpose}</span><button onClick={() => void remove(screenshot.id)}>×</button></li>)}</ul>{screenshots.length === 0 && <p className="empty-list">{project ? "No screenshots uploaded yet." : "Adding the first screenshot saves this project."} Product screens become the UI beats.</p>}</aside>;
}

const renderSteps: { key: string; label: string; stages: RenderStage[] }[] = [
  { key: "plan", label: "Writing the storyboard", stages: ["queued", "planning"] },
  { key: "audio", label: "Making music and voiceover", stages: ["audio"] },
  { key: "wait", label: "Waiting for a renderer", stages: ["waiting"] },
  { key: "prepare", label: "Preparing composition", stages: ["preparing", "retrying"] },
  { key: "frames", label: "Rendering frames", stages: ["frames"] },
  { key: "encode", label: "Adding audio and encoding", stages: ["encoding"] }
];

function RenderStep({ project, job, error, busy, retry, back }: { project: VideoProject; job: RenderJob | null; error: string | null; busy: boolean; retry: () => Promise<void>; back: () => void }) {
  const title = project.script?.lines[0]?.onScreen || "Your video is rendering.";
  const failed = Boolean(error) || job?.state === "failed";
  const wantsAudio = Boolean(project.request.audio?.music || project.request.audio?.voiceover);
  // A storyboard was written and voiced before Submit, so its render only waits, prepares, and renders.
  const steps = renderSteps.filter((item) => project.beatPlan ? item.key !== "plan" && item.key !== "audio" : item.key !== "audio" || wantsAudio);
  const stage: RenderStage = job?.stage ?? (job?.state === "ready" ? "done" : job?.state === "rendering" ? "preparing" : "queued");
  const current = stage === "done" ? steps.length : Math.max(0, steps.findIndex((item) => item.stages.includes(stage)));
  const detail = (key: string) => {
    if (key === "wait" && stage === "waiting") return job?.queuePosition ? `${job.queuePosition} ahead` : "Next in line";
    if (key === "frames" && job?.frames) return `${job.frames.done} / ${job.frames.total}`;
    return null;
  };
  return <div className="render-workspace"><section className="workspace-player"><Preview project={project} title={title} screenshot={project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : undefined} /></section><aside className="render-card"><header><b>{failed ? "Render needs attention" : job?.state === "ready" ? "Draft render ready" : "Rendering draft"}</b><span>{project.request.format === "portrait" ? "9:16" : "16:9"}</span></header>{failed ? <div className="render-error"><b>We could not render this project.</b><p>{error || job?.error?.message}</p><div className="render-error-actions"><button disabled={busy} onClick={() => void retry()}>{busy ? "Starting…" : "Try again"}</button><button className="render-error-back" onClick={back}>Back to storyboard</button></div></div> : <><p>You can leave this page. The draft keeps rendering and Review opens when it is ready.</p><ol>{steps.map((item, index) => <li className={index < current ? "done" : index === current ? "current" : ""} key={item.key}><i>{index < current ? "✓" : index + 1}</i><span>{item.label}</span>{index === current && detail(item.key) && <small>{detail(item.key)}</small>}</li>)}</ol>{stage === "retrying" && <p className="render-retry">Attempt {job?.attempt ?? 1} hit a renderer error. Trying again automatically.</p>}</>}</aside></div>;
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
  const [commentError, setCommentError] = useState<string | null>(null);
  const done = project.state === "Approved";
  const comments = [...(project.comments ?? [])].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  // Scenes with real start/end: a storyboard render carries each beat's duration; older renders split evenly.
  const timed = job?.revision.scenes.length && job.revision.scenes.every((scene) => scene.duration > 0) ? job.revision.scenes : null;
  const scenes = timed ? timed.map((scene) => ({ label: scene.label, onScreen: scene.detail })) : project.script?.lines ?? [];
  const duration = job?.output?.durationSeconds ?? findTemplate(project.request.template)?.durationSeconds ?? 10;
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
    if (draft.trim().length < 3) return;
    setSaving(true);
    setCommentError(null);
    try {
      await addComment({ body: draft, timestampSeconds: currentTime });
      setDraft("");
    } catch (caught) {
      setCommentError(caught instanceof Error ? caught.message : "Could not save the review comment.");
    } finally {
      setSaving(false);
    }
  };
  const deleteComment = async (commentId: string) => {
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
  const apply = async () => {
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
      <div className="ce-heading">
        <div><h1>Comment on the video</h1><p>Pause, pick the moment, and say what to change. Nothing changes until you apply it.</p></div>
        <div className="ce-howto">{["Pause", "Pick a moment", "Comment"].map((label, index) => <span key={label}><i>{index + 1}</i>{label}</span>)}</div>
        <div className="ce-actions">
          {job?.output && <a className="ce-download" href={outputUrl(job.output.url)} download>Download draft</a>}
          <button className="ce-download" onClick={openStudio}>Open Studio</button>
          {done ? <><span className="ce-locked">✓ Approved · locked</span><button className="ce-download" onClick={() => void rerender()}>Render new draft</button></> : <button className="ce-approve" disabled={!job?.output || comments.length > 0} title={comments.length ? "Apply or remove open comments before approving." : undefined} onClick={() => void approve()}>Approve final</button>}
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
        <div className="ce-anchor"><span className="ce-chip-time">At {formatVideoTime(currentTime)}</span><span className="ce-chip-scene">{sceneName(activeSceneIndex)}</span><button className="ce-add" disabled={saving || applying || draft.trim().length < 3} onClick={() => void saveComment()}>{saving ? "Saving…" : "Add"}</button></div>
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
            {!done && <button className="ce-remove" aria-label="Delete comment" disabled={saving || applying} onClick={() => void deleteComment(comment.id)}>✕</button>}
          </div>)}
        </div>
        {!done && <footer><button className="ce-apply" disabled={applying || comments.length === 0 || !job?.output} onClick={() => void apply()}>{applying ? "Applying with AI…" : comments.length ? `Apply ${comments.length} with AI` : "Apply with AI"}</button><span>Each comment becomes one proposed change.</span></footer>}
      </div>
    </aside>
  </div>;
}

function Preview({ project, title, screenshot }: { project: VideoProject; title: string; screenshot?: string }) {
  return <div className="scene-mock"><div className="scene-browser"><span /><span /><span /></div><div className="scene-copy"><small>{project.name.toUpperCase()}</small><h2>{title}</h2><p>{project.script?.lines[0]?.voiceover || "This preview reflects the saved project inputs."}</p></div>{screenshot ? <img className="scene-screenshot" src={screenshot} alt="" /> : <div className="scene-product"><b>No screenshot yet</b><span>Upload a real product screenshot in the Script step.</span></div>}</div>;
}
