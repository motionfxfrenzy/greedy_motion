# Product flow v2: Script & Style → Storyboard → Motion → Render → Review

Status: **in progress** (2026-10-05). Replaces the Goal step and reorders the creation flow around the
script director (`/gm-script-director`) and the skill library.

| Part | Owner | Status |
|---|---|---|
| Contracts: `ScriptBrief`, `BeatPlan`, budgets, `beatPlanProblems` (`packages/contracts/src/beat-plan.ts`) | pipeline session | ✅ done |
| Director: `POST /v1/projects/:id/plan` (Claude structured output, one repair round, own-words guard, invented-number/claim check, deterministic fallback) | pipeline session | ✅ done, tested live |
| Storyboard edits: `PATCH /v1/projects/:id/plan` (budgets enforced, 422 with problems) | pipeline session | ✅ done, tested live |
| Live composition source: `GET /v1/projects/:id/composition` (+ `beatTimes`) | pipeline session | ✅ `engine: "beat-plan"` |
| Director prompt compiled from the skill files (`npm run director:prompt`) | pipeline session | ✅ done |
| Script & Style screen, live storyboard (player 0.8.111); Goal and Brand steps removed | Design review session | ✅ done |
| Beat-plan composition engine, any duration and aspect (`worker/templates/beat-plan`, preview `GET /v1/preview/plans/:id`, `backend/src/plan/timing.ts`) | pipeline session | ✅ done: 3 test plans pass check, pacing and duration (`experiments/beat-engine/NOTES.md`) |
| Audio: `POST /v1/projects/:id/plan/audio` (Gemini TTS per line, cached; Whisper word times drive the clock; Lyria 3 bed ducked under words; Pixabay SFX on cuts, clicks and success), `backend/src/plan/{audio,voice,music,sound,pcm}.ts` | pipeline session | ✅ done: test render every take within 4 ms, -15.2 LUFS (`experiments/plan-audio/`) |
| Render project builder (`backend/src/plan/render-project.ts`): the storyboard page + all assets for a CLI or worker render | pipeline session | ✅ done; the worker hookup comes next |
| Storyboard sound toggle (player is `muted`), call `/plan/audio` after plan and edits | Design review session | ⏳ requested |
| Product URL: `POST /v1/projects/:id/site` reads the site (facts for the director as fenced untrusted data, labelled section screenshots, HTML/CSS snapshots, brand suggestion); `brief.productUrl`; `backend/src/site/` | pipeline session | ✅ done: linear.app in 29 s; private addresses refused; plan routed 4 ui beats to site sections |
| URL field on the Script card, brand autofill, site shots in the Screenshots panel | Design review session | ⏳ requested |
| Site read as a worker queue job (the backend image has no browser: `html-only` there) | Design review (queue) | ⏳ later |
| Generated 3D or footage clips in the engine | pipeline session | ⏳ later |
| Motion-direction queue stage (`directing`, `assembling`) | Design review (queue) + pipeline (work function) | ⏳ later |
| Variable duration in render-plan; `"square"` format | coordinated | ⏳ later |

```
1 Script & Style ──► 2 Storyboard ──► [Submit] ──► 3 Motion direction ──► 4 Render ──► 5 Review ──► (Studio)
   brief or script      live frames,       (approval)    skills in parallel      worker queue     comments, AI edits,
   + all choices        real-time edits                  per beat                                  re-render
```

## 1. Script & Style (the new first screen)

Everything the film needs is chosen here, on one screen. There is no separate Goal step; the goal
is inferred from the brief (or picked from an optional dropdown).

| Control | Options | Feeds |
|---|---|---|
| **Script** | *Describe the problem* (we write it) · *Paste my script* (kept verbatim; we only suggest edits) | script director mode B / A |
| **Duration** | 15s · 30s · 45s · 60s · 90s (custom 10–120s) | beat count and structure (script-for-motion → Structure) |
| **Aspect ratio** | 16:9 · 9:16 · 1:1 | canvas; layouts are re-laid, not scaled |
| **Theme** | Pick from the gallery · use a saved brand kit · **paste a website URL** (extracts name, colours, fonts and logo via the existing `POST /v1/brands/extract`, reviewed before saving) · paste colours and upload a logo | brand tokens |
| **Motion style** | Snappy · Smooth · Springy (the brand motion profile), plus an optional template (Feature explainer, Velocity sting, …) | eases, durations, camera, copy tone |
| **Audio** | Voiceover · Music · Both · None; voice choice; music mood | VO / Lyria / library |
| **Pace** | Calm · Balanced · Fast | words per minute, gaps, shot length, cut rate (within the pacing gates) |
| **Captions** | Key phrases · Full captions · Off | captions overlay |
| **Screenshots** | Upload 1–N real product screens (drag to order, label purpose) | `ui` beats |

The **Generate** button runs the script director and returns `SCRIPT.md` (editable inline, with
accept/reject suggestions for pasted scripts) plus the beat plan. Duration and aspect ratio can be
changed here later; doing so re-plans the beats.

## 2. Storyboard (fast, live, editable)

- Each beat appears as a **frame card**, drawn **live in the browser** by `@hyperframes/player`
  from the composition and its variables. No server render is needed; a 10-frame board took ~5s
  even as server-side snapshots.
- **Real-time text edits:** typing in a frame's headline, keyword or label updates the frame
  instantly (a HyperFrames variable). Slot budgets are enforced as you type.
- **Quick preview:** a play button plays the draft with the real timing and the draft VO/music, in
  the browser player.
- 3D and footage beats show their **style frame / character sheet** (Nano Banana, approved here)
  and a 2D placeholder in the preview until generated.
- Per frame: swap screenshot, change the key phrase, reorder, remove or restore a beat, pick the
  fallback for a generated beat.
- **Submit** locks the script and storyboard and starts motion direction.

## 3. Motion direction (after submission; skills in parallel)

The server builds the finished composition from the beat plan. Each beat is independent once the
plan and the clock are fixed, so the work fans out:

| In parallel | Skill / tool |
|---|---|
| VO generation → transcript → clock | Kokoro or Gemini TTS, Whisper (`/media-use`) |
| Music bed and SFX | Lyria / library (`/media-use`, `/hyperframes-audio`) |
| Each 2D beat's motion: camera, entry/exit, text effects, cursor | `/motion-doctrine`, `/cut-the-curve`, `/oversized-cursor`, `/hyperframes-animation`, the template's `gm-*` skill |
| Each 3D beat | Three.js on the GPU queue, or Nano Banana → Veo (visual-skills) |
| Each footage beat | character sheet → keyframe → Veo with dialogue (visual-skills) |

Then one **assembly** pass puts everything on the clock: transitions from the seam ledger
(J-cuts under speech, beat snapping), the ducked music, the captions. The gates run: `check`,
pacing (no hold > 0.6s), verb sync, loudness. A failing beat falls back to its 2D version
rather than blocking the film. The user sees stage progress (Writing voiceover · Directing
motion · Generating 3D shots 1/2 · Assembling · Checking).

## 4. Render

The existing `render-video` queue. 2D on CPU workers (~30s per 12s of video at 4 vCPU); 3D beats
arrive as finished clips, so they don't slow the render. The user can leave the page.

## 5. Review

The existing Comment Edit flow: timeline comments → AI revision → accept/reject → re-render.
**Open in Studio** hands the same composition to the pro editor. A pro design can be published
back as a template.

---

## Where the skills live in production

Skills are **instructions and code that ship with our software**, not user data, so they don't go
in S3 and aren't fetched from GitHub at runtime.

| What | Where | Why |
|---|---|---|
| Skill source (`.claude/skills/gm-*`, the vendored HyperFrames skills, `third_party/visual-skills`) | **GitHub (this repo)** | Reviewed, versioned, tested with the code that uses them |
| Skills used by **agents** (motion direction, author mode) | **Baked into the worker image at build time** (CI copies the pinned skills into the Docker image; the agent runs with the Claude Agent SDK, which loads skills from a folder) | Same version as the renderer; no network fetch; rollback with the image |
| Alternative for hosted agents | **Anthropic Skills API** (`client.skills.*`): CI uploads each skill version on deploy; requests reference it by ID | Anthropic runs the container; no skill files on our servers |
| Rules the **one-call planner** needs (script-for-motion, routing, schema) | **Compiled into the backend**: the system prompt and the beat-plan schema, generated from the skill files at build time | The planner is one API call, not an agent; a build step keeps the prompt and the skill in step |
| User assets (screenshots, brand kits, style frames, generated clips, VO, renders) | **R2 (S3-compatible)** | Per-project data |
| Scene and template library (frozen `template/` folders, reusable 3D clips) | **In the image** (templates) + **R2** (large media, per-brand reusable clips) | Templates version with code; heavy media doesn't bloat the image |

**Running several skills at once:** the motion-direction job is an orchestrator. It reads the beat
plan and starts one task per beat (plus audio), each with only the skills its beat's `kind`
needs (`gm-script-director/references/routing.md`), then assembles. With the Claude Agent SDK
these are sub-agents; with plain API calls they are parallel requests. Generation calls (Nano
Banana, Veo, Lyria, TTS) all run concurrently.

## What changes in the code (for planning)

| Area | Change |
|---|---|
| Frontend (`studio.tsx`, `prompt-composer.tsx`, `theme-picker.tsx`, `brand-kit.tsx`, `storyboard.tsx`) | Remove the Goal step; the new Script & Style screen; a live-player storyboard with inline variable editing |
| Contracts (`packages/contracts`) | Duration and aspect ratio as request fields (templates are fixed at 10s today); pace; audio mode; motion profile; the beat-plan type from `beat-plan.schema.json` |
| Backend planner | Outputs the beat plan (script director rules compiled in); the `tool_choice` fix for 5.5 models |
| Worker | A motion-direction job (fan-out per beat, assembly, gates) before `render-video`; a GPU queue for 3D |
| Templates | Variable-length compositions driven by the beat plan instead of fixed 10s templates |
