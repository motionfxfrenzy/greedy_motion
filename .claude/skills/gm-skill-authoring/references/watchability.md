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
| **Legible size** | Text meant to be read is ≥ 5.2% (captions) / 3.0% (everything else) of the shorter canvas edge, on final pixels, for ≥ 0.4s. Faux-UI texture is declared `decorative` | `text_size_gate.mjs` (shared-craft.md → Legibility) | <!-- director:skip-line -->
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

<!-- director:skip -->
## 4b. House aesthetic rules (added 2026-10-08)

Distilled from the revision history of the video-shotcraft project (Apache-2.0; see docs/SKILL_LIBRARY.md),
rewritten for our stack. Each one is a defect we would otherwise ship. Violate one on purpose only when the
style needs it, and write the reason into the handoff.

| Rule | Measure |
|---|---|
| **Impact budget.** A beat hit that moves the whole frame or the camera layer (a whole-frame scale pump, shake, flash or negative frame) is a slam: at most **3 per film**, each on one of the track's strongest hits, at least 16 beats apart. Every other beat accent moves element layers only. A strong kick lands on almost every beat, so pumping the camera on each one reads as the film shaking | List the slams with frame numbers in the handoff. Play 8 consecutive beats of the busiest section frame by frame: no per-beat full-frame pulse |
| **No handheld shake on light-ground UI films.** Product-UI promos on a light ground carry no camera shake or noise. A dark atmospheric film may use camera noise only deliberately, at an amplitude the eye barely registers | Step through rendered frames: no jitter that has no narrative cause. Complements the ban on idle wobble (motion-doctrine) |
| **Highlight budget.** No per-element glints. At most one glint or sweep per shot, on that shot's hero element, clipped to the element's rounded edge (`overflow: hidden` plus the same `border-radius`). A sweep that spills past a rounded corner is the cheapest tell | Count glint/sweep tweens per shot; every one has a clip |

Not adopted from that project: "hold brand lockups at least 1 s" and "always slow down". They contradict the
pacing standard (no still hold > 0.6s). The declared stillness beat (≤ 1.0 s) and the ≥ 1.2 s final hold that
keeps moving already cover the lockup case.
<!-- /director:skip -->

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
- [ ] Is all text meant to be read at or above its size floor, and is every `decorative` subtree declared? <!-- director:skip-line -->
- [ ] At most 3 whole-frame/camera slams, no shake on a light UI film, at most one clipped glint per shot (§4b)? <!-- director:skip-line -->
- [ ] Does each class of object have one weight (snap, settle, smooth camera, held headline), and does only the one deliberate pull-back reverse the camera's zoom?
- [ ] Does every handoff carry a shared element, and is the last frame a poster?
- [ ] Is the film's story shown at each aspect as its own composition, never a crop of the wide one? <!-- director:skip-line -->
- [ ] Watched once **at full speed in a player** (not only contact sheets): no moment where attention drops.

A skill's two rules must protect the film's *device*; these principles protect *watchability* and
apply to every skill on top of them.
