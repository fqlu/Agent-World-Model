import { loadManifest, loadTemplate, ProfileDef } from "./spec";
import { resolveProfile } from "./profiles";
import { normalizeIgnoreList } from "./ignore";
import { Mounts, WorkspaceDecl } from "./workspace";
import { resolveRuleConfig, renderRulesSummary } from "./rules";
import { Op } from "./ops";
import { headerToDecl, protocolToVersion, renderHeader, versionToProtocol } from "./config";
import { briefPath, renderDreamingBrief } from "./dreaming";

export type ScaffoldOptions = {
  workspaceName: string;
  ownerName: string;
  ownerEmail: string;
  profile: string;
  topology?: Mounts; // defaults to the profile's starter topology
};

export function defaultTopology(profileName: string): Mounts {
  const t = resolveProfile(profileName).default_topology;
  return {
    areas: t ? [...t.areas] : ["Projects"],
    journal: t?.journal ?? "_Journal",
    templates: t?.templates ?? "_Templates",
    archive: t?.archive ?? "Archive",
    entities: t?.entities ?? "_Entities",
    proposals: t?.proposals ?? "_Proposals",
  };
}

// The declared topology as agents see it (SPEC §2, v0.16): AGENTS.md plus
// the protocol folders, then the content areas.
export function renderMap(mounts: Mounts, ignore: string[] = []): string {
  const pad = (s: string) => s.padEnd(18);
  const lines: string[] = [];
  lines.push(pad("AGENTS.md") + "← this file: config (header) + rules");
  for (const a of mounts.areas) lines.push(pad(`${a}/`) + "← area: holds scopes");
  if (mounts.entities) lines.push(pad(`${mounts.entities}/`) + "← entities: people, organizations, systems, concepts, facets");
  lines.push(pad(`${mounts.journal}/`) + "← journal: agent activity log (YYYY/YYYY-MM/YYYY-MM-DD.md)");
  if (mounts.proposals) lines.push(pad(`${mounts.proposals}/`) + "← proposals: agents ask, the owner decides");
  lines.push(pad(`${mounts.templates}/`) + "← templates: copy, never invent layouts");
  lines.push(pad(`${mounts.archive}/`) + "← archive: superseded material, mirrors paths");
  for (const p of ignore) lines.push(pad(`${p}/`) + "← ignored: outside the protocol");
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

// The v0.16 config header for a new workspace (SPEC §2).
export function buildHeader(opts: ScaffoldOptions, mounts: Mounts, about?: string): Record<string, unknown> {
  const manifest = loadManifest();
  const m: Record<string, unknown> = {
    areas: mounts.areas,
    journal: mounts.journal,
    templates: mounts.templates,
    archive: mounts.archive,
  };
  if (mounts.entities) m.entities = mounts.entities;
  if (mounts.proposals) m.proposals = mounts.proposals;
  const h: Record<string, unknown> = {
    protocol: versionToProtocol(manifest.spec_version),
    profile: opts.profile,
    owner: { name: opts.ownerName, email: opts.ownerEmail },
    mounts: m,
  };
  if (about) h.about = about;
  return h;
}

// AGENTS.md = config header + rulebook body rendered from it. Pass the
// existing header to re-render (config edits); omit it for a new workspace.
export function renderAgentsMd(
  opts: ScaffoldOptions,
  mounts: Mounts,
  decl?: WorkspaceDecl | null,
  header?: Record<string, unknown>,
): string {
  const manifest = loadManifest();
  const profile = resolveProfile(opts.profile);
  const cfg = resolveRuleConfig(decl ?? null);
  const h = header ?? buildHeader(opts, mounts, decl?.about);
  const specVersion = protocolToVersion(h.protocol) ?? decl?.spec_version ?? manifest.spec_version;
  const about = typeof h.about === "string" && h.about.trim() ? `**About:** ${h.about.trim()}` : "";
  const body = loadTemplate("AGENTS.md", opts.profile)
    .replaceAll("{{spec_version}}", String(specVersion))
    .replaceAll("{{profile}}", opts.profile)
    .replaceAll("{{owner_name}}", opts.ownerName)
    .replaceAll("{{owner_email}}", opts.ownerEmail)
    .replaceAll("{{about}}", about)
    .replaceAll("{{map}}", renderMap(mounts, normalizeIgnoreList(decl?.ignore ?? h.ignore)))
    .replaceAll("{{journal}}", mounts.journal)
    .replaceAll("{{templates}}", mounts.templates)
    .replaceAll("{{archive}}", mounts.archive)
    .replaceAll("{{entities}}", mounts.entities ?? "_Entities")
    .replaceAll("{{proposals}}", mounts.proposals ?? "_Proposals")
    .replaceAll("{{rules_summary}}", renderRulesSummary(cfg))
    .replaceAll("{{house_rules}}", renderHouseRules(decl ?? null))
    .replaceAll("{{profile_rules}}", renderProfileRules(opts.profile, profile))
    .replace(/\n{3,}/g, "\n\n");
  return `${renderHeader(h)}\n${body.trimEnd()}\n`;
}

function renderHouseRules(decl: WorkspaceDecl | null): string {
  const hr = decl?.house_rules ?? [];
  if (!hr.length) return "*(none defined — add them on the Rules page.)*";
  return hr
    .map((r, i) => {
      const check = r.check
        ? ` _(also audited: ${r.check.type}${r.check.applies_to ? ` under ${r.check.applies_to}` : ""})_`
        : "";
      return `${i + 1}. ${r.text}${check}`;
    })
    .join("\n");
}

// Workspace-facing template names (what lands in the templates mount, SPEC §2)
export const TEMPLATE_FILES: Array<{ spec: string; workspace: string }> = [
  { spec: "_Overview.md", workspace: "_Overview Template.md" },
  { spec: "_Tasks.md", workspace: "_Tasks Template.md" },
  { spec: "WIP Note.md", workspace: "WIP Note Template.md" },
  { spec: "Entity.md", workspace: "Entity Template.md" },
];

export function buildScaffoldPlan(opts: ScaffoldOptions): Op[] {
  const mounts = opts.topology ?? defaultTopology(opts.profile);
  const ops: Op[] = [];

  for (const a of mounts.areas) {
    ops.push({ action: "mkdir", path: a, note: `Create area "${a}"`, selected: true });
  }
  for (const m of [mounts.journal, mounts.templates, mounts.archive, mounts.entities, mounts.proposals].filter(
    (x): x is string => Boolean(x),
  )) {
    ops.push({ action: "mkdir", path: m, note: `Create protocol folder "${m}"`, selected: true });
  }
  ops.push({
    action: "write",
    path: "AGENTS.md",
    content: renderAgentsMd(opts, mounts),
    overwrite: true,
    note: "Write AGENTS.md: the workspace config (header) and agent rulebook",
    selected: true,
  });
  for (const t of TEMPLATE_FILES) {
    ops.push({
      action: "write",
      path: `${mounts.templates}/${t.workspace}`,
      content: loadTemplate(t.spec, opts.profile),
      note: `Install template "${t.workspace}"`,
      selected: true,
    });
  }
  const decl = headerToDecl(buildHeader(opts, mounts));
  ops.push({
    action: "write",
    path: briefPath(decl),
    content: renderDreamingBrief(decl, { workspaceName: opts.workspaceName }),
    overwrite: true,
    note: "Write the dreaming agent's brief (spec/DREAMING.md)",
    selected: true,
  });
  return ops;
}
