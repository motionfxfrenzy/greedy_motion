import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config, LOCAL_USER_ID } from "./config.ts";
import { verifyMediaToken } from "./media-links.ts";

export type AuthUser = { id: string; email?: string };
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// Shared files the preview loads that hold no user data. Everything else under /v1 requires a signed-in user.
const openGets = [
  /^\/v1\/preview\/(?:runtime|gsap)\.js$/,
  /^\/v1\/preview\/fonts\/[^/]+$/,
  /^\/v1\/preview\/templates\/[^/]+\/assets\/[^/]+$/,
  /^\/v1\/preview\/plan-sfx\/[^/]+$/
];

// User media reached by <img>/<video>/<audio> tags and the preview iframe, which cannot send an Authorization
// header: these also accept a media token in `?t=` (media-links.ts). Ownership is then checked as usual.
const mediaGets = [
  /^\/v1\/preview\/(?:projects|plans|brands)\//,
  /^\/v1\/renders\/[^/]+$/,
  /^\/v1\/projects\/[^/]+\/screenshots\/[^/]+$/,
  /^\/v1\/brands\/[^/]+\/logo$/,
  /^\/v1\/brands\/assets\/[^/]+\/preview$/
];

export const isOpen = (request: FastifyRequest) => {
  const path = request.url.split("?")[0];
  if (request.method === "OPTIONS" || !path.startsWith("/v1/")) return true;
  return request.method === "GET" && openGets.some((pattern) => pattern.test(path));
};

const mediaTokenUser = (request: FastifyRequest) => {
  if (request.method !== "GET" || !mediaGets.some((pattern) => pattern.test(request.url.split("?")[0]))) return null;
  return verifyMediaToken((request.query as { t?: unknown } | undefined)?.t);
};

/** Gate the API on a Supabase access token (asymmetric JWT, verified against the project's JWKS). */
export function registerAuth(app: FastifyInstance) {
  if (config.auth.mode === "none") {
    app.log.warn("AUTH_MODE=none: the API is unauthenticated. Only valid for local development.");
    return;
  }
  const jwks = createRemoteJWKSet(new URL(config.auth.jwksUrl));
  const issuer = `${config.auth.supabaseUrl}/auth/v1`;

  app.addHook("onRequest", async (request, reply) => {
    if (isOpen(request)) return;
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const mediaUser = token ? null : mediaTokenUser(request);
    if (mediaUser) {
      request.user = { id: mediaUser };
      return;
    }
    if (!token) return reply.code(401).send({ error: { code: "unauthenticated", message: "Sign in to continue." } });
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: "authenticated" });
      if (typeof payload.sub !== "string") throw new Error("Token has no subject.");
      request.user = { id: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined };
    } catch (error) {
      if (!(error instanceof errors.JOSEError)) request.log.warn({ err: error }, "Auth verification failed");
      return reply.code(401).send({ error: { code: "invalid_token", message: "Your session has expired. Sign in again." } });
    }
  });
}

/** The signed-in user's id; the fixed local user when AUTH_MODE=none. Only call on routes the auth hook covers. */
export const callerId = (request: FastifyRequest) => request.user?.id ?? LOCAL_USER_ID;
