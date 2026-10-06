// Railway Infrastructure as Code for project "videosaas" (environments: staging, production).
// Not applied yet: requires `npm install -D railway`, a GitHub repo, and `railway link` (INFRA-01).
// Preview with `railway config plan`; apply with `railway config apply`. See docs/DEPLOYMENT.md.
//
// Both services build from the repository root so shared packages are in the Docker context;
// RAILWAY_DOCKERFILE_PATH selects each service's Dockerfile. Set watch paths in each service's
// settings (backend: /backend/**, /packages/**; worker: /worker/**) so unrelated changes do not redeploy.
// Secret values stay in Railway (preserve()); names are listed in backend/.env.<env>.example and worker/.env.<env>.example.
import { defineRailway, preserve, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  const env = ctx.environment === "production" ? "production" : "staging";
  // Each environment deploys its own Git branch: staging ← `staging`, production ← `production`.
  // Once the repo exists: source: github("<owner>/videosaas", { branch: env }),

  // Render capacity = replicas × RENDER_CONCURRENCY. Workers pull from the pg-boss queue in Postgres.
  // Keep 1 replica until MEDIA-02 and BRAND-02 move outputs, brand kits, and audio to R2: replicas on
  // separate machines cannot share var/renders, var/brands, or var/audio. Each render needs ~1 GB RAM.
  const worker = service("worker", {
    healthcheck: "/healthz",
    replicas: 1,
    env: {
      APP_ENV: env,
      RAILWAY_DOCKERFILE_PATH: "worker/Dockerfile",
      HOST: "::",
      PORT: "8080",
      RENDER_CONCURRENCY: "1",
      DRAIN_SECONDS: "25",
      DATABASE_URL: preserve(),
      RENDER_MAX_SECONDS: "300",
      RENDER_MAX_DISK_MB: "2048",
      HYPERFRAMES_NO_TELEMETRY: "1",
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: preserve()
    }
  });

  const backend = service("backend", {
    healthcheck: "/healthz",
    replicas: 1,
    domains: [env === "production" ? "api.<domain>" : "api.staging.<domain>"],
    env: {
      APP_ENV: env,
      RAILWAY_DOCKERFILE_PATH: "backend/Dockerfile",
      HOST: "::",
      PLAN_CONCURRENCY: "4",
      RENDER_TIMEOUT_SECONDS: "900",
      RENDER_RETRIES: "2",
      DATABASE_URL: preserve(),
      CORS_ORIGINS: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      ANTHROPIC_MODEL: preserve(),
      // Lyria music and Gemini TTS voiceover (planning stage); the worker never receives it.
      GEMINI_API_KEY: preserve()
    }
  });

  return project("videosaas", { resources: [backend, worker] });
});
