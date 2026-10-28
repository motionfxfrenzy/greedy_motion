# Handoff: the doodle engine (from anidoodle to our own), and where it falls short

Written 2026-10-28 for the next session. Worktree: `../VideoSaaS-pgboss-main`, branch `feat/intelligent-director`. Everything is committed locally; **nothing is pushed**. The Docker image (`worker/Dockerfile.painted`) is stale against the latest source.

Related, longer notes: `docs/HANDOFF_PAINTED_SHORTS.md`, `docs/HANDOFF_2026-10-27.md`, `experiments/anidoodle-try/RESULTS.md`, `experiments/nullmotion-anidoodle-assessment.md` (all in the worktree / repo).

## 1. How we got here

1. **anidoodle (upstream, Apache-2.0)** was cloned into `experiments/anidoodle` (engine 0.6.4) and tried in `experiments/anidoodle-try`. Verdict: good-looking hand-drawn "plates" (31 styles), deterministic, plain Canvas 2D (no GPU needed), each film page exposes `window.FILM` (`ready`, `mount()`, `seek(frame)`, `meta`).
2. **Limit found:** every anidoodle plate is one hand-authored scene (about 300 lines). It cannot be generated from a script, and a customer film needs arbitrary places, people and props. So anidoodle is only an asset producer.
3. **First use inside our engine:** a shot kind "plate" (`place: "plate"`) lets the painted engine draw an anidoodle film into a scene (SPEC.md section "Plates"). Doodle films now never cut to a plate.
4. **The new engine:** our own doodle drawer, `worker/templates/painted/runtime/doodle.js`. `spec.style: "doodle"` draws the SAME director spec (place, time, weather, season, rooms, people, props, framing, sfx) as an animated hand drawing instead of a painted scene. 15 doodle looks so far: flat, marker, pencil, crayon, broken colour, woodcut, chalk, ballpoint, charcoal, cyanotype, sumi-e, pixel, risograph, scratchboard, engraving.

## 2. How the pipeline works (one command)

`worker/templates/painted/cli.mjs`

- `--topic "<text>"` or `--script s.txt`, `--engine gemini|claude`, `--style doodle[:marker|flat|...]` (added this session), `--width 720`, `--work dir`, `--out film.mp4`, `--spec <spec.json>` to skip directing, `--fix "<line>: <what to change>"` to rewrite one scene.
- Steps: script (optional) -> director writes the SPEC (vocabulary in `vocab.mjs`, brief in `brief.mjs`) -> supervisor fixes relationships (`supervise.mjs`) -> `lint.mjs` normalises (season, weather, indoors, one light) -> oracle (`recipe.mjs`) turns unknown places/props (`custom` + `describe`) into validated drawing recipes, with a vision check (`check.mjs`) -> Gemini voice per line, Lyria music -> `render.mjs` paints (headless Chrome, Mac GPU) and encodes.
- `llm.mjs`: one `ask()` for both brains. New: `PAINTED_TRACE=<file>` writes one JSON line per language call (engine, model, what, seconds, tokens, error).
- Frame cache is now scratch: removed when a render ends. Keep it with `PAINTED_KEEP_CACHE=1`; `PAINTED_CACHE=<dir>` picks a folder and is never removed. (It had filled the disk with about 15 GB and crashed a batch.)
- Rules from the user: **GPU renders only** (Mac GPU, no CPU/software render tests), commit locally, never push to production.

## 3. Done this session

- Seated people: thighs, knees, lower legs, feet forward of the bench, coat ends above the thighs (`doodle.js`).
- Flat style limbs: drawn as solid shapes, not outlines.
- `groundmark` prop: a sun/heart/star/circle/spiral drawn in the ground that draws itself, the drawer's stick follows the tip; a finished one stays in later shots.
- "Moments worth seeing" rule in the director brief and the supervisor: an action (drawing, lighting, planting, writing, handing over) gets its own close shot with the thing being made.
- All 15 looks rendered for the story "old man and boy on a park bench" (`var/painted-story2/final-<style>.mp4`, 7-61 MB each).
- Gemini-vs-Claude brain comparison started (`var/brain-gemini`, `var/brain-claude`, runner `var/run-brain.sh`, topic: a girl and her grandfather plant a lemon tree). Results not yet collected.

## 4. Shortcomings (what to work on next)

**Drawing quality**
- Seated people still read thin: the old man's legs are partly hidden by the bench front rail; they look a little squatted. Needs a proper seated pose (bench front lower, or legs drawn in front of it).
- Custom props (spoon, shovel, sapling, tall grass, bench) come out small and weak: the vision check rates them 4-5/10 ("tiny, under 15% of frame height, reads as a stick"). The oracle often fails its first attempt with "object ellipse exceeds its local box".
- People are generic doodle figures (build, hair, clothes, glasses, cane); no real acting beyond a few poses (stand, walk, sit, reach, point, hold, push). Faces are simple.
- Ground marks are fixed shapes only; no general "drawing with a stick" for text or free shapes.
- Dense styles (ballpoint, engraving, scratchboard) give 44-61 MB files and the slowest paint; the rest are 7-30 MB.

**Director and supervisor (the "brain")**
- The director does not reliably add the close shot for a made-thing moment; for the story I added it to the saved spec by hand and never saw the director do it unprompted.
- Gemini's supervisor output contained `undefined` as a prop kind ("undefined removed (undefined is not a valid kind)", "replace undefined bench"): 24 fixes of 27 asked, so some of its fixes were junk. Claude's supervisor asked for 1 fix.
- Verifier/lint rewrite a lot after the director (season, set dressing, "sprout is in the words but not in the picture"): the director's first spec is weak on continuity.

**Platform**
- Needs a GPU. Software GL (the Docker/Railway worker) is far too slow for oil; doodle is lighter but untested on the worker. Plan was a GPU worker (g4dn) or the Mac GPU.
- Docker image stale; rebuild is build-only (`docker build -f worker/Dockerfile.painted -t painted-shorts .` from the repo root). The comparison runs were done locally on the Mac, not in the image.
- Not integrated into the product backend/frontend; audio mix not checked by ear.
- Disk: the old caches are gone, but check `var/` before long batches.

**anidoodle specifically**
- Still unproven: authoring a new anidoodle subject for a customer brief, 9:16 crops (plates are 1080² or 16:9), audio, painter filter over a plate, Linux worker timings. Callout lettering is tidy monoline, not messy doodle.

## 5. Where things are

- Engine: `worker/templates/painted/` (`doodle.js`, `scenes.js`, `kit.js`, `layout.js`, `vocab.mjs`, `brief.mjs`, `supervise.mjs`, `lint.mjs`, `recipe.mjs`, `check.mjs`, `render.mjs`, `cli.mjs`, `llm.mjs`, tests in `test/`, 127 pass).
- Outputs: `var/painted-story2/final-*.mp4` (current), `before-legs/`, `before-fix2/` (old versions), specs in `var/painted-story2/work3/`.
- Keys: `var/painted-lh/keys.env` (ANTHROPIC_API_KEY, GEMINI_API_KEY); never print them.
- Latest commits: 997cf3a cache removal, fece743/b5ecea7 groundmark and close-shot rule, 47ee600 seated legs.
