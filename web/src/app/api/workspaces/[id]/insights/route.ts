import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { computeInsights } from "@/lib/graph-insights";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  try {
    return NextResponse.json(await computeInsights(connectorFor(ws)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
