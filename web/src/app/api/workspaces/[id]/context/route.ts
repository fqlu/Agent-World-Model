import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { listGroups, saveGroups, slugify, ContextGroup } from "@/lib/context";

// Context groups declared AT one folder level (?path=, root when omitted).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const path = req.nextUrl.searchParams.get("path") ?? "";
  try {
    return NextResponse.json(await listGroups(connectorFor(ws), path));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const path = req.nextUrl.searchParams.get("path") ?? "";
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.groups)) {
    return NextResponse.json({ error: "Body must be { groups: [...] }" }, { status: 400 });
  }
  const groups: ContextGroup[] = [];
  const seen = new Set<string>();
  for (const g of body.groups) {
    if (!g || typeof g.title !== "string" || !g.title.trim()) {
      return NextResponse.json({ error: "Every group needs a title" }, { status: 400 });
    }
    let slug = typeof g.slug === "string" && g.slug ? g.slug : slugify(g.title);
    while (seen.has(slug)) slug = `${slug}-2`;
    seen.add(slug);
    const members = Array.isArray(g.members)
      ? g.members
          .filter(
            (m: unknown) =>
              m &&
              typeof (m as { path?: unknown }).path === "string" &&
              !(m as { path: string }).path.startsWith("/") &&
              !(m as { path: string }).path.split("/").includes(".."),
          )
          .map((m: { path: string; note?: unknown }) => ({
            path: m.path,
            note: typeof m.note === "string" && m.note.trim() ? m.note.trim() : undefined,
          }))
      : [];
    groups.push({
      slug,
      title: g.title.trim(),
      description: typeof g.description === "string" ? g.description : "",
      members,
    });
  }
  try {
    const c = connectorFor(ws);
    const result = await saveGroups(c, path, groups);
    // Context changed — refresh the workspace index (best-effort)
    try {
      const { writeIndex } = await import("@/lib/index-gen");
      const { writeModel } = await import("@/lib/model-gen");
      await writeIndex(c, ws.name);
      await writeModel(c);
    } catch {}
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
