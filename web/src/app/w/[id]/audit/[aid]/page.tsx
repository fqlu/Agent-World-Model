import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import type { Finding, AuditStats } from "@/lib/linter";

export const dynamic = "force-dynamic";

const ORDER = { error: 0, warn: 1, info: 2 } as const;
const BADGE = {
  error: "bg-red-100 text-red-700",
  warn: "bg-amber-100 text-amber-700",
  info: "bg-zinc-100 text-zinc-600",
} as const;

export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string; aid: string }>;
}) {
  const { id, aid } = await params;
  const ws = q.getWorkspace(Number(id));
  const audit = q.getAudit(Number(aid));
  if (!ws || !audit || audit.workspace_id !== ws.id) notFound();

  const findings = (JSON.parse(audit.findings) as Finding[]).sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || a.rule.localeCompare(b.rule),
  );
  const stats = JSON.parse(audit.stats) as AuditStats;

  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule)!.push(f);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/w/${ws.id}`} className="text-sm text-zinc-500 hover:text-zinc-800">
          ← {ws.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Audit #{audit.id}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {audit.created_at} · {stats.scopes} scopes · {stats.overviews} overviews ·{" "}
          {stats.wipNotes} WIP notes · {stats.journalDays} journal days —{" "}
          <span className="text-red-600">{stats.errors} errors</span>,{" "}
          <span className="text-amber-600">{stats.warns} warnings</span>,{" "}
          <span className="text-zinc-500">{stats.infos} info</span>
        </p>
      </div>

      {findings.length === 0 ? (
        <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Fully compliant — no findings. 🟢
        </p>
      ) : (
        [...byRule.entries()].map(([rule, fs]) => (
          <section key={rule}>
            <h2 className="flex items-center gap-2 font-medium text-zinc-900">
              <span className={`badge font-mono ${BADGE[fs[0].severity]}`}>{rule}</span>
              <span className="text-sm font-normal text-zinc-500">{fs.length} finding(s)</span>
            </h2>
            <ul className="mt-2 space-y-1.5">
              {fs.map((f, i) => (
                <li key={i} className="card px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-zinc-400">{f.path || "(root)"}</span>
                  <div className="text-zinc-800">{f.message}</div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
