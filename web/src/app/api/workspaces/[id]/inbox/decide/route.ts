import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { readDecl } from "@/lib/config";
import { DecisionError, DecisionInput, recordDecision } from "@/lib/proposals";

// Record (and, for accepts/answers with ops, apply) a decision on one inbox item.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  let input: DecisionInput;
  try {
    input = (await req.json()) as DecisionInput;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  try {
    const c = connectorFor(ws);
    const owner = (await readDecl(c))?.owner?.email ?? ws.account_email;
    const decision = await recordDecision(c, owner, input);
    return NextResponse.json(decision);
  } catch (e) {
    const status = e instanceof DecisionError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
