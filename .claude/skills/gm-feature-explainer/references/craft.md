# Craft — the verb clock, the interface system, the stage

Determinism, fonts, audio-id, loudness and render rules are shared by every gm-* skill: read
`.claude/skills/gm-skill-authoring/references/shared-craft.md`. This file only adds what is
specific to this structure.

## 1. The verb clock (rule one, as code)

The film is timed to word onsets, so the onset has to be right. **Whisper's word starts are not
good enough on TTS reads**: on the two test builds the whole-file pass and a per-line pass
disagreed by 0.10–0.73 s, and the whole-file pass once placed "First" 0.8 s early. A cursor timed
to those numbers misses its word by more than the ±0.25 s gate.

`tools/pipeline.py timing` therefore finds each verb (and each name word) like this:

1. Whisper twice — the whole voiceover and the line's own file (offset by its known assembly
   start) — and take the mean as a first estimate.
2. **Two-sided boundary probe on a 40 ms grid.** For a cut time `t`, transcribe the audio that
   starts at `t` and the audio that ends at `t`. The verb's onset is just before the first `t`
   where the "after" clip begins with the verb and the "before" clip does not end with it. The
   scan first steps left until it starts on a failing cut, so the bracket is closed.
3. **Pause correction.** Whisper drops a trailing fragment of the previous word, so the first
   passing cut can sit inside that word. If a real pause (≥ 80 ms under the quiet threshold) ends
   within 0.75 s and audio cut at the pause's end still starts with the verb, the onset is the end
   of the pause. A pause *after* the verb fails that test, because that audio starts with the next
   word.
4. The method used for every word is written to `verify/sync-plan.md`.

Sentence spans come from the assembly (sample-exact, because the gaps are authored) and are
cross-checked against `silencedetect`. Scene cuts are J-cuts placed from those spans (§5).
The pause search runs to 1.2 s after the first passing cut (it was 0.75 s; at speed 1.1 the comma
pause after "storyboard," sat 0.9 s away and "edit" was placed 0.82 s early). `timing` now prints a
PROBLEM whenever a probed onset is > 0.5 s from the whisper estimate.

Writing for the clock:
- Put the verb 3+ words into its sentence (≥ 0.7 s): the cursor needs that long to travel and
  the card needs 0.5 s to arrive. `timing` prints a PROBLEM if not.
- Prefer verbs that follow a comma or start with a hard consonant ("pick", "click", "submit"):
  their onsets probe cleanly. Glued pairs like "it writes" still pass, with ±0.02 s.
- Invented names are misheard ("Tidyslot" → "Tittyslot", "Tidislot", "Tiddaslot"): list aliases
  in the name-word slot; matching is fuzzy only when aliases are given.

## 2. The interface system (rule two, as tokens)

The real product, redrawn at video scale. Web-scale screenshots are illegible in video, and the
reference's own UI text was too small at 720p.

| Role | Size |
|---|---|
| Card | 1500×840, radius 28, white, soft blue-black shadow |
| Screen title | 46 px / 700 |
| Body, field text | 25–27 px |
| Labels, meta | 20–22 px (mono for meta) |
| Brand row / nav | 28 / 24 px |
| Feature chip | 30 px / 700, white pill, field-coloured text |
| Wordmark | 132 px display face (~12% of frame height, as measured on the reference) |
| Cursor | 104 px (in-mock size of `/oversized-cursor`), dark body, white stroke, tip-targeted |

Colour roles are variables (`color_*`, applied by HyperFrames as CSS custom properties):
the card is neutral; the brand colour lives in the field, shapes, chip text, selection ring and
toggles-on. The primary button is the product's **real** primary (Greedy Motion's is near-black
`#181d27`; the sample's was its green). Muted web greys fail AA on white — use the body token.

Every cursor target is computed from the fixed grid — never `getBoundingClientRect`, which
races font loading (shared-craft). Buttons are sized by a character-count estimate
(`14.5 px × chars + 76`), text centred inside, so a longer label never moves a target.
Preview-frame kinds keep a side panel ≥ 410 px (`fw = min(820, mw − 440)`): with a sidebar the
fixed 820 px frame left a 246 px panel and the typed text clipped.

## 3. The stage (the transition carrier)

- One current: LEFT. Every tour seam: exit 600 px / 0.32 s `power3.in`, entry 900 px / 0.5 s
  `power3.out` (≈ 5.5k px/s both sides), the card trailing the field by 260 px for depth.
- The problem act exits by convergence (shrink toward centre) and the reveal enters by a lockup
  that grows *down* from 1.25: both shrink, so the Z sign holds across the cut.
- No idle motion and no settled frame. Every scene carries a camera from entry to cut: a linear
  push (card 1 → 1.07) centred on the action target, so the cursor's aim does not move, plus
  parallax on the layers behind it (field −110 px, shape −180 px). The fields are over-wide so the
  drift never shows an edge. Linear, finite, one direction: it carries the camera, it is not a
  breathe/float loop (motion-doctrine).
- Pressed controls do not dim (contrast fails); they leave or change state.
- Selection tags sit inside the selection outline; above it they collide with the preview text.
- The CTA cursor aims at the pill's right end so the label stays readable.

## 4. Engine and project rules

- The whole film is one composition built by `engine.js` from the variables. It is **inlined and
  minified** into `index.html` by `pipeline.py index`: the bundler drops local `<script src>`,
  and the un-minified engine trips `composition_file_too_large`.
- The variables JSON lives in a double-quoted attribute with `&quot;` escaping. Templates are
  `.tpl`, not `.html`, so no tool rewrites them.
- No root `data-duration` and no audio `data-duration`: the length is inferred from the timeline
  (`timing.total`) and `mix.wav`, which is what lets fill mode re-time with no HTML edit.
- SFX are mixed offline into `mix.wav` by `pipeline.py mix` at the clock's times (§5 for the bed
  and the transition whooshes), because
  `<audio data-start>` is static HTML. Loudness: loudnorm (two-pass, linear) → gain correction to
  −13.7 measured on the WAV → limiter at 0.60. After AAC the builds measured −13.8/−14.0 LUFS,
  −3.9 dBTP. (A 0.70 ceiling measured −1.3 dBTP after encode once.)
- `tools/actions.mjs` runs the engine headless and writes every scheduled action and its target;
  `tools/verify_sync.py` finds, in the rendered MP4, the first frame where the pixels around each
  target jump after the cursor's 0.16 s rest. That frame minus the verb onset is the gate.

## 5. Pacing (rule three, as code)

Measured on v1 with `tools/pacing_gate.py`: the GM film was 28% held (d=0.4, excl. the open tail)
with a 2.0 s longest hold and a 2.8 s frozen end card, and its VO was 33% silence with a fixed 1.2 s
gap after every sentence. Scene cuts sat in those gaps, so the picture waited on silence. The
music-driven hybrid (24% held, 1.0 s longest) felt better because nothing in it waits. v2 rules:

**Gaps.** `pipeline.py vo` writes 0.25–0.4 s between sentences inside an act (`gap_in_act`,
default 0.3; the problem lines; the tour beats) and ≤ 0.6 s between acts (`gap_between_acts`,
default 0.45). Configurable in `content.json` `"pacing": {...}` or env; out-of-range values print a
PROBLEM. `silencedetect` (−40 dB) measures each gap ~0.1–0.17 s longer than authored (soft word
endings), so the gate allows 0.65 s measured.

**J-cuts.** A scene's exit (0.32 s, `EXIT`) starts `jcut_lead` (0.04 s) before the onset of the
last stressed word of its outgoing line (the last word not in a function-word list), so the cut and
the seam happen under speech and the next scene enters (0.5 s) before its own line starts. Two
floors keep it honest: the outgoing result stays on screen ≥ `result_hold` (0.35 s) after it
completes (typing, streamed rows, the keyword's 0.8 s read), and a cut that would land > 0.25 s
after the next line starts is a PROBLEM (the result outlasts its line). The table is in
`verify/sync-plan.md`. On the GM v2 build 7 of 8 exits start under speech; the eighth (beat 2,
four rows stream after "writes") starts 0.04 s after the line.

**Beat snap.** `pipeline.py beats` runs `hyperframes beats` on the bed (throwaway project in
`verify/beats/`) into `assets/audio/beats.json`. The cut moves to the nearest beat (strength ≥ the
40th percentile) when one is within ±0.15 s and the result floor still holds; otherwise the VO wins.
GM v2: 5 of 8 cuts snapped (−0.117 … +0.014 s); Tidyslot v2: 2 of 7. The detector reports 184 BPM onsets on the 120 BPM
bed, so snapping is to onsets, not bars.

**On words.** Problem chips pop on `problem_chip_words` (fallback: spread over the lines' stressed
words, ≥ 0.12 s apart); the reveal's positioning line lands on the first stressed word of the
reveal's second clause; a beat's screen assembles in a waterfall (§6 of cut-the-curve: binary
opacity, y 44 → 0, `power4.out`) while its first clause is spoken, finished ≥ 0.45 s before the verb;
the CTA people pop on the opener's words. Word times are the mean of the two whisper passes
(±0.1–0.3 s): fine for these, never for verbs.

**Kinetic keyword** (optional `keyword` per beat: `{text, word}`, word defaults to the verb). A
white slab at (150, 944), 84 px display type, word-by-word waterfall (gaps 0.07 s × 0.84), the last
word in the field colour — "Pick a **spotlight.**". It enters on its word and stays to the cut.
Budget: ≤ 22 chars, ≤ 4 words, echo the line, ≥ 0.6 s before the exit starts (`timing` PROBLEM).
It overlaps only the card's bottom margin (the slab is `data-layout-allow-overlap`); the cursor's
after-action drift goes up, not down, when the target is low.

**The comma.** One stillness beat is allowed: between the reveal shapes landing and the name
(≤ 0.9 s, written to `timing.stillness`, accepted by the gate). It is optional; when the J-cut
already brings the name in fast (GM v2, Tidyslot v2) none is declared.

**Music as the floor.** The bed (owned `music_v2.mp3`, gain 0.2) is ducked sidechain-style from
the VO: 10 ms RMS frames above −38 dB re peak duck it 7 dB, attack 50 ms, release 150 ms
(one-pole), so it rises back inside every 0.3 s gap. A `whoosh-short` lands its own peak on every
cut (8 on GM v2), `click-soft` on each keyword, `pop` on chips and CTA people.

**Voice.** Kokoro `af_heart` at speed 1.1: the speech itself got 5% shorter (38.8 → 36.9 s of
speech for the same 121 words); with the tight gaps the film reads at 174 wpm overall (v1: 145). On one line, prosody measured with
`gm-v2/verify/voice/prosody.py`: af_heart 1.1 had the widest pitch range of the Kokoro voices tried
(10.4 semitones p5–p95 vs 8.8 af_bella, 8.7 af_nova), so it stayed. Gemini TTS (`Puck`, "upbeat,
energetic launch narrator") measured 19.8 semitones but read 18% slower and costs money: it is
the upgrade when a film still sounds flat, not the default.

**The gate.** `python3 tools/pacing_gate.py <mp4> --vo <voiceover.wav> --timing timing.json`
fails on any `freezedetect` hold (n=0.002, d=0.6, 480 px) > 0.6 s outside the declared stillness
and on any measured VO gap > 0.65 s; it reports held % (d=0.4 and d=0.6, with and without the open
tail hold), the longest hold, VO silence %, the longest gap and loudness. An entrance that settles
(`power3.out` to rest, then a slow drift) was the only hold v2 produced (0.63 s): ease into the
drift's speed instead.
