import { NextResponse, type NextRequest } from "next/server";
import { APP_ORIGIN, APP_PATH, SITE_ORIGIN, hostsSplit } from "./lib/hosts";
import { updateSession } from "./utils/supabase/middleware";

const MARKETING_PATH = /^\/(about|contact|pricing|privacy|terms|refunds|coming-soon)(\/|$)/;
const SITE_ONLY_PATH = /^\/(about|contact|privacy|terms|refunds|coming-soon)(\/|$)/;

// Landing and app are one deployment on two hosts: product paths on the landing host go to the app host, and the landing
// page and policies on the app host go to the landing host. `/pricing` is served on both hosts so signed-in users on the
// app host can open it without a cross-origin redirect. The app host's own front door is the Studio.
function splitHosts(request: NextRequest) {
  if (!hostsSplit) return null;
  const { pathname, search } = request.nextUrl;
  // The Host header, not nextUrl.host: behind the dev server and some proxies nextUrl reports the server's own address.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const onApp = host === new URL(APP_ORIGIN).host;
  const onSite = host === new URL(SITE_ORIGIN).host || host === new URL(SITE_ORIGIN).host.replace(/^www\./, "");
  if (onApp && pathname === "/") return NextResponse.redirect(`${APP_ORIGIN}/studio`);
  if (onApp && SITE_ONLY_PATH.test(pathname)) return NextResponse.redirect(`${SITE_ORIGIN}${pathname}${search}`);
  if (onSite && APP_PATH.test(pathname)) return NextResponse.redirect(`${APP_ORIGIN}${pathname}${search}`);
  return null;
}

export async function proxy(request: NextRequest) {
  const moved = splitHosts(request);
  if (moved) return moved;
  const { pathname } = request.nextUrl;
  // Landing and policy pages are in the matcher only so the host split can see them; they never wait for an auth round trip.
  if (MARKETING_PATH.test(pathname) || pathname === "/") return NextResponse.next();
  const { response, signedIn } = await updateSession(request);

  // /editor/<project id> needs a session. The demo (fixtures, no backend) and the editor's own files (frame.html, gsap.min.js) are public.
  const guarded = pathname === "/studio" || pathname.startsWith("/studio/") || pathname === "/app" || pathname.startsWith("/app/") || ["/templates", "/brand-kits", "/library", "/profile"].includes(pathname) || /^\/editor\/(?!demo$)[^/.]+$/.test(pathname);
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
  matcher: ["/", "/about", "/contact", "/pricing", "/privacy", "/terms", "/refunds", "/coming-soon", "/studio/:path*", "/app/:path*", "/templates", "/brand-kits", "/library", "/profile", "/editor/:path*", "/auth"],
};
