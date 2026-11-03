// Offline stand-in for the model API in the plate acceptance stack: answers scene-authoring requests with the fixed fixture
// modules from packages/plate-engine/test/fixtures (so old-vs-new rendering is compared without model variation), counts the
// calls, and can inject failures:
//   POST /control { "mode": "ok" | "nondeterministic" | "bad-import" | "http500" | "slow", "times": N, "delayMs": M }
//   GET  /stats   -> { calls, byScene: { "<scene>:<aspect>": n }, mode }
// Not shipped: it exists only in compose.yaml's `plates-e2e` profile.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.FIXTURE_DIR ?? "/fixtures";
const fixtures = { fox: "fox-0.ts", blueprint: "blueprint-0.ts", balloon: "balloon-0.ts" };
const fixtureFrames = { fox: 90, blueprint: 90, balloon: 105 };
const state = { calls: 0, byScene: {}, mode: "ok", times: 0, delayMs: 0, log: [] };

const sceneOf = (text) => {
  const plate = /<plate name="([A-Za-z0-9]+)"/.exec(text)?.[1] ?? "balloon";
  const scene = /WRITE SCENE (\d+) OF/.exec(text)?.[1] ?? "?";
  const size = /FRAME SIZE: W=(\d+), H=(\d+)/.exec(text);
  const aspect = size ? (size[1] === "1080" && size[2] === "1920" ? "9:16" : size[1] === "1080" ? "1:1" : "16:9") : "16:9";
  return { plate, scene, aspect, repair: /YOUR PREVIOUS MODULE FAILED/.test(text) };
};

createServer(async (req, res) => {
  const body = await new Promise((resolve) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => resolve(b)); });
  if (req.url === "/stats") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ calls: state.calls, byScene: state.byScene, mode: state.mode, log: state.log.slice(-40) })); }
  if (req.url === "/control") { Object.assign(state, { mode: "ok", times: 0, delayMs: 0 }, JSON.parse(body || "{}")); if (JSON.parse(body || "{}").reset) { state.calls = 0; state.byScene = {}; state.log = []; } res.writeHead(200); return res.end("{}"); }
  if (req.url?.startsWith("/v1/messages")) {
    const request = JSON.parse(body);
    const text = JSON.stringify(request.messages);
    const { plate, scene, aspect, repair } = sceneOf(request.messages.flatMap((m) => m.content).map((c) => c.text ?? "").join("\n"));
    state.calls += 1;
    const key = `${scene}:${aspect}`;
    state.byScene[key] = (state.byScene[key] ?? 0) + 1;
    state.log.push({ plate, scene, aspect, repair, revise: /THIS SCENE WAS ALREADY DRAWN/.test(text), notes: /bigger lantern|wider sky/.exec(text)?.[0] ?? null, reference: /ALREADY BEEN AUTHORED|ALREADY AUTHORED FOR ANOTHER/.test(text), mode: state.mode, n: state.calls });
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    let mode = state.mode;
    if (state.times > 0) state.times -= 1; else if (mode !== "ok") { mode = "ok"; state.mode = "ok"; }
    if (mode === "http500") { res.writeHead(500, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "stub failure" } })); }
    let code = readFileSync(join(dir, fixtures[plate] ?? fixtures.balloon), "utf8");
    // The fixture's length follows the request, as the contract tells a real answer to do ("durationFrames is given in the request").
    const wanted = /Length: (\d+) frames/.exec(text)?.[1], own = fixtureFrames[plate] ?? 105;
    if (wanted) code = code.replace(new RegExp(`(FRAMES\\s*=\\s*|durationFrames:\\s*|end:\\s*)${own}\\b`, "g"), `$1${wanted}`);
    if (mode === "bad-import") code = code.replace('from "./core"', 'from "node:fs"');
    // module-scope state mutated on every draw (blueprint fixture): the same frame drawn twice differs
    if (mode === "nondeterministic" && !repair) code = code.replace("export const film", "let __n = 0;\nexport const film").replace("  tooth(g);\n};", "  __n++; ctx.fillStyle = `rgba(255,0,0,${(__n % 9) / 20})`; ctx.fillRect(10, 10, 200, 200);\n  tooth(g);\n};");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ content: [{ type: "text", text: "```ts\n" + code + "\n```" }], stop_reason: "end_turn", usage: { input_tokens: text.length >> 2, output_tokens: code.length >> 2 } }));
  }
  res.writeHead(404); res.end();
}).listen(Number(process.env.PORT ?? 8787), "0.0.0.0", () => console.log("llm-stub listening"));
