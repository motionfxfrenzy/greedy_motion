# gm-feature-explainer checklist

Work top to bottom. Stop where it says stop. Paste the filled list into `HANDOFF.md`.

## 1 · Fit
- [ ] The brief is a narrated, feature-by-feature explainer with 5–10 demonstrable actions. If it is one feature, a silent cut, or a music reel, stop and use the skill named in SKILL.md.
- [ ] The product really has a screen for every beat and a control for every action.

## 2 · Rights
- [ ] Every screen is the caller's own (redrawn from real screens) or a neutral original. Stated in the handoff.
- [ ] No third-party UI, logo, product name, screen recording, or real person appears. People are the brand's mascot, illustrated avatars or initials.
- [ ] Every font, sound and track has a logged licence or generation record (fonts OFL, SFX Pixabay, bed owned).
- [ ] Nothing from the reference video appears (product name, copy, price, colours, wordmark, UI, people).

## 3 · Slots
- [ ] `content.json` fills every slot in `references/slots.json`, inside its budget.
- [ ] Nav labels, step names, statuses, button labels, numbers and the CTA URL are real. An unknown URL is left empty.
- [ ] No invented results: no %, multipliers, customer names or figures the product can't defend.

## 4 · Clock
- [ ] `assets/audio/voiceover.wav` and `timing.json` exist before any build or edit.
- [ ] `pipeline.py vo` used tight gaps (0.25–0.4 s in an act, ≤ 0.6 s between acts); no pacing PROBLEM.
- [ ] `pipeline.py beats` ran (or the handoff says why cuts are not beat-snapped).
- [ ] `pipeline.py timing` prints no PROBLEM lines (verb ≥ 0.7 s into its line, names heard, CTA spacing, keywords ≥ 0.6 s before the exit, no cut > 0.25 s after the next line starts, no onset > 0.5 s off the whisper estimate).
- [ ] The J-cut table in `verify/sync-plan.md` shows exits starting on the last stressed word (under speech) except where a result floor holds them, each one named.
- [ ] Every scene boundary and action time comes from `timing.json`; nothing is typed by hand.

## 5 · Craft
- [ ] Rule one: `verify/sync.md` shows every action within ±0.25 s of its verb, measured in the render.
- [ ] Rule two: the brand colour appears only as field, shapes, chip, selection ring, toggles-on (and the product's own primary button if that is its real colour).
- [ ] Rule three: every scene has a camera move from entry to cut (push + parallax); chips, screen blocks, keywords and CTA people arrive on words; no idle loop anywhere.
- [ ] Each beat has a `keyword` (≤ 22 chars, ≤ 4 words) or the handoff says why not.
- [ ] Shared-craft determinism rules hold (from/to, immediateRender:false, no random, finite repeat, opaque root).

## 6 · Measurement
- [ ] Frames after each verb were looked at (snapshots or contact sheet): text fits, nothing clipped, the result is visible.

## 7 · Gates
- [ ] `lint` clean; `check` at zero findings, including contrast. (Fill mode: on the `pipeline.py index` twin.)
- [ ] The verb-sync table is saved.
- [ ] `tools/pacing_gate.py` PASS: no hold > 0.6 s (except one declared stillness ≤ 1.0 s before the reveal, listed in the handoff), no measured VO gap > 0.65 s. Held % and longest hold in the handoff.
- [ ] The bed is ducked only under words (7 dB, 50/150 ms) and audible in every gap; a whoosh on every cut.
- [ ] ≈ −14 LUFS / ≤ −2 dBTP after encode; audio stream present.
- [ ] Watched at full speed.

## 8 · Handoff
- [ ] Slots and values, brand tokens, rights position, sync table, J-cut table, pacing gate output (and stillness window), `check` output, loudness, `COST.md`.
