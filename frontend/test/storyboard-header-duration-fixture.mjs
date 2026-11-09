import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import {
  parseScriptBrief,
  renderCostMillitokens,
  scriptSeconds,
  tokensFromMilli
} from "@videosaas/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCREENSHOT_DIR = join(REPO_ROOT, "docs/handoff/screenshots/storyboard-header-duration");

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8")
].join("\n");

const SEVEN_BEATS_40S = [
  {
    keyword: "Barter cows",
    visual: "A cartoon farmer with a cow trading with a baker holding grain sacks.",
    onScreen: "Trade what you have",
    line: "Before coins or cards existed, you traded whatever you carried in hand."
  },
  {
    keyword: "Shells and salt",
    visual: "Hands swapping cowrie shells and carved bars of salt across a wooden counter.",
    onScreen: "Lighter tokens",
    line: "Soon communities used portable tokens like cowrie shells and salt."
  },
  {
    keyword: "Stamped coins",
    visual: "An anvil stamping a roaring lion crest onto a gleaming electrum coin.",
    onScreen: "Trusted weight",
    line: "In Lydia, kings stamped royal lions onto metal so coins matched."
  },
  {
    keyword: "Paper receipts",
    visual: "A merchant depositing heavy chests of gold into a vault in exchange for a crisp paper note.",
    onScreen: "Vault receipts",
    line: "Carrying heavy gold grew risky, so merchants locked gold and traded receipts."
  },
  {
    keyword: "Central reserves",
    visual: "A grand central bank vault stamping official seals onto stacks of banknotes.",
    onScreen: "Backed by law",
    line: "Governments backed those paper promises by law, creating national currencies everywhere."
  },
  {
    keyword: "Electric ledgers",
    visual: "Glowing digits zipping through an undersea cable between two continents.",
    onScreen: "Invisible numbers",
    line: "Telegraph wires and plastic cards moved balances across oceans at light speed."
  },
  {
    keyword: "Shared trust",
    visual: "Two characters tapping phones together with a warm burst of light.",
    onScreen: "Human trust",
    line: "From cows to code, money remains one shared story of trust."
  }
];

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#121824"/><circle cx="320" cy="180" r="88" fill="#168bff" opacity="0.28"/><text x="320" y="190" text-anchor="middle" fill="#eef2f8" font-family="sans-serif" font-size="26" font-weight="700">Scene frame</text></svg>`;

test("parseScriptBrief round-trip validation and billing/timing invariance for keepOverLength", () => {
  const baseInput = {
    scriptMode: "problem",
    text: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
    durationSeconds: 30,
    pace: "calm",
    aspect: "16:9",
    motionProfile: "smooth",
    captions: "key-phrases",
    audio: { mode: "both", voice: "Kore" }
  };

  const unaccepted = parseScriptBrief(baseInput);
  assert.ok("brief" in unaccepted, "valid brief parses");
  assert.equal(unaccepted.brief.keepOverLength, undefined, "new briefs default to unaccepted (undefined)");

  const accepted = parseScriptBrief({ ...baseInput, keepOverLength: true });
  assert.ok("brief" in accepted, "valid brief with keepOverLength: true parses");
  assert.equal(accepted.brief.keepOverLength, true, "keepOverLength: true is preserved by parseScriptBrief");

  const falseFlag = parseScriptBrief({ ...baseInput, keepOverLength: false });
  assert.ok("brief" in falseFlag);
  assert.equal(falseFlag.brief.keepOverLength, undefined, "keepOverLength: false normalizes to omitted");

  const runs = scriptSeconds(SEVEN_BEATS_40S, "calm");
  assert.equal(runs, 40, "7-beat calm script estimates 40s");
  assert.ok(runs > baseInput.durationSeconds * 1.15 + 2, "40s exceeds 30s * 1.15 + 2 threshold");

  const costBefore = tokensFromMilli(renderCostMillitokens(runs));
  const costAfter = tokensFromMilli(renderCostMillitokens(scriptSeconds(SEVEN_BEATS_40S, accepted.brief.pace)));
  assert.equal(costBefore, costAfter, "accepting over-length does not alter scriptSeconds or token cost calculation");
  assert.equal(accepted.brief.durationSeconds, 30, "target durationSeconds remains 30");
  assert.equal(accepted.brief.lockDuration, undefined, "lockDuration is not set by keepOverLength");
});

test("backend projects/store.ts round-trip persistence and validation for keepOverLength", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const script = `
    import assert from "node:assert/strict";
    import { randomUUID } from "node:crypto";
    process.env.APP_ENV = "local";
    process.env.PLANNER = "deterministic";
    process.env.DATABASE_URL = "postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit";
    const { defaultTemplateId, defaultThemeId } = await import("@videosaas/contracts");
    const { migrate, pool } = await import("./backend/src/db/database.ts");
    const {
      createProject,
      deleteProject,
      getProject,
      listProjects,
      ProjectInvalid,
      setProjectPlanning,
      updateProject,
      updateProjectPlan
    } = await import("./backend/src/projects/store.ts");

    await migrate();
    const ownerId = randomUUID();
    const request = {
      prompt: "Explain how money evolves from barter and shells to coins and digital ledgers.",
      format: "landscape",
      style: "clean",
      theme: defaultThemeId,
      template: defaultTemplateId,
      audio: { music: true, voiceover: true, voice: "Kore" }
    };
    const brief = {
      scriptMode: "problem",
      text: "Explain how money evolves from barter and shells to coins and digital ledgers.",
      durationSeconds: 30,
      pace: "calm",
      aspect: "16:9",
      motionProfile: "smooth",
      captions: "key-phrases",
      audio: { mode: "both", voice: "Kore" }
    };

    try {
      const p1 = await createProject({ name: "Money history", request }, ownerId);
      const p2 = await createProject({ name: "Second project", request }, ownerId);
      assert.equal(p1.keepOverLength, undefined, "new project defaults to unaccepted");

      await setProjectPlanning(p1.id, { status: "running", startedAt: new Date().toISOString() }, brief);

      await assert.rejects(
        () => updateProject(p1.id, { keepOverLength: "invalid" }),
        ProjectInvalid,
        "non-boolean keepOverLength is rejected by store validator"
      );

      const accepted = await updateProject(p1.id, { keepOverLength: true });
      assert.equal(accepted.keepOverLength, true, "updateProject returns keepOverLength: true");
      assert.equal(accepted.brief?.keepOverLength, true, "updateProject syncs brief.keepOverLength: true");

      const fetched = await getProject(p1.id);
      assert.equal(fetched?.keepOverLength, true, "getProject round-trips keepOverLength: true");
      assert.equal(fetched?.brief?.keepOverLength, true, "getProject round-trips brief.keepOverLength: true");

      const listed = await listProjects(ownerId);
      const listedP1 = listed.find((p) => p.id === p1.id);
      const listedP2 = listed.find((p) => p.id === p2.id);
      assert.equal(listedP1?.keepOverLength, true, "listProjects includes keepOverLength: true");
      assert.equal(listedP2?.keepOverLength, undefined, "second project remains independent");

      // Subsequent plan update where incoming brief omits keepOverLength must still preserve acceptance
      const afterPlan = await updateProjectPlan(p1.id, (curr) => ({
        brief: { ...brief },
        beatPlan: curr.beatPlan
      }));
      assert.equal(afterPlan?.keepOverLength, true, "updateProjectPlan preserves project.keepOverLength");
      assert.equal(afterPlan?.brief?.keepOverLength, true, "updateProjectPlan preserves brief.keepOverLength");

      // Subsequent ordinary updateProject (e.g. name/request) preserves acceptance
      const afterRename = await updateProject(p1.id, { name: "Money history v2" });
      assert.equal(afterRename?.keepOverLength, true, "subsequent updateProject preserves keepOverLength");
      assert.equal(afterRename?.brief?.keepOverLength, true, "subsequent updateProject preserves brief.keepOverLength");

      await deleteProject(p1.id);
      await deleteProject(p2.id);
    } finally {
      await pool.query("delete from app.projects where owner_id = $1", [ownerId]);
      await pool.end();
    }
  `;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  if (res.status !== 0 && /ECONNREFUSED/.test(res.stderr)) {
    t.skip("Local throwaway Postgres not running on 55432");
    return;
  }
  assert.equal(res.status, 0, `store round-trip failed:\n${res.stderr}\n${res.stdout}`);
});

async function startStoryboardFixtureServer() {
  const entrySource = `
    import React, { useCallback, useRef, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { scriptSeconds } from "@videosaas/contracts";
    import { ScriptCanvas } from "./components/script-canvas.tsx";
    import { optimisticUpdate } from "./lib/optimistic.ts";

    const INITIAL_BEATS = ${JSON.stringify(SEVEN_BEATS_40S)};
    const SAMPLE_SVG = ${JSON.stringify(SAMPLE_SVG)};

    const makeProject = (id, name, keepOverLength = false) => ({
      id,
      name,
      state: "Ready for review",
      createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
      ...(keepOverLength ? { keepOverLength: true } : {}),
      request: {
        prompt: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
        format: "landscape",
        style: "clean",
        theme: "neutral",
        template: "product-pulse",
        audio: { music: true, voiceover: true, voice: "Kore" }
      },
      brief: {
        scriptMode: "problem",
        text: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
        durationSeconds: 30,
        pace: "calm",
        aspect: "16:9",
        motionProfile: "smooth",
        captions: "key-phrases",
        audio: { mode: "both", voice: "Kore" },
        ...(keepOverLength ? { keepOverLength: true } : {}),
        scriptBeats: INITIAL_BEATS.map((b) => ({ ...b }))
      },
      screenshots: [],
      comments: []
    });

    function FixtureStudio() {
      const [view, setView] = useState("create");
      const [step, setStep] = useState(1); // 0=Brief, 1=Storyboard, 2=Animation, 3=Render
      const [projects, setProjects] = useState(() => [
        makeProject("316f1cbd-b5b9-49af-ae3b-2add10a18ed5", "how money evolves", false),
        makeProject("99999999-b5b9-49af-ae3b-2add10a18ed5", "second film project", false)
      ]);
      const [activeId, setActiveId] = useState("316f1cbd-b5b9-49af-ae3b-2add10a18ed5");
      const project = projects.find((p) => p.id === activeId) ?? null;
      const [briefByProject, setBriefByProject] = useState(() => ({
        "316f1cbd-b5b9-49af-ae3b-2add10a18ed5": { ...projects[0].brief },
        "99999999-b5b9-49af-ae3b-2add10a18ed5": { ...projects[1].brief }
      }));
      const brief = briefByProject[activeId];
      const [beatsByProject, setBeatsByProject] = useState(() => ({
        "316f1cbd-b5b9-49af-ae3b-2add10a18ed5": INITIAL_BEATS.map((b) => ({ ...b })),
        "99999999-b5b9-49af-ae3b-2add10a18ed5": INITIAL_BEATS.map((b) => ({ ...b }))
      }));
      const beats = beatsByProject[activeId];
      const [calls, setCalls] = useState({
        putProject: [],
        fit: 0,
        confirmVoice: 0,
        retryVoice: 0,
        render: 0,
        ask: []
      });

      const keepingOverLength = useRef(new Set());
      const acceptOverLength = useCallback(async () => {
        if (!project) return;
        const targetId = project.id;
        if (keepingOverLength.current.has(targetId)) return;
        keepingOverLength.current.add(targetId);
        const hadKeep = Boolean(project.keepOverLength || project.brief?.keepOverLength || brief.keepOverLength);

        const patchKeep = (nextKeep) => {
          setProjects((curr) =>
            curr.map((item) => {
              if (item.id !== targetId) return item;
              const nextBrief = item.brief
                ? (() => {
                    const { keepOverLength: _old, ...rest } = item.brief;
                    return nextKeep ? { ...rest, keepOverLength: true } : rest;
                  })()
                : item.brief;
              const { keepOverLength: _oldP, ...restP } = item;
              return {
                ...restP,
                ...(nextBrief ? { brief: nextBrief } : {}),
                ...(nextKeep ? { keepOverLength: true } : {})
              };
            })
          );
          setBriefByProject((curr) => {
            const targetBrief = curr[targetId];
            if (!targetBrief) return curr;
            const { keepOverLength: _old, ...rest } = targetBrief;
            return {
              ...curr,
              [targetId]: nextKeep ? { ...rest, keepOverLength: true } : rest
            };
          });
        };

        try {
          await optimisticUpdate({
            apply: () => patchKeep(true),
            persist: async () => {
              setCalls((c) => ({ ...c, putProject: [...c.putProject, { id: targetId, keepOverLength: true }] }));
              const res = await fetch("/v1/projects/" + targetId, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keepOverLength: true })
              });
              const payload = await res.json();
              if (!res.ok) throw new Error(payload?.error?.message ?? "Could not save the project.");
              return payload;
            },
            reconcile: (saved) => patchKeep(Boolean(saved.keepOverLength ?? saved.brief?.keepOverLength ?? true)),
            rollback: () => patchKeep(hadKeep)
          });
        } finally {
          keepingOverLength.current.delete(targetId);
        }
      }, [project, brief]);

      const fitScript = () => {
        setCalls((c) => ({ ...c, fit: c.fit + 1 }));
        setBriefByProject((curr) => ({
          ...curr,
          [activeId]: { ...curr[activeId], lockDuration: true }
        }));
      };

      const editBeat = (index, patch) => {
        setBeatsByProject((curr) => ({
          ...curr,
          [activeId]: curr[activeId].map((b, i) => (i === index ? { ...b, ...patch } : b))
        }));
      };

      // Simulate browser reload from server state
      const reloadFromServer = async (id = activeId) => {
        const res = await fetch("/v1/projects/" + id);
        const saved = await res.json();
        setProjects((curr) => curr.map((p) => (p.id === id ? saved : p)));
        setBriefByProject((curr) => ({
          ...curr,
          [id]: {
            ...saved.brief,
            ...(saved.keepOverLength ? { keepOverLength: true } : {})
          }
        }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      };

      window.__storyboardFixture = {
        getState: () => ({
          view,
          step,
          activeId,
          project,
          brief,
          beats,
          runs: scriptSeconds(beats, brief.pace),
          calls
        }),
        setStep: async (s) => {
          setStep(s);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        setView: async (v) => {
          setView(v);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        setActiveId: async (id) => {
          setActiveId(id);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        editBeat: async (index, patch) => {
          editBeat(index, patch);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        reloadFromServer
      };

      const isStoryboardView = view === "create" && step === 1;
      const frames = beats.map(() => ({ state: "ready", svg: SAMPLE_SVG }));
      const voice = {
        state: "ready",
        takes: beats.map((_, i) => "/mock-voice-" + (i + 1) + ".wav")
      };

      return (
        <main className={isStoryboardView ? "relay-shell relay-shell--storyboard" : "relay-shell"}>
          <div className="ambient ambient-blue" /><div className="ambient ambient-peach" />
          {view === "create" ? (
            <>
              <header className="creation-header">
                <div className="creation-project">
                  <button type="button" onClick={() => setView("projects")}>← Projects</button><i />
                  <strong>{project?.name ?? "Untitled video"}</strong>
                  <span>{project?.state ?? "Ready for review"}</span>
                </div>
                <ol className="flow-steps">
                  <li><button type="button" className={step === 0 ? "current" : "complete"} onClick={() => setStep(0)}><b>{step !== 0 ? "✓" : 1}</b>Brief</button><i /></li>
                  <li><button type="button" className={step === 1 ? "current" : "complete"} onClick={() => setStep(1)}><b>{step !== 1 ? "✓" : 2}</b>Storyboard</button><i /></li>
                  <li><button type="button" className={step === 2 ? "current" : "complete"} onClick={() => setStep(2)}><b>{step !== 2 ? "✓" : 3}</b>Animation</button><i /></li>
                  <li><button type="button" className={step === 3 ? "current" : "complete"} onClick={() => setStep(3)}><b>{step !== 3 ? "✓" : 4}</b>Render</button></li>
                </ol>
              </header>
              {step === 1 && (
                <ScriptCanvas
                  projectId={project?.id}
                  keepOverLength={Boolean(project?.keepOverLength || project?.brief?.keepOverLength || brief.keepOverLength)}
                  onKeepOverLength={acceptOverLength}
                  beats={beats}
                  open={null}
                  writing={null}
                  scoped={false}
                  versions={beats.map(() => null)}
                  onReimagine={() => {}}
                  onVersion={() => {}}
                  streaming={false}
                  startedAt={Date.now() - 12000}
                  flags={[]}
                  error={null}
                  voiced={true}
                  length={{
                    seconds: brief.durationSeconds,
                    pace: brief.pace,
                    locked: Boolean(brief.lockDuration),
                    keepOverLength: Boolean(project?.keepOverLength || project?.brief?.keepOverLength || brief.keepOverLength)
                  }}
                  onFit={fitScript}
                  onEdit={editBeat}
                  onAsk={(instruction, only) => setCalls((c) => ({ ...c, ask: [...c.ask, { instruction, only }] }))}
                  onCancel={() => {}}
                  frames={frames}
                  aspect={brief.aspect}
                  styleName="Rubber Hose"
                  onRedraw={() => {}}
                  voice={voice}
                  onConfirm={() => setCalls((c) => ({ ...c, confirmVoice: c.confirmVoice + 1 }))}
                  onRetryVoice={() => setCalls((c) => ({ ...c, retryVoice: c.retryVoice + 1 }))}
                  music={true}
                  onRender={() => setCalls((c) => ({ ...c, render: c.render + 1 }))}
                  rendering={false}
                  storyboard={{ state: "ready" }}
                  onContinue={() => {}}
                  continuing={false}
                />
              )}
              {step === 0 && (
                <div className="flow-page" style={{ minHeight: "1500px" }}>
                  <h1>Brief step</h1>
                </div>
              )}
              {step === 2 && (
                <div className="flow-page" style={{ minHeight: "1200px" }}>
                  <h1>Animation step</h1>
                </div>
              )}
              {step === 3 && (
                <div className="flow-page" style={{ minHeight: "1200px" }}>
                  <h1>Render step</h1>
                </div>
              )}
            </>
          ) : (
            <section className="page-container" style={{ minHeight: "1500px" }}>
              <h1>Projects</h1>
            </section>
          )}
        </main>
      );
    }

    createRoot(document.getElementById("root")).render(<FixtureStudio />);
  `;

  const bundled = await build({
    stdin: {
      contents: entrySource,
      resolveDir: FRONTEND_DIR,
      sourcefile: "storyboard-fixture-entry.tsx",
      loader: "tsx"
    },
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_API_URL": '""',
      "process.env": "{}"
    }
  });
  const bundleJs = bundled.outputFiles[0].text;

  // Simulated server database state for round-trip persistence verification
  const serverProjects = new Map([
    [
      "316f1cbd-b5b9-49af-ae3b-2add10a18ed5",
      {
        id: "316f1cbd-b5b9-49af-ae3b-2add10a18ed5",
        name: "how money evolves",
        state: "Ready for review",
        brief: {
          scriptMode: "problem",
          text: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
          durationSeconds: 30,
          pace: "calm",
          aspect: "16:9",
          motionProfile: "smooth",
          captions: "key-phrases",
          audio: { mode: "both", voice: "Kore" },
          scriptBeats: SEVEN_BEATS_40S
        }
      }
    ],
    [
      "99999999-b5b9-49af-ae3b-2add10a18ed5",
      {
        id: "99999999-b5b9-49af-ae3b-2add10a18ed5",
        name: "second film project",
        state: "Draft storyboard",
        brief: {
          scriptMode: "problem",
          text: "Second independent project with a long script.",
          durationSeconds: 30,
          pace: "calm",
          aspect: "16:9",
          motionProfile: "smooth",
          captions: "key-phrases",
          audio: { mode: "both", voice: "Kore" },
          scriptBeats: SEVEN_BEATS_40S
        }
      }
    ]
  ]);
  let failNextPut = false;
  let putDelayMs = 0;

  const srv = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundleJs);
      return;
    }
    if (url.pathname.startsWith("/v1/projects/")) {
      const id = url.pathname.slice("/v1/projects/".length);
      const current = serverProjects.get(id);
      if (!current) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Project not found." } }));
        return;
      }
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(current));
        return;
      }
      if (req.method === "PUT") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body || "{}");
        if (putDelayMs > 0) await new Promise((r) => setTimeout(r, putDelayMs));
        if (failNextPut) {
          failNextPut = false;
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Database temporarily unavailable. Please try again." } }));
          return;
        }
        if (parsed.keepOverLength !== undefined && typeof parsed.keepOverLength !== "boolean") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "The duration acceptance flag must be a boolean." } }));
          return;
        }
        const keepOverLength = typeof parsed.keepOverLength === "boolean" ? parsed.keepOverLength : current.keepOverLength;
        const updated = {
          ...current,
          ...(keepOverLength !== undefined ? { keepOverLength } : {}),
          brief: current.brief
            ? {
                ...current.brief,
                ...(keepOverLength ? { keepOverLength: true } : {})
              }
            : current.brief
        };
        serverProjects.set(id, updated);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(updated));
        return;
      }
    }
    if (url.pathname.startsWith("/mock-voice-")) {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(Buffer.alloc(44));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Storyboard Header & Duration Fixture</title>
  <style>${COMBINED_CSS}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/bundle.js"></script>
</body>
</html>`);
  });

  await new Promise((resolveListen) => srv.listen(0, "127.0.0.1", resolveListen));
  const address = srv.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    srv,
    baseUrl,
    serverProjects,
    setFailNextPut: (val) => {
      failNextPut = val;
    },
    setPutDelayMs: (ms) => {
      putDelayMs = ms;
    }
  };
}

async function measureStoryboardLayout(page, label) {
  return page.evaluate((lbl) => {
    const doc = document.scrollingElement || document.documentElement;
    const creationHeader = document.querySelector(".creation-header");
    const scHead = document.querySelector(".sc-head");
    const scScroll = document.querySelector(".sc-scroll");
    const scLength = document.querySelector(".sc-length");
    const firstBeat = document.querySelector(".sc-doc > li.sc-beat:first-child");
    const lastBeat = document.querySelector(".sc-doc > li.sc-beat:last-child");
    const scAsk = document.querySelector(".sc-ask");

    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        right: Math.round(r.right * 100) / 100,
        bottom: Math.round(r.bottom * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100
      };
    };

    const headControls = Array.from(scHead.querySelectorAll("button")).map((btn) => {
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        text: (btn.textContent || "").trim(),
        ...rect(btn),
        hitSelf: Boolean(hit && (btn === hit || btn.contains(hit) || hit.contains(btn)))
      };
    });

    const headStyle = window.getComputedStyle(scHead);

    return {
      label: lbl,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docScrollHeight: doc.scrollHeight,
      docClientHeight: doc.clientHeight,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      creationHeaderRect: rect(creationHeader),
      scHeadRect: rect(scHead),
      scHeadBg: headStyle.backgroundColor,
      scHeadZIndex: Number(headStyle.zIndex) || 0,
      scScrollRect: rect(scScroll),
      scScrollTop: scScroll.scrollTop,
      scScrollHeight: scScroll.scrollHeight,
      scScrollClientHeight: scScroll.clientHeight,
      scLengthRect: rect(scLength),
      firstBeatRect: rect(firstBeat),
      lastBeatRect: rect(lastBeat),
      scAskRect: rect(scAsk),
      headControls
    };
  }, label);
}

test("Storyboard compact persistent header and durable per-project duration acceptance across viewports", async () => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const { srv, baseUrl, serverProjects, setFailNextPut, setPutDelayMs } = await startStoryboardFixtureServer();
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1135, height: 775 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 1. Verify initial state at 1135x775 (dark theme): compact header + unanswered 40s notice visible
    const initial = await measureStoryboardLayout(page, "1135x775-initial");
    assert.equal(initial.docScrollHeight, initial.docClientHeight, "1135x775: document scroll locked to viewport on Storyboard");
    assert.ok(initial.docScrollWidth <= initial.docClientWidth, "1135x775: no horizontal overflow");
    assert.ok(initial.scHeadRect.height <= 56, `1135x775: .sc-head is compact (height=${initial.scHeadRect.height}px <= 56px)`);
    assert.ok(initial.scHeadZIndex >= 10, "1135x775: .sc-head has elevated z-index");
    assert.notEqual(initial.scHeadBg, "rgba(0, 0, 0, 0)", "1135x775: .sc-head has opaque theme background");
    assert.ok(initial.scLengthRect !== null, "1135x775: unanswered over-length notice is initially shown");
    assert.ok(
      initial.firstBeatRect.y >= initial.scHeadRect.bottom,
      "1135x775: first beat sits below .sc-head and is not covered by it"
    );
    assert.equal(initial.headControls.length, 2, "1135x775: Rebuild voiceover/music and Create animation buttons present");
    for (const ctrl of initial.headControls) {
      assert.ok(ctrl.hitSelf, `1135x775: header button "${ctrl.text}" is clickable before scroll`);
    }

    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-1135x775-dark-before-keep.png") });

    // 2. Test failed persistence recovery: click Keep 40s when server fails -> rolls back and shows error
    setFailNextPut(true);
    await page.locator(".sc-length button", { hasText: "Keep 40s" }).click();
    const errorAlert = page.locator(".sc-length-error[role='alert']");
    await errorAlert.waitFor({ state: "visible" });
    const errorText = await errorAlert.textContent();
    assert.match(errorText ?? "", /Database temporarily unavailable/, "failed persistence shows visible alert and rolls back dismissal");
    assert.equal(
      serverProjects.get("316f1cbd-b5b9-49af-ae3b-2add10a18ed5")?.keepOverLength,
      undefined,
      "server project remains unaccepted after failed save"
    );

    // 3. Click Keep 40s with working persistence (and in-flight delay to verify duplicate-click & concurrent-edit safety)
    setPutDelayMs(80);
    const keepBtn = page.locator(".sc-length button", { hasText: "Keep 40s" });
    await keepBtn.click();
    // Notice hides optimistically right away
    await page.locator(".sc-length").waitFor({ state: "detached" });
    // Edit beat 0 while the PUT save is still in flight; the server response must NOT discard this newer edit
    await page.evaluate(() =>
      window.__storyboardFixture.editBeat(0, {
        line: "Long before coins or cards existed, you had to trade whatever you carried in your hands for whatever your neighbor happened to have, hoping they wanted a cow."
      })
    );
    await new Promise((r) => setTimeout(r, 120));
    setPutDelayMs(0);

    const afterKeepState = await page.evaluate(() => window.__storyboardFixture.getState());
    assert.equal(afterKeepState.calls.putProject.length, 2, "exactly 1 failed PUT + 1 succeeded PUT sent (no duplicate submissions)");
    assert.equal(afterKeepState.project.keepOverLength, true, "project.keepOverLength is true after Keep 40s");
    assert.equal(afterKeepState.brief.keepOverLength, true, "brief.keepOverLength is true after Keep 40s");
    assert.equal(afterKeepState.calls.fit, 0, "Keep 40s did not call fitScript");
    assert.equal(afterKeepState.calls.render, 0, "Keep 40s did not trigger render");
    assert.equal(afterKeepState.brief.durationSeconds, 30, "brief.durationSeconds remains 30");
    assert.match(afterKeepState.beats[0].line, /hoping they wanted a cow/, "concurrent beat edit preserved after PUT resolves");
    assert.ok(afterKeepState.runs > 40, `edited script estimate increased to ${afterKeepState.runs}s`);
    assert.equal(await page.locator(".sc-length").count(), 0, "changed duration estimate after edit does not re-prompt");
    assert.equal(
      serverProjects.get("316f1cbd-b5b9-49af-ae3b-2add10a18ed5")?.keepOverLength,
      true,
      "server persisted keepOverLength: true for project 316f1cbd"
    );

    // 5. Scroll long script to bottom at 1135x775 -> verify header stays visible at identical rect and controls work
    await page.evaluate(() => {
      const scScroll = document.querySelector(".sc-scroll");
      scScroll.scrollTop = scScroll.scrollHeight;
    });
    const scrolled1135 = await measureStoryboardLayout(page, "1135x775-scrolled-bottom");
    assert.ok(scrolled1135.scScrollTop > 200, `1135x775: .sc-scroll scrolled down (scrollTop=${scrolled1135.scScrollTop})`);
    assert.deepEqual(
      scrolled1135.scHeadRect,
      initial.scHeadRect,
      "1135x775: .sc-head rectangle is identical before and after scrolling long script"
    );
    assert.deepEqual(
      scrolled1135.creationHeaderRect,
      initial.creationHeaderRect,
      "1135x775: .creation-header rectangle remains stationary while script scrolls"
    );
    assert.ok(
      scrolled1135.lastBeatRect.bottom <= scrolled1135.scAskRect.y + 4,
      `1135x775: last beat (${scrolled1135.lastBeatRect.bottom}) is above prompt composer (${scrolled1135.scAskRect.y}) at bottom scroll`
    );
    assert.ok(
      scrolled1135.scAskRect.bottom <= scrolled1135.innerHeight,
      "1135x775: prompt composer is fully visible inside viewport"
    );
    for (const ctrl of scrolled1135.headControls) {
      assert.ok(ctrl.hitSelf, `1135x775: header button "${ctrl.text}" remains clickable while scrolled to bottom`);
    }

    // Click header action while scrolled to bottom to verify it remains interactive
    await page.locator(".sc-head .sc-actions button", { hasText: "Rebuild voiceover and music" }).click();
    const afterRebuildClick = await page.evaluate(() => window.__storyboardFixture.getState().calls.retryVoice);
    assert.equal(afterRebuildClick, 1, "Rebuild voiceover and music action works while scrolled");

    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-1135x775-dark-scrolled-kept.png") });

    // 6. Navigate to Brief, Animation, Render, and back to Storyboard -> verify scroll lock restores on other steps and Keep remains dismissed
    await page.locator(".flow-steps button", { hasText: "Brief" }).click();
    const briefScroll = await page.evaluate(() => {
      const main = document.querySelector("main.relay-shell");
      const doc = document.scrollingElement || document.documentElement;
      return {
        hasStoryboardClass: main.classList.contains("relay-shell--storyboard"),
        docScrollHeight: doc.scrollHeight,
        docClientHeight: doc.clientHeight
      };
    });
    assert.equal(briefScroll.hasStoryboardClass, false, "leaving Storyboard removes relay-shell--storyboard");
    assert.ok(briefScroll.docScrollHeight > briefScroll.docClientHeight, "Brief step restores normal document scrolling");

    await page.locator(".flow-steps button", { hasText: "Render" }).click();
    await page.locator(".flow-steps button", { hasText: "Storyboard" }).click();
    assert.equal(await page.locator(".sc-length").count(), 0, "returning after Render step keeps duration notice dismissed");

    // 7. Simulate reload from server -> remains dismissed with no flash
    await page.evaluate(() => window.__storyboardFixture.reloadFromServer("316f1cbd-b5b9-49af-ae3b-2add10a18ed5"));
    assert.equal(await page.locator(".sc-length").count(), 0, "reloading project from server keeps duration notice dismissed");

    // 8. Switch to a different project -> independent choice still prompts, and Fit to 30s still works
    await page.evaluate(() => window.__storyboardFixture.setActiveId("99999999-b5b9-49af-ae3b-2add10a18ed5"));
    await page.locator(".sc-length").waitFor({ state: "visible" });
    assert.equal(await page.locator(".sc-length").count(), 1, "second project independently shows the over-length notice");
    await page.locator(".sc-length button", { hasText: "Fit to 30s" }).click();
    const project2State = await page.evaluate(() => window.__storyboardFixture.getState());
    assert.equal(project2State.calls.fit, 1, "Fit to 30s triggers onFit on unaccepted project");
    assert.equal(project2State.brief.lockDuration, true, "Fit to 30s sets lockDuration: true on project 2");

    // Switch back to project 1 -> still dismissed
    await page.evaluate(() => window.__storyboardFixture.setActiveId("316f1cbd-b5b9-49af-ae3b-2add10a18ed5"));
    await page.locator(".sc-length").waitFor({ state: "detached" });
    assert.equal(await page.locator(".sc-length").count(), 0, "switching back to project 1 preserves accepted state");

    // 9. Verify light theme at 1135x775 while scrolled
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
      const scScroll = document.querySelector(".sc-scroll");
      scScroll.scrollTop = 260;
    });
    const light1135 = await measureStoryboardLayout(page, "1135x775-light-scrolled");
    assert.notEqual(light1135.scHeadBg, "rgba(0, 0, 0, 0)", "light theme .sc-head has opaque background");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-1135x775-light-scrolled.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

    // 10. Larger desktop viewport (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      document.querySelector(".sc-scroll").scrollTop = 0;
    });
    const desktop1440Before = await measureStoryboardLayout(page, "1440x900-before");
    await page.evaluate(() => {
      const scScroll = document.querySelector(".sc-scroll");
      scScroll.scrollTop = scScroll.scrollHeight;
    });
    const desktop1440After = await measureStoryboardLayout(page, "1440x900-after");
    assert.ok(desktop1440Before.scHeadRect.height <= 56, `1440x900: compact header (${desktop1440Before.scHeadRect.height}px)`);
    assert.deepEqual(desktop1440After.scHeadRect, desktop1440Before.scHeadRect, "1440x900: header rect stationary on scroll");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-1440x900-dark.png") });

    // 11. Mobile viewport (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.querySelector(".sc-scroll").scrollTop = 0;
    });
    const mobileBefore = await measureStoryboardLayout(page, "390x844-before");
    assert.ok(
      mobileBefore.docScrollWidth <= mobileBefore.docClientWidth,
      `390x844: no horizontal overflow (${mobileBefore.docScrollWidth} <= ${mobileBefore.docClientWidth})`
    );
    assert.ok(
      mobileBefore.scHeadRect.height <= 96,
      `390x844: compact wrapped mobile header (${mobileBefore.scHeadRect.height}px <= 96px)`
    );
    assert.ok(
      mobileBefore.firstBeatRect.y >= mobileBefore.scHeadRect.bottom - 1,
      "390x844: wrapped mobile header does not overlap first beat"
    );
    for (const ctrl of mobileBefore.headControls) {
      assert.ok(
        ctrl.x >= 0 && ctrl.right <= mobileBefore.innerWidth,
        `390x844: mobile button "${ctrl.text}" fits horizontally (${ctrl.x}..${ctrl.right})`
      );
      assert.ok(ctrl.hitSelf, `390x844: mobile button "${ctrl.text}" is clickable`);
    }

    await page.evaluate(() => {
      const scScroll = document.querySelector(".sc-scroll");
      scScroll.scrollTop = 450;
    });
    const mobileAfter = await measureStoryboardLayout(page, "390x844-after");
    assert.deepEqual(mobileAfter.scHeadRect, mobileBefore.scHeadRect, "390x844: mobile header rect stays stationary during scroll");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "storyboard-390x844-mobile-dark.png") });
  } finally {
    await browser.close();
    srv.close();
  }
});
