import type { NextConfig } from "next";

const backendOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

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
