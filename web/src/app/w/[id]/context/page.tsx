import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { folderSubtree, listGroups } from "@/lib/context";
import ContextCanvas from "./canvas";

export const dynamic = "force-dynamic";

export default async function ContextPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { id } = await params;
  const { path = "" } = await searchParams;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();

  const c = connectorFor(ws);
  const [tree, { dir, groups, problems }] = await Promise.all([
    folderSubtree(c, path, 4),
    listGroups(c, path),
  ]);

  // Breadcrumb trail: root → each path segment
  const segments = path ? path.split("/") : [];
  const crumbs = segments.map((seg, i) => ({
    name: seg,
    path: segments.slice(0, i + 1).join("/"),
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Context groups
        </h1>
        <nav className="mt-1 text-sm text-zinc-600">
          <Link href={`/w/${ws.id}/context`} className="text-indigo-600 hover:underline">
            (root)
          </Link>
          {crumbs.map((cr) => (
            <span key={cr.path}>
              {" / "}
              <Link
                href={`/w/${ws.id}/context?path=${encodeURIComponent(cr.path)}`}
                className="text-indigo-600 hover:underline"
              >
                {cr.name}
              </Link>
            </span>
          ))}
        </nav>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600">
          Click folders to expand or collapse their subfolders; connect any visible folder to a
          group. Saving writes one file per group to{" "}
          <code className="font-mono text-xs">{dir}/</code>. Subfolders <strong>inherit</strong>{" "}
          their ancestors' groups — wire a subfolder directly only when its context differs from
          its parent's.
        </p>
        {problems.length > 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Skipped invalid group file(s): {problems.join("; ")}
          </p>
        )}
      </div>
      <ContextCanvas wsId={ws.id} folderPath={path} tree={tree} initialGroups={groups} />
    </div>
  );
}
