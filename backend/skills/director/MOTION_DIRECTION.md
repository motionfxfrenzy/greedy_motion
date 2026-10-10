# Motion direction: typography (what the director sets per beat)

Sources: `/motion-doctrine` (timing intents, stillness before climax, one ease intent per family), `/cut-the-curve` (§6 waterfall entry, kinetic text), `/hyperframes-animation` → `adapters/animate-text.md` (the 24-effect vocabulary; the engine implements the eight below).

Set `text_effect` on every `kinetic` and `title` beat (null on `ui` beats). One effect per beat; the film uses **at most three different effects** so it reads as one design system, and the same role gets the same effect each time it appears.

| Effect | Looks like | Use for |
|---|---|---|
| `waterfall` | words rise in a decaying stagger, last word lands heaviest (the house default) | any beat; the safe choice |
| `per-character-rise` | letters rise one by one, fast | short key phrases (≤ 3 words): hooks, the success beat |
| `typewriter` | letters appear stepped, no interpolation | a typed or "generated" feeling; a question hook; never more than 3 words |
| `stagger-from-center` | letters pop outward from the middle | one- or two-word punches: "Shipped.", "Meet Linear" |
| `soft-blur-in` | words resolve from blur, soft and unhurried | calm problem beats; smooth profile; 3–4 words |
| `spring-scale-in` | words overshoot in with a spring | energetic reveals and success; springy profile |
| `mask-reveal-up` | words slide up out of a clip | clean feature or proof beats, editorial tone |
| `depth-parallax-words` | words push in from large and blurred | the reveal of the product, a big claim; ≤ 1 per film |

Rules:
- Match energy: `high` → per-character-rise, spring-scale-in, stagger-from-center, depth-parallax-words; `medium` → mask-reveal-up, waterfall; `calm` → soft-blur-in.
- Match the film's motion profile: snappy → per-character-rise, mask-reveal-up; smooth → soft-blur-in, mask-reveal-up, waterfall; springy → spring-scale-in, stagger-from-center.
- A hook gets the strongest effect of the film (it has 3 s to land); the CTA gets a clean one (mask-reveal-up or waterfall), because it must stay readable and land.
- Never the same effect on three beats in a row; alternate with `waterfall` as the neutral.
- Forbidden: typewriter on a beat with a voiced line longer than the typing time; any effect that makes the key phrase unreadable before the voice finishes its first clause.
