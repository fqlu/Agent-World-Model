"use client";

import { useState, useTransition } from "react";
import type { FormState } from "../actions";

export default function DeleteProfile({
  action,
  name,
  usedBy,
}: {
  action: () => Promise<FormState>;
  name: string;
  usedBy: string[];
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const blocked = usedBy.length > 0;

  return (
    <div className="card max-w-3xl border-red-200 p-5">
      <h2 className="text-sm font-semibold text-red-700">Delete profile</h2>
      <p className="mt-1 text-xs text-zinc-600">
        {blocked ? (
          <>
            <strong>{name}</strong> is used by {usedBy.join(", ")}. Remove{" "}
            {usedBy.length === 1 ? "that workspace" : "those workspaces"} from the app first (your
            folders aren&apos;t touched), then delete the profile.
          </>
        ) : (
          <>
            Removes <strong>{name}</strong> from the profile picker. Its folder moves to{" "}
            <span className="font-mono">profiles/_archive/</span> rather than being erased, so you
            can restore it by moving it back.
          </>
        )}
      </p>
      {!armed ? (
        <button
          onClick={() => setArmed(true)}
          disabled={blocked}
          className="btn-secondary mt-3 border-red-300 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Delete profile
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() =>
              start(async () => {
                const res = await action();
                if (res?.error) {
                  setError(res.error);
                  setArmed(false);
                }
              })
            }
            disabled={pending}
            className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            {pending ? "Deleting…" : `Yes, delete ${name}`}
          </button>
          <button onClick={() => setArmed(false)} className="text-sm text-zinc-500 hover:text-zinc-800">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
