import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchBundle, reportCheck, requestClip, sha256Hex, withBackendAuth } from "../lib/live/api.ts";

// Live-scene calls must carry the signed-in user's token to the app's own backend proxy, exactly like apiFetch, and must never
// send it to the presigned storage URL (staging returned 401 for every bundle before this, because nothing added the header).

const recorder = () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, auth: new Headers(init.headers).get("authorization") });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
};

test("adds the bearer token to relative /api/backend/ calls only", async () => {
  const { calls, fetchImpl } = recorder();
  const f = withBackendAuth(async () => "tok-1", fetchImpl);
  await f("/api/backend/projects/p/plates/v/bundle");
  await f("https://bucket.r2.cloudflarestorage.com/plates/p/g1/bundle.html?X-Amz-Signature=abc");
  await f("/api/backendx/whatever");
  await f("/v1/projects/p");
  assert.deepEqual(calls.map((c) => c.auth), ["Bearer tok-1", null, null, null]);
});

test("keeps caller headers and sends no header when signed out", async () => {
  const { calls, fetchImpl } = recorder();
  await withBackendAuth(async () => "tok-2", fetchImpl)("/api/backend/x", { method: "POST", headers: { "content-type": "application/json" } });
  await withBackendAuth(async () => null, fetchImpl)("/api/backend/x");
  assert.equal(calls[0].auth, "Bearer tok-2");
  assert.equal(calls[1].auth, null);
});

test("absolute URLs on this page's origin count as the backend proxy; other origins do not", async () => {
  const { calls, fetchImpl } = recorder();
  const saved = globalThis.location;
  Object.defineProperty(globalThis, "location", { value: { origin: "https://staging.example.com" }, configurable: true });
  try {
    const f = withBackendAuth(async () => "tok-3", fetchImpl);
    await f("https://staging.example.com/api/backend/projects/p");
    await f("https://evil.example.com/api/backend/projects/p");
    await f(new URL("https://staging.example.com/api/backend/q"));
  } finally {
    if (saved === undefined) delete globalThis.location; else Object.defineProperty(globalThis, "location", { value: saved, configurable: true });
  }
  assert.deepEqual(calls.map((c) => c.auth), ["Bearer tok-3", null, "Bearer tok-3"]);
});

test("fetchBundle, reportCheck and requestClip send the token to the route but not to storage", async () => {
  const html = "<!doctype html><title>scene</title>";
  const bundleSha = (await sha256Hex(html)).slice(0, 24);
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init.headers).get("authorization") });
    if (url.endsWith("/bundle")) {
      return Response.json({ url: "https://store.example.com/plates/p/g2/bundle.html?sig=1", expiresAt: new Date(Date.now() + 600_000).toISOString(), bundleDigest: "d1", manifest: { bundleSha }, params: {}, gen: 2 });
    }
    if (url.startsWith("https://store.example.com/")) return new Response(html, { status: 200 });
    if (url.endsWith("/check")) return Response.json({ state: "checked" });
    if (url.endsWith("/clip")) return Response.json({ state: "rendering" }, { status: 202 });
    return new Response("not found", { status: 404 });
  };
  const opts = { baseUrl: "/api/backend", fetch: withBackendAuth(async () => "tok-4", fetchImpl) };
  const bundle = await fetchBundle("p", "v", opts);
  assert.equal(bundle.html, html);
  await reportCheck("p", "v", { gen: 2, bundleDigest: "d1", results: { ok: true } }, opts);
  await requestClip("p", "v", opts);
  const route = calls.filter((c) => c.url.startsWith("/api/backend/"));
  const storage = calls.filter((c) => c.url.startsWith("https://store.example.com/"));
  assert.ok(route.length >= 3, JSON.stringify(calls));
  assert.ok(route.every((c) => c.auth === "Bearer tok-4"), JSON.stringify(route));
  assert.equal(storage.length, 1);
  assert.equal(storage[0].auth, null);
});
