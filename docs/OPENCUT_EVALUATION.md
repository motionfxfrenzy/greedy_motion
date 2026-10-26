# OpenCut evaluation

Date: 2026-10-08. Source: `OpenCut-app/OpenCut` at commit `e668010778568641babef2cc40be4703ae6916d6`, cloned into the git-ignored `experiments/OpenCut/` directory. This is a source inspection; dependencies were not installed and the app was not run.

## Finding

The linked repository is an early rewrite, not an editor we can embed today. Its [README](https://github.com/OpenCut-app/OpenCut/blob/e668010778568641babef2cc40be4703ae6916d6/README.md) lists the Editor API, plugins, MCP server, headless mode, and shared Rust core as upcoming. The [web editor route](https://github.com/OpenCut-app/OpenCut/blob/e668010778568641babef2cc40be4703ae6916d6/apps/web/src/routes/editor.tsx) renders “Coming soon”; the [desktop timeline](https://github.com/OpenCut-app/OpenCut/blob/e668010778568641babef2cc40be4703ae6916d6/apps/desktop/src/panels/timeline.rs) and [preview](https://github.com/OpenCut-app/OpenCut/blob/e668010778568641babef2cc40be4703ae6916d6/apps/desktop/src/panels/preview.rs) are labeled placeholder panels. The [API](https://github.com/OpenCut-app/OpenCut/blob/e668010778568641babef2cc40be4703ae6916d6/apps/api/src/index.ts) has health and echo routes. There is no usable timeline model, media compositor, player, or export interface in this checkout.

## What we can use

| Candidate | Assessment for VideoSaaS |
|---|---|
| [FFmpeg setup manifest and script](https://github.com/OpenCut-app/OpenCut/tree/e668010778568641babef2cc40be4703ae6916d6/crates/media/setup) | **Use the packaging pattern, not the script.** It pins a source version and SHA-256 hashes, verifies downloaded archives, stages installation atomically, and saves build flags and LGPL notices. Our `worker/Dockerfile` currently installs `ffmpeg` from Debian without a version pin. A checksum-backed or snapshot-pinned executable would improve reproducibility when `RENDER-03` is hardened. OpenCut's actual build disables FFmpeg programs and avfilter, so it cannot replace our worker's `ffmpeg` command; the script also requires Bun and targets a native media crate we do not have. |
| [Resizable desktop panels](https://github.com/OpenCut-app/OpenCut/blob/e668010778568641babef2cc40be4703ae6916d6/apps/desktop/src/components/resizable.rs) | Useful as a small interaction reference (minimum sizes, double-click reset), but written for Rust GPUI. Our Studio is React and has a product-specific layout, so copying it would introduce a different UI runtime for no clear gain. |
| [Web resizable wrapper](https://github.com/OpenCut-app/OpenCut/blob/e668010778568641babef2cc40be4703ae6916d6/apps/web/src/components/ui/resizable.tsx) | A thin wrapper around `react-resizable-panels`, with no editor-specific behavior. If Studio later needs resizable panels, use the library directly and style it to our design. |
| Editor, timeline, preview, API, headless rendering | No implementation to reuse in this revision. The existing [Studio editor decision](STUDIO_EDITOR_DECISION.md) remains appropriate: product-owned editing UI over the HyperFrames preview and render clock. |

The repository is [MIT licensed](https://github.com/OpenCut-app/OpenCut/blob/e668010778568641babef2cc40be4703ae6916d6/LICENSE). Its README points to [opencut-classic](https://github.com/OpenCut-app/opencut-classic) for a working editor today, but that separate repository is archived and unmaintained. It was not cloned for this evaluation.

**Decision:** keep the clone as a reference. Do not vendor or integrate OpenCut code into the product now. Carry the checksum and atomic-install ideas into the existing worker image hardening work; revisit the rewrite if it ships a stable editor API or a headless core with a clear HyperFrames interoperability path.
