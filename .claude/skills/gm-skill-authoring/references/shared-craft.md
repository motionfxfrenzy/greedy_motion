# Shared craft rules (every gm-* skill links here)

These apply to every HyperFrames film we build. Style skills link to this file instead of
copying it, so a fix lands everywhere at once.

## Determinism (seek-safe rendering)

- Set `defaults: { immediateRender: false }` on every timeline.
- **Repeat every animated property in BOTH the `from` and `to` objects.** A property that only
  appears in `fromVars` gets its end value resolved lazily. When a render worker seeks to an
  arbitrary frame, that can resolve to `visibility: hidden`, and the element never appears. A
  monotonic `snapshot` pass still looks correct, so this bug passes every gate except the real
  render.
- Give every hidden-at-start element an explicit `tl.set(el, {autoAlpha: 0}, 0)`.
- No `Math.random` and no clocks: variation comes from stamped arrays or the index.
- A finite `repeat` everywhere. `repeat: -1` is banned.
- **Curves are tweens; decisions are stamps.** Typing rhythm, odometer values and highlight paths
  use `tl.set` frame by frame. Typing reveals use a width or clip tween, not per-frame substrings.
- Snap cut times to frames: `F(n) = (n - 1) / fps`; put clip boundaries just below the frame
  time.
- Count-ups tween a plain object and write the value in `onUpdate`, with tabular figures.
- Never pair a CSS initial `transform` with a GSAP tween on the same property.
- Give the root an opaque background colour; otherwise every seam flashes white.
- Mark deliberate overflow and off-canvas motion with `data-layout-allow-*`.

## Text that depends on rendering

Never measure text in the browser at runtime, because it races font loading. Render once,
measure from a settled frame, then paste the numbers back. Record the frame each number came
from in the handoff.

## Fonts and brand

- Bundle fonts locally (`worker/fonts/`, `design_handoff/fonts/`) under private family names.
  Renderers silently alias real system names.
- Measure the mark's real path bounding box before placing it. Supplied SVGs are often
  off-centre in their own viewBox.
- Brand values come from the brand kit / theme contract (`packages/contracts/src/themes.ts`).
  Hard-code nothing that a customer's kit would change.
- No invented results: no %, multipliers, customer names or figures that the product can't
  stand behind.

## Pacing (every VO-clocked gm skill)

A narrated film must not feel slower than a music-driven one. These gates apply to every gm skill
whose clock is a voiceover (first written for `gm-feature-explainer` 1.1; its v1 measured 28–30%
held with 2.0–2.8 s holds and a 1.2 s gap after every sentence).

- **Tight VO assembly.** 0.25–0.4 s between sentences inside an act, ≤ 0.6 s between acts.
  Configurable, never a fixed 1 s+ "breath". Kokoro at speed ~1.1.
- **J-cuts.** A scene's exit starts on (just before) the last stressed word of its outgoing line,
  so the cut happens under speech and the next scene is already moving when its line starts. A
  result that must stay on screen may hold the exit later, never past ~0.25 s into the next line.
  Verb-sync gates (±0.25 s) still apply.
- **No settled frames.** Every scene carries a camera move (push and/or parallax) from entry to
  cut; content arrives on words (one element per spoken clause), never on an even timer. Still
  no idle wobble: the motion carries the camera or information (motion-doctrine). An entrance that
  eases to rest before a slower drift reads as a hold; ease into the drift's speed.
- **Gate:** `ffmpeg -vf scale=480:-2,freezedetect=n=0.002:d=0.6` finds no hold > 0.6 s, except one
  declared stillness beat (≤ 1.0 s, the comma before a reveal), listed in the handoff. Report held %
  and the longest hold. Reference script: `gm-feature-explainer/template/tools/pacing_gate.py`
  (also gates measured VO gaps > 0.65 s and reports loudness).
- **Music is the floor.** Duck the bed only under words (≈ 6–8 dB, attack ~50 ms, release
  ~150 ms) so it fills every gap; snap cuts to the bed's beats (`hyperframes beats`) within
  ±0.15 s, else the VO wins; a transition SFX on every scene change.
- **Kinetic type.** Where a skill has feature beats, the key verb/phrase may pop as big kinetic type
  on its word (budget it per beat) — the narrated equivalent of a music film's type hits.

## Audio

- Every `<audio>` needs an `id`, or the mixer skips it and the render is silent. Confirm the
  audio stream with `ffprobe`.
- Never put `crossorigin` on `<audio>` or `<video>`.
- Land click SFX on the frame of the press, not after it.
- Master to about **-14 LUFS integrated, ≤ -2 dBTP**, measured on the final MP4 *after* AAC
  encode. The encode adds about 1 dB of peak; leave headroom in the limiter.
- Log every sound's source and licence. Generated audio (Lyria) is logged with its model, prompt
  file and cost.

## Rendering in this repo

- Use the pinned CLI only: `worker/node_modules/.bin/hyperframes` (v0.8.111).
- Never use the shared worker containers, the backend, the pg-boss queue or Postgres for skill
  builds.
- Production-equivalent render: `render <proj> --fps 30 --workers 1 --quality standard
  --no-browser-gpu`. Also time one render under `docker run --cpus=2 --memory=4g` with
  `--entrypoint node videosaas-worker:local`, because that is what the server pays for.
- Gates: `lint` clean, `check` at zero findings, snapshots of every scene, then
  `render --quality high`, then `ffprobe`.
