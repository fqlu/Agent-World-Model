import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import {
  runAuditAction,
  createProposalAction,
  regenerateIndexAction,
  removeWorkspaceAction,
} from "@/app/actions";
import type { AuditStats } from "@/lib/linter";
import SyncPanel from "./sync-panel";
import RemoveWorkspace from "./remove-workspace";
import BundlesPanel from "./bundles-panel";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = q.getWorkspace(Number(id));
  if (!ws) notFound();
  const audits = q.listAudits(ws.id);
  const proposals = q.listProposals(ws.id);
  const latestAudit = audits[0];
  const latest = latestAudit ? (JSON.parse(latestAudit.stats) as AuditStats) : null;
  const pendingProposal = proposals.find((p) => p.status === "proposed");

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

      <SyncPanel wsId={ws.id} />

      <Link
        href={`/w/${ws.id}/review`}
        className="card flex items-center gap-3 border-indigo-200 p-4 transition hover:border-indigo-400"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
          ✓
        </span>
        <span>
          <span className="font-semibold text-zinc-900">Review changes</span>
          <span className="block text-xs text-zinc-500">
            See what any agent changed since you last looked, diff included — verify it (stamps{" "}
            <code className="font-mono">verified</code>) or flag it for the next agent to fix.
          </span>
        </span>
        <span className="ml-auto text-indigo-600">→</span>
      </Link>

      <BundlesPanel wsId={ws.id} />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1 — Audit */}
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              1
            </span>
            <h2 className="font-semibold text-zinc-900">Audit</h2>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Read-only health check of the workspace against the protocol spec.
          </p>
          <div className="mt-3 flex-1 text-sm">
            {latest ? (
              <>
                <div className="flex gap-2 text-lg font-semibold">
                  <span className="text-red-600">{latest.errors}</span>
                  <span className="text-xs font-normal self-end text-zinc-500">errors</span>
                  <span className="text-amber-600">{latest.warns}</span>
                  <span className="text-xs font-normal self-end text-zinc-500">warnings</span>
                  <span className="text-zinc-500">{latest.infos}</span>
                  <span className="text-xs font-normal self-end text-zinc-500">info</span>
                </div>
                <Link
                  href={`/w/${ws.id}/audit/${latestAudit!.id}`}
                  className="mt-1 inline-block text-xs text-indigo-600 hover:underline"
                >
                  View latest report ({latestAudit!.created_at}) →
                </Link>
              </>
            ) : (
              <p className="text-zinc-400">Never audited.</p>
            )}
          </div>
          <form action={runAudit} className="mt-4">
            <button className="btn-primary w-full justify-center">Run audit</button>
          </form>
          <Link
            href={`/w/${ws.id}/rules`}
            className="mt-2 block text-center text-xs text-indigo-600 hover:underline"
          >
            See &amp; edit enforced rules →
          </Link>
        </div>

        {/* 2 — Repair */}
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              2
            </span>
            <h2 className="font-semibold text-zinc-900">Repair</h2>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Turn findings into a reviewed, opt-in plan. Nothing is ever deleted.
          </p>
          <div className="mt-3 flex-1 text-sm">
            {pendingProposal ? (
              <Link
                href={`/w/${ws.id}/proposal/${pendingProposal.id}`}
                className="block rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-800 hover:border-indigo-400"
              >
                Proposal #{pendingProposal.id} ({pendingProposal.kind}) awaits review →
              </Link>
            ) : (
              <p className="text-zinc-400">No pending proposals.</p>
            )}
          </div>
          <div className="mt-4 space-y-2">
            <form action={proposeAdopt}>
              <button className="btn-secondary w-full justify-center">
                New repair / adoption proposal
              </button>
            </form>
            <form action={proposeScaffold} className="text-center">
              <button className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline">
                …or propose a fresh scaffold
              </button>
            </form>
          </div>
        </div>

        {/* 3 — Context groups */}
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              3
            </span>
            <h2 className="font-semibold text-zinc-900">Context groups</h2>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Wire folders into named groups agents read to resolve associations. Subfolders
            inherit.
          </p>
          <div className="mt-3 flex-1 text-sm">
            {latest ? (
              <p>
                <span className="text-lg font-semibold text-zinc-900">{latest.groups ?? 0}</span>{" "}
                <span className="text-xs text-zinc-500">group(s) as of last audit</span>
              </p>
            ) : (
              <p className="text-zinc-400">Audit first to see group counts.</p>
            )}
          </div>
          <Link href={`/w/${ws.id}/context`} className="btn-primary mt-4 w-full justify-center">
            Open context canvas
          </Link>
        </div>

        {/* 4 — Entities */}
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              4
            </span>
            <h2 className="font-semibold text-zinc-900">Entities</h2>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            The cast of the world model — people, systems, concepts as nodes agents resolve.
            Seeded by extracting from your overviews.
          </p>
          <div className="mt-3 flex-1 text-sm">
            {latest ? (
              <p>
                <span className="text-lg font-semibold text-zinc-900">{latest.entities ?? 0}</span>{" "}
                <span className="text-xs text-zinc-500">entit{(latest.entities ?? 0) === 1 ? "y" : "ies"} as of last audit</span>
              </p>
            ) : (
              <p className="text-zinc-400">Audit first to see entity counts.</p>
            )}
          </div>
          <Link href={`/w/${ws.id}/entities`} className="btn-primary mt-4 w-full justify-center">
            Manage entities
          </Link>
          <Link
            href={`/w/${ws.id}/model`}
            className="mt-2 text-center text-xs text-indigo-600 hover:underline"
          >
            View world-model graph →
          </Link>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-xs text-zinc-500">
          Audits are read-only. Proposals are plans — nothing changes until you review and apply
          them, and applying never deletes (renames and archive moves only). Every applied change
          is journaled. <code className="font-mono">_Index.md</code> (the agent/RAG map) refreshes
          automatically after applies and context saves.
        </p>
        <form action={regenerateIndexAction.bind(null, ws.id)}>
          <button className="text-xs text-indigo-600 hover:underline">
            Regenerate _Index.md now
          </button>
        </form>
      </div>

      <section className="grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="font-semibold text-zinc-900">Audit history</h2>
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
          <h2 className="font-semibold text-zinc-900">Proposal history</h2>
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
                              : "badge bg-indigo-100 text-indigo-700"
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

      <RemoveWorkspace action={removeWorkspaceAction.bind(null, ws.id)} name={ws.name} />
    </div>
  );
}
