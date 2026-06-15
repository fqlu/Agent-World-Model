import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { buildModel } from "@/lib/model-gen";

// The world-model projection (SPEC §6.8), computed fresh from the files.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  try {
    const model = await buildModel(connectorFor(ws));
    if (!model) return NextResponse.json({ error: "Workspace has no declared topology yet" }, { status: 400 });
    return NextResponse.json(model);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
