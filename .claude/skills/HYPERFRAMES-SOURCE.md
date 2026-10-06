# Vendored HyperFrames skills

Source: https://github.com/heygen-com/hyperframes at tag v0.8.111 (commit cafb86a4abca32bc0b8b4fdd3de7024ca7fb8201), Apache-2.0 (see HYPERFRAMES-LICENSE).
Pinned to the same version as the worker's renderer (worker/package.json). Copied on 2026-10-02.

Installed: hyperframes hyperframes-core hyperframes-animation hyperframes-creative hyperframes-cli hyperframes-keyframes hyperframes-registry hyperframes-audio hyperframes-studio media-use product-launch-video motion-graphics

Other published skills (captions, music-to-video, talking-head-recut, pr-to-video, faceless-explainer,
slideshow, figma, general-video, remotion-to-hyperframes) are installed on demand by the /hyperframes router.

To update: re-copy skills/<name> from the new tag after bumping worker/package.json, so skills and renderer stay in step.
Telemetry from skill scripts is disabled for this project in .claude/settings.json (HYPERFRAMES_NO_TELEMETRY, DO_NOT_TRACK).

## Internal skills (added 2026-10-04)

HyperFrames' repo-internal motion skills (`.claude/skills/` in the HyperFrames repo, marked `internal: true`, excluded from default installs), copied from the same v0.8.111 tag:

- `motion-doctrine` — one continuous camera move across scenes instead of a stack of slides; includes the Seam Gate verifier (`scripts/seam-gate.mjs`, localhost only).
- `cut-the-curve` — velocity-matched scene transitions and waterfall entries.
- `seam-craft` — render correctness at cuts (white flashes, opacity dips on dark films).
- `oversized-cursor` — cursor-led motion for UI and screenshot scenes.
- `captions-overlay` — caption overlay doctrine (for voiceover captions, AUDIO-02).

Not installed: `changelog-video` (ships commercially licensed fonts — TT Norms Pro, ABC Solar Display — plus HeyGen's brand background, music, and pinned "Annie" voice; not ours to use).

Why not `npx skills add heygen-com/hyperframes --full-depth`: it installs from `main` (v0.8.119, 100 commits ahead of the renderer pinned in worker/package.json), non-interactively installs all 28 skills when an agent runs it, and would replace these pinned copies. Upgrade skills and renderer together: bump worker/package.json, re-copy from the new tag, then `npm run previews` and the brand checks.

## Our own skills (gm-*)

`gm-*` folders are Greedy Motion's own style skills, not vendored. Don't overwrite or delete them when re-copying HyperFrames skills. See `docs/SKILL_LIBRARY.md`; author new ones with `/gm-skill-authoring`.
