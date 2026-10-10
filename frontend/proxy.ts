import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, signedIn } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // /editor/<project id> needs a session. The demo (fixtures, no backend) and the editor's own files (frame.html, gsap.min.js) are public.
  const guarded = pathname === "/studio" || pathname.startsWith("/studio/") || pathname === "/app" || pathname.startsWith("/app/") || ["/templates", "/brand-kits", "/library"].includes(pathname) || /^\/editor\/(?!demo$)[^/.]+$/.test(pathname);
  if (guarded && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  if (pathname === "/auth" && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/studio";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  return response;
}

export const config = {
  // Only guarded pages need session validation. API requests are authenticated by the backend;
  // public pages and assets should never wait for an auth round trip.
  matcher: ["/studio/:path*", "/app/:path*", "/templates", "/brand-kits", "/library", "/editor/:path*", "/auth"],
};
