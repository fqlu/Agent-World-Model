"use client";

import { useActionState, startTransition, type FormEvent } from "react";
import { createProfileAction, type FormState } from "./actions";

export default function NewProfileForm({ profiles }: { profiles: string[] }) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(createProfileAction, {});

  // A transition rather than <form action>, so a rejected name doesn't reset the form.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  return (
    <form onSubmit={onSubmit} className="card max-w-3xl space-y-4 p-6">
      <div>
        <h2 className="font-semibold text-zinc-900">New profile</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Start blank or copy an existing profile (settings and template overrides). You can change
          everything on the next page.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-zinc-700">
          Name
          <input
            name="name"
            required
            pattern="[a-z0-9][a-z0-9\-]{0,39}"
            placeholder="vivanti"
            className="input font-mono"
            autoComplete="off"
          />
          <span className="mt-1 block text-xs font-normal text-zinc-500">
            Lowercase letters, digits, hyphens. Can&apos;t be renamed later — workspaces refer to
            it by name.
          </span>
        </label>
        <label className="block text-sm font-medium text-zinc-700">
          Start from
          <select name="from" defaultValue="" className="input">
            <option value="">Blank (protocol baseline)</option>
            {profiles.map((p) => (
              <option key={p} value={p}>
                Copy of {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium text-zinc-700">
        Description
        <input
          name="description"
          placeholder="One line shown in the profile picker"
          className="input"
        />
      </label>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create profile"}
      </button>
    </form>
  );
}
