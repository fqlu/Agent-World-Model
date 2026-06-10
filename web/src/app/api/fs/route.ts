import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Local directory browser for the folder picker. Read-only, listing only,
// confined to the user's home directory.
export async function GET(req: NextRequest) {
  const home = os.homedir();
  const requested = req.nextUrl.searchParams.get("path") ?? home;
  const resolved = path.resolve(requested);
  if (!resolved.startsWith(home)) {
    return NextResponse.json({ error: "Browsing is limited to your home directory" }, { status: 400 });
  }
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name), hidden: e.name.startsWith(".") }))
      .sort((a, b) => Number(a.hidden) - Number(b.hidden) || a.name.localeCompare(b.name));
    const parent = resolved === home ? null : path.dirname(resolved);
    return NextResponse.json({ path: resolved, parent, dirs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
