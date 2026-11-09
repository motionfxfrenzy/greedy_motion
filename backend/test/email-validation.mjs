// Regression tests for email local-part validation across contracts, backend auth trust boundary, and mail hook/welcome.
// Run: node backend/test/email-validation.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Fastify from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const {
  EMAIL_VALIDATION_MESSAGES,
  MAX_EMAIL_LOCAL_DOTS,
  emailProblem,
  isAllowedEmail,
  validateEmailAddress
} = await import("@videosaas/contracts");
const { emailFromHook, HookError } = await import("../src/mail/hook.ts");

assert.equal(MAX_EMAIL_LOCAL_DOTS, 2);

// ---- 1. Plus rejection in local part ----
for (const invalidPlus of [
  "alice+tag@example.com",
  "a+b+c@example.com",
  "+leading@example.com",
  "trailing+@example.com",
  "first.last+promo@sub.domain.co.uk",
  "  alice+spaced@example.com  "
]) {
  const res = validateEmailAddress(invalidPlus);
  assert.equal(res.ok, false, `expected '+' rejection for ${invalidPlus}`);
  assert.equal(res.code, "plus_not_allowed", invalidPlus);
  assert.equal(res.message, EMAIL_VALIDATION_MESSAGES.plus_not_allowed, invalidPlus);
  assert.equal(emailProblem(invalidPlus), EMAIL_VALIDATION_MESSAGES.plus_not_allowed, invalidPlus);
  assert.equal(isAllowedEmail(invalidPlus), false, invalidPlus);
}

// ---- 2. Local-part dot counts: 0, 1, 2 accepted; 3+ rejected ----
for (const [address, expectedLocal, expectedDomain, expectedDots] of [
  ["alice@example.com", "alice", "example.com", 0],
  ["first.last@example.com", "first.last", "example.com", 1],
  ["first.middle.last@example.com", "first.middle.last", "example.com", 2],
  ["a.b.c@sub.example.co.uk", "a.b.c", "sub.example.co.uk", 2]
]) {
  const res = validateEmailAddress(address);
  assert.deepEqual(
    res,
    {
      ok: true,
      email: address,
      localPart: expectedLocal,
      domain: expectedDomain,
      localDotCount: expectedDots
    },
    `expected valid for ${address}`
  );
  assert.equal(emailProblem(address), null, address);
  assert.equal(isAllowedEmail(address), true, address);
}

for (const threeOrMoreDots of [
  "a.b.c.d@example.com",
  "one.two.three.four.five@example.com",
  "...a@example.com",
  "a...b@example.com",
  "  a.b.c.d@sub.example.co.uk  "
]) {
  const res = validateEmailAddress(threeOrMoreDots);
  assert.equal(res.ok, false, `expected 3+ dots rejection for ${threeOrMoreDots}`);
  assert.equal(res.code, "too_many_dots", threeOrMoreDots);
  assert.equal(res.message, EMAIL_VALIDATION_MESSAGES.too_many_dots, threeOrMoreDots);
  assert.equal(emailProblem(threeOrMoreDots), EMAIL_VALIDATION_MESSAGES.too_many_dots, threeOrMoreDots);
  assert.equal(isAllowedEmail(threeOrMoreDots), false, threeOrMoreDots);
}

// ---- 3. Domain dots excluded & identity preserved (no dot stripping) ----
{
  const manyDomainDots = "first.second@a.b.c.d.e.example.co.uk";
  const res = validateEmailAddress(manyDomainDots);
  assert.equal(res.ok, true);
  assert.equal(res.localDotCount, 1);
  assert.equal(res.localPart, "first.second", "must not strip dots from local part");
  assert.equal(res.email, manyDomainDots, "must preserve email identity");
}

// ---- 4. Surrounding whitespace trimmed, internal whitespace rejected ----
{
  const padded = "  \t first.last@example.com \n ";
  const res = validateEmailAddress(padded);
  assert.equal(res.ok, true);
  assert.equal(res.email, "first.last@example.com");
  assert.equal(res.localPart, "first.last");
  assert.equal(res.domain, "example.com");
  assert.equal(res.localDotCount, 1);

  for (const badSpace of ["first last@example.com", "first@exam ple.com", "   ", ""]) {
    const bad = validateEmailAddress(badSpace);
    assert.equal(bad.ok, false, `expected syntax rejection for "${badSpace}"`);
    assert.equal(bad.code, "syntax");
  }
}

// ---- 5. Ordinary syntax validation preserved ----
for (const invalidSyntax of [
  null,
  undefined,
  42,
  {},
  "plainaddress",
  "@example.com",
  "alice@",
  "alice@localhost",
  "alice@@example.com",
  "alice@b@c.com"
]) {
  const res = validateEmailAddress(invalidSyntax);
  assert.equal(res.ok, false, `expected syntax rejection for ${String(invalidSyntax)}`);
  assert.equal(res.code, "syntax");
  assert.equal(res.message, EMAIL_VALIDATION_MESSAGES.syntax);
}

// ---- 6. Backend auth hook trust boundary (registerAuth) ----
{
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "email-test-key", alg: "ES256", use: "sig" };
  const jwksServer = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const port = jwksServer.address().port;
  const issuerBase = `http://127.0.0.1:${port}`;

  process.env.APP_ENV = "local";
  process.env.DATABASE_URL ||= "postgres://videosaas:videosaas@localhost:55432/videosaas";
  process.env.ANTHROPIC_API_KEY ||= "sk-ant-test-dummy-key";
  process.env.AUTH_MODE = "supabase";
  process.env.SUPABASE_URL = issuerBase;
  process.env.SUPABASE_JWKS_URL = `${issuerBase}/jwks`;
  process.env.EXPECTED_SUPABASE_PROJECT_REF = "";
  process.env.MEDIA_URL_SECRET = "email-validation-test-media-secret-0123456789";

  const { registerAuth } = await import("../src/auth.ts");
  const { migrate, pool } = await import("../src/db/database.ts");
  const { sendRenderReady } = await import("../src/mail/render-ready.ts");
  const logs = [];
  const app = Fastify({
    logger: {
      level: "info",
      stream: {
        write(msg) {
          logs.push(String(msg));
        }
      }
    }
  });
  registerAuth(app);
  app.get("/v1/me/probe", async (req) => ({ user: req.user }));
  await app.ready();

  const signToken = (sub, email) =>
    new SignJWT({ ...(email !== undefined ? { email } : {}), user_metadata: { full_name: "Test User" } })
      .setProtectedHeader({ alg: "ES256", kid: "email-test-key" })
      .setIssuer(`${issuerBase}/auth/v1`)
      .setAudience("authenticated")
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);

  try {
    // Allowed emails: 0, 1, 2 dots, many domain dots, surrounding whitespace
    for (const [email, expectedEmail] of [
      ["alice@example.com", "alice@example.com"],
      ["a.b@example.com", "a.b@example.com"],
      ["a.b.c@sub.domain.co.uk", "a.b.c@sub.domain.co.uk"],
      ["  a.b@example.com  ", "a.b@example.com"]
    ]) {
      const token = await signToken("00000000-0000-4000-8000-000000000001", email);
      const res = await app.inject({
        method: "GET",
        url: "/v1/me/probe",
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(res.statusCode, 200, `expected 200 for ${email}`);
      assert.equal(res.json().user.email, expectedEmail, "preserves trimmed email without stripping dots");
    }

    // Disallowed emails (including existing accounts presenting valid JWTs with '+' or 3+ dots)
    for (const [badEmail, expectedMessage] of [
      ["existing+alias@example.com", EMAIL_VALIDATION_MESSAGES.plus_not_allowed],
      ["existing.a.b.c@example.com", EMAIL_VALIDATION_MESSAGES.too_many_dots]
    ]) {
      const token = await signToken("00000000-0000-4000-8000-000000000002", badEmail);
      const res = await app.inject({
        method: "GET",
        url: "/v1/me/probe",
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(res.statusCode, 403, `expected 403 for ${badEmail}`);
      assert.deepEqual(res.json(), {
        error: {
          code: "invalid_email",
          message: expectedMessage
        }
      });
      // Ensure sensitive user email is not echoed into logs
      assert.equal(
        logs.some((line) => line.includes(badEmail)),
        false,
        `rejected email ${badEmail} must not be echoed into logs`
      );
    }

    // Hook consistency: emailFromHook uses the same validation and trims surrounding whitespace
    const validHook = emailFromHook(
      {
        user: { email: "  a.b.c@sub.example.co.uk  ", user_metadata: { full_name: "Ada" } },
        email_data: { token: "123456", token_hash: "h", email_action_type: "signup" }
      },
      "https://abc.supabase.co"
    );
    assert.equal(validHook.to, "a.b.c@sub.example.co.uk");

    for (const badEmail of ["user+1@example.com", "a.b.c.d@example.com"]) {
      assert.throws(
        () =>
          emailFromHook(
            {
              user: { email: badEmail },
              email_data: { token: "123456", token_hash: "h", email_action_type: "signup" }
            },
            "https://abc.supabase.co"
          ),
        (err) => err instanceof HookError && err.status === 400 && err.message === emailProblem(badEmail)
      );
    }

    // Render-ready email guard: disallowed addresses do not claim or send
    {
      const claimed = [];
      const sent = [];
      const deps = {
        claim: async (jobId) => {
          claimed.push(jobId);
          return true;
        },
        release: async () => undefined,
        send: async (m) => {
          sent.push(m);
          return { provider: "resend", id: "r1" };
        },
        from: "GreedyMotion <noreply@greedymotion.com>",
        appUrl: "https://app.greedymotion.com"
      };
      for (const badEmail of ["user+tag@example.com", "a.b.c.d@example.com"]) {
        const res = await sendRenderReady(
          { id: "00000000-0000-4000-8000-000000000099", userId: "00000000-0000-4000-8000-000000000002", email: badEmail, title: "Film" },
          deps
        );
        assert.deepEqual(res, { status: "no_email" });
      }
      assert.equal(claimed.length, 0);
      assert.equal(sent.length, 0);
    }

    // ---- 7. Postgres Before User Created hook function (`app.before_user_created_hook`) ----
    const { readFile } = await import("node:fs/promises");
    const hookMigrationSql = await readFile(new URL("../src/db/migrations/031_before_user_created_hook.sql", import.meta.url), "utf8");
    await migrate();
    await pool.query(hookMigrationSql);
    const callPgHook = async (event) => {
      const { rows } = await pool.query("select app.before_user_created_hook($1::jsonb) as res", [
        event === null ? null : JSON.stringify(event)
      ]);
      return rows[0].res;
    };

    // Allowed addresses (0, 1, 2 local dots; many domain dots; surrounding whitespace) -> `{}`
    for (const validEmail of [
      "alice@example.com",
      "first.last@example.com",
      "first.middle.last@example.com",
      "a.b.c@sub.one.two.three.example.co.uk",
      "  \t first.last@example.com \n "
    ]) {
      const hookRes = await callPgHook({ user: { id: "00000000-0000-4000-8000-000000000010", email: validEmail } });
      assert.deepEqual(hookRes, {}, `expected PG hook to allow ${validEmail}`);
    }

    // Disallowed '+' addresses -> 400 with exact message matching contracts
    for (const plusEmail of [
      "alice+tag@example.com",
      "+leading@example.com",
      "trailing+@example.com",
      "  first.last+promo@sub.example.co.uk  "
    ]) {
      const hookRes = await callPgHook({ user: { id: "00000000-0000-4000-8000-000000000011", email: plusEmail } });
      assert.deepEqual(
        hookRes,
        {
          error: {
            http_code: 400,
            message: EMAIL_VALIDATION_MESSAGES.plus_not_allowed
          }
        },
        `expected PG hook '+' rejection for ${plusEmail}`
      );
    }

    // Disallowed 3+ dot addresses -> 400 with exact message matching contracts
    for (const dotsEmail of [
      "a.b.c.d@example.com",
      "one.two.three.four.five@example.com",
      "...a@example.com",
      "  a.b.c.d@sub.example.co.uk  "
    ]) {
      const hookRes = await callPgHook({ user: { id: "00000000-0000-4000-8000-000000000012", email: dotsEmail } });
      assert.deepEqual(
        hookRes,
        {
          error: {
            http_code: 400,
            message: EMAIL_VALIDATION_MESSAGES.too_many_dots
          }
        },
        `expected PG hook 3+ dots rejection for ${dotsEmail}`
      );
    }

    // Syntax / malformed payloads -> 400
    for (const badEmail of ["", "   ", "plainaddress", "@example.com", "alice@", "alice@localhost", "alice@@example.com", "a b@example.com"]) {
      const hookRes = await callPgHook({ user: { email: badEmail } });
      assert.deepEqual(
        hookRes,
        {
          error: {
            http_code: 400,
            message: EMAIL_VALIDATION_MESSAGES.syntax
          }
        },
        `expected PG hook syntax rejection for "${badEmail}"`
      );
    }
    assert.deepEqual(await callPgHook({}), { error: { http_code: 400, message: "Invalid hook payload." } });
    assert.deepEqual(await callPgHook({ user: {} }), { error: { http_code: 400, message: EMAIL_VALIDATION_MESSAGES.syntax } });

    // Verify PUBLIC execute privilege is revoked on app.before_user_created_hook(jsonb)
    const { rows: privRows } = await pool.query(
      "select has_function_privilege('public', 'app.before_user_created_hook(jsonb)', 'EXECUTE') as public_exec"
    );
    assert.equal(privRows[0].public_exec, false, "PUBLIC must not have EXECUTE privilege on app.before_user_created_hook");
  } finally {
    await app.close();
    await pool.end();
    jwksServer.close();
  }
}

console.log("email-validation: ok");
