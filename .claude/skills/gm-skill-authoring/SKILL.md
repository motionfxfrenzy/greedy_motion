---
name: gm-skill-authoring
description: Turn a reference motion video (or a brief for a new film structure) into a reusable Greedy Motion style skill — SKILL.md, a blueprint, a craft system, a slot schema, and a gating checklist — then test-build it on a real product and freeze a fill-mode template. Use when the user wants to add a new video style or template to the library, reverse-engineer a video's structure, or package a film that worked into a repeatable skill.
---

# Authoring a Greedy Motion style skill

A style skill is one film structure, written so it can be re-aimed at any product. This skill
produces one, from a reference video or a structure brief, and proves it with a test build.
Read `docs/SKILL_LIBRARY.md` first; it explains the anatomy and the two run modes (fill and
author).

## The two rules this skill lives by

**One. Abstract the device, never the film.** Take the *structure and technique* — how cuts are
matched, what the clock is, how slots are shaped. Never carry over the reference's footage,
copy, logo, characters, music, UI, or product names. If the new skill could only make that one
film, it is not a skill.

**Two. A skill is not done until it has built two films.** Write it, build it for Greedy Motion,
build it for a second, different product, and fold every defect back into the skill text. A
failure rule nobody hit is a guess; a defect fixed only in the film will happen again.

## The watchability core

Before and after writing any skill, read `references/watchability.md`. Every skill must get **time** right (one clock, hook in 2s, read times, no dead space, rhythm with a shape, actions on words/beats, a landed ending) and **transitions** right (motivated, velocity-matched, under speech or on the beat, a carrier element, no exposed frame, sound on every cut). The reference's analysis must record how it handles each, and both test builds must pass the checklist there, including one full-speed viewing in a player.

**Scripts:** every skill's script step follows `references/script-for-motion.md` (beats not paragraphs; one line = one visible action; hook by 3s; a success moment; key phrases that work muted; one brand motion profile). Skills link to it and never restate a different rule.

## Required input

- A reference video, or a one-paragraph description of a film structure.
- What the user wants it for: the use case and the canvas (16:9, 9:16, 1:1).
- Two products to test it on. The default is Greedy Motion (assets in `docs/brand/assets/`,
  real surfaces and copy in `design_handoff/`), plus one neutral sample product you invent in
  the test brief and label as a sample.

## Workflow

1. **Ingest the reference with two passes** (`references/ingest.md`):
   - **Measure** with ffmpeg and `hyperframes beats`: probe, cut detection, contact sheets, beat
     grid, loudness.
   - **Watch and listen** with Gemini: `scripts/gemini_video.py` for the timestamped shot list,
     music and SFX, voiceover transcript, on-screen text, and intent. It uses `GEMINI_API_KEY` from
     `backend/.env` and costs a few cents.

   Merge the two into `analysis/SHOTS.md`, one row per shot: in, out, on-screen content, camera
   vector, transition out, accent usage, type size, and sound. Measurements win on timing and
   colour; Gemini wins on audio and intent; check any disagreement against frames.
2. **Name the device, the clock, and the two rules.** Write them at the top of
   `analysis/SHOTS.md` in three sentences. The clock is exactly one of these: a seam ledger, a
   voiceover transcript, or a music beat grid. If you can't name the device in one sentence,
   watch the reference again before writing anything.
3. **Split structure from content.**
   - Every on-screen string, number, image, and surface becomes a slot.
   - Give each slot a type and a budget **measured from the reference**: its character counts and
     how long it stays readable.
   - Write the slots to `references/slots.json` using the schema in `templates/slots.schema.json`.
4. **Fit test and rights.**
   - Write the "Do not use" cases.
   - Name the riskiest element (third-party UI, captured brand, licensed music, real people) and
     its safe default.
5. **Write the skill** in `.claude/skills/gm-<structure>/` from the files in `templates/`:
   - `SKILL.md`, from `templates/SKILL.template.md`. Keep the section order. Aim for 6–9 KB.
   - `references/blueprint.md`: the scene table with timings and seam-out, copy budgets, and the
     beats for each scene.
   - `references/craft.md`: the motion, interface, or audio rules specific to this structure.
     Link to `references/shared-craft.md` in this skill for determinism and audio rules; do not
     copy them.
   - `references/checklist.md`, from `templates/checklist.template.md`.
   - `references/slots.json`.
6. **Test build #1 (Greedy Motion).**
   - Run the new skill as written, in `experiments/skills/<name>/gm/`.
   - Use the repo-pinned CLI `worker/node_modules/.bin/hyperframes`.
   - Never use the shared worker containers, the backend, or the queue.
   - Log time, render time, and costs in `COST.md`.
7. **Fold back.** For every defect found in test build #1, add a failure rule or a checklist
   line, or fix the step that caused it. Record what changed in `CHANGELOG.md` in the skill
   folder.
8. **Test build #2 (a different product).** Run the skill again on the second product. If it
   needs anything the skill text doesn't say, go back to step 7.
9. **Freeze fill mode.** Copy the passing Greedy Motion build into `template/`. Every slot
   becomes a HyperFrames variable (`data-*` / `--variables-file`). Then prove that fill mode
   works: render it with a second set of slot values and no edits to the HTML.
10. **Register** the skill in the index in `docs/SKILL_LIBRARY.md`: status, length and canvas,
    clock, test-build paths, and measured cost.

## Gates (all must pass before "library-ready")

- `hyperframes check` shows zero findings on both test builds.
- The skill's invariant is verified mechanically on both builds, with the evidence saved: seam
  snapshots, a beat-alignment table, or a transcript-derived storyboard.
- **Pacing (every film):** no still hold > 0.6s (freezedetect gate, one declared ≤1.0s stillness beat allowed); VO-clocked films also have no VO gap > 0.65s, J-cuts under speech, a bed that fills gaps. See `references/shared-craft.md` → Pacing.
- Loudness after AAC is about -14 LUFS integrated and ≤ -2 dBTP.
- A fill-mode render with new slot values passes `check`, with no HTML edits.
- No content from the reference appears in either build.
- `COST.md` exists for both builds.

## Failure rules

- If the skill describes one film rather than a structure, say through fixed copy, fixed
  colours, or fixed scene content, move those into slots or delete them.
- If two rules aren't enough to explain why the film works, the device hasn't been found yet.
  Go back to step 2. Don't write a third rule.
- If a failure rule was written before any build hit that defect, mark it `(predicted)` until a
  build confirms it.
- If a reference shows a real company's UI, logo or product name, the skill's rights rule must
  replace it with a neutral original or the caller's own surface.
- If the skill needs a generation model (image, video or music), say so in "Required input",
  give the cost per run, and make the skill pass with a non-generated fallback too.
- Never commit the reference video or its frames into the skill folder. Keep them in
  `experiments/skills/<name>/reference/`.
