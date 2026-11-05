import { NextRequest, NextResponse } from "next/server";
import { getIgnoreSvc, saveIgnoreSvc } from "@/lib/service";

// The workspace's ignore list, stored in its own _Workspace.yaml.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await getIgnoreSvc(Number(id)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.ignore)) {
    return NextResponse.json({ error: 'Body must be {"ignore": ["path", ...]}' }, { status: 400 });
  }
  try {
    return NextResponse.json(await saveIgnoreSvc(Number(id), body.ignore));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
