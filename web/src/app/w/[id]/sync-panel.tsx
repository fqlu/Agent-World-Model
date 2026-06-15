"use client";

import { useCallback, useEffect, useState } from "react";

type SyncDiff = { added: string[]; modified: string[]; removed: string[] };
type Detect = {
  firstRun: boolean;
  diff: SyncDiff;
  tracked: number;
  changed: number;
  syncedAt: string | null;
};
type Applied = { report: Detect; scaffold: string; syncedAt: string | null };

export default function SyncPanel({ wsId }: { wsId: number }) {
  const [detect, setDetect] = useState<Detect | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [scaffold, setScaffold] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/sync`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Detection failed");
      setDetect(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/sync`, { method: "POST" });
      const body: Applied = await res.json();
      if (!res.ok) throw new Error((body as unknown as { error: string }).error ?? "Sync failed");
      setScaffold(body.report.changed > 0 ? body.scaffold : null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [wsId, refresh]);

  const copyScaffold = useCallback(() => {
    if (!scaffold) return;
    navigator.clipboard.writeText(scaffold);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [scaffold]);

  const changed = detect?.changed ?? 0;
  const stale = changed > 0;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${stale ? "bg-amber-500" : "bg-green-500"}`}
          />
          <h2 className="font-semibold text-zinc-900">Maintenance · sync</h2>
        </div>
        <div className="text-sm text-zinc-500">
          {loading ? (
            "Checking for drift…"
          ) : detect?.firstRun ? (
            <>No baseline yet · {detect.tracked} files will be tracked</>
          ) : stale ? (
            <span className="text-amber-700">
              {changed} change{changed === 1 ? "" : "s"} since last sync
              {detect?.syncedAt ? ` (${detect.syncedAt})` : ""} — model may be stale
            </span>
          ) : (
            <>Up to date{detect?.syncedAt ? ` · last synced ${detect.syncedAt}` : ""}</>
          )}
        </div>
        <button onClick={sync} disabled={syncing} className="btn-primary ml-auto">
          {syncing ? "Syncing…" : detect?.firstRun ? "Establish baseline" : "Sync & refresh"}
        </button>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        Detects what changed in the Drive since the last sync, refreshes{" "}
        <code className="font-mono">_Index.md</code> + <code className="font-mono">_Model.json</code>,
        and hands you a reflection scaffold to give an agent. Detection is read-only; nothing is
        deleted.
      </p>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {detect && !detect.firstRun && changed > 0 && (
        <div className="mt-3 grid gap-1 text-xs sm:grid-cols-3">
          <DiffCol label="Modified" tone="text-amber-700" items={detect.diff.modified} />
          <DiffCol label="Added" tone="text-green-700" items={detect.diff.added} />
          <DiffCol label="Removed" tone="text-red-700" items={detect.diff.removed} />
        </div>
      )}

      {scaffold && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-900">
              Reflection scaffold — hand this to an agent
            </span>
            <button
              onClick={copyScaffold}
              className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[11px] text-zinc-700">
            {scaffold}
          </pre>
        </div>
      )}
    </div>
  );
}

function DiffCol({ label, tone, items }: { label: string; tone: string; items: string[] }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-2">
      <div className={`font-medium ${tone}`}>
        {label} ({items.length})
      </div>
      <ul className="mt-1 space-y-0.5">
        {items.slice(0, 8).map((p) => (
          <li key={p} className="truncate font-mono text-[11px] text-zinc-500" title={p}>
            {p}
          </li>
        ))}
        {items.length > 8 && <li className="text-[11px] text-zinc-400">+{items.length - 8} more</li>}
      </ul>
    </div>
  );
}
