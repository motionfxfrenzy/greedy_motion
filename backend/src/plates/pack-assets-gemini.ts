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

/** Reads every word in a picture; any word at all is "extra" for a noText picture. */
export async function geminiTextCheck(image: Buffer, mime: string): Promise<{ extra: string[]; figures?: string[]; usd: number | null }> {
  const reply = await callModel({
    step: "screenshot",
    route: { step: "screenshot", provider: "gemini", model: TEXT_CHECK_MODEL, maxTokens: 2000, explicit: false },
    system: "You read pictures for stray writing.",
    messages: [{ role: "user", content: [
      { type: "image", mime, base64: image.toString("base64") },
      { type: "text", text: "List every word, number or letter written anywhere in this picture (tiny unreadable scribbles that are clearly not words do not count). Reply JSON only: {\"words\":[...],\"figures\":[...]} where figures lists every person, character, animal, vehicle, or object that is clearly a story prop placed in the scene (a person on a rope, a rope or wire strung across, a cart, a boat), each as a short phrase; plain scenery (trees, rocks, buildings, fences) does not count." }
    ] }],
    errorPrefix: "Picture word check failed"
  });
  const parsed = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? "{}") as { words?: unknown; figures?: unknown };
  const words = Array.isArray(parsed.words) ? parsed.words.map(String).filter((w) => w.trim()) : [];
  const figures = Array.isArray(parsed.figures) ? parsed.figures.map(String).filter((w) => w.trim()) : [];
  return { extra: words, figures, usd: reply.usd ?? null };
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
