"use client";

import { useCallback, useEffect, useState } from "react";

type Item = {
  path: string;
  change: "added" | "modified" | "removed";
  kind: string;
  stampable: boolean;
  findings: { rule: string; severity: string; message: string }[];
};
type Flag = { path: string; note: string; flagged_at: string };
type Queue = {
  firstRun: boolean;
  reviewedAt: string | null;
  items: Item[];
  flags: Flag[];
  scaffold: string;
};
type DiffLine = { t: "add" | "del" | "ctx"; s: string };
type FileDiff = {
  path: string;
  binary: boolean;
  hasPrevious: boolean;
  lines: DiffLine[] | null;
  current: string | null;
};

const CHANGE_BADGE: Record<string, string> = {
  added: "badge bg-green-100 text-green-700",
  modified: "badge bg-amber-100 text-amber-700",
  removed: "badge bg-red-100 text-red-700",
};

const LINE_CLASS: Record<DiffLine["t"], string> = {
  add: "bg-green-50 text-green-900",
  del: "bg-red-50 text-red-800 line-through decoration-red-300",
  ctx: "text-zinc-500",
};

export default function ReviewQueue({ wsId }: { wsId: number }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [flagging, setFlagging] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, FileDiff | "loading">>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/review`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load review queue");
      setQueue(body);
      setPicked(new Set((body.items as Item[]).map((i) => i.path)));
      setOpen(null);
      setDiffs({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [wsId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDiff = useCallback(
    async (path: string) => {
      if (open === path) {
        setOpen(null);
        return;
      }
      setOpen(path);
      if (!diffs[path]) {
        setDiffs((d) => ({ ...d, [path]: "loading" }));
        try {
          const res = await fetch(`/api/workspaces/${wsId}/review?diff=${encodeURIComponent(path)}`);
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "Diff failed");
          setDiffs((d) => ({ ...d, [path]: body }));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    },
    [wsId, open, diffs],
  );

  const act = useCallback(
    async (payload: Record<string, unknown>, doneMsg?: (r: Record<string, unknown>) => string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/workspaces/${wsId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Action failed");
        if (doneMsg) setLastResult(doneMsg(body));
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [wsId, load],
  );

  if (!queue) return <p className="text-sm text-zinc-400">{error ?? "Loading…"}</p>;

  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {lastResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-900">
          {lastResult}
        </div>
      )}

      {queue.items.length === 0 ? (
        <div className="card p-6 text-sm text-zinc-500">
          {queue.firstRun
            ? "Baseline recorded — from now on, anything any agent changes will appear here."
            : `Nothing to review — you're caught up (last reviewed ${queue.reviewedAt}).`}
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-zinc-900">
              {queue.items.length} change{queue.items.length === 1 ? "" : "s"} since last review
            </h2>
            <span className="text-xs text-zinc-400">{queue.reviewedAt ?? "never"}</span>
            <button
              onClick={() =>
                act({ action: "verify", paths: [...picked] }, (r) =>
                  `Verified ${r.verified} file(s)` +
                  ((r.stamped as string[]).length
                    ? ` — ${(r.stamped as string[]).length} trust stamp(s) written`
                    : ""),
                )
              }
              disabled={busy || picked.size === 0}
              className="btn-primary ml-auto"
            >
              {busy ? "Working…" : `Verify selected (${picked.size})`}
            </button>
          </div>
          <ul className="mt-4 space-y-2">
            {queue.items.map((i) => (
              <li key={i.path} className="rounded-lg border border-zinc-200 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(i.path)}
                    onChange={() => toggle(i.path)}
                  />
                  <span className={CHANGE_BADGE[i.change]}>{i.change}</span>
                  <span className="badge bg-zinc-100 text-zinc-600">{i.kind}</span>
                  {i.stampable && (
                    <span className="badge bg-indigo-100 text-indigo-700">stamps verified</span>
                  )}
                  <span className="min-w-0 break-all font-mono text-xs text-zinc-700">{i.path}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <button
                      onClick={() => toggleDiff(i.path)}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      {open === i.path ? "Hide changes" : "View changes"}
                    </button>
                    <button
                      onClick={() => {
                        setFlagging(flagging === i.path ? null : i.path);
                        setFlagNote("");
                      }}
                      className="text-xs text-amber-700 hover:underline"
                    >
                      Flag
                    </button>
                  </span>
                </div>
                {i.findings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-6">
                    {i.findings.map((f, idx) => (
                      <li key={idx} className="text-xs">
                        <span
                          className={
                            f.severity === "error" ? "text-red-600" : f.severity === "warn" ? "text-amber-600" : "text-zinc-500"
                          }
                        >
                          {f.rule}
                        </span>{" "}
                        <span className="text-zinc-600">{f.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {open === i.path && (
                  <div className="mt-2 pl-6">
                    {diffs[i.path] === "loading" || !diffs[i.path] ? (
                      <p className="text-xs text-zinc-400">Loading changes…</p>
                    ) : (
                      <DiffView diff={diffs[i.path] as FileDiff} />
                    )}
                  </div>
                )}
                {flagging === i.path && (
                  <div className="mt-2 flex items-center gap-2 pl-6">
                    <input
                      className="input flex-1"
                      placeholder="What's wrong / what should the next agent fix?"
                      value={flagNote}
                      onChange={(e) => setFlagNote(e.target.value)}
                    />
                    <button
                      onClick={() => {
                        void act({ action: "flag", path: i.path, note: flagNote });
                        setFlagging(null);
                      }}
                      disabled={busy}
                      className="btn-secondary"
                    >
                      Save flag
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {queue.flags.length > 0 && (
        <div className="card border-amber-200 p-5">
          <h2 className="font-semibold text-zinc-900">
            Flagged for follow-up ({queue.flags.length})
          </h2>
          <ul className="mt-2 space-y-1">
            {queue.flags.map((f) => (
              <li key={f.path} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 break-all font-mono text-xs text-zinc-700">{f.path}</span>
                <span className="text-zinc-500">— {f.note}</span>
                <span className="text-xs text-zinc-400">({f.flagged_at})</span>
                <button
                  onClick={() => act({ action: "unflag", path: f.path })}
                  disabled={busy}
                  className="ml-auto text-xs text-zinc-500 hover:underline"
                >
                  Resolve
                </button>
              </li>
            ))}
          </ul>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-indigo-600 hover:underline">
              Copy a fix-up task for your next agent session
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-[11px] text-zinc-700">
              {queue.scaffold}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: FileDiff }) {
  if (diff.binary) {
    return (
      <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
        Binary / non-text file (e.g. xlsx, pptx) — no inline preview. Open it from the folder to
        review, then verify or flag here.
      </p>
    );
  }
  if (!diff.lines) {
    return (
      <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
        File too large to diff inline — open it from the folder to review.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      {!diff.hasPrevious && (
        <p className="border-b border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400">
          No earlier version captured (new file, or changed before diff tracking began) — showing
          the full current content.
        </p>
      )}
      <pre className="max-h-96 overflow-y-auto p-0 font-mono text-[12px] leading-relaxed">
        {diff.lines.map((l, idx) => (
          <div key={idx} className={`px-3 ${LINE_CLASS[l.t]}`}>
            <span className="select-none pr-2 text-zinc-300">
              {l.t === "add" ? "+" : l.t === "del" ? "−" : " "}
            </span>
            {l.s || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
