import type { FastifyInstance } from "fastify";
import { callerId } from "../auth.ts";
import { config } from "../config.ts";
import { isPaidTier } from "../tokens/plan.ts";
import { checkoutConfigured, CheckoutError, createCheckout, validSignature, type WebhookBody } from "./lemonsqueezy.ts";
import { applyWebhook, RetryLater, subscriptionFor } from "./service.ts";

const unavailable = { error: { code: "billing_unavailable", message: "Paid plans are not open yet." } };

export async function registerBillingRoutes(app: FastifyInstance) {
  // The webhook is signed, not signed-in: its body is kept raw so the signature can be checked against exactly what was sent.
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1_000_000 }, (_request, body, done) => done(null, body));
    scope.post("/v1/billing/webhook", async (request, reply) => {
      const raw = request.body as Buffer;
      const signature = request.headers["x-signature"];
      if (!validSignature(raw, typeof signature === "string" ? signature : undefined, config.billing.webhookSecret)) return reply.code(401).send({ error: { code: "bad_signature", message: "Signature does not match." } });
      let body: WebhookBody;
      try { body = JSON.parse(raw.toString("utf8")) as WebhookBody; } catch { return reply.code(400).send({ error: { code: "bad_body", message: "Not JSON." } }); }
      try {
        return reply.send({ result: await applyWebhook(body) });
      } catch (error) {
        if (error instanceof RetryLater) return reply.code(409).send({ error: { code: "retry_later", message: error.message } });
        request.log.error({ err: error }, "billing webhook failed");
        return reply.code(500).send({ error: { code: "webhook_failed", message: "Could not apply the event." } });
      }
    });
  });

  app.get("/v1/me/subscription", async (request, reply) => {
    try {
      return reply.header("Cache-Control", "no-store").send({ ...(await subscriptionFor(callerId(request))), checkoutAvailable: checkoutConfigured() });
    } catch (error) {
      request.log.error({ err: error }, "subscription lookup failed");
      return reply.code(503).header("Retry-After", "5").send({ error: { code: "subscription_unavailable", message: "Could not read your plan right now. Try again in a moment." } });
    }
  });

  app.post<{ Body: { product?: unknown } | undefined }>("/v1/billing/checkout", async (request, reply) => {
    if (!checkoutConfigured()) return reply.code(501).send(unavailable);
    const product = request.body?.product;
    if (product !== "topup" && !isPaidTier(product)) return reply.code(400).send({ error: { code: "invalid_product", message: "Choose a plan or a token pack." } });
    const userId = callerId(request);
    if (isPaidTier(product)) {
      const current = await subscriptionFor(userId);
      if (current.tier !== "free") return reply.code(409).send({ error: { code: "already_subscribed", message: "You already have a plan. Change or cancel it from billing.", portalUrl: current.portalUrl } });
    }
    try {
      const url = await createCheckout({ userId, email: request.user?.email, variantId: config.billing.variants[product] });
      return reply.send({ url });
    } catch (error) {
      if (!(error instanceof CheckoutError)) throw error;
      request.log.error({ err: error }, "checkout failed");
      return reply.code(502).send({ error: { code: "checkout_failed", message: "Could not open checkout. Try again in a moment." } });
    }
  });
}
