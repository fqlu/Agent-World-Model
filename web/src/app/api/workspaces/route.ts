import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export async function GET() {
  return NextResponse.json(q.listWorkspaces());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, kind = "local", root, account_email } = body ?? {};
  if (!name || !root || !["local", "gdrive"].includes(kind)) {
    return NextResponse.json({ error: "name, root, kind(local|gdrive) required" }, { status: 400 });
  }
  const id = q.createWorkspace({ name, kind, root, account_email });
  return NextResponse.json({ id }, { status: 201 });
}
