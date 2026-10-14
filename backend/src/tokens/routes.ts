import type { FastifyInstance } from "fastify";
import { callerId } from "../auth.ts";
import { tokenSummary } from "./store.ts";

/** The caller's token balance and recent activity. The user comes only from the token; there is no id parameter. */
export async function registerTokenRoutes(app: FastifyInstance) {
  app.get("/v1/me/tokens", async (request, reply) => {
    try {
      return reply.header("Cache-Control", "no-store").send(await tokenSummary(callerId(request)));
    } catch (error) {
      request.log.error({ err: error }, "token lookup failed");
      return reply.code(503).header("Retry-After", "5").send({ error: { code: "tokens_unavailable", message: "Could not read your tokens right now. Try again in a moment." } });
    }
  });
}
