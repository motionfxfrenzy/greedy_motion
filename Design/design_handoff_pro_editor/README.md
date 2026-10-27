# Handoff: Greedy Motion Studio — Pro Editor

## Overview
A professional motion-graphics editor for Greedy Motion Studio. One editor shell drives two render engines:

- **Layers mode → EffectCraft**: After Effects–style layer compositing (layers, pre-comps, 3D layers, keyframes, speed graph, effect stack, expressions).
- **HTML clips mode → HyperFrames**: clip-based editing of HTML compositions (numbered tracks, clips with timing, inline CSS, tweens, lint).

A **bridge** sends an HTML clip into a Layers composition as a transparent 3D layer. Projects that never use EffectCraft open as **HyperFrames-only** (no mode switch, no bridge; text, shapes, footage and audio all live on clip tracks).

The canvas always shows the engine's raster frame. The UI draws handles, guides and selection on top at the live value, while the frame catches up (100 ms–1 s).

## About the design files
The files in this bundle are **design references created in HTML**: interactive prototypes that show the intended look and behaviour. They are not production code. Recreate them in the target codebase's environment (React, Vue, Svelte, etc.) using its established patterns. If there is no environment yet, pick the most suitable framework (React + TypeScript is a good default for a pro editor of this complexity).

Engines are **mocked** in the prototype: frame latency, render progress, lint results, composition checks and agent replies are simulated. Real behaviour must come from EffectCraft / HyperFrames APIs (see Open questions).

Open `Pro Editor v2.dc.html` directly in a browser (it loads `support.js` next to it). A dark bar at the top switches between the **16 screens** and runs **5 guided flows**.

## Fidelity
**High fidelity.** Colours, type, spacing, radii and interactions are final. Recreate pixel-accurately with the codebase's own component library.

## Files
- `Pro Editor v2.dc.html`: the main interactive prototype (current version).
- `Pro Editor Spec.dc.html`: decision record (one editor vs two), layout per breakpoint, gesture spec table, shortcuts, accessibility, open questions.
- `Pro Editor Components.dc.html`: component sheet with every state (rows, bars, keyframes, handles, property controls, status, menus, empty/loading/error, dark theme).
- `support.js`: prototype runtime only. Do not port.
- `assets/gm-mark.svg`, `assets/gm-logo.png`: brand mark and a sample logo asset.
- `fonts/dm-mono-400.woff2`, `fonts/instrument-serif-400.woff2`: self-hosted fonts.

Inside the prototype, data, screens and flows are defined near the end of the file (`LAYERS0`, `CLIPS0`, `SCREENS`, `FLOWS`, `CMDS`). The logic class holds every interaction handler.

---

## Layout (app shell)

Full-viewport CSS grid on `#ebf5ff`, with 8 px padding and 8 px gaps. Every region is a card.

```
grid-template-columns: <left> minmax(0,1fr) <right>
grid-template-rows:    56px minmax(0,1fr) <timeline>
```

| Region | Desktop ≥1200 | Compact <1200 |
|---|---|---|
| Top bar | 56 px, spans all columns | Same; search label and save text become icons |
| Left | Docked: `leftW` default 328 (drag 316–440). Collapsed: 54 px icon rail | Docked max 316 px |
| Left (floating) | Column stays 54 px; panel `position:absolute; left:0; width:320px; z-index:30`, shadow `0 14px 20px 4px rgba(4,69,144,.14)` | Same |
| Canvas | Fluid; fits 16:9 into remaining space | Same |
| Inspector | `rightW` default 336 (280–460). Collapsed: 40 px tab | 312 px fixed |
| Timeline | `tlH` default 290 (170–480), clamped to max(170, 34% of viewport height). Collapsed: 44 px toolbar | ≤250 px |

Panel resize: an 8 px invisible strip on the panel edge. On hover it shows `rgba(22,139,255,.25)` and the cursor is `col-resize` / `row-resize`.

**Card style (all panels):** background `#fafdff`, `1px solid #E1EAF4`, radius `18px`, `overflow:hidden`.

### Left panel
- **Docked (default):** pushes the canvas. **Float** button (⧉, toggles to ⇤ "Dock panel") lifts it over the canvas instead.
- Header = tab row (same as Inspector): `padding:12px 6px 0 12px; gap:8px; border-bottom:1px solid #E1EAF4`. Tabs are 11.5 px / 700, `white-space:nowrap`. The active tab has ink `#0a0d12` and a 2 px `#0A6CFF` underline (`padding-bottom:9px`). Inactive tabs are `#93979f`. Then the ⧉ float and ‹ collapse buttons (24×24, radius 7, hover `#EDF3FA`).
- Tabs: Layers mode `Layers · Comps · Assets · Library · History`; HTML mode `Clips · Comps · Assets · History`.
- Collapsed or floating-closed: a 52 px icon rail (glyph 15 px over a 9 px label; active `#EBF5FF` bg / `#0058bd`). Clicking an icon opens the panel on that tab; clicking the active icon closes it.
- **Layers list rows:** 36 px. Index (DM Mono 10, `#93979f`), 10 px label colour chip (click to cycle), type glyph, name 12.5/600, then 20×20 switches (visible ◉, solo S, lock L): radius 6, `1px solid #D6E4F2`. Solo on: `#D97706` fill. Lock on: `#535862` fill. Selected row: `#EBF5FF` bg, `1px solid #9ECBFF`, name `#0058bd`. Parent target: `#CCE7FF` bg with a `#0A6CFF` border. Drag insert line: 2 px `#0A6CFF`; dragged row opacity .5. Hidden layer name: `#93979f`.
- Label colours: `#168BFF #8B5CF6 #D97706 #16A34A #E11D48 #A3ACB9`.
- **History** is a scrolling list inside the card (no overflow out of the card).

### Top bar
Project menu, composition selector, mode segmented control (Layers / HTML clips; pill track `#E1EAF4`, active `#fff` with shadow `0 1px 3px rgba(4,69,144,.16)`), engine pill, undo/redo, ⌘K search, save state (● + "Saved" / "Unsaved"), **Check** (badge = issue count), **Render** (primary `#181d27`, pill, badge = job count).

Engine pill states:
| State | Background | Text | Dot |
|---|---|---|---|
| Engine ready | `#D3F6E3` | `#0a5c35` | `#16803C` |
| Updating frame… | `#EBF5FF` | `#0058bd` | `#0A6CFF` (pulse) |
| Rendering 42% | `#EBF5FF` | `#0058bd` | `#0A6CFF` |
| Engine stopped | `#FFF1EA` | `#C2410C` | `#C2410C` |

In HyperFrames-only projects the mode switch is replaced by a HyperFrames badge.

### Canvas
- Frame card: `#fff`, radius 6, shadow `0 14px 20px 4px rgba(4,69,144,.08)`. Zoom: fit / %.
- Safe areas: action 5 % inset with a `1px dashed rgba(22,139,255,.55)` border; title 10 % inset with `rgba(22,139,255,.3)`. Toggle with `'`. Rulers toggle with ⌘R.
- Selection box: 1.5 px `#0A6CFF`. 10×10 white handles with a 1.5 px blue border and radius 2 (corners + edge midpoints). Rotate knob above. Name tag above-left (blue fill, white 11/600, radius 5). Size tag below-right (`#181d27`, DM Mono 10).
- Stale frame: the box turns **dashed** while the engine frame lags, and a 3 px sheen (`linear-gradient(90deg,transparent,#168BFF,#0A6CFF,transparent)`) runs along the canvas top.
- Smart guides: 1 px `#E11D48`, with a label chip (red fill, white 10/600) naming the target ("Centre", "Action safe", layer edge).
- Marquee: `1px solid #0A6CFF` on `rgba(22,139,255,.08)`.
- 3D gizmo: X `#E11D48`, Y `#16A34A`, Z `#0A6CFF`. Null: 22 px circle, 1.5 px `#8B5CF6`.
- Error state: the last good frame is dimmed, with an overlay card ("The engine stopped" in `#C2410C`, body copy, and a **Restart engine** primary button).

### Timeline
Toolbar (44 px, `border-bottom:1px solid #E1EAF4`): `TIMELINE` label (DM Mono 10 / .24em / `#93979f`), Split ⌘⇧D, Ripple (toggle), Snap (toggle), + Marker, and in Layers mode Easy ease F9 and Speed graph (toggle). On the right: work-area label, current time (DM Mono 13), zoom − / Fit / +, and collapse. Toggles that are on use `#EBF5FF` bg and `#0058bd` text.

Body:
- **Name column** (`nameW`; ~200 desktop, 150 compact) + track area `minmax(0,1fr)`.
- **Ruler** 44 px, sticky. Ticks 1 px `#D6E4F2` with labels DM Mono 10. **Work area** bar is 6 px `#CCE7FF` with 8×12 `#0A6CFF` end grips (B / N). **Markers** are 10 px `#D97706` flags. **Comment pins** are 18 px teardrops (`border-radius:50% 50% 50% 2px`) in the commenter colour with white initials 8/700.
- **Groups (collapsible):** rows are grouped by type, each with a header row and caret: Layers mode `Title`, `Shapes & footage`, `Music / Audio`; HTML mode `Text`, `Shapes & footage`, `Audio`. Collapsing a group hides its rows to make room. Names have room to show in full; they truncate with an ellipsis only when the column is too narrow, and the full name is in a tooltip.
- **Layer bar:** top/bottom inset 4 px, radius 7, `1px solid #D6E4F2`, `#EDF3FA`, inset 3 px left stripe in the label colour. Label 11/600. **Selected:** `#CCE7FF` with a `#168BFF` border. **Active HTML clip:** gradient `linear-gradient(180deg,#168BFF 11%,#0A6CFF 78%)` with white text. Trim zones are 7 px at each edge (hover `rgba(10,108,255,.35)`). Tween spans show as a 2 px line at the bar bottom.
- **Property sub-rows** (selected layer only, one per animated property): 26 px, `#F7FAFE`. Left: ◂ ◆ ▸ keyframe nav.
- **Keyframes:** 11 px. **Linear = diamond** (rotated square, radius 2). **Eased = circle.** Default: 1.5 px `#535862` border on white. **Selected = filled `#0A6CFF`** (border and fill). Collapsed-layer keys: 6 px grey `#93979f` diamonds.
- **Playhead:** 2 px `#0A6CFF` with glow `0 0 10px rgba(22,139,255,.6)`, and a 14 px `#168BFF` knob with a 2 px white ring. It **runs the full height of the timeline, through the audio track(s).**
- **Snap line:** 1 px dashed `#E11D48`, full height.
- **Audio track(s):** waveform bars (1 px gap, radius 1), plus mute (M) and volume / fades in the inspector. HyperFrames-only projects support multiple audio tracks; dropping audio on the timeline adds one.
- Beyond the HTML composition end: hatched `repeating-linear-gradient(135deg,rgba(10,13,18,.05) 0 6px,transparent 6px 12px)`.

### Speed graph (Layers mode)
A panel **docked to the right side of the timeline**. Width `spW` default 380; the user can **drag its left edge** to widen it (more room when several keys are adjusted). An "All selected" toggle edits multiple keys at once.
- Graph area: `#F4F8FD`, `1px solid #E1EAF4`, radius 12. Speed curve 2.5 px `#0A6CFF`, handle lines 1.5 px `#9ECBFF`.
- Influence handles: 14 px white circles with a 2 px `#0A6CFF` border, `ew-resize`. Readouts: "Out influence 33%" and "In influence 33%", plus peak speed.
- Chips switch property and segment. Presets: Linear, Ease in, Ease out, Easy ease.

### Inspector (right)
Tabs: **Layers mode** `Properties · Variables · Review · Checks n`. **HTML mode** `Properties · Source · Variables · Review · Checks`. Same tab style as the left panel; › collapses it to a 40 px tab.

**Properties (Layers mode):**
- Header: editable name (15/700, transparent until hover/focus), type badge (DM Mono 10 pill), multi-select note, "Filter properties" search.
- Groups (Transform, Text, Appearance, 3D…) under a section label (DM Mono 10 / .24em / `#93979f`).
- **Property row:** grid `22px 86px minmax(0,1fr) auto`, min-height 30. Values must **never wrap or clip**: fields are `min-width:0`, use DM Mono 12, and show units in a tooltip rather than as an inline suffix.
  - Stopwatch ◷ (22 px circle): on = `#0A6CFF` fill with white glyph, and the label turns `#0058bd`.
  - Number field: 28 px, `#F4F8FD`, `1px solid #D6E4F2`, radius 8. The axis label (X / Y, 10/700 `#93979f`) is a scrub handle (`ew-resize`; Shift ×10, Alt ×0.1). Focus: border `#168BFF` + `0 0 0 4px rgba(22,139,255,.14)`.
  - Link ⛓ for proportional scale (on = `#0A6CFF`).
  - Colour: a 28 px swatch plus a hex field. The swatch opens a brand-kit popover (24 px swatches; selected has a 2 px `#0A6CFF` ring).
  - Keyframe nav ◂ ◆ ▸ and reset ↺ (`#C9D6E4`, hover `#0A6CFF`).
  - Expression (Alt-click stopwatch): textarea on `#F1E6FF` with a `#C9A7FF` border, label `#5b2ca8`.
- **Effects:** a card per effect (`#fff`, radius 12) with ⋮⋮ grip (drag to reorder; 2 px `#0A6CFF` insert line), on/off checkbox, collapsible name, × remove (hover `#FFF1EA` / `#C2410C`), and params with scrub labels. "+ Add effect" is a dashed search field (`1px dashed #9ECBFF`) opening a listbox. ★ favourites are pills below it. "Top applies first."

**Properties (HTML mode):** `#name` + tag badge + file select. Timing (Start / Duration / Track with scrub labels), Text, inline CSS rows (key DM Mono, value, colour swatch, × remove, + Property), Animation tweens (Property / From / To / Duration / At / Ease), and **Send to Layers…** (purple card `#F1E6FF` / `#C9A7FF`, hidden in HyperFrames-only projects). Audio clips show volume, fade in / out and mute.

**Code-generated elements:** elements created by code show their editable properties as normal. Simple edits (colour, text, timing) are done directly in the inspector. Complex changes go to the agent (below).

**Ask agent (always docked at the bottom of the inspector):**
- Collapsed: a single 44 px line, `border-top:1px solid #E1EAF4`, with "✦ Ask agent about {element}" (12.5/600, ellipsis) and a caret ▴. When nothing is selected it targets the composition ("main" / "index.html").
- Opens on click, **or when the inspector is scrolled to the bottom**. It closes again when the user scrolls up, unless the agent is working or a question is typed.
- Expanded (max 46 vh, scrolls): hint, question textarea, suggestion chips, Send. Then states **thinking** (pulsing `#0A6CFF` dot) and **proposed** (a diff of the changes, with Apply and Discard; green dot `#16803C`). Apply is one undo step.

**Variables:** checklist cards of fields a guided-editor user may change, then **Publish as template…**
**Review:** comment cards (avatar initials, a time chip that seeks, Resolve) and "Pin comment" at the playhead.
**Checks:** summary + Run again. Errors use `#FFF1EA` / `#C2410C` (✕), warnings `#FFF7E6` / `#B45309` (!), and "Ready to render" uses `#D3F6E3` / `#0a5c35`. **Go to** selects the layer, seeks, and opens the property. Errors block render; warnings don't.

### Overlays
- **Render popover** (top-right, 380 px, radius 20): Preview half size / Full render (Layers), or Render MP4 / Render transparent (HTML). Then the queue: job card with a 6 px progress bar (gradient `#168BFF→#0A6CFF`; done `#16803C`; failed `#C2410C`) and a stage line ("Rendering frames 151 / 360"), with Open/Download, Retry or Cancel. Then history.
- **Command palette ⌘K** (560 px modal, backdrop `rgba(10,13,18,.28)` + `blur(6px)`): 54 px input (16 px), grouped results with shortcuts on the right, hovered row `#EBF5FF` / `#0058bd`. Footer: "↑↓ move · Enter runs · Esc closes".
- **Bridge dialog**, **Keyboard shortcuts (?)**, **Open project**, **Save as**, **Publish template**: same modal shell.
- **Render player**: 880 px, image 16:9, scrubber with comment pins, time chip and "Post comment".
- **Context menu** (200 px), **project menu** (230 px): radius 14, items 13 px, hover `#EBF5FF`.
- **Drag ghost**: chip with thumbnail, file name and drop hint ("Drop on canvas · at pointer").
- **Toast**: bottom-centre pill, `#181d27` with white 13/600, `aria-live="polite"`, about 2.5 s. Destructive actions mention undo ("Deleted Title. ⌘Z brings it back.").

---

## Interactions & behaviour
Full per-gesture table (hover / active / snapping / disabled / undo) is in `Pro Editor Spec.dc.html` §3. The key rules:

- Motion is 180–260 ms with `cubic-bezier(.16,1,.3,1)`, no bounce. `prefers-reduced-motion` removes the sheen, pulses and panel transitions.
- Drags start after 3 px of movement. **Esc cancels** any drag and restores the start state. **Each finished drag is one undo step.** Selection is not an undo step.
- Selection is shared between the Layers list, canvas and timeline.
- Canvas: move (Shift = axis lock, ⌘ = skip snap), resize (linked by default, Alt frees), rotate (Shift = 15° steps), marquee, double-click text for in-place editing, arrows nudge 1 / 10 px. On a keyframed property, a nudge writes a key at the playhead. With no selection, ← / → step frames.
- Snapping targets: canvas centre, safe areas, other layer edges and centres. On the timeline: playhead, markers, other bar edges.
- Timeline: move bar or clip (HTML clips can change track vertically), trim edges (Ripple shifts later items; min 0.1 s), drag keyframes (Alt-drag copies), F9 easy ease, ⌘⇧D split, work area B / N, M marker.
- Asset drop: canvas → at the pointer; timeline → at the time under the pointer; layer row → apply preset or effect; fonts → brand kit; audio → audio track. Unsupported file: a toast lists the supported types.
- The engine frame lags 0.1–1 s. Handles render at the live value, dashed while stale.
- Render runs in the background (one job at a time, the rest queued). Editing stays possible.

## State (from the prototype)
`mode` (A = Layers, B = HTML), `hfOnly`, `project`, `layers[]` (id, name, type, label, parent, visible / solo / lock, transform, `keys{prop:[{t,v,lin,o,i}]}`, `effects[]`), `clips[]` (id, name, tag, track, start, dur, css, text, tweens, gen), `sel[]`, `clipSel`, `t`, `playing`, `wa[2]`, `markers[]`, `comments[]`, panel sizes (`leftW`, `rightW`, `tlH`, `spW`), open flags (`leftOpen`, `leftFloat`, `rightOpen`, `tlOpen`, `speedOpen`, `agentOpen`), `grpClosed{}`, `engine` (ready | updating | rendering | stopped), `jobs[]` (kind, state queued | running | done | failed, pct, stage), `past[] / future[] / branches[]` (undo with branching history), `agent` (idle | thinking | proposed), `agentQ`, `vars{}`, `ripple`, `snapOn`, `modal`, `toast`.

Data the real app needs from the engines: a frame for (comp, time, size), property write at time, command list (name, group, default shortcut) for ⌘K, lint / check results with element ids and severity, render job progress events, and asset import.

## Design tokens

**Colour**
| Token | Hex |
|---|---|
| App background | `#ebf5ff` |
| Panel | `#fafdff` |
| Field / subtle fill | `#F4F8FD` |
| Hover fill | `#EDF3FA` |
| Border | `#E1EAF4` |
| Field border | `#D6E4F2` |
| Muted border / disabled glyph | `#C9D6E4` |
| Ink | `#0a0d12` |
| Body | `#535862` |
| Label (caps 10–11 px only) | `#93979f` |
| Primary button | `#181d27` |
| Blue 500 / 600 / 700 | `#168BFF` / `#0A6CFF` / `#0058bd` |
| Blue tints | `#EBF5FF`, `#CCE7FF`, `#9ECBFF` |
| Brand gradient | `linear-gradient(180deg,#168BFF 11%,#0A6CFF 78%)` |
| Purple (bridge / expression) | `#5b2ca8`, `#F1E6FF`, `#C9A7FF`, `#8B5CF6` |
| Success | `#16803C`, `#0a5c35`, `#D3F6E3` |
| Warning | `#B45309`, `#D97706`, `#FFF7E6` |
| Danger | `#C2410C`, `#FFF1EA`, `#F5C4A8` |
| Guide / snap | `#E11D48` |

**Dark theme** (see Components sheet): canvas `#070B14`, panel `#0F1726`, fill `#16213A`, border `#1E2A3D`, ink `#E6EDF7`, body `#A3AEC2`, blue `#3D93FF`, selected `#12305C`, danger `#FF8A5B`, success `#4ADE80`, warning `#FBBF24`.

**Typography**
- UI: **Plus Jakarta Sans** 400–800 (Google Fonts).
- Numbers, timecodes, code, section labels: **DM Mono** 400 (self-hosted).
- Display accent (marketing / spec headings only): **Instrument Serif** italic 400.
- Scale: 9 (rail labels), 10 (section labels, caps, `letter-spacing:.24em`), 11, 11.5, 12, 12.5 (rows, body UI), 13, 13.5, 15 (panel titles), 17 (dialog titles). Weights: 600 for labels and rows, 700 for tabs, buttons and bars, 800 for headings.

**Radius:** 2 (handles), 5–7 (switches, tags, keyframe chips), 8 (fields), 9–10 (rows, small buttons), 12 (cards inside panels), 14 (menus, job cards), 18 (panels), 20–22 (dialogs), 9999 (pills, buttons).

**Shadow:** popover / dialog `0 14px 20px 4px rgba(4,69,144,.12–.14)`; card lift `…,.08`; segmented active `0 1px 3px rgba(4,69,144,.16)`; focus ring `0 0 0 3px #fff, 0 0 0 5px #168BFF`; field focus `0 0 0 4px rgba(22,139,255,.14)`.

**Spacing:** 4 px base. Common: 4, 6, 8, 10, 12, 14, 16, 18. Shell padding and gaps are 8.

## Accessibility
- Tab order: top bar → left → canvas → inspector → timeline. **F6** cycles regions (not yet built in the prototype).
- Canvas: Tab cycles layers, arrows nudge, Enter edits, Esc clears. Timeline: arrows move between rows and keys, Space plays.
- Visible focus on every control (ring above). Selection always pairs colour with a shape change (fill, outline, dashed).
- The engine pill and toasts are polite live regions. Name handles and keys clearly ("Resize Title, top-left", "Position keyframe at 0:01:00, eased"). The layers list is a multi-select listbox, and switches are toggle buttons with a pressed state.
- AA contrast: `#93979f` is used only for caps labels, never for values or actions.

## Keyboard shortcuts (proposed)
General: ⌘K palette · ⌘Z / ⌘⇧Z · ⌘S / ⌘⇧S · ⌘O · ? · Esc
Playback / timeline: Space · ← / → frame · B / N work area · M marker · ⌘⇧D split · = / − / ⇧Z zoom
Layers / canvas: arrows (⇧ ×10) · ⌘D duplicate · ⌫ delete · ⌘⇧C pre-compose · Enter rename · ' safe areas · ⌘R rulers
Keys / clips: J / K prev/next key · F9 easy ease · hold ⌥ copy on drag · ⌥-click stopwatch = expression · ⌥← / ⌥→ move clip 1 frame · hold ⌘ skip snapping

Not yet wired in the prototype: F6, Tab-through-layers on the canvas, ⌘O, ⌘R.

## Assets
- `assets/gm-mark.svg`: Greedy Motion mark (from the design system folder).
- `assets/gm-logo.png`: sample logo used in the "Drop a logo" flow.
- Canvas content is the engine's raster; the prototype uses placeholder frames. Use real engine output.
- Icons are Unicode glyphs in the prototype (▤ ▦ ▣ ✧ ↺ ◷ ◆ ⋮⋮ ⛓ ✦). Replace them with the codebase's icon set at the same sizes (12–15 px).

## Open questions (for engine teams)
1. Which EffectCraft commands should ⌘K list? Does the engine expose names, groups and default shortcuts?
2. Can the engine accept a property write at a given time (to create a keyframe), or does the UI have to send whole keyframe lists?
3. What is the real frame latency at full size? Is a quick low-res frame available during drags?
4. Do pre-comps open as their own tab, or edit inline?
5. Should the bridge layer re-render when its HTML clip changes?
6. What does the HyperFrames lint return (codes, severities, clip ids)?
7. Which EffectCraft checks exist, and which ones block a render?
8. Do expressions exist in EffectCraft, and in what language?
9. Is one render at a time right on a single Docker host?
10. Where do brand-kit fonts live for the engine container?
11. Should branching history persist after the project closes?
12. Are timeline comments shared with the guided Review screen?
13. What can the agent edit (code-generated elements only, or any layer), and how are its changes previewed?
