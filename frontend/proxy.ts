import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, signedIn } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // /editor/<project id> needs a session. The demo (fixtures, no backend) and the editor's own files (frame.html, gsap.min.js) are public.
  const guarded = pathname === "/studio" || pathname.startsWith("/studio/") || pathname === "/app" || pathname.startsWith("/app/") || /^\/editor\/(?!demo$)[^/.]+$/.test(pathname);
  if (guarded && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  if (pathname === "/auth" && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/studio";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)"],
};
