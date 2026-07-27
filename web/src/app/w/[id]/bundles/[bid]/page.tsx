import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { listBundleFiles, readBundleFile } from "@/lib/bundle-files";

export const dynamic = "force-dynamic";

const SECTION_LABEL: Record<string, string> = {
  index: "index.md — the table of contents (start here)",
  entities: "Entities — people, systems, concepts",
  scopes: "Scopes — clients, workstreams, projects",
  groups: "Groups — pillars / facets",
  reference: "Reference",
  log: "log.md — change history from the journal",
};

function inclusionRule(kind: string, ref: string | null): string {
  if (kind === "scope")
    return `Everything under "${ref}": its scopes and sub-scopes, every entity with a relationship into that subtree, every context group touching it (members trimmed to the slice), and only the journal sections about it.`;
  if (kind === "group")
    return `The "${ref}" context group: its member scopes (and their sub-scopes), entities related to those scopes, and the group definition itself. The full journal is kept (groups are cross-client by nature).`;
  return "The whole workspace: every scope, entity, and context group, plus house rules and the full journal.";
}

export default async function BundlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; bid: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { id, bid } = await params;
  const { f } = await searchParams;
  const ws = q.getWorkspace(Number(id));
  const bundle = q.getBundle(Number(bid));
  if (!ws || !bundle || bundle.workspace_id !== ws.id) notFound();
  const stats = bundle.stats ? (JSON.parse(bundle.stats) as { concepts: number }) : null;

  const files = await listBundleFiles(bundle.path);
  const selected = f ?? "index.md";
  const content = await readBundleFile(bundle.path, selected);

  const sections = new Map<string, typeof files>();
  for (const file of files) {
    if (!sections.has(file.section)) sections.set(file.section, []);
    sections.get(file.section)!.push(file);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Bundle · {bundle.name}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          {stats ? `${stats.concepts} concepts` : ""} · built {bundle.updated_at} ·{" "}
          <a
            href={`/api/workspaces/${ws.id}/bundles/${bundle.id}/viz`}
            target="_blank"
            className="text-indigo-600 hover:underline"
          >
            open graph ↗
          </a>{" "}
          · <span className="font-mono">{bundle.path}</span>
        </p>
      </div>

      <div className="card border-indigo-100 bg-indigo-50/50 p-4 text-sm text-zinc-700">
        <span className="font-semibold text-zinc-900">What this bundle contains — </span>
        {inclusionRule(bundle.scope_kind, bundle.scope_ref)}{" "}
        <span className="text-zinc-500">
          Selection is deterministic — compiled from the world model by rule, no AI involved.
          Rebuild re-reads the workspace and reproduces the bundle exactly.
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <nav className="space-y-4">
          {[...sections.entries()].map(([section, list]) => (
            <div key={section}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {SECTION_LABEL[section] ?? section}
              </h2>
              <ul className="mt-1 space-y-0.5">
                {list.map((file) => (
                  <li key={file.rel}>
                    <Link
                      href={`/w/${ws.id}/bundles/${bundle.id}?f=${encodeURIComponent(file.rel)}`}
                      className={
                        file.rel === selected
                          ? "block rounded px-2 py-1 text-sm bg-indigo-100 font-medium text-indigo-900"
                          : "block rounded px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
                      }
                    >
                      {file.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="card min-w-0 p-5">
          <div className="mb-2 font-mono text-xs text-zinc-400">{selected}</div>
          {content !== null ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-zinc-800">
              {content}
            </pre>
          ) : (
            <p className="text-sm text-zinc-400">File not found — rebuild the bundle?</p>
          )}
        </div>
      </div>
    </div>
  );
}
