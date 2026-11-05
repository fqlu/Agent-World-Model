import { NextRequest, NextResponse } from "next/server";
import { getDreamingSvc, saveDreamingSvc, regenerateDreamingBriefSvc } from "@/lib/service";

// Dreaming setup (spec/DREAMING.md): settings live in the AGENTS.md header;
// saving re-renders AGENTS.md and <proposals>/dreaming/INSTRUCTIONS.md.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await getDreamingSvc(Number(id)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  try {
    return NextResponse.json(await saveDreamingSvc(Number(id), body as Record<string, unknown>));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await regenerateDreamingBriefSvc(Number(id)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
