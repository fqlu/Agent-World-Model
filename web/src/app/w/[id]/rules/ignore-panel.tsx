"use client";

import { useState } from "react";

export default function IgnorePanel({ wsId, initial }: { wsId: number; initial: string[] }) {
  const [paths, setPaths] = useState<string[]>(initial);
  const [saved, setSaved] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = paths.join("\n") !== saved.join("\n");

  function add() {
    const p = draft.trim().replace(/^\/+|\/+$/g, "");
    if (!p) return;
    if (!paths.includes(p)) setPaths([...paths, p]);
    setDraft("");
    setStatus(null);
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/ignore`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignore: paths }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setPaths(body.ignore);
      setSaved(body.ignore);
      setStatus({
        ok: true,
        text: "Saved to _Workspace.yaml; AGENTS.md regenerated. Re-run the audit to see the effect.",
      });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card max-w-3xl space-y-3 p-5">
      <div>
        <h2 className="font-semibold text-zinc-900">Ignored paths</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Folders or files outside the protocol — e.g. a code repo or a tool&apos;s output folder.
          Everything below an ignored path is skipped by the audit, Adopt, the index, the world
          model and exports. Stored under <code className="font-mono">ignore:</code> in this
          workspace&apos;s <code className="font-mono">_Workspace.yaml</code>, so it travels with
          the workspace.
        </p>
      </div>

      {paths.length ? (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {paths.map((p) => (
            <li key={p} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="break-all font-mono text-xs text-zinc-800">{p}/</span>
              <button
                type="button"
                onClick={() => {
                  setPaths(paths.filter((x) => x !== p));
                  setStatus(null);
                }}
                className="shrink-0 text-xs text-zinc-500 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-400">Nothing ignored — the whole workspace is audited.</p>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Internal/Solutions/Some-Repo"
          className="input mt-0 font-mono text-xs"
        />
        <button type="button" onClick={add} className="btn-secondary shrink-0">
          Add
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Path relative to the workspace root. Declared mounts (areas, Journal, Templates…) can&apos;t
        be ignored — ignore folders inside them instead.
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save ignore list"}
        </button>
        {status && (
          <p className={`text-xs ${status.ok ? "text-green-700" : "text-red-600"}`}>{status.text}</p>
        )}
      </div>
    </section>
  );
}
