# Reel mechanics — cutting to the drop

The second half of this film is carried by the music. Everything here is about making that
literal rather than approximate.

## Find the grid before building anything

```bash
npx hyperframes beats assets/track.mp3
```

This writes `beats/<audio>.json` with the detected beat positions. Use it. Counting by ear
gets within about 60ms, which is two frames at 30fps, and two frames late reads as *wrong*
for the reel's entire length without the viewer being able to say why.

Then note two numbers in `STORYBOARD.md`:

- **The drop's timestamp**, to the frame.
- **The tempo**, as seconds per beat.

## Derive the cut rate

At 120 BPM, one beat is 0.5s. Pick a cut rate as a whole multiple or division of that:

| Rate | Cuts per beat | Feel |
| --- | --- | --- |
| 1.0 s | every 2 beats | Deliberate; suits big outputs that need reading |
| 0.5 s | every beat | The default. Fast enough to feel like range, slow enough to register |
| 0.25 s | twice a beat | A burst. Use for 4–8 cuts, never for a whole reel |

A reel that uses one rate throughout is easier to build and reads as mechanical. The
strongest shape is: **half-rate to establish, on-beat for the body, double-rate for the last
four cuts, then a held final frame.** That acceleration mirrors movement II's, which is what
makes the two halves feel like one film.

## Snap every cut to a frame

Convert each grid timestamp to a frame number and use *that*:

```js
const FPS = 30;
const snap = (t) => Math.round(t * FPS) / FPS;
```

A cut at 12.4133s is a cut at frame 372.4, which the renderer resolves one way and the
preview may resolve another. Snapping removes the ambiguity.

## Hard cuts only

No crossfades, no wipes, no motion blur between outputs. The music is providing the
transition; adding a visual one competes with it and softens exactly the thing that should
be sharp.

Author the cuts as zero-duration `autoAlpha` flips with **one output visible per frame** —
the same zero-overlap discipline a zoom ladder needs:

```js
tl.set(out[i], { autoAlpha: 1 }, t);
if (i > 0) tl.set(out[i - 1], { autoAlpha: 0 }, t);
```

Set each output's initial state with an explicit `tl.set(..., { autoAlpha: 0 }, 0)`. With
`immediateRender: false`, a tween that has not run yet leaves its element at the CSS
default, and if that default is visible every output is on screen from frame one.

## Keep something moving inside each cut

A held still frame between cuts reads as a slideshow no matter how well the cuts land. Each
output should be doing something small for its whole cut: a slow push-in, a value ticking, a
bar filling. It only has to survive half a second.

This is also the honest choice: these are outputs of a *video* product, and showing them as
stills argues against the thing being launched.

## The last frame

Hold the final output for at least two beats after the reel's last cut, then hard-cut to
the command. That hold is the only stillness in the second half and it is what stops the
command from feeling like a fifteenth output.

## Determinism notes

- **Snap every cut to a frame boundary**, as above.
- **Repeat every animated property in BOTH the `from` and `to` objects.** A property that
  appears only in `fromVars` has its *end* value resolved lazily from the element's current
  state; with `immediateRender: false` and a render worker seeking to arbitrary frames that
  resolves to `visibility: hidden`, and the element never appears — while a monotonic
  `snapshot` pass looks correct.
- Set `defaults: { immediateRender: false }` on each composition timeline.
- No `Math.random`. Any variation between outputs comes from the index.
- Use a finite `repeat` count; `repeat: -1` is banned outright.
- Never put `crossorigin` on `<video>` or `<audio>`; every `<audio>` needs an `id`.
- If the outputs are captured `<video>` clips: keep each flat 2D with no CSS 3D ancestor,
  give each an `id`, and never put `data-start` on both the clip and a wrapper.
