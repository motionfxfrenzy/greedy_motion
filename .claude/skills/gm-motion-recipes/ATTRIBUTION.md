# Attribution

The three recipes in this skill are **technique references from video-shotcraft**, rewritten from scratch for
HyperFrames and GSAP.

- Source: https://github.com/Vincentwei1021/video-shotcraft, Apache-2.0, read on 2026-10-08.
- Cards used: `references/shots/effects/line-boil.md`, `references/shots/effects/glow-flyline-moves.md`,
  `references/shots/data/scroll-brake-moves.md`, plus the parameters in their reference demos
  (`LineBoil.tsx`, `FlylineArc.tsx` and `OrbFlylineRelay.tsx`, `ChangelogScrollBrake.tsx` and `BrakeReticleLock.tsx`).
- What we took: the ideas, the structure of each effect, and starting numbers (frame counts, scale, caps,
  opacities). What we did not take: any source code. The upstream demos are Remotion/React; ours are plain
  HTML + GSAP written for this repo, using different mechanisms where the platform differs (SVG dash windows with
  `pathLength` instead of per-segment polylines, baked per-frame `fromTo` steps instead of per-frame React state).
- The upstream cards credit their own references. Those credits are theirs; we did not review the originals.
- Apache-2.0 asks derivative works to keep the licence and notices. Because nothing here is copied code, we keep
  this note instead of a NOTICE file. If any future recipe copies upstream code or text, add the Apache-2.0 text,
  mark the file as modified, and carry any upstream notice.
- Upstream states its parameters were tuned on placeholder assets, not on shipped work. Treat every number here
  as a starting point and retune it on real content.

Not used from that repo: its audio files (the repo itself flags six sound effects as unknown provenance), its
Remotion template and components, and its "hold lockups at least 1 s, always slow down" rules, which contradict
our pacing standard.


## camera-rig, spring-settle, flood-handoff (added 2026-10-09)

These three come from ideas in two public X posts read on 2026-10-09: a prompt for a one-take product film (one camera
container keyed by `[time, zoom, x, y]` with zoom interpolated in log space, closed-form springs, a colour flood that
carries a copy of the words, flood timing and z-index gotchas) and an article on running a code-rendered video studio
(motion weight classes: micro UI, panels, camera, headlines, mascot). We took ideas and numbers only; no code or prose was
copied, and the implementations are plain HTML + GSAP written for this repo. Neither source carries a licence; both are
ideas, not text we redistribute.
