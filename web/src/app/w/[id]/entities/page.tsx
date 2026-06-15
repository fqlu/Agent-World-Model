import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { listEntities } from "@/lib/entities";
import { relationshipPredicates } from "@/lib/spec";
import { promotedScopes } from "@/lib/model-gen";
import EntitiesEditor from "./editor";

export const dynamic = "force-dynamic";

export default async function EntitiesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();
  const c = connectorFor(ws);
  const { mount, entities, problems } = await listEntities(c);
  const scopes = await promotedScopes(c);

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Entities</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          The <strong>cast</strong> of your world model — people, systems, and concepts as
          addressable nodes an agent resolves consistently. Saved as one markdown file each in{" "}
          <code className="font-mono text-xs">{mount}/</code>. Start by{" "}
          <strong>extracting</strong> candidates from your existing overviews, then confirm and
          enrich — the model stays true with minimal effort.
        </p>
        {problems.length > 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Skipped invalid entity file(s): {problems.join("; ")}
          </p>
        )}
      </div>
      <EntitiesEditor
        wsId={ws.id}
        initial={entities}
        predicates={relationshipPredicates()}
        scopes={scopes}
      />
    </div>
  );
}
