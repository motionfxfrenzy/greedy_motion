// Media links (MEDIA-03). <img>, <video>, <audio> and the preview iframe cannot send an Authorization
// header, so the media routes (auth.ts `mediaGets`) accept a short-lived media token in `?t=` instead.
// The token names the signed-in user and an expiry, signed with MEDIA_URL_SECRET; the ownership hook
// (access.ts) then checks the requested project, brand or render belongs to that user, exactly as for a
// Bearer request. A leaked link therefore opens only its owner's media, and only until the token expires.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";

const HOUR = 3600;
// Tokens are cut on the hour so the same URL stays stable (and cacheable) for an hour at a time.
const LIFETIME_HOURS = 12;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sign = (userId: string, expires: number) =>
  createHmac("sha256", config.mediaUrlSecret).update(`media|${userId.toLowerCase()}|${expires}`).digest("base64url").slice(0, 32);

/** `<userId>.<expires epoch s>.<signature>`; valid between LIFETIME_HOURS and LIFETIME_HOURS + 1 hours. */
export function mediaToken(userId: string, now = Date.now()) {
  const expires = (Math.floor(now / 1000 / HOUR) + 1 + LIFETIME_HOURS) * HOUR;
  return { token: `${userId}.${expires}.${sign(userId, expires)}`, expiresAt: new Date(expires * 1000).toISOString() };
}

/** The user the token was issued to, or null when it is malformed, forged or expired. */
export function verifyMediaToken(token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string") return null;
  const [userId, expiresText, signature, extra] = token.split(".");
  if (extra !== undefined || !userId || !USER_ID.test(userId) || !/^\d{10}$/.test(expiresText ?? "") || !signature) return null;
  const expires = Number(expiresText);
  if (expires * 1000 <= now) return null;
  const expected = Buffer.from(sign(userId, expires));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId.toLowerCase() : null;
}

/**
 * Adds the token to every private asset URL in a preview page (screenshots, brand logo and fonts, plan audio),
 * so the iframe's own requests pass the media check. Shared assets (runtime, GSAP, bundled fonts, SFX) stay bare.
 */
export function signPreviewUrls(html: string, token: string) {
  const query = `t=${encodeURIComponent(token)}`;
  return html.replace(/(\/api\/preview\/(?:projects|plans|brands)\/[^"'()\s?#\\<>]+)(\?[^"'()\s#\\<>]*)?/g, (_match, path: string, search?: string) =>
    `${path}${search ? `${search}&${query}` : `?${query}`}`);
}
