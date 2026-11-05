"use client";

import { useActionState, useState, useTransition, startTransition, type FormEvent } from "react";
import type { FormState } from "../../../actions";

export default function TemplateEditor({
  initial,
  base,
  overridden,
  saveAction,
  resetAction,
}: {
  initial: string;
  base: string;
  overridden: boolean;
  saveAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  resetAction: () => Promise<FormState>;
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, dispatch, saving] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await saveAction(prev, fd);
    if (!res.error) setSaved(String(fd.get("content") ?? ""));
    return res;
  }, {});
  const [resetState, setResetState] = useState<FormState>({});
  const [resetting, startReset] = useTransition();
  const dirty = text !== saved;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResetState({});
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  function onReset() {
    if (!window.confirm("Discard this profile's version and use the base template?")) return;
    startReset(async () => {
      const res = await resetAction();
      setResetState(res);
      if (!res.error) {
        setText(base);
        setSaved(base);
      }
    });
  }

  const status = resetState.error || resetState.message ? resetState : state;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <textarea
        name="content"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={Math.min(40, Math.max(16, text.split("\n").length + 2))}
        className="input font-mono text-xs leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save template"}
        </button>
        {text !== base && (
          <button
            type="button"
            onClick={() => setText(base)}
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            Load base template into editor
          </button>
        )}
        {overridden && (
          <button
            type="button"
            onClick={onReset}
            disabled={resetting}
            className="text-sm text-red-600 hover:text-red-800 disabled:opacity-60"
          >
            {resetting ? "Resetting…" : "Reset to base template"}
          </button>
        )}
        {dirty && !saving && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>
      {status.error && <p className="text-sm text-red-700">{status.error}</p>}
      {status.message && !dirty && <p className="text-sm text-emerald-700">{status.message}</p>}
    </form>
  );
}
