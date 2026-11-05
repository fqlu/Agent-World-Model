"use client";

import { useState } from "react";

type Settings = {
  agent_name: string;
  mode: "dry-run" | "live";
  runtime: "drive-mcp" | "vm";
  drive_path: string;
  timezone: string;
  nightly: string;
  weekly: string;
  report_channel: string;
  budget: string;
  other_agents: { name: string; note?: string }[];
  notes: string;
};
type Data = { settings: Settings; briefPath: string; briefExists: boolean; kickoff: string };

const field = "input w-full font-mono text-sm";

export default function DreamingSetup({ wsId, initial }: { wsId: number; initial: Data }) {
  const [data, setData] = useState<Data>(initial);
  const [s, setS] = useState<Settings>(initial.settings);
  const [others, setOthers] = useState(
    initial.settings.other_agents.map((a) => (a.note ? `${a.name}: ${a.note}` : a.name)).join("\n"),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  async function call(method: "PUT" | "POST", body?: unknown) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/dreaming`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setData(j);
      setS(j.settings);
      setStatus(method === "PUT" ? "Saved. AGENTS.md and the dreaming instructions were re-generated." : "Instructions re-generated.");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    call("PUT", {
      ...s,
      other_agents: others
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const i = l.indexOf(":");
          return i > 0 ? { name: l.slice(0, i).trim(), note: l.slice(i + 1).trim() } : { name: l };
        }),
    });

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold text-zinc-900">1 · Settings</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-zinc-700">
            Agent name <span className="font-normal text-zinc-400">(signs its journal lines)</span>
            <input className={field} value={s.agent_name} onChange={(e) => set("agent_name", e.target.value)} />
          </label>
          <label className="text-sm font-medium text-zinc-700">
            Where the agent finds the workspace
            <input className={field} value={s.drive_path} onChange={(e) => set("drive_path", e.target.value)} />
          </label>
          <label className="text-sm font-medium text-zinc-700">
            Runtime
            <select className={field} value={s.runtime} onChange={(e) => set("runtime", e.target.value as Settings["runtime"])}>
              <option value="drive-mcp">drive-mcp — a bot with Google Drive tools</option>
              <option value="vm">vm — a machine with a shell + rclone</option>
            </select>
          </label>
          <label className="text-sm font-medium text-zinc-700">
            Mode
            <select className={field} value={s.mode} onChange={(e) => set("mode", e.target.value as Settings["mode"])}>
              <option value="dry-run">dry-run — proposes only</option>
              <option value="live">live — also applies accepted follow-ups</option>
            </select>
          </label>
          <label className="text-sm font-medium text-zinc-700">
            Timezone
            <input className={field} value={s.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-zinc-700">
              Nightly at
              <input className={field} value={s.nightly} onChange={(e) => set("nightly", e.target.value)} />
            </label>
            <label className="text-sm font-medium text-zinc-700">
              Weekly on
              <input className={field} value={s.weekly} onChange={(e) => set("weekly", e.target.value)} />
            </label>
          </div>
          <label className="text-sm font-medium text-zinc-700">
            Report to
            <input className={field} value={s.report_channel} onChange={(e) => set("report_channel", e.target.value)} />
          </label>
          <label className="text-sm font-medium text-zinc-700">
            Budget per run
            <input className={field} value={s.budget} onChange={(e) => set("budget", e.target.value)} />
          </label>
        </div>
        <label className="block text-sm font-medium text-zinc-700">
          Other agents that write here <span className="font-normal text-zinc-400">(one per line, “name: what it does”)</span>
          <textarea className={field} rows={3} value={others} onChange={(e) => setOthers(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-zinc-700">
          Notes for the agent <span className="font-normal text-zinc-400">(rendered at the end of its instructions — e.g. a one-off handover)</span>
          <textarea className={field} rows={4} value={s.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={busy} className="btn-primary">Save &amp; re-generate</button>
          <button onClick={() => call("POST")} disabled={busy} className="btn-secondary">Re-generate instructions only</button>
          {status && <span className={`text-sm ${status.startsWith("Error") ? "text-red-600" : "text-emerald-700"}`}>{status}</span>}
        </div>
        <p className="text-xs text-zinc-500">
          Instructions file: <code className="font-mono">{data.briefPath}</code>{" "}
          {data.briefExists ? "✓ present" : "— not written yet (save to create it)"}
        </p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold text-zinc-900">2 · Start your agent</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700">
          <li>Pick an agent platform that can read and write your Google Drive (a Drive bot / MCP), or a VM with a shell.</li>
          <li>Check your organisation allows workspace content (client notes) to go to that model provider.</li>
          <li>Give it access to the workspace folder only — no sharing or delete rights if the platform lets you choose.</li>
          <li>Send it this message once. It re-reads its instructions file every run, so later changes here reach it automatically.</li>
        </ol>
        <div className="relative">
          <pre className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-800">{data.kickoff}</pre>
          <button
            onClick={() => navigator.clipboard.writeText(data.kickoff).then(() => setStatus("Kickoff message copied."))}
            className="btn-secondary absolute right-2 top-2 text-xs"
          >
            Copy
          </button>
        </div>
      </section>

      <section className="card space-y-2 p-5 text-sm text-zinc-700">
        <h2 className="font-semibold text-zinc-900">3 · Each morning</h2>
        <p>
          Open the <a href={`/w/${wsId}/inbox`} className="text-indigo-600 hover:underline">Dreaming inbox</a>: answer
          questions, accept or reject fixes (accepted edits apply straight away). Your decisions go back to the agent on
          its next run. When you trust it, switch the mode to <strong>live</strong> here.
        </p>
      </section>
    </div>
  );
}
