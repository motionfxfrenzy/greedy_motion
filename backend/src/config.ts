import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendSourceDir = dirname(fileURLToPath(import.meta.url));
const repositoryDir = resolve(backendSourceDir, "../..");
const storagePath = (value: string | undefined, name: string) => resolve(value ?? resolve(repositoryDir, "var", name));
// Preview pages use the same checked-in HyperFrames templates and local fonts
// as the worker. Docker copies this small source-only subset alongside backend.
const workerAssetsDir = resolve(process.env.WORKER_ASSETS_DIR ?? resolve(repositoryDir, "worker"));

const appEnvs = ["local", "staging", "production"] as const;
type AppEnv = (typeof appEnvs)[number];

function appEnv(): AppEnv {
  const value = process.env.APP_ENV ?? "local";
  if (!appEnvs.includes(value as AppEnv)) throw new Error(`APP_ENV must be one of ${appEnvs.join(", ")}; got "${value}".`);
  return value as AppEnv;
}

const env = appEnv();
const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
if (env === "production" && corsOrigins.some((origin) => !origin.startsWith("https://") || origin.includes("vercel.app"))) {
  throw new Error("In production, CORS_ORIGINS must list only HTTPS production origins.");
}

// Claude is the planner. The deterministic planner runs only when explicitly requested (PLANNER=deterministic),
// so a missing key fails loudly at startup instead of silently producing non-AI plans.
const planner = process.env.PLANNER ?? "anthropic";
if (planner !== "anthropic" && planner !== "deterministic") throw new Error(`PLANNER must be "anthropic" or "deterministic"; got "${planner}".`);
if (planner === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set in backend/.env. Add the key, or set PLANNER=deterministic to run without Claude.");
}

// Render jobs and the render queue (pg-boss) live in Postgres; the backend cannot run without it.
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl) throw new Error("DATABASE_URL is not set. Start Postgres with `docker compose up -d postgres` and copy DATABASE_URL from backend/.env.example.");

const positiveInt = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer; got "${process.env[name]}".`);
  return value;
};

const nonNegativeInt = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be zero or a positive integer; got "${process.env[name]}".`);
  return value;
};

// Object storage. "filesystem" keeps everything on local disk shared with the worker (local dev). "r2" puts
// the worker's inputs and outputs in Cloudflare R2 (S3 API) so backend and worker share no volume, and
// makes R2 the durable home of user media; the local media directories are then only a cache (media.ts).
const storageDriver = process.env.STORAGE_DRIVER ?? "filesystem";
if (storageDriver !== "filesystem" && storageDriver !== "r2") throw new Error(`STORAGE_DRIVER must be "filesystem" or "r2"; got "${storageDriver}".`);
const r2 = storageDriver === "r2"
  ? (() => {
      const need = (name: string) => process.env[name] || (() => { throw new Error(`${name} is required when STORAGE_DRIVER=r2.`); })();
      return {
        endpoint: need("R2_ENDPOINT"),
        accessKeyId: need("R2_ACCESS_KEY_ID"),
        secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
        uploadsBucket: need("R2_UPLOADS_BUCKET"),
        outputsBucket: need("R2_OUTPUTS_BUCKET"),
        // Durable user media (screenshots, brand files, generated audio, site snapshots) under media/.
        // Defaults to the uploads bucket, whose key is already scoped to this environment.
        mediaBucket: process.env.R2_MEDIA_BUCKET || need("R2_UPLOADS_BUCKET")
      };
    })()
  : null;

// How render workers come to exist. "external" (default): something else keeps them running (local Docker,
// a Railway service). "ecs": the backend starts Fargate tasks on demand (jobs/worker-launcher.ts) and each
// worker exits when idle, so nothing runs on AWS while nobody is rendering. Watching a finished video never
// needs a worker: it streams from R2 through a signed URL.
const workerLaunchMode = process.env.WORKER_LAUNCH ?? "external";
if (workerLaunchMode !== "external" && workerLaunchMode !== "ecs") throw new Error(`WORKER_LAUNCH must be "external" or "ecs"; got "${workerLaunchMode}".`);
const workerLaunch = workerLaunchMode === "ecs"
  ? (() => {
      const need = (name: string) => process.env[name] || (() => { throw new Error(`${name} is required when WORKER_LAUNCH=ecs.`); })();
      const list = (name: string) => need(name).split(",").map((item) => item.trim()).filter(Boolean);
      return {
        mode: "ecs" as const,
        region: need("ECS_REGION"),
        cluster: need("ECS_CLUSTER"),
        // A family name ("greedymotion-staging-worker") runs its latest ACTIVE revision, so a deploy needs no backend change.
        taskDefinition: need("ECS_WORKER_TASK_DEFINITION"),
        subnets: list("ECS_SUBNETS"),
        securityGroups: list("ECS_SECURITY_GROUPS"),
        // Must match the worker's RENDER_CONCURRENCY: renders one task takes at once.
        perTask: positiveInt("ECS_WORKER_CONCURRENCY", 2),
        maxTasks: positiveInt("ECS_WORKER_MAX_TASKS", 3),
        // Spot is ~70% cheaper; an interrupted render is retried by the queue. "0" uses on-demand only.
        spot: process.env.ECS_USE_SPOT !== "0"
      };
    })()
  : { mode: "external" as const };

// The single user when AUTH_MODE=none (local development). A uuid so it fits the owner_id columns.
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000000";

// Authentication. "supabase" verifies Supabase access tokens on every /v1 call; "none" is local development only.
const authMode = process.env.AUTH_MODE ?? "none";
if (authMode !== "none" && authMode !== "supabase") throw new Error(`AUTH_MODE must be "none" or "supabase"; got "${authMode}".`);
if (env !== "local" && authMode !== "supabase") throw new Error(`AUTH_MODE=supabase is required when APP_ENV=${env}.`);
const auth = authMode === "supabase"
  ? (() => {
      const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
      if (!supabaseUrl) throw new Error("SUPABASE_URL is required when AUTH_MODE=supabase.");
      const ref = process.env.EXPECTED_SUPABASE_PROJECT_REF;
      // Guards against staging pointing at the production project (or the reverse).
      if (ref && new URL(supabaseUrl).hostname !== `${ref}.supabase.co`) throw new Error(`SUPABASE_URL does not match EXPECTED_SUPABASE_PROJECT_REF (${ref}).`);
      return { mode: "supabase" as const, supabaseUrl, jwksUrl: process.env.SUPABASE_JWKS_URL || `${supabaseUrl}/auth/v1/.well-known/jwks.json` };
    })()
  : { mode: "none" as const };

// Projects and brand kits saved before ownership existed have no owner. In local development (no auth) they
// stay visible to the local user; with auth on they are hidden from everyone unless LEGACY_OWNER_ID names the
// Supabase user id that should adopt them.
const legacyOwnerId = auth.mode === "none" ? LOCAL_USER_ID : (process.env.LEGACY_OWNER_ID ?? "");

// Signs the short-lived media tokens in media links (media-links.ts). Every replica must share it.
const mediaUrlSecret = process.env.MEDIA_URL_SECRET ?? (auth.mode === "none" ? "local-development-media-url-secret" : "");
if (mediaUrlSecret.length < 32) throw new Error("MEDIA_URL_SECRET (32+ random characters) is required when AUTH_MODE=supabase.");

export const config = {
  auth,
  mediaUrlSecret,
  legacyOwnerId,
  storageDriver: storageDriver as "filesystem" | "r2",
  r2,
  workerLaunch,
  planner: planner as "anthropic" | "deterministic",
  appEnv: env,
  // Railway injects PORT; locally the backend defaults to 4000.
  port: Number.parseInt(process.env.PORT ?? "4000", 10),
  host: process.env.HOST ?? (env === "local" ? "127.0.0.1" : "0.0.0.0"),
  corsOrigins,
  databaseUrl,
  databasePoolSize: positiveInt("DATABASE_POOL_SIZE", 10),
  // How long one replica remembers a user's entitlement rows (0 turns the cache off). A grant or revoke made on another
  // replica or by a script is seen within this long; GET /v1/me/entitlements always reads the database.
  entitlementCacheSeconds: nonNegativeInt("ENTITLEMENT_CACHE_SECONDS", 30),
  // Planning jobs (Claude + audio) this backend replica runs at once.
  planConcurrency: positiveInt("PLAN_CONCURRENCY", 4),
  // A render attempt that runs longer than this is abandoned and retried (pg-boss expireInSeconds).
  renderTimeoutSeconds: positiveInt("RENDER_TIMEOUT_SECONDS", 900),
  // Automatic retries after a failed render attempt (crash, timeout, transient renderer error).
  renderRetries: positiveInt("RENDER_RETRIES", 2),
  // Directory shared with the worker locally (mounted at /renders in the worker container).
  renderOutputDir: storagePath(process.env.RENDER_OUTPUT_DIR, "renders"),
  // Brand kits; shared read-only with the worker at /brands locally.
  brandsDir: storagePath(process.env.BRANDS_DIR, "brands"),
  // Persisted creation briefs and uploaded screenshots. This local adapter can later be
  // replaced by Postgres/object storage without changing the HTTP API.
  projectsDir: storagePath(process.env.PROJECTS_DIR, "projects"),
  // Source assets used by the personalized, browser-side HyperFrames preview.
  templatesDir: resolve(process.env.TEMPLATES_DIR ?? resolve(workerAssetsDir, "templates")),
  themesDir: resolve(process.env.THEMES_DIR ?? resolve(workerAssetsDir, "themes")),
  fontsDir: resolve(process.env.FONTS_DIR ?? resolve(workerAssetsDir, "fonts")),
  // The gm-* skills shipped with this release (scripts/build-skill-bundle.mjs): templates, slot schemas, fill guidance.
  skillsBundleDir: resolve(process.env.SKILLS_BUNDLE_DIR ?? resolve(backendSourceDir, "../skills")),
  hyperframesRuntimePath: resolve(process.env.HYPERFRAMES_RUNTIME_PATH ?? resolve(repositoryDir, "node_modules", "hyperframes", "dist", "hyperframe-runtime.js")),
  gsapPath: resolve(process.env.GSAP_PATH ?? resolve(repositoryDir, "node_modules", "gsap", "dist", "gsap.min.js")),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  // Google Gemini API: Lyria background music and Gemini TTS voiceover. Optional; audio options need it.
  visualImageModel: process.env.VISUAL_IMAGE_MODEL || "gemini-3.1-flash-image",
  visualVideoModel: process.env.VISUAL_VIDEO_MODEL || "veo-3.1-fast-generate-preview",
  visualMaxBudgetUsd: positiveInt("VISUAL_MAX_BUDGET_USD", 50),
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  // Generated audio per job; shared read-only with the worker at /audio locally.
  audioDir: storagePath(process.env.AUDIO_DIR, "audio"),
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"
} as const;
