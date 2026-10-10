# gm-velocity-sting checklist

Work top to bottom. Stop where it says stop. Paste the filled list into the handoff.

## 1 · Fit
- [ ] The brief is a sting, not an explanation. If it is "explain what we do", stop and use `gm-feature-explainer`.
- [ ] The product really has a sign-in or first-run surface, a number its users quote, a primary navigation, and a create action.

## 2 · Rights
- [ ] Every surface is the caller's own product, rebuilt from its real labels. No third-party UI, logo or screenshot.
- [ ] The brand comes from the caller's brand kit (or a site they own). Stated in the handoff.
- [ ] The typed value is sample data, not a real person's.

## 3 · Slots
- [ ] Every slot in `slots.json` is filled inside its budget; every `mustBeReal` slot came from the product, not from Claude.
- [ ] The number is one the product's users would quote; no invented %, multipliers or customers.
- [ ] A one-word brand is kept whole (`brand_word_2` empty).

## 4 · Clock
- [ ] `ledger.json` and the frame plan are unchanged, or every retimed seam was re-verified.

## 5 · Craft
- [ ] Only `EO` / `EI` (functions), the spring for the counter-bounce, and stamps.
- [ ] `npm run check:brand-tokens` clean (no literal colours or fonts).

## 6 · Gates
- [ ] `hyperframes check` passes with zero findings, including contrast.
- [ ] `scripts/verify-seams.mjs` reports all 6 seams velocity-matched; `seams-verified.json` kept.
- [ ] Pacing gate passes (no hold > 0.6 s).
- [ ] `pop_gate.mjs <render.mp4> --max-cuts 6` passes: no single-frame pop, and no hard cut other than at the six seams (a seam that reads as a cut instead of a carried move is a defect, see the ledger).
- [ ] `seam_sheet.mjs <render.mp4> --at <the six seam times>`: the middle of every seam viewed at phone size with the safe boxes drawn; nothing important outside the title-safe box, no element floating above a wipe it should be under.
- [ ] −14 LUFS ±1, ≤ −2 dBTP after encode; audio stream present.
- [ ] Watched at full speed.

## 7 · Handoff
- [ ] Slot values and their sources, brand kit, rights position, gate outputs, render time.
