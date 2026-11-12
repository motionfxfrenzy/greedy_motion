# Per-step model routing

Every AI call in the backend is a named **step**. Each step can be pointed at any model from any supported provider
with environment variables, no code change. With nothing set, every step behaves exactly as before.

Code: `backend/src/models/` (`steps.ts` the table, `routes.ts` parsing and boot validation, `providers.ts` the one provider
layer `callModel` / `streamModel`, `prices.ts` the price table). Tests: `backend/test/model-routing.mjs`,
`backend/test/model-routing-sites.mjs`.

## Providers

| provider | value | key env | notes |
|---|---|---|---|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | prompt cache via `cache_control`; effort via `output_config.effort`; max output 128k |
| Gemini | `gemini` | `GEMINI_API_KEY` | implicit prompt cache; effort via `thinkingConfig.thinkingLevel`; max output 65,536 |
| OpenAI-compatible (Qwen, DeepSeek, MiniMax, GLM, Kimi, OpenAI...) | `openai-compatible` (alias `openai`) | `OPENAI_COMPATIBLE_API_KEY` | needs a base URL; max output 32,000 unless known |

## Env format

```
MODEL_<STEP>=provider:model        # e.g. MODEL_SCENE_WRITER=gemini:gemini-3.8-flash
EFFORT_<STEP>=low|medium|high|xhigh|max
MAX_TOKENS_<STEP>=24000
BASE_URL_<STEP>=https://...        # openai-compatible only (or OPENAI_COMPATIBLE_BASE_URL)
MODEL_DEFAULT=provider:model       # every routable step with no setting of its own
```

A bare `claude-...` or `gemini-...` model id works without the prefix. Precedence, highest first:
`MODEL_<STEP>` > the parent step's `MODEL_<PARENT>` > the old per-step variable (`SCRIPT_MODEL`, `PLATE_MODEL`, ...) >
`MODEL_DEFAULT` > the code default. The old variables keep working as aliases.

Boot fails with one message listing every problem: unknown provider or step setting, bad effort or limit, a step routed to a
provider it cannot use, and a missing key for any provider a step actually uses.

## Steps

| step (`<STEP>`) | what it does | default today | other providers |
|---|---|---|---|
| `script` (SCRIPT) | brief to script (JSON) | tier table (Standard `gemini-3.8-flash`, Premium `claude-opus-5-5`) | yes |
| `scriptWrite` (SCRIPT_WRITE, parent script) | canvas script writer and revisions, streamed, effort low | tier table | yes |
| `sceneInsert` (SCENE_INSERT, parent script) | write one inserted scene | same | yes |
| `director` (DIRECTOR) | storyboard / plan | anthropic `claude-opus-5-5` (old: `DIRECTOR_PROVIDER`, `DIRECTOR_MODEL`) | yes |
| `frameSketch` (FRAME_SKETCH) | SVG frame sketch | tier table | yes |
| `motion` (MOTION) | motion direction per frame | tier table | yes |
| `screenshot` (SCREENSHOT) | reads uploaded screenshots (images) | tier table (Standard `gemini-3.8-flash`) | yes (needs vision) |
| `voiceAlign` (VOICE_ALIGN) | word times from audio | gemini `gemini-2.5-flash` | Gemini only (audio input) |
| `sceneWriter` (SCENE_WRITER) | plate scene canvas code | tier table | yes |
| `sceneRepair` (SCENE_REPAIR, parent sceneWriter) | repair rounds (policy, bundling, cut-off) | same as sceneWriter | yes |
| `formatFill` (FORMAT_FILL) | template slot fill (JSON) | `ANTHROPIC_MODEL` | yes |
| `proAssistant` (PRO_ASSISTANT) | Pro editor source edits (JSON) | `ANTHROPIC_MODEL` | yes |
| `skillRouting` (SKILL_ROUTING) | picks author skills | `ANTHROPIC_ROUTING_MODEL`, haiku 4.5 | yes |
| `rewriteBeat` (REWRITE_BEAT) | rewrite one frame's words | `ANTHROPIC_MODEL` | yes |
| `elementEdits` (ELEMENT_EDITS) | comment to element patch | `ANTHROPIC_MODEL` | yes |
| `planner` (PLANNER_FILL) | starter template slot planner (Anthropic tool use or Gemini/OpenAI structured JSON) | `ANTHROPIC_MODEL` | yes |
| `siteRead` (SITE_READ) | reads a website | gemini `gemini-2.5-flash` (old: `SITE_READ_MODEL`) | Gemini only |

Not routed (other modality, own variables): text to speech, music, `VISUAL_IMAGE_MODEL`, `VISUAL_VIDEO_MODEL`.

`MODEL_DEFAULT` skips the steps that only work with one provider (`voiceAlign`, `siteRead`).

## Examples

All Gemini, as the owner's research chose it (2026-11-09; an env example, not a default). Argon writes script and chat, 3.8 Flash writes the storyboard JSON, template planner slots, and the scene code:

```
MODEL_DEFAULT=gemini:gemini-3.8-flash       # covers sceneWriter, frameSketch, motion, planner, formatFill, proAssistant, screenshot, skillRouting
MODEL_SCRIPT=gemini:gemini-4-argon          # also scriptWrite and sceneInsert
EFFORT_SCRIPT=low                           # thinking_level LOW (MEDIUM also fine)
MODEL_REWRITE_BEAT=gemini:gemini-4-argon    # chat / edit instructions
EFFORT_REWRITE_BEAT=low
MODEL_ELEMENT_EDITS=gemini:gemini-4-argon
EFFORT_ELEMENT_EDITS=low
MODEL_DIRECTOR=gemini:gemini-3.8-flash      # storyboard / beat plan, JSON schema
EFFORT_DIRECTOR=medium
# fallbacks: MODEL_SCRIPT=gemini:gemini-3.8-flash, MODEL_DIRECTOR=gemini:gemini-3.5-flash-lite
```

Gemini notes: effort maps to `thinkingLevel` (low, medium, high; xhigh and max become high); thinking cannot be turned off and
its tokens count against the output limit, so an empty answer with a normal stop is treated as a cut-off and climbs the retry
ladder. No temperature, top_p or top_k is sent. Argon streams up to 65,536 output tokens (32,768 non-streamed) and takes about
40 s to a first answer.

Opus writes the script, everything else is Gemini 3.8 Flash:

```
MODEL_DEFAULT=gemini:gemini-3.8-flash
MODEL_SCRIPT=anthropic:claude-opus-5-5
```

(`scriptWrite` and `sceneInsert` follow `MODEL_SCRIPT`.) Cheap scenes, careful director:

```
MODEL_SCENE_WRITER=gemini:gemini-3.8-flash
MODEL_SCENE_REPAIR=anthropic:claude-haiku-5-5
MODEL_DIRECTOR=anthropic:claude-opus-5-5
EFFORT_SCENE_WRITER=high
```

An OpenAI-compatible model:

```
MODEL_SCENE_WRITER=openai-compatible:qwen3.8-flash
BASE_URL_SCENE_WRITER=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
OPENAI_COMPATIBLE_API_KEY=...
MODEL_PRICE_QWEN3_8_FLASH=0.2,0.8,0.05   # in,out,cachedIn USD per 1M tokens; unknown models log usd:null
```

## Scene writer notes

- Cut-off retry ladder (per provider): first call at the route's limit (24,000), then the model's maximum output (Anthropic
  128k, Gemini 65,536), then effort `high`. Where the first limit already equals the maximum, that rung is skipped.
- The prompt-cache gate (first scene of a film warms the cache, the others wait) runs only for Anthropic. Gemini's implicit
  cache did not hit in tests, so Gemini scenes start together.
- The bundler, the no-text and kit-use checks and the repair loop are provider-independent.

## Cost logging

Every call logs one line: `{"event":"model_usage","step","provider","model","input","output","cache_read","cache_write","usd","ms","stop"}`
(`input` excludes cached tokens; `usd` is `null` for a model with no price). Anthropic calls also keep the old
`anthropic_usage` line.

## Price table (USD per 1M tokens, `backend/src/models/prices.ts`)

| model | in | out | cache read | cache write |
|---|---|---|---|---|
| claude-opus-5-5 | 4 | 20 | 0.2 | 5 |
| claude-haiku-5-5 | 0.1 | 0.5 | 0.01 | 0.125 (assumed) |
| gemini-3.8-flash | 0.75 | 3.75 (incl. thinking) | 0.075 | 0; from 2027-01-01: 1.5 / 7.5 / 0.15 |
| gemini-4-argon | 2 | 10 | 0.1 | 0; from 2026-12-01: 4 / 20 / 0.2 |
| gemini-3.5-flash-lite | 0.3 | 2.5 | 0.03 | 0; no change listed |

Dated changes live in `PRICE_CHANGES` and apply by date automatically.
| claude-haiku-4-5-20251001, gemini-2.5-flash, gemini-3.1-pro-preview | see file | | | **not verified against the providers' pages** |


## Tier policy (overrides the defaults above)

Models come from `backend/src/models/tiers.ts`. Standard (and every step that runs before a tier is chosen) uses `gemini-3.8-flash`, or `claude-haiku-5-5` for formatFill, proAssistant, planner, elementEdits and skillRouting. Premium uses `claude-opus-5-5` (voiceAlign and siteRead stay on Gemini). No other Claude model is used (a test enforces this). Override with `MODEL_<STEP>_STANDARD` / `MODEL_<STEP>_PREMIUM` (or tier-blind `MODEL_<STEP>`). `MODEL_DEFAULT`, `ANTHROPIC_MODEL`, `PLATE_MODEL`, `SCRIPT_MODEL`, `FRAME_MODEL` and the other legacy variables are ignored. Rows above that still name those variables are historical.
