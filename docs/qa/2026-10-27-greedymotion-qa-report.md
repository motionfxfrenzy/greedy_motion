# Greedy Motion: QA report and wait-time review

**Date:** 2026-10-27 · **Build:** production, www.greedymotion.com · **Tester:** Claude (QA pass for Osama)
**Scenario:** a signed-in user picks the *Binary Search Explainer* template and takes it all the way to a finished video.
**Raw log:** [2026-10-27-binary-search-e2e.md](2026-10-27-binary-search-e2e.md) (request timings, logs, file references).

---

## 1. Summary

The pipeline works. A template turned into a script, a storyboard, a rendered 1080p film with a clean voiceover, and a Review screen. **But the product breaks its main promise on this template, and the waits are long and silent at exactly the wrong moments.**

Three things matter most:

1. **The video doesn't look like the template you chose.** The preview shows a binary-search diagram (16 numbered boxes, a pointer, the range halving, the answer turning green). The film is generic moving text on a cream background, with the storyboard's stage directions printed as subtitles and a "Try binary search" button at the end. A user who chose the template for its look will feel misled. This is a trust problem, not a polish problem.
2. **Generate → finished video takes about 5 minutes when nothing goes wrong**, and it went wrong on this run. A backend deploy killed the first generation. The page spun for about 4.5 minutes, then reset with no message. The real time to first video was about 10 minutes.
3. **For most of that time the user is staring at text, not motion.** The storyboard is eight text-only cards. The first moving picture appears 4.5–5 minutes after Generate. Competitors show a watchable draft in roughly 1–4 minutes (vendor-reported, see §4).

Verdict: **not ready for paid acquisition traffic on "Data & diagrams" templates.** Product-UI templates, which the renderer was built for, may be fine but weren't tested here.

---

## 2. What was measured

| # | Step | Measured | Notes |
|---|---|---|---|
| 1 | Projects page, first paint | 0.14 s | Then ~0.35 s of an empty-looking page until projects arrive (now fixed with skeleton cards, not deployed) |
| 2 | Projects API | 0.34 s | Brand kits 0.48 s; Supabase user check 0.85 s |
| 3 | Templates gallery visible | ~0.8 s | 24 thumbnails; 2–3 failed with HTTP 500 on one load |
| 4 | "Use this" → brief filled in | ~1 s | Brief values match the template exactly |
| 5 | Generate → job started | 2.3 s | Create project 0.6 s, save 0.74 s, start plan 0.92 s |
| 6 | **Writing script + storyboard** | **~77 s** | One Claude call (~47 s) failed validation and needed a **repair call (~30 s)**. First attempt was lost to a deploy |
| 7 | Submit → render screen | 8.6 s | Button gives little feedback for 8.6 s |
| 8 | Waiting for a renderer | 51 s | Cold start of an on-demand worker |
| 9 | Preparing composition | 16 s | |
| 10 | Rendering frames | ~123 s | 1215 frames, ~10 frames/s |
| 11 | Audio + encode | ~12 s | |
| 12 | **Submit → Review** | **3 min 31 s** | |
| 13 | Download draft (13.5 MB) | 23 s | ~0.6 MB/s from the backend |

**Generate → watchable video: about 4 min 50 s** when nothing fails (77 s + 8.6 s + 211 s). On this run, with the lost job: **about 10 minutes.** That excludes the time a person spends reading and editing the storyboard.

Output: 1920×1080, 30 fps, AAC stereo, **40.5 s, but 45 s was requested.** Audio is healthy: −19 dB average, no gaps except the last 1.3 s.

---

## 3. How long is too long: a wait budget

Nielsen's response-time limits still anchor the industry. Up to **0.1 s** feels instant. Up to **1 s** keeps the user's train of thought. Up to **10 s** keeps their attention; beyond that they need a progress bar and an estimate, or they switch to something else. Nielsen's newer guidance adds: **10 s–1 min** needs a percent-done bar and an honest estimate; **1–10 min** needs persistent status, because the user has usually left the screen.

Measured against that, and against what AI-video buyers now expect:

| Moment | Today | Target | Too much | Feedback the user needs |
|---|---|---|---|---|
| Page and list loads | 0.3–0.9 s | < 1 s | > 2 s | Skeleton cards after ~300 ms (done for Projects) |
| Template → brief | ~1 s | < 1 s | > 2 s | Button state on the card |
| **First script words visible** | 77 s (all at once) | **< 5 s** | > 10 s with nothing to read | Stream the script line by line |
| Full script ready | 77 s | < 20 s | > 30 s | Stages: "Writing hook… beat 3 of 8…" |
| Storyboard ready | 77 s (same call) | < 30 s, in the background | Blocking the user > 30 s | Let them read and edit the script meanwhile |
| Submit acknowledged | 8.6 s | < 1 s | > 2 s | Optimistic move to the Render screen |
| **First moving preview** | ~4 min 50 s after Generate | **< 60 s** | > 2 min | Play the composition in the browser before the MP4 exists |
| Final MP4 for 30–45 s | 3 min 31 s | < 2 min | > 5 min | Percent-done with time left, plus an email or tab notification |
| Download | 23 s | < 5 s | > 15 s | Serve from a CDN or a signed R2 link, not streamed through the backend |
| **Anything, no feedback** | ~4.5 min (lost job) | 0 | Any | Never spin past the job's deadline; say what happened |

**Rule of thumb for this product:** the user should never wait more than **10 seconds without something new to look at**, and should see **motion within about a minute of clicking Generate.** Past ~5 minutes to a first video, a trial user is likely to close the tab before seeing what they came for. That's an informed estimate, not something this test measured; confirm it in analytics (Generate → Review completion rate by wait time).

---

## 4. The market lens

**Who buys this:** SaaS marketers, founders and product teams who need launch, feature and explainer videos quickly and on brand. They compare against:

- **Prompt-to-video tools** (InVideo, HeyGen Video Agent, CapCut): they go straight from a prompt to a draft video and let you edit afterwards. HeyGen's own blog reports an InVideo 45-second video in about 3 minutes, a HeyGen 90-second explainer in under 3 minutes, and an editable HeyGen Video Agent draft in 4 minutes. These are vendor-reported and partisan, but they show what users have been taught to expect. None of the tools in that roundup puts a script or storyboard gate before the first draft. Luma's low-res Draft Mode is the closest thing to a preview.
- **Design tools** (Canva, and agencies on Fiverr) for polish and brand.

**Greedy Motion's edge** is brand-accurate motion design with real control (storyboard, beats, transitions, Pro editor). The storyboard is that edge. It is also the friction. For the median user, a gate of eight text cards before any motion feels like homework. Power users and agencies value it.

### Benchmark: the flow competitors use

Desk research from public docs and third-party reviews; we could not create competitor accounts to time them hands-on.

| Product | Before generating | Draft time (as reported) | Changing it afterwards |
|---|---|---|---|
| **HeyGen Video Agent** | Script and scene-by-scene plan shown on a "Review Script" page, editable before spending credits | Under 4 min for a short video; 6–8 min for 3 min (CrePal test) | Revise one scene; the others stay as they are |
| **InVideo AI** | Script (with an AI co-writer) and an optional storyboard you can tweak before generating | Draft in 30–90 s (Flowith, third party) | Chat commands re-render only the affected scenes, under 15 s per change (same source) |
| **Gamma** (decks, same pattern) | Editable outline, free, before building | ~2 min to build the deck, which assembles live on screen | "Edit with AI" panel |
| **Greedy Motion today** | Script **and** a full storyboard (8 text cards), written in one 77 s call | 3 min 31 s render after Submit (~4 min 50 s from Generate) | Comments then a full re-render |

**What this shows:** a review step before spending credits is **normal and valued**; reviewers say it saves money. Ours isn't wrong to exist. The gaps are:

1. **Speed of the review step.** Ours shows nothing for 77 s; Gamma's outline streams.
2. **What gets reviewed.** Competitors show a script and a light plan; we show a full storyboard of text-only cards with camera, text-effect, transition and sound fields.
3. **Iteration.** Competitors change one scene in seconds; we re-render the whole film.
4. **Faithfulness.** Competitors' plans are their renderer's real capabilities; our template previews promise visuals the renderer can't draw.

**What wins here:** keep the control, but take it off the critical path. **Show a video first, then let people steer.** The template promise must hold: if the gallery shows a diagram, the film must contain that diagram.

---

## 5. Friction points (all of them)

Severity: **P0** blocks trust or loses work · **P1** hurts conversion · **P2** noticeable friction · **P3** polish.

### 5.1 Discovering and choosing a template

| Sev | Friction | Evidence | Fix |
|---|---|---|---|
| **P0** | **Previews promise visuals the renderer can't make.** "Data & diagrams" previews show charts and diagrams; the renderer has no diagram scene type (only screen demo, moving text, 3D, footage, title card) | `packages/contracts/src/beat-plan.ts:85`; render vs preview frames in the raw log | Short term: label these templates "style reference", or hide them until supported. Real fix: add a diagram/data scene type driven by the template's own HTML (the reference file `binary-search.676c4b25.html` already exists) |
| P1 | Template thumbnails sometimes break (HTTP 500) | `backend/src/gallery.ts:50` sets image headers before the R2 fetch, so any R2 error becomes a 500 and may be cached for a year | Set headers only after a successful fetch; log the R2 error |
| P2 | The template's theme doesn't match its preview (dark preview, cream "Cobalt Grid" film) | Brief `theme: cobalt-grid` | Give each template the theme its preview uses |
| P3 | Gallery list fetched twice; nav links prefetched 3–4 times | Network log | Dedupe the fetch; check `<Link prefetch>` usage |

### 5.2 The brief (Script & style)

| Sev | Friction | Evidence | Fix |
|---|---|---|---|
| P1 | **No cost before committing.** The film costs 10.25 tokens; the user learns this only after Submit, via a 402 error | 402 on `POST /render` | Show "≈10 tokens · you have 7.5" next to Generate and Submit |
| P2 | Very long form. Product URL, name, audience, length, ratio, brand kit, theme, style, motion, pace, audio, captions and screenshots, all on one page with the button at the bottom | Screenshots | Collapse into "Looks good, generate" with an "Adjust" drawer; a template already fills it all in |
| P2 | The chosen template isn't visible as the style reference; the style's example row shows four other templates | Script & style page | Pin "Based on: Binary Search Explainer" with its thumbnail at the top |
| P3 | Screenshot panel shown for a maths explainer that has no product UI | Script & style page | Hide or collapse it when the template has no UI scenes |

### 5.3 Generating the script and storyboard

| Sev | Friction | Evidence | Fix |
|---|---|---|---|
| **P0** | **A deploy silently destroys in-flight generations.** The job runs inside the web process; a restart kills it, and the page spins for about 4.5 minutes, then resets with no message | Railway logs: SIGTERM at 05:46:41, 50 s after start; `backend/src/plan/routes.ts:157-186` | On startup, mark orphaned `running` plans as `interrupted`; the page says "Interrupted by an update. Try again (no charge)". Better: run plans on the job queue, like renders |
| P1 | 77 s with nothing to read, then everything at once | Measured | Stream the script (see §6) |
| P1 | ~40% of the wait is a repair round, because the first answer failed validation | Two Claude calls, ~47 s + ~30 s; `director.ts:363-378` | Log which checks fail and fix the prompt or schema so most plans pass first time; auto-correct small issues (word counts, numbers) in code instead of a second model call |
| P1 | Progress is in the footer, below the fold, as a single line "Writing your script… 43s" | Screenshot | Full-width progress panel at the top with stages and an estimate |
| P2 | While generating, the page re-downloads every project and brand kit every 2 s | Network log | Poll one project's status, or push updates |
| P2 | Planner model is `claude-sonnet-4-6` | Logs | Benchmark current models for speed and quality; a faster model for the script pass could cut this a lot |
| P3 | No server logs for plan start, finish or failure | Railway logs | Log them, with duration and repair count |

### 5.4 Storyboard

| Sev | Friction | Evidence | Fix |
|---|---|---|---|
| **P0** | **Product-launch story forced onto an explainer.** Beats are Hook / Problem / Reveal / Feature / Success / Proof / Call to action, ending "Try binary search", although the director is told not to use that arc | `director.ts:284-288`; storyboard | Make beat roles follow the template (teaching: Question → Setup → Step → Step → Result → Recap) |
| P1 | **Eight text-only cards to approve before seeing any motion** ("Frames are stills while you write") | Storyboard | Make the storyboard optional and after a first preview (§6) |
| P1 | Stage directions ("Pointer jumps to the middle box") are rendered as on-screen subtitles | Render frames | Keep visual directions separate from on-screen text; never render the direction field |
| P2 | Duration drift: 45 s requested, header 0:40, blur note 41 s, file 40.5 s | Storyboard, ffprobe | One source of truth; warn when the plan is >10% off the request |
| P2 | Heavy UI: character and word counters on every field, eight fields per beat | Storyboard | Show counters only near the limit |
| P3 | "Voice & music ready" though music wasn't chosen | Storyboard | Label from the actual audio mode |
| P3 | All beats are "Kinetic type"; none uses the style family's devices | Storyboard | Follows from the P0 renderer gap |

### 5.5 Render

| Sev | Friction | Evidence | Fix |
|---|---|---|---|
| P1 | Not enough tokens shows a banner with no button or price | Screenshot | Inline "Add 5 tokens · $X" or "Upgrade", keeping the user's place |
| P1 | 51 s cold start labelled "Waiting for a renderer / Starting a renderer" (infrastructure language) | Render card | Pre-warm a worker when the storyboard opens; reword as "Getting your video ready" |
| P1 | 3 min 31 s for a 40 s film; frames render at ~10 fps on one task | Measured | Split frames across the 2–3 tasks already allowed (`perTask 2, maxTasks 3`); render a fast 720p draft first, full quality on approve |
| P2 | `POST /render` takes 8.6 s before the screen changes | Network log | Return 202 immediately; do the preparation in the job |
| ✓ | "You can walk away" message and a live frame counter | Render card | Good. Keep them. Add an email or browser notification when done (not seen in this test) |

### 5.6 Review and output

| Sev | Friction | Evidence | Fix |
|---|---|---|---|
| **P0** | Output doesn't match the template style (see §1) | Frame comparison | §5.1 fix |
| P2 | Download is slow (23 s for 13.5 MB) | curl | Hand out a signed R2 or CDN URL |
| P2 | Comment suggestions are product-video specific ("Make the logo bigger", "Show the screenshot for longer") on a maths explainer | Review page | Suggest from the template type |
| P3 | Final card uses the project name (the first line of the prompt) as a headline | Last frame | Use a real title, or ask for one |
| ? | Not tested: applying a comment (re-render cost not shown), Approve, mobile | Out of scope | Next QA pass |

### 5.7 Projects list

| Sev | Friction | Evidence | Fix |
|---|---|---|---|
| P1 | Template projects saved as "Product launch", card shows 0:10 | `frontend/components/studio.tsx:199-201`, `:549`, `:652` | Store the gallery template id; take the duration from the brief |
| P2 | Empty-looking page and "0" counts while loading | Measured | **Fixed** (skeleton cards; not deployed) |

### 5.8 Operations

| Sev | Friction | Evidence | Fix |
|---|---|---|---|
| P1 | Deploying the backend during traffic kills generations (5.3) | Logs | Graceful drain: stop taking new plans, wait for running ones (up to the 4-minute deadline) before exiting |
| P2 | Documented token-grant command can't run: `backend/scripts/` isn't in the image | MODULE_NOT_FOUND | Ship scripts in the image or add an admin endpoint |

---

## 6. How to make it faster

### Your idea: drop the storyboard and keep only the script

The script and storyboard come from **one** Claude call today, so removing the storyboard doesn't remove a step by itself. It helps only if the first call becomes much smaller. My recommendation is to **split the call and change the order of waiting**, not to delete the storyboard:

1. **Script first, streamed (target: first line < 5 s, done < 20 s).** Ask only for the narration and one on-screen line per beat, streamed into the page as it's written. That's roughly a third of today's output, so it should finish in well under half the time. The user reads and edits while it streams.
2. **Storyboard in the background (target: < 30 s, never blocking).** While the user reads the script, a second call turns it into beats, scene types, transitions and sound. The storyboard becomes an **"Advanced" tab** for people who want control, not a gate.
3. **Preview immediately (target: motion < 60 s after Generate).** The film is already an HTML composition. Play it in the browser with the HyperFrames player as soon as the storyboard exists, with no MP4 render needed. Review and comments can happen on this live preview.
4. **Render the MP4 only when it's needed** (Approve or Download), and pre-warm the worker as soon as the preview starts, so the 51 s cold start is gone by then.
5. **Cut the repair round.** Find which checks fail on the first answer and fix the prompt or schema, or correct small issues in code. This alone should save ~30 s on many runs.
6. **Parallel render.** Split the 1215 frames across the 2–3 tasks already allowed. A fast 720p draft plus parallel chunks should bring a 40 s film under ~90 s.

**Expected result** (estimates, to confirm with a prototype):

| | Today | After |
|---|---|---|
| First script text | 77 s | ~3–5 s |
| Script complete | 77 s | ~15–20 s |
| First moving preview | ~4 min 50 s | ~30–60 s |
| Final MP4 (on approve) | 3 min 31 s | ~1–1.5 min, often already done in the background |

Keep the storyboard. It's what separates Greedy Motion from prompt-to-video tools for agencies and power users. Just stop making everyone go through it before they see anything move.

### Quick wins (days, not weeks)

1. Interrupted-job message plus orphan cleanup on startup (P0).
2. Cost shown next to Generate and Submit, with a buy button in the 402 banner.
3. Progress panel at the top with stages and an estimate.
4. Fix the template label and duration on project cards.
5. Gallery thumbnail headers and logging.
6. Pre-warm the render worker when the storyboard opens.
7. Deploy the projects skeleton (already written).

---

## 7. Fix status (2026-10-27, not yet committed or deployed)

| Item | Status | Where |
|---|---|---|
| Plans lost on deploy | **Fixed in code.** Shutdown now waits for running plans (up to `PLAN_DRAIN_SECONDS`, default 150 s). **Needs** `RAILWAY_DEPLOYMENT_DRAINING_SECONDS≈160` on the production backend service, or Railway still kills it after 0 s | `backend/src/plan/routes.ts`, `backend/src/server.ts` |
| Silent reset after a lost plan | **Fixed.** The page says "Writing was interrupted because our service restarted. Generate again — nothing was charged." | `frontend/components/studio.tsx` |
| No plan logs | **Fixed.** `plan_started`, `plan_done` (duration, model, and the problems that caused a repair round) and `plan_failed` | `routes.ts`, `director.ts` |
| Polling the whole list | **Fixed.** Writing and rendering poll only the open project (the render poll had been fetching everything every 1 s) | `studio.tsx`, `frontend/lib/api.ts` |
| Product-launch arc and "Try binary search" CTA | **Root cause fixed.** With no brand kit and no product name, the project name (the prompt's first line) was passed to the director as the product. Now it's "Product: none", with an instruction not to invent a product, sales line or CTA. The end card no longer shows the prompt as a brand name | `routes.ts`, `director.ts`, `preview.ts` |
| Stage directions on screen | **Prompt fixed.** `on_screen` is now defined as text the viewer reads, with examples of what not to put there. Needs a fresh generation to confirm | `director.ts` |
| Wrong "Product launch" label and 0:10 on cards | **Fixed.** Label from the style family; length from the storyboard or brief; m:ss format (90 s showed as "0:90") | `studio.tsx` |
| Thumbnail 500s | **Fixed.** Media headers are set only after the file is fetched; R2 errors are logged and return a non-cacheable 502 | `backend/src/gallery.ts` |
| Cost only after Submit | **Fixed.** Above Submit: "This film costs N tokens · you have M", plus an **Add tokens** button (top-up checkout) when short | `frontend/components/beat-storyboard.tsx` |
| Progress hidden in footer | **Fixed.** A progress panel at the top with elapsed time, an honest estimate and Cancel; the page scrolls to it | `frontend/components/script-style.tsx` |
| "Waiting for a renderer" wording | **Fixed.** "Getting your video ready · usually under a minute" | `studio.tsx` |
| Projects page looks empty while loading | **Fixed.** Skeleton cards | `studio.tsx`, `styles.css` |
| Template previews the renderer can't make (diagram scene) | **Open.** Needs a diagram/data scene type built from the template's own HTML. Multi-week | §6 |
| Script-first streaming, background storyboard, live preview | **Open.** Redesign, see §6 | §6 |
| Render speed (cold start, parallel frames, fast draft) | **Open.** Pre-warm on storyboard open; split frames across tasks | worker launcher |
| 8.6 s `POST /render`, slow download | **Open** | `backend/src/server.ts`, media links |
| Duration drift (45 → 40.5 s) | **Open** | director timing |
| Token script missing from image | **Open** | backend Dockerfile |

### Verified in the browser (localhost, 2026-10-27)

Local runs `claude-opus-5-5` (production: `claude-sonnet-4-6`), so local times aren't production times. Note: the local backend had been running since the day before **without** `--watch`; the first local run used old backend code and was discarded. All results below are from the restarted backend.

| Check | Result |
|---|---|
| Projects skeleton | ✓ Three placeholder cards, then real cards or the empty state; counts appear only after loading |
| Progress panel | ✓ Shows elapsed time, "Usually about 1–1½ minutes", switches to "Taking a little longer than usual" past 80 s; Cancel works. The first version didn't scroll into view (the save re-render cancelled the scroll); fixed and re-checked: page jumps from the bottom to the panel |
| Polling | ✓ Only `GET /projects/:id` every ~2 s while writing (16 calls in 33 s); no list or brand-kit refetches |
| Topic film without a product | ✓ No "Try …" ending. Last beat: "Halving the range found it in just a few steps instead." |
| On-screen text | ✓ Readable labels ("middle < target", "half left", "one box left"), no stage directions |
| Length | ✓ 0:46 for 45 s (was 40.5 s in production) |
| Cost line | ✓ "This film costs 11.75 tokens · you have 7.5", plus **Add tokens** (orange when short) |
| Card labels | ✓ "Clean · Data & diagrams · 0:45" for planned **and** cancelled projects (the brief is now saved when generation starts, only on projects without a storyboard). An unplanned project shows a neutral style placeholder instead of the default starter's "Relay" picture |
| Plan logs | ✓ `plan_started` (with template) and `plan_done` (duration, model, `repairedFrom`) |

### New finding from the logs: what causes the repair round

`plan_done` showed the first answer rejected **30 times by the invented-numbers check**: the director used worked-example values ("find 58", "63", "34"), as the template's own preview does ("find 61"). The prompt never stated the rule; only the checker knew it. Two fixes:

1. The rule is now stated in the prompt (use only numbers from the brief, product or site).
2. The checker treated "sixteen" in the brief and "16" in the copy as different numbers; now number words and digits match.

Result: **94 s → 62 s** for the plan and first-answer failures **30 → 3** (those 3 were the "16"/"sixteen" false alarms, fixed afterwards and checked with a unit test, but not with another full generation). Expect most plans to need no repair call now, a saving of roughly 30 s each.

**Decision for you:** should topic films (no product) be allowed *illustrative* example numbers, like the "find 61" in the template preview? Today the checker removes them, so a binary-search explainer can't name its target number. Allowing small example values only when there's no product would make these films more concrete without letting product films invent stats.

Checks run: backend and frontend typechecks pass; frontend tests 99/99; backend script-rules, media and scene-rendering tests pass. `backend/test/styles.mjs` fails on the `clean` recipe hash because `worker/templates/beat-plan/engine.js` already had uncommitted edits before this work; rebuild the recipe with that change.

## 8. Test limits

- One run, one template, one account, desktop Chrome-based browser, production. Wait times vary, especially model calls and cold starts. Repeat 5–10 runs before setting targets in stone.
- Not tested: mobile, other templates (especially product-UI templates the renderer is built for), applying comments, Approve, notifications, the signed-out landing → sign-up path.
- Competitor timings are vendor-reported (HeyGen's own blog), not measured by us.

## Sources

- Jakob Nielsen, [Response Time Limits](https://www.nngroup.com/articles/response-times-3-important-limits/), NN/g
- Jakob Nielsen, [Progress Indicators Ease the Wait](https://www.uxtigers.com/post/progress-indicators), UX Tigers
- Viget, [A Bone to Pick with Skeleton Screens](https://www.viget.com/articles/a-bone-to-pick-with-skeleton-screens) (skeletons help only for short waits in familiar layouts, as on Projects)
- HeyGen, [Best AI Video Generators 2026: 12 Tools Tested & Ranked](https://www.heygen.com/blog/best-ai-video-generators-tested-and-reviewed) (vendor source, used for market expectations only)
- HeyGen, [Create videos with Video Agent](https://community.heygen.com/public/resources/how-to-create-high-quality-videos-in-minutes-with-video-agent) and [Video Agent Prompting Guide](https://help.heygen.com/en/articles/13566094-video-agent-prompting-guide)
- CrePal, [HeyGen AI Video Generator Review](https://crepal.ai/blog/aivideo/heygen-ai-video-generator-review/)
- InVideo, [invideo AI](https://invideo.io/); Flowith, [InVideo AI 2.0](https://flowith.io/blog/invideo-ai-2-0-text-to-video-speed-of-thought/) (third party); Primal Video, [InVideo AI Review](https://primalvideo.com/guides/best-ai-video-generator-invideo-review/)
- MindStudio, [How to Use Gamma AI to Build Presentations](https://www.mindstudio.ai/blog/how-to-use-gamma-ai-build-presentations-tutorial)

## Script canvas v2: one document, reference frames, voiceover on confirm (2026-10-27, localhost, Opus 5.5)

Binary Search Explainer template, 9 beats, voiceover on. Times are from the Generate click.

| Step | Time |
|---|---|
| Canvas on screen | 0.02 s |
| First beat visible | 4.8 s |
| Whole script written | 13.0 s |
| First reference frame | 14.7 s (the first 4 are requested while beats 5+ are still being written) |
| All 9 frames | 27.5 s |
| Confirm script → 9 voiceover takes | 14.7 s (storyboard was already built in the background) |
| "Shorter" on beat 3 only, until its frame was redrawn | ≈ 16 s; the other 8 beats were unchanged word for word |

- Each beat now carries `VISUAL:` (what is seen), on-screen text and voiceover; the storyboard director gets VISUAL as the approved picture.
- Frames come from `POST /v1/projects/:id/script/frames` (SSE, 4 at a time). They are drawn by the model as SVG with the template's reference HTML as the style guide, cleaned on the server and shown as `<img src="data:image/svg+xml…">`. A single frame takes 6–11 s on Opus.
- Prompt box: floating and pinned to the bottom. Click a beat number or its frame to add it as a chip; the request is then limited to those beats.
- Fixed along the way: `.relay-shell` `overflow-x:hidden` broke every `position: sticky` inside it (now `clip`); auto-growing fields measured before layout settled (now refit on resize).
- Frames are saved on the project (`scriptFrames`, keyed by template, look, aspect and the beat's words; newest 48 kept, left out of the project list). Reopening shows all 9 in under 4 s: the one frames request returns the saved SVGs in 84 ms with no model calls. Only beats whose words changed are drawn again.

## Explainer voice for topic films (2026-10-27)

Studied in the browser: 3Blue1Brown shorts (random chords puzzle, perfect encoding) and Veritasium shorts (where lost weight goes, choosing a number at random), with captions captured during playback. The shared pattern: open on a question, a small "imagine you…" puzzle or a claim that sounds wrong; one concrete example first; talk to "you"; give the obvious or wrong answer, then turn it; explain one step per sentence; answer the viewer's objection; end on the insight, never a pitch.

These are now rules in the script writer (`EXPLAINER_VOICE` in backend/src/plan/script-writer.ts), used when the film has no product. Same Binary Search brief:

| | Before | After |
|---|---|---|
| Opening | "Find one number, fast." | "Sixteen boxes. Find one number." |
| Middle | "Here are sixteen boxes, sorted from smallest to largest. We want one target value." | "The obvious move? Open them one by one." / "But try this. Point at the middle box and ask: is my number higher or lower?" |
| Ending | recap | "And double the boxes? Just one more question." |

Speed unchanged: first word 7.5 s, whole script 14 s. Open: the numbers check flags normal explainer wording ("double", "number one"), which needs the illustrative-numbers decision.

## Smarter explainer scripts, flexible length (2026-10-27)

- **Plans before writing.** Topic films start with two private lines the page never shows: `IDEA:` (the one insight) and `EXAMPLE:` (the example's data and every step's result, worked out). The walk-through must follow EXAMPLE, which fixed contradictory steps ("drop the right four" while five boxes faded).
- **Arc.** (1) A spoken hook question at full scale that makes sense heard alone ("One number in a million. How?"), even when a template brief starts small. (2) The obvious way and why it fails at that scale. (3) Shrink to a small example. (4) One move per beat. (5) Zoom back out to answer the hook ("a million numbers take about twenty"). (6) A closing thought. Lines must read as one paragraph.
- **Numbers.** Topic films may use example values. Only statistic-shaped numbers (%, prices, "N times faster", "N users") are flagged. Product films keep the strict rule.
- **Length.** The chosen duration is a target unless **Fit exactly** is ticked in the brief. A script that needs longer runs longer (up to about 2× the target, 16 beats). The canvas shows "about N s" and, when over, "Runs about 55s, longer than the 45s you chose… [Keep 55s] [Fit to 45s]". Fit rewrote 55 s → 43 s in 26 s, kept the hook, example and payoff, and locks the length for later changes.
- Frames without an SVG namespace showed as broken images; the namespace is now added on the server and in the page.
- Cost: planning lines delay the first beat to 9–12 s (was 7–8 s); whole script 18–21 s.

## Voiceover, visual and frames aligned (2026-10-27)

Problem seen: every frame invented its own numbers (beat 2 drew the template's 3, 7, 12, 18, 24…; beat 3 drew 2…77; beat 4 drew 3, 7, 12, 15…). Frames never saw the voiceover, so beat 2 showed sixteen boxes while the voice talked about a million. Beat 3's on-screen text was a row of numbers.

Fixes:
- The writer's `IDEA:` and `EXAMPLE:` lines are now kept with the script (`ScriptNotes`, saved in the brief as `scriptNotes`). Every frame, every change or Reimagine, and the storyboard get the same worked example.
- Each frame also gets its voiceover line and must show what that line says as it is said.
- Writer rules: each VISUAL shows what its own VOICE line says; VISUALs that show the example name its exact values; SCREEN is a short label (at most 8 words), never data. On-screen text with 5 or more numbers is flagged.

Result on a fresh Binary Search film: frames 3–7 all draw the same list (3 … 91) and target 68. Each frame's comparison matches its line ("bigger than thirty-seven? Yes" → "Is 68 bigger than 37? / keep boxes 9–16"), and the million beats draw the million. Reimagine on beat 5 kept the same data.

## The approved frames are the film; flow is Brief → Storyboard → Render → Review (2026-10-27)

- **Render animates the approved frames.** Before, the render ignored them: the scene engine drew its own generic "kinetic type" cards. Now, when every beat has an approved frame, the render project (backend/src/plan/frame-film.ts) inlines those SVGs and worker/templates/frame-film/frame-film.js animates them on the engine's own clock, with the same voiceover, music and watermark:
  - Beat 1 draws on.
  - At each cut, elements present in both frames glide to their new place (the pointer moves, the range bracket closes, boxes dim). New elements draw on and removed ones fade.
  - Shapes of very different size are not paired, so a long bar never stretches into a box.
  - If any beat lacks a frame, the film uses the engine as before.
- **Test render** of the 9-beat Binary Search film: 1:04, 1080p, with voiceover, rendered in 53 s with the HyperFrames CLI. Stills match the approved frames beat for beat (same list 3 … 91, target 68, bracket 9–16 → 13–16 → 13–14, box 68 lights green, halving chart).
- **Flow.**
  - The old Fine-tune page is gone. Steps are Brief → Storyboard (the script page) → Render → Review, and Generate opens the Storyboard step.
  - Render video is the main action and makes any missing voiceover or music first. Build voiceover is optional, to listen first.
  - The cost and Add tokens show on the Storyboard step.
  - The length check blocks a render only when "Fit exactly" is on; otherwise it is a warning.

## Motion at Render, explainer feel (2026-10-27)

- **Motion is directed when Render is clicked** (backend/src/plan/frame-motion.ts). Each scene gets data, not code: `move` (start state to drawn state, optional hops), `sweep` (elements flash or dim in turn) and `count`. It is timed to the voiceover's real word times, validated by `parseFrameMotion`, cached per scene, and checked for coverage, with one retry when the line has a long still stretch. It takes about 9–20 s for 9 scenes. If it fails, the film still renders.
- **Explainer feel** (topic films only: no product, site or brand kit) follows 3Blue1Brown's Manim defaults:
  - Manim's `smooth` sigmoid rate curve, about 1 s per change (at least 0.6 s).
  - Groups arrive with a slight lag; highlights swell and settle (like `Indicate`); a searching pointer glides box to box with a dwell instead of `steps()` jumps.
  - Rows transform between scenes even when they move and change length.
  - One shared ground for the whole film, so cuts truly crossfade; outgoing shapes stay until the new scene's first content arrives; old words clear before new ones settle.
  - Product films keep the snappier default feel.
- Fixed along the way: the pointer drew behind the range bracket; a `</script>` in a comment broke the inlined player; frames without an SVG namespace showed as broken images.
- Render page: Render video is a standalone button with the cost under it. When the balance is short, the button becomes **Add tokens to render**, which opens a purchase modal (pack plus plans, through the existing checkout).

## Scenes drawn in the background; final render = join (2026-10-27/28)

- **What changed:**
  - When the Preview opens (after `/film/animate`) or a fix lands, the backend queues one `render-scene` job per scene, debounced by 2 s (backend `render/scenes.ts`, worker `src/scenes.mjs`, table `app.scene_clips`, migration 009).
  - Each scene is drawn as a time range of the film page itself: a small clock drives the film's paused timeline from the scene's first frame. Frames, motion, feel and clock are the film's own, and each cut's crossfade sits inside the clip of the scene it cuts to.
  - The soundtrack is mixed ahead of time: the same page with its pictures hidden, rendered at 1 fps (16 s).
  - "Render final video" keeps the same job, tokens and Review path, but the worker joins the clips (`ffmpeg concat`, stream copy) and adds the soundtrack. A failed or missing clip, or motion blur, falls back to the full render.
- **Cache:** each clip has a signature covering:
  - its own frame and motion, and the previous scene's (its opening crossfade);
  - the page around the frames (engine, frame-film.js, fonts, theme, watermark);
  - its frame range and the film's length.
  Unchanged scenes are never redrawn. A clip that stops being current is dropped mid-draw (fenced by `attempt`). Clips of projects untouched for 7 days are swept.
- **Live drawing:** progress and the latest drawn frame are pushed over the existing LISTEN connection (channel `scene_clips`) to `GET /v1/projects/:id/scenes/events`. The thumbnail comes from a second ffmpeg output on HyperFrames' own encoder pipe (`ffmpeg-thumbs.sh`), so frames are never captured twice.
  - In the Preview, each scene in the strip shows Queued, Drawing n% with its latest frame, or Drawn.
  - "Drawn scenes" plays the actual clips in the player, as an alternative to "Live preview".
- **Timings (test project, 8 scenes, 1:03, 1,917 frames; host load 15–22 from another session's work):**
  - Before (full software render): 224 s on a quiet machine, plus about 8 s of prep. Re-measured today: 5 min 12 s under load.
  - After, all scenes drawn: click to Review in **1.08 s** (prep 0.32 s, join 0.6 s).
  - After, engine changed 9 s before the click (all 8 scenes redrawn while the job waited): 3 min 53 s (229 s wait, 1.9 s join). The render step showed live frame progress.
  - Background drawing: 3 scenes at once (one project's cap) took about 3.9 min for the whole film under load. Per-scene speed drops to about 1.6 fps when three run alongside other heavy work.
  - Re-opening the Preview with nothing changed: all 8 cached, nothing redrawn.
- **Fixing one scene** ("make the title of this scene a little larger" on scene 4): three clips were redrawn, the other five and the soundtrack were kept.
  - Scene 4: the fix itself.
  - Scene 5: it opens on scene 4's crossfade, and its motion is directed from scene 4, so the motion was re-directed too.
  - Scene 6: it opens on scene 5's end state.
  - Also fixed: before this, a fix left the next scene's directed motion stale. The Preview played that scene with no motion, and the final render re-directed it. The fix route now re-directs the stale scenes before answering, so the Preview, the drawn scenes and the final render match.
- **Seams:** the joined film was compared with a full-film software render of the same prepared folder, and with a hardware-GPU render as the glitch-free truth.
  - Joined vs full software: mean 57.2 dB, worst frame 41.1 dB (encoder noise), so they match frame for frame.
  - Joined vs GPU: mean 38.1 dB, worst 36.2. Full software vs GPU: mean 38.1, worst 37.5. This is the usual software/hardware rasterising offset; no frame dips.
  - At all 7 boundaries (frames 82, 315, 585, 861, 1104, 1365, 1560), the change into the first frame of the next scene equals the film's own cut in all three renders (for example 4.37 / 4.30 / 4.31 luma levels at frame 82). The only extra is ≤0.13 luma levels where a clip opens on a fresh keyframe. No visible jump.
- **Software-render glitch:**
  - With the engine as of 23:21, the full software render dropped boxes 9–16 and left stale "16 numbers" pixels in scene 3. The per-scene clip of the same page drew that scene correctly (all 16 boxes, previous scene cleared).
  - With the current engine (later frame-film.js changes), the full software render no longer shows the glitch either: no frame under 37.5 dB against GPU. So per-scene drawing avoided it where it occurred, and it cannot be shown separately any more.
- **Not tested:** the R2 (staging/production) paths: page upload, clip upload/download, the presigned clip URL. Nothing is deployed.
