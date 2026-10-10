# Film blueprint — three movements and a command

Durations are the reference cut at 1920x1080 / 30fps, total 28.0s. Movement III's internal
timings come from the track, not from this table.

| Movement | id | Start | Dur | Beat | Seam OUT |
| --- | --- | --- | --- | --- | --- |
| I | `prompt` | 0.0 | 3.0 | The line, alone, before any surface exists | Cut-the-curve LEFT |
| II | `chorus` | 3.0 | 7.0 | Four surfaces, the same prompt, accelerating | **The drop** |
| III | `reel` | 10.0 | 14.0 | Outputs cutting on the beat | Hard cut |
| IV | `command` | 24.0 | 4.0 | One line, and it ends | End |

The seam between II and III is the only one in the film that is not a decision: it is
wherever the drop lands. Build the film around that timestamp rather than placing it.

---

## The four copy slots

| Slot | Count | Budget | Purpose |
| --- | --- | --- | --- |
| `prompt` | 1 | ≤ 34 chars | The line typed in all four surfaces, identically |
| `surface_labels` | 4 | ≤ 14 chars each | What each surface is, by shape — "terminal", "panel", "inline", "chat" |
| `reel_captions` | 0 or 8–12 | ≤ 18 chars each | Optional: what each output is. Often better omitted |
| `command` | 1 | ≤ 40 chars | The install or invocation line the film ends on |

Slot rules:

- `prompt` has to be typeable four times inside seven seconds, which caps it at about 34
  characters. Shorter is better: the audience has to recognise it, not read it.
- `surface_labels` name **shapes**, not products. This is a design decision and a rights one
  at the same time.
- `reel_captions` are usually a mistake. At the reel's cut rate nobody reads them, and their
  presence tells the audience they were supposed to. Omit unless the outputs are genuinely
  ambiguous.

---

## Movement I — the prompt

The line alone on the ground, at display size, with no interface around it. Three seconds is
long enough to read it twice, which is exactly what the chorus is about to require.

No cursor, no window, no chrome. The film has not introduced surfaces yet, and introducing
one here would make the first chorus entry a repetition rather than a first.

## Movement II — the chorus

Four surfaces, one after another, **accelerating**:

| Entry | Surface shape | Typing | Duration |
| --- | --- | --- | --- |
| 1 | Full-bleed terminal | Types in full, ~26 chars/sec | ~2.6s |
| 2 | Docked panel | Types faster, ~40 chars/sec | ~1.8s |
| 3 | Inline field in a document | Half-typed, then complete | ~1.4s |
| 4 | Floating composer | Appears complete, one frame | ~1.2s |

The acceleration is the device. By the fourth entry the audience is not reading the prompt —
they are recognising it, and recognition is what turns four demonstrations into one claim.

**Declare the prompt string once in code** and have all four surfaces read it. If it lives
in four places it will eventually differ in one, and that difference is the only thing a
viewer will remember.

The surfaces must read as different in half a second, which means they differ in **shape**:
where the input sits, how much chrome surrounds it, whether it is full-bleed or floating.
They must not differ by borrowed identity — see the rights rule in `SKILL.md`.

## Movement III — the reel

See `reel-mechanics.md`. In summary: the drop lands, and from that frame the film cuts on
the beat until the reel is done.

## Movement IV — the command

One line, in mono, on the ground. It types or it appears — either is fine, and appearing is
often better after fourteen seconds of cutting.

Then stillness. Do not add a lockup animation after the command; the command is the last
thing the audience should be looking at, because it is the only thing they can act on.

---

## Audio

| Layer | Level | Notes |
| --- | --- | --- |
| Music | 0.55–0.7 | The loudest music in this family. It is structural here, not a bed. |
| Typing | ~0.22 | Movement II only, and only on entries 1 and 2 |
| Reel hits | ~0.18 | Optional, one per cut. Often unnecessary — the music already marks them |
| Command confirm | ~0.24 | One sound, on the last frame the command lands |

The music being loud is a deliberate departure from the rest of this family. In the other
films the bed supports the picture; here the drop *causes* the second half, and mixing it
like a bed makes the transition read as a cut that happened to have music under it.

Every `<audio>` element needs an `id` or the mixer skips it and the render is silent.

There is no voiceover. Nothing could be said over the reel that would survive the cut rate.
