import { NextRequest, NextResponse } from "next/server";
import { refreshBundleSvc, deleteBundleSvc } from "@/lib/service";

// POST = rebuild the bundle in place (same slug/dir, fresh content)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; bid: string }> },
) {
  const { id, bid } = await params;
  try {
    const bundle = await refreshBundleSvc(Number(id), Number(bid));
    return NextResponse.json({ bundle });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// DELETE = remove the bundle row + its generated directory (app scratch only —
// the workspace's files are never touched)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; bid: string }> },
) {
  const { id, bid } = await params;
  try {
    return NextResponse.json(await deleteBundleSvc(Number(id), Number(bid)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
