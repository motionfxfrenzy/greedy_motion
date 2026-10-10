import { frameShellHtml } from "@videosaas/contracts";

// The demo editor's preview frame (fixtures only, so it is trusted to share the app's origin). Real projects load the same
// shell from the backend, which is a different origin; see components/editor/ClipFrame.tsx.
export const dynamic = "force-static";

export function GET() {
  return new Response(frameShellHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}
