# Persistent objects and support relationships

The director describes physical relationships, and the engine resolves their geometry. A scene is still a place, weather, people and props; it can now reference reusable story objects. This applies to known vocabulary and custom oracle drawings alike.

```json
{
  "objects": {
    "ledge": {"kind":"rock","x":0.6,"w":0.55,"h":0.18},
    "home": {"kind":"house","on":"ledge","w":0.2,"h":0.2},
    "table": {"kind":"table","x":0.4,"w":0.4,"h":0.16},
    "instrument": {"kind":"custom","describe":"brass telescope on a wooden cradle","on":"table","w":0.22,"h":0.1}
  },
  "lines": [{"say":"The house stood on the ledge.","shots":[{"place":"sea","time":"day","props":[{"id":"home"}]}]}]
}
```

- `objects`: canonical definitions keyed by stable IDs. Inline prop definitions with IDs also become reusable. A shot's fields override its view, without changing the canonical definition. Reuse IDs across shots; use different IDs for different objects, even of the same kind.
- `on`: a support object ID. Missing supports are restored recursively; supports paint before their children. `on: null` detaches an object for that shot. Unknown references, duplicate IDs within a shot, and cycles fail explicitly. The engine does not guess arbitrary relationships from English regexes: the director declares them.
- `offset`: fraction of the support's usable width, clamped to -0.5..0.5. Attached objects ignore their independent `x`; changing the support's `x` moves the assembly. Camera movement transforms the whole scene.
- `surface`: `{x,y,w}` in an object's local 0..1 box. Rock and table have native surfaces. Give any custom support a surface (shelf, pedestal, platform, bridge deck); the oracle is instructed to draw a level surface there. `subjects[].on` and `offset` place people on it as well.
- `w` and `h`: fractions of frame width and height. Custom objects, rocks and tables honor both; other native vocabulary pieces retain their drawing-specific dimensions. Choose sizes that fit the support. No automatic collision solver or physical simulation is implied.

## Pipeline

`scene-graph.mjs` expands canonical definitions before `lint.mjs` runs. `runtime/layout.js` is a pure shared solver, used in both browser rendering and Node call-contract tests. The painter draws its dependency order and places children at their parent's surface.

Supported structures in water no longer trigger the legacy full-width ground strip. A reusable faceted rock has a broad crown, colored planes and broken edges. Explicit tables suppress duplicate workshop furniture; a table with an attached object suppresses automatic bread unless `bread:true` is explicit. Autumn leaves are restricted to vegetation environments.

The oracle's new object contract is `{"space":"object","layers":[...]}`. Coordinates fill a local unit box with base centre `(0.5,1)`. The renderer translates and scales the recipe. Local objects use primitive shapes, never frame-wide scenery operations. Geometry, colors, minimum layer count and material tones are checked; validation feedback is included in the retry. These checks are structural, not an automated visual quality judgment. Cache keys have a new version and include the requested support surface; cache reads are revalidated. Failed required custom objects stop generation rather than disappearing silently.

Existing unlinked specs still render, including old full-frame recipes. Run them through `cli.mjs --spec` to regenerate custom recipes in local coordinates; add IDs and relationships or regenerate direction to gain continuity. Direct rendering of an attached legacy recipe fails with instructions to regenerate it. A scene drawing error now fails the render instead of exporting a red error frame as a success. Mac rendering refuses a reported software renderer.

## Verification and fixtures

Run `node --test test/` (43 tests as of this change). These are logic/call-contract tests; no software render tests. For the native regression sheet, on the Mac GPU:

```sh
PAINTED_ANGLE=metal node render.mjs test/fixtures/spatial-scenes.json x --sheet /tmp/painted-spatial-sheet --width 540
```

The fixture checks a lighthouse across day/night/storm/dawn, a jar on a table, and a house on a cliff. Tests also cover nested custom supports, people on supports, detached objects, separate objects of the same kind, missing/cyclic references, local recipe transforms and legacy behavior. A live director/oracle check generated ten shots from a lighthouse/workshop script; the director retained the island relationship and Gemini supplied a reusable telescope recipe. Review sheets and the generated spec are saved under the worktree's ignored `var/painted-scene-graph/` directory.

Remaining scope: arbitrary `inside`, `behind`, occlusion, collisions, persistent character identity, and automatic visual critique are not implemented by this support graph. Camera framing can still crop a tall structure when it follows a small person; the graph fixes contact/continuity, not all composition decisions.


## Physical scale follow-up

`runtime/layout.js` now projects approximate metre dimensions through one shared camera. Known objects use `DIMENSIONS`, also included in the director brief. Custom objects accept `dimensions:{height,width}`; people accept `heightM` (adult default 1.7) or `age:"child"` (1.1). `depth:0..1` controls perspective and floor position, and attachments inherit the support depth. `framing:"wide"|"medium"|"close"` changes the whole scene. Legacy independent person size and native prop w/h no longer determine physical proportions; attached legacy custom assets retain their size ratio to the corrected support.

The table default is 0.78 metres, so it cannot become taller than a standard adult because of unrelated frame fractions. Explicit dimensions support miniatures and unusual objects. Child footprints are constrained to the usable surface. Framing accounts for the complete group and limits vertical lifting so a small person does not cause a tall structure to be cropped. Physical defaults are approximate art direction; depth is not a full occlusion or physics simulation.

Validation: 53 passing logic/call-contract tests, including the reported person/table mismatch, framing ratios, children, depth, custom dimensions, attachment fit and tower framing. The original ten-shot spec was re-rendered unchanged on Apple M1 Pro / ANGLE Metal. Updated review artifacts are in `var/painted-scale/`.


## Story contract (2026-10-28)

Recurring IDs now lock kind, description, dimensions, surface, style, color and shape to their story definition (or first inline definition). Character `who` IDs retain their first specified physical appearance and height; poses and positions remain shot-local. Use a new character ID for a deliberate costume/age change for now.

- Shot `required: ["object-id"]` restores visible required objects and their support chains. Unknown IDs fail before asset generation. This is an explicit contract, not automatic understanding of narration.
- Shot `changes: {"object-id": {"on": null, "describe": "a blue laptop"}}` advances state for that and later shots, including after absences. Physical dimensions, surface, style, color, shape, kind, offset, lit, open, finished and done can also change. A changed description invalidates an attached recipe. Only fields understood by the renderer alter the drawing.
- Line `detail: {"object": "object-id", "shot": 0}` inserts a close shot after the source, retaining narration and requiring the result object. Reserve one of the three slots. Normalization is idempotent. The doodle camera frames `detailOf` around the actual object without changing physical proportions; zoom is bounded at 6x. This shows an action result, not arbitrary articulated hand animation.
- Missing/undefined object kinds are rejected rather than sent to the oracle as descriptions.

Validation: 134 logic tests; three-shot 540px Apple M1 Pro Metal contact sheet at `var/story-contract/sheet/sheet.jpg`. The fixture deliberately asks for a ten-times-larger boat on its return; the engine restores its defined size and table. Cached artwork, no new model calls. This checks deterministic continuity, not director compliance on new scripts. Existing seated poses, generic acting and background artistry still need further work.

## Explicit interactions (2026-10-28)

A reusable prop can declare `tether: {who: "boy_1", hand: "right"}`. Doodle rendering connects that object's anchor to that person's animated hand; left is also supported. It no longer guesses the holder from the first hold pose. The holder must exist in the shot or validation fails. `changes: {toy: {tether: null}}` releases it persistently. The relationship works for arbitrary drawn props; it is currently implemented in the doodle renderer, not the oil renderer. `facing: "back"` gives a rear view, retaining the same person identity. Captions prefer to avoid the interaction band.

One real Gemini Argon director call generated the man/boy/puddle/string example in `var/puddle-relations/spec.raw.json`; no manual position or relationship corrections. The preview reuses a cached toy-boat recipe and has no generated voiceover. Two shots were inspected on Apple M1 Pro Metal. Regression tests cover named ownership, release and relocated dressing normalization (137 tests total). This validates one generated scene, not every possible interaction or camera viewpoint.

## View direction and dramatic coverage (2026-10-28)

Doodle characters now support `facing: left|right` using reusable head geometry generated by Gemini Argon (one eye, nose silhouette, ear, hair and optional beard), with narrower torsos, forward-pointing feet and holding hands. Palette, age, hair and identity remain the same. This is procedural profile artwork, not a separate image pasted over a character.

Subject `lookAt: "object-id"` resolves through supports: a lateral target selects left/right; an aligned target at greater depth selects back. For an intentional rear composition, put the people in the foreground and the object ahead, visible between them. Direction is a coarse screen/depth rule, not a 3D orbit camera.

Shot `portraitOf: "person-id"` frames that character's head and upper torso; invalid IDs fail before rendering. The brief now asks for narrative-purpose shot choices and `intent`: establishing wide, interaction medium, reaction or important dialogue close-up, action detail. A close-up does not provide lip sync.

Gemini generated a three-shot acceptance example in `var/puddle-profile/spec.raw.json`: rear staging, side profiles, and the boy's promise close-up. GPU contact sheet: `var/puddle-profile/sheet/sheet.jpg`. Cached toy artwork; no new voiceover. 140 logic tests pass. Profiles and portrait framing currently apply to doodle rendering.

## Visual craft and autonomous staging verification (2026-10-28)

`runtime/doodle.js` now draws scenes with 10-band smooth sky gradients, fair-weather drifted clouds, multi-ridge distant hills, hedgerow bushes, rolling foreground grass contours, depth-scaled wildflowers, contact cast shadows (`cast`), inner volumetric form shading (`shade`), zoom-adaptive stroke/jitter scaling for `detailOf`/`portraitOf` close-ups, and multi-plane vocabulary props (`tree`, `rock`, `house`, `lamp`, `pond`, `table`, `jar`). Airborne custom objects (`kite`, `balloon`) float in the sky rather than sitting on the ground, and native support surfaces (`table`, `pond`, `rock`) cannot be overwritten by supervisor fixes. A close shot of a single character defaults to `portraitOf` when not an object detail shot.

A fresh three-line script (`var/kite-autonomous/script.txt`) was directed by Gemini without prescribing camera shots in the user prompt. It independently produced four shots (`var/kite-autonomous/spec.json`, `var/kite-autonomous/sheet/sheet.jpg`): wide rear staging watching the tethered kite, medium side interaction beside the table, an inserted object close-up (`detailOf: "jar_1"`) as the jar is placed on the table, and a close portrait of the smiling girl (`portraitOf: "girl_1"`). 142 logic tests pass.
