"use client";

import { useActionState, useState, startTransition, type FormEvent } from "react";
import type { FormState } from "../actions";

export type SettingsInitial = {
  description: string;
  areas: string;
  journal: string;
  templates: string;
  archive: string;
  proposals: string;
  entities: string;
  draftEnabled: boolean;
  workingPrefix: string;
  productionPrefixes: string;
  sharingOnlyFromProduction: boolean;
  statusFlags: string;
  rootFileAllowance: string;
  extra: string;
};

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-xs font-normal text-zinc-500">{children}</span>;
}

export default function SettingsForm({
  action,
  initial,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  initial: SettingsInitial;
}) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(action, {});
  const [draft, setDraft] = useState(initial.draftEnabled);

  // Submit via a transition instead of <form action> so React doesn't reset the
  // fields after the action — a validation error must not wipe your edits.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  return (
    <form onSubmit={onSubmit} className="card max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="font-semibold text-zinc-900">Settings</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Used when a workspace is scaffolded or adopted, and by every audit of workspaces on this
          profile.
        </p>
      </div>

      <label className="block text-sm font-medium text-zinc-700">
        Description
        <input name="description" defaultValue={initial.description} className="input" />
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-zinc-900">Starter folder layout</legend>
        <p className="text-xs text-zinc-500">
          What scaffolding creates. A starting point, not a law: each workspace declares its real
          layout in its <span className="font-mono">AGENTS.md</span> config header. Protocol folders start with “_”.
        </p>
        <label className="block text-sm font-medium text-zinc-700">
          Areas
          <input name="areas" defaultValue={initial.areas} required className="input font-mono" />
          <Hint>Comma-separated top-level folders that hold scopes, e.g. Clients, Internal.</Hint>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium text-zinc-700">
            Journal
            <input name="journal" defaultValue={initial.journal} required className="input font-mono" />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            Templates
            <input name="templates" defaultValue={initial.templates} required className="input font-mono" />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            Archive
            <input name="archive" defaultValue={initial.archive} required className="input font-mono" />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            Proposals <span className="font-normal text-zinc-400">(optional)</span>
            <input name="proposals" defaultValue={initial.proposals} className="input font-mono" />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            Entities <span className="font-normal text-zinc-400">(optional)</span>
            <input name="entities" defaultValue={initial.entities} className="input font-mono" />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-zinc-900">Draft lifecycle</legend>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            name="draft_enabled"
            checked={draft}
            onChange={(e) => setDraft(e.target.checked)}
          />
          Working files carry a prefix until promoted to production
        </label>
        {draft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-zinc-700">
              Working prefix
              <input
                name="working_prefix"
                defaultValue={initial.workingPrefix}
                className="input font-mono"
              />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              Production prefixes
              <input
                name="production_prefixes"
                defaultValue={initial.productionPrefixes}
                placeholder="[INT], [EXT]"
                className="input font-mono"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-2">
              <input
                type="checkbox"
                name="sharing_only_from_production"
                defaultChecked={initial.sharingOnlyFromProduction}
              />
              Share only from production copies
            </label>
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-zinc-700">
          Status flags
          <textarea
            name="status_flags"
            defaultValue={initial.statusFlags}
            rows={4}
            placeholder={"production: 🟢\ndraft: 🟠"}
            className="input font-mono"
          />
          <Hint>One per line, as label: marker.</Hint>
        </label>
        <label className="block text-sm font-medium text-zinc-700">
          Extra root files allowed
          <input
            name="root_file_allowance"
            defaultValue={initial.rootFileAllowance}
            placeholder="CLAUDE.md"
            className="input font-mono"
          />
          <Hint>Comma-separated. These won&apos;t be flagged by the audit (ST-004).</Hint>
        </label>
      </div>

      <label className="block text-sm font-medium text-zinc-700">
        Additional settings <span className="font-normal text-zinc-400">(YAML, optional)</span>
        <textarea
          name="extra"
          defaultValue={initial.extra}
          rows={Math.max(3, initial.extra.split("\n").length)}
          spellCheck={false}
          className="input font-mono"
        />
        <Hint>Any other profile keys, kept as-is in profile.yaml.</Hint>
      </label>

      <div className="flex items-center gap-4">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state.message && !pending && <p className="text-sm text-emerald-700">{state.message}</p>}
      </div>
    </form>
  );
}
