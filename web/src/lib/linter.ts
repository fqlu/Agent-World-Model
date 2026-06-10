import { Connector, Entry } from "./connector";
import { loadManifest, ruleDef } from "./spec";
import {
  parseWorkspaceYaml,
  WorkspaceDecl,
  allowedForms,
  checkPipeName,
  headings,
  sectionLines,
  PIPE,
} from "./workspace";

export type Finding = {
  rule: string;
  severity: "error" | "warn" | "info";
  path: string;
  message: string;
};

export type AuditStats = {
  errors: number;
  warns: number;
  infos: number;
  scopes: number;
  overviews: number;
  wipNotes: number;
  journalDays: number;
};

export type AuditResult = {
  findings: Finding[];
  stats: AuditStats;
  decl: WorkspaceDecl | null;
};

const WIP_SUFFIX = "WIP Notes";
const WIP_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;
const JOURNAL_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;
const NON_ISO_DATE = /\b(\d{1,2}[./]\d{1,2}[./]\d{4}|\((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\))/;

export async function runAudit(c: Connector, profileName = "incubeta"): Promise<AuditResult> {
  const manifest = loadManifest();
  const profile = manifest.profiles[profileName] ?? {};
  const findings: Finding[] = [];
  const stats: AuditStats = {
    errors: 0, warns: 0, infos: 0, scopes: 0, overviews: 0, wipNotes: 0, journalDays: 0,
  };

  const add = (rule: string, path: string, message: string) => {
    const def = ruleDef(rule);
    findings.push({ rule, severity: def.severity, path, message });
    if (def.severity === "error") stats.errors++;
    else if (def.severity === "warn") stats.warns++;
    else stats.infos++;
  };

  const root = await c.list("");
  const rootNames = new Set(root.map((e) => e.name));

  // ST-001 — required root files
  for (const f of manifest.workspace.required_root_files) {
    if (!rootNames.has(f)) add("ST-001", f, `Missing required root file ${f}`);
  }

  // Parse the topology declaration
  let decl: WorkspaceDecl | null = null;
  const wsRaw = await c.read(manifest.workspace.manifest_file);
  if (wsRaw !== null) {
    decl = parseWorkspaceYaml(wsRaw);
    if (!decl) add("ST-001", manifest.workspace.manifest_file, "Topology manifest is not valid YAML");
  }

  if (!decl?.mounts) {
    // Without a declaration we can't audit deeper — report and stop.
    return { findings, stats, decl };
  }

  const mounts = {
    areas: decl.mounts.areas ?? [],
    journal: decl.mounts.journal ?? "",
    templates: decl.mounts.templates ?? "",
    archive: decl.mounts.archive ?? "",
  };

  // ST-003 — capabilities mounted, >=1 area
  for (const cap of manifest.workspace.required_capabilities) {
    if (!(mounts as Record<string, unknown>)[cap]) {
      add("ST-003", manifest.workspace.manifest_file, `Capability "${cap}" is not mounted`);
    }
  }
  if (mounts.areas.length < manifest.workspace.areas_min) {
    add("ST-003", manifest.workspace.manifest_file, "At least one area must be declared");
  }

  // ST-002 — declared mounts exist
  const declaredPaths = [...mounts.areas, mounts.journal, mounts.templates, mounts.archive].filter(Boolean);
  for (const p of declaredPaths) {
    if (!rootNames.has(p)) add("ST-002", p, `Declared mount "${p}" does not exist`);
  }

  // ST-004 — undeclared root items
  const allowance = new Set([
    ...manifest.workspace.required_root_files,
    ...declaredPaths,
    ...((profile.root_file_allowance as string[] | undefined) ?? []),
  ]);
  for (const e of root) {
    if (!allowance.has(e.name)) {
      add("ST-004", e.name, `Root item "${e.name}" is not declared in ${manifest.workspace.manifest_file}`);
    }
  }

  // ST-005 — protocol in sync
  const protocol = await c.read("_PROTOCOL.md");
  if (protocol !== null) {
    if (decl.spec_version && !protocol.includes(String(decl.spec_version))) {
      add("ST-005", "_PROTOCOL.md", `Does not mention declared spec version ${decl.spec_version}`);
    }
    if (decl.profile && !protocol.includes(String(decl.profile))) {
      add("ST-005", "_PROTOCOL.md", `Does not mention declared profile "${decl.profile}"`);
    }
  }

  // Root overview
  const rootOverview = await c.read("_Overview.md");
  if (rootOverview !== null) checkOverview("_Overview.md", rootOverview);

  // ---- Areas ----
  for (const area of mounts.areas) {
    if (!rootNames.has(area)) continue;
    const entities = await c.list(area);
    for (const entity of entities) {
      if (entity.kind !== "folder") continue;
      if (entity.name.includes("|")) {
        add("NM-003", entity.path, `Entity folder name contains a pipe: "${entity.name}"`);
      }
      stats.scopes++;
      await checkScope(entity, [allowedForms(entity.name)], true);
    }
  }

  // ---- Journal ----
  if (mounts.journal && rootNames.has(mounts.journal)) {
    await walkJournal(mounts.journal, mounts.journal);
  }

  return { findings, stats, decl };

  // ---------- helpers ----------

  function checkOverview(path: string, md: string) {
    stats.overviews++;
    const hs = headings(md);
    const required = manifest.scopes.overview_required_sections;
    let cursor = -1;
    const missing: string[] = [];
    for (const sec of required) {
      const idx = hs.indexOf(sec);
      if (idx === -1) missing.push(sec);
      else if (idx < cursor) {
        add("OV-001", path, `Section "${sec}" out of order`);
        cursor = idx;
      } else cursor = idx;
    }
    if (missing.length) {
      add("OV-001", path, `Missing section(s): ${missing.join(", ")}`);
    }
    const recent = sectionLines(md, "Recent activity").filter((l) => l.trim().startsWith("- "));
    if (recent.length > manifest.scopes.recent_activity_cap + 2) {
      add("OV-002", path, `Recent activity has ${recent.length} entries (cap ~${manifest.scopes.recent_activity_cap})`);
    }
  }

  async function checkScope(folder: Entry, chain: Set<string>[], isEntity: boolean) {
    const children = await c.list(folder.path);
    const overview = children.find((e) => e.name === manifest.scopes.context_file);
    let parentOverviewMd: string | null = null;

    if (!overview) {
      add("SC-001", folder.path, `Scope is missing ${manifest.scopes.context_file}`);
    } else {
      parentOverviewMd = await c.read(overview.path);
      if (parentOverviewMd !== null) checkOverview(overview.path, parentOverviewMd);
    }

    const tasks = children.find((e) => e.name === "_Tasks.md");
    if (tasks) {
      const md = await c.read(tasks.path);
      if (md !== null && (!md.includes("## Open") || !md.includes("## Done"))) {
        add("TK-001", tasks.path, "_Tasks.md missing '## Open' / '## Done' sections");
      }
    }

    for (const child of children) {
      // NM-002 — non-ISO dates in any name
      if (NON_ISO_DATE.test(child.name)) {
        add("NM-002", child.path, `Name contains a non-ISO date: "${child.name}"`);
      }
      if (child.kind !== "folder") continue;

      const pipeCheck = checkPipeName(child.name, chain);
      const lastSegment = child.name.split(PIPE).pop() ?? child.name;

      // SC-002 — per-type subfolders
      if (manifest.scopes.forbidden_subfolders.includes(lastSegment)) {
        add("SC-002", child.path, `Per-type subfolder "${lastSegment}" — files should live directly in the scope`);
      }

      if (lastSegment === WIP_SUFFIX) {
        if (!pipeCheck.ok) {
          add("NM-001", child.path, `WIP Notes folder should be named "${pipeCheck.expectedPrefix}${PIPE}${WIP_SUFFIX}"`);
        }
        await checkWipFolder(child);
        continue;
      }

      const grandchildren = await c.list(child.path);
      const hasOverview = grandchildren.some((e) => e.name === manifest.scopes.context_file);
      const looksPiped = child.name.includes(PIPE);

      if (hasOverview || looksPiped) {
        // It's a scope
        stats.scopes++;
        if (!pipeCheck.ok) {
          add("NM-001", child.path, `Scope name should start with "${pipeCheck.expectedPrefix}${PIPE}…" mirroring its ancestry`);
        }
        const ownForms = pipeCheck.ownSegment ? allowedForms(pipeCheck.ownSegment) : allowedForms(child.name);
        await checkScope(child, [...chain, ownForms], false);
      } else {
        // Asset folder or unclassifiable
        add("SC-004", child.path, `Folder is neither a scope (no ${manifest.scopes.context_file}) nor a recognised collection`);
        if (parentOverviewMd && !parentOverviewMd.includes(child.name)) {
          add("SC-003", child.path, `Asset folder not referenced from parent ${manifest.scopes.context_file}`);
        }
      }
    }
    void isEntity;
  }

  async function checkWipFolder(folder: Entry) {
    const notes = await c.list(folder.path);
    for (const n of notes) {
      if (n.kind === "folder") {
        add("SC-004", n.path, "Folder inside a WIP Notes collection");
        continue;
      }
      if (!WIP_FILE.test(n.name)) {
        add("CL-001", n.path, `WIP note not named YYYY-MM-DD.md: "${n.name}"`);
        continue;
      }
      stats.wipNotes++;
      const md = await c.read(n.path);
      if (md !== null) {
        const missing = manifest.collections.wip_notes.required_sections.filter(
          (s) => !md.includes(`## ${s}`),
        );
        if (missing.length) {
          add("CL-002", n.path, `WIP note missing section(s): ${missing.join(", ")}`);
        }
      }
    }
  }

  async function walkJournal(path: string, mount: string) {
    const entries = await c.list(path);
    for (const e of entries) {
      if (e.kind === "folder") {
        await walkJournal(e.path, mount);
        continue;
      }
      const rel = e.path.slice(mount.length + 1);
      const okPath = /^\d{4}\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}\.md$/.test(rel) && JOURNAL_FILE.test(e.name);
      if (!okPath) {
        add("JR-001", e.path, `Journal file not at <journal>/YYYY/YYYY-MM/YYYY-MM-DD.md`);
        continue;
      }
      stats.journalDays++;
      const md = await c.read(e.path);
      if (md !== null) {
        // Agent activity records are logs, not index lines — exempt from JR-002.
        const heading = `## ${manifest.collections.journal.agent_activity_heading}`;
        let inAgentActivity = false;
        const bulletNoLink = md.split("\n").filter((l) => {
          if (l.startsWith("## ")) inAgentActivity = l.trim() === heading;
          return (
            !inAgentActivity &&
            l.trim().startsWith("- ") &&
            !l.includes("](") &&
            l.trim().length > 4
          );
        });
        if (bulletNoLink.length > 0) {
          add("JR-002", e.path, `${bulletNoLink.length} journal line(s) without links — journal should be an index`);
        }
      }
    }
  }
}
