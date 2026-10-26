# Motion personalities: how a brand's character becomes a video

Written 2026-10-09 for the showreel module system (`worker/templates/showreel/`). A brand does not pick "an animation style" from a list; it has a
personality, and the personality decides which modules may appear, how fast everything moves, what the palette and type do, and what the music and
sound sound like. One personality is locked for the whole film (mixing two reads as a mistake: the viewer feels it before they can say why).

## What the research says

| Finding | Source |
|---|---|
| Personality maps to speed and easing. Calm brands use slow fades and gentle scaling; bold brands use rapid transitions and sharp cuts; playful brands bounce and spring; luxury prefers smooth, elegant motion with longer timings; tech brands are snappy and precise. | [Prolific Studio](https://prolificstudio.co/blog/what-is-motion-branding/), [Octopus](https://www.octopusmarketing.agency/blog/the-language-of-brand-motion-conveying-stories-through-movement/), [Dawn](https://www.wearedawn.co.uk/insight/building-a-motion-identity/), [Everything Design](https://www.everything.design/blog/motion-brand-guidelines) |
| Interface motion lives at 150-400 ms (Atlassian) or 200-500 ms (Material). Too quick feels anxious, too slow drags. A film can run slower than UI, but should keep the same ratios: fast tokens, medium tokens, slow tokens, used consistently. | [Atlassian Design](https://atlassian.design/foundations/motion) |
| Expressive motion is saved for key moments; everyday motion stays efficient. Personality shows in restraint and polish, not spectacle; a bold brand does not use its most dramatic motion on frequent interactions. | [Atlassian Design](https://atlassian.design/foundations/motion) |
| Explainers: about 150 spoken words a minute (130 reads authoritative); 60-90 s is the sweet spot, motion-graphic explainers run shorter; one or two graphics per scene, every scene must advance the message; give a short line about two seconds to read; ease everything (constant-speed motion is the clearest amateur signal) and overlap entrances a few frames apart. | [Vyond](https://www.vyond.com/blog/explainer-video-best-practices/), [Pexo](https://pexo.ai/tutorial/how-to-make-a-motion-graphics-explainer-video), [Yum Yum Videos](https://www.yumyumvideos.com/blog/explainer-video-length/) |
| Kinetic type: hook in 0-3 s with one powerful phrase; 3-7 words a beat; one idea at a time; animate the nouns and numbers (the "what" and "how much"), verbs can stay steady; strong scale and weight contrast; 1-2 fonts, 2-3 weights, a few motion presets; contrast of 4.5:1 (3:1 large) must hold in the in-between frames too; do not flash more than three times a second. | [Today Made](https://www.todaymade.com/blog/kinetic-typography-examples), [Upskillist](https://www.upskillist.com/blog/typography-in-motion-7-design-principles/), [Influencers Time](https://www.influencers-time.com/boost-short-form-views-with-kinetic-typography-in-2025/) |
| Calm / premium: ease-in-out or ease-out over 2-3 s on a soft or neutral ground with a lot of negative space; a static camera; slow but never static; one gesture (a ripple, a bloom, a line draw) tied to the brand; resolve on a settled, centred lockup; sound is breath, bell, water, a soft hit with short reverb, not a trailer boom. | [Render Forest](https://www.renderforest.com/blog/logo-animation-trends), [Marco Cagnina](https://marcocagnina.com/blog/best-logo-animations-2026), [Pixel Free Studio](https://blog.pixelfreestudio.com/best-practices-for-combining-motion-design-and-minimalism/) |
| Slack's motion guide uses staging, anticipation, follow-through and overshoot to keep motion "playful, not silly": the classical principles, applied with restraint. | [Everything Design](https://www.everything.design/blog/motion-brand-guidelines) |

The two benchmark showreels (`docs/BENCHMARKS.md`) are the production reference for bold (dark, perspective, hits) and for calm/systematic (light, framed, layered).

## The profiles we ship

The numbers are starting points, tuned against the benchmark measurements (mean motion 0.015-0.035, at most one hard hit) and the research above.

| | **Bold** | **Calm** | **Explainer** | **Playful** | **Premium** |
|---|---|---|---|---|---|
| Ground | Dark, brand colour as glow; or a solid brand-colour flood | Light, soft gradient, lots of space | Light, bright, dotted paper | Light, saturated accent blocks | Black or deep ink, one metallic accent |
| Tempo, scene length | 120 BPM, 2-4 beats (1-2 s) | 90 BPM, 4-6 beats (2-3 s) | 100 BPM, 4-6 beats (2.4-3.6 s) | 120 BPM, 3-4 beats | 90 BPM, 5-6 beats |
| Easing | power4 out; power3 in-out | power2 out; sine in-out | power3 out; clear ease | back/spring | power2 out, long |
| Springs (damping) | 0.5 pops only | 0.8 (almost none) | 0.65 | 0.4 (clear) | 0.85 |
| Transitions | whip-x, whip-y, zoom-through, flood, cover-wipe | push, iris, cover-wipe | push, whip-x, iris | iris, flood, whip-y | push, iris |
| Camera | Perspective dives, pushes, one big hit | Static or very slow push | Pans that follow the point being made | Bouncy zooms | Slow, deliberate pushes |
| Type | Heavy grotesk, huge, waterfall rise, accent word | Serif or light grotesk, soft rise | Friendly grotesk, steady reads, 2 s a line | Rounded display, bounce | High-contrast serif, wide tracking |
| Scenes it likes | typed hook, kinetic lines, tilted field, wall, stat, burst end | typed hook (plain), app window, trio cards, split compare, hub, calm end | kinetic hook, chat demo, step path, trio (numbered), split compare, CTA end | trio, hub, stat, burst or calm end | app window, split compare, stat, calm end |
| Music, sound | Four-on-the-floor, drop; punchy hits, whooshes | Soft pads, light pulse; soft pops, bell | Light groove; clicks, pops | Bright bounce; pops, chimes | Slow, warm; soft hits, long reverb |
| Ending | Shards and flood, mark, name, URL pill | Soft bloom, mark settles, line rises, URL | Recap ticks, one clear call to action | Burst or bloom | Settled lockup |

How the personality is chosen when the brand does not say: saturation and lightness of the primary colour (dark and saturated leans bold; pale and low-saturation leans calm; a
bright mid-tone leans playful), keywords in the brief ("bold", "calm", "explain"), and the video's purpose (explainer wins when the brief is "explain how it works").
The choice is recorded in the plan and can always be overridden.
