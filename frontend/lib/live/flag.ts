/**
 * Single feature-flag reader for live plate playback in `PlatePreview` (Phase 3c).
 * Off by default; enabled only when `NEXT_PUBLIC_PLATE_LIVE === "1"`.
 */

const envValue = (() => {
  try {
    return process.env.NEXT_PUBLIC_PLATE_LIVE;
  } catch {
    return undefined;
  }
})();

export const PLATE_LIVE_ENABLED: boolean = envValue === "1";

export function isPlateLiveEnabled(override?: boolean): boolean {
  if (typeof override === "boolean") {
    return override;
  }
  try {
    if (typeof process !== "undefined" && process.env && "NEXT_PUBLIC_PLATE_LIVE" in process.env) {
      return process.env.NEXT_PUBLIC_PLATE_LIVE === "1";
    }
  } catch {
    // ignore in browser bundles without process
  }
  return PLATE_LIVE_ENABLED;
}

const draftEnvValue = (() => {
  try {
    return process.env.NEXT_PUBLIC_PLATE_DRAFT_PREVIEW;
  } catch {
    return undefined;
  }
})();

export const PLATE_DRAFT_PREVIEW_ENABLED: boolean = draftEnvValue !== "0";

export function isPlateDraftPreviewEnabled(override?: boolean): boolean {
  if (typeof override === "boolean") {
    return override;
  }
  try {
    if (typeof process !== "undefined" && process.env && "NEXT_PUBLIC_PLATE_DRAFT_PREVIEW" in process.env) {
      return process.env.NEXT_PUBLIC_PLATE_DRAFT_PREVIEW !== "0";
    }
  } catch {
    // ignore
  }
  return PLATE_DRAFT_PREVIEW_ENABLED;
}
