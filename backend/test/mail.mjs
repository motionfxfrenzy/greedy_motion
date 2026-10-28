// Account email: Resend first, Brevo when Resend fails; the Supabase hook's signature and payload; the branded template.
// Run: node backend/test/mail.mjs   (no database, no network: provider calls use a fake fetch)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
const { createMailer, parseFrom, MailError } = await import("../src/mail/send.ts");
const { authEmail, authActions, LOGO_URL } = await import("../src/mail/templates.ts");
const { validHookSignature, emailFromHook, HookError } = await import("../src/mail/hook.ts");

const message = { to: "person@example.com", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };
const from = "GreedyMotion <noreply@greedymotion.com>";
const json = (status, body) => new Response(JSON.stringify(body), { status });
/** A fake fetch that answers per provider and records who was called. */
const fake = (answers) => {
  const calls = [];
  const impl = async (url, init) => {
    const provider = String(url).includes("resend") ? "resend" : "brevo";
    calls.push({ provider, headers: init.headers, body: JSON.parse(init.body) });
    const answer = answers[provider];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, impl };
};
const mailer = (answers, keys = { resendApiKey: "re_x", brevoApiKey: "xkeysib-x" }) => {
  const f = fake(answers);
  return { send: createMailer({ ...keys, from, fetch: f.impl }), calls: f.calls };
};

// ---- Resend sends first; Brevo is not touched when it works ----
{
  const { send, calls } = mailer({ resend: json(200, { id: "r1" }), brevo: json(201, { messageId: "b1" }) });
  assert.deepEqual(await send(message), { provider: "resend", id: "r1" });
  assert.deepEqual(calls.map((c) => c.provider), ["resend"]);
  assert.equal(calls[0].headers.Authorization, "Bearer re_x");
  assert.equal(calls[0].body.from, from);
  assert.deepEqual(calls[0].body.to, ["person@example.com"]);
}

// ---- any Resend failure falls back to Brevo, with the same message ----
for (const [label, resend] of [
  ["rate limit", json(429, { name: "rate_limit_exceeded" })],
  ["daily quota", json(429, { name: "daily_quota_exceeded" })],
  ["monthly quota", json(429, { name: "monthly_quota_exceeded" })],
  ["server error", json(503, {})],
  ["rejected", json(403, { message: "domain not verified" })],
  ["network error", new TypeError("fetch failed")],
  ["timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" })]
]) {
  const { send, calls } = mailer({ resend, brevo: json(201, { messageId: "b1" }) });
  const result = await send(message);
  assert.equal(result.provider, "brevo", label);
  assert.equal(result.id, "b1", label);
  assert.match(result.fellBackFrom, /resend/, label);
  assert.deepEqual(calls.map((c) => c.provider), ["resend", "brevo"], label);
  assert.equal(calls[1].headers["api-key"], "xkeysib-x");
  assert.deepEqual(calls[1].body.sender, { name: "GreedyMotion", email: "noreply@greedymotion.com" });
  assert.deepEqual(calls[1].body.to, [{ email: "person@example.com" }]);
  assert.equal(calls[1].body.subject, "Hello");
  assert.equal(calls[1].body.htmlContent, "<p>Hi</p>");
  assert.equal(calls[1].body.textContent, "Hi");
}

// ---- both failing is an error that names both; one key alone works; no key is an error ----
{
  const { send } = mailer({ resend: json(429, { name: "rate_limit_exceeded" }), brevo: json(401, { message: "key invalid" }) });
  await assert.rejects(send(message), (error) => error instanceof MailError && error.attempts.length === 2 && /resend/.test(error.message) && /brevo/.test(error.message));
}
{
  const { send, calls } = mailer({ brevo: json(201, { messageId: "b2" }) }, { resendApiKey: "", brevoApiKey: "k" });
  assert.deepEqual(await send(message), { provider: "brevo", id: "b2" });
  assert.deepEqual(calls.map((c) => c.provider), ["brevo"], "no Resend key: Resend is not called");
}
{
  const { send } = mailer({}, { resendApiKey: "", brevoApiKey: "" });
  await assert.rejects(send(message), (error) => error instanceof MailError && /not configured/.test(error.message));
}
assert.deepEqual(parseFrom("GreedyMotion <noreply@greedymotion.com>"), { name: "GreedyMotion", email: "noreply@greedymotion.com" });
assert.deepEqual(parseFrom("noreply@greedymotion.com"), { name: undefined, email: "noreply@greedymotion.com" });

// ---- the template: branded, with the code and the link ----
for (const action of authActions) {
  const mail = authEmail({ action, to: "a@b.co", code: "123456", link: "https://x.supabase.co/auth/v1/verify?token=h&type=" + action, name: "Ada <b>" });
  assert.ok(mail.html.includes(LOGO_URL), `${action}: logo`);
  assert.ok(mail.html.includes("123456") && mail.text.includes("123456"), `${action}: code in html and text`);
  assert.ok(mail.html.includes("#0a6cff"), `${action}: brand blue`);
  assert.ok(!mail.html.includes("Ada <b>") && mail.html.includes("Ada &lt;b&gt;"), `${action}: name is escaped`);
  assert.ok(mail.subject.length > 0);
  if (action === "reauthentication") assert.ok(!mail.html.includes("/auth/v1/verify"), "reauthentication is code only");
  else assert.ok(mail.html.includes("/auth/v1/verify?token=h") && mail.text.includes("/auth/v1/verify?token=h"), `${action}: link in html and text`);
}
assert.match(authEmail({ action: "signup", to: "a@b.co", code: "1", link: "https://l" }).subject, /Confirm your GreedyMotion account/);

// ---- the hook: signature ----
const secret = "v1,whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const sign = (id, ts, body) => "v1," + createHmac("sha256", Buffer.from(secret.slice(9), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
const body = JSON.stringify({ user: { email: "a@b.co", user_metadata: { full_name: "Ada" } }, email_data: { token: "654321", token_hash: "hash123", redirect_to: "https://greedymotion.com/auth/callback?next=/studio", email_action_type: "signup" } });
const now = 1_800_000_000;
const headers = (over = {}) => ({ "webhook-id": "msg_1", "webhook-timestamp": String(now), "webhook-signature": sign("msg_1", now, body), ...over });
assert.equal(validHookSignature(Buffer.from(body), headers(), secret, now), true, "a correct signature passes");
assert.equal(validHookSignature(Buffer.from(body), headers({ "webhook-signature": "v1,AAAA " + sign("msg_1", now, body) }), secret, now), true, "one of several signatures may match");
assert.equal(validHookSignature(Buffer.from(body + " "), headers(), secret, now), false, "an altered body fails");
assert.equal(validHookSignature(Buffer.from(body), headers({ "webhook-signature": sign("msg_1", now, "other") }), secret, now), false, "a wrong signature fails");
assert.equal(validHookSignature(Buffer.from(body), headers(), "v1,whsec_" + Buffer.from("another-secret-another-secret-00").toString("base64"), now), false, "a wrong secret fails");
assert.equal(validHookSignature(Buffer.from(body), headers(), secret, now + 301), false, "a stale timestamp fails");
assert.equal(validHookSignature(Buffer.from(body), headers({ "webhook-id": undefined }), secret, now), false, "a missing header fails");
assert.equal(validHookSignature(Buffer.from(body), headers(), "", now), false, "no secret configured never passes");

// ---- the hook: payload -> email ----
{
  const mail = emailFromHook(JSON.parse(body), "https://abc.supabase.co");
  assert.equal(mail.to, "a@b.co");
  assert.match(mail.subject, /Confirm your GreedyMotion account/);
  assert.ok(mail.html.includes("654321") && mail.html.includes("Hi Ada,"));
  const link = /href="([^"]*auth\/v1\/verify[^"]*)"/.exec(mail.html)[1].replaceAll("&amp;", "&");
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, "https://abc.supabase.co/auth/v1/verify");
  assert.equal(url.searchParams.get("token"), "hash123");
  assert.equal(url.searchParams.get("type"), "signup");
  assert.equal(url.searchParams.get("redirect_to"), "https://greedymotion.com/auth/callback?next=/studio");
}
// The "Copy link" button opens the site's copy page (a mail client cannot copy for you), on the site the person signed up on.
{
  const verify = "https://abc.supabase.co/auth/v1/verify?token=hash123&type=signup&redirect_to=" + encodeURIComponent("https://greedymotion.com/auth/callback?next=/studio");
  const mail = emailFromHook(JSON.parse(body), "https://abc.supabase.co");
  assert.ok(mail.html.includes(`href="https://greedymotion.com/auth/link?u=${encodeURIComponent(verify)}"`), "copy button targets the copy page with the verify link");
  assert.ok(mail.html.includes(">Copy link</a>"));
  assert.ok(!mail.html.includes("Click or tap the link to select"), "the raw link is no longer printed in the email");
  assert.ok(mail.text.includes(verify), "the plain-text part still carries the full link");
  const staging = JSON.parse(body);
  staging.email_data.redirect_to = "https://staging.greedymotion.com/auth/callback?next=/studio";
  assert.ok(emailFromHook(staging, "https://abc.supabase.co").html.includes('href="https://staging.greedymotion.com/auth/link?u='), "the copy page is on the requesting site's host");
  delete staging.email_data.redirect_to;
  assert.ok(emailFromHook(staging, "https://abc.supabase.co").html.includes('href="https://greedymotion.com/auth/link?u='), "no redirect target: the main site");
  assert.ok(!authEmail({ action: "reauthentication", to: "a@b.co", code: "1", copyLink: "https://x/y" }).html.includes("Copy link"), "a code-only email has no link to copy");
}
assert.throws(() => emailFromHook({ user: {}, email_data: {} }, "https://abc.supabase.co"), (e) => e instanceof HookError && e.status === 400);
assert.throws(() => emailFromHook({ user: { email: "a@b.co" }, email_data: { token: "1", token_hash: "h", email_action_type: "email_change" } }, "https://abc.supabase.co"), (e) => e instanceof HookError && /email_change/.test(e.message));

// ---- sender and reply-to: account emails use the mailer's default (noreply@); a message can override it, on both providers ----
{
  const plain = mailer({ resend: json(200, { id: "r1" }), brevo: json(201, { messageId: "b1" }) });
  await plain.send(message);
  assert.equal(plain.calls[0].body.from, from, "no override: the default sender");
  assert.ok(!("reply_to" in plain.calls[0].body), "no reply-to unless one is given");
  const hello = "GreedyMotion <hello@greedymotion.com>";
  const viaResend = mailer({ resend: json(200, { id: "r2" }), brevo: json(201, { messageId: "b2" }) });
  await viaResend.send({ ...message, from: hello, replyTo: "support@greedymotion.com" });
  assert.equal(viaResend.calls[0].body.from, hello);
  assert.equal(viaResend.calls[0].body.reply_to, "support@greedymotion.com");
  const viaBrevo = mailer({ resend: json(429, {}), brevo: json(201, { messageId: "b3" }) });
  await viaBrevo.send({ ...message, from: hello, replyTo: "support@greedymotion.com" });
  assert.deepEqual(viaBrevo.calls[1].body.sender, { name: "GreedyMotion", email: "hello@greedymotion.com" }, "the fallback keeps the override");
  assert.deepEqual(viaBrevo.calls[1].body.replyTo, { email: "support@greedymotion.com" });
}

// ---- the welcome email ----
const { welcomeEmail, SUPPORT_EMAIL } = await import("../src/mail/templates.ts");
const { sendWelcome } = await import("../src/mail/welcome.ts");
{
  const mail = welcomeEmail({ to: "a@b.co", name: "Ada <b>", appUrl: "https://app.greedymotion.com/" });
  assert.equal(SUPPORT_EMAIL, "support@greedymotion.com");
  assert.equal(mail.subject, "Welcome to GreedyMotion");
  assert.ok(mail.html.includes(LOGO_URL) && mail.html.includes("#0a6cff"), "same look as the account emails");
  assert.ok(mail.html.includes("Ada &lt;b&gt;") && !mail.html.includes("Ada <b>"), "name is escaped");
  assert.ok(mail.html.includes('href="https://app.greedymotion.com/studio"') && mail.html.includes("Open your workspace"), "button opens the workspace");
  assert.ok(mail.html.includes("send us feedback") && mail.html.includes("if you want support") && mail.html.includes('href="mailto:support@greedymotion.com"'), "feedback and support copy with the address");
  assert.ok(mail.text.includes("support@greedymotion.com") && mail.text.includes("https://app.greedymotion.com/studio"), "plain text has both");
  assert.ok(authEmail({ action: "signup", to: "a@b.co", code: "1", link: "https://l" }).html.includes("support@greedymotion.com"), "account emails carry the support address too");
}

// ---- sendWelcome: once per person, from hello@, replies to support@ ----
{
  const sent = [];
  const claimed = new Set();
  const released = [];
  const deps = (over = {}) => ({
    claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
    release: async (id) => { released.push(id); claimed.delete(id); },
    send: async (m) => { sent.push(m); return { provider: "resend", id: "r" }; },
    from: "GreedyMotion <hello@greedymotion.com>",
    appUrl: "https://app.greedymotion.com",
    ...over
  });
  const user = { id: "u1", email: "a@b.co", name: "Ada" };
  assert.deepEqual(await sendWelcome(user, deps()), { status: "sent", provider: "resend" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, "GreedyMotion <hello@greedymotion.com>");
  assert.equal(sent[0].replyTo, "support@greedymotion.com");
  assert.equal(sent[0].to, "a@b.co");
  assert.deepEqual(await sendWelcome(user, deps()), { status: "already_sent" }, "a second call does not send again");
  assert.equal(sent.length, 1);
  assert.deepEqual(await sendWelcome({ id: "u2" }, deps()), { status: "no_email" }, "no address (local dev) sends nothing");
  assert.equal(sent.length, 1);
  await assert.rejects(sendWelcome({ id: "u3", email: "c@d.co" }, deps({ send: async () => { throw new Error("both providers down"); } })), /both providers down/);
  assert.deepEqual(released, ["u3"], "a failed send gives the claim back");
  assert.deepEqual(await sendWelcome({ id: "u3", email: "c@d.co" }, deps()), { status: "sent", provider: "resend" }, "so a retry can deliver it");
}

console.log("mail: ok");
