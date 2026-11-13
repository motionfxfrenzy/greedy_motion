// Light is the default theme everywhere: a visitor who never picked a theme gets light whatever their device prefers;
// only an explicit Dark or System choice (saved in localStorage "gm-theme") changes it.
// Run: node --test frontend/test/theme-default.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { THEME_KEY, themeBootScript, siteTheme, themeChoice, setSiteTheme, followSystemTheme } from "../lib/site-theme.ts";

/** Runs the real boot script against a fake <html> and storage; returns the attributes it left on <html>. */
function boot(stored, { throws = false } = {}) {
  const dataset = {};
  const localStorage = { getItem: (k) => { if (throws) throw new Error("blocked"); assert.equal(k, THEME_KEY); return stored; } };
  vm.runInNewContext(themeBootScript, { localStorage, document: { documentElement: { dataset } } });
  return dataset;
}

test("boot script: nothing saved, garbage or unreadable storage is light and never marks System", () => {
  for (const stored of [null, "", "light", "LIGHT", "auto", "{}"]) {
    const d = boot(stored);
    assert.equal(d.theme, "light", `stored ${JSON.stringify(stored)}`);
    assert.equal("system" in d, false);
  }
  const blocked = boot(null, { throws: true });
  assert.equal(blocked.theme, "light");
  assert.equal("system" in blocked, false);
});

test("boot script keeps the choices of users who picked Dark or System", () => {
  assert.deepEqual(boot("dark"), { theme: "dark" });
  const system = boot("system");
  assert.equal("system" in system, true, "System marks the page so theme.css may follow the device");
  assert.equal("theme" in system, false);
});

/** Fake browser globals for the runtime helpers; `deviceDark` is the OS setting. */
function withPage(dataset, deviceDark, run) {
  const store = {};
  globalThis.document = { documentElement: { dataset } };
  globalThis.window = { matchMedia: () => ({ matches: deviceDark }) };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  try { return run(store); } finally { delete globalThis.document; delete globalThis.window; delete globalThis.localStorage; }
}

test("a dark device does not make the site dark unless the viewer chose System", () => {
  assert.equal(withPage({ theme: "light" }, true, () => siteTheme()), "light", "boot script result for a first-time visitor");
  assert.equal(withPage({}, true, () => siteTheme()), "light", "even with no script having run");
  assert.equal(withPage({}, true, () => themeChoice()), "light");
  assert.equal(withPage({ system: "" }, true, () => siteTheme()), "dark", "System on a dark device");
  assert.equal(withPage({ system: "" }, false, () => siteTheme()), "light", "System on a light device");
  assert.equal(withPage({ system: "" }, true, () => themeChoice()), "system");
  assert.equal(withPage({ theme: "dark" }, false, () => siteTheme()), "dark");
});

test("choices persist and switch cleanly between Light, Dark and System", () => {
  const dataset = {};
  withPage(dataset, true, (store) => {
    setSiteTheme("dark");
    assert.deepEqual([dataset.theme, "system" in dataset, store[THEME_KEY]], ["dark", false, "dark"]);
    followSystemTheme();
    assert.deepEqual(["theme" in dataset, "system" in dataset, store[THEME_KEY]], [false, true, "system"]);
    assert.equal(themeChoice(), "system");
    setSiteTheme("light");
    assert.deepEqual([dataset.theme, "system" in dataset, store[THEME_KEY]], ["light", false, "light"]);
    assert.equal(themeChoice(), "light");
  });
});

test("theme.css only follows the device for System: no bare prefers-color-scheme rule", () => {
  const css = readFileSync(new URL("../app/theme.css", import.meta.url), "utf8");
  const blocks = [...css.matchAll(/@media \(prefers-color-scheme: dark\)\s*\{\s*([^{]+)\{/g)].map((m) => m[1].trim());
  assert.ok(blocks.length >= 1);
  for (const selector of blocks) assert.equal(selector, ':root[data-system]:not([data-theme])');
  assert.equal(css.includes(':root:not([data-theme="light"])'), false);
});
