# Gemini vs Claude as the brain of the painted-shorts doodle pipeline (2026-10-28)

Topic: "A girl and her grandfather plant a lemon tree on a windy hill, and over the seasons it grows while he grows older." Style doodle:marker, 720 px, same Mac GPU, both brains run in parallel (Claude started later after a restart, so compare stage times, not wall clock). Models: gemini-3.1-pro-preview vs claude-opus-5-5. Voice (Gemini TTS) and music (Lyria) are the same for both.

Raw data: `var/brain-compare/run1/data.json` (worktree VideoSaaS-pgboss-main), per-brain `run.log` (timestamped), `trace.jsonl` (every language call), `collect.py` regenerates data.json. Crashed first attempts are kept in `claude-crashed/`, `gemini-crashed-render/`.

## Outcome
| | Gemini | Claude |
|---|---|---|
| Film produced | yes (69 s, 7.7 MB) | **no**, stopped by the user at 30:36 still drawing props |
| Script | 11 lines, 51 s | 13 lines, 10 s |
| Director + supervisor | 247 s, supervisor 23 fixes of 27 | 68 s, supervisor 4 of 4 |
| Director output | 16 shots, all one place (hills), 3 custom objects | 17 shots, 3 places (hills, interior, village), more custom objects (fence, armchair, watering can, scarf, soil, tree), 2 detail lines |
| Prop drawing (oracle + vision check) | 755 s, 9 checks, scores 4-5/10 (avg 4.3) | 30 min and unfinished, 14 checks, scores 3-5/10 (avg 4.25), 2 oracle timeouts, 4 "ellipse exceeds its local box" |
| Language-call totals | 14 calls, 441 s, 30k in, 7k out, 50k thinking tokens, 2 failed (output-token limit on the first director try) | 17 calls, 242 s, 32k in, 20k out, 0 failed |
| Engine crash | painter: "Object sapling has no support surface" (fixed) | lint: "unsupported state change for lemon_tree" (fixed) |
| Music | Lyria refused once, retry worked | not reached |

## Reading
- Claude wrote the better story (concrete 3Blue1Brown-style lines, seasons, an interior winter scene, the lemon in his palm) and drew up a richer spec; its cost is that every extra object goes through the slow oracle + vision-check loop (about 1-2 min per object, scores stay 3-5/10), so it never finished.
- Gemini's spec was thinner (one place, a generic tree, repeated poses) but cheap enough to finish; it needed a director retry (output-token limit) and its supervisor made many fixes (23 of 27).
- Neither brain made the lemons appear: both left them to the engine (now fixed in lint: tree `fruit`). Neither added the close "moment worth seeing" without prompting for this story.
- Both brains crashed the pipeline once on a near-miss in their JSON (engine brittleness, fixed).
- Quality gaps are engine-side as much as brain-side: custom props score 3-5/10 whichever brain asks for them.

## Open
Claude's film was never rendered; to finish: raise the oracle's per-object timeout, cap retries per object, draw simple known kinds natively (fruit, bench, chair, can) instead of recipes, then re-run Claude with `--spec var/brain-compare/run1/claude/work/spec.raw.json` (saves the director step).

## Run 2 (engine commit c90e22c plus fixes: native props, batch sheet review, parallel voice+music, supervisor gate)
Same topic, both brains started at the same moment, data in `var/brain-compare/run2/` (data.json, run.log, trace.jsonl, film.mp4 per brain, compare-frames.png).

| | Gemini | Claude |
|---|---|---|
| Result | film, 78.7 s, 11.5 MB, **285 s total** | film, 82.9 s, 14.1 MB, **about 488 s** (462 s, painter crash "person on a chair has no surface", fixed, then 25 s re-render from the saved spec) |
| Script | 11 lines, 15 s | 14 lines, 8 s |
| Director | 55 s, 3.5k tokens out | 88 s, 10.5k tokens out |
| Spec | 17 shots, 6 close, 1 place (hills), 6 recipes | 31 shots, 15 close, 2 places (hills 23, interior 8), 35 recipes |
| Prop drawing + sheet checks | 174 s, 2 batch checks (18 s), 1 oracle failure | 324 s, 2 batch checks (32 s), 3 oracle timeouts (hats) |
| Voice + music (parallel) | 26 s | 31 s |
| Paint + encode | 15.5 s | 18 s |
| Language calls | 4, 88 s | 4, 129 s |
| Props below 6/10 | 2 of 6 | 5 of 35 |

Against run 1: Gemini 285 s vs 19 min and a crash; Claude about 488 s vs unfinished at 30 min.
Both films: lemons now hang on the tree, same two characters in every shot, no path unless the story has one. Shared defects: the detail camera still zooms to legs and the ground in some close shots (sapling between two pairs of legs); Claude's last shot has a lemon floating above the girl's head; Claude's spec is richer (interior, sunset, spade, scarf) but costs more oracle time.

## Cost of run 2 (per film, estimated)
Prices: Claude Opus 5.5 $4 in / $20 out per MTok (Anthropic price table). Gemini 3.1 Pro Preview $2 in / $12 out per MTok, thinking billed as output (web sources; one aggregator lists $1/$6, likely the batch rate). Voice (Gemini TTS) and music (Lyria) are the same for both brains and not priced here.

| | Gemini brain | Claude brain |
|---|---|---|
| Brain calls (script, director, 2 sheet checks), from `trace.jsonl` | 12.1k in, 4.2k out + 6.9k thinking = **$0.16** | 16.9k in, 13.6k out = **$0.34** |
| Artist/oracle (Gemini 3.1 Pro for both brains), estimated | about 5 calls = $0.57 | about 11 calls = $1.25 |
| Total, estimated | **about $0.73** | **about $1.59** |

The oracle calls were not traced in run 2 (tracing added afterwards). One oracle call measured on 3 samples: about 2.2k in, 2.1k out and 7.0k thinking tokens = $0.11, so the artist's thinking tokens cost more than the whole brain. Call counts are estimated from the logs (drawn objects + second-round redraws + failed attempts); objects found in the shared recipe cache cost nothing. The oracle is the lever: native props and the shared cache cut cost more than the choice of brain does.
