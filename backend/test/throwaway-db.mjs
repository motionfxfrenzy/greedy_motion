// Unit test for the shared throwaway-database guard (backend/test/support/throwaway-db.mjs).
import assert from "node:assert/strict";
import { assertThrowawayDb, databaseName } from "./support/throwaway-db.mjs";

const hosts = ["localhost", "127.0.0.1", "[::1]"];
const goodNames = ["plates_unit", "plates_rebundle", "plates_rebundle_wake", "plates_followups_test", "my_test_db"];

for (const host of hosts) {
  for (const name of goodNames) {
    const url = `postgres://videosaas:supersecret@${host}:55432/${name}`;
    assert.equal(databaseName(url), name);
    assert.equal(assertThrowawayDb(url), name);
  }
}

const badNames = ["videosaas", "postgres", "app", ""];
for (const name of badNames) {
  for (const host of hosts) {
    const url = `postgres://videosaas:supersecret@${host}:55432/${name}`;
    assert.throws(
      () => assertThrowawayDb(url),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes("supersecret"), "never print password in error");
        return true;
      },
      `must refuse database name "${name}" on ${host}`
    );
  }
}

const badHosts = ["db.prod.example.com", "localhost.evil.com", "127.0.0.1.evil.com"];
for (const host of badHosts) {
  for (const name of goodNames) {
    const url = `postgres://videosaas:supersecret@${host}:55432/${name}`;
    assert.throws(
      () => assertThrowawayDb(url),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes("supersecret"), "never print password in error");
        return true;
      },
      `must refuse host "${host}" even with throwaway name "${name}"`
    );
  }
}

// Missing / empty / invalid URLs
for (const missing of [undefined, null, "", "   ", "not-a-url://[bad"]) {
  assert.throws(() => assertThrowawayDb(missing));
}
const prevDbUrl = process.env.DATABASE_URL;
try {
  delete process.env.DATABASE_URL;
  assert.throws(() => assertThrowawayDb());
} finally {
  if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl;
}

// Userinfo trick: "test" or "plates_unit" in username/password must not bypass host or db name checks
assert.throws(
  () => assertThrowawayDb("postgres://test@prod.example.com/videosaas"),
  (err) => {
    assert.ok(err instanceof Error);
    return true;
  }
);
assert.throws(
  () => assertThrowawayDb("postgres://plates_unit:test_secret@localhost:55432/videosaas"),
  (err) => {
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes("test_secret"), "never print password in error");
    return true;
  }
);

console.log("throwaway-db: ok");
