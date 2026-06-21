import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

// Removes only the app's reference to a workspace — files on disk are untouched.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  q.deleteWorkspace(Number(id));
  return NextResponse.json({ removed: ws.name });
}
