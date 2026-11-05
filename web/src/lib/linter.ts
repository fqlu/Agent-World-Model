import { Connector, Entry } from "./connector";
import { loadManifest } from "./spec";
import { resolveProfile } from "./profiles";
import { resolveRuleConfig } from "./rules";
import { DEFAULT_CONTEXT_DIR } from "./context";
import { readDeclInfo, AGENTS_FILE, LEGACY_CONFIG_FILE } from "./config";
import { parseEntityFile } from "./entities";
import {
  parseFrontmatter,
  WorkspaceDecl,
  allowedForms,
  declaredAliases,
  checkPipeName,
  splitPipe,
  separatorOf,
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
// v0.14: an optional " - Title" suffix after the date is allowed — the date
// prefix preserves sorting and journal linking; the title adds scanability.
const WIP_FILE = /^\d{4}-\d{2}-\d{2}( - .+)?\.md$/;
const JOURNAL_FILE = /^\d{4}-\d{2}-\d{2}\.md$/;
const NON_ISO_DATE = /\b(\d{1,2}[./]\d{1,2}[./]\d{4}|\((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\))/;

// v0.6 content-by-default: folders are content unless promoted by containing
// the context file. The linter validates what exists — it never demands
// context machinery below entity level.
export async function runAudit(c: Connector, profileName = "incubeta"): Promise<AuditResult> {
  const manifest = loadManifest();
  const profile = resolveProfile(profileName);
  const findings: Finding[] = [];
  const stats: AuditStats = {
    errors: 0, warns: 0, infos: 0, scopes: 0, overviews: 0, wipNotes: 0, journalDays: 0, groups: 0,
  };

  // Parse the topology declaration first so per-workspace rule overrides
  // (SPEC §9.1) apply to every finding, including the structural ones below.
  const info = await readDeclInfo(c);
  const decl: WorkspaceDecl | null = info.decl;
  const legacy = info.source === "workspace-yaml";
  const configPath = legacy ? LEGACY_CONFIG_FILE : AGENTS_FILE;
  const cfg = resolveRuleConfig(decl);

  // add() honors the workspace's effective severity — a rule set to "off" is
  // silently skipped, and counts use the effective (possibly overridden) level.
  const add = (rule: string, path: string, message: string) => {
    const severity = cfg.severityOf(rule);
    if (severity === "off") return;
    findings.push({ rule, severity, path, message });
    if (severity === "error") stats.errors++;
    else if (severity === "warn") stats.warns++;
    else stats.infos++;
  };

  const root = await c.list("");
  const rootNames = new Set(root.map((e) => e.name));

  // ST-001 — AGENTS.md with a valid config header (v0.16, SPEC §2)
  if (!rootNames.has(AGENTS_FILE)) {
    add("ST-001", AGENTS_FILE, `Missing required root file ${AGENTS_FILE}`);
  } else if (legacy) {
    add(
      "ST-001",
      LEGACY_CONFIG_FILE,
      "Workspace uses the v0.15 layout (_Workspace.yaml); config belongs in the AGENTS.md header — run the v0.16 migration",
    );
  } else if (info.invalidHeader || !decl) {
    add("ST-001", AGENTS_FILE, "AGENTS.md has no valid config header (protocol, owner, mounts)");
  } else {
    const keys = manifest.workspace.required_header_keys ?? ["protocol", "owner", "mounts"];
    const raw = (info.raw ?? {}) as Record<string, unknown>;
    const missing = keys.filter((k) => raw[k] === undefined);
    if (missing.length) add("ST-001", AGENTS_FILE, `Config header missing: ${missing.join(", ")}`);
  }

  if (!decl?.mounts) {
    return { findings, stats, decl };
  }

  const mounts = {
    areas: decl.mounts.areas ?? [],
    journal: decl.mounts.journal ?? "",
    templates: decl.mounts.templates ?? "",
    archive: decl.mounts.archive ?? "",
    context: legacy ? (decl.mounts.context ?? "") : "",
    entities: decl.mounts.entities ?? "",
    proposals: decl.mounts.proposals ?? "",
  };

  // ST-003 — capabilities mounted, >=1 area
  for (const cap of manifest.workspace.required_capabilities) {
    if (!(mounts as Record<string, unknown>)[cap]) {
      add("ST-003", configPath, `Capability "${cap}" is not mounted`);
    }
  }
  if (mounts.areas.length < manifest.workspace.areas_min) {
    add("ST-003", configPath, "At least one area must be declared");
  }

  // ST-002 — declared mounts exist
  const declaredPaths = [
    ...mounts.areas,
    mounts.journal,
    mounts.templates,
    mounts.archive,
    mounts.context,
    mounts.entities,
    mounts.proposals,
  ].filter(Boolean);
  for (const p of declaredPaths) {
    if (!rootNames.has(p)) add("ST-002", p, `Declared mount "${p}" does not exist`);
  }

  // ST-004 — undeclared root items; v0.15 leftovers get a migration hint
  const legacyFiles = new Set([...(manifest.workspace.legacy_root_files ?? []), DEFAULT_CONTEXT_DIR]);
  const allowance = new Set([
    ...manifest.workspace.required_root_files,
    ...declaredPaths,
    ...((profile.root_file_allowance as string[] | undefined) ?? []),
  ]);
  for (const e of root) {
    if (allowance.has(e.name)) continue;
    if (legacyFiles.has(e.name)) {
      // expected in a not-yet-migrated workspace (ST-001 already says so)
      if (!legacy) add("ST-004", e.name, `"${e.name}" is a v0.15 protocol file — archive it (the v0.16 migration does this)`);
      continue;
    }
    add("ST-004", e.name, `Root item "${e.name}" is not declared in the ${configPath} config`);
  }

  const ctxDirName = mounts.context || DEFAULT_CONTEXT_DIR;
  // v0.16 facets declared on scope overviews, checked against entities below
  const facetRefs: { path: string; slug: string }[] = [];

  // ---- Areas ----
  for (const area of mounts.areas) {
    if (!rootNames.has(area)) continue;
    for (const entity of await c.list(area)) {
      if (entity.kind !== "folder") continue;
      if (entity.name === ctxDirName) continue; // legacy context dir (v0.15)
      if (entity.name.includes("|")) {
        add("NM-003", entity.path, `Entity folder name contains a pipe: "${entity.name}"`);
      }
      const children = await c.list(entity.path);
      const hasOverview = children.some((e) => e.name === manifest.scopes.context_file);
      const entityForms = allowedForms(entity.name);
      if (!hasOverview) {
        // SC-001 — entities are the mandatory context anchor
        add("SC-001", entity.path, `Entity is missing ${manifest.scopes.context_file}`);
      } else {
        stats.scopes++;
        stats.overviews++;
        // v0.14 — declared aliases join the ancestry forms (SPEC §3.2)
        const ovMd = await c.read(`${entity.path}/${manifest.scopes.context_file}`);
        for (const a of declaredAliases(ovMd)) entityForms.add(a);
        collectFacets(`${entity.path}/${manifest.scopes.context_file}`, ovMd);
      }
      await walkFolder(entity, children, [entityForms]);
    }
  }

  // ---- Journal ----
  if (mounts.journal && rootNames.has(mounts.journal)) {
    await walkJournal(mounts.journal, mounts.journal);
  }


  // ---- House rules (SPEC §9.2) — workspace-authored checks ----
  const houseRules = decl.house_rules ?? [];
  const exemptName = (name: string) =>
    name.startsWith("_") || name.startsWith(".") || name === "AGENTS.md";
  const addHouse = (id: string, severity: string, path: string, message: string) => {
    if (severity === "off") return;
    findings.push({ rule: id, severity: severity as Finding["severity"], path, message });
    if (severity === "error") stats.errors++;
    else if (severity === "warn") stats.warns++;
    else stats.infos++;
  };
  for (let i = 0; i < houseRules.length; i++) {
    const hr = houseRules[i];
    if (!hr.check) continue; // text-only rule — agent-followed, not audited
    const id = `HR-${i + 1}`;
    const sev = hr.check && hr.severity ? hr.severity : "warn";
    const base = hr.check.applies_to?.trim() || "";
    if (base && !(await c.exists(base))) {
      addHouse(id, sev, base, `House rule "${hr.text}": applies_to path "${base}" not found`);
      continue;
    }
    const files: string[] = [];
    const folders: string[] = [];
    const collect = async (path: string) => {
      for (const e of await c.list(path)) {
        if (e.kind === "folder") {
          folders.push(e.path);
          await collect(e.path);
        } else if (!exemptName(e.name)) {
          files.push(e.path);
        }
      }
    };
    await collect(base);
    if (hr.check.type === "filename_prefix") {
      const allowed = hr.check.allowed ?? [];
      for (const f of files) {
        const name = f.split("/").pop()!;
        if (!allowed.some((p) => name.startsWith(p))) {
          addHouse(id, sev, f, `House rule "${hr.text}": "${name}" lacks an allowed prefix (${allowed.join(", ")})`);
        }
      }
    } else if (hr.check.type === "forbidden_substring") {
      const values = hr.check.values ?? [];
      for (const p of [...files, ...folders]) {
        const name = p.split("/").pop()!;
        const hit = values.find((v) => name.toLowerCase().includes(v.toLowerCase()));
        if (hit) {
          addHouse(id, sev, p, `House rule "${hr.text}": "${name}" contains forbidden substring "${hit}"`);
        }
      }
    }
  }

  // ---- Entities (SPEC §6.6) + Relationships (SPEC §6.7) ----
  if (mounts.entities && rootNames.has(mounts.entities)) {
    const predicates = new Set(cfg.conventions.relationshipPredicates);
    const entityFiles = (await c.list(mounts.entities)).filter(
      (e) => e.kind === "file" && e.name.endsWith(".md"),
    );
    const parsed = new Map<string, ReturnType<typeof parseEntityFile>>();
    const raws = new Map<string, string>();
    const slugs = new Set<string>();
    for (const e of entityFiles) {
      const md = await c.read(e.path);
      if (md !== null) raws.set(e.path, md);
      const ent = md !== null ? parseEntityFile(md) : null;
      parsed.set(e.path, ent);
      if (ent) slugs.add(ent.slug);
    }
    for (const e of entityFiles) {
      const ent = parsed.get(e.path);
      if (!ent) {
        add("EN-001", e.path, "Invalid entity file (needs frontmatter with name + kind person/organization/system/concept)");
        continue;
      }
      stats.entities = (stats.entities ?? 0) + 1;
      if (`${ent.slug}.md` !== e.name) {
        add("EN-002", e.path, `Entity slug "${ent.slug}" does not match filename`);
      }
      for (const r of ent.relations) {
        if (!predicates.has(r.predicate)) {
          add("RL-001", e.path, `Relationship predicate "${r.predicate}" is not ${[...predicates].join(" or ")}`);
        }
        const resolvesEntity = slugs.has(r.target);
        const resolvesScope = !resolvesEntity && (await c.exists(r.target));
        if (!resolvesEntity && !resolvesScope) {
          add("RL-002", e.path, `Relationship target "${r.target}" resolves to neither an entity nor a scope`);
        }
        if (r.predicate === "related-to" && !r.as) {
          add("RL-002", e.path, `related-to "${r.target}" has no \`as\` saying what the relationship is`);
        }
        for (const [k, v] of [["since", r.since], ["until", r.until]] as const) {
          if (v && !/^\d{4}-\d{2}(-\d{2})?$/.test(v)) add("RL-002", e.path, `${k} "${v}" is not an ISO date`);
        }
      }
      const raw = raws.get(e.path);
      if (raw) checkTrustFields(e.path, parseFrontmatter(raw).data);
    }
    // facets on scope overviews must resolve to an entity (SPEC §3.1)
    for (const f of facetRefs) {
      if (!slugs.has(f.slug)) add("RL-002", f.path, `Facet "${f.slug}" doesn't resolve to an entity`);
    }
  } else {
    for (const f of facetRefs) add("RL-002", f.path, `Facet "${f.slug}" declared but the workspace has no entities`);
  }

  return { findings, stats, decl };

  // ---------- helpers ----------

  function collectFacets(p: string, md: string | null) {
    if (!md) return;
    const f = parseFrontmatter(md).data.facets;
    if (Array.isArray(f)) for (const x of f) facetRefs.push({ path: p, slug: String(x).trim() });
  }

  // Trust hygiene (OKF v0.2 alignment, SPEC §12) — applies to entity files and
  // promoted-scope overviews. Purely advisory: warns, never blocks.
  function checkTrustFields(p: string, fm: Record<string, unknown>) {
    const today = new Date().toISOString().slice(0, 10);
    const status = fm.status;
    if (status !== undefined && !["draft", "stable", "deprecated"].includes(String(status))) {
      add("TR-002", p, `status "${String(status)}" not one of draft/stable/deprecated`);
    }
    const stale = fm.stale_after;
    if (stale !== undefined) {
      const s = String(stale);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        add("TR-002", p, `stale_after "${s}" is not an ISO date (YYYY-MM-DD)`);
      } else if (s < today && String(status ?? "stable") !== "deprecated") {
        add("TR-001", p, `Stale since ${s} — re-verify or deprecate`);
      }
    }
  }

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

      if (child.name === ctxDirName) continue; // legacy context dir (v0.15)

      const lastSegment = splitPipe(child.name).pop() ?? child.name;
      const pipeCheck = checkPipeName(child.name, chain);

      if (lastSegment === WIP_SUFFIX) {
        if (!pipeCheck.ok) {
          add("NM-001", child.path, `WIP Notes folder should be named "${pipeCheck.expectedPrefix}${separatorOf(child.name)}${WIP_SUFFIX}"`);
        }
        await checkWipFolder(child);
        continue;
      }

      const grandchildren = await c.list(child.path);
      const promoted = grandchildren.some((e) => e.name === manifest.scopes.context_file);

      let scopeOverviewMd: string | null = null;
      if (promoted) {
        stats.scopes++;
        stats.overviews++;
        scopeOverviewMd = await c.read(`${child.path}/${manifest.scopes.context_file}`);
        if (!pipeCheck.ok) {
          add("NM-001", child.path, `Scope name should start with "${pipeCheck.expectedPrefix}${separatorOf(child.name)}…" mirroring its ancestry`);
        }
        if (NON_ISO_DATE.test(child.name)) {
          add("NM-002", child.path, `Scope name contains a non-ISO date: "${child.name}"`);
        }
        // DC-001 — workstream/project scopes directly under an entity (depth-2)
        // declare a scope_type. (chain is [entity] at depth-2.)
        if (chain.length === (manifest.scopes.scope_type_required_at_depth ?? 2) - 1) {
          const st = scopeOverviewMd !== null ? (parseFrontmatter(scopeOverviewMd).data.scope_type as string | undefined) : undefined;
          const allowed = manifest.scopes.scope_types ?? ["workstream", "project"];
          if (!st || !allowed.includes(st)) {
            add("DC-001", child.path, st ? `scope_type "${st}" not one of ${allowed.join(", ")}` : `Scope is missing a scope_type (${allowed.join("/")}) — see §3.1`);
          }
        }
        collectFacets(`${child.path}/${manifest.scopes.context_file}`, scopeOverviewMd);
        if (scopeOverviewMd !== null) {
          checkTrustFields(`${child.path}/${manifest.scopes.context_file}`, parseFrontmatter(scopeOverviewMd).data);
        }
      }

      const ownForms = pipeCheck.ownSegment
        ? allowedForms(pipeCheck.ownSegment)
        : allowedForms(child.name);
      // v0.14 — declared aliases join the scope's forms for descendant checks
      for (const a of declaredAliases(scopeOverviewMd)) ownForms.add(a);
      await walkFolder(child, grandchildren, [...chain, ownForms]);
    }
  }

  async function checkWipFolder(folder: Entry) {
    const notes = await c.list(folder.path);
    for (const n of notes) {
      if (n.kind === "folder") continue;
      if (!WIP_FILE.test(n.name)) {
        add("CL-001", n.path, `WIP note not named "YYYY-MM-DD.md" (or "YYYY-MM-DD - Title.md"): "${n.name}"`);
        continue;
      }
      stats.wipNotes++;
      const md = await c.read(n.path);
      if (md !== null) {
        const missing = cfg.conventions.wipRequiredSections.filter(
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
    }
  }
}
