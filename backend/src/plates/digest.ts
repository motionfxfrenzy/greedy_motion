import { createHash } from "node:crypto";

/**
 * Pure identity functions for live and worker-rendered plate scenes.
 * Unlike `variantSignature` (which hashes the storyboard inputs and stays unchanged across comment revisions),
 * `bundleDigest` changes whenever the compiled bundle HTML, scene parameters, font set, or engine digest changes.
 */

const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");

/** Deterministic, key-sorted JSON serialisation. Object keys are sorted lexicographically; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

/** SHA-256 hex digest of the canonical JSON of `params` (defaults to `{}`). */
export function paramsDigest(params?: Record<string, unknown> | null): string {
  return sha256(canonicalJson(params ?? {}));
}

let activeFontSet = "fonts:none";

/**
 * SHA-256 hex digest of the font set available to the renderer (`"fonts:none"` until fonts are embedded).
 * Accepts an optional override string for testing font-set invalidation.
 */
export function fontSetDigest(fontSet: string = activeFontSet): string {
  return sha256(fontSet);
}

/** Allows tests or future font-embedding code to swap the active font-set descriptor in one place. */
export function setFontSetDescriptor(fontSet: string): void {
  activeFontSet = fontSet;
}

export type BundleDigestInput = {
  bundleSha?: string | null;
  bundleHash?: string | null;
  manifest?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
  engineDigest?: string | null;
  fontSetDigest?: string | null;
  fontSet?: string;
};

/**
 * SHA-256 hex of `[bundleSha, paramsDigest(params), fontSetDigest(), engineDigest ?? "engine:unknown"].join("|")`.
 * Uses the full bundle hash (`bundleHash` / `manifest.bundleHash`) if the manifest has it; otherwise `bundleSha`.
 */
export function bundleDigest(input: BundleDigestInput): string {
  const m = input.manifest ?? null;
  const manifestFullHash = typeof m?.bundleHash === "string" && m.bundleHash ? m.bundleHash : null;
  const manifestBundleSha = typeof m?.bundleSha === "string" && m.bundleSha ? m.bundleSha : null;
  const manifestEngineDigest = typeof m?.engineDigest === "string" && m.engineDigest ? m.engineDigest : null;

  const resolvedBundleSha = input.bundleHash || manifestFullHash || input.bundleSha || manifestBundleSha || "";
  const resolvedEngineDigest = input.engineDigest ?? manifestEngineDigest ?? "engine:unknown";
  const resolvedFontSetDigest = input.fontSetDigest ?? fontSetDigest(input.fontSet);

  return sha256([resolvedBundleSha, paramsDigest(input.params), resolvedFontSetDigest, resolvedEngineDigest].join("|"));
}
