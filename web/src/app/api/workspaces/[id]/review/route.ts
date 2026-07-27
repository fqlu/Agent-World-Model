import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { getReviewQueue, blessPaths, flagPath, unflagPath, flagsScaffold } from "@/lib/review";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  try {
    const queue = await getReviewQueue(connectorFor(ws), ws.id);
    return NextResponse.json({ ...queue, scaffold: flagsScaffold(queue.flags) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// { action: "bless", paths: string[] } | { action: "flag", path, note } |
// { action: "unflag", path }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "Body needs { action }" }, { status: 400 });
  try {
    const c = connectorFor(ws);
    if (body.action === "bless" && Array.isArray(body.paths)) {
      const result = await blessPaths(c, ws.id, body.paths.map(String));
      // stamped files changed the model's inputs — refresh projections
      if (result.stamped.length) {
        try {
          const { writeIndex } = await import("@/lib/index-gen");
          const { writeModel } = await import("@/lib/model-gen");
          await writeIndex(c, ws.name);
          await writeModel(c);
        } catch {}
      }
      return NextResponse.json(result);
    }
    if (body.action === "flag" && typeof body.path === "string") {
      return NextResponse.json({ flags: await flagPath(c, ws.id, body.path, String(body.note ?? "")) });
    }
    if (body.action === "unflag" && typeof body.path === "string") {
      return NextResponse.json({ flags: await unflagPath(ws.id, body.path) });
    }
    return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
