import { NextRequest, NextResponse } from "next/server";
import { listBundlesSvc, createBundleSvc, bundleOptionsSvc } from "@/lib/service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const withOptions = req.nextUrl.searchParams.get("options") === "1";
    const bundles = await listBundlesSvc(Number(id));
    if (!withOptions) return NextResponse.json({ bundles });
    const options = await bundleOptionsSvc(Number(id));
    return NextResponse.json({ bundles, options });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.scopeKind) {
    return NextResponse.json({ error: "Body needs { name, scopeKind, scopeRef? }" }, { status: 400 });
  }
  try {
    const bundle = await createBundleSvc(
      Number(id),
      body.name,
      body.scopeKind,
      body.scopeRef ?? null,
      body.includeContent === true,
    );
    return NextResponse.json({ bundle });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
