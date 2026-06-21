import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { loadManifest, type ProfileDef } from "@/lib/spec";
import { q } from "@/lib/db";

export const metadata = { title: "Profiles — Agent World Model" };
export const dynamic = "force-dynamic";

const SPEC_DIR = process.env.SPEC_DIR ?? path.resolve(process.cwd(), "..", "spec");

function hasTemplateOverrides(profile: string): boolean {
  try {
    const dir = path.join(SPEC_DIR, "templates", "profiles", profile);
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export default function ProfilesPage() {
  const manifest = loadManifest();
  const profiles = manifest.profiles as Record<string, ProfileDef>;
  const workspaces = q.listWorkspaces();
  const usage: Record<string, string[]> = {};
  for (const w of workspaces) (usage[w.profile] ??= []).push(w.name);

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Workspaces
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Profiles</h1>
        <p className="mt-1 text-sm text-zinc-600">
          A <strong>profile</strong> is a named preset, chosen when you create a workspace. It
          sets the <em>starter folder layout</em>, the <em>template flavor</em>, and any{" "}
          <em>organisation rituals</em> — layered on the neutral core protocol. It mostly matters
          at creation time; day-to-day behaviour (rules, conventions, scope types) lives in each
          workspace&apos;s <code className="font-mono text-xs">_Workspace.yaml</code>, not the
          profile. Profiles are defined in the spec and are org-level — there&apos;s intentionally
          no per-workspace editing here.
        </p>
      </div>

      {Object.entries(profiles).map(([name, p]) => {
        const t = p.default_topology;
        const draft = p.draft_lifecycle;
        const flags = p.status_flags;
        const allow = p.root_file_allowance ?? [];
        const internal = p.internal_solutions as { path?: string; naming?: string } | undefined;
        const overrides = hasTemplateOverrides(name);
        const using = usage[name] ?? [];
        return (
          <section key={name} className="card p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-900">{name}</h2>
              {name === "core" && (
                <span className="badge bg-zinc-100 text-zinc-600">organisation-neutral baseline</span>
              )}
              {using.length > 0 && (
                <span className="badge bg-indigo-100 text-indigo-700">
                  {using.length} workspace{using.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-[180px_1fr]">
              <dt className="text-sm font-medium text-zinc-700">Starter layout</dt>
              <dd className="text-sm text-zinc-600">
                {t ? (
                  <>
                    Areas: <span className="font-mono">{t.areas.join(", ")}</span> · journal{" "}
                    <span className="font-mono">{t.journal}</span>, templates{" "}
                    <span className="font-mono">{t.templates}</span>, archive{" "}
                    <span className="font-mono">{t.archive}</span>
                    {t.context ? (
                      <>
                        , context <span className="font-mono">{t.context}</span>
                      </>
                    ) : null}
                    {(t as { entities?: string }).entities ? (
                      <>
                        , entities <span className="font-mono">{(t as { entities?: string }).entities}</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span className="text-zinc-400">(none)</span>
                )}
              </dd>

              <dt className="text-sm font-medium text-zinc-700">Templates</dt>
              <dd className="text-sm text-zinc-600">
                {overrides ? "Custom (profile-specific overrides)" : "Neutral base templates"}
              </dd>

              <dt className="text-sm font-medium text-zinc-700">Draft lifecycle</dt>
              <dd className="text-sm text-zinc-600">
                {draft ? (
                  <>
                    Working prefix <span className="font-mono">{draft.working_prefix}</span> →
                    production <span className="font-mono">{draft.production_prefixes.join(" / ")}</span>
                  </>
                ) : (
                  <span className="text-zinc-400">none</span>
                )}
              </dd>

              <dt className="text-sm font-medium text-zinc-700">Status flags</dt>
              <dd className="text-sm text-zinc-600">
                {flags ? (
                  Object.entries(flags).map(([k, v]) => `${v} ${k}`).join(" · ")
                ) : (
                  <span className="text-zinc-400">none</span>
                )}
              </dd>

              <dt className="text-sm font-medium text-zinc-700">Extra root files allowed</dt>
              <dd className="text-sm text-zinc-600">
                {allow.length ? <span className="font-mono">{allow.join(", ")}</span> : <span className="text-zinc-400">none</span>}
              </dd>

              {internal?.naming && (
                <>
                  <dt className="text-sm font-medium text-zinc-700">Internal solutions</dt>
                  <dd className="text-sm text-zinc-600">
                    <span className="font-mono">{internal.path}</span> · naming{" "}
                    <span className="font-mono">{internal.naming}</span>
                  </dd>
                </>
              )}

              {using.length > 0 && (
                <>
                  <dt className="text-sm font-medium text-zinc-700">Used by</dt>
                  <dd className="text-sm text-zinc-600">{using.join(", ")}</dd>
                </>
              )}
            </dl>
          </section>
        );
      })}

      <p className="max-w-3xl text-xs text-zinc-500">
        Need a new profile (e.g. for a different organisation with its own rituals)? Profiles are
        authored in <code className="font-mono">spec/manifest.yaml</code> plus an optional
        <code className="font-mono"> spec/templates/profiles/&lt;name&gt;/</code> folder — ask and
        one can be scaffolded for you.
      </p>
    </div>
  );
}
