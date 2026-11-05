import Link from "next/link";
import { q } from "@/lib/db";
import { listProfiles, readProfile, profileUsesTemplateOverrides } from "@/lib/profiles";
import NewProfileForm from "./new-profile-form";

export const metadata = { title: "Profiles — Agent World Model" };
export const dynamic = "force-dynamic";

export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; archived?: string }>;
}) {
  const { deleted, archived } = await searchParams;
  const profiles = listProfiles();
  const usage: Record<string, string[]> = {};
  for (const w of q.listWorkspaces()) (usage[w.profile] ??= []).push(w.name);

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Workspaces
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Profiles</h1>
        <p className="mt-1 text-sm text-zinc-600">
          A <strong>profile</strong> is your organisation&apos;s preset, chosen when you create a
          workspace: the <em>starter folder layout</em>, <em>draft lifecycle</em>,{" "}
          <em>status flags</em>, extra root files, and <em>template overrides</em>. The protocol
          itself stays neutral; every profile here is yours to create, edit or delete. Day-to-day
          rules for one workspace live in its own{" "}
          <code className="font-mono text-xs">_Workspace.yaml</code> (its Rules page), not here.
        </p>
      </div>

      {deleted && (
        <p className="max-w-3xl rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Deleted <span className="font-mono">{deleted}</span>
          {archived ? (
            <>
              {" "}
              — its files were moved to <span className="font-mono">{archived}</span>, not erased.
            </>
          ) : null}
        </p>
      )}

      {profiles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500">
          No profiles yet. Workspaces without one get the protocol baseline (a generic{" "}
          <span className="font-mono">Projects/</span> area, no org rituals).
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {profiles.map((name) => {
            const { def, error } = readProfile(name);
            const t = def?.default_topology;
            const using = usage[name] ?? [];
            const overrides = def ? profileUsesTemplateOverrides(name) : [];
            return (
              <li key={name}>
                <Link
                  href={`/profiles/${name}`}
                  className="card block h-full p-4 transition hover:border-indigo-400 hover:shadow"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-900">{name}</span>
                    {using.length > 0 && (
                      <span className="badge bg-indigo-100 text-indigo-700">
                        {using.length} workspace{using.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {error && <span className="badge bg-red-100 text-red-700">invalid file</span>}
                  </div>
                  {error ? (
                    <p className="mt-1 text-xs text-red-700">{error}</p>
                  ) : (
                    <>
                      {def?.description && (
                        <p className="mt-1 text-sm text-zinc-600">{def.description}</p>
                      )}
                      <dl className="mt-2 space-y-0.5 text-xs text-zinc-500">
                        <div>
                          Areas:{" "}
                          <span className="font-mono">{t?.areas?.join(", ") || "(baseline)"}</span>
                        </div>
                        <div>
                          Draft lifecycle:{" "}
                          {def?.draft_lifecycle ? (
                            <span className="font-mono">
                              {def.draft_lifecycle.working_prefix} →{" "}
                              {def.draft_lifecycle.production_prefixes.join(" / ")}
                            </span>
                          ) : (
                            "none"
                          )}
                        </div>
                        <div>
                          Templates:{" "}
                          {overrides.length
                            ? `${overrides.length} customised (${overrides.join(", ")})`
                            : "base templates"}
                        </div>
                      </dl>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <NewProfileForm profiles={profiles} />

      <p className="max-w-3xl text-xs text-zinc-500">
        Profiles are stored as files in <code className="font-mono">profiles/&lt;name&gt;/</code> at
        the repo root (<code className="font-mono">profile.yaml</code> plus a{" "}
        <code className="font-mono">templates/</code> folder), so they can be committed and shared.
        Deleting one moves it to <code className="font-mono">profiles/_archive/</code>.
      </p>
    </div>
  );
}
