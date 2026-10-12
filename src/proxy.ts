import { NextResponse, type NextRequest } from "next/server";

// Cheap first gate (Next 16 "proxy", formerly middleware): private areas require a session cookie. This only avoids rendering for anonymous visitors;
// real authentication + role authorization happen server-side in layouts, pages and every server action
// (see src/lib/auth/guards.ts) because the cookie value cannot be validated at the edge.
const PRIVATE = ["/dashboard", "/profile", "/resume", "/portfolio", "/applications", "/career-insights", "/notifications", "/settings", "/employer", "/admin", "/jobs/saved", "/jobs/alerts"];

// Every request gets an id (honouring a sane upstream one) so log lines, error reports and support tickets can be correlated.
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const incoming = req.headers.get("x-request-id");
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : newId();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", id);
  if (PRIVATE.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.get("careerpoint_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    const res = NextResponse.redirect(url);
    res.headers.set("x-request-id", id);
    return res;
  }
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", id);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
