# Remotion vs HyperFrames sample (2026-10-08)

Claude Opus 5.5 generated the same eight-second, square, silent Ledgerly motion graphic separately for Remotion 4.0.534 and HyperFrames 0.8.111. The Remotion implementation and media were removed after the evaluation. The remaining HyperFrames source, MP4, frame strip, prompt, and run records are in the local, git-ignored `experiments/ledgerly-hyperframes-sample/` folder.

## Method and generation

The two calls used one creative brief and similarly sized framework primers: 2,004 prompt bytes for Remotion and 2,027 for HyperFrames. The API key and `claude-opus-5-5` model came from `backend/.env`; no key was saved in the experiment. Both initial calls exhausted a 12,000-token output cap. Remotion returned truncated TSX; HyperFrames returned no source text. Each was retried from scratch at 26,000 tokens, and both successful responses ended normally. The model authored the compositions; manual edits only matched local font filenames, added bold font faces in Remotion, and resolved the HyperFrames overlap and contrast findings.

| Observation | Remotion | HyperFrames |
|---|---:|---:|
| Successful Claude generation, second call | 162.05 s; 17,513 output tokens (7,712 thinking) | 131.78 s; 14,296 output tokens (5,986 thinking) |
| Generated source size before repairs | 22,710 bytes | 17,021 bytes |
| Final export | H.264, 1080×1080, 30 fps, 8.0 s | H.264, 1080×1080, 30 fps, 8.0 s |
| Export size | 1,028,384 bytes | 2,650,399 bytes |
| Five-worker warm render, one local run | 26.05 s | 6.97 s |
| Validation | Composition discovery and full render passed | `hyperframes check`: 0 errors, 5 structural lint warnings |

Both films are usable. The Remotion version has strong typography and an invoice-to-dashboard story, though its dashboard briefly appears mostly empty during the reveal. The HyperFrames version keeps dashboard detail visible through that beat. Both had minor font path repairs after generation. HyperFrames also needed an intentional rolling-digit overlap marked and an initial number color brightened after its automated check.

The times are a single warm run on an Apple M1 Pro with Node 26.9.0 and five workers. Encoding quality settings were each engine's default (HyperFrames `looks`/CRF 16), so the measurements do not establish a general speed ratio or quality ranking.

**Decision:** keep HyperFrames as the product's primary renderer. The worker, templates, preview/player, skills, and release checks already use it; this sample passed its browser check and rendered well. Remotion is technically viable for React-centric formats, but adopting it would add another renderer and preview path. HyperFrames is [Apache-2.0 licensed](https://github.com/heygen-com/hyperframes/blob/main/CREDITS.md). Remotion's [Company License pricing](https://www.remotion.dev/docs/license/pricing) becomes relevant above three people; its [FAQ](https://www.remotion.dev/docs/license/faq) permits LLM-generated Remotion code in a rendering service but restricts services that render arbitrary uploaded Remotion code.

Revisit the choice when a real planned format exposes a HyperFrames limitation that Remotion solves, then test that format with matched media and output settings.
