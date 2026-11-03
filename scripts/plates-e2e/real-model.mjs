// One real-model run through the acceptance stack (costs a few model calls): authoring timings and a look at real output.
//   E2E_ANTHROPIC_KEY=... E2E_ANTHROPIC_URL=https://api.anthropic.com docker compose --profile plates-e2e up -d plate-api
//   node scripts/plates-e2e/real-model.mjs
import { allDrawn, api, log, seedProject, variants, waitFor } from "./lib.mjs";
const { id } = await seedProject({ look: process.env.LOOK ?? "illus-balloon", aspect: "16:9", aspects: ["16:9", "9:16"], beats: Number(process.env.BEATS ?? 1), audio: false });
const t0 = Date.now();
await api(`/v1/projects/${id}/plates/draw`, { method: "POST" });
await waitFor("all drawn", () => allDrawn()(id), { timeout: 900_000, every: 3000 });
for (const v of await variants(id)) log(v.aspect, "scene", v.scene_index, "state", v.state, "model calls", v.authored, "repairs", v.repairs, JSON.stringify(v.timings), v.state === "failed" ? v.error?.detail : "");
log("project", id, "total", Math.round((Date.now() - t0) / 100) / 10, "s");
