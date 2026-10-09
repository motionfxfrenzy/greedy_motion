# Routing: which skill builds each beat, and what it must be told

Every beat in `beat-plan.json` names its producer and carries the instructions that producer
needs. Paths are relative to the repo.

| Beat kind | Producer | Skills the producer loads | The plan must give it |
|---|---|---|---|
| `ui` | HyperFrames (template engine or agent) | `/hyperframes-core`, `/motion-doctrine`, `/cut-the-curve`, `/oversized-cursor`, the template's `gm-*` skill | the screen (real screenshot / surface id), the action (`click·type·drag·toggle·count·send`), the target, the verb word, the camera (push / pan, %), entry and exit vectors, the key phrase |
| `kinetic` | HyperFrames | `/hyperframes-animation` (text effects), `/motion-doctrine`, `/cut-the-curve` | the phrase, the accent word, the text-effect name, entry and exit vectors, energy |
| `3d` (brand-exact objects) | Three.js in HyperFrames (GPU queue) | `/hyperframes-animation` (Three.js adapter), `/hyperframes-keyframes` | the object (mark, keycaps, cards), material, camera move, physics feel from the motion profile, the style frame to match |
| `3d` (organic scene) | Nano Banana → Veo 3.1 | `third_party/visual-skills/image` (`models.md` → `nano-banana.md` → `golden-rules.md` + `dimensional.md`, `creative-direction.md`); `third_party/visual-skills/video` (`veo.md`, `animatic-keyframes.md`, `camera-lighting-vocabulary.md`); `docs/MOTION_PIPELINE.md` §3 rules | keyframe prompt fields (subject, composition, light, materials, brand hexes, blank surfaces), the Veo camera move matching the seam vector (`veo_vector`), the duration to keep, the end-frame method (crop for pushes) |
| `footage` (person) | Nano Banana (character sheet → shot keyframe) → Veo 3.1 (with dialogue) | `third_party/visual-skills/image/references/characters.md`, `de-slop.md`; `video/references/veo.md` (dialogue syntax, voice modifiers, timing rule), `camera-lighting-vocabulary.md`; script-for-motion → Footage beats | character id, `shot` (framing, camera, action), `screen` (replace/blank/away), the `dialogue` line and voice modifier, the overlay, the duration |
| `title` (lockup, CTA) | HyperFrames | `/hyperframes-core`, `/motion-doctrine` | the brand files (never generated), the closing line, the CTA, a landed hold ≥ 1.2s with gentle motion |
| Voiceover | Kokoro (`hyperframes tts`) or Gemini TTS | `/media-use` (voice, transcription) | the full VO text per beat, the voice, pace ~140–160 wpm, energy matching the motion profile, inter-sentence gaps (Pacing) |
| Music | Lyria (`lyria-3.5` / `lyria-3-pro-preview`) or the owned library | `/media-use`, `/hyperframes-audio` (ducking) | mood, tempo, instruments matching the motion profile, where the energy peaks (the success moment), length; no artist names |
| SFX | Lyria clip or the licensed library | `/media-use`, `/hyperframes-audio` | one per transition, a hit on the success moment, UI clicks on actions |
| Captions | HyperFrames | `/captions-overlay` | mode (key phrases only / full captions), from the real transcript |

## Motion profile → instructions

| Profile | Eases | Durations | Camera | Copy and voice |
|---|---|---|---|---|
| `snappy` | crisp ease-out (`expo.out`), no overshoot | 250–400ms | short, decisive pushes | terse, technical; brisk read |
| `smooth` | long heavy ease-out (`power3.out`) | 400–700ms | slow dollies, long parallax | calm, assured; measured read |
| `springy` | damped spring, small overshoot | 300–500ms | arcs, playful whips | warm, playful; bright read |

## Fallbacks (required for every generated beat)

| Generated beat | Fallback |
|---|---|
| `3d` organic (Veo) | Three.js brand object, else a `kinetic` beat with the same phrase |
| `3d` Three.js | `kinetic` beat (if no GPU worker is available) |
| `footage` | a `ui` beat of the same action with a mascot or avatar |
