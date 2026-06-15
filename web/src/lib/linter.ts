import { Connector, Entry } from "./connector";
import { loadManifest, ruleDef } from "./spec";
import { parseGroupFile, DEFAULT_CONTEXT_DIR } from "./context";
import { parseEntityFile } from "./entities";
import {
  parseWorkspaceYaml,
  WorkspaceDecl,
  allowedForms,
  checkPipeName,
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
  groups?: number;
  entities?: number;
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

// v0.6 content-by-default: folders are content unless promoted by containing
// the context file. The linter validates what exists — it never demands
// context machinery below entity level.
export async function runAudit(c: Connector, profileName = "incubeta"): Promise<AuditResult> {
  const manifest = loadManifest();
  const profile = manifest.profiles[profileName] ?? {};
  const findings: Finding[] = [];
  const stats: AuditStats = {
    errors: 0, warns: 0, infos: 0, scopes: 0, overviews: 0, wipNotes: 0, journalDays: 0, groups: 0,
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
    return { findings, stats, decl };
  }

  const mounts = {
    areas: decl.mounts.areas ?? [],
    journal: decl.mounts.journal ?? "",
    templates: decl.mounts.templates ?? "",
    archive: decl.mounts.archive ?? "",
    context: decl.mounts.context ?? "",
    entities: decl.mounts.entities ?? "",
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
  const declaredPaths = [
    ...mounts.areas,
    mounts.journal,
    mounts.templates,
    mounts.archive,
    mounts.context,
    mounts.entities,
  ].filter(Boolean);
  for (const p of declaredPaths) {
    if (!rootNames.has(p)) add("ST-002", p, `Declared mount "${p}" does not exist`);
  }

  // ST-004 — undeclared root items
  const allowance = new Set([
    ...manifest.workspace.required_root_files,
    ...(manifest.workspace.optional_root_files ?? []),
    ...declaredPaths,
    ...((profile.root_file_allowance as string[] | undefined) ?? []),
  ]);
  for (const e of root) {
    if (!allowance.has(e.name)) {
      add("ST-004", e.name, `Root item "${e.name}" is not declared in ${manifest.workspace.manifest_file}`);
    }
  }

  // ST-005 — rulebook in sync
  const rulebook = manifest.workspace.rulebook_file;
  const protocol = await c.read(rulebook);
  if (protocol !== null) {
    if (decl.spec_version && !protocol.includes(String(decl.spec_version))) {
      add("ST-005", rulebook, `Does not mention declared spec version ${decl.spec_version}`);
    }
    if (decl.profile && !protocol.includes(String(decl.profile))) {
      add("ST-005", rulebook, `Does not mention declared profile "${decl.profile}"`);
    }
  }

  if (await c.exists("_Overview.md")) stats.overviews++;

  const ctxDirName = mounts.context || DEFAULT_CONTEXT_DIR;

  // ---- Areas ----
  for (const area of mounts.areas) {
    if (!rootNames.has(area)) continue;
    for (const entity of await c.list(area)) {
      if (entity.kind !== "folder") continue;
      if (entity.name === ctxDirName) {
        await checkContextDir(entity.path, area);
        continue;
      }
      if (entity.name.includes("|")) {
        add("NM-003", entity.path, `Entity folder name contains a pipe: "${entity.name}"`);
      }
      const children = await c.list(entity.path);
      const hasOverview = children.some((e) => e.name === manifest.scopes.context_file);
      if (!hasOverview) {
        // SC-001 — entities are the mandatory context anchor
        add("SC-001", entity.path, `Entity is missing ${manifest.scopes.context_file}`);
      } else {
        stats.scopes++;
        stats.overviews++;
      }
      await walkFolder(entity, children, [allowedForms(entity.name)]);
    }
  }

  // ---- Journal ----
  if (mounts.journal && rootNames.has(mounts.journal)) {
    await walkJournal(mounts.journal, mounts.journal);
  }

  // ---- Root-level context groups (SPEC §6.4) ----
  if (mounts.context && rootNames.has(mounts.context)) {
    await checkContextDir(mounts.context, "");
  }

  // ---- Entities (SPEC §6.6) + Relationships (SPEC §6.7) ----
  if (mounts.entities && rootNames.has(mounts.entities)) {
    const predicates = new Set(manifest.relationships?.predicates ?? []);
    const entityFiles = (await c.list(mounts.entities)).filter(
      (e) => e.kind === "file" && e.name.endsWith(".md"),
    );
    const parsed = new Map<string, ReturnType<typeof parseEntityFile>>();
    const slugs = new Set<string>();
    for (const e of entityFiles) {
      const md = await c.read(e.path);
      const ent = md !== null ? parseEntityFile(md) : null;
      parsed.set(e.path, ent);
      if (ent) slugs.add(ent.slug);
    }
    for (const e of entityFiles) {
      const ent = parsed.get(e.path);
      if (!ent) {
        add("EN-001", e.path, "Invalid entity file (needs frontmatter with name + kind person/system/concept)");
        continue;
      }
      stats.entities = (stats.entities ?? 0) + 1;
      if (`${ent.slug}.md` !== e.name) {
        add("EN-002", e.path, `Entity slug "${ent.slug}" does not match filename`);
      }
      for (const r of ent.relations) {
        if (!predicates.has(r.predicate)) {
          add("RL-001", e.path, `Relationship predicate "${r.predicate}" not in vocabulary`);
        }
        const resolvesEntity = slugs.has(r.target);
        const resolvesScope = !resolvesEntity && (await c.exists(r.target));
        if (!resolvesEntity && !resolvesScope) {
          add("RL-002", e.path, `Relationship target "${r.target}" resolves to neither an entity nor a scope`);
        }
      }
    }
  }

  return { findings, stats, decl };

  // ---------- helpers ----------

  // Walk every folder; lint only entities, promoted scopes, and collections.
  // Content folders pass through silently (but may contain context dirs and
  // promoted scopes deeper down, so the walk continues).
  async function walkFolder(folder: Entry, children: Entry[], chain: Set<string>[]) {
    const tasks = children.find((e) => e.name === "_Tasks.md");
    if (tasks) {
      const md = await c.read(tasks.path);
      if (md !== null && (!md.includes("## Open") || !md.includes("## Done"))) {
        add("TK-001", tasks.path, "_Tasks.md missing '## Open' / '## Done' sections");
      }
    }

    for (const child of children) {
      if (child.kind !== "folder") continue;

      if (child.name === ctxDirName) {
        await checkContextDir(child.path, folder.path);
        continue;
      }

      const lastSegment = child.name.split(PIPE).pop() ?? child.name;
      const pipeCheck = checkPipeName(child.name, chain);

      if (lastSegment === WIP_SUFFIX) {
        if (!pipeCheck.ok) {
          add("NM-001", child.path, `WIP Notes folder should be named "${pipeCheck.expectedPrefix}${PIPE}${WIP_SUFFIX}"`);
        }
        await checkWipFolder(child);
        continue;
      }

      const grandchildren = await c.list(child.path);
      const promoted = grandchildren.some((e) => e.name === manifest.scopes.context_file);

      if (promoted) {
        stats.scopes++;
        stats.overviews++;
        if (!pipeCheck.ok) {
          add("NM-001", child.path, `Scope name should start with "${pipeCheck.expectedPrefix}${PIPE}…" mirroring its ancestry`);
        }
        if (NON_ISO_DATE.test(child.name)) {
          add("NM-002", child.path, `Scope name contains a non-ISO date: "${child.name}"`);
        }
      }

      const ownForms = pipeCheck.ownSegment
        ? allowedForms(pipeCheck.ownSegment)
        : allowedForms(child.name);
      await walkFolder(child, grandchildren, [...chain, ownForms]);
    }
  }

  // Validate a context directory: group files parse, slugs match filenames,
  // members exist under the containing folder.
  async function checkContextDir(dirPath: string, parentPath: string) {
    for (const e of await c.list(dirPath)) {
      if (e.kind !== "file" || !e.name.endsWith(".md")) continue;
      const md = await c.read(e.path);
      const g = md !== null ? parseGroupFile(md) : null;
      if (!g) {
        add("CX-001", e.path, "Invalid context group file (needs frontmatter with name, title, members)");
        continue;
      }
      stats.groups = (stats.groups ?? 0) + 1;
      if (`${g.slug}.md` !== e.name) {
        add("CX-001", e.path, `Group name "${g.slug}" does not match filename`);
      }
      for (const m of g.members) {
        const memberPath = parentPath ? `${parentPath}/${m.path}` : m.path;
        if (m.path.startsWith("/") || m.path.split("/").some((s) => s === "..")) {
          add("CX-002", e.path, `Member "${m.path}" must be a relative descendant path`);
        } else if (!(await c.exists(memberPath))) {
          add("CX-002", e.path, `Member "${m.path}" does not exist under ${parentPath || "(root)"}`);
        }
      }
    }
  }

  async function checkWipFolder(folder: Entry) {
    const notes = await c.list(folder.path);
    for (const n of notes) {
      if (n.kind === "folder") continue;
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
