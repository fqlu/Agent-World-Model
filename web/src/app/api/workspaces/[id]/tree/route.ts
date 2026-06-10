import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { folderSubtree } from "@/lib/context";

// Folder subtree under ?path= (workspace root when omitted), depth-capped.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const path = req.nextUrl.searchParams.get("path") ?? "";
  const depth = Math.min(Number(req.nextUrl.searchParams.get("depth") ?? 4) || 4, 6);
  try {
    const tree = await folderSubtree(connectorFor(ws), path, depth);
    return NextResponse.json({ path, tree });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
