import { NextRequest, NextResponse } from "next/server";
import { applyProposalSvc } from "@/lib/service";
import { q } from "@/lib/db";
import type { PlanPayload } from "@/lib/service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pid: string }> },
) {
  const { pid } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    let selected: number[];
    if (Array.isArray(body?.selected)) {
      selected = body.selected.map(Number);
    } else {
      // default: every op the plan marked selected (risky ops stay out)
      const proposal = q.getProposal(Number(pid));
      if (!proposal) throw new Error("Proposal not found");
      const plan = JSON.parse(proposal.plan) as PlanPayload;
      selected = plan.ops.map((op, i) => (op.selected ? i : -1)).filter((i) => i >= 0);
    }
    const results = await applyProposalSvc(Number(pid), selected);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
