"use client";

import { useCallback, useMemo, useState } from "react";

type EntityKind = "person" | "system" | "concept";
type Attr = Record<string, string>;
type Relation = { predicate: string; target: string; note?: string };
type Entity = {
  slug: string;
  name: string;
  kind: EntityKind;
  aliases: string[];
  source: "derived" | "asserted";
  confirmed?: string;
  attributes: Attr;
  relations: Relation[];
  notes: string;
};
type ScopeOpt = { path: string; name: string };
type Candidate = {
  name: string;
  kind: EntityKind;
  attributes: Attr;
  foundIn: string[];
  existing: boolean;
};

const KIND_LABEL: Record<EntityKind, string> = {
  person: "People",
  system: "Systems",
  concept: "Concepts",
};
const KIND_BADGE: Record<EntityKind, string> = {
  person: "bg-emerald-100 text-emerald-700",
  system: "bg-sky-100 text-sky-700",
  concept: "bg-violet-100 text-violet-700",
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "entity";
}

function attrLine(a: Attr): string {
  return Object.entries(a)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

export default function EntitiesEditor({
  wsId,
  initial,
  predicates,
  scopes,
}: {
  wsId: number;
  initial: Entity[];
  predicates: string[];
  scopes: ScopeOpt[];
}) {
  const [entities, setEntities] = useState<Entity[]>(initial);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<EntityKind>("person");

  const grouped = useMemo(() => {
    const g: Record<EntityKind, Entity[]> = { person: [], system: [], concept: [] };
    for (const e of entities) g[e.kind].push(e);
    return g;
  }, [entities]);

  const extract = useCallback(async () => {
    setBusy("extract");
    setStatus(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/entities/extract`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Extraction failed");
      const fresh: Candidate[] = body.candidates.filter((c: Candidate) => !c.existing);
      setCandidates(fresh);
      setPicked(new Set(fresh.map((_: Candidate, i: number) => i)));
      setStatus(
        `Found ${body.candidates.length} candidate(s) in overviews — ${fresh.length} new.`,
      );
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [wsId]);

  const acceptPicked = useCallback(() => {
    if (!candidates) return;
    const additions: Entity[] = [];
    candidates.forEach((c, i) => {
      if (!picked.has(i)) return;
      if (entities.some((e) => e.name.toLowerCase() === c.name.toLowerCase() && e.kind === c.kind))
        return;
      additions.push({
        slug: "",
        name: c.name,
        kind: c.kind,
        aliases: [],
        source: "derived",
        attributes: c.attributes,
        relations: [],
        notes: `Derived from overviews (${c.foundIn.length} scope${c.foundIn.length === 1 ? "" : "s"}).`,
      });
    });
    setEntities((es) => [...es, ...additions]);
    setCandidates(null);
    setPicked(new Set());
    setStatus(`Added ${additions.length} entit${additions.length === 1 ? "y" : "ies"} — review, then Save.`);
  }, [candidates, picked, entities]);

  const addManual = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    setEntities((es) => [
      ...es,
      { slug: "", name, kind: newKind, aliases: [], source: "asserted", attributes: {}, relations: [], notes: "" },
    ]);
    setNewName("");
  }, [newName, newKind]);

  const update = useCallback((idx: number, patch: Partial<Entity>) => {
    setEntities((es) => es.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }, []);

  const remove = useCallback((idx: number) => {
    setEntities((es) => es.filter((_, i) => i !== idx));
  }, []);

  const addRelation = useCallback(
    (idx: number) => {
      setEntities((es) =>
        es.map((e, i) =>
          i === idx
            ? { ...e, relations: [...e.relations, { predicate: predicates[0] ?? "related-to", target: "" }] }
            : e,
        ),
      );
    },
    [predicates],
  );

  const updateRelation = useCallback((idx: number, rIdx: number, patch: Partial<Relation>) => {
    setEntities((es) =>
      es.map((e, i) =>
        i === idx
          ? { ...e, relations: e.relations.map((r, j) => (j === rIdx ? { ...r, ...patch } : r)) }
          : e,
      ),
    );
  }, []);

  const removeRelation = useCallback((idx: number, rIdx: number) => {
    setEntities((es) =>
      es.map((e, i) => (i === idx ? { ...e, relations: e.relations.filter((_, j) => j !== rIdx) } : e)),
    );
  }, []);

  // target options: other entities (by name) + promoted scopes (by path)
  const targetOptions = useMemo(() => {
    const ents = entities
      .filter((e) => e.name.trim())
      .map((e) => ({ value: e.slug || slugify(e.name), label: `${e.name} (entity)` }));
    const scs = scopes.map((s) => ({ value: s.path, label: `${s.name} (scope)` }));
    return [...ents, ...scs];
  }, [entities, scopes]);


  const save = useCallback(async () => {
    setBusy("save");
    setStatus(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/entities`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entities }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setStatus(
        `Saved ${body.written.length} entit${body.written.length === 1 ? "y" : "ies"}` +
          (body.archived.length ? `, archived ${body.archived.length}` : "") +
          ".",
      );
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [wsId, entities]);

  // index entities by identity for stable edit handlers
  const indexOf = (e: Entity) => entities.indexOf(e);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={extract} disabled={!!busy} className="btn-secondary">
          {busy === "extract" ? "Extracting…" : "Extract from overviews"}
        </button>
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addManual()}
            placeholder="Add entity by name…"
            className="input mt-0 w-56"
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as EntityKind)}
            className="input mt-0 w-32"
          >
            <option value="person">person</option>
            <option value="system">system</option>
            <option value="concept">concept</option>
          </select>
          <button onClick={addManual} className="btn-secondary px-3">
            Add
          </button>
        </div>
        <button onClick={save} disabled={!!busy} className="btn-primary ml-auto">
          {busy === "save" ? "Saving…" : "Save to workspace"}
        </button>
      </div>
      {status && (
        <p className={`text-xs ${status.startsWith("Error") ? "text-red-600" : "text-green-700"}`}>
          {status}
        </p>
      )}

      {/* Extraction candidates */}
      {candidates && (
        <div className="card border-indigo-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">
              Extracted candidates ({candidates.length})
            </h2>
            <div className="flex gap-2">
              <button onClick={acceptPicked} className="btn-primary px-3 py-1.5 text-xs">
                Add {picked.size} selected
              </button>
              <button
                onClick={() => setCandidates(null)}
                className="text-xs text-zinc-500 hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
          {candidates.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">
              No new candidates — everything found is already an entity.
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
              {candidates.map((c, i) => (
                <li key={i}>
                  <label className="flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-50">
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      onChange={(e) => {
                        setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(i);
                          else n.delete(i);
                          return n;
                        });
                      }}
                      className="mt-1 h-4 w-4 accent-indigo-600"
                    />
                    <span>
                      <span className={`badge ${KIND_BADGE[c.kind]}`}>{c.kind}</span>{" "}
                      <span className="font-medium text-zinc-900">{c.name}</span>
                      {attrLine(c.attributes) && (
                        <span className="text-zinc-500"> — {attrLine(c.attributes)}</span>
                      )}
                      <span className="text-xs text-zinc-400">
                        {" "}
                        · seen in {c.foundIn.length} scope{c.foundIn.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Current entities, grouped by kind */}
      {entities.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500">
          No entities yet. Extract from your overviews or add one above.
        </p>
      ) : (
        (["person", "system", "concept"] as EntityKind[]).map((kind) =>
          grouped[kind].length ? (
            <section key={kind}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <span className={`badge ${KIND_BADGE[kind]}`}>{KIND_LABEL[kind]}</span>
                <span className="font-normal text-zinc-500">{grouped[kind].length}</span>
              </h2>
              <ul className="mt-2 space-y-2">
                {grouped[kind].map((e) => {
                  const idx = indexOf(e);
                  return (
                    <li key={`${e.kind}:${e.name}`} className="card p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              value={e.name}
                              onChange={(ev) => update(idx, { name: ev.target.value })}
                              className="input mt-0 flex-1 font-medium"
                            />
                            <span
                              className={`badge ${e.source === "derived" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600"}`}
                              title={e.source === "derived" ? "Extracted — confirm to assert" : "Human-asserted"}
                            >
                              {e.source}
                            </span>
                          </div>
                          {Object.keys(e.attributes).length > 0 && (
                            <p className="text-xs text-zinc-500">{attrLine(e.attributes)}</p>
                          )}
                          <textarea
                            value={e.notes}
                            onChange={(ev) => update(idx, { notes: ev.target.value })}
                            placeholder="Notes (what this is, why it matters)…"
                            rows={2}
                            className="input text-xs"
                          />
                          {/* Relationships */}
                          <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-zinc-600">
                                Relationships
                              </span>
                              <button
                                onClick={() => addRelation(idx)}
                                className="text-xs font-medium text-indigo-600 hover:underline"
                              >
                                + add edge
                              </button>
                            </div>
                            {e.relations.length === 0 ? (
                              <p className="mt-1 text-xs text-zinc-400">
                                No edges. Connect {e.name || "this"} to another entity or a scope.
                              </p>
                            ) : (
                              <ul className="mt-1 space-y-1">
                                {e.relations.map((r, rIdx) => (
                                  <li key={rIdx} className="flex flex-wrap items-center gap-1">
                                    <span className="text-xs text-zinc-400">{e.name || "this"}</span>
                                    <select
                                      value={r.predicate}
                                      onChange={(ev) =>
                                        updateRelation(idx, rIdx, { predicate: ev.target.value })
                                      }
                                      className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs"
                                    >
                                      {predicates.map((p) => (
                                        <option key={p} value={p}>
                                          {p}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      value={r.target}
                                      onChange={(ev) =>
                                        updateRelation(idx, rIdx, { target: ev.target.value })
                                      }
                                      className="max-w-48 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs"
                                    >
                                      <option value="">— target —</option>
                                      {targetOptions.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label}
                                        </option>
                                      ))}
                                      {r.target && !targetOptions.some((o) => o.value === r.target) && (
                                        <option value={r.target}>{r.target} (unresolved)</option>
                                      )}
                                    </select>
                                    <input
                                      value={r.note ?? ""}
                                      onChange={(ev) =>
                                        updateRelation(idx, rIdx, { note: ev.target.value })
                                      }
                                      placeholder="note"
                                      className="w-28 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs"
                                    />
                                    <button
                                      onClick={() => removeRelation(idx, rIdx)}
                                      className="text-xs text-red-500 hover:underline"
                                    >
                                      ×
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {e.source === "derived" && (
                            <button
                              onClick={() => update(idx, { source: "asserted" })}
                              className="text-xs font-medium text-indigo-600 hover:underline"
                              title="Mark as human-confirmed"
                            >
                              Confirm
                            </button>
                          )}
                          <button
                            onClick={() => remove(idx)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null,
        )
      )}
    </div>
  );
}
