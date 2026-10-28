# Painted short spec

The vocabulary (places, times, weather, poses, props, rooms, house styles, sound accents) lives in `vocab.mjs`: one source of truth.
`brief.mjs` generates the director's brief from it, `lint.mjs` checks specs against it, and `test/vocab.test.mjs` fails when `runtime/` (the drawing code) disagrees with it.

Things the vocabulary lacks: the director writes `place: "custom"` or a prop `kind: "custom"` with a `describe` text; `recipe.mjs` asks Gemini to turn it into a validated drawing recipe (cached in `<work>/recipes`, stored in the spec).

## People

Every subject is somebody from the people library (`people/people.json`): six groups (boy, girl, young_man, young_woman, old_man, old_woman) of five people each, with hair style and colour, skin, clothes, dress, build and height. `"who"` takes a person id (`old_man_3`) or a group (`old_man`); the same id in every shot keeps the same character. When `who` is missing the rule layer (`people.mjs`, `castSubjects`) infers the group from the words, keeps one character the same across the film, and gives a crowd different people. The director's own `#rrggbb` colours win over the library; words never do.

The library is made from Gemini: `node people/make-sheets.mjs` paints one character sheet per group (`people/sheets/`), `node people/read-sheets.mjs` reads the sheets back into `people.json`. Re-run both to refresh it.

## Personality and how people are drawn

- `mood` (neutral, smile, laugh, skeptical, worried, surprised, sad) is drawn on the face; a person with a mood faces us. Gesture poses: cross (arms folded), point, shrug, hip, plus cheer, wave. When the director gives none, the rule layer reads them from the line's words (a crowd that gossips folds its arms and points; a thankful one smiles and cheers; a named feeling such as "smiled" beats a judging word inside a quote).
- The library's glasses, hats, canes and scarves are drawn.
- `people`: `"lit"` (default: own colours dimmed by the hour, a rim of the hour's light, faces) or `"silhouette"` (black cut-outs against a night or dawn sky). Set for the whole film with `--people silhouette` (or `spec.people`), per shot with `shot.people`, per person with `"silhouette": true|false`.

## Live preview (edit in the browser, no video)

`node preview.mjs work/spec.json` builds the timeline and mixed sound (`render.mjs --preview`, about 6 s) and serves a player at `http://localhost:8765/index.html?preview=/p/preview.json`. The page draws every frame itself with the same painter as the MP4 (full oil at about 100 drawings/s at 540 wide on the Mac GPU; the film needs 12), with the mixed sound as the clock. Space plays and pauses, the bar scrubs, "draft" skips the paint pass, "loop shot" repeats a shot. The server watches the spec: edit it (by hand, or with `cli.mjs --fix`) and the open page rebuilds and reloads at the same moment. A shot can hold up to 6 people.

## Plates (anidoodle films as a shot)

`{"place":"plate","plate":"koiDraw","fit":"cover"|"contain","focus":[x,y],"from":0,"to":539,"loop":false,"plateLook":"plate"|"oil"|...}`. The film (an anidoodle page, `window.FILM`) sits in a hidden same-origin iframe; shot progress maps onto frames from..to (held on the last), the canvas is drawn into the scene (`runtime/plates.js`: `plateFrame`, `fitRect`, both tested). Default look `plate` = no brush pass; any engine look paints over it. `plates.json` (from `node make-plates.mjs`) is the manifest; films are served from `ANIDOODLE_DIST` (default `experiments/anidoodle-try/dist`) at `/plates/`. A film with plates is rendered over a local HTTP server (`serve.mjs`), because Chrome blocks iframe access between file:// pages. Unknown plate -> nearest painted place (lint). Plate audio is ignored. `audio:{seconds:N}` lines need no voice (cli.mjs skips TTS for them).

## Doodle style (a second rendering layer)

`spec.style: "doodle"` draws the SAME director spec (places, times, weather, season, rooms, people, props, framing, sfx) as an animated doodle instead of a painted scene (`runtime/doodle.js`): flat fills laid in passes, an ink contour that grows along each edge and re-wobbles every third frame, scenery then props then people; a scene that carries over from the shot before is not drawn in again. Positions come from `PaintedLayout.compose`, palettes from the painter's TIMES and WEATHER tables, voice, sfx and music from the same mixer. `spec.doodle` picks the medium: `marker` (default), `flat`, `crayon`, `pencil`, `woodcut`, `chalk`. No brush pass runs. The director and rule layer are unchanged; only the rendering layer is chosen.


## Drawing in (doodle films): one continuous scene, or a fresh drawing at every transition

`spec.drawIn` (a checkbox in the player, `--draw continuous|each` on the command line; a product UI sets the same field):

- `"opening"` (default, checkbox **continuous scene** ticked): the film is one continuous scene. Only the opening shot draws itself in from blank paper; every later shot is complete from its first frame.
- `"each"` (checkbox cleared): every shot draws itself in again at every transition.
- `"all"`: every NEW scene (a change of place, time, weather, season or room) draws in; a shot that continues the previous scene does not.
- `"none"`: nothing draws in.
