import { NextRequest, NextResponse } from "next/server";
import { runAuditSvc } from "@/lib/service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { auditId, result } = await runAuditSvc(Number(id));
    return NextResponse.json({ auditId, stats: result.stats, findings: result.findings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
