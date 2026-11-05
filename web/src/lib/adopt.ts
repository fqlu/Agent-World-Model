import { Connector, parentPath, baseName } from "./connector";
import { loadManifest, loadTemplate } from "./spec";
import { allowedForms, checkPipeName, splitPipe, separatorOf, Mounts } from "./workspace";
import { readDeclInfo, resolveMounts, versionToProtocol, headerToDecl } from "./config";
import { briefPath, renderDreamingBrief } from "./dreaming";
import { buildHeader } from "./scaffold";
import { Op } from "./ops";
import { runAudit, Finding } from "./linter";
import {
  ScaffoldOptions,
  defaultTopology,
  renderAgentsMd,
  TEMPLATE_FILES,
} from "./scaffold";

const WIP_SUFFIX = "WIP Notes";

function renderScopeOverview(name: string, profile?: string): string {
  // Strip the template's leading frontmatter — generated entity overviews are
  // the client level, which doesn't carry scope_type (§3.1).
  const raw = loadTemplate("_Overview.md", profile).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  return raw
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
  const info = await readDeclInfo(c);
  if (info.source === "workspace-yaml") {
    notes.push(
      "This workspace uses the v0.15 layout (_Workspace.yaml). Run \"Migrate to v0.16\" instead of a repair — it moves the config into AGENTS.md and archives the old protocol files.",
    );
    return { ops, notes, manual };
  }
  const decl = info.decl;
  const declared = Boolean(decl?.mounts?.areas?.length);

  if (declared) {
    mounts = resolveMounts(decl);
    notes.push("Config header found in AGENTS.md — using its declared topology.");
    const header = { ...(info.raw ?? {}) };
    const wanted = versionToProtocol(manifest.spec_version);
    if (header.protocol !== wanted) {
      notes.push(`Upgrading declared protocol ${String(header.protocol)} → ${wanted}.`);
      header.protocol = wanted;
    }
    ops.push({
      action: "write",
      path: "AGENTS.md",
      content: renderAgentsMd(
        { ...opts, ownerName: decl?.owner?.name ?? opts.ownerName, ownerEmail: decl?.owner?.email ?? opts.ownerEmail },
        mounts,
        decl,
        header,
      ),
      overwrite: true,
      note: "Re-render AGENTS.md from its config header + spec + profile",
      selected: true,
    });
  } else {
    const find = (re: RegExp) => rootFolders.find((f) => re.test(f.name))?.name;
    const fallback = defaultTopology(opts.profile);
    const journal = find(/journal/i) ?? fallback.journal;
    const templates = find(/template/i) ?? fallback.templates;
    const archive = find(/archive/i) ?? fallback.archive;
    const entities = find(/^_?entities$/i) ?? fallback.entities ?? "_Entities";
    const proposals = find(/^_?proposals$/i) ?? fallback.proposals ?? "_Proposals";
    const capabilityNames = new Set([journal, templates, archive, entities, proposals]);
    const areas = rootFolders
      .map((f) => f.name)
      .filter((n) => !capabilityNames.has(n) && !n.startsWith("_"));
    mounts = { areas: areas.length ? areas : fallback.areas, journal, templates, archive, entities, proposals };
    notes.push(
      `Inferred topology — areas: [${mounts.areas.join(", ")}], journal: ${journal}, templates: ${templates}, archive: ${archive}. Edit the AGENTS.md config header afterwards if this guess is wrong.`,
    );
    ops.push({
      action: "write",
      path: "AGENTS.md",
      content: renderAgentsMd(opts, mounts),
      overwrite: true,
      note: rootNames.has("AGENTS.md")
        ? "Replace AGENTS.md with the protocol rulebook + config header (the old file is archived first)"
        : "Write AGENTS.md: config header (inferred topology) + agent rulebook",
      selected: true,
    });
    if (rootNames.has("AGENTS.md")) {
      const old = await c.read("AGENTS.md");
      if (old !== null) {
        ops.unshift({
          action: "write",
          path: `${mounts.archive}/AGENTS.md`,
          content: old,
          note: "Archive the existing AGENTS.md before replacing it",
          selected: true,
        });
      }
    }
  }

  for (const m of [...mounts.areas, mounts.journal, mounts.templates, mounts.archive, mounts.entities, mounts.proposals]) {
    if (m && !rootNames.has(m)) {
      ops.push({ action: "mkdir", path: m, note: `Create missing folder "${m}"`, selected: true });
    }
  }

  for (const t of TEMPLATE_FILES) {
    const p = `${mounts.templates}/${t.workspace}`;
    if (!(await c.exists(p))) {
      ops.push({
        action: "write",
        path: p,
        content: loadTemplate(t.spec, opts.profile),
        note: `Install template "${t.workspace}"`,
        selected: true,
      });
    }
  }

  // The dreaming agent's brief (spec/DREAMING.md), from the (new or existing) header
  {
    const d = declared ? decl : headerToDecl(buildHeader(opts, mounts));
    ops.push({
      action: "write",
      path: briefPath(d),
      content: renderDreamingBrief(d, { workspaceName: opts.workspaceName }),
      overwrite: true,
      note: (await c.exists(briefPath(d))) ? "Re-generate the dreaming agent's brief" : "Write the dreaming agent's brief (spec/DREAMING.md)",
      selected: true,
    });
  }

  // Entity overviews (the only mandatory context anchor) + naming repairs
  // for promoted scopes and collections. Content folders are left alone.
  const ctxName = "_Context"; // legacy context dirs are never entities
  for (const area of mounts.areas) {
    if (!rootNames.has(area)) continue;
    for (const entity of await c.list(area)) {
      if (entity.kind !== "folder" || entity.name === ctxName) continue;
      const children = await c.list(entity.path);
      if (!children.some((e) => e.name === manifest.scopes.context_file)) {
        ops.push({
          action: "write",
          path: `${entity.path}/${manifest.scopes.context_file}`,
          content: renderScopeOverview(entity.name, opts.profile),
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
              : `Archive undeclared root item "${f.path}" (alternatives: move it into a scope, or declare it as a mount in the AGENTS.md config)`,
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
      const lastSegment = splitPipe(child.name).pop() ?? child.name;
      const sep = separatorOf(child.name);
      const pipeCheck = checkPipeName(child.name, chain);

      if (lastSegment === WIP_SUFFIX) {
        if (!pipeCheck.ok) {
          const fixedName = `${pipeCheck.expectedPrefix}${sep}${WIP_SUFFIX}`;
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
        const fixedName = `${pipeCheck.expectedPrefix}${sep}${lastSegment}`;
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
