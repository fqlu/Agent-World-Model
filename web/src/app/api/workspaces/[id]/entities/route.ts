import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { listEntities, saveEntities, slugify, Entity, EntityKind, Relation } from "@/lib/entities";
import { relationshipPredicates } from "@/lib/spec";

const KINDS: EntityKind[] = ["person", "system", "concept"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  try {
    return NextResponse.json(await listEntities(connectorFor(ws)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.entities)) {
    return NextResponse.json({ error: "Body must be { entities: [...] }" }, { status: 400 });
  }
  const validPredicates = new Set(relationshipPredicates());
  const entities: Entity[] = [];
  const seen = new Set<string>();
  for (const raw of body.entities) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) {
      return NextResponse.json({ error: "Every entity needs a name" }, { status: 400 });
    }
    const kind: EntityKind = KINDS.includes(raw.kind) ? raw.kind : "concept";
    let slug = typeof raw.slug === "string" && raw.slug ? raw.slug : slugify(raw.name);
    while (seen.has(slug)) slug = `${slug}-2`;
    seen.add(slug);
    const attributes: Record<string, string> = {};
    if (raw.attributes && typeof raw.attributes === "object") {
      for (const [k, v] of Object.entries(raw.attributes)) {
        if (v != null && String(v).trim()) attributes[k] = String(v).trim();
      }
    }
    const relations: Relation[] = [];
    if (Array.isArray(raw.relations)) {
      for (const r of raw.relations) {
        if (
          r &&
          typeof r.predicate === "string" &&
          validPredicates.has(r.predicate) &&
          typeof r.target === "string" &&
          r.target.trim()
        ) {
          relations.push({
            predicate: r.predicate,
            target: r.target.trim(),
            note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : undefined,
          });
        }
      }
    }
    entities.push({
      slug,
      name: raw.name.trim(),
      kind,
      aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
      source: raw.source === "derived" ? "derived" : "asserted",
      confirmed: typeof raw.confirmed === "string" ? raw.confirmed : undefined,
      attributes,
      relations,
      notes: typeof raw.notes === "string" ? raw.notes : "",
    });
  }
  try {
    const c = connectorFor(ws);
    const result = await saveEntities(c, entities);
    try {
      const { writeIndex } = await import("@/lib/index-gen");
      const { writeModel } = await import("@/lib/model-gen");
      await writeIndex(c, ws.name);
      await writeModel(c);
    } catch {}
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
