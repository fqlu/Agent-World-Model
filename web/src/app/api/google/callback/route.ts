import { NextRequest, NextResponse } from "next/server";
import { handleCallback } from "@/lib/google";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code" }, { status: 400 });
  }
  const email = await handleCallback(code);
  const home = new URL("/", req.nextUrl.origin);
  home.searchParams.set("connected", email);
  return NextResponse.redirect(home);
}
