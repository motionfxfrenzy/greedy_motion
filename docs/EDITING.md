# Editing and AI revisions

Date: 2026-10-02. Status: long-term design exploration. It builds on [Architecture](ARCHITECTURE.md) (immutable revisions, approval, isolated preview) and uses HyperFrames v0.8.x packages. Verify exact SDK method signatures against the pinned version before building.

> **v1 implementation note (2026-10-04):** The accepted, implemented scope is
> documented in [Studio editor decision](STUDIO_EDITOR_DECISION.md). v1 owns
> the Studio shell and timeline in the product UI, uses `@hyperframes/player`
> for the real composition preview, persists constrained values/assets through
> the project API, and intentionally defers the freeform Pro editor described
> below.

## 1. Product decision

Two editing tiers on **one project format**, plus AI edits through timeline comments in both:

| Tier | Who | Interface | What users can change |
| --- | --- | --- | --- |
| **Beginner** | Founders and marketers who want a good video fast | Form fields + `<hyperframes-player>` live preview | Only the template's declared variables and approved parameters (copy, screenshots, logo, theme, scene length within limits, motion preset) |
| **Pro** | Designers and power users | HyperFrames Studio (timeline, property panel, keyframes, blocks, source) | Anything in the composition |
| **AI edits** (both tiers) | Everyone | Comments pinned to a moment on the timeline | Whatever that tier allows, scoped to the commented scene/element |

Why this split:

- Beginners get instant preview (no server render while editing) and cannot break a template, because they only change values the template exposes.
- Pros get the full editor without a separate file format, so a beginner project can be "opened in Studio" and a pro design can be published back as a beginner template.
- The **HyperFrames SDK** (`@hyperframes/sdk`) is the one editing engine under all three: it applies edits by stable element id, records undo/redo, and emits patches, so manual and AI edits produce the same kind of change.

## 2. Licensing constraints

| Component | License | Constraint |
| --- | --- | --- |
| HyperFrames (CLI, renderer, player, SDK, studio) | Apache-2.0 | Free for commercial use; keep license notices (already in `.claude/skills/HYPERFRAMES-LICENSE`, `worker/themes/HYPERFRAMES-LICENSE`). |
| HeyGen cloud rendering | HeyGen account | Optional; pricing not published in the docs. Not used: the worker renders on Railway. |
| GSAP | GSAP "no charge" Standard License | Commercial use allowed. **Prohibited:** use "in tools that allow users to build visual animations without code" that compete with Webflow's visual animation building. |

GSAP gate: the beginner tier (filling a designer-made template) is low risk. The **pro tier** (free-form animation editing) is the case the clause targets. Before launching Pro, either get written confirmation from GSAP/Webflow, or author pro-editable motion with CSS, WAAPI, or Anime.js. This is a product/legal decision, not an engineering detail.

## 3. Beginner tier: variables + live player

### Templates declare what is editable

Each scene template marks its editable slots with HyperFrames variables:

```html
<h1 data-var-text="scene3.headline">See profit after fees</h1>
<img data-var-src="scene3.screenshot" src="assets/placeholder.png" alt="">
```

Plus a template manifest (ours, alongside the HTML) with limits per variable and per scene: max characters, allowed asset types, scene duration min/max, allowed motion presets, theme tokens that may change. The manifest is the beginner tier's permission list and the AI's permission list in beginner projects.

### Live preview without rendering

- The frontend embeds `<hyperframes-player>` pointing at the composition served from the **isolated preview origin** (`preview.<domain>`, no app cookies or tokens; see Architecture §7 and §14).
- Typing in a field updates the variable value in the preview immediately. No worker render, no cost.
- The MP4 is rendered only on draft or final export: the backend sends the revision's variable values to the worker, which renders with `hyperframes render --variables`.

### Persistence

Every saved change goes through the SDK (`setVariableValue`, `setTiming`, …), creating a new immutable revision with the SDK patch attached. Undo/redo comes from the SDK history.

## 4. Pro tier: Studio

- Start with `StudioApp` from `@hyperframes/studio`, hosted on the isolated preview origin and framed by the app. The individual Studio components are building blocks, not a drop-in embedded editor, so a custom-composed editor is a later project.
- Pro edits can change structure, so the project is no longer limited to template variables. Before any render, the backend runs `hyperframes check` (lint, runtime, layout, WCAG contrast) and blocks export on errors.
- Pro users can write arbitrary HTML/JS. That code only ever runs on the preview origin and in the network-blocked worker, never in the authenticated app.
- Internal use comes first: the team uses Studio (`npx hyperframes preview`) to build the beginner template library.

## 5. Timeline comments → AI edits

### What the user does

1. Scrubs or plays the preview and pauses on a moment (for example 4.2 s).
2. Optionally clicks the thing on screen they mean (the headline, the screenshot, the background).
3. Writes a comment: "make this faster", "change the color to our green", "the logo appears too late", "shorter text".
4. Can also drag across the timeline to mark a range ("between 3 and 5 s feels slow").
5. Adds several comments, then presses **Apply with AI**. Each comment becomes one proposed change.
6. Reviews a proposed revision: before/after preview at the commented moment, a plain-language summary per comment, and a diff of changed fields. Accepts all, some, or none.

### What the comment records

The frontend captures the anchor; the backend resolves it against the exact revision. Every comment is pinned to a revision so the anchor never drifts.

```ts
type TimelineComment = {
  id: string;
  projectId: string;
  revisionId: string;            // the revision the user was looking at
  anchor: {
    time: number;                // seconds, from player.currentTime
    range?: { start: number; end: number };
    point?: { x: number; y: number };   // normalized 0–1 click position on the frame
    elementId?: string;          // hf-id of the clicked element, if any
  };
  body: string;                  // "make it faster"
  status: "open" | "proposed" | "applied" | "rejected" | "needs_clarification" | "stale";
  resolution?: { proposalRevisionId: string; summary: string };
  authorId: string;
  createdAt: string;
};
```

How the anchor is captured:

- **time**: `player.currentTime` (frame-accurate; the player seeks the composition's timeline).
- **elementId**: on click, the player's `iframeElement` gives access to the preview document; hit-test the click point and walk up to the nearest element with an `hf-id`. Only possible because the preview origin cooperates via `postMessage`; the app never reads the preview DOM directly across origins.
- **point**: kept even when no element is hit, for "this corner looks empty".

### How the backend builds the AI's context

For each comment, the backend opens the comment's revision with the SDK (headless adapter) and assembles a small, exact context:

1. **Scene**: the scene whose time window contains `anchor.time` (from the storyboard and `getElementTimings()`).
2. **Target element(s)**: `anchor.elementId` if present; otherwise every element whose clip window contains `anchor.time`, ranked by distance from `anchor.point`. The AI is told which one the user most likely meant.
3. **State of those elements**: text, relevant styles, timing (`start`, `duration`), GSAP tweens attached to them (duration, ease, properties), and bound variables.
4. **Theme tokens** and brand palette, so "our green" resolves to a token or approved brand color.
5. **Allowed operations** for this project's tier (below), and the template manifest limits.
6. A **frame snapshot** at `anchor.time` (from the worker, `hyperframes snapshot --at`), so the model can see what the user saw. Optional; adds latency and cost.

### What the AI may return

The planner model (Claude, via tool use, like the storyboard planner) must return structured operations, never HTML or code:

```ts
type AiEditProposal = {
  commentId: string;
  summary: string;             // "Sped up the headline entrance from 0.6 s to 0.35 s"
  operations: EditOp[];        // translated 1:1 into SDK calls
  needsClarification?: string; // "Which color — the headline or the background?"
};
```

| Comment intent | Typical operations | Beginner tier | Pro tier |
| --- | --- | --- | --- |
| "Make it faster / slower" | `setGsapTween` duration or ease on the target's tweens; `setTiming` on the scene, taking frames from a neighbor | Only motion presets and scene length within manifest limits | Any tween, keyframe, or timing |
| "Change the color" | `setVariableValue` for a color variable, or `setStyle` with a theme token | Only declared color variables / theme tokens | Any style |
| "Shorter / different text" | `setVariableValue` or `setText` | Within character limits, approved claims only | Any text, still claim-checked |
| "Appears too late / earlier" | `setTiming` start on the element | Within scene bounds | Anywhere |
| "Bigger / move it" | `setStyle` (size, position) | Not allowed unless the manifest exposes it | Allowed |
| "Add / remove something" | `addElement`, `removeElement`, registry blocks | Not allowed; offer Pro or a template swap | Allowed |

### Validation before the user sees it

1. Every operation's target must be inside the comment's scope (the resolved scene and elements). An operation touching anything else is rejected, which enforces "only change the part I commented on".
2. Every operation must be in the tier's allow-list and inside the manifest limits.
3. Text changes go through the claim check: new product claims must match approved claims or be flagged.
4. The SDK applies the operations to a copy of the revision in one batch (one undo step); the result must pass `hyperframes check`.
5. One bounded repair attempt if validation fails; otherwise the comment becomes `needs_clarification` with the model's question or the validation error in plain language.
6. Unchanged scenes are compared to the parent revision; any change outside scope fails the proposal.

### Applying

- Proposals become a `proposed` revision (Architecture §6). Accepting creates a new draft revision; rejecting discards it. Approval is cleared by any accepted change.
- If the user edited the project after commenting, comments on older revisions are re-resolved; if their target no longer exists they become `stale`.
- Live preview shows the proposal instantly in the player; the MP4 renders only on export.

### Ambiguity rules

- No element clicked and several candidates on screen → ask, don't guess, unless the comment names the element ("the headline").
- "Faster" with both a slow entrance and a long scene → prefer the target element's animation; mention the alternative in the summary.
- Colors that are not theme tokens or approved brand colors are rejected in beginner projects, with a suggestion of the closest allowed color.

## 6. API and data additions

| Method and route | Behavior |
| --- | --- |
| `POST /projects/:id/revisions/:revisionId/comments` | Create a timeline comment with anchor |
| `GET /projects/:id/comments?status=open` | List comments for the project |
| `PATCH /comments/:id` | Edit text, resolve, or reopen |
| `POST /projects/:id/revisions/:revisionId/ai-edits` | Queue AI edits for selected comment IDs; `202 {jobId}` (idempotency key required) |
| `GET /jobs/:id` | Result includes the `proposed` revision ID and per-comment proposals |

New tables (tenant-scoped like everything else):

| Entity | Key fields |
| --- | --- |
| `timeline_comments` | Workspace, project, revision, anchor JSON, body, status, author, resolution |
| `ai_edit_proposals` | Comment, job, proposed revision, operations JSON, summary, validation result, model/prompt version, token usage |

The planner job type `revise` (Architecture §6, §12) carries the comment IDs. The worker is not involved until a render or a frame snapshot is requested.

## 7. Build order

1. **Templates with variables and manifest** for the five-scene product video; `hyperframes check` passes on every theme.
2. **Live player** on the isolated preview origin; form edits update it instantly; render only on export.
3. **SDK-backed revisions** with undo/redo and patches.
4. **Timeline comments**: capture time, range, point, and element; list and resolve.
5. **AI edits** for beginner scope (variables, presets, scene length), with scope validation and before/after review.
6. **Internal Studio** for the template team.
7. **Pro tier** (customer Studio, wider AI operations) after the GSAP licensing decision.

## 8. Acceptance checks

- A comment at 4.2 s on the headline produces changes only to that headline or its scene; all other scenes' definitions are unchanged.
- "Make it faster" on an element changes its tween duration or the scene length within limits, and the summary says which.
- "Change the color to green" in a beginner project uses a theme token or approved brand color, never an arbitrary hex.
- An ambiguous comment (two candidates, nothing clicked) returns `needs_clarification` instead of guessing.
- A proposal that fails `hyperframes check` or touches out-of-scope elements is never shown as applicable.
- Accepting a proposal creates a new revision and clears prior approval; rejecting leaves the current revision untouched.
- Comments on an outdated revision are re-resolved or marked `stale`.
- Preview code never runs on the app origin; the app reads click targets only through the preview origin's `postMessage` bridge.

## References

- HyperFrames docs (v0.8.111 repo `docs/`): `packages/player.mdx`, `packages/sdk.mdx`, `sdk/guides/querying-and-editing.mdx`, `sdk/guides/timing-and-animation.mdx`, `sdk/guides/undo-redo-and-patches.mdx`, `packages/studio.mdx`, `concepts/variables.mdx`.
- GSAP Standard License: https://gsap.com/standard-license (checked 2026-10-02).
