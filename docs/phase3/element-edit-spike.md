# Spike: element-level comments on HyperFrames films (2026-11-05)

Question: can a timed comment such as "make *share.* pink and bigger" correct one element of a HyperFrames scene, in the live preview and in the final render, the way plates are planned to? Method: the real beat-plan template (`worker/templates/beat-plan/index.html`, its built-in sample plan of 3 beats) plus the HyperFrames runtime, run in headless Chrome 156 on this Mac; scripts in `tools/spike-hf-elements/` (they use scratch paths; read them as method, not as tests). No repo code was changed.

## What was measured

1. **The composition builds and seeks in plain Chrome.** Timeline `main`, 7.6 s, three beats. Seeking is deterministic: the same time gives the same frame (a seek away and back changed 2 pixels by 1 level out of 2 million, which is rounding noise).
2. **Which elements are on screen at time T can be listed.** Walking `#stage` and `#captions` at t = 1.0, 3.2 and 6.4 s gave, per element: tag, classes, text, bounding box and effective opacity. Words are `span.w` (the accent word is `.w.acc`), kinetic letters `span.ch`, plus `.name`, `.pill`, decorative `.field`/`.halo`. At 3.2 s the list was exactly "Ready", "to", "share." plus two background discs.
3. **There are no stable element ids today.** `id` is null and the only data attributes are layout flags. A durable reference needs stamping. All element creation goes through one helper, `mk()` in `engine.js` (88 call sites, 9 `createElement` in total), so stamping `data-el` ids from (beat id, class, order within the beat) is one central change. The engine is deterministic, so ids are stable between preview and render.
4. **Overrides can be applied without fighting the animation.** Applied by a stylesheet on the stamped element at t = 3.2 s:
   - **Colour:** changes only that word (36 k pixels, bounding box = the word). Clean.
   - **Position** (CSS `translate`) and **scale** (CSS `scale`, with `!important` because the animation writes inline styles): visible and local, and the frame is identical after seeking away and back, so they compose with the GSAP transform. Without `!important` they had no effect.
   - **Size by `font-size` (1.3em):** changes 120 k pixels over a block wider than the word (bbox 138..931 x 434..826): the whole line reflows.
   - **Size by `scale`:** the word grows in place but **overlaps its neighbours** (seen in the screenshot: "share." covers "to"), because the engine lays out from character counts and never re-measures.
   - **Removing an override restores the original frame** (2 pixels, 1 level).
5. **There is already an edit channel shared by preview and render.** The template carries `<script id="hf-variables">`; `backend/src/plan/composition.ts` (`fillTextBlock`) writes per-beat text edits (`<beatId>.keyword|on_screen|line`) into it for the render project, and `backend/src/plan/preview.ts` merges the live edits for the preview. An `overrides` object in the same block would reach both paths with no new transport.

## Not measured (do not treat as known)
- A real final render of an override (the render path reads the same block by code inspection; I did not run a render).
- The model step: turning "make share. pink" into a validated patch. No model call was made.
- The runtime's element-pick mode (present in the runtime protocol; not tried, not needed because the engine's own element list works).
- Other scene kinds: only two of the engine's kinds (kinetic words, title with name and pill) appeared. UI-mockup scenes, cursors and wipes were not tested.
- Legibility and layout after arbitrary overrides: nothing stops a user from pushing a word off screen.

## What this means for the estimate
The hard unknown was "can we address and change one element reliably". For text, colour and position the answer is yes, with a small central engine change plus an `overrides` entry in the existing variables block. Size needs a design decision (grow in place and accept overlap, or reflow). The model step and a real render check remain to be done.

Revised estimate (agent time, with review): **minimal HyperFrames element edits (text, colour, offset, scale; validated; undo; preview and render parity) about 2 to 3 working days**; the same patch format can serve plates' phase 4, so building it once is cheaper than twice. Scene kinds beyond kinetic and title remain open-ended until each is probed.

## Proposed patch format (shared by both engines)
`{ "el": "b2:w:2", "set": { "color": "#ff3b6b", "dx": 0, "dy": -40, "scale": 1.4, "text": "..." } }`, validated against the elements active at the comment's time (type, range, element exists), stored per revision, applied by the engine from the `hf-variables` block, undone by dropping the entry.
