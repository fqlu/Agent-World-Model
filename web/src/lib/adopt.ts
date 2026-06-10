import YAML from "yaml";
import { Connector, parentPath, baseName } from "./connector";
import { loadManifest, loadTemplate } from "./spec";
import { parseWorkspaceYaml, allowedForms, checkPipeName, Mounts, PIPE } from "./workspace";
import { Op } from "./ops";
import { runAudit, Finding } from "./linter";
import {
  ScaffoldOptions,
  defaultTopology,
  renderWorkspaceYaml,
  renderAgentsMd,
  renderRootOverview,
} from "./scaffold";

const WIP_SUFFIX = "WIP Notes";

function renderScopeOverview(name: string): string {
  return loadTemplate("_Overview.md")
    .replace("# [Scope name]", `# ${name}`)
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function formatFinding(f: Finding): string {
  return `${f.rule} (${f.severity}) · ${f.path || "(root)"} — ${f.message}`;
}

// Build a repair plan in two passes (v0.6 content-by-default):
//   1. Bootstrap — declare/infer topology, generate root context files,
//      install templates, create missing ENTITY overviews, propose naming
//      repairs for promoted scopes and collections.
//   2. Finding-driven — run the audit and map every remaining finding to a
//      repair operation, or to the `manual` list when no safe automated fix
//      exists. Nothing the audit finds is silently ignored.
export async function buildAdoptionPlan(
  c: Connector,
  opts: ScaffoldOptions,
): Promise<{ ops: Op[]; notes: string[]; manual: string[] }> {
  const manifest = loadManifest();
  const ops: Op[] = [];
  const notes: string[] = [];
  const manual: string[] = [];

  const root = await c.list("");
  const rootFolders = root.filter((e) => e.kind === "folder");
  const rootNames = new Set(root.map((e) => e.name));

  // --- Pass 1: bootstrap ---
  let mounts: Mounts;
  const existingDecl = await c.read(manifest.workspace.manifest_file);
  const decl = existingDecl ? parseWorkspaceYaml(existingDecl) : null;
  const declared = Boolean(decl?.mounts?.areas?.length);

  if (declared) {
    mounts = {
      areas: decl!.mounts!.areas!,
      journal: decl!.mounts!.journal ?? "Journal",
      templates: decl!.mounts!.templates ?? "Templates",
      archive: decl!.mounts!.archive ?? "Archive",
      context: decl!.mounts!.context,
    };
    notes.push("Existing _Workspace.yaml found — using its declared topology.");
    if (decl!.spec_version && String(decl!.spec_version) !== manifest.spec_version) {
      const doc = YAML.parse(existingDecl!) as Record<string, unknown>;
      doc.spec_version = manifest.spec_version;
      ops.push({
        action: "write",
        path: manifest.workspace.manifest_file,
        content: YAML.stringify(doc),
        overwrite: true,
        note: `Upgrade declared spec version ${decl!.spec_version} → ${manifest.spec_version} (topology and other settings preserved)`,
        selected: true,
      });
    }
  } else {
    const find = (re: RegExp) => rootFolders.find((f) => re.test(f.name))?.name;
    const journal = find(/journal/i) ?? "Journal";
    const templates = find(/template/i) ?? "Templates";
    const archive = find(/archive/i) ?? "Archive";
    const context = find(/^_?context$/i) ?? "_Context";
    const capabilityNames = new Set([journal, templates, archive, context]);
    const areas = rootFolders.map((f) => f.name).filter((n) => !capabilityNames.has(n));
    const fallback = defaultTopology(opts.profile);
    mounts = {
      areas: areas.length ? areas : fallback.areas,
      journal,
      templates,
      archive,
      context,
    };
    notes.push(
      `Inferred topology — areas: [${mounts.areas.join(", ")}], journal: ${journal}, templates: ${templates}, archive: ${archive}. Edit _Workspace.yaml afterwards if this guess is wrong.`,
    );
    ops.push({
      action: "write",
      path: manifest.workspace.manifest_file,
      content: renderWorkspaceYaml(opts, mounts),
      note: "Declare the inferred topology in _Workspace.yaml",
      selected: true,
    });
  }

  for (const m of [
    ...mounts.areas,
    mounts.journal,
    mounts.templates,
    mounts.archive,
    ...(mounts.context ? [mounts.context] : []),
  ]) {
    if (!rootNames.has(m)) {
      ops.push({ action: "mkdir", path: m, note: `Create missing mount "${m}"`, selected: true });
    }
  }

  ops.push({
    action: "write",
    path: "AGENTS.md",
    content: renderAgentsMd(opts, mounts),
    overwrite: true,
    note: rootNames.has("AGENTS.md")
      ? "Regenerate AGENTS.md from spec + profile + topology"
      : "Generate the agent rulebook (AGENTS.md — auto-discovered by agentic tools)",
    selected: true,
  });
  if (!rootNames.has("_Overview.md")) {
    ops.push({
      action: "write",
      path: "_Overview.md",
      content: renderRootOverview(opts, mounts),
      note: "Create the root overview",
      selected: true,
    });
  }

  const templateFiles: Array<{ spec: string; workspace: string }> = [
    { spec: "_Overview.md", workspace: "_Overview Template.md" },
    { spec: "WIP Note.md", workspace: "WIP Note Template.md" },
    { spec: "Daily Journal.md", workspace: "Daily Journal Template.md" },
    { spec: "_Tasks.md", workspace: "_Tasks Template.md" },
  ];
  for (const t of templateFiles) {
    const p = `${mounts.templates}/${t.workspace}`;
    if (!(await c.exists(p))) {
      ops.push({
        action: "write",
        path: p,
        content: loadTemplate(t.spec),
        note: `Install template "${t.workspace}"`,
        selected: true,
      });
    }
  }

  // Entity overviews (the only mandatory context anchor) + naming repairs
  // for promoted scopes and collections. Content folders are left alone.
  const ctxName = mounts.context ?? "_Context";
  for (const area of mounts.areas) {
    if (!rootNames.has(area)) continue;
    for (const entity of await c.list(area)) {
      if (entity.kind !== "folder" || entity.name === ctxName) continue;
      const children = await c.list(entity.path);
      if (!children.some((e) => e.name === manifest.scopes.context_file)) {
        ops.push({
          action: "write",
          path: `${entity.path}/${manifest.scopes.context_file}`,
          content: renderScopeOverview(entity.name),
          note: `Create missing _Overview.md for entity "${entity.name}"`,
          selected: true,
        });
      }
      await proposeNamingRepairs(entity.path, children, [allowedForms(entity.name)]);
    }
  }

  // --- Pass 2: finding-driven repairs ---
  if (declared) {
    const audit = await runAudit(c, opts.profile);

    for (const f of audit.findings) {
      switch (f.rule) {
        // Covered by bootstrap ops (pass 1)
        case "ST-001":
        case "ST-002":
        case "ST-003":
        case "ST-005":
        case "SC-001":
        case "NM-001":
          break;

        case "ST-004": {
          const isLegacyRulebook = f.path === "_PROTOCOL.md";
          ops.push({
            action: "move",
            path: f.path,
            to: `${mounts.archive}/${f.path}`,
            note: isLegacyRulebook
              ? "Archive legacy _PROTOCOL.md — replaced by AGENTS.md in spec v0.5"
              : `Archive undeclared root item "${f.path}" (alternatives: move it into a scope, or declare it as a mount in _Workspace.yaml)`,
            selected: isLegacyRulebook,
            risky: !isLegacyRulebook,
          });
          break;
        }

        // Content-judgment findings — no safe automated fix
        default:
          manual.push(formatFinding(f));
      }
    }

    const fixable = audit.findings.length - manual.length;
    notes.push(
      `Audit found ${audit.findings.length} finding(s): ${fixable} have repair operations in this plan, ${manual.length} need human judgment (listed below).`,
    );
  } else {
    notes.push(
      "First adoption pass: this plan bootstraps the topology and context files. Re-run the audit afterwards, then create another repair proposal for the deeper findings.",
    );
  }

  return { ops, notes, manual };

  // Renames only for promoted scopes and WIP collections — content folders
  // are never lint subjects (v0.6).
  async function proposeNamingRepairs(path: string, children: Awaited<ReturnType<Connector["list"]>>, chain: Set<string>[]) {
    for (const child of children) {
      if (child.kind !== "folder" || child.name === ctxName) continue;
      const lastSegment = child.name.split(PIPE).pop() ?? child.name;
      const pipeCheck = checkPipeName(child.name, chain);

      if (lastSegment === WIP_SUFFIX) {
        if (!pipeCheck.ok) {
          const fixedName = `${pipeCheck.expectedPrefix}${PIPE}${WIP_SUFFIX}`;
          ops.push({
            action: "move",
            path: child.path,
            to: `${parentPath(child.path)}/${fixedName}`,
            note: `Rename "${baseName(child.path)}" → "${fixedName}" to mirror ancestry (review carefully — links will need updating)`,
            selected: false,
            risky: true,
          });
        }
        continue;
      }

      const grandchildren = await c.list(child.path);
      const promoted = grandchildren.some((e) => e.name === manifest.scopes.context_file);
      if (promoted && !pipeCheck.ok) {
        const fixedName = `${pipeCheck.expectedPrefix}${PIPE}${lastSegment}`;
        if (fixedName !== child.name) {
          ops.push({
            action: "move",
            path: child.path,
            to: `${parentPath(child.path)}/${fixedName}`,
            note: `Rename "${baseName(child.path)}" → "${fixedName}" to mirror ancestry (review carefully — links will need updating)`,
            selected: false,
            risky: true,
          });
        }
      }
      const ownForms = pipeCheck.ownSegment
        ? allowedForms(pipeCheck.ownSegment)
        : allowedForms(child.name);
      await proposeNamingRepairs(child.path, grandchildren, [...chain, ownForms]);
    }
  }
}
