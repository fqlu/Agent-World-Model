"use client";

import { useState, useTransition } from "react";

export default function RemoveWorkspace({
  action,
  name,
}: {
  action: () => Promise<void>;
  name: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="card border-red-200 p-5">
      <h2 className="text-sm font-semibold text-red-700">Remove workspace</h2>
      <p className="mt-1 max-w-2xl text-xs text-zinc-600">
        Removes <strong>{name}</strong> from Agent World Model only. Your Drive folder and every
        file in it are <strong>untouched</strong> — this just deletes the app&apos;s reference,
        its audit/proposal history, and its sync state. You can re-add the folder anytime.
      </p>
      {!armed ? (
        <button
          onClick={() => setArmed(true)}
          className="btn-secondary mt-3 border-red-300 text-red-700 hover:bg-red-50"
        >
          Remove workspace
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => start(() => action())}
            disabled={pending}
            className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            {pending ? "Removing…" : "Yes, remove it"}
          </button>
          <button onClick={() => setArmed(false)} className="text-sm text-zinc-500 hover:text-zinc-800">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
