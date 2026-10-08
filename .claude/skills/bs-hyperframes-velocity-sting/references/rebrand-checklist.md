# Re-brand checklist

Work top to bottom. Stop where it says stop.

## 1 · Fit

- [ ] The brief is a sting, not an explanation. If the ask is "explain what we do", stop —
      this structure has no room for an argument.
- [ ] The product has real surfaces for slots B, C, E and F. If it has no navigation and no
      create affordance, two of seven slots will be invented, and it will show.

## 2 · Rights

- [ ] Brand capture is run **only** against a site the caller owns or holds written
      permission for. Otherwise: ask for a mark and three hex values.
- [ ] No third-party product UI, iconography, or screenshot appears in any slot.
- [ ] The type is either the caller's licensed face or an open substitute, and the handoff
      says which. A licence to use a face in your own work does not cover redistributing the
      files.
- [ ] Faces are registered under a private family name. Renderers silently alias real system
      font names and hand back a substituted face with no error.

## 3 · The slots

- [ ] All seven filled with surfaces the product actually has.
- [ ] Slot A's mark is in two parts.
- [ ] Slot D is one number, and it is a number the product's users would quote.
- [ ] Slot E's rows are the real navigation.
- [ ] Every copy string is inside its budget in `slot-map.md`.

## 4 · The mark

- [ ] The mark's real path bounding box was measured before it was placed.
- [ ] The mark reads at the smallest size it appears at, checked on a render rather than in
      a browser at 100%.

## 5 · Motion

- [ ] The seam ledger was written before the HTML.
- [ ] The axis sequence has no immediate repeat.
- [ ] Both eases are the named functions, not stock built-ins with similar names.
- [ ] Choreography is stamped; only curves are tweened.
- [ ] Nothing floats, breathes, or pulses to fill time.

## 6 · Measurement

- [ ] Every number depending on rendered text width was measured from a settled frame of an
      actual render and pasted back.
- [ ] For a highlighted row, the measurement was taken from a frame *before* the highlight
      arrives — otherwise the highlight is included and the row grows on every render.

## 7 · Gates

- [ ] `npx hyperframes lint` clean.
- [ ] `npx hyperframes check` at zero findings, including contrast.
- [ ] Every ledger row verified: both sides moving, on the named axis, in the named sign.
- [ ] The render watched at full speed. Nothing sits still at a cut; the highlight lands on
      the row it was meant to; the endcard reads.

## 8 · Handoff

- [ ] The seven slots and what was put in each.
- [ ] The four brand tokens.
- [ ] The rights position on the mark and on the type.
- [ ] Every measured number, and the frame it was measured from.
- [ ] The `check` output, pasted.
