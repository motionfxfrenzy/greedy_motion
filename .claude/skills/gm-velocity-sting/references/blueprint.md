# Blueprint: velocity sting

Canvas 1080×1080, 30 fps, 358 frames (11.933 s). `F(n) = (n − 1) / 30`. Scene windows switch just
**below** each frame time (`1.333`, not `1.3333`) so the incoming scene owns that frame.

## Frame plan

| Slot | Frames | Window (s) | What moves (route that owns the time) |
|---|---|---|---|
| A | f1–f40 | 0 → 1.333 | Lockup arrives at scale 0.9 → 1 (EO 0.6 s); counter-bounce: mark +A, wordmark −A, A = 19·e^(−t/0.279)·sin(2πt/0.5) |
| B | f41–f79 | 1.333 → 2.633 | Card enters on the seam; rows arrive at +0.14…+0.71 s with shrinking gaps (EO, 40 px); field takes focus at f74 |
| C | f80–f124 | 2.633 → 4.133 | Same card ~2× closer; the typed value is stamped between f84 and f104 on a fixed uneven pattern (same value → same rhythm; some frames land two characters); button press at f112 ignites the exit |
| D | f125–f169 | 4.133 → 5.633 | Odometer: 32 stamped values f125–f156, eased toward the target with small fixed jitter, monotonic, last = target; bar follows; step 2 ticks at f158, step 3 activates at f160 |
| E | f170–f226 | 5.633 → 7.533 | Rows slide in from −(own width + 24 px) (xPercent), pre-rolled so they are mid-slide on f170; the highlight climbs bottom → first row, stamped at f186/189/192/196/199/202 (last N used); footer arrives f204; chosen-row press f209 |
| F | f227–f319 | 7.533 → 10.633 | Cursor enters from below f234, tip on the create button f252, click f256: the menu opens off the button's corner the same frame; rows f256–f260; page nudge f262 (EI 0.12 s → EO 0.6 s, −300 px); cursor to row 2 f266, hover f279, click f286 (chosen: radio ✓ + accent border); cursor leaves f290; "needs" line f295 |
| G | f320–f358 | 10.633 → 11.933 | Pull-back arrival; counter-bounce on mark / word 1 / word 2 (2-frame stagger); closing line f332 |

## Seams (`ledger.json`)

| Cut | Frames | Axis | Exit → entry |
|---|---|---|---|
| A → B | f40 / f41 | y +1 (down) | 160 px each side, EI/EO 0.36 s, blur 10 px |
| B → C | f79 / f80 | x −1 (left) | same |
| C → D | f124 / f125 | y −1 (up) | same |
| D → E | f169 / f170 | x +1 (right) | same |
| E → F | f226 / f227 | z +1 (push) | scale 1 → 1.25 / 0.8 → 1, blur 18 px |
| F → G | f319 / f320 | z −1 (pull) | scale 1 → 0.8 / 1.25 → 1, blur 18 px |

Four directions and both z senses, no immediate repeat. Exits end on the last outgoing frame
(`start = F(cut) − 1/30 − 0.36`).

## Copy budgets

`slots.json` is the source of truth. Highlights: wordmark ≤ 12 per part; surface title ≤ 16;
field label ≤ 14; typed value ≤ 22; number label ≤ 20; nav rows 3–5 × ≤ 14 (+ optional extra
row); create button ≤ 16; menu rows exactly 4 × (name ≤ 18, meta ≤ 14); closing line ≤ 34.

## Other canvases (not built)

9:16 stacks the card and the nav and gives the lockup more room; 16:9 lays the nav out as a
row. Both are a re-layout with a new frame plan check, not a scale.
