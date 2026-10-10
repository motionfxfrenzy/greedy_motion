# Paper-Diorama Documentary Style ("WHO BLINKS?" playbook)

The second house style: a cinematic vintage paper-diorama documentary —
aged sepia newsprint worlds, censor-bar cutout figures, one burnt-orange
accent, letterpress prop typography, tungsten light, macro tilt-shift.
Born from reverse-engineering a reference video and battle-tested on the
"WHO BLINKS?" nuclear-treaty explainer. Use it when the brief says
cinematic / dramatic / investigative / "like the AI bubble video", or when
the topic is geopolitics, money, or power.

## Style key

Generate this once, then attach the resulting image as a reference to every
clip. Any capable image model works (Nano Banana Pro, GPT Image, Imagen,
Midjourney); match the video's aspect ratio.

The prompt:

```
Cinematic vintage paper diorama style swatch, documentary collage
aesthetic: a miniature three-dimensional landscape built entirely from
aged sepia newspaper sheets and cardboard, torn edges, layered paper
canyon walls of old newsprint, monochrome archival photo cutouts of
anonymous suited figures standing among the paper structures with black
censor bars over their eyes, one dominant burnt-orange paper prop as the
single color accent against the sepia world, distressed letterpress print
texture, warm tungsten documentary lighting with deep shadows, macro
tilt-shift lens look with shallow depth of field, film grain and dust.
Handcrafted physical paper materials only — no letters, no words, no
numbers, no logos. Non-photorealistic scene content, no live-action
people, stylized paper craft world.
```

## STYLE tokens (open every clip prompt with these)

```
cinematic vintage paper diorama, aged sepia newsprint world, monochrome
halftone print, monochrome archival cutout figures with black censor bars
over their eyes, single burnt-orange accent, distressed letterpress,
warm tungsten light, macro tilt-shift shallow depth of field, film grain,
handcrafted stop-motion paper feel, non-photorealistic, no live-action
```

## Prop typography

Unlike the Mixed Media style (which bans all in-clip text), this style
CARRIES short letterpress text on props — that's its signature. One label
per scene, 1–2 words or a number ("EXPIRED", "1,000", "AUGUST",
"WHO BLINKS?"), always described as "distressed letterpress" on a torn
burnt-orange paper element, and always fenced in the negative:
`No text anywhere except "<LABEL>". No gibberish letters…`.

## Reusable prop assets (attach to keep objects consistent)

Generated 1:1 on plain backgrounds with the style key referenced — pass
alongside the style key as extra `image_references` and say "the X from
the reference image" in the prompt so the object doesn't morph between
clips:

| Prop | What it is |
|---|---|
| Paper missile | orange-nosed paper rocket, side-on, plain background |
| Aged front page | newspaper page with a censor-bar portrait |
| Powder keg | keg with a coiled fuse, one letterpress label |
| Leader cutouts | three anonymous suited figures, censor bars, one red tie |

Generate whichever the script needs, keep the returned images, and re-attach
the same file on every clip that shows that object.

Prop prompt shape: 1:1, style key attached, "Single reusable prop asset,
centered on a plain warm off-white paper background… Nothing else in frame."

## Generation settings (diorama clips)

| Setting | Value |
|---|---|
| Type | video |
| Duration | 10s per clip |
| Aspect ratio | 16:9 (or 9:16 if the video is vertical) |
| Resolution | 720p or better |
| Native audio | ON — the engine's own SFX bed survives under the voiceover |
| References | style key image on EVERY clip, plus any prop images used |
| Model tip | a cinematic engine that follows multi-shot prompts ("Shot 1 … Cut to shot 2"), speed ramps and FPV moves, and generates its own sound |

Design the sound in the prompt ("Sound design: fuse crackle, drone,
impacts. No speech.") — a good engine renders it, and it sits under the
narration at assembly.

## Fake-oner block prompt shape

Every clip = one continuous camera move; every boundary hidden in motion
blur so hard cuts read as a single unbroken shot:

```
<STYLE tokens> — shot as ONE continuous high-energy FPV camera move with
aggressive speed ramps.
The shot: [emerges from motion-blurred <previous element>] … [one impact
moment every ~3s: slam / stamp / shockwave / snap] … [ends fully
motion-blurred mid-<dive/whip/fall/flare>].
Sound design: [3–5 concrete diegetic events]. No speech.
No text anywhere except "<LABEL>". No gibberish letters, no captions,
no watermark, no photorealism, no live-action.
```

Worked example (opening block of "WHO BLINKS?"):

```
…shot as ONE continuous high-energy FPV camera move with aggressive speed
ramps.
The shot: from black, EXTREME slow-motion macro of a halftone-printed
human eye on newsprint as a thick black censor bar SLAMS down over it
like a guillotine, paper dust exploding on impact. Violent speed-ramp
pull-back reveals it is a giant newspaper front-page portrait of a
heavyset elderly American statesman with a long red tie; a gust RIPS the
page away revealing a second portrait — a compact stern Russian
statesman — ripped away again to a third — an East Asian statesman —
each rip faster than the last. The camera then DIVES at full speed into a
tearing gap in a giant aged treaty document as a burnt-orange stamp
punches the letterpress word "EXPIRED" across it; the lens plunges
through the torn fibers into swirling paper dust, ending mid-dive fully
motion-blurred.
Sound design: guillotine slam with dust whump, three accelerating page
rips, one massive stamp punch, rushing paper wind. No speech.
No text except "EXPIRED". …
```

## Moderation map (hard-won)

Video engines vary, but these failure patterns recur across platforms:

- **Named politicians in a video prompt** often fail at render even when
  the job submits fine. Names are safe in the voiceover — it's TTS.
- **Close-up recognizable statesman faces** (even described, unnamed) get
  refused by some engines. Mid-shot / full-body descriptions ("heavyset
  leader with a long red tie") pass far more often — and censor bars over
  the eyes both sell the editorial look and defuse likeness issues.
- **"mushroom cloud"** and similar imagery trips nsfw filters. Swap the
  silhouette, keep the idea (an hourglass worked better anyway).
- Some platforms intercept stylized prompts and suggest a photoreal or
  "3D render" preset. Always decline — it destroys the paper look.

## Music

Options: rely on the clips' native drone/SFX bed (usually enough), or
brief an external music generator (Suno/Udio) and mix locally. A measured
brief that matched the reference: ~46 BPM heartbeat pulse, sub-bass drone
+ low cello, almost no highs, 8-second breathing swells, loud open, single
climax at 80% of runtime, rapid decay to silence.
