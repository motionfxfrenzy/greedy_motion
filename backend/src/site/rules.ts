// Limits and the error shared by the site readers (capture.ts: this server's own reader; gemini.ts: the fallback).
export const SITE_RULES = {
  overallMs: 35_000,
  navigationMs: 20_000,
  maxRequests: 600,
  maxBytes: 40_000_000,
  perResourceBytes: 8_000_000,
  maxShots: 6,
  maxImages: 5,
  viewport: { width: 1440, height: 900 },
  sectionMinHeight: 260,
  sectionMaxHeight: 1400,
  snapshotMaxBytes: 600_000,
  textMax: 6000,
  factsMax: 40
} as const;

export class SiteUnavailable extends Error {}
