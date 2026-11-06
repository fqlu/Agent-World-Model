"use client";

import { useCallback, useEffect, useState } from "react";

type Folder = { id: string; name: string };
type Resp = {
  mode: "browse" | "search";
  folder?: Folder;
  path: Folder[];
  folders: Folder[];
  drives: Folder[];
  marker?: "agents" | "v0.15" | null;
  error?: string;
};

// Browse a connected account's Google Drive and pick the workspace folder.
// Fills hidden form fields: root (folder ID) and account_email, and the
// workspace name input (by id) if it's still empty.
export default function DriveFolderPicker({
  accounts,
  defaultAccount,
  nameInputId,
}: {
  accounts: string[];
  defaultAccount?: string;
  nameInputId?: string;
}) {
  const [account, setAccount] = useState(defaultAccount && accounts.includes(defaultAccount) ? defaultAccount : accounts[0] ?? "");
  const [data, setData] = useState<Resp | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ folder: Folder; path: string; marker: Resp["marker"] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (params: Record<string, string>) => {
      if (!account) return;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ account, ...params });
        const res = await fetch(`/api/google/folders?${qs}`);
        const body = (await res.json()) as Resp;
        if (!res.ok) throw new Error(body.error ?? "Could not list folders");
        setData(body);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [account],
  );

  useEffect(() => {
    // initial listing for the selected account (fetch, then set state)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({});
  }, [load]);

  const open = (id: string) => {
    setSearch("");
    void load({ parent: id });
  };

  const choose = () => {
    if (!data?.folder || data.folder.id === "root") return;
    const path = data.path.map((p) => p.name).join(" / ");
    setPicked({ folder: data.folder, path, marker: data.marker ?? null });
    if (nameInputId) {
      const el = document.getElementById(nameInputId) as HTMLInputElement | null;
      if (el && !el.value) el.value = data.folder.name;
    }
  };

  if (!accounts.length) return <p className="text-xs text-zinc-500">Connect a Google account first.</p>;

  const canChoose = data?.mode === "browse" && data.folder && data.folder.id !== "root";

  return (
    <div className="space-y-2">
      <input type="hidden" name="root" value={picked?.folder.id ?? ""} required />
      <input type="hidden" name="account_email" value={account} />
      {accounts.length > 1 && (
        <select
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            setPicked(null);
          }}
          className="input"
        >
          {accounts.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      )}

      {picked ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <div className="font-medium text-emerald-900">{picked.path}</div>
          <div className="text-xs text-emerald-800">
            {picked.marker === "agents"
              ? "Has AGENTS.md — already a protocol workspace (or one to adopt)."
              : picked.marker === "v0.15"
                ? "Uses the older v0.15 layout — you'll be offered a migration."
                : "Not a protocol workspace yet — run an adoption proposal after adding it."}{" "}
            <button type="button" onClick={() => setPicked(null)} className="underline">
              Change
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (search.trim()) void load({ q: search.trim() });
                }
              }}
              placeholder="Search folders by name (Enter)…"
              className="input flex-1 py-1 text-xs"
            />
            {data?.mode === "search" && (
              <button type="button" onClick={() => open("root")} className="text-xs text-indigo-600 hover:underline">
                Back to browsing
              </button>
            )}
          </div>
          {data?.mode === "browse" && (
            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-3 py-2 text-xs">
              {data.path.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-zinc-300">/</span>}
                  <button type="button" onClick={() => open(p.id)} className="text-indigo-600 hover:underline">
                    {p.name}
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={choose}
                disabled={!canChoose}
                className="ml-auto rounded border border-indigo-200 bg-indigo-50 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                title={canChoose ? "" : "Open a folder first"}
              >
                Use this folder
              </button>
            </div>
          )}
          <ul className="max-h-56 overflow-y-auto text-sm">
            {loading && <li className="px-3 py-2 text-xs text-zinc-400">Loading…</li>}
            {error && <li className="px-3 py-2 text-xs text-red-600">{error}</li>}
            {!loading &&
              data?.drives.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => open(d.id)} className="w-full px-3 py-1.5 text-left hover:bg-zinc-50">
                    🗄 {d.name} <span className="text-xs text-zinc-400">shared drive</span>
                  </button>
                </li>
              ))}
            {!loading &&
              data?.folders.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => open(f.id)} className="w-full px-3 py-1.5 text-left hover:bg-zinc-50">
                    📁 {f.name}
                  </button>
                </li>
              ))}
            {!loading && data && !data.folders.length && !data.drives.length && (
              <li className="px-3 py-2 text-xs text-zinc-400">No folders here.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
