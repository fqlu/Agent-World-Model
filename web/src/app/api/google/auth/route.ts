import { NextResponse } from "next/server";
import { authUrl, googleConfigured } from "@/lib/google";

export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth not configured — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET" },
      { status: 400 },
    );
  }
  return NextResponse.redirect(authUrl());
}
