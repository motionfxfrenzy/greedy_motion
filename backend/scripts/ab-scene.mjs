// A/B harness for style scene prompts.
//
// Dry run (no model calls, no browser):
//   node scripts/ab-scene.mjs --look illus-wren --beat "a wren on a branch|a small brown wren sings on a bare branch at dawn" --out /tmp/ab-dry --mode new
//
// Time an existing scene module (no model call; bundles + renders 5 evenly spaced frames in Chromium):
//   node scripts/ab-scene.mjs --look illus-folk-tale --beat "Barter|A boy trades a rooster" --source path/to/scene.ts --out /tmp/ab-time --mode new
//
// Live model authoring + bundling + 5-frame Chromium render & timing:
//   node scripts/ab-scene.mjs --look illus-folk-tale --beat "Barter|A boy trades a rooster" --frames 150 --aspect 16:9 --mode new --out /tmp/ab-live --live
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { bundleScene, plateNameOf } from "@videosaas/plate-engine";
import { classifyFailure, openScene, verifyScene } from "../../packages/plate-engine/lib/capture.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(scriptsDir, "..");

function parseCliArgs(argv) {
  const opts = {
    look: "illus-folk-tale",
    beat: "Opening|A quiet morning scene introduces the focal subject.",
    film: "",
    frames: 150,
    aspect: "16:9",
    mode: "new",
    out: "",
    source: "",
    live: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") {
      opts.live = true;
    } else if (a === "--look" && argv[i + 1]) {
      opts.look = argv[++i];
    } else if (a === "--beat" && argv[i + 1]) {
      opts.beat = argv[++i];
    } else if (a === "--film" && argv[i + 1]) {
      opts.film = argv[++i];
    } else if (a === "--frames" && argv[i + 1]) {
      opts.frames = Number.parseInt(argv[++i], 10);
    } else if (a === "--aspect" && argv[i + 1]) {
      opts.aspect = argv[++i];
    } else if (a === "--mode" && argv[i + 1]) {
      opts.mode = argv[++i];
    } else if (a === "--out" && argv[i + 1]) {
      opts.out = argv[++i];
    } else if (a === "--source" && argv[i + 1]) {
      opts.source = argv[++i];
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown or incomplete flag: ${a}`);
    }
  }
  if (opts.mode !== "old" && opts.mode !== "new") {
    throw new Error(`--mode must be "old" or "new"; got "${opts.mode}".`);
  }
  if (!Number.isInteger(opts.frames) || opts.frames < 1) {
    throw new Error(`--frames must be a positive integer; got "${opts.frames}".`);
  }
  if (!opts.out) {
    throw new Error("--out <dir> is required.");
  }
  return opts;
}

export function parseBeatSpec(spec) {
  const raw = String(spec ?? "").trim();
  const idx = raw.indexOf("|");
  if (idx < 0) {
    return { keyword: raw || "Scene", visual: raw || "Scene", onScreen: null, line: "" };
  }
  const keyword = raw.slice(0, idx).trim() || "Scene";
  const rest = raw.slice(idx + 1).trim();
  const lineIdx = rest.indexOf("|");
  if (lineIdx < 0) {
    return { keyword, visual: rest || keyword, onScreen: null, line: rest || keyword };
  }
  return {
    keyword,
    visual: rest.slice(0, lineIdx).trim() || keyword,
    onScreen: null,
    line: rest.slice(lineIdx + 1).trim()
  };
}

export function evenlySpacedFrames(totalFrames, count = 5) {
  const n = Math.max(1, totalFrames);
  if (n === 1) return [0];
  const out = [];
  for (let i = 0; i < count; i++) {
    const f = Math.min(n - 1, Math.max(0, Math.round((i * (n - 1)) / (count - 1))));
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

export function computeDrawStats(timesMs) {
  if (!timesMs.length) return { medianMs: 0, p90Ms: 0, framesMs: [] };
  const sorted = [...timesMs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p90Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.9) - 1));
  return {
    medianMs: round2(median),
    p90Ms: round2(sorted[p90Idx]),
    framesMs: timesMs.map(round2)
  };
}

async function renderAndTimeFiveFrames(bundleHtmlPath, outDir, mode, totalFrames) {
  const targetFrames = evenlySpacedFrames(totalFrames, 5);
  const session = await openScene(bundleHtmlPath, { pages: 1 });
  try {
    const meta = await session.meta();
    if (meta.durationFrames !== totalFrames) {
      throw Object.assign(
        new Error(`The scene lasts ${meta.durationFrames} frames, expected ${totalFrames}.`),
        { kind: "code", repairable: true }
      );
    }
    const timesMs = [];
    const files = [];
    for (let i = 0; i < targetFrames.length; i++) {
      const f = targetFrames[i];
      const t0 = performance.now();
      const png = await session.frame(f, 0);
      const dt = performance.now() - t0;
      timesMs.push(dt);
      const file = join(outDir, `frame-${mode}-${i + 1}-f${String(f).padStart(4, "0")}.png`);
      await writeFile(file, png);
      files.push(file);
    }
    return {
      frames: targetFrames,
      files,
      ...computeDrawStats(timesMs)
    };
  } finally {
    await session.close();
  }
}

function ensureEnvForConfig({ live }) {
  const envFile = resolve(backendDir, ".env");
  if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // ignore if already loaded or unreadable
    }
  }
  process.env.APP_ENV ??= "local";
  process.env.DATABASE_URL ??= "postgres://unused@localhost:5432/unused";
  process.env.ALLOW_CLOUD_IN_LOCAL ??= "1";
  if (!live && !process.env.ANTHROPIC_API_KEY) {
    process.env.PLANNER ??= "deterministic";
  }
}

export async function runAbScene(rawOpts) {
  const opts = {
    look: rawOpts.look ?? "illus-folk-tale",
    beat: rawOpts.beat ?? "Opening|A quiet morning scene introduces the focal subject.",
    film: rawOpts.film ?? "",
    frames: Number(rawOpts.frames ?? 150),
    aspect: rawOpts.aspect ?? "16:9",
    mode: rawOpts.mode ?? "new",
    out: resolve(rawOpts.out),
    source: rawOpts.source ? resolve(rawOpts.source) : "",
    live: Boolean(rawOpts.live)
  };

  ensureEnvForConfig({ live: opts.live });

  const prevSwitch = process.env.PLATE_STYLE_GUIDES;
  process.env.PLATE_STYLE_GUIDES = opts.mode === "old" ? "off" : "on";

  try {
    const { config } = await import("../src/config.ts");
    const { anthropicStream, responseText } = await import("../src/anthropic.ts");
    const { buildAuthorMessages, moduleFrom, promptDigest } = await import("../src/plates/prompt.ts");

    const plateName = plateNameOf(opts.look);
    if (!plateName) {
      throw new Error(`Unsupported plate look "${opts.look}".`);
    }

    const beatObj = parseBeatSpec(opts.beat);
    const filmText = opts.film || `${beatObj.keyword}: ${beatObj.visual}`;
    const beats = [beatObj];

    await mkdir(opts.out, { recursive: true });

    const digest = await promptDigest(plateName);
    const baseRequest = await buildAuthorMessages({
      look: opts.look,
      plateName,
      film: filmText,
      beats,
      aspect: opts.aspect,
      index: 0,
      frames: opts.frames
    });

    const systemText = baseRequest.system;
    const sharedText = baseRequest.messages[0].content[0].text;
    const sceneText = baseRequest.messages[0].content[1].text;
    const promptChars = systemText.length + sharedText.length + sceneText.length;
    const promptTokensApprox = Math.round(promptChars / 3.5);

    const promptOutFile = join(opts.out, `prompt-${opts.mode}.txt`);
    const formattedPrompt = [
      `# mode=${opts.mode} look=${opts.look} plate=${plateName} digest=${digest} frames=${opts.frames} aspect=${opts.aspect}`,
      `# systemChars=${systemText.length} sharedChars=${sharedText.length} sceneChars=${sceneText.length} totalChars=${promptChars} approxTokens=${promptTokensApprox}`,
      "",
      "=== SYSTEM ===",
      systemText,
      "",
      "=== SHARED (cache_control=ephemeral) ===",
      sharedText,
      "",
      "=== SCENE ===",
      sceneText,
      ""
    ].join("\n");
    await writeFile(promptOutFile, formattedPrompt, "utf8");

    // Dry run: no --live and no --source
    if (!opts.live && !opts.source) {
      const drySummary = {
        mode: opts.mode,
        look: opts.look,
        plateName,
        frames: opts.frames,
        aspect: opts.aspect,
        digest,
        systemChars: systemText.length,
        sharedChars: sharedText.length,
        sceneChars: sceneText.length,
        promptChars,
        promptTokensApprox,
        promptFile: promptOutFile
      };
      console.log(JSON.stringify(drySummary));
      return drySummary;
    }

    // --source <file.ts>: bundle and time an existing scene module without any model call
    if (opts.source) {
      const code = await readFile(opts.source, "utf8");
      const lines = code.split(/\r?\n/).length;
      const sceneOutFile = join(opts.out, `scene-${opts.mode}.ts`);
      if (resolve(opts.source) !== resolve(sceneOutFile)) {
        await writeFile(sceneOutFile, code, "utf8");
      }
      const bundle = await bundleScene({
        look: opts.look,
        code,
        frames: opts.frames,
        aspect: opts.aspect
      });
      const bundleHtmlPath = join(opts.out, `scene-${opts.mode}.html`);
      await writeFile(bundleHtmlPath, bundle.html, "utf8");
      await verifyScene(bundleHtmlPath, { frames: opts.frames });
      const draw = await renderAndTimeFiveFrames(bundleHtmlPath, opts.out, opts.mode, opts.frames);
      const result = {
        mode: opts.mode,
        look: opts.look,
        plateName,
        promptChars,
        promptTokensApprox,
        usage: null,
        draw: { medianMs: draw.medianMs, p90Ms: draw.p90Ms, framesMs: draw.framesMs },
        lines,
        repairs: 0
      };
      await writeFile(join(opts.out, `usage-${opts.mode}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");
      console.log(JSON.stringify(result));
      return result;
    }

    // --live: call the model through anthropicStream (same model & params as author.ts)
    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured in backend config.");
    }

    const maxCalls = config.plates.maxAuthorCalls;
    let lastError;
    let previous;
    let repairs = 0;
    const callUsages = [];
    const totalUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    };

    for (let attempt = 1; attempt <= maxCalls; attempt++) {
      const request = await buildAuthorMessages({
        look: opts.look,
        plateName,
        film: filmText,
        beats,
        aspect: opts.aspect,
        index: 0,
        frames: opts.frames,
        ...(lastError ? { error: lastError, previous: previous ?? "" } : {})
      });
      const reply = await anthropicStream(
        {
          model: config.plateModel,
          max_tokens: 24_000,
          system: request.system,
          messages: request.messages
        },
        {
          errorPrefix: "Scene authoring failed",
          includeErrorDetail: true,
          timeoutMs: 300_000,
          stopErrors: {
            max_tokens:
              "CUT OFF: the module was longer than the output limit. Write a MUCH MORE COMPACT module (under 200 lines): fewer, simpler elements, reuse small helper functions, loops instead of repeated calls."
          }
        }
      );
      const u = reply.usage ?? {};
      callUsages.push({
        attempt,
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
        cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0
      });
      totalUsage.input_tokens += u.input_tokens ?? 0;
      totalUsage.output_tokens += u.output_tokens ?? 0;
      totalUsage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
      totalUsage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;

      const rawText = responseText(reply);
      let code;
      try {
        code = moduleFrom(rawText);
      } catch (err) {
        if (!err?.repairable || attempt >= maxCalls) throw err;
        lastError = err.message;
        previous = rawText;
        repairs++;
        continue;
      }

      let bundle;
      try {
        bundle = await bundleScene({
          look: opts.look,
          code,
          frames: opts.frames,
          aspect: opts.aspect
        });
      } catch (err) {
        if (!err?.repairable || attempt >= maxCalls) throw err;
        lastError = err.message;
        previous = code;
        repairs++;
        continue;
      }

      const sceneOutFile = join(opts.out, `scene-${opts.mode}.ts`);
      const bundleHtmlPath = join(opts.out, `scene-${opts.mode}.html`);
      await writeFile(sceneOutFile, code, "utf8");
      await writeFile(bundleHtmlPath, bundle.html, "utf8");

      let draw;
      try {
        await verifyScene(bundleHtmlPath, { frames: opts.frames });
        draw = await renderAndTimeFiveFrames(bundleHtmlPath, opts.out, opts.mode, opts.frames);
      } catch (err) {
        if (classifyFailure(err) === "code" && attempt < maxCalls) {
          lastError = err.message;
          previous = code;
          repairs++;
          continue;
        }
        throw err;
      }

      const lines = code.split(/\r?\n/).length;
      const result = {
        mode: opts.mode,
        look: opts.look,
        plateName,
        model: config.plateModel,
        promptChars,
        promptTokensApprox,
        usage: totalUsage,
        calls: callUsages,
        draw: { medianMs: draw.medianMs, p90Ms: draw.p90Ms, framesMs: draw.framesMs },
        lines,
        repairs
      };
      await writeFile(join(opts.out, `usage-${opts.mode}.json`), JSON.stringify(result, null, 2) + "\n", "utf8");
      console.log(JSON.stringify(result));
      return result;
    }
    throw new Error(`Exhausted ${maxCalls} authoring attempts.`);
  } finally {
    if (prevSwitch === undefined) delete process.env.PLATE_STYLE_GUIDES;
    else process.env.PLATE_STYLE_GUIDES = prevSwitch;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runAbScene(parseCliArgs(process.argv.slice(2))).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
