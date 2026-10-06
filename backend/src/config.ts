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

export const config = {
  planner: planner as "anthropic" | "deterministic",
  appEnv: env,
  // Railway injects PORT; locally the backend defaults to 4000.
  port: Number.parseInt(process.env.PORT ?? "4000", 10),
  host: process.env.HOST ?? (env === "local" ? "127.0.0.1" : "0.0.0.0"),
  corsOrigins,
  databaseUrl,
  databasePoolSize: positiveInt("DATABASE_POOL_SIZE", 10),
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
  hyperframesRuntimePath: resolve(process.env.HYPERFRAMES_RUNTIME_PATH ?? resolve(repositoryDir, "node_modules", "hyperframes", "dist", "hyperframe-runtime.js")),
  gsapPath: resolve(process.env.GSAP_PATH ?? resolve(repositoryDir, "node_modules", "gsap", "dist", "gsap.min.js")),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  // Google Gemini API: Lyria background music and Gemini TTS voiceover. Optional; audio options need it.
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  // Generated audio per job; shared read-only with the worker at /audio locally.
  audioDir: storagePath(process.env.AUDIO_DIR, "audio"),
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"
} as const;
