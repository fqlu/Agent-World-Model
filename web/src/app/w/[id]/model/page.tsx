import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { connectorFor } from "@/lib/hub";
import { buildModel } from "@/lib/model-gen";
import ModelGraph from "./graph";

export const dynamic = "force-dynamic";

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();
  const model = await buildModel(connectorFor(ws));

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          World-model graph
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600">
          The compiled projection of this workspace — entities, scopes, and the typed edges
          between them — assembled from the markdown into{" "}
          <code className="font-mono text-xs">_Model.json</code>. This is what an agent loads to
          traverse the whole model at once.
        </p>
      </div>
      {!model ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No declared topology yet — run an audit and apply a proposal first.
        </p>
      ) : model.nodes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500">
          The model is empty. Add entities and relationships, or promote some folders to scopes.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
            <span>{model.stats.entities} entities</span>
            <span>·</span>
            <span>{model.stats.scopes} scopes</span>
            <span>·</span>
            <span>{model.stats.edges} edges</span>
            <span>·</span>
            <span>generated {model.generated}</span>
          </div>
          <ModelGraph model={model} />
        </>
      )}
    </div>
  );
}
