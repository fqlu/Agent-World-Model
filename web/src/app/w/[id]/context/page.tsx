import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { folderSubtree, listGroups } from "@/lib/context";
import { readDecl } from "@/lib/config";
import { listEntities } from "@/lib/entities";
import { promotedScopes, effectiveFacets } from "@/lib/model-gen";
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
  const decl = await readDecl(c);
  if (decl?.layout !== "v0.15") return <FacetsView wsId={ws.id} wsName={ws.name} c={c} />;
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
          Context groups <span className="badge bg-amber-100 text-amber-800 align-middle text-xs">legacy v0.15</span>
        </h1>
        <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Protocol v0.16 replaces context groups with <strong>facets</strong>. Migrate this workspace
          from its page (Repair → Migrate to v0.16): each group becomes a facet entity and its member
          scopes list it in <code className="font-mono">facets:</code>.
        </p>
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

// v0.16 (SPEC §3.1): facets are entities with attributes.facet; scopes join
// them via `facets:` in their _Overview.md frontmatter, inherited downward.
async function FacetsView({ wsId, wsName, c }: { wsId: number; wsName: string; c: ReturnType<typeof connectorFor> }) {
  const [{ entities }, scopes] = await Promise.all([listEntities(c), promotedScopes(c)]);
  const eff = effectiveFacets(scopes);
  const facets = entities.filter((e) => e.attributes.facet);
  const known = new Set(entities.map((e) => e.slug));
  const unresolved = [...new Set(scopes.flatMap((s) => s.facets).filter((f) => !known.has(f)))];
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/w/${wsId}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {wsName}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Facets</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600">
          Cross-cutting views of the work: pillars, platforms, disciplines, brands. A facet is an{" "}
          <Link href={`/w/${wsId}/entities`} className="text-indigo-600 hover:underline">entity</Link> with{" "}
          <code className="font-mono text-xs">attributes.facet</code>; a scope joins it by listing the slug in{" "}
          <code className="font-mono text-xs">facets:</code> in its <code className="font-mono text-xs">_Overview.md</code>{" "}
          header. Child scopes inherit their parents&apos; facets.
        </p>
        {unresolved.length > 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Facets used on scopes but missing an entity: {unresolved.join(", ")}
          </p>
        )}
      </div>
      {facets.length === 0 ? (
        <p className="text-sm text-zinc-400">No facets yet. Add an entity with attributes.facet (e.g. pillar).</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {facets.map((f) => {
            const direct = scopes.filter((s) => s.facets.includes(f.slug));
            const inherited = scopes.filter((s) => !s.facets.includes(f.slug) && (eff.get(s.path) ?? []).includes(f.slug));
            return (
              <div key={f.slug} className="card p-4">
                <div className="flex items-center gap-2">
                  <span className="badge bg-violet-100 text-violet-700">{f.attributes.facet}</span>
                  <h2 className="font-semibold text-zinc-900">{f.name}</h2>
                  <code className="ml-auto font-mono text-xs text-zinc-400">{f.slug}</code>
                </div>
                {f.notes && <p className="mt-2 text-xs text-zinc-600">{f.notes}</p>}
                <ul className="mt-3 space-y-1 text-sm">
                  {direct.map((s) => (
                    <li key={s.path} className="font-mono text-xs text-zinc-800">{s.path}</li>
                  ))}
                  {inherited.map((s) => (
                    <li key={s.path} className="font-mono text-xs text-zinc-400" title="inherited from a parent scope">
                      {s.path} (inherited)
                    </li>
                  ))}
                  {direct.length + inherited.length === 0 && <li className="text-xs text-zinc-400">No scopes yet.</li>}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
