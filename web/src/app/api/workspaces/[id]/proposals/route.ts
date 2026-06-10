import { NextRequest, NextResponse } from "next/server";
import { createProposalSvc } from "@/lib/service";
import { q } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind === "scaffold" ? "scaffold" : "adopt";
  try {
    const pid = await createProposalSvc(Number(id), kind);
    const proposal = q.getProposal(pid)!;
    return NextResponse.json({ proposalId: pid, plan: JSON.parse(proposal.plan) }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
