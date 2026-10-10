# COST: gm-velocity-sting

Measured 2026-10-08 on an Apple M1 Pro (hardware GPU), HyperFrames CLI 0.8.111.

| Build | Brand | Render (`--quality high`, 358 frames) | MP4 | Loudness | Gates |
|---|---|---|---|---|---|
| #1 Greedy Motion | own mark, theme from brand colours | 14.1 s | 2.7 MB | −14.2 LUFS, −3.1 dBTP | check 0 findings (25/25 contrast), 6/6 seams, pacing longest hold 0.567 s |
| #2 Ledgerly (sample product) | invented palette, dark, monogram | 13.1 s | 2.1 MB | −14.2 LUFS, −3.1 dBTP | check 0 findings (24/24 contrast), 6/6 seams, pacing longest hold 0.566 s |

## Per video in fill mode

| Item | Cost |
|---|---|
| Generation APIs (image, video, music, voice) | $0 (none used; the bed is premixed and owned) |
| Claude slot fill (one call, ~2k in / ~1k out on Sonnet) | about $0.02 (estimate; not yet wired into the app) |
| Render compute | ~14 s of one CPU/GPU worker at 1080×1080 |

## Authoring this skill

One agent session (this one), including the template, the builder, the seam verifier and two
test builds: about 1.5 hours wall-clock; Claude token cost not separately metered (subscription).
