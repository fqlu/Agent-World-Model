import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";

// Gate every page and API behind Google sign-in when an allowlist is set
// (see lib/auth.ts). Public: the sign-in page and the auth endpoints.
export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // everything except Next's static assets and the favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
