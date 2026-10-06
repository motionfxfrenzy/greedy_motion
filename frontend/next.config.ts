import type { NextConfig } from "next";

const backendOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Shared contracts are TypeScript source in the workspace, compiled by Next.
  transpilePackages: ["@videosaas/contracts"],
  // The HyperFrames player must be able to inspect our trusted preview iframe. Keeping this
  // proxy relative makes the preview same-origin with the Next application, without exposing
  // arbitrary preview URLs to the browser.
  async rewrites() {
    return [{ source: "/api/preview/:path*", destination: `${backendOrigin}/v1/preview/:path*` }];
  }
};

export default nextConfig;
