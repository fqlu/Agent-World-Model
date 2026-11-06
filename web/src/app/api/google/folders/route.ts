import { NextRequest, NextResponse } from "next/server";
import { driveFor } from "@/lib/google";
import { q } from "@/lib/db";

const FOLDER = "application/vnd.google-apps.folder";
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// Browse a connected account's Google Drive folders for the workspace picker.
//   ?account=<email>                    → My Drive root + shared drives
//   ?account=<email>&parent=<folderId>  → that folder's subfolders + breadcrumb
//   ?account=<email>&q=<text>           → folders whose name contains <text>
// Read-only. Each listed folder says whether it already holds a protocol
// config (AGENTS.md → v0.16; _Workspace.yaml → v0.15) for the current folder.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const account = sp.get("account") ?? "";
  if (!q.listTokenEmails().includes(account)) {
    return NextResponse.json({ error: "Connect this Google account first" }, { status: 400 });
  }
  const parent = sp.get("parent") || "root";
  const text = sp.get("q")?.trim();
  try {
    const drive = driveFor(account);
    const common = { supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: 200 } as const;

    if (text) {
      const res = await drive.files.list({
        ...common,
        corpora: "allDrives",
        q: `mimeType = '${FOLDER}' and trashed = false and name contains '${esc(text)}'`,
        fields: "files(id, name)",
        orderBy: "name",
      });
      return NextResponse.json({ mode: "search", path: [], folders: res.data.files ?? [], drives: [] });
    }

    const [children, drives, path, marker] = await Promise.all([
      drive.files.list({
        ...common,
        q: `'${esc(parent)}' in parents and mimeType = '${FOLDER}' and trashed = false`,
        fields: "files(id, name)",
        orderBy: "name",
      }),
      parent === "root"
        ? drive.drives.list({ pageSize: 100, fields: "drives(id, name)" }).catch(() => ({ data: { drives: [] } }))
        : Promise.resolve({ data: { drives: [] } }),
      breadcrumb(drive, parent),
      parent === "root"
        ? Promise.resolve(null)
        : drive.files
            .list({
              ...common,
              q: `'${esc(parent)}' in parents and trashed = false and (name = 'AGENTS.md' or name = '_Workspace.yaml')`,
              fields: "files(name)",
            })
            .then((r) => {
              const names = (r.data.files ?? []).map((f) => f.name);
              return names.includes("_Workspace.yaml") ? "v0.15" : names.includes("AGENTS.md") ? "agents" : null;
            }),
    ]);
    return NextResponse.json({
      mode: "browse",
      folder: path[path.length - 1] ?? { id: "root", name: "My Drive" },
      path,
      folders: children.data.files ?? [],
      drives: drives.data.drives ?? [],
      marker,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

type Drive = ReturnType<typeof driveFor>;

// Root → … → folder, as [{id, name}]. Stops at My Drive or a shared drive.
async function breadcrumb(drive: Drive, id: string): Promise<{ id: string; name: string }[]> {
  if (id === "root") return [{ id: "root", name: "My Drive" }];
  const out: { id: string; name: string }[] = [];
  let cur: string | undefined = id;
  for (let i = 0; cur && i < 12; i++) {
    const f: { data: { id?: string | null; name?: string | null; parents?: string[] | null; driveId?: string | null } } =
      await drive.files.get({ fileId: cur, fields: "id, name, parents, driveId", supportsAllDrives: true });
    const parentId: string | undefined = f.data.parents?.[0] ?? undefined;
    if (!parentId) {
      // top of My Drive or of a shared drive
      if (f.data.driveId && f.data.driveId === f.data.id) {
        const d = await drive.drives.get({ driveId: f.data.id! }).catch(() => null);
        out.unshift({ id: f.data.id!, name: d?.data.name ?? f.data.name ?? "Shared drive" });
      } else out.unshift({ id: "root", name: "My Drive" });
      break;
    }
    out.unshift({ id: f.data.id!, name: f.data.name ?? "" });
    cur = parentId;
  }
  return out;
}
