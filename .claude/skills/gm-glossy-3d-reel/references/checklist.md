# Glossy 3D reel checklist

Work top to bottom. Paste the filled list into `HANDOFF.md`.

## 1 · Fit
- [ ] The product is a transformation (inputs → better output). If it isn't, stop and use the
      velocity sting.
- [ ] There are real screens or outputs for `cards` and a real before/after.

## 2 · Rights
- [ ] Props are original primitives or extrusions of the caller's own SVGs; any downloaded model
      has a logged licence.
- [ ] No other product's or vendor's name appears as decoration.
- [ ] Any video-model plate is text-free and logo-free, and is logged with model, prompt and cost.
- [ ] The track is licensed or generated, and logged.

## 3 · Slots
- [ ] Every slot is filled within its budget (`slots.json`).
- [ ] `inputs`, `pills_*` and `cards` are real product facts.
- [ ] No card shows a metric the caller didn't supply.

## 4 · Clock
- [ ] `hyperframes beats` has been run on the locked track; every shot boundary is on a beat.
- [ ] `ledger.json` was written before `scene.js`.

## 5 · The two rules
- [ ] Accent audit table: ≤ 2 accent objects in every sampled frame.
- [ ] Every ledger seam verified: both sides moving on the named axis and sign, no frame ≥ 90%
      empty ground.

## 6 · Measurement
- [ ] Extruded word widths measured after font load.
- [ ] Lit accent hex measured from a rendered frame and recorded.

## 7 · Gates
- [ ] `lint` clean; `check` at zero findings.
- [ ] `pop_gate.mjs <render.mp4> --max-cuts 0` passes: it is one continuous camera, so any hard cut or single-frame pop is a defect. `seam_sheet.mjs <render.mp4> --auto` viewed.
- [ ] Beat grid: BPM, beat count and the beat of the drop are stated; every prop hit and the camera's big move land on a beat (within 0.15 s); the drop lands on the logo. Fast tumbles are candidates for `scripts/subframe-render.mjs`.
- [ ] CPU render (`--no-browser-gpu`) time recorded.
- [ ] -14 LUFS / ≤ -2 dBTP after encode; audio stream present.

## 8 · Handoff
- [ ] Slots and values, token mapping, measured numbers, seam evidence, accent table, `check`
      output, `COST.md`.
