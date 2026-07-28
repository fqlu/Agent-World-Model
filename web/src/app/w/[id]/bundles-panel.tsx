"use client";

import { useCallback, useEffect, useState } from "react";
import LocalTime from "@/app/local-time";

type Bundle = {
  id: number;
  name: string;
  slug: string;
  scopeKind: "workspace" | "scope" | "group";
  scopeRef: string | null;
  path: string;
  stats: { concepts: number; entities: number; scopes: number; groups: number; references?: number } | null;
  includeContent: boolean;
  createdAt: string;
  updatedAt: string;
};
type Options = { scopes: string[]; groups: { slug: string; title: string }[] };

function scopeLabel(b: Bundle): string {
  if (b.scopeKind === "workspace") return "whole workspace";
  if (b.scopeKind === "scope") return `client: ${b.scopeRef?.split("/").pop() ?? b.scopeRef}`;
  return `group: ${b.scopeRef}`;
}

export default function BundlesPanel({ wsId }: { wsId: number }) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [options, setOptions] = useState<Options>({ scopes: [], groups: [] });
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | "create" | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [sel, setSel] = useState("workspace"); // "workspace" | "scope:<path>" | "group:<slug>"
  const [withContent, setWithContent] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${wsId}/bundles?options=1`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load bundles");
      setBundles(body.bundles);
      setOptions(body.options ?? { scopes: [], groups: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [wsId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    setBusyId("create");
    setError(null);
    try {
      const [kind, ...rest] = sel.split(":");
      const scopeRef = rest.length ? rest.join(":") : null;
      const res = await fetch(`/api/workspaces/${wsId}/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopeKind: kind, scopeRef, includeContent: kind !== "workspace" && withContent }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Create failed");
      setName("");
      setSel("workspace");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [wsId, name, sel, load]);

  const refresh = useCallback(
    async (id: number) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/workspaces/${wsId}/bundles/${id}`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Refresh failed");
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [wsId, load],
  );

  const remove = useCallback(
    async (id: number) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/workspaces/${wsId}/bundles/${id}`, { method: "DELETE" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Delete failed");
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [wsId, load],
  );

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-zinc-900">Bundles · Open Knowledge Format</h2>
        <span className="badge bg-indigo-100 text-indigo-700">OKF</span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-primary ml-auto"
          disabled={busyId !== null}
        >
          {showForm ? "Cancel" : "New bundle"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        The workspace is the workshop; a bundle is the product — a named OKF projection any
        OKF-aware agent can read. Building one is <strong>deterministic, not AI</strong>: the app
        compiles it from your world model by rule — pick a slice (whole workspace, one client, or
        one context group) and it mechanically includes that slice&apos;s scopes, the entities
        related to them, the groups touching them, and the journal sections about them. Click a
        bundle&apos;s name to browse exactly what&apos;s inside. Bundles live in the app&apos;s
        data dir; your workspace files are untouched.
      </p>

      {showForm && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <input
            className="input w-56"
            placeholder="Bundle name (e.g. Medibank)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select className="input w-72" value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="workspace">Whole workspace</option>
            {options.scopes.length > 0 && (
              <optgroup label="Client / entity slice">
                {options.scopes.map((s) => (
                  <option key={s} value={`scope:${s}`}>
                    {s.split("/").pop()}
                  </option>
                ))}
              </optgroup>
            )}
            {options.groups.length > 0 && (
              <optgroup label="Context group slice">
                {options.groups.map((g) => (
                  <option key={g.slug} value={`group:${g.slug}`}>
                    {g.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {sel !== "workspace" && (
            <label className="flex items-center gap-1.5 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={withContent}
                onChange={(e) => setWithContent(e.target.checked)}
              />
              include content files (specs, docs — not WIP notes or drafts)
            </label>
          )}
          <button
            onClick={create}
            disabled={busyId === "create" || !name.trim()}
            className="btn-primary"
          >
            {busyId === "create" ? "Building…" : "Build bundle"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {bundles.length > 0 && (
        <ul className="mt-3 space-y-2">
          {bundles.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              <a
                href={`/w/${wsId}/bundles/${b.id}`}
                className="font-medium text-indigo-700 hover:underline"
              >
                {b.name}
              </a>
              <span className="badge bg-zinc-100 text-zinc-600">{scopeLabel(b)}</span>
              {b.includeContent && <span className="badge bg-emerald-100 text-emerald-700">with content</span>}
              {b.stats && (
                <span className="text-xs text-zinc-500">
                  {b.stats.concepts} concepts · {b.stats.entities} entities · {b.stats.scopes} scopes
                  {b.stats.groups ? ` · ${b.stats.groups} groups` : ""}
                  {b.stats.references ? ` · ${b.stats.references} reference docs` : ""}
                </span>
              )}
              <span className="text-xs text-zinc-400">built <LocalTime utc={b.updatedAt} /></span>
              <span className="ml-auto flex items-center gap-2">
                <a
                  href={`/api/workspaces/${wsId}/bundles/${b.id}/viz`}
                  target="_blank"
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Graph
                </a>
                <button
                  onClick={() => refresh(b.id)}
                  disabled={busyId !== null}
                  className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                >
                  {busyId === b.id ? "Working…" : "Rebuild"}
                </button>
                <button
                  onClick={() => remove(b.id)}
                  disabled={busyId !== null}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </span>
              <div className="w-full break-all font-mono text-[11px] text-zinc-400">{b.path}</div>
            </li>
          ))}
        </ul>
      )}
      {bundles.length === 0 && !showForm && (
        <p className="mt-3 text-sm text-zinc-400">No bundles yet — build one.</p>
      )}
    </div>
  );
}
