import type { NextConfig } from "next";

const backendOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

// One environment, one set of services: a staging or production build must call the hosted API, never localhost; a local run that
// calls a hosted API is flagged (ALLOW_CLOUD_IN_LOCAL=1 silences it). Backend counterpart: backend/src/config.ts.
const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? "local";
const apiIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(backendOrigin);
if (appEnv !== "local" && apiIsLocal) throw new Error(`NEXT_PUBLIC_APP_ENV=${appEnv} but NEXT_PUBLIC_API_URL is ${backendOrigin}: a ${appEnv} build must call the hosted API.`);
if (appEnv === "local" && !apiIsLocal && process.env.ALLOW_CLOUD_IN_LOCAL !== "1") console.warn(`[env] NEXT_PUBLIC_APP_ENV=local but the API is ${backendOrigin}. Local should use the local backend (http://localhost:4000); set ALLOW_CLOUD_IN_LOCAL=1 to silence this.`);

const nextConfig: NextConfig = {
  // Shared contracts are TypeScript source in the workspace, compiled by Next.
  transpilePackages: ["@videosaas/contracts"],
  // Reading a product website can take up to ~50 s; the dev proxy's default 30 s cut it off with an empty error.
  experimental: { proxyTimeout: 120_000 },
  // The HyperFrames player must be able to inspect our trusted preview iframe. Keeping this
  // proxy relative makes the preview same-origin with the Next application, without exposing
  // arbitrary preview URLs to the browser.
  async rewrites() {
    return [
      { source: "/api/preview/:path*", destination: `${backendOrigin}/v1/preview/:path*` },
      { source: "/api/backend/:path*", destination: `${backendOrigin}/v1/:path*` }
    ];
  }
};

export default nextConfig;
