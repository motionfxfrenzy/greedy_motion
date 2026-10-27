# Greedy Motion (Relay) — Design handoff

Hi-fi, interactive prototypes for a product-video studio for SaaS teams. Users turn screenshots, a script, and a brand kit into an on-brand MP4. Claude plans each edit and writes HyperFrames compositions.

## About these files
The `.dc.html` files are **design references** built in HTML. Each one opens directly in a browser (keep `support.js` next to them). They show the intended look and behaviour. They are not production code. Rebuild them in the target codebase (`VideoSaaS`) using its existing framework, components, and patterns. All state, timers, and "AI" responses are mocked in each file's `class Component` logic block. Read that block for flow rules and copy.

**Fidelity: high.** Colours, type, spacing, radii, copy, and states are final. Match them.

## Screens

| File | What it is |
|---|---|
| `Greedy Motion Landing.dc.html` | Logged-out marketing page: hero, how it works, templates, pricing, footer. The background moves slowly. |
| `Greedy Motion Auth.dc.html` | Sign in, sign up, and forgot-password screens. The live preview sits on the right. |
| `Relay v3.dc.html` | **Main logged-in app.** Projects, Templates, Brand kits, Library, Settings, first-run welcome, and the guided creation flow. Embeds Comment Edit at the Review step. |
| `Comment Edit.dc.html` | Review by timeline comments: pause, select an element or range, comment, Apply with AI, then accept or reject a proposed revision. Works standalone, or embedded with `embedded`, `approved`, `onApprove`, `onDownload`, `onAccept`, `onRender` props. |
| `Reel Editor.dc.html` | Talking-head reel editor. Steps: upload, processing (transcribe, plan), then edit. The edit screen has the transcript, live preview, and Edits / Layout (full, split, PiP) / Captions / Color / Audio tabs, plus a six-track timeline and render. |
| `Relay Studio v3.dc.html` | Pro studio: scenes and layers, canvas, timeline with keyframes and comments, properties, validation, and publish as template. |
| `Scene Frame.dc.html` | Shared child component. Renders one video scene/frame (theme, format, headline, screenshot) and is used by every screen above. |

### Creation flow (Relay v3)
Goal → **Script** → Brand → Storyboard → **Render** → **Review**

1. **Goal**: four templates (Product launch, Feature spotlight, What's new, Stat highlight). Each has a default length and format. Format choices: 16:9, 9:16, 1:1.
2. **Script**: tick "Voiceover script" (purple ♪) and/or "On-screen text" (blue Aa). Then either **Write it for me** (from a one-line prompt) or **I have a script** (paste, then Split into scenes). The user edits the lines per scene and must tick "I've checked this script". You also need at least one verified screenshot (PNG/JPG, drag to reorder, give it a purpose label, Replace if rejected).
3. **Brand**: compact card for the brand kit in use, or theme / add kit / no branding. Only the limited options are shown: theme, motion style, logo placement, music, voice.
4. **Storyboard**: five scenes (Hook, Problem, Product, Benefit, CTA). Each has a headline, copy, screenshot, duration, motion preset, and remove/restore. Edits update the preview live. The **Submit video** button starts rendering.
5. **Render**: shows the real stages (Preparing composition, Rendering frames with a frame count, Adding audio, Uploading draft). The user can leave the page. When the render finishes, the app moves to Review automatically.
6. **Review**: embedded Comment Edit with Download draft and Approve final. Approving locks the revision. Accepting any later AI change creates a new revision and clears the approval.

Project states (labels): Ready to create · Finish your brief · Draft storyboard · Rendering draft · Ready for review · Revisions needed · Approved · Render needs attention. A failed render always names the scene and the fix.

## Design tokens
- **Type**: Plus Jakarta Sans 400–800 (UI; Google Fonts). Instrument Serif 400 (video titles only). DM Mono 400 (timecodes, file names). Both are in `fonts/`. Scene Frame also uses Inter and Hanken Grotesk, from `fonts/`.
- **Ink** `#0a0d12` · **Primary button** `#181d27` · **Body** `#535862` · **Muted** `#93979f`
- **Canvas** `#ebf5ff` · **Surface** `#fafdff` / `#fff` · **Subtle fill** `#F4F8FD`, `#EDF3FA` · **Border** `#E1EAF4`, `#D6E4F2`
- **Brand blue** `#0A6CFF` · **Bright** `#168BFF` · **Soft** `#EBF5FF`, `#CCE7FF`, `#9ECBFF` · **Text on soft** `#0058bd`
- **Brand gradient** `linear-gradient(180deg,#168BFF 11%,#0A6CFF 78%)`. Use it only on headline accent words, the primary marks, and active clips.
- **Voiceover accent** `#F1E6FF` / `#5b2ca8` / `#C9A7FF` · **Success** `#16803C`, `#D3F6E3`, `#0a5c35` · **Warning** `#B45309` · **Danger** `#C2410C`, `#FFF1EA`
- **Radii**: pill `9999px` for buttons and tabs · cards `24–28px` · inner tiles `14–18px` · inputs `12–16px`
- **Shadow**: `0 14px 20px 4px rgba(4,69,144,.08)` (raised); focus ring `0 0 0 4px rgba(22,139,255,.14)`
- **Motion**: 180–260 ms UI transitions, `cubic-bezier(.16,1,.3,1)` for layout moves, nothing bouncy. Ambient background: two blurred radial blobs (blue `#9ECBFF`, peach `#FFD1B8`) drifting over 26–32 s, alternating direction.
- **Copy**: short sentences that say what happens next. No "magic". Show percentages only when they are real progress.

## Assets
- `assets/gm-mark.svg`, `assets/gm-logo.png`: app mark and logo
- `brand/`: the original Greedy Motion logo, wordmark, mark, slice, and mascot files
- `assets/templates/*.jpg`: template thumbnails and scene strips
- `assets/themes/*.jpg`: theme previews
- `fonts/*.woff2`: self-hosted fonts

## Responsive
Creation and Studio are desktop-first. On mobile, users can browse projects, play previews, approve, download, comment on the timeline, and edit simple text. Don't offer the pro timeline on mobile.
