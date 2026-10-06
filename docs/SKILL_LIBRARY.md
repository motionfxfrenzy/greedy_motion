# Greedy Motion skill library

> Potential direction (2026-10-04, pending tests): mostly 2D motion built in HyperFrames. 3D comes only from Nano Banana Pro keyframes animated by Veo 3.1 and placed inside the HyperFrames timeline. See [MOTION_PIPELINE.md](MOTION_PIPELINE.md).

How the motion "style skills" work, reverse-engineered from three published HyperFrames style
skills, and how we write our own so the template library keeps growing.

Our skills live in `.claude/skills/gm-*/`. The vendored HyperFrames skills in the same folder are
re-copied on upgrade (see `.claude/skills/HYPERFRAMES-SOURCE.md`); `gm-*` folders are ours and are
never overwritten by that process.

To author a new skill, run the `/gm-skill-authoring` skill. It walks the whole procedure below.

---

## 1. What a style skill is

A style skill is **one film structure, written down so it can be re-aimed at any product**. It
does not describe a video. It describes the *device* that makes a kind of video work, the clock
everything is timed to, the slots a product fills, and the checks that prove the device survived.

The three references we studied:

| Skill | Device | Clock | Invariant that is checked |
|---|---|---|---|
| `velocity-sting` (12s, silent-ish) | Seven scenes read as one camera move | `ledger.json`: one row per cut | Every cut: both sides moving, same axis, same sign |
| `chat-to-result-launch` (30–45s, narrated) | The product works live inside a dark app | Voiceover word timestamps | Monochrome UI; the only colour is the product's mark |
| `agent-chorus-reel` (24–45s, music) | The same prompt typed in four places, then a reel of outputs | The music track's beat grid and drop | Prompt identical in all four surfaces; reel cuts land on beats |

## 2. Anatomy (all three follow it, section for section)

```
<skill>/
  SKILL.md                      the contract, ~8–9 KB
  references/
    <blueprint>.md              scene/slot table, timings, copy budgets, per-scene beats
    <craft-system>.md           motion/interface/reel rules + code snippets + determinism notes
    <ledger or mechanics>.md    the machine-checkable plan format (optional)
    <checklist>.md              gating checkboxes, pasted into the handoff
```

`SKILL.md` sections, in this order:

| # | Section | What it does | Example |
|---|---|---|---|
| 0 | Frontmatter | `name` + one-sentence `description`: *what you get*, the device, the deliverable | "Build a short product sting where every cut is velocity-matched… Delivered as a rendered MP4 plus…" |
| 1 | Pitch | One paragraph: what the film is, how long, what it is built with | "A ten-to-thirteen second product sting…" |
| 2 | Style origin | Where the structure came from; everything is authored fresh; no affiliation is implied | Required for every skill derived from a reference |
| 3 | When to use / Do not use | A fit test. The "do not" list stops the skill being forced onto the wrong brief | "If the brief is 'explain what we do', this is the wrong structure." |
| 4 | **The two rules this film lives by** | One or two non-negotiable craft laws. Everything else is negotiable | One ease family + matched vectors; identical prompt + on-beat cuts |
| 5 | Required input | What the caller must supply. Short list | Mark, 4 tokens, real nav, real number |
| 6 | Rights rule | The single riskiest element, and the safe alternative | Host interface → neutral original; brand capture only on owned sites |
| 7 | Retarget to the user's product | Numbered steps to map product → slots | "Fill the seven slots with surfaces the product actually has" |
| 8 | Workflow | Numbered build order. Always: load the stack → gate → **lock the clock first** → build → lint → measure → verify the invariant → check → render → probe | |
| 9 | Structure table | Scenes / slots / movements with beat and runtime | |
| 10 | Commands | Exact CLI lines | `hyperframes beats`, `snapshot --at …`, `render --quality high` |
| 11 | Output contract | MP4 spec, project files, handoff note contents, `check` output pasted | |
| 12 | Failure rules | "If X, do Y" — each line is a defect that already happened once | "If anything sits still at a cut, fix it." |

## 3. The design principles behind them

1. **One clock, locked before picture.** A ledger, a voiceover transcript, or a beat grid. Every
   timestamp derives from it. Retiming means re-opening the seams the clock touches.
2. **Slots with character budgets.** The product's content goes into named slots with hard limits
   (`question ≤ 90 chars`, `nav rows 4–6 × ≤ 14 chars`). This is what makes a skill retargetable —
   and it maps 1:1 onto our app's template variables.
3. **An invariant you can verify mechanically.** A seam ledger checked frame by frame; a prompt
   string declared once in code; a beat grid with snapped cuts. "Looks good" is not a gate.
4. **Honesty rules.** Real numbers or no count-up. Real outputs or no reel. Real nav labels. No
   invented results. These are written as stop conditions.
5. **Rights by construction.** The risky element (third-party UI, captured brand, music) has a
   named safe default, so the agent never has to judge it case by case.
6. **Failure rules are scar tissue.** Each one names a defect that cost a round (the `fromVars`
   visibility bug, id-less `<audio>` rendering silent, stock eases shifting exits by pixels).
7. **Deterministic by default.** Seek-safe tweens, no `Math.random`, finite repeats, frame-snapped
   cuts, from/to repeating every property, an opaque stage ground.

What they repeat verbatim (determinism notes, audio-id rule, render/probe commands) we keep **once**
in `.claude/skills/gm-skill-authoring/references/shared-craft.md` and link to it, so a fix lands
everywhere.

## 4. Greedy Motion conventions (what we add)

**House pacing standard (user-approved 2026-10-04):** every film, music- or voice-led, has no dead space: no still hold > 0.6s, no VO gap > 0.65s, cuts under speech, music filling gaps, kinetic keywords on beats. Gated by `pacing_gate.py`; rules in `gm-skill-authoring/references/shared-craft.md` → Pacing.


| Convention | Why |
|---|---|
| Name `gm-<structure>` | Separates ours from vendored skills |
| Brand comes from the brand kit / theme contract (`packages/contracts/src/themes.ts`), never hard-coded | One skill serves every customer |
| Slots are declared in `references/slots.json` with type + budget | The backend validates Claude's slot fill against it, and the UI renders the edit form from it |
| Each skill ships a `template/` (a working `index.html` with `data-*` variables) once it passes testing | Lets the app run the skill in **fill mode** without an agent |
| `COST.md` from the test build is kept in the skill folder | Every skill has a measured price before it reaches customers |
| A skill is "library-ready" only after a test build on **two different products** | Proves it is a structure, not a one-off film |

### Two run modes

| Mode | Who runs it | What Claude does | Cost per video (measured on our tests) |
|---|---|---|---|
| **Fill** | Backend planner, one API call | Writes the slot values (script, labels, numbers) as JSON against `slots.json`; the template renders | ~$0.03–0.06 in tokens + render compute |
| **Author** | Agent session (Claude Agent SDK / Managed Agents) | Builds a new composition from the skill, renders, checks, fixes | ~$3–8 in tokens, 20–45 min |

Most customer videos should run in fill mode. Author mode is for new templates and premium
custom work.

## 5. Procedure: reverse-engineer a reference into a new skill

Run `/gm-skill-authoring` with a reference video. Summary of what it does:

1. **Ingest the reference.** Probe it; dump scene cuts; make 1 fps and 4 fps contact sheets; run
   `hyperframes beats` on its audio; measure loudness.
2. **Shot log.** For each shot: time in/out, what is on screen, camera vector, transition out,
   where the accent colour appears, type size.
3. **Name the device, the clock, and the two rules.** If you cannot say in one sentence why the
   reference works, you are not ready to write the skill.
4. **Separate structure from content.** Structure becomes the blueprint; content becomes slots
   with budgets measured from the reference.
5. **Write the fit test and the rights rule.**
6. **Write SKILL.md + references** from `templates/` in the authoring skill.
7. **Test-build on Greedy Motion**, then on a second product. Every defect found becomes a failure
   rule or a checklist line; fix the *skill text*, not just the film.
8. **Gate:** `hyperframes check` at zero findings, the invariant verified, loudness measured, cost
   logged.
9. **Freeze a `template/`** from the passing build and register the skill in the index below.

Copyright line: we abstract *techniques and structure* (how cuts are matched, how a beat grid
drives a reel). We never copy a reference's footage, copy, logo, characters, music, or UI.

## 6. Index

| Skill | Status | Length / canvas | Clock | Test build | Cost (author mode) |
|---|---|---|---|---|---|
| `gm-glossy-3d-reel` | On hold. To be rewritten for the Nano Banana + Veo 3D path ([MOTION_PIPELINE.md](MOTION_PIPELINE.md)) | 15–20s, 16:9 | Music beat grid | — | — |
| `gm-feature-explainer` | **Library-ready** (2 builds + fill mode, 2026-10-04). 9:16 not yet built | 30–120s, 16:9 | Voiceover transcript (verb onsets probed, ±0.25s gate) | [GM 50.0s](../experiments/skills/gm-feature-explainer/gm/) · [sample 44.4s](../experiments/skills/gm-feature-explainer/sample/) · [fill](../experiments/skills/gm-feature-explainer/fill/) | $0 API; CPU render 112s ≈ $0.006; ≈ $4 tokens/build (fill ≈ $0.05/video) |
| `gm-3d-shot` | Planned (next to author) | One 3D shot as a video layer | Ledger row | — | ≈ $1.25–2.30 per shot in API fees |

Third-party skills we have tested (in `~/Downloads`, not vendored):

| Skill | Test build | Result |
|---|---|---|
| `bs-hyperframes-velocity-sting` | `experiments/gm-ad-test/velocity-sting/` | Passed: 6/6 seams verified, check 0 findings, 16s render, ~$3 tokens |
| `bs-hyperframes-chat-to-result-launch` | `experiments/gm-ad-test/chat-launch/` | In progress |
| `bs-hyperframes-agent-chorus-reel` | — | Not yet; needs 8–12 real Greedy Motion outputs and a track with a drop |

## 7. Script and watchability standards (single source of truth)

- `gm-skill-authoring/references/script-for-motion.md`: how every script is written (beats not paragraphs; one line = one visible action; hook by 3s; a success moment; key phrases that work muted; one brand motion profile). The backend planner's system prompt (`backend/src/render/anthropic-planner.ts`) mirrors it; change both together.
- `gm-skill-authoring/references/watchability.md`: correct time, correct transitions, and research-backed rules.
- `gm-skill-authoring/references/shared-craft.md` → Pacing: the no-dead-space gates.

Research sources (2026-10-04): [advids](https://advids.co/blog/saas-product-launch-videos), [What A Story](https://www.whatastory.agency/blog/saas-explainer-video-examples), [Wemotion](https://www.wemotionistanbul.com/post/motion-design-for-saas-brands-explaining-complex-products-with-clarity), [OpusClip retention data](https://www.opus.pro/blog/ideal-youtube-shorts-length-format-retention), [Animoto](https://animoto.com/blog/video-marketing/why-first-3-seconds-matter), [Magic Motion Studio](https://magicmotionstudio.com/how-long-should-an-explainer-video-be/), [DEmotion Apple-style motion](https://trydemotion.com/blog/apple-style-animation-guide).

## 8. The production workflow (script director first)

```
Brief or own script ──► /gm-script-director ──► beat-plan.json (+ SCRIPT.md, suggestions.md)
                              │  reads: script-for-motion, watchability, pacing, routing
                              ▼
   approvals: script → style frame → character sheet (if footage) → storyboard snapshot → motion preview
                              ▼
   producers read only their beats:  HyperFrames (ui · kinetic · title) │ Three.js (brand 3D, GPU)
                                     Nano Banana → Veo (organic 3D · footage, via visual-skills)
                                     Kokoro/Gemini TTS · Lyria · SFX · captions
                              ▼
   assemble on the clock → gates (check · pacing · sync · loudness) → render → review
```

- **Own script:** kept verbatim; the director only splits it into beats and proposes edits as accept/reject suggestions.
- **Problem only:** the director writes the script by script-for-motion.
- The routing table (which skill builds which beat, with which instructions) is `gm-script-director/references/routing.md`; the contract is `beat-plan.schema.json`.
