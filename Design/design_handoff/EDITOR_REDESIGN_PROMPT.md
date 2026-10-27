# Prompt: redesign the Greedy Motion pro editor

You are a senior product designer. Redesign the pro video editor for **Greedy Motion (Relay)**, a studio that turns a brief, screenshots and a brand kit into on-brand product videos. Deliver hi-fi screens, a component library and click-through prototypes. Reuse the existing design system and make the editor feel like the same product as `design_handoff/Relay Studio v3.dc.html` (scenes and layers, canvas, timeline with keyframes, properties, validation, publish as template). Read `design_handoff/README.md` first and match its tokens.

## What exists today (engineering prototypes, to be replaced, not copied)
Two working but unstyled prototypes run locally (`python3 experiments/gm-editor/server.py`, then open `http://localhost:8790` for the EffectCraft editor and `http://localhost:8790/hf` for the HyperFrames editor). Use them to understand behaviour. Ignore their dark mint look.

**Engine A, EffectCraft: layer-based motion graphics.** A project is a composition of layers (text, solid, shape, null, adjustment, camera, light, pre-compositions). Every layer has a property tree (transform, text, effects, shape contents, materials) and every property can be animated with keyframes. It supports 3D layers, a camera, blur, glow and gradient effects, and parenting.

**Engine B, HyperFrames: HTML compositions.** A project is an HTML file. Clips sit on numbered tracks with a start, duration and track index. Each clip is an element with CSS, text and GSAP tweens. It can render transparent video, which Engine A imports as a 3D layer ("bridge").

## Decision to design (give me both, and recommend)
1. **One editor with two modes** (my recommendation). A single Studio shell with a mode switch, shared header, timeline, inspector and render panel. Layers and property tree for A. Clips, CSS and tweens for B. A bridge action sends a B clip into A as an FX layer.
2. **Two separate editors** that share one component library.
Show the shell for option 1 and the differences for option 2. State what is shared and what differs.

## Layout (desktop first, 1440 wide; also 1024 compact)
Top bar, left panel (layers or clips, scenes, assets), centre canvas with transport, bottom timeline, right inspector. All panels resizable and collapsible. Light theme is the default; provide dark.

## Functionality that exists (must all be in the design)
- Open any project from a list. Switch composition. Save, Save as, Undo, Redo (the engine's history).
- Layers: list, select, reorder (up and down), show or hide, add (text, solid, shape, null, adjustment, camera, light), delete, rename, set in and out points, set parent.
- Canvas preview rendered by the engine (frames arrive 0.1 to 1 s after an edit; design the loading state). Scrub bar, play, time readout.
- Timeline: layer bars, zoom, click to seek, keyframe diamonds for the selected layer, playhead.
- Inspector: every property grouped, typed controls (number, vector, colour, checkbox, text, enum), stopwatch to animate, previous or next keyframe, property filter, effect search and add.
- Rendering: preview video (half size) and full render in the background with progress, player and download.
- HyperFrames mode: clip timeline with drag to move and edge drag to trim, text content, CSS properties with colour pickers, editable tweens, full file source tab, add text clip, delete clip, Check (lint with errors and warnings), Render MP4, Render transparent.

## Functionality to design now even though it is not built yet
- **Canvas direct manipulation**: click to select, drag to move, resize and rotate handles, hold Shift to constrain, arrow-key nudge, snapping and smart guides, safe-area and title-safe overlays, rulers, zoom and pan (Space + drag, pinch), marquee and multi-select, in-place text editing by double-click, 3D gizmo for position, rotation and scale, camera view.
- **Drag and drop**: files onto the canvas and timeline (images, video, audio, fonts, logos), assets from the bin, reorder layers by dragging, parent a layer by dropping it on another, drop an effect or preset onto a layer, drop a template scene into the timeline.
- **Timeline**: drag bars to move and trim, ripple edit, snapping to playhead, markers and keyframes, drag, copy and delete keyframes, box-select keyframes, easing curve editor (speed and influence graph), work area, zoom to fit, audio waveform track, split at playhead, track lock, solo and mute.
- **Layers**: groups and pre-composition, search and filter by type, lock, solo, colour labels.
- **Inspector**: scrub-to-change numbers, expressions field, presets and favourites, drag to reorder the effect stack, reset to default, link scale.
- **Asset bin and import**, brand kit colours and fonts as swatches in every picker, variables panel (editable fields such as headline text and colours that a non-pro user can change), templates and presets gallery, publish as template.
- **Validation panel** (lint and render checks that jump to the problem), **render queue** with progress and history, **history panel** (branching undo), **command palette** (Cmd+K) over the engine's few hundred commands, full keyboard shortcut map, comments and review on the timeline (as in Comment Edit).

## Deliverables
1. Annotated hi-fi screens for: empty state, project open, layer selected, keyframe editing, canvas drag, drop asset, effect stack, easing editor, render in progress, render done, error, validation, command palette, HyperFrames clip selected, bridge dialog.
2. Component library: panels, tab bars, list rows, timeline bars and keyframes, playhead, canvas handles and guides, property controls, colour picker, menus, toasts, progress, empty and loading and error states.
3. Click-through prototypes of five flows: move and trim a clip; drag a logo onto the canvas and resize it; animate a position with an eased keyframe; add and tweak an effect; render and review.
4. A short interaction spec for each gesture (hover, active, disabled, drag preview, snapping feedback, undo behaviour) and the keyboard shortcut table.
5. Accessibility notes: full keyboard control, visible focus, contrast AA, reduced motion, screen-reader names for every control.

## Constraints
- Engine preview is a raster image; selection handles and guides are drawn by the UI on top of it.
- Everything runs locally against Docker; show clearly when work is running or the engine is busy.
- Pro editor is desktop and tablet only; no pro timeline on mobile (follow `design_handoff/README.md`).
- Motion: 180 to 260 ms UI transitions, no bounce. Keep copy short and say what happens next.
- Do not invent product names or claim features that are not in this brief; list open questions at the end.
