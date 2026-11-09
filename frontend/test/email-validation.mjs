import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EMAIL_VALIDATION_MESSAGES,
  MAX_EMAIL_LOCAL_DOTS,
  emailProblem,
  isAllowedEmail,
  validateEmailAddress
} from "@videosaas/contracts";

test("rejects any '+' in the local part before '@'", () => {
  for (const input of [
    "user+tag@example.com",
    "a.b+tag@example.com",
    "+user@example.com",
    "user+@example.com",
    "  user+123@sub.example.co.uk  "
  ]) {
    const res = validateEmailAddress(input);
    assert.equal(res.ok, false, input);
    if (!res.ok) {
      assert.equal(res.code, "plus_not_allowed", input);
      assert.equal(res.message, EMAIL_VALIDATION_MESSAGES.plus_not_allowed, input);
    }
    assert.equal(emailProblem(input), EMAIL_VALIDATION_MESSAGES.plus_not_allowed, input);
    assert.equal(isAllowedEmail(input), false, input);
  }
});

test("allows 0, 1, or 2 dots in the local part and rejects 3 or more", () => {
  assert.equal(MAX_EMAIL_LOCAL_DOTS, 2);

  const validCases = [
    { input: "user@example.com", local: "user", domain: "example.com", dots: 0 },
    { input: "first.last@example.com", local: "first.last", domain: "example.com", dots: 1 },
    { input: "first.middle.last@example.com", local: "first.middle.last", domain: "example.com", dots: 2 }
  ];

  for (const c of validCases) {
    const res = validateEmailAddress(c.input);
    assert.deepEqual(res, {
      ok: true,
      email: c.input,
      localPart: c.local,
      domain: c.domain,
      localDotCount: c.dots
    });
    assert.equal(emailProblem(c.input), null);
    assert.equal(isAllowedEmail(c.input), true);
  }

  for (const tooMany of [
    "a.b.c.d@example.com",
    "one.two.three.four@example.com",
    "...user@example.com",
    "  a.b.c.d@example.org  "
  ]) {
    const res = validateEmailAddress(tooMany);
    assert.equal(res.ok, false, tooMany);
    if (!res.ok) {
      assert.equal(res.code, "too_many_dots", tooMany);
      assert.equal(res.message, EMAIL_VALIDATION_MESSAGES.too_many_dots, tooMany);
    }
    assert.equal(emailProblem(tooMany), EMAIL_VALIDATION_MESSAGES.too_many_dots, tooMany);
    assert.equal(isAllowedEmail(tooMany), false, tooMany);
  }
});

test("excludes domain dots from local-part dot count and does not strip dots", () => {
  const address = "first.middle.last@a.b.c.d.example.co.uk";
  const res = validateEmailAddress(address);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.localDotCount, 2);
    assert.equal(res.localPart, "first.middle.last");
    assert.equal(res.domain, "a.b.c.d.example.co.uk");
    assert.equal(res.email, address);
  }
});

test("trims surrounding whitespace and preserves ordinary email syntax checks", () => {
  const res = validateEmailAddress("  \n\t  first.last@sub.example.com  \t ");
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.email, "first.last@sub.example.com");
    assert.equal(res.localPart, "first.last");
    assert.equal(res.domain, "sub.example.com");
    assert.equal(res.localDotCount, 1);
  }

  for (const invalid of [
    "",
    "   ",
    "not-an-email",
    "@example.com",
    "user@",
    "user@localhost",
    "user name@example.com",
    "user@exam ple.com",
    "user@@example.com"
  ]) {
    const bad = validateEmailAddress(invalid);
    assert.equal(bad.ok, false, `expected syntax failure for "${invalid}"`);
    if (!bad.ok) {
      assert.equal(bad.code, "syntax");
      assert.equal(bad.message, EMAIL_VALIDATION_MESSAGES.syntax);
    }
  }
});

test("frontend auth entry points and backend trust boundary import the shared validator", async () => {
  const [authPage, callbackRoute, middleware, resetPage, profilePage, accountMenu, backendAuth, backendHook, backendWelcome, backendRenderReady] = await Promise.all([
    readFile(new URL("../components/auth-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../utils/supabase/middleware.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/reset/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/profile-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/account-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../backend/src/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../../backend/src/mail/hook.ts", import.meta.url), "utf8"),
    readFile(new URL("../../backend/src/mail/welcome.ts", import.meta.url), "utf8"),
    readFile(new URL("../../backend/src/mail/render-ready.ts", import.meta.url), "utf8")
  ]);

  for (const [name, source] of [
    ["auth-page.tsx", authPage],
    ["auth/callback/route.ts", callbackRoute],
    ["utils/supabase/middleware.ts", middleware],
    ["auth/reset/page.tsx", resetPage],
    ["profile-page.tsx", profilePage],
    ["account-menu.tsx", accountMenu],
    ["backend/src/auth.ts", backendAuth],
    ["backend/src/mail/hook.ts", backendHook],
    ["backend/src/mail/welcome.ts", backendWelcome],
    ["backend/src/mail/render-ready.ts", backendRenderReady]
  ]) {
    assert.match(source, /validateEmailAddress/, `${name} must use validateEmailAddress`);
  }
});
