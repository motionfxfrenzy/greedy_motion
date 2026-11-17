// The provider half of pack assets (pack-assets.ts): Gemini image generation (as plan/visual-provider.ts does) and the cheap
// vision word check (as experiments/tarantula-reference/test/check.mjs does). Kept apart so the asset step's tests run offline.
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { config } from "../config.ts";
import { callModel } from "../models/providers.ts";
import type { AssetSpec } from "../plan/template-packs.ts";
import { TEXT_CHECK_MODEL, type GeneratedImage } from "./pack-assets.ts";

let ai: GoogleGenAI | null = null;
const client = () => {
  if (!config.geminiApiKey) throw new Error("Template pictures need GEMINI_API_KEY on the backend.");
  return (ai ??= new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { timeout: 180_000 } }));
};

export async function geminiImage(prompt: string, refs: { name: string; data: Buffer; mime: string }[], spec: AssetSpec): Promise<GeneratedImage> {
  const parts = [
    ...refs.flatMap((r) => [{ text: `Reference "${r.name}":` }, { inlineData: { mimeType: r.mime, data: r.data.toString("base64") } }]),
    { text: prompt }
  ];
  const response = await client().models.generateContent({
    model: config.visualImageModel,
    contents: [{ role: "user", parts }],
    config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: spec.aspect, imageSize: spec.size ?? "1K" } }
  });
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
  if (!part?.inlineData?.data) throw new Error(`Picture "${spec.name}" came back empty (possibly safety filtered).`);
  return { data: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType ?? "image/png", usage: response.usageMetadata ?? null };
}

/** Stored pictures are JPEG (smaller pages for the preview and the export); depth maps stay PNG. */
export async function toJpeg(image: GeneratedImage): Promise<{ data: Buffer; mime: string }> {
  return { data: await sharp(image.data).flatten({ background: "#000000" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer(), mime: "image/jpeg" };
}

/** figures = only what the code draws on top of an empty set: people, characters, animals, and a rope or cable across open space (the man on a rope). */
const CHECK_PROMPT = "List every word, number or letter written anywhere in this picture (tiny unreadable scribbles that are clearly not words do not count). Reply JSON only: {\"words\":[...],\"figures\":[...]} where figures lists, each as a short phrase, every person, character or animal (also a statue-like, silhouetted or partly hidden one) and any rope or cable stretched across open space between two far points (across a gap, river, street or sky, the kind a person could walk or hang on). Everything else is the place itself and does NOT count: furniture, machines, equipment, cables and wiring on machines, walls or benches, tools, vehicles parked as scenery, buildings, plants and landscape.";

/** The picture check's backup when Gemini fails (a retired model, an outage): Claude Haiku reads the same picture with the same question. */
export const CHECK_FALLBACK_MODEL = "claude-haiku-5-5";

async function checkWith(provider: "gemini" | "anthropic", image: Buffer, mime: string): Promise<{ extra: string[]; figures?: string[]; usd: number | null }> {
  const model = provider === "gemini" ? TEXT_CHECK_MODEL : CHECK_FALLBACK_MODEL;
  const reply = await callModel({
    step: "screenshot",
    route: provider === "gemini"
      ? { step: "screenshot", provider, model, maxTokens: 4000, effort: "low", explicit: false }
      : { step: "screenshot", provider, model, maxTokens: 2000, explicit: false },
    system: "You read pictures for stray writing.",
    messages: [{ role: "user", content: [{ type: "image", mime, base64: image.toString("base64") }, { type: "text", text: CHECK_PROMPT }] }],
    errorPrefix: `Picture word check failed (${provider})`
  });
  const parsed = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? "{}") as { words?: unknown; figures?: unknown };
  if (!Array.isArray(parsed.words) && !Array.isArray(parsed.figures)) throw new Error(`Picture word check (${provider}) gave no list.`);
  const words = Array.isArray(parsed.words) ? parsed.words.map(String).filter((w) => w.trim()) : [];
  const figures = Array.isArray(parsed.figures) ? parsed.figures.map(String).filter((w) => w.trim()) : [];
  return { extra: words, figures, usd: reply.usd ?? null };
}

/** Reads every word in a picture; any word at all is "extra" for a noText picture. Gemini first, then Claude Haiku as the backup. */
export async function geminiTextCheck(image: Buffer, mime: string): Promise<{ extra: string[]; figures?: string[]; usd: number | null }> {
  try {
    return await checkWith("gemini", image, mime);
  } catch (first) {
    if (!config.anthropicApiKey) throw first;
    try {
      return await checkWith("anthropic", image, mime);
    } catch (second) {
      throw new Error(`${(first as Error)?.message ?? first} / backup: ${(second as Error)?.message ?? second}`);
    }
  }
}

/** One cheap call for a pack's shot plan (TemplatePack.shotList): the reply text and its cost. */
export async function geminiShotPlan(request: { system: string; user: string; maxTokens: number }): Promise<{ text: string; usd: number | null }> {
  const reply = await callModel({
    step: "director",
    route: { step: "director", provider: "gemini", model: TEXT_CHECK_MODEL, maxTokens: request.maxTokens, explicit: false },
    system: request.system,
    messages: [{ role: "user", content: request.user }],
    errorPrefix: "Shot plan failed"
  });
  return { text: reply.text, usd: reply.usd ?? null };
}

/** The preview copy: 720 px wide JPEG (about a tenth of the stored picture), enough for the browser preview's frame. */
export async function toPreviewJpeg(data: Buffer): Promise<Buffer> {
  return sharp(data).resize({ width: 720, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
}
