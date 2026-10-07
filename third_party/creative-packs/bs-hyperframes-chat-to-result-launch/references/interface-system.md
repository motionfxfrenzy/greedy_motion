# Interface system

The film is set inside software, so the interface **is** the art direction. One stylesheet
owns every token; scenes read `var(--…)` and never hard-code a value.

## The monochrome rule

The entire interface is greyscale. The only color anywhere in the film is the accent pair
inside your product's mark and the progress details attached to it. That is what makes the
moment the toggle flips read as an event rather than as decoration.

Do not add a "brand color" to buttons, links, highlights, focus rings, or the send
control. If your identity is loud, this is the film that makes it land by using it once.

## Palette roles

| Role | Token | What it is | Reference value |
| --- | --- | --- | --- |
| Canvas | `--canvas` | The app ground. Near-black, never `#000` | `#030404` |
| Chrome | `--chrome` | Sidebar and app frame | `#070807` |
| Panel | `--panel` | Composer, menus, cards | `#171717` |
| Panel elevated | `--panel-up` | Hover rows, raised menu surfaces | `#202020` |
| Panel pressed | `--panel-down` | Selected rows, pressed buttons | `#303030` |
| Ink | `--ink` | Primary text, and active control fills | `#F4F4F0` |
| Muted | `--muted` | Secondary text | `#A7A7A2` |
| Quiet | `--quiet` | Tertiary labels, disabled controls | `#74746F` |
| Border | `--border` | Visible hairlines | `#2B2B2B` |
| Border soft | `--border-soft` | Low-emphasis dividers | `#252525` |
| On-ink | `--on-ink` | Text and icons sitting on an ink-filled control | `#030404` |
| Mark A | `--mark-a` | Your product's first accent — mark only | `#06E3FA` |
| Mark B | `--mark-b` | Your product's second accent — mark only | `#4FDB5E` |

Never use pure black for the canvas. Pure black kills the panel elevations, and every
surface in this film is defined by the step between elevations rather than by borders.

## Type

Three ramps with distinct jobs. Two would flatten the film; four would fracture it.

| Ramp | Token | Job | Reference family |
| --- | --- | --- | --- |
| UI | `--f-ui` | Chrome, composer, menus, buttons, the count-up | A humanist grotesk, 400–700 |
| Editorial | `--f-serif` | The streamed answer prose, and only that | A reading serif, 500 |
| Mono | `--f-mono` | Tool pills, metadata, code-like labels | A geometric mono, 500–600 |

Video-native sizes, not web sizes:

- Major on-screen text: 60px and up.
- Readable body and answer prose: 30–34px.
- Labels, pills, metadata: 18–22px.
- The count-up headline: 180–240px, tabular figures so digits do not jitter as they climb.

Keep the interface compact but not web-sized. A real app screenshot scaled to 1920 is
illegible in video; this system is a real app redrawn at video scale.

## Components

### Composer

```css
.composer {
  background: var(--panel);
  border: 1px solid var(--border-soft);
  border-radius: 2.4cqw;
  color: var(--ink);
}
.composer .placeholder { color: var(--muted); }
```

A large rounded pill or card with a circular send control. The send is ink-filled with an
`--on-ink` icon when active.

### Menu

A dark panel, never a light popover. `--panel-up` on hover rows, `--panel-down` on the
selected row, `--border` as the divider. Rows are 64–76px tall so the cursor travel
between them reads at video speed.

### Toggle

Off: `--panel-down` track, `--quiet` knob. On: `--ink` track, `--canvas` knob. Animate the
knob's x and the track's background together over ~180ms on `power2.out`, and land the
click SFX on the first frame of the tween.

### Tool pill

A mono chip on `--panel-up` with a `--border` hairline. This is where your product's name
appears inside the answer, and it is the second time the film shows the accent pair.

### Output card

The card the checklist becomes. `--panel` fill, `--border` hairline, generous radius, and
a header row with the mark, a title, and a mono metadata line.

## Motion tokens

| Intent | Duration | Ease |
| --- | --- | --- |
| Cursor travel between menu rows | 0.32s | `power2.inOut` |
| Cursor travel across the frame | 0.55s | `power2.inOut` |
| Cursor press / release | 0.08s / 0.14s | `power2.in` / `back.out(1.5)` |
| Menu open | 0.28s | `power3.out` |
| Menu compress away | 0.22s | `power3.in` |
| Toggle flip | 0.18s | `power2.out` |
| Typing reveal | length-derived | `none` |
| Answer line stream-in | 0.30s, 0.28s apart | `power2.out` |
| Checklist row cross-off | 0.30s, 0.55s apart | `power2.inOut` |
| List-to-card morph | 0.60s | `expo.out` |
| Count-up | 1.60s | `power2.out` |
| Outro rise | 0.55s | `expo.out` |

Banned: `bounce.out`, `elastic.out`, and any idle sine loop used to fill time. The
thinking beat's shimmer is the single exception and it carries a finite repeat count.

## Determinism notes

- **The count-up must be tweened, not ticked.** Tween a plain object's value and write the
  formatted string in `onUpdate`. A `setInterval` or a `Date.now()` delta is not seekable,
  and the render will not match the preview.
- **Typing must be a width or clip tween**, not a per-frame substring. Same reason.
- Use a finite `repeat` count everywhere; `repeat: -1` is banned outright.
- `fromTo` tweens default to `immediateRender: true`, which stamps their start state at
  build time and can leave elements visible from frame 0. Set
  `defaults: { immediateRender: false }` on each composition timeline.
- **Repeat every animated property in BOTH the `from` and `to` objects.** A property that
  appears only in `fromVars` has its *end* value resolved lazily, from the element's state
  at the moment the tween first renders. Combined with `immediateRender: false` and a
  render worker seeking to arbitrary frames, that end value resolves to the element's CSS
  `visibility: hidden` — so `fromTo(el, {x: 900, autoAlpha: 1}, {x: 0})` animates the
  element from visible straight back to invisible and it never appears in the render.
  A monotonic `snapshot` pass resolves it differently and looks fine, which is exactly what
  makes this one expensive: it passes every gate and every contact sheet, and only the
  final multi-worker render is wrong. Write `{x: 0, autoAlpha: 1, ...}` instead.
- Never pair a CSS initial `transform` with a GSAP tween on the same property.
- Never put `crossorigin` on `<video>` or `<audio>`.
- Give the assembled root an opaque background, or every seam's opacity dip composites
  over white and flashes — brutal on a near-black film.
- Tabular figures on the count-up. Proportional digits change width as they climb and the
  headline visibly wobbles.
