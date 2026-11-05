import { NextRequest, NextResponse } from "next/server";
import { baseUrl, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", baseUrl(req.nextUrl.origin)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
