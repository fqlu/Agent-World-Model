import Link from "next/link";
import { notFound } from "next/navigation";
import YAML from "yaml";
import { q } from "@/lib/db";
import {
  PROFILE_TEMPLATES,
  extraSettings,
  profileExists,
  profileUsesTemplateOverrides,
  readProfile,
} from "@/lib/profiles";
import { renderProfileRules } from "@/lib/scaffold";
import { saveProfileAction, deleteProfileAction } from "../actions";
import SettingsForm from "./settings-form";
import DeleteProfile from "./delete-profile";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: `${name} — Profiles — Agent World Model` };
}

export default async function ProfilePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!profileExists(name)) notFound();
  const { def, error } = readProfile(name);
  const usedBy = q
    .listWorkspaces()
    .filter((w) => w.profile === name)
    .map((w) => ({ id: w.id, name: w.name }));

  const header = (
    <div>
      <Link href="/profiles" className="text-sm text-zinc-500 hover:text-zinc-800">
        ← Profiles
      </Link>
      <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-zinc-900">{name}</h1>
      <p className="mt-1 text-xs text-zinc-500">
        Stored in <span className="font-mono">profiles/{name}/</span> ·{" "}
        {usedBy.length ? (
          <>
            used by{" "}
            {usedBy.map((w, i) => (
              <span key={w.id}>
                {i > 0 && ", "}
                <Link href={`/w/${w.id}`} className="text-indigo-600 hover:underline">
                  {w.name}
                </Link>
              </span>
            ))}
          </>
        ) : (
          "not used by any workspace"
        )}
      </p>
    </div>
  );

  if (!def) {
    return (
      <div className="space-y-6">
        {header}
        <p className="card border-red-200 p-5 text-sm text-red-700">
          {error} Fix <span className="font-mono">profiles/{name}/profile.yaml</span> by hand, then
          reload.
        </p>
      </div>
    );
  }

  const t = def.default_topology;
  const extra = extraSettings(def);
  const overrides = new Set(profileUsesTemplateOverrides(name));

  return (
    <div className="space-y-8">
      {header}

      <SettingsForm
        action={saveProfileAction.bind(null, name)}
        initial={{
          description: def.description ?? "",
          areas: t?.areas?.join(", ") ?? "",
          journal: t?.journal ?? "Journal",
          templates: t?.templates ?? "Templates",
          archive: t?.archive ?? "Archive",
          context: t?.context ?? "",
          entities: t?.entities ?? "",
          draftEnabled: Boolean(def.draft_lifecycle),
          workingPrefix: def.draft_lifecycle?.working_prefix ?? "Draft_",
          productionPrefixes: def.draft_lifecycle?.production_prefixes?.join(", ") ?? "",
          sharingOnlyFromProduction: def.draft_lifecycle?.sharing_only_from_production ?? true,
          statusFlags: Object.entries(def.status_flags ?? {})
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n"),
          rootFileAllowance: (def.root_file_allowance ?? []).join(", "),
          extra: Object.keys(extra).length ? YAML.stringify(extra) : "",
        }}
      />

      <section className="card max-w-3xl p-6">
        <h2 className="font-semibold text-zinc-900">Templates</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Each falls back to the neutral base template in{" "}
          <span className="font-mono">spec/templates/</span> until you customise it for this
          profile.
        </p>
        <ul className="mt-4 divide-y divide-zinc-100">
          {PROFILE_TEMPLATES.map(({ file, usedFor }) => (
            <li key={file} className="flex items-start justify-between gap-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-zinc-900">{file}</span>
                  {overrides.has(file) ? (
                    <span className="badge bg-indigo-100 text-indigo-700">customised</span>
                  ) : (
                    <span className="badge bg-zinc-100 text-zinc-500">base</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{usedFor}</p>
              </div>
              <Link
                href={`/profiles/${name}/templates/${encodeURIComponent(file)}`}
                className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
              >
                Edit
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card max-w-3xl p-6">
        <h2 className="font-semibold text-zinc-900">What agents see</h2>
        <p className="mt-1 text-xs text-zinc-500">
          The <span className="font-mono">Profile rules</span> section this profile writes into a
          workspace&apos;s <span className="font-mono">AGENTS.md</span>.
        </p>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-xs text-zinc-700">
          {`## Profile rules (${name})\n\n${renderProfileRules(name, def)}`}
        </pre>
      </section>

      <DeleteProfile
        action={deleteProfileAction.bind(null, name)}
        name={name}
        usedBy={usedBy.map((w) => w.name)}
      />
    </div>
  );
}
