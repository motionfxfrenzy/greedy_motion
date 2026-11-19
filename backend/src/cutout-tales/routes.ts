import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  cutoutAspects, cutoutPlannerBrief, cutoutSpecProblems, resolveCutoutTimings, voiceIds,
  type CutoutAspect, type CutoutDraft, type CutoutSpec, type RenderJob, type SentenceTiming
} from "@videosaas/contracts";
import { callerId } from "../auth.ts";
import { synthesizeVoiceover } from "../audio/gemini-tts.ts";
import { pcmToWav } from "../audio/wav.ts";
import { config } from "../config.ts";
import { registerRequestId, upstreamError } from "../http-errors.ts";
import { llmJson } from "../llm.ts";
import { ensurePromptAllowed } from "../moderation/creem.ts";
import { renderJobRepository } from "../render/repository.ts";
import { uploadDirectory } from "../storage.ts";

/**
 * "Cutout tales" (staging flag CUTOUT_TALES_ENABLED). A script becomes a narrated cutout film: the voiceover is read per
 * sentence (so each sentence has a measured window), the planner writes a JSON DRAFT only, the draft is validated and
 * resolved against those windows (packages/contracts/src/cutout-tales.ts), and the finished HyperFrames folder goes to the
 * same render queue and worker as every other render. No Python and no model-written code ever runs.
 */
const fail = (code: string, message: string, extra: object = {}) => ({ error: { code, message, ...extra } });
const START = 0.3; // the worker/template plays the voiceover from 0.3 s
const GAP = 0.45;
const SCRIPT_MIN = 20, SCRIPT_MAX = 700, MAX_SENTENCES = 12;

export function splitSentences(script: string): string[] {
  return script.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

type Pcm = { pcm: Buffer; rate: number; channels: number };
export function readPcm(wav: Buffer): Pcm {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file.");
  let offset = 12, rate = 0, channels = 0, bits = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4), size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") { channels = wav.readUInt16LE(offset + 10); rate = wav.readUInt32LE(offset + 12); bits = wav.readUInt16LE(offset + 22); }
    if (id === "data") { if (bits !== 16 || !rate) throw new Error("Only 16-bit PCM WAV is supported."); return { pcm: wav.subarray(offset + 8, Math.min(wav.length, offset + 8 + size)), rate, channels }; }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk.");
}

/** Joins per-sentence takes with a pause and returns the track plus each sentence's window on the film clock. */
export function joinTakes(takes: Buffer[], sentences: string[]): { wav: Buffer; timings: SentenceTiming[]; seconds: number } {
  const parts = takes.map(readPcm);
  const { rate, channels } = parts[0]!;
  if (parts.some((p) => p.rate !== rate || p.channels !== channels)) throw new Error("The voice takes disagree on format.");
  const frame = channels * 2, gapBytes = Math.round(GAP * rate) * frame, chunks: Buffer[] = [];
  const timings: SentenceTiming[] = [];
  let bytes = 0;
  parts.forEach((p, i) => {
    const start = START + bytes / (rate * frame), end = start + p.pcm.length / (rate * frame);
    timings.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text: sentences[i]! });
    chunks.push(p.pcm, Buffer.alloc(gapBytes)); bytes += p.pcm.length + gapBytes;
  });
  const pcm = Buffer.concat(chunks);
  return { wav: pcmToWav(pcm, rate, channels), timings, seconds: pcm.length / (rate * frame) };
}

/**
 * Deliberately shallow: providers refuse deeply nested, enum-heavy schemas ("too many states for serving"). The shape of
 * every field is enforced by cutoutSpecProblems() after resolving, with one repair round, and the vocabulary is in the prompt.
 * Every `required` key must still be declared under `properties`.
 */
export const DRAFT_SCHEMA = {
  type: "object", required: ["aspect", "shots"],
  properties: {
    aspect: { type: "string" },
    shots: { type: "array", items: {
      type: "object", required: ["sentences", "set", "cast"],
      properties: {
        sentences: { type: "array", items: { type: "integer" } },
        set: { type: "string" }, mood: { type: "string" },
        props: { type: "array", items: { type: "string" } },
        cast: { type: "array", items: { type: "object" } },
        overlays: { type: "array", items: { type: "object" } }
      }
    } }
  }
};

async function planDraft(sentences: SentenceTiming[], aspect: CutoutAspect): Promise<{ spec: CutoutSpec } | { error: string }> {
  const user = `Voiceover sentences (index: text):\n${sentences.map((s, i) => `${i}: ${s.text}`).join("\n")}\n\nAspect: ${aspect}. Return the CutoutDraft JSON.`;
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await llmJson({ step: "script", system: cutoutPlannerBrief, user: attempt === 0 ? user : `${user}\n\nYour previous draft was rejected: ${last}\nFix exactly those problems and return the full draft again.`, history: attempt === 0 ? [] : history, schema: DRAFT_SCHEMA, maxTokens: 6000 });
    let draft: CutoutDraft;
    try { draft = JSON.parse(result.text) as CutoutDraft; } catch { last = "the answer was not valid JSON"; continue; }
    draft.aspect = aspect;
    const resolved = resolveCutoutTimings(draft, sentences);
    if ("spec" in resolved) return resolved;
    last = resolved.error;
  }
  return { error: last };
}

/** Writes the self-contained HyperFrames folder: template, GSAP, fonts, voiceover, and the shot list baked in. */
export async function buildCutoutProject(dir: string, spec: CutoutSpec, wav: Buffer) {
  const [template, fontCss] = await Promise.all([readFile(join(config.templatesDir, "cutout-tales/index.html"), "utf8"), readFile(join(config.fontsDir, "fonts.css"), "utf8")]);
  await mkdir(join(dir, "vendor"), { recursive: true });
  await mkdir(join(dir, "audio"), { recursive: true });
  await cp(config.gsapPath, join(dir, "vendor/gsap.min.js"));
  await cp(config.fontsDir, join(dir, "fonts"), { recursive: true });
  await writeFile(join(dir, "audio/voiceover.wav"), wav);
  const [w, h] = spec.aspect === "9:16" ? [1080, 1920] : [1920, 1080];
  const json = JSON.stringify({ spec }).replace(/</g, "\\u003c");
  let html = template;
  const root = /<div id="root"[^>]*>/.exec(html);
  if (!root) throw new Error("The cutout-tales template has no #root element.");
  const stamped = root[0].replace(/data-width="\d+"/, `data-width="${w}"`).replace(/data-height="\d+"/, `data-height="${h}"`).replace(/data-duration="[\d.]+"/, `data-duration="${spec.duration}"`);
  html = html.replace(root[0], () => `${stamped}\n    <audio id="voiceover" src="audio/voiceover.wav" data-start="${START}" data-duration="${spec.duration - START}" data-track-index="11" data-volume="1"></audio>`)
    .replace(/<meta name="viewport" content="[^"]*">/, `<meta name="viewport" content="width=${w}, height=${h}">`)
    .replace(/<script id="hf-variables" type="application\/json">[\s\S]*?<\/script>/, () => `<script id="hf-variables" type="application/json">${json}</script>`)
    .replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>\n</head>`);
  await writeFile(join(dir, "index.html"), html);
}

export async function registerCutoutTalesRoutes(app: FastifyInstance) {
  registerRequestId(app);
  app.get("/v1/cutout-tales", async () => ({ enabled: config.cutoutTales, aspects: cutoutAspects, limits: { scriptMin: SCRIPT_MIN, scriptMax: SCRIPT_MAX, sentences: MAX_SENTENCES } }));

  app.post<{ Body: { script?: unknown; aspect?: unknown; voice?: unknown } }>("/v1/cutout-tales/render", async (request, reply) => {
    if (!config.cutoutTales) return reply.code(404).send(fail("not_found", "Cutout tales is not available."));
    const body = request.body ?? {};
    const script = typeof body.script === "string" ? body.script.replace(/\s+/g, " ").trim() : "";
    const aspect = body.aspect === undefined ? "16:9" : body.aspect;
    const voice = typeof body.voice === "string" && voiceIds.includes(body.voice) ? body.voice : "Charon";
    if (script.length < SCRIPT_MIN || script.length > SCRIPT_MAX) return reply.code(400).send(fail("invalid_request", `The script must be ${SCRIPT_MIN} to ${SCRIPT_MAX} characters.`));
    if (!(cutoutAspects as readonly string[]).includes(aspect as string)) return reply.code(400).send(fail("invalid_request", "`aspect` must be 16:9 or 9:16."));
    const sentences = splitSentences(script);
    if (sentences.length > MAX_SENTENCES || sentences.some((s) => s.length > 220)) return reply.code(400).send(fail("invalid_request", `Use at most ${MAX_SENTENCES} sentences of under 220 characters.`));
    if (!config.geminiApiKey) return reply.code(503).send(fail("not_configured", "Voiceover is not configured on this server."));
    if (!(await ensurePromptAllowed(reply, [script], "cutout-tales"))) return reply;

    const jobId = randomUUID();
    const dir = join(config.renderOutputDir, jobId, "project");
    try {
      const takes = await Promise.all(sentences.map((text) => synthesizeVoiceover(config.geminiApiKey, { text, voice, style: "warm storyteller narration" }).then((t) => t.wav)));
      const { wav, timings } = joinTakes(takes, sentences);
      const planned = await planDraft(timings, aspect as CutoutAspect);
      if ("error" in planned) return reply.code(422).send(fail("plan_invalid", "The shot list could not be planned for this script. Try rewording it.", { detail: planned.error.slice(0, 400) }));
      const problems = cutoutSpecProblems(planned.spec);
      if (problems.length) return reply.code(422).send(fail("plan_invalid", "The shot list failed validation.", { problems: problems.slice(0, 5) }));
      await buildCutoutProject(dir, planned.spec, wav);
      let projectPrefix: string | undefined;
      if (config.storageDriver === "r2") {
        projectPrefix = `jobs/${jobId}/project`;
        await uploadDirectory(dir, projectPrefix);
        await rm(join(config.renderOutputDir, jobId), { recursive: true, force: true });
      }
      const job: RenderJob = { id: jobId, state: "rendering", progress: 45, createdAt: new Date().toISOString(), revision: { id: randomUUID(), title: `Cutout tales · ${sentences[0]!.slice(0, 40)}`, scenes: [], values: {} } };
      const queued = await renderJobRepository.createFormatAndEnqueue(job, {
        ownerId: callerId(request),
        request: { kind: "cutout-tales", aspect, shots: planned.spec.shots.length },
        renderInput: { kind: "pro", id: jobId, workerDir: `/renders/${jobId}/project`, ...(projectPrefix ? { projectPrefix } : {}), durationSeconds: planned.spec.duration, quality: "final" }
      });
      return reply.code(202).send({ ...queued, spec: { aspect, duration: planned.spec.duration, shots: planned.spec.shots.length } });
    } catch (error) {
      await rm(join(config.renderOutputDir, jobId), { recursive: true, force: true }).catch(() => undefined);
      request.log.error({ err: error }, "cutout tales render failed to start");
      return reply.code(502).send(upstreamError(request, error, "cutout_failed", "The film could not be started. Nothing was rendered; try again."));
    }
  });
}
