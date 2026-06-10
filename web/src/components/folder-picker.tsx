"use client";

import { useCallback, useEffect, useState } from "react";

type FsResp = {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string; hidden: boolean }[];
};

// Browses the server's filesystem (confined to $HOME) and fills a form field
// with the chosen absolute path. Manual editing stays possible.
export default function FolderPicker({ name }: { name: string }) {
  const [cur, setCur] = useState<FsResp | null>(null);
  const [value, setValue] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p?: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/fs${p ? `?path=${encodeURIComponent(p)}` : ""}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not browse");
      setCur(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirs = cur?.dirs.filter((d) => showHidden || !d.hidden) ?? [];
  const hiddenCount = (cur?.dirs.length ?? 0) - (cur?.dirs.filter((d) => !d.hidden).length ?? 0);

  return (
    <div className="space-y-2">
      <input
        name={name}
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Pick a folder below (or type a path)"
        className="input font-mono"
      />
      <div className="rounded-lg border border-zinc-200">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2">
          <span className="truncate font-mono text-xs text-zinc-500">{cur?.path ?? "…"}</span>
          <button
            type="button"
            onClick={() => cur && setValue(cur.path)}
            className="shrink-0 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            Use this folder
          </button>
        </div>
        <ul className="max-h-48 overflow-y-auto text-sm">
          {cur?.parent && (
            <li>
              <button
                type="button"
                onClick={() => load(cur.parent!)}
                className="w-full px-3 py-1.5 text-left text-zinc-500 hover:bg-zinc-50"
              >
                ← ..
              </button>
            </li>
          )}
          {dirs.map((d) => (
            <li key={d.path}>
              <button
                type="button"
                onClick={() => load(d.path)}
                className={`w-full truncate px-3 py-1.5 text-left hover:bg-zinc-50 ${d.hidden ? "text-zinc-400" : "text-zinc-800"}`}
              >
                📁 {d.name}
              </button>
            </li>
          ))}
          {dirs.length === 0 && (
            <li className="px-3 py-2 text-xs text-zinc-400">No subfolders.</li>
          )}
        </ul>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden((s) => !s)}
            className="w-full border-t border-zinc-100 px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-50"
          >
            {showHidden ? "Hide" : "Show"} {hiddenCount} hidden folder(s) — needed for Google
            Drive shortcut paths
          </button>
        )}
        {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
