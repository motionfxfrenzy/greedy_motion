# COST — gm-feature-explainer, test build #1 (Greedy Motion)

Agent: Claude Opus 5.5. Renderer: HyperFrames CLI 0.8.111 (`worker/node_modules/.bin/hyperframes`), local Apple
M1 Pro, `--workers 3`. No shared worker containers, backend, queue or Postgres.

## Wall-clock by phase (2026-10-04, local time; the whole session also wrote the skill and build #2)

| Phase | Time | Notes |
|---|---|---|
| Read authoring skill, templates, library docs, analysis, both reference skills, previous chat-launch build | 16:04 → 16:12, ~8 min | |
| Walk the Relay v3 design handoff in a browser (Goal → Review, Templates, Library) | ~4 min | |
| Engine, interface CSS, content, pipeline | ~7 min | engine written once, generic from the start |
| VO (local Kokoro, 10 lines) | 60 s, then ~5 s re-runs (cached lines) | |
| Clock: transcript + building the verb-onset probe | 16:19 → 16:34, ~15 min | the main defect of this build (whisper drift) |
| Lint/check debugging (bundler dropped engine.js, Studio rewrote HTML, file size) | ~6 min | |
| Render 1, sync verifier, review, fixes | ~6 min | |
| Fold-back from build #2, final re-time, re-mix, re-render | 17:03 → 17:13, ~10 min | |
| **Total for build #1** | **≈ 60 min** | |

`pipeline.py timing` itself: ~1–2 min per run (≈ 60–120 short whisper calls for the grid probe).

## Render times

| Render | Frames | Time |
|---|---|---|
| Local, `--quality high`, hardware GPU, 3 workers (4 runs) | 1498–1501 | 47.4–50.6 s (final 50.6 s) |
| **Production-equivalent CPU**: `docker run --cpus=4 --memory=6g … --quality standard --no-browser-gpu --workers 3` | 1501 | **112.3 s render, 115 s wall** (software GPU; capture 61.8 s, encode 38.0 s) |

First CPU timing on the pre-fold-back build (49.9 s film): 119.1 s render / 124 s wall.

**Railway cost of the CPU render** (4 vCPU, 6 GB, 112.3 s = 1.872 min):
4 × 1.872 × $0.000463 = $0.00347 vCPU + 6 × 1.872 × $0.000231 = $0.00259 memory = **$0.0061 per render**
($0.0062 on 115 s wall).

## API spend

| Item | Calls | Cost |
|---|---|---|
| Voiceover — local Kokoro (`hyperframes tts`) | 10 lines + re-runs | $0 |
| Gemini TTS fallback | 0 | $0 |
| Lyria | 0 (not called, as instructed) | $0 |
| Transcription — local whisper `small.en` | ~250 short clips | $0 |
| Gemini vision (`snapshot --describe`) | 0 (`--describe false`) | $0 |
| **Total new API spend** | | **$0.00** |

Reused, already-paid media: the bed `music_v2.mp3` (Lyria 3 Pro, $0.08 in an earlier session).

## Claude tokens (estimate; exact counts are not visible from inside the session)

Whole session (skill + both builds + fill mode): ~170 tool turns, context growing to ~200 k.
Cache read ≈ 18 M, cache write ≈ 0.5 M, uncached input ≈ 0.1 M, output ≈ 110 k.
At $4/M input, $5/M cache write, $0.20/M cache read, $20/M output: ≈ $0.4 + $2.5 + $3.6 + $2.2 ≈ **$8.7
(range $6–12)** for the session; build #1's share ≈ 45% ≈ **$4**.

## Projected per-video cost of this skill

- **Fill mode** (template + new `content.json`): VO + clock + mix ≈ 3–4 min local CPU, render ≈ 2 min on the CPU
  worker ($0.006), plus the planner's slot-fill call (~$0.03–0.06). ≈ **$0.05 per video**, $0 API.
- **Author mode** (new screen kind or layout): ≈ 30–60 min agent time, ≈ $3–6 tokens.
