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
type CheckType = "none" | "filename_prefix" | "forbidden_substring";
type HouseRule = {
  text: string;
  severity?: EffSeverity;
  check?:
    | { type: "filename_prefix"; allowed: string[]; applies_to?: string }
    | { type: "forbidden_substring"; values: string[]; applies_to?: string };
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
  houseRules: initialHouseRules,
}: {
  wsId: number;
  rules: RuleView[];
  conventions: Conventions;
  houseRules: HouseRule[];
}) {
  const [sev, setSev] = useState<Record<string, EffSeverity>>(
    Object.fromEntries(rules.map((r) => [r.id, r.severity])),
  );
  const [predicates, setPredicates] = useState(conventions.relationshipPredicates.join(", "));
  const [wipSections, setWipSections] = useState(conventions.wipRequiredSections.join(", "));
  const [houseRules, setHouseRules] = useState<HouseRule[]>(initialHouseRules);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const checkTypeOf = (h: HouseRule): CheckType => h.check?.type ?? "none";
  const setHR = (i: number, patch: Partial<HouseRule>) =>
    setHouseRules((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const addHR = () =>
    setHouseRules((hs) => [...hs, { text: "", severity: "warn" }]);
  const removeHR = (i: number) => setHouseRules((hs) => hs.filter((_, j) => j !== i));
  const setCheckType = (i: number, t: CheckType) =>
    setHR(i, {
      check:
        t === "none"
          ? undefined
          : t === "filename_prefix"
            ? { type: "filename_prefix", allowed: [], applies_to: "" }
            : { type: "forbidden_substring", values: [], applies_to: "" },
    });

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
          houseRules: houseRules
            .filter((h) => h.text.trim())
            .map((h) => ({
              text: h.text.trim(),
              severity: h.severity ?? "warn",
              check:
                h.check?.type === "filename_prefix"
                  ? { type: "filename_prefix", allowed: parseList((h.check.allowed ?? []).join(",")), applies_to: h.check.applies_to ?? "" }
                  : h.check?.type === "forbidden_substring"
                    ? { type: "forbidden_substring", values: parseList((h.check.values ?? []).join(",")), applies_to: h.check.applies_to ?? "" }
                    : undefined,
            })),
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
  }, [wsId, rules, sev, defaults, predicates, wipSections, houseRules]);

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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">House rules</h2>
          <button onClick={addHR} className="btn-secondary px-3 py-1 text-xs">
            + Add house rule
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Write a rule in plain language — it goes into <code className="font-mono">AGENTS.md</code>{" "}
          so agents follow it. Optionally attach a check so the audit also flags violations.
        </p>
        {houseRules.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">None yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {houseRules.map((h, i) => {
              const ct = checkTypeOf(h);
              return (
                <li key={i} className="card space-y-2 p-3">
                  <div className="flex items-start gap-2">
                    <textarea
                      value={h.text}
                      onChange={(e) => setHR(i, { text: e.target.value })}
                      rows={2}
                      placeholder="e.g. Files use [DRAFT] until finalized, then [INT] internal / [EXT] external."
                      className="input flex-1 text-sm"
                    />
                    <button
                      onClick={() => removeHR(i)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-zinc-500">Audit check:</span>
                    <select
                      value={ct}
                      onChange={(e) => setCheckType(i, e.target.value as CheckType)}
                      className="rounded border border-zinc-300 bg-white px-1.5 py-1"
                    >
                      <option value="none">none (agent-followed only)</option>
                      <option value="filename_prefix">filename prefix</option>
                      <option value="forbidden_substring">forbidden substring</option>
                    </select>
                    {ct !== "none" && (
                      <>
                        <select
                          value={h.severity ?? "warn"}
                          onChange={(e) => setHR(i, { severity: e.target.value as EffSeverity })}
                          className="rounded border border-zinc-300 bg-white px-1.5 py-1"
                        >
                          <option value="error">error</option>
                          <option value="warn">warn</option>
                          <option value="info">info</option>
                        </select>
                        <input
                          value={h.check?.applies_to ?? ""}
                          onChange={(e) =>
                            setHR(i, { check: { ...h.check!, applies_to: e.target.value } })
                          }
                          placeholder="applies to (folder path; blank = whole workspace)"
                          className="flex-1 rounded border border-zinc-300 bg-white px-1.5 py-1 font-mono"
                        />
                      </>
                    )}
                  </div>
                  {ct === "filename_prefix" && (
                    <input
                      value={(h.check as { allowed: string[] }).allowed.join(", ")}
                      onChange={(e) =>
                        setHR(i, {
                          check: { type: "filename_prefix", allowed: e.target.value.split(",").map((x) => x.trim()).filter(Boolean), applies_to: h.check?.applies_to ?? "" },
                        })
                      }
                      placeholder="allowed prefixes, comma-separated  e.g.  [DRAFT], [INT], [EXT]"
                      className="input font-mono text-xs"
                    />
                  )}
                  {ct === "forbidden_substring" && (
                    <input
                      value={(h.check as { values: string[] }).values.join(", ")}
                      onChange={(e) =>
                        setHR(i, {
                          check: { type: "forbidden_substring", values: e.target.value.split(",").map((x) => x.trim()).filter(Boolean), applies_to: h.check?.applies_to ?? "" },
                        })
                      }
                      placeholder="forbidden substrings, comma-separated  e.g.  final_final, copy"
                      className="input font-mono text-xs"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
