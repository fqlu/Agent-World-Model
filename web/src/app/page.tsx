import Link from "next/link";
import { q } from "@/lib/db";
import { googleConfigured } from "@/lib/google";
import { listProfiles } from "@/lib/spec";
import { createWorkspaceAction } from "./actions";
import FolderPicker from "@/components/folder-picker";
import type { AuditStats } from "@/lib/linter";

export const dynamic = "force-dynamic";

function ProfileSelect() {
  return (
    <label className="block text-sm font-medium text-zinc-700">
      Profile
      <select name="profile" defaultValue="incubeta" className="input">
        {listProfiles().map((p) => (
          <option key={p} value={p}>
            {p}
            {p === "core" ? " (organisation-neutral)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Home() {
  const workspaces = q.listWorkspaces();
  const driveReady = googleConfigured();
  const driveAccounts = driveReady ? q.listTokenEmails() : [];

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Workspaces</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          A workspace is a folder managed under the Drive Context Protocol. The loop:{" "}
          <strong>audit</strong> it, <strong>repair</strong> it via reviewed proposals, then keep
          its <strong>context groups</strong> current for your agents.
        </p>
        {workspaces.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500">
            No workspaces yet — connect one below.
          </p>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {workspaces.map((w) => {
              const latest = q.listAudits(w.id)[0];
              const s = latest ? (JSON.parse(latest.stats) as AuditStats) : null;
              return (
                <li key={w.id}>
                  <Link
                    href={`/w/${w.id}`}
                    className="card block p-4 transition hover:border-indigo-400 hover:shadow"
                  >
                    <div className="font-medium text-zinc-900">{w.name}</div>
                    <div className="mt-1 text-xs font-medium text-indigo-600">
                      {w.kind === "local" ? "Local folder" : `Google Drive · ${w.account_email}`}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-zinc-500">{w.root}</div>
                    <div className="mt-2 text-xs">
                      {s ? (
                        <>
                          <span className="text-red-600">{s.errors} errors</span>
                          <span className="text-zinc-400"> · </span>
                          <span className="text-amber-600">{s.warns} warnings</span>
                          <span className="text-zinc-400"> · </span>
                          <span className="text-zinc-500">{s.groups ?? 0} groups</span>
                        </>
                      ) : (
                        <span className="text-zinc-400">never audited</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="grid items-start gap-6 sm:grid-cols-2">
        <form action={createWorkspaceAction} className="card space-y-4 p-6">
          <div>
            <h2 className="font-semibold text-zinc-900">Add a local workspace</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Browse to a folder on this machine (e.g. your Google Drive–synced folder).
            </p>
          </div>
          <input type="hidden" name="kind" value="local" />
          <label className="block text-sm font-medium text-zinc-700">
            Name
            <input name="name" required placeholder="Incubeta Master Folder" className="input" />
          </label>
          <div className="text-sm font-medium text-zinc-700">
            Folder
            <div className="mt-1">
              <FolderPicker name="root" />
            </div>
          </div>
          <ProfileSelect />
          <button className="btn-primary">Add workspace</button>
        </form>

        <div className="card space-y-4 p-6">
          <div>
            <h2 className="font-semibold text-zinc-900">Add a Google Drive workspace</h2>
            {!driveReady ? (
              <p className="mt-1 text-xs text-zinc-500">
                Not configured. Set <code className="font-mono">GOOGLE_CLIENT_ID</code> and{" "}
                <code className="font-mono">GOOGLE_CLIENT_SECRET</code> in{" "}
                <code className="font-mono">web/.env.local</code>, then restart. See README for
                the OAuth client setup steps.
              </p>
            ) : (
              <p className="mt-1 text-xs text-zinc-500">
                Connected accounts:{" "}
                {driveAccounts.length ? driveAccounts.join(", ") : "none yet"}.
              </p>
            )}
          </div>
          {driveReady && (
            <>
              <a href="/api/google/auth" className="btn-secondary">
                Connect a Google account
              </a>
              <form
                action={createWorkspaceAction}
                className="space-y-4 border-t border-zinc-100 pt-4"
              >
                <input type="hidden" name="kind" value="gdrive" />
                <label className="block text-sm font-medium text-zinc-700">
                  Name
                  <input name="name" required className="input" />
                </label>
                <label className="block text-sm font-medium text-zinc-700">
                  Drive folder ID (the workspace root)
                  <input name="root" required placeholder="1AbC…" className="input font-mono" />
                </label>
                <label className="block text-sm font-medium text-zinc-700">
                  Account email
                  <input
                    name="account_email"
                    required
                    placeholder="you@company.com"
                    className="input"
                  />
                </label>
                <ProfileSelect />
                <button className="btn-primary">Add Drive workspace</button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
