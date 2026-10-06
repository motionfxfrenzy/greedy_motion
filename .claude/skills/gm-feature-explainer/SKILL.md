---
name: gm-feature-explainer
description: Build a 30–120 second narrated product explainer where every narrated sentence is demonstrated, not illustrated — the product's real screen arrives as a white card on a brand-colour field and an oversized cursor performs the action the voice names, on the verb. Delivered as a rendered MP4 plus the editable project and its transcript-derived clock, so it can be re-branded or re-voiced later without the actions drifting off their words.
---

# Feature Explainer

A narrated explainer in four acts: the problem (a persona ringed by the jobs that pile up), the
reveal (brand shapes wipe in, the mark and name land, one positioning line), a feature tour of
5–10 beats, and a CTA (a cloud of people collapses into the lockup, the cursor presses the CTA).
In the tour each sentence gets one real product screen, redrawn at video scale as a white card,
and one visible action — select, click, toggle or type — that lands on the word that names it.
The viewer feels they watched the product work, not a slideshow about it. Built as HTML, CSS,
SVG, and GSAP, rendered to MP4 by the HyperFrames CLI.

## Style origin

The structure and technique are abstracted from a publicly published SaaS explainer (analysis in
`experiments/skills/gm-feature-explainer/analysis/`). The subject, copy, palette values, screens,
characters and every asset are authored fresh for the caller's product. Nothing in the output
states or implies affiliation with, endorsement by, or authorization from any company the caller
does not own.

## When to use

A product with a real UI and a stepwise workflow: "what it does, one feature at a time",
onboarding tours, launches with 5–10 demonstrable actions. 16:9 (9:16: see failure rules).

Do not use it for a product with no interface to show, for a single feature (use a launch film:
`bs-hyperframes-chat-to-result-launch`), for a silent social cut or a sting (use
`bs-hyperframes-velocity-sting`), or for a music-driven brand reel (`gm-glossy-3d-reel`). If the
features cannot each be shown as one action on one screen, this is the wrong structure.

## The three rules this film lives by

**One. One sentence, one demonstrated action, on the verb.** Each beat line names one action and
the cursor performs it on that word's onset (gate: ±0.25 s, measured in the render). The action's
result resolves before the next line. Break it and the film becomes narration over pictures.

**Two. The brand colour is the stage, not the paint.** The screens stay neutral (white cards, the
product's own greys and its own primary button). The brand colour is the full- or part-bleed
field and the half-circle shapes that carry every seam, plus the chip and the selection ring.
Nothing decorative is brand-coloured; secondary accents (e.g. an orange in the mark) stay inside
the mark.

**Three. No dead air, no settled frame.** The voice never waits on the picture and the picture
never waits on the voice. Sentences sit 0.25–0.4 s apart inside an act and ≤ 0.6 s between acts;
every scene's exit starts on the last stressed word of its line (a J-cut under speech) so the next
scene is already moving when its line starts; every scene carries a camera move from entry to cut;
content arrives on words; the music bed fills every gap. Gate: no `freezedetect` hold (n=0.002,
d=0.6, 480 px) over 0.6 s except one declared stillness beat (≤ 1.0 s) before the reveal
(`tools/pacing_gate.py`). The v1 films measured 28–30% held with 2.0–2.8 s holds and 1.2 s gaps
after every sentence; the user called them "less dynamic, with dead spaces". This rule applies to
every VO-clocked gm skill (`shared-craft.md` → Pacing).

All three rules are data: the clock is `timing.json` (from the voiceover transcript + a boundary probe
on each verb) and the actions are the `beats` variable; `tools/verify_sync.py` checks one against
the other in the rendered MP4; `tools/pacing_gate.py` measures holds and VO gaps in the MP4.

**Script and watchability:** write the script by `gm-skill-authoring/references/script-for-motion.md` and check the film against `gm-skill-authoring/references/watchability.md` (hook by 3s, works muted, the brand motion profile, a success moment, length by format).

## Required input

- The product and its slots — `references/slots.json`, budgets and screen kinds in
  `references/blueprint.md`. Real screens, real nav, real labels, real numbers only.
- Brand from the kit / theme contract: field, second tone, ground, ink, body, the real primary
  button, the mark (SVG), wordmark split, fonts (bundled OFL set).
- The canvas (16:9).
- Audio: a voice (local Kokoro via `hyperframes tts`, $0, **speed 1.1**) and a bed the caller owns
  (beats are detected with `hyperframes beats`). No generation model is required. Gemini TTS is a
  paid option (livelier: 2× Kokoro's pitch range on the same line, see craft §5); log any call.

## The rights rule for third-party UI and people

- Every surface is the caller's own product, redrawn from its real screens, or a neutral original.
- A third-party UI the reference leans on (search results, social profiles, an email client) is
  rebuilt as a neutral original with no wordmark, icon set or signature layout — or left out.
- No stock faces and no real people: the persona and the CTA cloud are the brand's own mascot,
  illustrated avatars, or initials. Never a real person's name or likeness.
- The handoff states which surfaces are the caller's own and which are neutral originals.

## Retarget to the user's product

1. **Fill the slots** with the product's real screens and its own words. Pick a screen kind per
   beat (tiles, rows, toggles, editor, stages, player) that matches the real screen.
2. **Apply the brand kit** to the `color_*` tokens; `color_field` must carry white text at AA.
3. **Keep the clock and the rules.** Write each beat line so its verb is 3+ words in (≥ 0.7 s),
   and end it on a stressed word that comes after the action's result (the exit starts there).
   Give each beat a `keyword` (≤ 22 chars, ≤ 4 words, echoing the line) and, for act 1,
   `problem_chip_words` (the word each chip lands on).
   Any VO change re-runs `timing` and re-opens every beat it touches.
4. **Re-measure what cannot be guessed:** verb onsets (probe), loudness after encode.

`references/checklist.md` gates all of this.

## Workflow

1. **Load the stack:** `/hyperframes`, `/hyperframes-core`, `/motion-doctrine`,
   `/oversized-cursor`, and `.claude/skills/gm-skill-authoring/references/shared-craft.md`.
2. **Run the checklist's fit and rights sections.**
3. **Copy `template/` to the project** and write `content.json` (see `content.example.json`).
4. **Lock the clock first:** `pipeline.py vo` (Kokoro per line, tight authored gaps), `beats`, then
   `pipeline.py timing` (verbs probed, J-cuts placed and beat-snapped, chips and keywords on their
   words). Fix every PROBLEM it prints (verb too early, name not heard, CTA too tight, keyword too
   late, result outlasting its line) by rewriting the line, never by nudging times.
5. **Build:** `pipeline.py mix vars` → fill mode is done. Author mode (new screen kind, new
   layout): edit `engine.js`, then `pipeline.py index` and `lint`.
6. **Measure:** `check` at zero findings; snapshot a frame after each verb.
7. **Render**, then **verify the invariants** in the MP4: `node tools/actions.mjs .`,
   `tools/verify_sync.py` (verbs) and `tools/pacing_gate.py` (holds, VO gaps, loudness). Then `ffprobe`.

## Structure

| Act | What happens | Share | Clock |
|---|---|---|---|
| 1 Problem | Persona flies in and keeps travelling; one chip pops per spoken job word; continuous push; collapse inward | 10–15% | problem lines |
| 2 Reveal | Shapes wipe in; (declared stillness ≤ 0.9 s); mark + name land on the name word; positioning line on the next clause; push + parallax | 8–12% | reveal line |
| 3 Tour | 5–10 beats: field + card enter LEFT before the line starts, screen assembles on the first clause, action on the verb, keyword on its word, push to the J-cut | 65–75% | one line per beat |
| 4 CTA | People arrive on the opener's words, collapse into the lockup on the name; pill; press on CTA verb; push to the last frame | 8–10% | CTA line + 1.2 s tail |

## Commands

```bash
HF=worker/node_modules/.bin/hyperframes; PY=~/.cache/hyperframes/tts/venv/bin/python
$PY tools/pipeline.py vo && $PY tools/pipeline.py beats && $PY tools/pipeline.py timing  # clock (verify/sync-plan.md)
$PY tools/pipeline.py mix && $PY tools/pipeline.py vars    # audio + variables.json
$HF check                                                  # author mode: after pipeline.py index
$HF render . --variables-file variables.json --fps 30 --workers 3 --quality high --output renders/film.mp4
node tools/actions.mjs . && $PY tools/verify_sync.py . renders/film.mp4
python3 tools/pacing_gate.py renders/film.mp4 --vo assets/audio/voiceover.wav --timing timing.json --json verify/pacing.json
```

## Fill mode

`template/index.html` is never edited. Slot values and the clock reach it as variables
(`--variables-file variables.json`): `beats` and `timing` are JSON strings, everything else is a
scalar. The root has no `data-duration`, so the length is inferred from the timeline that
`timing.total` ends and from `assets/audio/mix.wav` — **a new VO re-times every scene with no HTML
edit**: re-run `vo beats timing mix vars`, render. Limits: `hyperframes check` (v0.8.111) has no
variables flag, so check the fill on a twin made with `pipeline.py index` (identical HTML except
the variables attribute); the audio is a file at a fixed path, not a variable.

## Output contract

- One MP4: 1920×1080, 30 fps, 30–120 s, H.264 + AAC, ≈ -14 LUFS, ≤ -2 dBTP.
- Project: `index.html`, `content.json`, `variables.json`, `timing.json`, `transcript.json`,
  `assets/audio/` (lines, voiceover, beats, mix), `verify/` (sync table + J-cut table, probes,
  pacing.json, ebur128, check).
- `HANDOFF.md`: slots and values, brand tokens, rights position, verb-sync table, J-cut table, the
  pacing gate (held %, longest hold, VO gaps, the declared stillness window if any), `check` output,
  loudness, `COST.md`.

## Failure rules

- If any action is more than 0.25 s off its verb in the render, re-time, never re-ease.
- If the VO changes, re-run `timing`; never stretch a scene to cover a longer read.
- If you time anything from raw whisper word starts, stop: on Kokoro reads they drifted up to
  0.73 s. Use the probed onsets in `timing.json`.
- If a verb lands < 0.7 s into its sentence, rewrite the line (the cursor has no time to travel).
- If an invented product name is not heard, add `|` aliases to the name-word slot.
- If the CTA name comes < 1.2 s after the cut or the CTA verb < 0.9 s after the name, open the
  CTA line with a short phrase.
- If a script or style lives in an external local file, inline it: the bundler drops local
  `<script src>` and the timeline never registers ("Timeline did not advance").
- Never run Studio `preview` on the project: it rewrites every `.html` (adds `data-hf-id`,
  re-quotes attributes) and broke the variables JSON.
- If a pressed control would be dimmed, remove it; a 35% button fails contrast.
- If `pacing_gate.py` finds a hold, add story or camera to that window (a reveal on a word, a
  push, parallax), never an idle loop. An entrance that eases to rest (`power3.out`) before a
  slower drift reads as a 0.6 s hold: ease into the drift's own speed (`power2.out` to part-way).
- If `timing` says the cut lands well after the next line starts, the result outlasts its line:
  shorten the result (fewer rows, shorter typed text) or lengthen the line. Never re-open the gaps.
- If a verb onset lands far from the whisper estimate (`timing` prints a PROBLEM at > 0.5 s), read
  `verify/probe`: at speed 1.1 whisper once dropped "-board," and the probe sat 0.9 s early until the
  pause search was widened to 1.2 s.
- 9:16 is not yet built: re-lay out the card grid and cursor targets in `engine.js` and run both
  test products before calling it supported (predicted).
