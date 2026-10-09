import { createHash } from "node:crypto";
import type { ProManifest } from "@videosaas/contracts";

/** Limits for a pro project folder. Generous for hand-written HTML, small enough that one write stays cheap. */
export const PRO_LIMITS = { fileBytes: 2_000_000, files: 200, totalBytes: 50_000_000, pathChars: 200 } as const;

export class ProInvalid extends Error {
  readonly code: string;
  constructor(message: string, code = "invalid_request") { super(message); this.code = code; }
}
export class ProConflict extends Error {
  readonly currentRev: number;
  constructor(currentRev: number) { super("The project changed since you opened it."); this.currentRev = currentRev; }
}

const EDITABLE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.(html|css|js|json)$/;

/** A relative, editable text-file path inside the project, or throws. Confinement is by construction: no `..`, no absolute paths. */
export function proPath(path: unknown): string {
  if (typeof path !== "string" || path.length === 0 || path.length > PRO_LIMITS.pathChars) throw new ProInvalid("That file name is not allowed.");
  if (!EDITABLE.test(path) || path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new ProInvalid(`“${path}” is not an editable file path. Use letters, digits, - _ . / and end in .html, .css, .js or .json.`);
  return path;
}

export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

export type ProWrite = { path: string; content: string };

/** Validates a batch of writes against the limits and the files that stay untouched. Returns the cleaned batch. */
export function checkWrites(current: ProManifest["files"], body: unknown): ProWrite[] {
  if (!Array.isArray(body) || body.length === 0) throw new ProInvalid("Send at least one file to write.");
  const seen = new Set<string>();
  const writes: ProWrite[] = [];
  for (const item of body) {
    const path = proPath((item as { path?: unknown } | null)?.path);
    const content = (item as { content?: unknown }).content;
    if (typeof content !== "string") throw new ProInvalid(`“${path}” needs text content.`);
    if (seen.has(path)) throw new ProInvalid(`“${path}” appears twice in one write.`);
    seen.add(path);
    if (Buffer.byteLength(content) > PRO_LIMITS.fileBytes) throw new ProInvalid(`“${path}” is larger than ${PRO_LIMITS.fileBytes / 1_000_000} MB.`, "too_large");
    writes.push({ path, content });
  }
  const next = { ...current };
  for (const w of writes) next[w.path] = { size: Buffer.byteLength(w.content), sha256: sha256(w.content) };
  if (Object.keys(next).length > PRO_LIMITS.files) throw new ProInvalid(`A project can hold ${PRO_LIMITS.files} files.`, "too_large");
  if (Object.values(next).reduce((n, f) => n + f.size, 0) > PRO_LIMITS.totalBytes) throw new ProInvalid("The project is over its size limit.", "too_large");
  return writes;
}

/** Optimistic concurrency: a write must name the revision it was made against. */
export function requireRev(manifest: Pick<ProManifest, "rev">, baseRev: unknown): void {
  if (typeof baseRev !== "number" || !Number.isInteger(baseRev)) throw new ProInvalid("`baseRev` is required.");
  if (baseRev !== manifest.rev) throw new ProConflict(manifest.rev);
}

export const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", gif: "image/gif",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm"
};

/** Paths the preview may serve: any file inside the folder, still without `..` or absolute parts. */
export function servePath(path: string): string {
  if (!path || path.length > PRO_LIMITS.pathChars * 2 || path.split("/").some((part) => part === "" || part === "." || part === ".." || part.startsWith("."))) throw new ProInvalid("That file does not exist.");
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./ -]*$/.test(path)) throw new ProInvalid("That file does not exist.");
  return path;
}
