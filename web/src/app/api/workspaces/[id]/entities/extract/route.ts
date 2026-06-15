import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { extractCandidates } from "@/lib/entities";

// Derive candidate entities from existing overviews. Read-only — proposes,
// never writes. The UI lets the human accept/edit before saving.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  try {
    const candidates = await extractCandidates(connectorFor(ws));
    return NextResponse.json({ candidates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
