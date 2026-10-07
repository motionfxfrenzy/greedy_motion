# Motion contract — one ease family, and what is a tween

Almost everything that reads as "polish" in this piece comes from two decisions applied
without exception.

## The ease family

Two functions. One for arriving, one for leaving, and they are mirrors:

```js
const EO = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));   // arriving
const EI = (p) => (p <= 0 ? 0 : Math.pow(2, 10 * (p - 1)));  // leaving
```

Arrivals decay toward their target with a time constant of roughly 0.13s. Exits accelerate
away. Nothing overshoots, nothing is linear, nothing bounces.

Because it is one family, moves that were never individually tuned still look like they
belong. That is the actual payoff: you can add a scene without re-tuning the film.

**Pass the functions, not the names.** GSAP ships built-in eases with similar names and they
are a different polynomial. Substituting one shifts every exit by several pixels — enough to
break a matched cut, and not enough to notice while you are doing it.

```js
tl.to(el, { y: -620, duration: 0.36, ease: EI }, t);   // right
tl.to(el, { y: -620, duration: 0.36, ease: "expo.in" }, t);  // wrong, and it looks fine
```

## Tween or stamp

Anything that is a **curve** is a tween. Anything that is a **decision** is stamped frame by
frame with `tl.set(...)`.

| Thing | Which | Why |
| --- | --- | --- |
| A card sliding in | tween | It is a curve |
| A blur ramping with the move | tween | Same curve, so it peaks when the element is fastest |
| The typing rhythm | stamp | The rhythm is a decision, and it should be uneven |
| An odometer's values | stamp | The numbers are chosen, not interpolated |
| A highlight's path through a list | stamp | Which rows it passes through is a decision |

Stamped tracks are exact and seek-safe. A renderer seeking to an arbitrary frame lands on
the value that was stamped for it, with no interpolation to get wrong.

```js
// uneven on purpose: three characters land on double frames
TYPE.forEach(([f, s]) => tl.set(mail, { textContent: s }, F(f)));
```

## Uneven on purpose

Perfect regularity reads mechanical. The list rows are not evenly spaced. The typing is not
evenly timed. The odometer does not step by equal amounts. None of this is visible as
irregularity at speed — it is visible as the piece not feeling generated.

## Derived blur

Fast moves carry a blur that ramps with the **same ease as the motion**, so it peaks exactly
when the element is fastest and is gone when it stops. A constant blur on a moving element
reads as a soft render; a blur on its own curve reads as a mistake.

## The counter-bounce

A two-part mark reads as alive when the parts move against each other rather than together.
Drive one damped spring and give one part `+A` and the other `−A`:

```js
const A = 19 * Math.exp(-t / 0.279) * Math.sin((2 * Math.PI * t) / 0.5);
```

Amplitude in pixels, decay in seconds, period in seconds. On an endcard, splitting a
two-word label into two spans on a two-frame stagger of that same spring gives the label
life instead of sliding as one block.

## No idle motion

Nothing floats, breathes, or pulses to fill time. Pause on any frame and something is
mid-flight. If a beat feels empty the fix is more information, not more wobble — a floating
card is the visual equivalent of clearing your throat.

## Determinism notes

- **Repeat every animated property in BOTH the `from` and `to` objects.** A property that
  appears only in `fromVars` has its *end* value resolved lazily from the element's current
  state; with `immediateRender: false` and a render worker seeking to arbitrary frames that
  resolves to `visibility: hidden`, and the element never appears — while a monotonic
  `snapshot` pass looks correct.
- Set `defaults: { immediateRender: false }` on the timeline.
- No `Math.random`. Variation comes from stamped arrays and from the index.
- Use a finite `repeat` count; `repeat: -1` is banned outright.
- `F(n) = (n - 1) / fps`. Clip boundaries sit just **below** their frame time — `1.333`, not
  `1.3333` — or the outgoing scene owns one extra frame at every cut.
- Every `<audio>` element needs an `id` or the mixer skips it and the render is silent.
- Mark deliberate overlap and off-canvas motion with `data-layout-allow-*` so `check` does
  not flag entries and exits as layout bugs.
