// "Your film is ready" email: the template, the once-per-job claim (real Postgres) and the retry after a failed send.
//   DATABASE_URL=postgres://… node test/render-ready-email.mjs   (cleans up its own rows; provider calls are fakes)
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
process.env.PLANNER ??= "deterministic";
const { migrate, pool, query } = await import("../src/db/database.ts");
const { sendRenderReady } = await import("../src/mail/render-ready.ts");
const { renderReadyEmail } = await import("../src/mail/templates.ts");
await migrate();

const A = "00000000-0000-4000-8000-0000000c0001", B = "00000000-0000-4000-8000-0000000c0002";
const USER = "00000000-0000-4000-8000-0000000c00aa";
const clean = () => pool.query("delete from app.render_ready_emails where job_id = any($1)", [[A, B]]);
await clean();

const sent = [];
const deps = (over = {}) => ({
  claim: async (jobId, userId) => (await query("insert into app.render_ready_emails (job_id, user_id) values ($1, $2) on conflict do nothing returning job_id", [jobId, userId])).rowCount === 1,
  release: async (jobId) => { await query("delete from app.render_ready_emails where job_id = $1", [jobId]); },
  send: async (message) => { sent.push(message); return { provider: "resend", id: "x" }; },
  from: "GreedyMotion <noreply@greedymotion.com>",
  appUrl: "https://www.greedymotion.com/",
  ...over
});
const job = (over = {}) => ({ id: A, userId: USER, email: "person@example.com", name: "Sam", title: "Spring launch", ...over });

try {
  // The template names the film, links to the library without a double slash, and escapes what a person typed.
  const mail = renderReadyEmail({ to: "p@example.com", name: "Sam", title: 'Launch <b>"x"</b>', appUrl: "https://www.greedymotion.com/" });
  assert.match(mail.subject, /^Your film "Launch <b>"x"<\/b>" is ready$/);
  assert.ok(mail.html.includes("https://www.greedymotion.com/library") && !mail.html.includes("com//library"));
  assert.ok(!mail.html.includes("<b>\"x\""), "the title is escaped in the html");
  assert.ok(mail.text.includes("Watch and download: https://www.greedymotion.com/library"));
  assert.equal(renderReadyEmail({ to: "p@example.com", appUrl: "https://x.test" }).subject, "Your film is ready");
  assert.equal(renderReadyEmail({ to: "p@example.com", title: "a".repeat(500), appUrl: "https://x.test" }).subject.length < 170, true);

  // First delivery sends from noreply@ with support as the reply address; a second one for the same job sends nothing.
  assert.deepEqual(await sendRenderReady(job(), deps()), { status: "sent", provider: "resend" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "person@example.com");
  assert.equal(sent[0].from, "GreedyMotion <noreply@greedymotion.com>");
  assert.equal(sent[0].replyTo, "support@greedymotion.com");
  assert.deepEqual(await sendRenderReady(job(), deps()), { status: "already_sent" });
  assert.equal(sent.length, 1, "a redelivered notification mails nothing");

  // Two replicas hearing the same finish at once: exactly one email.
  const before = sent.length;
  const both = await Promise.all([sendRenderReady(job({ id: B }), deps()), sendRenderReady(job({ id: B }), deps())]);
  assert.deepEqual(both.map((r) => r.status).sort(), ["already_sent", "sent"]);
  assert.equal(sent.length, before + 1);

  // No address: nothing is claimed, so a later pass can still send once an address exists.
  await clean();
  assert.deepEqual(await sendRenderReady(job({ email: null }), deps()), { status: "no_email" });
  assert.equal((await query("select 1 from app.render_ready_emails where job_id = $1", [A])).rowCount, 0);

  // A failed send gives the claim back, so the next pass retries and then succeeds.
  const failing = deps({ send: async () => { throw new Error("provider down"); } });
  await assert.rejects(sendRenderReady(job(), failing), /provider down/);
  assert.equal((await query("select 1 from app.render_ready_emails where job_id = $1", [A])).rowCount, 0);
  assert.deepEqual(await sendRenderReady(job(), deps()), { status: "sent", provider: "resend" });
  console.log("render-ready-email: ok");
} finally {
  await clean();
  await pool.end();
}
