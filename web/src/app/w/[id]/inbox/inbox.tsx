"use client";

import { useCallback, useEffect, useState } from "react";
import type { Decision, Inbox, InboxItem, ProposalOp } from "@/lib/proposals";

type DecideBody = {
  id: string;
  decision: Decision["decision"];
  option?: string;
  answer?: string;
  reason?: string;
  defer_until?: string;
};

type Lens = "triage" | "hygiene";

const RESULT_BADGE: Record<string, string> = {
  applied: "badge bg-green-100 text-green-700",
  stale: "badge bg-amber-100 text-amber-700",
  failed: "badge bg-red-100 text-red-700",
  "pending-agent": "badge bg-indigo-100 text-indigo-700",
};

function fmtTime(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

function inAWeek(): string {
  const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function DreamingInbox({ wsId }: { wsId: number }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Lens>("triage");
  const [busy, setBusy] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/inbox`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load the inbox");
      setInbox(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [wsId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (body: DecideBody) => {
      setBusy(body.id);
      setItemErrors((m) => ({ ...m, [body.id]: "" }));
      setLastResult(null);
      try {
        const res = await fetch(`/api/workspaces/${wsId}/inbox/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error ?? "Decision failed");
        const d = out as Decision;
        const r = d.result ? ` → ${d.result.status}${d.result.detail ? `: ${d.result.detail}` : ""}` : "";
        setLastResult(`${d.id}: ${d.decision}${r}`);
        await load();
      } catch (e) {
        setItemErrors((m) => ({ ...m, [body.id]: e instanceof Error ? e.message : String(e) }));
      } finally {
        setBusy(null);
      }
    },
    [wsId, load],
  );

  if (error) {
    return (
      <div className="card p-4 text-sm text-red-600">
        {error}{" "}
        <button className="ml-2 text-indigo-600 hover:underline" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }
  if (!inbox) return <div className="card p-6 text-sm text-zinc-500">Loading…</div>;

  if (!inbox.mountExists) {
    return (
      <div className="card p-6 text-sm text-zinc-600">
        <p className="font-semibold text-zinc-900">No proposals yet</p>
        <p className="mt-2">
          This workspace has no <code className="font-mono">{inbox.mount}/</code> folder. A dreaming
          agent writes its runs to{" "}
          <code className="font-mono">{inbox.mount}/dreaming/YYYY-MM-DD.proposals.json</code>; they
          show up here once the first run has written one.
        </p>
      </div>
    );
  }

  const latest = inbox.runs[0];
  const lensOf = (i: InboxItem): Lens => (i.lens === "triage" ? "triage" : "hygiene");
  const inTab = inbox.items.filter((i) => lensOf(i) === tab);
  const open = inTab.filter((i) => i.status === "open");
  const now = open.filter((i) => i.priority === "now");
  const rest = open.filter((i) => i.priority !== "now");
  const deferred = inTab.filter((i) => i.status === "deferred");
  const decided = inTab.filter((i) => i.status === "decided");
  const openCount = (l: Lens) => inbox.items.filter((i) => i.status === "open" && lensOf(i) === l).length;

  const bySection = new Map<string, InboxItem[]>();
  for (const i of rest) {
    const k = i.section ?? "other";
    bySection.set(k, [...(bySection.get(k) ?? []), i]);
  }

  const card = (i: InboxItem) => (
    <ItemCard
      key={i.id}
      item={i}
      busy={busy === i.id}
      disabled={busy !== null}
      error={itemErrors[i.id]}
      onDecide={decide}
    />
  );

  return (
    <div className="space-y-6">
      <div className="card p-4 text-sm">
        {latest ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-zinc-900">
                Last run {fmtTime(latest.run.id) || latest.date}
              </span>
              {latest.run.mode && <span className="badge bg-zinc-100 text-zinc-700">{latest.run.mode}</span>}
              {latest.run.runtime && (
                <span className="badge bg-zinc-100 text-zinc-700">{latest.run.runtime}</span>
              )}
              <span className="text-xs text-zinc-400">{latest.run.agent ?? latest.agent}</span>
            </div>
            {latest.run.summary && <p className="mt-2 text-zinc-600">{latest.run.summary}</p>}
          </>
        ) : (
          <p className="text-zinc-500">No proposals files found in {inbox.mount}/.</p>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          {inbox.counts.open} open · {inbox.counts.now} need you first · {inbox.counts.deferred} deferred ·{" "}
          {inbox.counts.decided} decided · {inbox.runs.length} run{inbox.runs.length === 1 ? "" : "s"}
        </p>
        {inbox.problems.length > 0 && (
          <details className="mt-2 text-xs text-amber-700">
            <summary className="cursor-pointer">
              {inbox.problems.length} problem{inbox.problems.length === 1 ? "" : "s"} reading proposals
            </summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {inbox.problems.map((p, n) => (
                <li key={n} className="break-words">
                  {p}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {lastResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs break-words text-green-900">
          {lastResult}
        </div>
      )}

      <div className="flex gap-1 border-b border-zinc-200">
        {(["triage", "hygiene"] as Lens[]).map((l) => (
          <button
            key={l}
            onClick={() => setTab(l)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === l ? "border-indigo-600 text-indigo-700" : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {l === "triage" ? "Triage" : "Hygiene"}{" "}
            <span className="badge bg-zinc-100 text-zinc-600">{openCount(l)}</span>
          </button>
        ))}
      </div>

      {now.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-red-700">Needs you first</h2>
          {now.map(card)}
        </section>
      )}

      {[...bySection.entries()].map(([section, items]) => (
        <section key={section} className="space-y-3">
          <h2 className="text-sm font-semibold capitalize text-zinc-700">{section.replace(/-/g, " ")}</h2>
          {items.map(card)}
        </section>
      ))}

      {open.length === 0 && (
        <div className="card p-6 text-sm text-zinc-500">Nothing open in {tab === "triage" ? "Triage" : "Hygiene"}.</div>
      )}

      {deferred.length > 0 && (
        <details className="card p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-zinc-700">Deferred ({deferred.length})</summary>
          <ul className="mt-3 space-y-2">
            {deferred.map((i) => (
              <li key={i.id} className="text-zinc-600">
                <span className="font-medium text-zinc-900">{i.title}</span>{" "}
                <span className="text-xs text-zinc-400">until {i.decision?.defer_until}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {decided.length > 0 && (
        <details className="card p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-zinc-700">Decided ({decided.length})</summary>
          <ul className="mt-3 space-y-3">
            {decided.map((i) => (
              <li key={i.id} className="border-t border-zinc-100 pt-2 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-900">{i.title}</span>
                  <span className="badge bg-zinc-100 text-zinc-700">{i.decision?.decision}</span>
                  {i.decision?.result && (
                    <span className={RESULT_BADGE[i.decision.result.status] ?? "badge bg-zinc-100"}>
                      {i.decision.result.status}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs break-words text-zinc-500">
                  {i.decision?.option && <>option: {i.decision.option} · </>}
                  {i.decision?.answer && <>answer: “{i.decision.answer}” · </>}
                  {i.decision?.reason && <>reason: “{i.decision.reason}” · </>}
                  {i.decision?.result?.detail && <>{i.decision.result.detail} · </>}
                  {fmtTime(i.decision?.at)}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ItemCard({
  item,
  busy,
  disabled,
  error,
  onDecide,
}: {
  item: InboxItem;
  busy: boolean;
  disabled: boolean;
  error?: string;
  onDecide: (b: DecideBody) => Promise<void>;
}) {
  const [mode, setMode] = useState<"none" | "reject" | "defer">("none");
  const [reason, setReason] = useState("");
  const [deferUntil, setDeferUntil] = useState(inAWeek());
  const [answer, setAnswer] = useState("");
  const isQuestion = item.kind === "question" && !!item.question;
  const prev = item.decision;

  return (
    <div className="card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-zinc-900">{item.title}</span>
        <span className="badge bg-zinc-100 text-zinc-600">{item.kind}</span>
        {item.tier && <span className="badge bg-zinc-100 text-zinc-600">{item.tier}</span>}
        {item.confidence && <span className="badge bg-zinc-100 text-zinc-600">{item.confidence}</span>}
      </div>
      <div className="mt-1 text-xs break-words text-zinc-400">
        {item.id}
        {item.scope && <> · {item.scope}</>}
      </div>
      {prev && (prev.result?.status === "stale" || prev.result?.status === "failed" || prev.decision === "defer") && (
        <div className="mt-2 text-xs text-amber-700">
          Previously {prev.decision}
          {prev.result ? ` (${prev.result.status})` : ""}
          {prev.defer_until ? ` until ${prev.defer_until}` : ""}
        </div>
      )}
      {item.why && <p className="mt-2 text-zinc-600">{item.why}</p>}

      {item.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {item.evidence.map((e, n) => (
            <li key={n} className="rounded-lg bg-zinc-50 p-2 text-xs">
              <div className="font-mono break-all text-zinc-500">{e.path}</div>
              {e.quote && <div className="mt-0.5 break-words text-zinc-700">“{e.quote}”</div>}
            </li>
          ))}
        </ul>
      )}

      {isQuestion && (
        <div className="mt-3 space-y-2">
          <p className="font-medium text-zinc-900">{item.question!.text}</p>
          <div className="flex flex-wrap gap-2">
            {item.question!.options.map((o) => (
              <button
                key={o.id}
                className="btn-secondary"
                disabled={disabled}
                title={o.ops.length ? `Applies ${o.ops.length} edit(s) straight away` : o.follow_up}
                onClick={() =>
                  void onDecide({ id: item.id, decision: "answer", option: o.id, answer: answer.trim() || undefined })
                }
              >
                {o.label}
                {o.ops.length > 0 && <span className="ml-1 text-xs text-zinc-400">({o.ops.length} edits)</span>}
              </button>
            ))}
          </div>
          {item.question!.free_text && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <textarea
                className="input"
                rows={2}
                placeholder="Or write an answer (sent with an option, or on its own)"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <button
                className="btn-primary shrink-0 sm:mt-1"
                disabled={disabled || !answer.trim()}
                onClick={() => void onDecide({ id: item.id, decision: "answer", answer: answer.trim() })}
              >
                Send answer
              </button>
            </div>
          )}
        </div>
      )}

      {!isQuestion && item.ops.length > 0 && (
        <div className="mt-3 space-y-2">
          {item.ops.map((op, n) => (
            <OpPreview key={n} op={op} />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!isQuestion && (
          <button
            className="btn-primary"
            disabled={disabled}
            onClick={() => void onDecide({ id: item.id, decision: "accept" })}
          >
            {item.ops.length ? "Accept" : "Acknowledge"}
          </button>
        )}
        {!isQuestion && (
          <button className="btn-secondary" disabled={disabled} onClick={() => setMode(mode === "reject" ? "none" : "reject")}>
            Reject
          </button>
        )}
        <button className="btn-secondary" disabled={disabled} onClick={() => setMode(mode === "defer" ? "none" : "defer")}>
          Defer
        </button>
        {busy && <span className="text-xs text-zinc-400">Working…</span>}
      </div>

      {mode === "reject" && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="input"
            placeholder="Why not? (one line — required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="btn-primary shrink-0 sm:mt-1"
            disabled={disabled || !reason.trim()}
            onClick={() => void onDecide({ id: item.id, decision: "reject", reason: reason.trim() })}
          >
            Confirm reject
          </button>
        </div>
      )}
      {mode === "defer" && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="date" className="input sm:w-48" value={deferUntil} onChange={(e) => setDeferUntil(e.target.value)} />
          <button
            className="btn-primary shrink-0 sm:mt-1"
            disabled={disabled || !deferUntil}
            onClick={() => void onDecide({ id: item.id, decision: "defer", defer_until: deferUntil })}
          >
            Defer until then
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs break-words text-red-600">{error}</p>}
    </div>
  );
}

function OpPreview({ op }: { op: ProposalOp }) {
  const head = (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-2 py-1 text-xs">
      <span className="badge bg-zinc-100 text-zinc-700">{op.action}</span>
      <span className="min-w-0 font-mono break-all text-zinc-600">{op.path}</span>
    </div>
  );
  const pre = "whitespace-pre-wrap break-words px-2 py-1 font-mono text-[12px]";
  let body: React.ReactNode;
  switch (op.action) {
    case "replace":
      body = (
        <>
          <div className={`${pre} bg-red-50 text-red-800`}>- {op.find}</div>
          <div className={`${pre} bg-green-50 text-green-900`}>+ {op.replace}</div>
        </>
      );
      break;
    case "append_line":
      body = (
        <>
          <div className={`${pre} text-zinc-500`}>
            ## {op.section.replace(/^#+\s*/, "")} ({op.position})
          </div>
          <div className={`${pre} bg-green-50 text-green-900`}>+ {op.text}</div>
        </>
      );
      break;
    case "frontmatter":
      body = (
        <div className={`${pre} bg-green-50 text-green-900`}>
          {Object.entries(op.set)
            .map(([k, v]) => `+ ${k}: ${JSON.stringify(v)}`)
            .join("\n")}
        </div>
      );
      break;
    case "move":
      body = <div className={`${pre} text-zinc-700`}>→ {op.to}</div>;
      break;
    case "create":
      body = <div className={`${pre} max-h-48 overflow-y-auto bg-green-50 text-green-900`}>{op.content}</div>;
      break;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {head}
      {body}
    </div>
  );
}
