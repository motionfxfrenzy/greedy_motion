import type { FastifyInstance } from "fastify";
import { callerId } from "../auth.ts";
import { config } from "../config.ts";
import { isBillingInterval, isPaidTier, type BillingInterval } from "../tokens/plan.ts";
import { annualCheckoutConfigured, checkoutConfigured, CheckoutError, createCheckout, validSignature, variantIdFor, type WebhookBody } from "./lemonsqueezy.ts";
import { applyWebhook, RetryLater, subscriptionFor, syncPurchase } from "./service.ts";

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
      return reply.header("Cache-Control", "no-store").send({
        ...(await subscriptionFor(callerId(request))),
        checkoutAvailable: checkoutConfigured("month"),
        annualCheckoutAvailable: annualCheckoutConfigured()
      });
    } catch (error) {
      request.log.error({ err: error }, "subscription lookup failed");
      return reply.code(503).header("Retry-After", "5").send({ error: { code: "subscription_unavailable", message: "Could not read your plan right now. Try again in a moment." } });
    }
  });

  // Called by the profile page when the buyer returns from checkout: applies the purchase now, ahead of the webhook.
  const lastSync = new Map<string, number>();
  app.post("/v1/billing/sync", async (request, reply) => {
    if (!checkoutConfigured("month")) return reply.code(501).send(unavailable);
    const userId = callerId(request);
    const last = lastSync.get(userId) ?? 0;
    if (Date.now() - last < 1500) return reply.code(429).header("Retry-After", "2").send({ error: { code: "slow_down", message: "Try again in a moment." } });
    lastSync.set(userId, Date.now());
    try {
      return reply.header("Cache-Control", "no-store").send(await syncPurchase(userId, request.user?.email));
    } catch (error) {
      if (error instanceof RetryLater) return reply.header("Cache-Control", "no-store").send({ synced: false, applied: [] });
      request.log.error({ err: error }, "billing sync failed");
      return reply.code(502).send({ error: { code: "sync_failed", message: "Could not check your payment yet." } });
    }
  });

  app.post<{ Body: { product?: unknown; interval?: unknown } | undefined }>("/v1/billing/checkout", async (request, reply) => {
    const rawProduct = typeof request.body?.product === "string" ? request.body.product : "";
    const rawInterval = request.body?.interval;
    if (rawInterval !== undefined && !isBillingInterval(rawInterval)) {
      return reply.code(400).send({ error: { code: "invalid_interval", message: "Billing interval must be month or year." } });
    }
    const suffixAnnual = rawProduct.endsWith("_annual");
    const product = suffixAnnual ? rawProduct.slice(0, -"_annual".length) : rawProduct;
    const interval: BillingInterval = rawInterval === "year" || suffixAnnual ? "year" : "month";
    if (!checkoutConfigured(product === "topup" ? "month" : interval)) return reply.code(501).send(unavailable);
    if (product !== "topup" && !isPaidTier(product)) return reply.code(400).send({ error: { code: "invalid_product", message: "Choose a plan or a token pack." } });
    const userId = callerId(request);
    if (product === "topup") {
      // A token pack tops up a plan; someone with no plan is sent to choose one first.
      const current = await subscriptionFor(userId);
      if (current.tier === "free") return reply.code(403).send({ error: { code: "subscription_required", message: "Token packs are for subscribers. Choose a plan first." } });
    }
    if (isPaidTier(product)) {
      const current = await subscriptionFor(userId);
      if (current.tier !== "free") return reply.code(409).send({ error: { code: "already_subscribed", message: "You already have a plan. Change or cancel it from billing.", portalUrl: current.portalUrl } });
    }
    try {
      const url = await createCheckout({ userId, email: request.user?.email, variantId: variantIdFor(product, interval), item: product === "topup" ? "pack" : "plan" });
      return reply.send({ url });
    } catch (error) {
      if (!(error instanceof CheckoutError)) throw error;
      request.log.error({ err: error }, "checkout failed");
      return reply.code(502).send({ error: { code: "checkout_failed", message: "Could not open checkout. Try again in a moment." } });
    }
  });
}
