import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

// Serves the bundle's self-contained viz.html (generated at export time).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; bid: string }> },
) {
  const { id, bid } = await params;
  const b = q.getBundle(Number(bid));
  if (!b || b.workspace_id !== Number(id)) {
    return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
  }
  try {
    const html = await fs.readFile(path.join(b.path, "viz.html"), "utf-8");
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch {
    return NextResponse.json({ error: "viz.html not built yet — rebuild the bundle" }, { status: 404 });
  }
}
