/*
 * One text-in, text-out call for every language step of the painted pipeline (script, director, scene repair, music-prompt rewrite),
 * so the whole film can be made by one model family. PAINTED_ENGINE / --engine picks it: "gemini" (script to scenes, no Claude key needed) or "claude".
 */
const MODELS = { gemini: process.env.PAINTED_GEMINI_MODEL || "gemini-3.1-pro-preview", claude: process.env.PAINTED_DIRECTOR_MODEL || "claude-opus-5-5" };
// The brain is a setting: --engine, else PAINTED_ENGINE, else Gemini (the product default; switch the whole deployment to Claude by setting PAINTED_ENGINE=claude).
export const engineName = (v) => (v || process.env.PAINTED_ENGINE || "gemini").toLowerCase() === "claude" ? "claude" : "gemini";
export const modelFor = (engine) => MODELS[engine];

let usage = null;   // token counts of the call in flight (calls from one process run one after another)
const unfence = (t) => t.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

/** Returns the model's text. `json` asks for a JSON answer (Gemini: JSON mime type; Claude: the prompt says so). */
async function askRaw({ engine, system, user, json = false, images = [], maxTokens = 16000, temperature = 0.7, timeoutMs = 300_000, model }) {
  if (engineName(engine) === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
    const m = model || MODELS.gemini;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: [{ role: "user", parts: [{ text: user }, ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } }))] }], generationConfig: { maxOutputTokens: maxTokens, temperature, ...(json ? { responseMimeType: "application/json" } : {}) } })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini ${m} failed (${res.status})${body.error?.message ? ": " + body.error.message.slice(0, 200) : ""}`);
    usage = { inTok: body.usageMetadata?.promptTokenCount, outTok: body.usageMetadata?.candidatesTokenCount, thinkTok: body.usageMetadata?.thoughtsTokenCount };
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const finish = body.candidates?.[0]?.finishReason;
    if (!text.trim()) throw new Error(`Gemini returned no text (${finish ?? "unknown"}).`);
    if (finish === "MAX_TOKENS") throw new Error("Gemini ran out of output tokens before finishing; raise maxTokens.");
    return json ? unfence(text) : text.trim();
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model: model || MODELS.claude, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: "user", content: images.length ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.base64 } })), { type: "text", text: user }] : user }] })
  });
  if (!res.ok) throw new Error(`Claude failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const cbody = await res.json(); usage = { inTok: cbody.usage?.input_tokens, outTok: cbody.usage?.output_tokens };
  const text = cbody.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  return json ? unfence(text) : text.trim();
}

/** Every language call, timed. PAINTED_TRACE=<file> appends one JSON line per call (engine, model, seconds, tokens, whether it failed and why): the record that engines are compared by. */
export async function ask(o) {
  const t0 = Date.now(), engine = engineName(o.engine); usage = null; let error;
  try { return await askRaw(o); } catch (e) { error = e.message.slice(0, 200); throw e; }
  finally {
    if (process.env.PAINTED_TRACE) { try { (globalThis.__fs ??= require_fs()).appendFileSync(process.env.PAINTED_TRACE, JSON.stringify({ at: new Date().toISOString(), engine, model: o.model || MODELS[engine], what: o.what || (o.json ? "json" : "text"), seconds: +((Date.now() - t0) / 1000).toFixed(1), ...usage, ...(error ? { error } : {}) }) + "\n"); } catch {} }
  }
}
import { createRequire } from "node:module"; const require_fs = () => createRequire(import.meta.url)("node:fs");

export const askJson = async (o) => JSON.parse(await ask({ ...o, json: true }));

export const PERSONAS = {
  story: `You are a human-hearted storyteller writing the narration for a 30-60 second painted short film. You never lecture or explain science: you notice the small, lived human moments that touch the heart — hands that tremble on a handle, a coat wrapped against the cold, a quiet promise kept over years, a gift placed in an open palm. Start in the middle of a vivid moment, carry the characters through a quiet emotional turn, and land on an image that lingers after the voice stops. 8-14 short lines, each one plain, rhythmic sentence a narrator can speak in one breath. Show feelings through concrete actions, objects, weather, light and gestures, never abstract labels. No headings, no stage directions, no emoji. Output only the narration, one line per row.`,
  educational: `You write the narration for a 30-60 second vertical explainer short that sounds like 3Blue1Brown or Veritasium: one surprising question or counter-intuitive hook in the first line, clear visual intuition built step by step through concrete physical analogies, a "wait, why?" turn, and a crisp insight at the end. 8-14 short lines, each one sentence a narrator can say in one breath. Every line must be something a painting or diagram can show (objects, forces, scales, light, motion), not jargon. No headings, no stage directions, no emoji. Output only the narration, one line per row.`,
};
const EDUCATIONAL_TOPIC = /\b(how\b|why\b|what\s+is\b|explain\b|physics|math|calculus|gravity|orbit|atom|molecule|carbon|photosynthesis|quantum|relativity|theorem|algorithm|probability|prime|fourier|entropy|evolution|dna|neuron|black\s+hole|speed\s+of\s+light|electr|magnet|thermodynamic)/i;
/** Infers whether a topic is an educational explainer ("educational") or a human story ("story"), unless the caller named one. */
export function scriptPersona(topic = "", mode) {
  if (mode === "educational" || mode === "3b1b" || mode === "explainer") return "educational";
  if (mode === "story" || mode === "narrative") return "story";
  return EDUCATIONAL_TOPIC.test(topic) ? "educational" : "story";
}
/** Gemini (or Claude) writes the narration from a topic, using the persona that fits (human story by default, 3b1b for educational topics). */
export async function writeScript(topic, engine, { mode } = {}) {
  const persona = scriptPersona(topic, mode), system = PERSONAS[persona];
  for (let attempt = 1; ; attempt++) {
    const text = await ask({ engine, what: `script:${persona}`, system, user: `Topic: ${topic}`, maxTokens: 12000, temperature: 0.9 });
    const lines = text.split("\n").map((l) => l.trim().replace(/^[-*\d.\s]+(?=[A-Z"'])/, "")).filter(Boolean);
    if (lines.length >= 8 && /[.!?"']$/.test(lines.at(-1))) return lines.join("\n");
    if (attempt >= 3) throw new Error(`The script came back with ${lines.length} lines or no ending; refusing to film it.`);
  }
}
