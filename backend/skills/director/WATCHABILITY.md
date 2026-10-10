# Watchability: correct time, correct transitions

Every gm skill must be judged against this before anything else. A film can pass `check`, hit its
loudness and still be unwatchable. This file says what "watchable" means in measurable terms.
Pacing gates live in `shared-craft.md` → Pacing; this file is the *why* and the authoring checklist.

## 1. Correct time

| Principle | Rule of thumb | How to check |
|---|---|---|
| **One clock** | Every boundary derives from one source: beat grid, VO transcript or seam ledger. Never "looks about right" | Storyboard timecodes trace to the clock file |
| **Hook in 2 seconds** | Something moves or reads in the first 0.5s; the premise is clear by ~2s | Frame at 0.5s is not blank or static |
| **Read time** | On-screen text stays fully legible for ≥ (words × 0.3s) + 0.5s, or it's a deliberate flash (≤ 0.4s, not meant to be read) | Table of every string: on-screen duration vs required |
| **No dead space** | No still hold > 0.6s; no VO gap > 0.65s; one declared stillness beat ≤ 1.0s allowed (the comma before a reveal) | `pacing_gate.py` |
| **Rhythm, not metronome** | Shot lengths vary. Establish, accelerate, hold before the climax, resolve. A flat cut rate reads as generated | Shot-length list shows a shape, not a constant |
| **Action on the word / beat** | Visual events land on their verb (±0.25s) or beat (±1 frame for music cuts) | Sync table |
| **Land the ending** | The final frame holds the CTA/lockup ≥ 1.2s while still gently moving; audio resolves on it | Last 1.5s reviewed |
| **Length fits the job** | Social sting 6–15s, launch 15–45s, explainer 30–90s. Cut content, not pace, to fit | Duration vs canvas use |

## 2. Correct transitions

| Principle | Rule |
|---|---|
| **Motivated** | Every transition is caused by something on screen or in the audio: a move continuing, an object becoming the next scene, a beat, a spoken word. No transition "because it's time" |
| **Velocity-matched** | Outgoing and incoming motion share axis and direction at the cut (seam ledger); neither side starts or ends at rest |
| **Under speech (VO films)** | J-cut: the next scene starts on the last stressed word of the outgoing line, never in silence |
| **On the beat (music films)** | Cuts land on transients, snapped to frames |
| **Carrier element** | Prefer a shape, colour field or object that travels through the cut (match-cut, push-through) over a generic wipe |
| **One idea per transition** | One primary move. No stacked spin+zoom+blur |
| **Vary the vector** | No immediate repeat of the same direction; reserve z-push for "going deeper", pull-back for "results" |
| **Never expose the frame** | No empty frames, no visible clip edges, no white flash (opaque stage ground) |
| **Sound marks it** | Whoosh/hit on every scene change, peaking on the cut |

## 4. Research-backed rules (added 2026-10-04 from SaaS-video research; sources in docs/SKILL_LIBRARY.md)

| Rule | Measure |
|---|---|
| **Hook in 3s, intro done by 5s** | Open on the viewer's pain or the outcome, with big readable text and motion in frame 1. No logo-first intros. The product is visible by 15s at the latest |
| **Works with sound off** | Every film ships with captions or kinetic key phrases that carry the message; feeds autoplay muted |
| **One brand motion personality** | Each brand kit has one motion profile (`snappy` = crisp ease-out with no overshoot, for technical brands; `smooth` = long heavy ease-out, for premium; `springy` = damped spring with small overshoot, for playful). Every scene in a film uses that profile's curves; most moves take 300–600ms; never linear |
| **A visible success moment** | Every film has at least one beat where the result *lands*: a count-up hits, a toast drops, the export completes, a card snaps into place. It's punctuated with sound |
| **Length by format** | Social ad or teaser 15–30s · launch 20–45s · explainer 45–90s (hero) up to 120s (feature page). Cut content, not pace, to fit |
| **Restraint** | Every movement has a job (guide attention, show a relationship, show cause and effect). Decoration without a job is removed |
| **Weight** | Motion says how heavy a thing is. Small controls snap (quick, one small overshoot); panels settle (controlled, about 1-3% overshoot); the camera is smooth and almost invisible; a headline arrives fast and then holds long enough to read; a mascot may be playful on purpose. One setting per class for the whole film, and nothing overshoots by default: if everything bounces, nothing feels precise |
| **One camera, one direction** | A scene has one camera, moved by one eased move per segment, with zoom changing smoothly (equal ratios take equal time). Never zoom in and then straight out; the single pull-back belongs to the end of the film. A camera that reverses a pan reads as searching |
| **Handoff, not cut** | Where one object hands a scene to the next, the same words or shape travel across (a button's label becomes the headline, then the bubble text). A colour flood out of an object takes about 0.35 s and reaches the farthest corner, or it reads as a flash |
| **Reason and state** | Each beat has an entry state, an exit state and one reason to exist. A beat nobody can justify is cut |
| **The last frame is a poster** | The final state works as a still: mark and call to action readable, nothing mid-transition |

## 5. Watchability checklist (author every skill against it)

- [ ] Can a viewer say what the film is about after 3 seconds? Is the intro over by 5s?
- [ ] Does it work muted (captions or kinetic key phrases)?
- [ ] Does every scene use the brand's one motion profile?
- [ ] Is there a visible success moment?
- [ ] Is the length right for the format?
- [ ] Is there one clear focal point per moment (one accent, one moving hero)?
- [ ] Does every scene change have a cause you can name?
- [ ] Would a viewer with sound off still follow it (key words on screen)?
- [ ] Would a viewer with eyes off still follow it (VO or music carries the story)?
- [ ] Does energy build toward the climax and then resolve?
- [ ] Does each class of object have one weight (snap, settle, smooth camera, held headline), and does only the one deliberate pull-back reverse the camera's zoom?
- [ ] Does every handoff carry a shared element, and is the last frame a poster?
- [ ] Watched once **at full speed in a player** (not only contact sheets): no moment where attention drops.

A skill's two rules must protect the film's *device*; these principles protect *watchability* and
apply to every skill on top of them.
