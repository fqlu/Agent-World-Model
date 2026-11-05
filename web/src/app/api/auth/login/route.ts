import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { baseUrl, STATE_COOKIE } from "@/lib/auth";

// Start Google sign-in (identity only: openid + email). Drive access is a
// separate, explicit "Connect Google account" step on the home page.
export async function GET(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set" }, { status: 500 });
  }
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const state = `${crypto.randomUUID()}|${next.startsWith("/") ? next : "/"}`;
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${baseUrl(req.nextUrl.origin)}/api/auth/callback`,
  );
  const url = client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
    ...(process.env.AUTH_ALLOWED_DOMAINS && !process.env.AUTH_ALLOWED_DOMAINS.includes(",")
      ? { hd: process.env.AUTH_ALLOWED_DOMAINS.trim() }
      : {}),
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
