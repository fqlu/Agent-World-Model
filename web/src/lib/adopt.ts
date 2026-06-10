import { Connector, parentPath, baseName } from "./connector";
import { loadManifest, loadTemplate } from "./spec";
import {
  parseWorkspaceYaml,
  allowedForms,
  checkPipeName,
  Mounts,
  PIPE,
} from "./workspace";
import { Op } from "./ops";
import {
  ScaffoldOptions,
  defaultTopology,
  renderWorkspaceYaml,
  renderProtocol,
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

// Inspect an existing folder and produce a non-destructive plan that makes it
// a compliant workspace: declare/infer topology, generate context files,
// install templates, and (optionally, default-unselected) fix naming.
export async function buildAdoptionPlan(
  c: Connector,
  opts: ScaffoldOptions,
): Promise<{ ops: Op[]; notes: string[] }> {
  const manifest = loadManifest();
  const ops: Op[] = [];
  const notes: string[] = [];

  const root = await c.list("");
  const rootFolders = root.filter((e) => e.kind === "folder");
  const rootNames = new Set(root.map((e) => e.name));

  // --- Topology: declared, or inferred from what exists ---
  let mounts: Mounts;
  const existingDecl = await c.read(manifest.workspace.manifest_file);
  const decl = existingDecl ? parseWorkspaceYaml(existingDecl) : null;

  if (decl?.mounts?.areas?.length) {
    mounts = {
      areas: decl.mounts.areas,
      journal: decl.mounts.journal ?? "Journal",
      templates: decl.mounts.templates ?? "Templates",
      archive: decl.mounts.archive ?? "Archive",
    };
    notes.push("Existing _Workspace.yaml found — using its declared topology.");
  } else {
    const find = (re: RegExp) => rootFolders.find((f) => re.test(f.name))?.name;
    const journal = find(/journal/i) ?? "Journal";
    const templates = find(/template/i) ?? "Templates";
    const archive = find(/archive/i) ?? "Archive";
    const capabilityNames = new Set([journal, templates, archive]);
    const areas = rootFolders.map((f) => f.name).filter((n) => !capabilityNames.has(n));
    const fallback = defaultTopology(opts.profile);
    mounts = {
      areas: areas.length ? areas : fallback.areas,
      journal,
      templates,
      archive,
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

  // --- Capability mounts that don't exist yet ---
  for (const m of [...mounts.areas, mounts.journal, mounts.templates, mounts.archive]) {
    if (!rootNames.has(m)) {
      ops.push({ action: "mkdir", path: m, note: `Create missing mount "${m}"`, selected: true });
    }
  }

  // --- Root context files ---
  ops.push({
    action: "write",
    path: "_PROTOCOL.md",
    content: renderProtocol(opts, mounts),
    overwrite: true,
    note: rootNames.has("_PROTOCOL.md")
      ? "Regenerate _PROTOCOL.md from spec + profile + topology"
      : "Generate the agent rulebook (_PROTOCOL.md)",
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

  // --- Templates ---
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

  // --- Walk areas: missing overviews + naming repairs ---
  for (const area of mounts.areas) {
    if (!rootNames.has(area)) continue;
    const entities = await c.list(area);
    for (const entity of entities) {
      if (entity.kind !== "folder") continue;
      await adoptScope(entity.path, entity.name, [allowedForms(entity.name)]);
    }
  }

  return { ops, notes };

  async function adoptScope(path: string, name: string, chain: Set<string>[]) {
    const children = await c.list(path);
    if (!children.some((e) => e.name === manifest.scopes.context_file)) {
      ops.push({
        action: "write",
        path: `${path}/${manifest.scopes.context_file}`,
        content: renderScopeOverview(name),
        note: `Create missing _Overview.md for scope "${name}"`,
        selected: true,
      });
    }
    for (const child of children) {
      if (child.kind !== "folder") continue;
      const lastSegment = child.name.split(PIPE).pop() ?? child.name;
      if (lastSegment === WIP_SUFFIX) continue;

      const grandchildren = await c.list(child.path);
      const isScope =
        child.name.includes(PIPE) ||
        grandchildren.some((e) => e.name === manifest.scopes.context_file);
      if (!isScope) continue; // asset folder — registration is a human call

      const pipeCheck = checkPipeName(child.name, chain);
      if (!pipeCheck.ok) {
        const fixedName = `${pipeCheck.expectedPrefix}${PIPE}${lastSegment}`;
        if (fixedName !== child.name) {
          ops.push({
            action: "move",
            path: child.path,
            to: `${parentPath(child.path)}/${fixedName}`,
            note: `Rename "${baseName(child.path)}" → "${fixedName}" to mirror ancestry (review carefully — links to this folder will need updating)`,
            selected: false,
            risky: true,
          });
        }
      }
      const ownForms = pipeCheck.ownSegment
        ? allowedForms(pipeCheck.ownSegment)
        : allowedForms(child.name);
      await adoptScope(child.path, lastSegment, [...chain, ownForms]);
    }
  }
}
