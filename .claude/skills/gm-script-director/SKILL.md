---
name: gm-script-director
description: Turn a user's own script, or just a problem/brief, into a production-ready beat plan — one JSON document that tells every downstream skill exactly what to build (2D motion, 3D shots, generated footage, voiceover, music, SFX, captions) and with which skill and prompt rules. Use whenever a Greedy Motion video starts from a brief or a script, before any composition, image, video or audio is generated.
---

# Script Director

The stage between "what the user said" and "what gets built". It writes or normalises the script
by `gm-skill-authoring/references/script-for-motion.md`, then expands every beat into precise
instructions for the skill that will produce it. Nothing downstream should have to guess.

## The two rules this stage lives by

**One. The beat plan is the contract.** Every downstream step (HyperFrames build, Nano Banana,
Veo, Three.js, TTS, Lyria, captions) reads its instructions from `beat-plan.json` and nothing else.
If a builder needs to invent something, the plan was incomplete, so fix the plan, not the build.

**Two. Respect the user's words; improve the film around them.** A user-supplied script is never
silently rewritten. The director splits it into beats, flags problems (hook too late, a line with
nothing to show, over budget, invented claims) and proposes edits as suggestions the user accepts
or rejects. Only a problem-only brief gets a fully generated script.

## Inputs

- **Mode A — own script:** the user's VO and/or on-screen text, plus product, goal and format.
- **Mode B — problem only:** a sentence or two about the problem, the audience and the outcome.
- Always: brand kit (tokens, mark, fonts, **motion profile** snappy · smooth · springy), real
  product screenshots or surfaces, format (social / launch / explainer, canvas), and optionally a
  chosen template (`gm-*` skill) and a style frame.

## Workflow

1. **Read the standards:** `gm-skill-authoring/references/script-for-motion.md` (beats, hook,
   success moment, footage beats), `watchability.md` (time, transitions, research rules) and
   `shared-craft.md` → Pacing.
2. **Pick the shape:** the format → length and beat count (script-for-motion → Structure); a
   template if one fits (`docs/SKILL_LIBRARY.md` index), else the generic shape.
3. **Script:**
   - Mode A: split into beats verbatim; run the self-check; write `suggestions[]` with
     the reason for each (e.g. "hook arrives at 7s; move line 3 first"). Apply only accepted ones.
   - Mode B: write the script from the problem, following every line rule.
4. **Classify each beat** (`kind`): `ui` (product screen + action) · `kinetic` (type-led 2D) ·
   `3d` (glossy object/scene) · `footage` (person; generated) · `title` (lockup / CTA).
   Prefer `ui` and `kinetic`; use `3d` / `footage` only where the story needs them (budget ≤ 2–3
   generated shots per film).
5. **Route and instruct each beat** using `references/routing.md`: the producing skill, the
   motion intent (camera, entry/exit vector, ease from the brand motion profile, energy), the
   prompts for generated media (written with visual-skills), the audio cues, the transition
   into the next beat, and a fallback for every generated beat.
6. **Plan the whole film:** clock (VO or beats), energy curve rising to the single success
   moment, music direction matching the motion profile, voice direction, caption mode, total
   cost estimate, and the approval gates (style frame, character sheet, storyboard snapshot).
7. **Validate** `beat-plan.json` against `references/beat-plan.schema.json` and the self-check;
   fix and re-validate. Then hand off.

## Output

- `beat-plan.json` (valid against the schema): the single source for every downstream step.
- `SCRIPT.md`: the readable script (VO + on-screen per beat) for user approval.
- `suggestions.md` (Mode A only): proposed edits with reasons, each accept/reject.
- A cost estimate: generated shots, voice, music, render.

## Failure rules

- If a beat has no visible action or key phrase, it isn't a beat: merge it or give it one.
- If the hook isn't in the first 3s or the product isn't on screen by 15s, restructure before
  handing off (Mode A: as a suggestion).
- If a claim, number or customer name isn't in the brief or the user's script, remove it.
- If a generated beat (`3d`, `footage`) has no fallback (`ui` or `kinetic`), add one.
- If a prompt for Nano Banana or Veo asks the model to draw text, a logo or the product UI,
  rewrite it: those always come from HyperFrames.
- Never pick a routing target that isn't installed; check `.claude/skills/` and `third_party/`.
