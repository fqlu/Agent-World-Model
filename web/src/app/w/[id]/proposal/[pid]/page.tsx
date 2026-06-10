import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { applyProposalAction } from "@/app/actions";
import type { PlanPayload } from "@/lib/service";
import type { OpResult } from "@/lib/ops";

export const dynamic = "force-dynamic";

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ id: string; pid: string }>;
}) {
  const { id, pid } = await params;
  const ws = q.getWorkspace(Number(id));
  const proposal = q.getProposal(Number(pid));
  if (!ws || !proposal || proposal.workspace_id !== ws.id) notFound();

  const plan = JSON.parse(proposal.plan) as PlanPayload;
  const results = proposal.result ? (JSON.parse(proposal.result) as OpResult[]) : null;
  const applied = proposal.status.startsWith("applied");
  const apply = applyProposalAction.bind(null, ws.id, proposal.id);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          {proposal.kind === "scaffold" ? "Scaffold" : "Adoption / repair"} proposal #{proposal.id}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {proposal.created_at} · status: {proposal.status} · {plan.ops.length} operation(s)
        </p>
      </div>

      {plan.notes.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 space-y-1">
          {plan.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}

      {!applied ? (
        <form action={apply} className="space-y-4">
          <p className="text-sm text-zinc-600">
            Review each operation. Nothing is deleted, ever — unticked operations are skipped.
            Risky operations (renames) start unticked.
          </p>
          <ul className="space-y-1.5">
            {plan.ops.map((op, i) => (
              <li
                key={i}
                className={`card px-3 py-2 text-sm ${op.risky ? "border-amber-300 bg-amber-50" : ""}`}
              >
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="op"
                    value={i}
                    defaultChecked={op.selected}
                    className="mt-1 h-4 w-4 accent-indigo-600"
                  />
                  <span>
                    <span className="badge bg-zinc-100 font-mono uppercase text-zinc-500">
                      {op.action}
                    </span>{" "}
                    <span className="font-mono text-xs text-zinc-800">{op.path}</span>
                    {op.to && (
                      <span className="font-mono text-xs text-zinc-500"> → {op.to}</span>
                    )}
                    <div className="mt-0.5 text-zinc-600">{op.note}</div>
                    {op.risky && (
                      <div className="mt-0.5 text-xs font-medium text-amber-700">
                        ⚠ Review carefully before ticking.
                      </div>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button className="btn-primary">Apply selected operations</button>
        </form>
      ) : (
        <section>
          <h2 className="font-semibold text-zinc-900">Result</h2>
          <ul className="mt-2 space-y-1">
            {(results ?? []).map((r, i) => (
              <li
                key={i}
                className={`rounded border px-3 py-2 text-sm ${
                  r.skipped
                    ? "border-zinc-200 bg-zinc-50 text-zinc-400"
                    : r.ok
                      ? "border-green-200 bg-green-50 text-green-900"
                      : "border-red-200 bg-red-50 text-red-900"
                }`}
              >
                <span className="font-mono text-xs uppercase">{r.op.action}</span>{" "}
                <span className="font-mono text-xs">{r.op.path}</span>
                {r.op.to && <span className="font-mono text-xs"> → {r.op.to}</span>}
                {r.skipped ? " — skipped" : r.ok ? " — done" : ` — failed: ${r.error}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
