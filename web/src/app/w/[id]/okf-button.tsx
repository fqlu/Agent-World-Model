"use client";

import { useCallback, useState } from "react";

type Result = { path: string; concepts: number; entities: number; scopes: number; groups: number };

export default function OkfButton({ wsId }: { wsId: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/okf-export`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Export failed");
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [wsId]);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-zinc-900">Export · Open Knowledge Format</h2>
        <span className="badge bg-indigo-100 text-indigo-700">OKF v0.1</span>
        <button onClick={run} disabled={busy} className="btn-primary ml-auto">
          {busy ? "Exporting…" : "Export OKF bundle"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Writes a conformant Open Knowledge Format bundle (typed concept docs +{" "}
        <code className="font-mono">index.md</code>/<code className="font-mono">log.md</code>) any
        OKF-aware agent can read. Generated artifact — your workspace files are untouched.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-900">
          Exported {result.concepts} concepts ({result.entities} entities · {result.scopes} scopes ·{" "}
          {result.groups} groups) to:
          <div className="mt-1 break-all font-mono text-[11px] text-green-800">{result.path}</div>
        </div>
      )}
    </div>
  );
}
