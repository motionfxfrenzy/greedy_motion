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

Placement rules live in `backend/src/plan/sound.ts` (`sfxCues`).
