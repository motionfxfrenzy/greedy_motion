# Beat-plan SFX

Copied from the HyperFrames `media-use` skill's bundled library (`.claude/skills/media-use/audio/assets/sfx/`).
All files are from [Pixabay](https://pixabay.com/sound-effects/) under the
[Pixabay Content License](https://pixabay.com/service/license-summary/): commercial use, modification and
redistribution inside rendered videos, no attribution required (given here for transparency).

| File | Used for | Sync point (s into the file) |
|---|---|---|
| `whoosh-short.mp3` | moving cuts (whip, push-through, brand-field wipe) | 0.155 (peak) |
| `click.mp3` | the cursor's press on a UI action | 0.024 (onset) |
| `pop.mp3` | a count or toggle result | 0.094 (onset) |
| `chime.mp3` | the success moment | 0.407 (onset; the file starts with 0.4 s of silence) |
| `typing.mp3` | the `type` action | 0.443 (onset) |
| `impact-bass-1.mp3` | a high-energy kinetic hook | 0.024 (onset) |

The nine `foley-<kind>.mp3` files are **generated in-house by our own foley synthesiser** (`scripts/foley/foley.mjs`,
rebuilt with `node scripts/foley/build-sfx.mjs`): no third-party audio and no third-party licence. A template pack's scenes
export `sounds: [{ kind, frame }]` and each is mixed as `foley-<kind>` on that frame (`backend/src/plates/scene-sounds.ts`).

| File | Used for | Sync point (s into the file) |
|---|---|---|
| `foley-mark.mp3` | the marker putting the dot on (scrape + tap) | 0 |
| `foley-tuft.mp3` | wool tufts flying (flutter + cloth) | 0 |
| `foley-thud.mp3` | a body hitting the ground | 0 |
| `foley-step.mp3` | one step on dirt | 0 |
| `foley-shuffle.mp3` | a crowd shuffling (five light steps + cloth) | 0 |
| `foley-bleat.mp3` | a short frightened bleat | 0 |
| `foley-whoosh.mp3` | a fast move, a hand swinging in | 0 |
| `foley-hit.mp3` | a heavy impact | 0 |
| `foley-drop.mp3` | a small thing dropped (tap + light thud) | 0 |

Placement rules live in `backend/src/plan/sound.ts` (`sfxCues`).
