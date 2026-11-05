import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const resolvedIds = new WeakMap<object, string>();
const registeredApps = new WeakSet<FastifyInstance>();

export function genReqId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers["x-request-id"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return typeof header === "string" && SAFE_REQUEST_ID.test(header) ? header : randomUUID();
}

export function requestIdOf(request: FastifyRequest): string {
  const existing = String(request.id ?? "");
  if (SAFE_REQUEST_ID.test(existing)) return existing;
  let cached = resolvedIds.get(request);
  if (!cached) {
    cached = genReqId(request);
    resolvedIds.set(request, cached);
  }
  return cached;
}

export function registerRequestId(app: FastifyInstance): void {
  if (registeredApps.has(app)) return;
  registeredApps.add(app);
  app.addHook("onRequest", async (request, reply) => {
    const id = requestIdOf(request);
    reply.header("X-Request-Id", id);
    reply.raw.setHeader("X-Request-Id", id);
  });
}

export function upstreamError(
  request: FastifyRequest,
  err: unknown,
  code: string,
  message: string,
  extra: Record<string, unknown> = {}
): { error: { code: string; message: string; requestId: string; [key: string]: unknown } } {
  const requestId = requestIdOf(request);
  request.log.error({ err, requestId }, message);
  return {
    error: {
      code,
      message,
      requestId,
      ...extra
    }
  };
}

export function upstreamSseError(
  request: FastifyRequest,
  err: unknown,
  message: string,
  extra: Record<string, unknown> = {}
): { error: string; requestId: string; [key: string]: unknown } {
  const requestId = requestIdOf(request);
  request.log.error({ err, requestId }, message);
  return {
    ...extra,
    error: message,
    requestId
  };
}
