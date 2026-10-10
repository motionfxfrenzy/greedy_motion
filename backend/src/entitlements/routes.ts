import type { FastifyInstance } from "fastify";
import { callerId } from "../auth.ts";
import { EntitlementsUnavailable, entitlementsFor } from "./resolve.ts";

/**
 * What the caller's plan is worth, for the UI to decide what to show. The user comes only from the token (there is no id
 * parameter), and the answer is read from the database every time so a purchase or grant shows up at once. This is
 * information for the interface: every route that matters enforces the entitlement itself.
 */
export async function registerEntitlementRoutes(app: FastifyInstance) {
  app.get("/v1/me/entitlements", async (request, reply) => {
    try {
      return reply.header("Cache-Control", "no-store").send(await entitlementsFor(callerId(request), { fresh: true }));
    } catch (error) {
      if (!(error instanceof EntitlementsUnavailable)) throw error;
      request.log.error({ err: error }, "entitlement lookup failed");
      return reply.code(503).header("Retry-After", "5").send({ error: { code: "entitlements_unavailable", message: "Could not check your plan right now. Try again in a moment." } });
    }
  });
}
