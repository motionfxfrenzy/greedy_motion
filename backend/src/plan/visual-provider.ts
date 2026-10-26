import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";

export class VisualProviderTerminalError extends Error {}
const exec = promisify(execFile);
/** Decode the complete video; a valid movie header alone does not prove playable media. */
export async function validateVideo(bytes: Buffer): Promise<number> {
  const duration = mp4Duration(bytes);
  const dir = await mkdtemp(join(tmpdir(), "material-validate-"));
  try {
    const file = join(dir, "clip.mp4"); await writeFile(file, bytes);
    await exec("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-map", "0:v:0", "-an", "-f", "null", "-"], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    return duration;
  } catch { throw new Error("Provider returned an undecodable video. Restore or reconcile the saved operation."); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

export interface VisualProvider {
  image(prompt: string, references: Buffer[], aspect: string): Promise<Buffer>;
  submit(prompt: string, image: Buffer, aspect: string, negative: string, lastFrame?: Buffer): Promise<string>;
  poll(name: string): Promise<Buffer | null>;
}
export function googleVisualProvider(imageModel: string, videoModel: string): VisualProvider {
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { timeout: 180_000 } });
  return {
    async image(prompt, references, aspect) {
      const response = await ai.models.generateContent({ model: imageModel,
        contents: [{ role: "user", parts: [{ text: prompt }, ...references.map(data => ({ inlineData: { mimeType: "image/png", data: data.toString("base64") } }))] }],
        config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect, imageSize: "1K" } } });
      const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith("image/"));
      if (!part?.inlineData?.data) throw new Error("Image generation returned no image (possibly safety filtered).");
      return sharp(Buffer.from(part.inlineData.data, "base64")).png().toBuffer();
    },
    async submit(prompt, image, aspect, negative, lastFrame) {
      const op = await ai.models.generateVideos({ model: videoModel, prompt, image: { imageBytes: image.toString("base64"), mimeType: "image/png" },
        config: { numberOfVideos: 1, durationSeconds: 8, resolution: "720p", aspectRatio: aspect, negativePrompt: negative,
          ...(lastFrame ? { lastFrame: { imageBytes: lastFrame.toString("base64"), mimeType: "image/png" } } : {}) } });
      if (!op.name) throw new Error("Video submission returned no operation; inspect provider billing before retrying.");
      return op.name;
    },
    async poll(name) {
      const operation = new GenerateVideosOperation(); operation.name = name;
      const op = await ai.operations.getVideosOperation({ operation });
      if (!op.done) return null;
      if (op.error) throw new VisualProviderTerminalError(`Video generation failed: ${String(op.error.message ?? op.error.code ?? "provider error")}`);
      const video = op.response?.generatedVideos?.[0]?.video;
      if (!video) throw new VisualProviderTerminalError("Video generation returned no clip (possibly safety filtered).");
      const dir = await mkdtemp(join(tmpdir(), "material-video-"));
      try { const file = join(dir, "clip.mp4"); await ai.files.download({ file: video, downloadPath: file }); return await readFile(file); }
      finally { await rm(dir, { recursive: true, force: true }); }
    }
  };
}
/** Parse the MP4 movie header; reject malformed/empty media before marking a shot ready. */
export function mp4Duration(bytes: Buffer): number {
  function boxes(start: number, end: number): number | undefined {
    for (let at = start; at + 8 <= end;) {
      let size = bytes.readUInt32BE(at), header = 8;
      if (size === 1) { if (at + 16 > end) break; size = Number(bytes.readBigUInt64BE(at + 8)); header = 16; }
      if (size === 0) size = end - at;
      if (size < header || at + size > end) break;
      const type = bytes.toString("ascii", at + 4, at + 8), p = at + header;
      if (type === "moov") { const n = boxes(p, at + size); if (n) return n; }
      if (type === "mvhd") {
        const v1 = bytes[p] === 1, scaleOffset = p + (v1 ? 20 : 12), durationOffset = scaleOffset + 4;
        if (durationOffset + (v1 ? 8 : 4) > at + size) break;
        const scale = bytes.readUInt32BE(scaleOffset), duration = v1 ? Number(bytes.readBigUInt64BE(durationOffset)) : bytes.readUInt32BE(durationOffset);
        if (scale > 0 && duration > 0) return duration / scale;
      }
      at += size;
    }
  }
  const seconds = boxes(0, bytes.length);
  if (!seconds || !Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error("Provider returned an invalid MP4 duration.");
  return seconds;
}
