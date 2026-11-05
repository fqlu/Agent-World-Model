import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { baseUrl, isAllowed, signSession, SESSION_COOKIE, SESSION_MAX_AGE, STATE_COOKIE } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  const fail = (msg: string) => {
    const u = new URL("/login", baseUrl(req.nextUrl.origin));
    u.searchParams.set("error", msg);
    return NextResponse.redirect(u);
  };
  if (!code || !state || !expected || state !== expected) return fail("Sign-in expired — try again.");
  try {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${baseUrl(req.nextUrl.origin)}/api/auth/callback`,
    );
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return fail("Google returned no identity token.");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.email || !p.email_verified) return fail("Your Google account email isn't verified.");
    if (!isAllowed(p.email)) return fail(`${p.email} isn't allowed to use this app.`);
    const next = state.split("|")[1] || "/";
    const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", baseUrl(req.nextUrl.origin)));
    res.cookies.set(SESSION_COOKIE, await signSession(p.email), {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:" || Boolean(process.env.APP_URL?.startsWith("https:")),
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (e) {
    return fail(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
