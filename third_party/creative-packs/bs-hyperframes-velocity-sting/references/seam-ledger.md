# The seam ledger

Every cut in this film is a promise about velocity. The ledger is that promise written down,
one row per cut, before any HTML exists.

## Shape

```json
{
  "_": "Vector ledger: one row per cut. exit/entry must agree on axis and dir. x -1 = leftward, y -1 = upward, z -1 = shrinking.",
  "fps": 30,
  "seams": [
    {
      "id": "lockup → entry surface",
      "cut": 1.333,
      "technique": "velocity-matched cut, downward",
      "exit":  { "selector": "#a-lockup", "axis": "y", "dir": 1 },
      "entry": { "selector": "#b-card",   "axis": "y", "dir": 1 }
    }
  ]
}
```

`cut` sits just below the frame time, so the incoming scene owns that frame.

## Reading it

- **axis** `x`, `y`, or `z`. `z` means scale.
- **dir** `-1` is leftward, upward, or shrinking. `+1` is rightward, downward, or growing.
- `exit` and `entry` must agree on both. Not similar — the same.

A `z` seam has two forms and they are not interchangeable. Both sides growing is a
push-through: the frame moves toward the viewer across the cut. Both sides shrinking is a
pull-back. A cut where one side grows and the other shrinks reads as a bounce off the frame
edge, which is a different effect and almost never the one wanted.

## Authoring it

Write the ledger **first**. A ledger written afterwards is a description of whatever the film
happens to do, which is the one thing it is not for.

Plan the axis sequence so it does not repeat immediately. Three upward cuts in a row is one
long upward move with two pauses in it. A useful default for a seven-slot film:

| Cut | Axis |
| --- | --- |
| A → B | downward |
| B → C | leftward |
| C → D | upward |
| D → E | rightward |
| E → F | push through (z +1) |
| F → G | pull back (z −1) |

Four directions and both z senses, with no immediate repeat.

## Verifying it

For each row, snapshot the frames either side of the cut and check three things:

1. The outgoing element has **moved** between the two frames before the cut.
2. The incoming element has moved between the two frames after it.
3. Both movements are on the named axis, in the named sign.

A settled exit is the failure this structure cannot absorb. It is invisible in a still and
completely visible at full speed — the film stops being a camera move and becomes a
slideshow for one frame, which is exactly long enough to feel.

## When you retime

Moving a frame number moves two seams: the one before the scene and the one after it. Fix
both, then re-verify both. This is why the frame plan is worth settling before the HTML
exists — a retime late in the build is not a small edit.
