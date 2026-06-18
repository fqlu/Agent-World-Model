import { NextRequest, NextResponse } from "next/server";
import { exportOkfSvc } from "@/lib/service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json(await exportOkfSvc(Number(id)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
