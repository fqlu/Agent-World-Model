"use client";

import { useCallback, useMemo, useState } from "react";

type Severity = "error" | "warn" | "info";
type EffSeverity = Severity | "off";
type RuleView = {
  id: string;
  summary: string;
  group: string;
  defaultSeverity: Severity;
  severity: EffSeverity;
  overridden: boolean;
};
type Conventions = {
  relationshipPredicates: string[];
  wipRequiredSections: string[];
  pipeSeparator: string;
  entityKinds: string[];
};

const SEV_BADGE: Record<EffSeverity, string> = {
  error: "bg-red-100 text-red-700",
  warn: "bg-amber-100 text-amber-700",
  info: "bg-zinc-100 text-zinc-600",
  off: "bg-zinc-100 text-zinc-400",
};

export default function RulesEditor({
  wsId,
  rules,
  conventions,
}: {
  wsId: number;
  rules: RuleView[];
  conventions: Conventions;
}) {
  const [sev, setSev] = useState<Record<string, EffSeverity>>(
    Object.fromEntries(rules.map((r) => [r.id, r.severity])),
  );
  const [predicates, setPredicates] = useState(conventions.relationshipPredicates.join(", "));
  const [wipSections, setWipSections] = useState(conventions.wipRequiredSections.join(", "));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const defaults = useMemo(
    () => Object.fromEntries(rules.map((r) => [r.id, r.defaultSeverity])),
    [rules],
  );

  const groups = useMemo(() => {
    const g = new Map<string, RuleView[]>();
    for (const r of rules) {
      if (!g.has(r.group)) g.set(r.group, []);
      g.get(r.group)!.push(r);
    }
    return [...g.entries()];
  }, [rules]);

  const dirtyCount = useMemo(
    () => rules.filter((r) => sev[r.id] !== r.severity).length,
    [rules, sev],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    // only send overrides that differ from the spec default
    const overrides: Record<string, string> = {};
    for (const r of rules) if (sev[r.id] !== defaults[r.id]) overrides[r.id] = sev[r.id];
    const parseList = (s: string) =>
      s.split(",").map((x) => x.trim()).filter(Boolean);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/rules`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overrides,
          conventions: {
            relationship_predicates: parseList(predicates),
            wip_required_sections: parseList(wipSections),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setStatus(`Saved. ${Object.keys(overrides).length} override(s) active; AGENTS.md regenerated.`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [wsId, rules, sev, defaults, predicates, wipSections]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-zinc-500">
          {rules.length} rules · {rules.filter((r) => sev[r.id] === "off").length} disabled ·{" "}
          {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
        </span>
        <button onClick={save} disabled={saving} className="btn-primary ml-auto">
          {saving ? "Saving…" : "Save rules"}
        </button>
      </div>
      {status && (
        <p className={`text-xs ${status.startsWith("Error") ? "text-red-600" : "text-green-700"}`}>
          {status}
        </p>
      )}

      {groups.map(([group, rs]) => (
        <section key={group}>
          <h2 className="text-sm font-semibold text-zinc-900">{group}</h2>
          <ul className="mt-2 space-y-1.5">
            {rs.map((r) => (
              <li key={r.id} className="card flex items-center gap-3 px-3 py-2">
                <span className="badge bg-zinc-100 font-mono text-zinc-600">{r.id}</span>
                <span className="flex-1 text-sm text-zinc-700">{r.summary}</span>
                {sev[r.id] !== r.defaultSeverity && (
                  <span className="text-[10px] uppercase text-indigo-600">overridden</span>
                )}
                <span className={`badge ${SEV_BADGE[sev[r.id]]}`}>{sev[r.id]}</span>
                <select
                  value={sev[r.id]}
                  onChange={(e) =>
                    setSev((s) => ({ ...s, [r.id]: e.target.value as EffSeverity }))
                  }
                  className="rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs"
                >
                  <option value="error">error</option>
                  <option value="warn">warn</option>
                  <option value="info">info</option>
                  <option value="off">off</option>
                </select>
                <span className="w-24 text-right text-[10px] text-zinc-400">
                  default: {r.defaultSeverity}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Tunable conventions</h2>
        <div className="mt-2 space-y-3">
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Relationship predicates</span>
            <span className="text-xs text-zinc-500"> — the vocabulary RL-001 enforces (comma-separated)</span>
            <input
              value={predicates}
              onChange={(e) => setPredicates(e.target.value)}
              className="input font-mono text-xs"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">WIP note required sections</span>
            <span className="text-xs text-zinc-500"> — what CL-002 looks for (comma-separated)</span>
            <input
              value={wipSections}
              onChange={(e) => setWipSections(e.target.value)}
              className="input font-mono text-xs"
            />
          </label>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
            Display-only (spec-defined, not per-workspace editable yet):{" "}
            <span className="font-mono">pipe separator “{conventions.pipeSeparator}”</span> ·{" "}
            <span className="font-mono">entity kinds: {conventions.entityKinds.join(", ")}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
