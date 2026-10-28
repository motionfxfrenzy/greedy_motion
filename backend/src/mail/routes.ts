import type { FastifyInstance } from "fastify";
import { callerId } from "../auth.ts";
import { config } from "../config.ts";
import { query } from "../db/database.ts";
import { emailFromHook, HookError, validHookSignature, type HookPayload } from "./hook.ts";
import { createMailer, MailError } from "./send.ts";
import { sendWelcome } from "./welcome.ts";

const fail = (status: number, message: string) => ({ error: { http_code: status, message } });

export async function registerMailRoutes(app: FastifyInstance) {
  const send = createMailer({ resendApiKey: config.mail.resendApiKey, brevoApiKey: config.mail.brevoApiKey, from: config.mail.from });

  // Called by the front end once a new account is confirmed (email link, email code or Google). The address comes only from
  // the signed-in token, so it can never be used to email anyone else, and a person is welcomed once.
  app.post("/v1/me/welcome", async (request, reply) => {
    try {
      const outcome = await sendWelcome({ ...(request.user ?? { id: callerId(request) }) }, {
        claim: async (userId) => (await query("insert into app.welcome_emails (user_id) values ($1) on conflict do nothing returning user_id", [userId])).rowCount === 1,
        release: async (userId) => { await query("delete from app.welcome_emails where user_id = $1", [userId]); },
        send,
        from: config.mail.welcomeFrom,
        appUrl: config.mail.appUrl
      });
      if (outcome.status === "sent") request.log.info({ provider: outcome.provider }, "welcome email sent");
      return reply.send({ sent: outcome.status === "sent" });
    } catch (error) {
      request.log.error({ err: error instanceof MailError ? error.message : error }, "welcome email failed");
      return reply.code(500).send({ error: { code: "welcome_failed", message: "Could not send the welcome email." } });
    }
  });

  // Signed by Supabase, not by a user, so its body is kept raw and the signature is checked against exactly what was sent.
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1_000_000 }, (_request, body, done) => done(null, body));
    scope.post("/v1/auth/email-hook", async (request, reply) => {
      if (config.auth.mode !== "supabase" || !config.mail.hookSecret) return reply.code(503).send(fail(503, "The email hook is not configured."));
      const raw = request.body as Buffer;
      if (!validHookSignature(raw, request.headers, config.mail.hookSecret)) return reply.code(401).send(fail(401, "Signature does not match."));
      try {
        const message = emailFromHook(JSON.parse(raw.toString("utf8")) as HookPayload, config.auth.supabaseUrl, config.mail.expiresMinutes);
        const result = await send(message);
        if (result.fellBackFrom) request.log.warn({ provider: result.provider, fellBackFrom: result.fellBackFrom }, "auth email sent by the fallback provider");
        else request.log.info({ provider: result.provider }, "auth email sent");
        return reply.send({});
      } catch (error) {
        if (error instanceof HookError) return reply.code(error.status).send(fail(error.status, error.message));
        if (error instanceof SyntaxError) return reply.code(400).send(fail(400, "Not JSON."));
        request.log.error({ err: error instanceof MailError ? error.message : error }, "auth email failed");
        return reply.code(500).send(fail(500, "Could not send the email."));
      }
    });
  });
}
