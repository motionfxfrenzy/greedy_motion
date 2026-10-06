# Changelog — gm-feature-explainer

## 1.1.0 — 2026-10-04 (pacing: no dead air, no settled frame)

The user liked the music-driven hybrid film's pacing and found the voiceover films "less dynamic,
with dead spaces". Measured with the new `tools/pacing_gate.py` (freezedetect n=0.002 on 480 px):

| Film | Length | Held % (d=0.4, incl. tail / excl.) | Longest hold | VO silence | Longest VO gap | Verb sync worst | Loudness |
|---|---|---|---|---|---|---|---|
| GM v1 (`gm/`) | 50.0 s | 33.8 / 28.2 | 2.8 s (end card; 2.0 s mid-film) | 33.0% | 1.24 s | 0.060 s | −13.8 LUFS / −3.9 dBTP |
| **GM v2 (`gm-v2/`)** | **41.7 s** | **0.0 / 0.0** | **none ≥ 0.4 s** | **23.4%** | **0.62 s** | **0.063 s** | **−13.9 / −3.4** |
| Tidyslot fill v1 (`fill/`) | 44.4 s | 35.6 / 30.0 | 2.5 s | 32.4% | 1.26 s | 0.057 s | −14.0 / −3.9 |
| **Tidyslot fill v2 (`fill-v2/`)** | **36.6 s** | **1.3 / 1.3** | **0.47 s** | **23.6%** | **0.57 s** | **0.080 s** | **−13.9 / −3.9** |
| reference: hybrid (music-driven) | 15.0 s | 30.5 / 23.6 | 1.0 s | — | — | — | −14.3 / −2.6 |

VO silence includes the 0.5 s lead and the 1.2 s tail; gaps are measured with silencedetect at −40 dB
(each authored gap reads ~0.1–0.17 s longer).

| Defect (v1) | Fix (v1.1) |
|---|---|
| A fixed ~1.2 s authored gap after every sentence (`GAP beat 1.1`); VO 33% silence | `pipeline.py vo`: 0.3 s inside an act, 0.45 s between acts, configurable (`pacing`), PROBLEM outside 0.25–0.4 / ≤ 0.6 |
| Scene cuts sat in the middle of those gaps: the picture waited on silence | J-cuts: the exit starts 0.04 s before the outgoing line's last stressed word, floored by the result's on-screen time; cut snapped to a bed beat within ±0.15 s (`pipeline.py beats` → `hyperframes beats`); J-cut table in `verify/sync-plan.md` |
| Problem act: chips on a slow even timer, a 1.06 push → 2.0 s holds | Chips on spoken words (`problem_chip_words`, fallback: stressed words); the persona keeps flying; push 1.14 + drift |
| CTA and end card: everything arrives at once, then 1.8 s of frozen tail (2.8 s hold) | CTA people pop on the opener's words; continuous push on the end card about the press point to the last frame; shapes drift; tail 1.2 s |
| Reveal held still ~1 s between the lockup and the cut | Positioning line on the second clause's first stressed word; push 1.09 + shape parallax to the cut; one optional declared stillness (≤ 0.9 s) before the name |
| Tour cards arrived complete, then a 1.035 push that ended 0.32 s before the exit | Screen assembles in a waterfall during the first clause; push 1.07 + field/shape parallax from entry to cut (fields over-wide so no edge shows) |
| No big type: a feature never "pops" like the hybrid's "Make it **move.**" | Optional `keyword` per beat: white slab, 84 px display type, word waterfall, last word in the field colour, enters on its word (budget ≤ 22 chars / 4 words) |
| Bed ducked by a 400 ms box filter, at 0.16 | Sidechain-style one-pole envelope from the VO: −7 dB only under words, attack 50 ms, release 150 ms, bed 0.2; a whoosh whose own peak lands on every cut; soft click on keywords |
| Read at speed 1.0 | Kokoro `af_heart` at 1.1 (widest pitch range of af_heart / af_bella / af_nova on a test line); one Gemini TTS comparison logged |
| (found building v2) at speed 1.1 whisper dropped "-board," and the verb probe placed "edit" 0.82 s early | Pause search after the first passing cut widened 0.75 → 1.2 s; PROBLEM when a probed onset is > 0.5 s from the whisper estimate |
| (found building v2) the persona's `power3.out` entry settled before its drift: a 0.63 s hold | Entry eases into the drift speed; failure rule |
| (found building v2) a 0.5 s between-act gap measured 0.67 s | Default 0.45 s |
| Rows streamed at 0.2 s / swapped badges at 0.22 s per row: results outlasted the tighter lines | 0.14 s / 0.15 s per row |

Fill mode inherits all of it: the template's `index.html` (SHA-1 `71ed2fb…`) was frozen from
`gm-v2/`; the Tidyslot fill rendered from it unchanged with `--variables-file` (keywords added,
chip words deliberately omitted to exercise the fallback). `check`: 0 findings on both (fill on the
`pipeline.py index` twin `fill-check-v2/`).

Still predicted: the pacing defaults on a 7–10 beat film; a bed with a strong regular beat grid
(the detector reads 184 BPM onsets on this 120 BPM bed, so snaps go to onsets).

## 1.0.0 — 2026-10-04 (library-ready)

Written from the reference analysis (`experiments/skills/gm-feature-explainer/analysis/SHOTS.md`),
then test-built twice. Every line below is a defect a build hit, and where the fix now lives.

### After test build #1 (Greedy Motion, `experiments/skills/gm-feature-explainer/gm/`, 50.0 s)

| Defect | Fix in the skill |
|---|---|
| Whisper word starts were 0.19–0.55 s apart between a whole-file and a per-line pass; timed raw, "writes" would have been 0.62 s late | Verb clock: two-sided boundary probe on a 40 ms grid + pause correction (`craft.md` §1, `tools/pipeline.py timing`); failure rule |
| Verbs at the start of a sentence leave no cursor travel | Slot rule: verb ≥ 3 words / 0.7 s in; `timing` prints a PROBLEM |
| CTA name spoken right after the cut: the people cloud collapsed before it read | CTA line = opener + name + verb; name ≥ 1.2 s after the cut, verb ≥ 0.9 s after the name; checked in `timing` |
| External `<script src="engine.js">` silently dropped by the bundler → "Timeline did not advance" | Engine inlined by `pipeline.py index`; failure rule |
| Inlined engine (537 lines) tripped `composition_file_too_large` | Engine minified with esbuild when inlined |
| Studio `preview` rewrote every `.html` (data-hf-id, attribute quotes) and broke the variables JSON | Templates are `.tpl`; variables attribute double-quoted with `&quot;`; failure rule: never run Studio preview on the project |
| Pressed "Submit" dimmed to 35% failed contrast | Pressed controls leave or change state (`craft.md` §3) |
| Player selection tag collided with the preview headline | Tags inside the outline |
| CTA cursor covered the pill label | Cursor aims at the pill's right end |
| Reveal held still for ~4 s | Slow push on lockup + line (camera with intent) |
| Loudness −14.4 LUFS after encode with a −14 target | Gain-correction pass measured on the WAV, aimed at −13.7 |

### After test build #2 (Tidyslot sample, `experiments/skills/gm-feature-explainer/sample/`, 44.4 s)

| Defect | Fix in the skill |
|---|---|
| The invented name "Tidyslot" was never matched (heard as "Tittyslot", "Tidislot", "Tiddaslot") | `|` aliases on the name-word slots + fuzzy match when aliases are given |
| Whole-file whisper drifted up to 0.8 s ("First" placed 0.8 s early); silencedetect merged spans → overlapping scenes | Sentence spans now come from the sample-exact assembly; silencedetect is only a cross-check |
| Two beat lines put the verb 0.2 s / 0.5 s in (caught by the new PROBLEM rule) | Lines rewritten; rule confirmed (no longer predicted) |
| Grid probe accepted a cut inside "page," before "choose" (whisper dropped the fragment) | Scan steps left until it starts on a failing cut; pause correction (≥ 80 ms) |
| Pause correction then grabbed the pause *after* "pick" on re-running build #1 | A pause end only counts if audio cut there still starts with the verb; build #1 re-timed to identical values |
| `rows` could only stream new rows; "confirm all" needed state changes on existing rows | `badge_after` variant (click) and on select |
| Editor/stages/player used a fixed 820 px preview: with a sidebar the panel was 246 px and the typed title clipped | `fw = min(820, mw − 440)`; player geometry relative to the frame |
| Badge swap flagged as text overlap (info) | Badges marked `data-layout-allow-overlap` |
| −1.3 dBTP after encode on the GM re-render with a 0.70 limiter | Limiter ceiling 0.60; both builds re-mixed (−3.9 dBTP) |

### Fill mode

- `template/` frozen from the passing GM build; root and audio carry no `data-duration`, so the
  sample's values (a different length, 44.4 s vs 50.0 s) rendered from the unchanged HTML
  (same SHA-1) with `--variables-file`. Verb sync worst 0.057 s; −14.0 LUFS / −3.9 dBTP.
- Limitation, stated in SKILL.md: `hyperframes check` 0.8.111 has no variables flag, so the fill
  is checked on a twin regenerated by `pipeline.py index` (byte-identical except the variables
  attribute) — passed, 0 findings.

### Still predicted (no build has exercised it)

- 9:16 re-layout of the card grid and cursor targets.
- 7–10 beat films (both builds used 5–6).
