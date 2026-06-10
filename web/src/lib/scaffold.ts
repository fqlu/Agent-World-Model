import YAML from "yaml";
import { loadManifest, loadTemplate, ProfileDef } from "./spec";
import { Mounts } from "./workspace";
import { Op } from "./ops";

export type ScaffoldOptions = {
  workspaceName: string;
  ownerName: string;
  ownerEmail: string;
  profile: string;
  topology?: Mounts; // defaults to the profile's starter topology
};

export function defaultTopology(profileName: string): Mounts {
  const manifest = loadManifest();
  const p = manifest.profiles[profileName];
  const t = p?.default_topology;
  if (t) return { areas: [...t.areas], journal: t.journal, templates: t.templates, archive: t.archive };
  return { areas: ["Projects"], journal: "Journal", templates: "Templates", archive: "Archive" };
}

export function renderMap(mounts: Mounts): string {
  const lines: string[] = [];
  lines.push("_Workspace.yaml   ← topology declaration (this map's source)");
  lines.push("_Overview.md      ← whose workspace this is; start here");
  for (const a of mounts.areas) lines.push(`${a}/`.padEnd(18) + "← area: holds scopes");
  lines.push(`${mounts.journal}/`.padEnd(18) + "← journal: daily index + agent activity log");
  lines.push(`${mounts.templates}/`.padEnd(18) + "← templates: copy, never invent layouts");
  lines.push(`${mounts.archive}/`.padEnd(18) + "← archive: superseded material, mirrors paths");
  return lines.join("\n");
}

export function renderProfileRules(profileName: string, profile: ProfileDef): string {
  const rules: string[] = [];
  if (profile.draft_lifecycle) {
    rules.push(
      `- Working files are prefixed \`${profile.draft_lifecycle.working_prefix}\`. They are private to this workspace — sharing happens only from promoted production copies (prefixed ${profile.draft_lifecycle.production_prefixes.join(" or ")}).`,
    );
  }
  if (profile.status_flags) {
    const flags = Object.entries(profile.status_flags)
      .map(([k, v]) => `${v} ${k}`)
      .join(" · ");
    rules.push(`- Status flags: ${flags}.`);
  }
  if (profile.root_file_allowance?.length) {
    rules.push(`- Additional permitted root files: ${profile.root_file_allowance.join(", ")}.`);
  }
  if (!rules.length) rules.push(`- (no additional rules for profile "${profileName}")`);
  return rules.join("\n");
}

export function renderWorkspaceYaml(opts: ScaffoldOptions, mounts: Mounts): string {
  const manifest = loadManifest();
  return YAML.stringify({
    spec_version: manifest.spec_version,
    profile: opts.profile,
    owner: { name: opts.ownerName, email: opts.ownerEmail },
    mounts: {
      areas: mounts.areas,
      journal: mounts.journal,
      templates: mounts.templates,
      archive: mounts.archive,
    },
  });
}

export function renderProtocol(opts: ScaffoldOptions, mounts: Mounts): string {
  const manifest = loadManifest();
  const profile = manifest.profiles[opts.profile] ?? {};
  return loadTemplate("_PROTOCOL.md")
    .replaceAll("{{spec_version}}", manifest.spec_version)
    .replaceAll("{{profile}}", opts.profile)
    .replaceAll("{{owner_name}}", opts.ownerName)
    .replaceAll("{{owner_email}}", opts.ownerEmail)
    .replaceAll("{{map}}", renderMap(mounts))
    .replaceAll("{{profile_rules}}", renderProfileRules(opts.profile, profile));
}

export function renderRootOverview(opts: ScaffoldOptions, mounts: Mounts): string {
  return `# ${opts.workspaceName}

## What it is
Workspace of ${opts.ownerName} <${opts.ownerEmail}>. Structured under the Drive
Context Protocol (see \`_PROTOCOL.md\`). Areas: ${mounts.areas.join(", ")}.

## Active workstreams
- *(none yet — populate as work begins)*

## Key people
**Owner:**
- ${opts.ownerName} — ${opts.ownerEmail}

## Recent activity
*No entries yet.*

## Reference
- [Workspace protocol](_PROTOCOL.md)
`;
}

// Workspace-facing template names (what lands in the Templates mount)
const TEMPLATE_FILES: Array<{ spec: string; workspace: string }> = [
  { spec: "_Overview.md", workspace: "_Overview Template.md" },
  { spec: "WIP Note.md", workspace: "WIP Note Template.md" },
  { spec: "Daily Journal.md", workspace: "Daily Journal Template.md" },
  { spec: "_Tasks.md", workspace: "_Tasks Template.md" },
];

export function buildScaffoldPlan(opts: ScaffoldOptions): Op[] {
  const mounts = opts.topology ?? defaultTopology(opts.profile);
  const ops: Op[] = [];

  for (const a of mounts.areas) {
    ops.push({ action: "mkdir", path: a, note: `Create area "${a}"`, selected: true });
  }
  for (const m of [mounts.journal, mounts.templates, mounts.archive]) {
    ops.push({ action: "mkdir", path: m, note: `Create capability mount "${m}"`, selected: true });
  }
  ops.push({
    action: "write",
    path: "_Workspace.yaml",
    content: renderWorkspaceYaml(opts, mounts),
    note: "Declare the workspace topology",
    selected: true,
  });
  ops.push({
    action: "write",
    path: "_PROTOCOL.md",
    content: renderProtocol(opts, mounts),
    overwrite: true,
    note: "Generate the agent rulebook from spec + profile + topology",
    selected: true,
  });
  ops.push({
    action: "write",
    path: "_Overview.md",
    content: renderRootOverview(opts, mounts),
    note: "Create the root overview",
    selected: true,
  });
  for (const t of TEMPLATE_FILES) {
    ops.push({
      action: "write",
      path: `${mounts.templates}/${t.workspace}`,
      content: loadTemplate(t.spec),
      note: `Install template "${t.workspace}"`,
      selected: true,
    });
  }
  return ops;
}
