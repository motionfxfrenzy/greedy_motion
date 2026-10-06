# Studio editor decision

Date: 2026-10-04. Status: accepted for the v1 Studio implementation.

This is the implementation decision for the product-facing Studio editor. It
narrows the longer-term editing model in [Editing and AI revisions](EDITING.md)
to a constrained, template-first v1.

## Context

The product needs an editor that feels native to its workflow: scenes,
template variables, uploaded product screens, timestamped review comments, and
AI-assisted revisions. It does not need a general-purpose non-linear video
editor in v1. Most of the value is in the product workflow and its exact UI,
while preview fidelity is a rendering concern that must match the worker.

## Decision

Build the Studio shell and timeline interactions in the application. Use
HyperFrames only for the composition preview and transport layer:

| Concern | v1 decision |
| --- | --- |
| Canvas, play/pause, seeking, and composition time | `@hyperframes/player`, backed by the same composition and variables as the renderer |
| Scene rows, comment pins, selection, property inspector, review, and approvals | Product-owned React UI |
| Project state | The backend project/revision is authoritative; the editor keeps a local draft of explicit project changes |
| Undo/redo | Zustand editor store with Zundo history for local, reversible editor operations; persisted revisions and render jobs are not undo history |
| Audio waveform | Add WaveSurfer only when v1 supports audio timing, trims, or markers; it is not required for the initial scene/comment editor |

The v1 editing surface is intentionally constrained to declared template
variables, approved assets, and review comments. Scene timing and motion
presets remain template-owned. It does not expose arbitrary source, arbitrary
clip tracks, or a freeform animation authoring surface.

## Why

- HyperFrames preview is the closest path to a canvas that behaves like the
  final render. A separate editor renderer would create two sources of truth.
- Our timeline is a small number of scenes plus review pins, not an open-ended
  multi-track NLE. Owning it lets the UI follow the design handoff without
  fighting a third-party component's layout or state model.
- A local undo stack improves editing ergonomics without making queued renders,
  server revisions, or AI jobs reversible client state.
- WaveSurfer is valuable for waveforms and audio markers, but adds weight and
  complexity before audio is actually editable.

## Alternatives not adopted for v1

| Alternative | Decision | Reason |
| --- | --- | --- |
| `react-timeline-editor` | Do not adopt initially | Its multi-track drag/resize model is broader than the v1 workflow and would require substantial restyling. Re-evaluate only if arbitrary clip tracks become a product requirement. |
| Remotion Editor Starter | Do not adopt | It introduces a second composition/render stack and a paid editor product where HyperFrames is already the renderer. |
| OpenCut or another full editor | Do not embed | These are full applications rather than narrowly composable Studio primitives. |
| Theatre.js | Do not adopt | Its keyframe authoring and serialized state would become a second animation model alongside HyperFrames. |

## Implementation boundaries

1. Wrap the HyperFrames preview behind a small product adapter that exposes
   duration, current time, seek, play, pause, and preview errors. Product UI
   must not depend directly on a third-party timeline DOM.
2. Keep the project schema and revision API independent of Zustand/Zundo. Save
   explicit project operations to the backend; reset or reconcile the local
   draft after a successful save or a conflicting server revision.
3. Render only from a saved backend revision. The editor preview may be live,
   but it is never the authority for a final export.
4. Add WaveSurfer behind an audio-track adapter if audio editing ships, using
   the HyperFrames/player clock as the synchronization authority.

## Revisit when

Reassess this decision when users need arbitrary multi-track media editing,
freeform keyframes, or a broader professional animation workspace. At that
point, prototype a generic timeline component and a full-editor integration
against a real project before changing the project format or renderer.
