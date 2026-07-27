"use client";

import { useEffect, useState } from "react";

type Insight = { kind: string; title: string; detail: string; nodes: string[] };

const KIND_BADGE: Record<string, [string, string]> = {
  isolate: ["orphans", "badge bg-zinc-100 text-zinc-600"],
  hub: ["split candidate", "badge bg-amber-100 text-amber-700"],
  duplicate: ["merge candidate", "badge bg-red-100 text-red-700"],
  community: ["facet candidate", "badge bg-indigo-100 text-indigo-700"],
  "weak-group": ["weak facet", "badge bg-orange-100 text-orange-700"],
  bridge: ["bus factor", "badge bg-purple-100 text-purple-700"],
};

export default function InsightsPanel({ wsId }: { wsId: number }) {
  const [data, setData] = useState<{ insights: Insight[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/workspaces/${wsId}/insights`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? "Failed");
        setData(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [wsId]);

  if (error) return <p className="text-xs text-red-600">Insights: {error}</p>;
  if (!data) return <p className="text-xs text-zinc-400">Analysing graph…</p>;

  return (
    <div className="card p-5">
      <h2 className="font-semibold text-zinc-900">Graph insights</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Deterministic topology analysis — structure the folder tree can&apos;t show. Every finding
        is a proposal for your judgement, never auto-applied. Signals sharpen as relationships
        grow.
      </p>
      {data.insights.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No structural findings — the graph is tidy.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.insights.map((i, idx) => {
            const [label, cls] = KIND_BADGE[i.kind] ?? [i.kind, "badge bg-zinc-100 text-zinc-600"];
            return (
              <li key={idx} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cls}>{label}</span>
                  <span className="font-medium text-zinc-900">{i.title}</span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{i.detail}</p>
                {i.nodes.length > 1 && (
                  <p className="mt-1 text-xs text-zinc-400">{i.nodes.join(" · ")}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
