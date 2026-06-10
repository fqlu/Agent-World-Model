import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { runAuditAction, createProposalAction } from "@/app/actions";
import type { AuditStats } from "@/lib/linter";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();
  const audits = q.listAudits(ws.id);
  const proposals = q.listProposals(ws.id);
  const latest = audits[0] ? (JSON.parse(audits[0].stats) as AuditStats) : null;

  const runAudit = runAuditAction.bind(null, ws.id);
  const proposeScaffold = createProposalAction.bind(null, ws.id, "scaffold" as const);
  const proposeAdopt = createProposalAction.bind(null, ws.id, "adopt" as const);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Workspaces
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">{ws.name}</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {ws.kind === "local" ? "Local folder" : `Google Drive · ${ws.account_email}`} ·{" "}
          <span className="font-mono">{ws.root}</span> · profile{" "}
          <span className="font-mono">{ws.profile}</span>
        </p>
      </div>

      {latest && (
        <div className="flex flex-wrap gap-3">
          <Stat label="Errors" value={latest.errors} tone="text-red-600" />
          <Stat label="Warnings" value={latest.warns} tone="text-amber-600" />
          <Stat label="Info" value={latest.infos} tone="text-zinc-500" />
          <Stat label="Scopes" value={latest.scopes} tone="text-zinc-900" />
          <Stat label="Overviews" value={latest.overviews} tone="text-zinc-900" />
          <Stat label="WIP notes" value={latest.wipNotes} tone="text-zinc-900" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form action={runAudit}>
          <button className="btn-primary">Run audit</button>
        </form>
        <form action={proposeAdopt}>
          <button className="btn-secondary">Propose adoption / repair</button>
        </form>
        <form action={proposeScaffold}>
          <button className="btn-secondary">Propose fresh scaffold</button>
        </form>
      </div>
      <p className="text-xs text-zinc-500">
        Audits are read-only. Proposals are plans — nothing changes until you review and apply
        them, and applying never deletes (renames and archive moves only).
      </p>

      <section className="grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="font-semibold text-zinc-900">Audits</h2>
          {audits.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">None yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {audits.map((a) => {
                const s = JSON.parse(a.stats) as AuditStats;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/w/${ws.id}/audit/${a.id}`}
                      className="card block px-4 py-2.5 text-sm transition hover:border-indigo-400"
                    >
                      <span className="font-medium text-zinc-900">#{a.id}</span>{" "}
                      <span className="text-xs text-zinc-500">{a.created_at}</span>
                      <div className="mt-0.5 text-xs">
                        <span className="text-red-600">{s.errors} errors</span>
                        <span className="text-zinc-400"> · </span>
                        <span className="text-amber-600">{s.warns} warnings</span>
                        <span className="text-zinc-400"> · </span>
                        <span className="text-zinc-500">{s.infos} info</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h2 className="font-semibold text-zinc-900">Proposals</h2>
          {proposals.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">None yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {proposals.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/w/${ws.id}/proposal/${p.id}`}
                    className="card block px-4 py-2.5 text-sm transition hover:border-indigo-400"
                  >
                    <span className="font-medium text-zinc-900">
                      #{p.id} · {p.kind}
                    </span>{" "}
                    <span className="text-xs text-zinc-500">{p.created_at}</span>
                    <div className="mt-0.5 text-xs">
                      <span
                        className={
                          p.status === "applied"
                            ? "badge bg-green-100 text-green-700"
                            : p.status === "applied_with_errors"
                              ? "badge bg-amber-100 text-amber-700"
                              : "badge bg-zinc-100 text-zinc-600"
                        }
                      >
                        {p.status}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="card min-w-20 px-4 py-2 text-center">
      <div className={`text-xl font-semibold ${tone}`}>{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}
