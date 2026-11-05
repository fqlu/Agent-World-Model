import path from "node:path";
import YAML from "yaml";
import { Connector } from "./connector";
import { loadManifest, loadTemplate } from "./spec";
import { Mounts, parseFrontmatter, sectionLines } from "./workspace";
import { readDeclInfo, headerToDecl, versionToProtocol } from "./config";
import { parseGroupFile, DEFAULT_CONTEXT_DIR } from "./context";
import { slugify } from "./entities";
import { renderAgentsMd, TEMPLATE_FILES } from "./scaffold";
import { Op } from "./ops";

// Migration v0.15 → v0.16 (SPEC §13), as ONE reviewable plan of ops. Nothing
// is deleted: every file the plan overwrites is first copied to
// <archive>/_protocol-v0.15/<path>, and every retired protocol file is moved
// there. Bulk moves skip the reference cascade (links are rewritten here).

export type MigrationOptions = { workspaceName: string; profile: string; ownerName?: string; ownerEmail?: string };
export type MigrationPlan = { ops: Op[]; notes: string[]; manual: string[]; summary: Record<string, number> };

const LEGACY_ROOT_FILES = ["_Workspace.yaml", "_Overview.md", "_Index.md", "_Model.json", "_Digest.md"];
const REMOVED_RULES = new Set(["ST-005", "CX-001", "CX-002", "JR-002"]);
const posix = path.posix;

type Rel = Record<string, unknown> & { predicate?: unknown; target?: unknown; note?: unknown };

// First clause of a note, as a short description (`as`).
export function gist(note: unknown, max = 80): string | undefined {
  if (typeof note !== "string" || !note.trim()) return undefined;
  const first = note.trim().split(/;\s|\s[—–]\s|\.\s/)[0].trim().replace(/\.$/, "");
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : max).trim()}…`;
}

// SPEC §13 step 5a: map one v0.15 relation to the v0.16 shape. Returns null
// when the edge should be dropped (a mirror of an existing `uses` edge).
export function migrateRelation(
  r: Rel,
  subject: string,
  hasInverseUses: (from: string, to: string) => boolean,
): Rel | null {
  const pred = String(r.predicate ?? "");
  const target = String(r.target ?? "");
  const note = typeof r.note === "string" ? r.note : undefined;
  const g = gist(note);
  const out: Rel = {};
  const finish = (predicate: string, as?: string): Rel => {
    out.predicate = predicate;
    out.target = target;
    if (as) out.as = as;
    for (const k of ["since", "until"]) if (r[k] !== undefined) out[k] = r[k];
    if (note) out.note = note;
    return out;
  };
  switch (pred) {
    case "member-of":
      return finish("member-of", typeof r.as === "string" ? r.as : g);
    case "previously-member-of": {
      const d = note?.match(/\b\d{4}-\d{2}(-\d{2})?\b/)?.[0];
      if (d) out.until = d;
      return finish("member-of", d ? g : `former${g ? `: ${g}` : ""}`);
    }
    case "leads":
      return finish("member-of", "lead");
    case "works-on":
      return finish("member-of", g ?? "works on");
    case "owns":
      return target.includes("/") ? finish("member-of", "owner") : finish("related-to", "owner");
    case "deployed-for":
      if (hasInverseUses(target, subject)) return null;
      return finish("related-to", `deployed for${g ? `: ${g}` : ""}`);
    case "uses":
    case "provides":
    case "depends-on":
    case "reports-to": {
      const verb = pred.replace("-", " ");
      return finish("related-to", `${verb}${g ? `: ${g}` : ""}`);
    }
    case "related-to":
      return finish("related-to", typeof r.as === "string" ? r.as : (g ?? "related"));
    default:
      return finish("related-to", `${pred}${g ? `: ${g}` : ""}`);
  }
}

// Rewrite markdown links whose targets move. `mapPath` maps an old
// workspace-relative path to its new one; file = the old path of the file.
export function rewriteLinks(md: string, file: string, mapPath: (p: string) => string): string {
  const oldDir = posix.dirname(file);
  const newDir = posix.dirname(mapPath(file));
  return md.replace(/\]\(((?:[^()\n]|\([^()\n]*\))+)\)/g, (whole, inner: string) => {
    const m = inner.match(/^(\S+?|[^"]+?)(\s+"[^"]*")?$/);
    if (!m) return whole;
    const target = m[1].trim();
    const title = m[2] ?? "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("/")) return whole;
    const [rawPath, anchor] = target.split("#");
    if (!rawPath) return whole;
    let decoded = rawPath;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      /* leave as-is */
    }
    const resolved = posix.normalize(posix.join(oldDir, decoded));
    if (resolved.startsWith("..")) return whole;
    const mapped = mapPath(resolved);
    if (mapped === resolved && newDir === oldDir) return whole;
    const newRel = posix.relative(newDir, mapped) || posix.basename(mapped);
    if (mapped === resolved && newRel === posix.relative(oldDir, resolved)) return whole;
    const encoded = rawPath.includes("%") ? encodeURI(newRel).replace(/&/g, "%26") : newRel;
    return `](${encoded}${anchor !== undefined ? `#${anchor}` : ""}${title})`;
  });
}

function withFrontmatter(md: string, edit: (doc: YAML.Document) => void): string {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const doc = YAML.parseDocument(m ? m[1] : "");
  if (!doc.contents) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  edit(doc);
  const body = m ? m[2] : md;
  return `---\n${doc.toString().trimEnd()}\n---\n${m ? "" : "\n"}${body}`;
}

export async function buildMigrationPlan(c: Connector, opts: MigrationOptions): Promise<MigrationPlan> {
  const manifest = loadManifest();
  const notes: string[] = [];
  const manual: string[] = [];
  const summary: Record<string, number> = {};
  const count = (k: string) => (summary[k] = (summary[k] ?? 0) + 1);

  const info = await readDeclInfo(c);
  if (info.source !== "workspace-yaml" || !info.decl) {
    notes.push(
      info.source === "agents-header"
        ? "Already on v0.16 (config lives in the AGENTS.md header). Nothing to migrate."
        : "No v0.15 config (_Workspace.yaml) found. Use a repair / adoption proposal instead.",
    );
    return { ops: [], notes, manual, summary };
  }
  const old = info.decl;
  const om = old.mounts ?? {};
  const oldJournal = om.journal ?? "Journal";
  const oldTemplates = om.templates ?? "Templates";
  const archive = om.archive ?? "Archive";
  const ctxName = om.context ?? DEFAULT_CONTEXT_DIR;
  const ARCH = `${archive}/_protocol-v0.15`;
  const underscore = (n: string) => (n.startsWith("_") ? n : `_${n}`);
  const root = await c.list("");
  const rootNames = new Set(root.map((e) => e.name));
  const pick = (oldName: string) => {
    const want = underscore(oldName);
    if (want !== oldName && rootNames.has(want)) {
      notes.push(`"${want}" already exists, so "${oldName}" keeps its name.`);
      return oldName;
    }
    return want;
  };
  const newJournal = pick(oldJournal);
  const newTemplates = pick(oldTemplates);
  const mounts: Mounts = {
    areas: om.areas ?? [],
    journal: newJournal,
    templates: newTemplates,
    archive,
    entities: om.entities ?? "_Entities",
    proposals: om.proposals ?? "_Proposals",
  };
  const keptTemplates = new Set(TEMPLATE_FILES.map((t) => t.workspace));

  // ---- where every old path ends up ----
  const contextDirs: string[] = []; // every context dir (root + nested)
  const mapPath = (p: string): string => {
    if (LEGACY_ROOT_FILES.includes(p)) return `${ARCH}/${p}`;
    for (const d of contextDirs) if (p === d || p.startsWith(`${d}/`)) return `${ARCH}/${p}`;
    if (p === oldJournal || p.startsWith(`${oldJournal}/`)) return newJournal + p.slice(oldJournal.length);
    if (p === oldTemplates) return newTemplates;
    if (p.startsWith(`${oldTemplates}/`)) {
      const f = p.slice(oldTemplates.length + 1);
      return keptTemplates.has(f) ? `${newTemplates}/${f}` : `${ARCH}/${p}`;
    }
    return p;
  };

  // ---- walk the workspace (ignored paths are already invisible) ----
  const files: string[] = [];
  async function walk(dir: string) {
    for (const e of await c.list(dir)) {
      if (e.kind === "folder") {
        if (dir === "" && e.name === archive) continue;
        if (e.name === ctxName) contextDirs.push(e.path);
        await walk(e.path);
      } else files.push(e.path);
    }
  }
  await walk("");

  // ---- about (from the root overview's "What it is") ----
  let about: string | undefined;
  const rootOv = await c.read("_Overview.md");
  if (rootOv) {
    const para = sectionLines(rootOv, "What it is")
      .join("\n")
      .trim()
      .split(/\n\s*\n/)[0]
      ?.replace(/\s*\n\s*/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\s*\(see AGENTS\.md\)\.?/i, ".")
      .split(/(?<=\.)\s+/)
      .filter((sentence) => !/Drive Context Protocol/i.test(sentence))
      .join(" ")
      .trim();
    if (para) about = para.length > 300 ? `${para.slice(0, 297)}…` : para;
  }

  // ---- header ----
  const rules: Record<string, unknown> = {};
  const ovr = Object.fromEntries(
    Object.entries(old.rules?.overrides ?? {}).filter(([id]) => !REMOVED_RULES.has(id)),
  );
  if (Object.keys(ovr).length) rules.overrides = ovr;
  if (old.rules?.conventions?.wip_required_sections?.length) {
    rules.conventions = { wip_required_sections: old.rules.conventions.wip_required_sections };
  }
  if (old.rules?.conventions?.relationship_predicates?.length) {
    notes.push("The workspace's custom relationship vocabulary is dropped: v0.16 uses member-of / related-to + `as`.");
  }
  const header: Record<string, unknown> = {
    protocol: versionToProtocol(manifest.spec_version),
    profile: old.profile ?? opts.profile,
    owner: old.owner ?? { name: opts.ownerName, email: opts.ownerEmail },
    ...(about ? { about } : {}),
    mounts: {
      areas: mounts.areas,
      journal: mounts.journal,
      templates: mounts.templates,
      archive: mounts.archive,
      entities: mounts.entities,
      proposals: mounts.proposals,
    },
    ...(old.ignore?.length ? { ignore: old.ignore } : {}),
    ...(Object.keys(rules).length ? { rules } : {}),
    ...(old.house_rules?.length ? { house_rules: old.house_rules } : {}),
  };
  const newDecl = headerToDecl(header)!;
  const owner = (header.owner ?? {}) as { name?: string; email?: string };

  // ---- context groups → facet entities (SPEC §13 step 2) ----
  const entityDir = mounts.entities!;
  type Facet = { slug: string; name: string; facet: string; notes: string; aliases: string[] };
  const facets = new Map<string, Facet>();
  const facetsForOverview = new Map<string, string[]>(); // overview path → facet slugs
  for (const dir of contextDirs) {
    const parent = posix.dirname(dir) === "." ? "" : posix.dirname(dir);
    for (const f of files.filter((p) => posix.dirname(p) === dir && p.endsWith(".md"))) {
      const md = await c.read(f);
      const g = md ? parseGroupFile(md) : null;
      if (!g) {
        manual.push(`${f}: not a valid context group — archived without conversion`);
        continue;
      }
      const kind = String(parseFrontmatter(md!).data.kind ?? "");
      const name = g.title.replace(/^pillar:\s*/i, "").trim() || g.title;
      const facetKind = kind === "pillar" || /^pillar:/i.test(g.title) ? "pillar" : "group";
      if (facetKind === "group") {
        manual.push(`Facet "${name}": converted from a plain context group — set attributes.facet (pillar / platform / discipline / brand) on _Entities/${slugify(name)}.md`);
      }
      const slug = slugify(name);
      facets.set(slug, { slug, name, facet: facetKind, notes: g.description, aliases: g.slug !== slug ? [g.slug] : [] });
      for (const m of g.members) {
        const member = parent ? `${parent}/${m.path}` : m.path;
        const ov = `${member}/_Overview.md`;
        if (files.includes(ov)) {
          facetsForOverview.set(ov, [...(facetsForOverview.get(ov) ?? []), slug]);
        } else {
          manual.push(`Group "${g.title}" member "${member}" is not a scope (no _Overview.md) — facets live on scopes; add "${slug}" to the nearest scope's facets if it applies`);
        }
      }
    }
  }

  // ---- entity index for relation migration ----
  const entityFiles = files.filter((p) => posix.dirname(p) === entityDir && p.endsWith(".md"));
  const entityMd = new Map<string, string>();
  const usesEdges = new Set<string>();
  const memberTargets = new Set<string>();
  const personSlugs = new Set<string>();
  for (const f of entityFiles) {
    const md = await c.read(f);
    if (md === null) continue;
    entityMd.set(f, md);
    const d = parseFrontmatter(md).data;
    const slug = posix.basename(f, ".md");
    if (d.kind === "person") personSlugs.add(slug);
    for (const r of (Array.isArray(d.relations) ? d.relations : []) as Rel[]) {
      if (r.predicate === "uses") usesEdges.add(`${slug}→${String(r.target)}`);
    }
  }
  for (const [f, md] of entityMd) {
    const d = parseFrontmatter(md).data;
    if (!personSlugs.has(posix.basename(f, ".md"))) continue;
    for (const r of (Array.isArray(d.relations) ? d.relations : []) as Rel[]) {
      if (r.predicate === "member-of" || r.predicate === "previously-member-of") memberTargets.add(String(r.target));
    }
  }
  // concepts that are member-of another organization are organizations too
  const orgParents = new Set<string>();
  for (const [f, md] of entityMd) {
    const d = parseFrontmatter(md).data;
    if (d.kind !== "concept") continue;
    const rels = (Array.isArray(d.relations) ? d.relations : []) as Rel[];
    if (rels.some((r) => r.predicate === "member-of" && memberTargets.has(String(r.target)))) orgParents.add(posix.basename(f, ".md"));
  }
  const ORG_ROLE = /\b(client|partner|vendor|prospect|agency|company|consultancy|employer|customer|operator|authority|group|organi[sz]ation|vendor|supplier|partner)\b/i;

  // ---- per-file content changes ----
  const retired = (p: string) => mapPath(p).startsWith(`${ARCH}/`);
  const copyOps: Op[] = [];
  const writeOps: Op[] = [];
  for (const f of files) {
    if (!f.endsWith(".md") || f === "AGENTS.md" || retired(f)) continue;
    const before = entityMd.get(f) ?? (await c.read(f));
    if (before === null) continue;
    let after = rewriteLinks(before, f, mapPath);
    const reasons: string[] = [];
    if (after !== before) reasons.push("links");

    if (entityMd.has(f)) {
      const slug = posix.basename(f, ".md");
      after = withFrontmatter(after, (doc) => {
        const rels = doc.toJS().relations;
        if (Array.isArray(rels) && rels.length) {
          const next = (rels as Rel[])
            .map((r) => migrateRelation(r, slug, (from, to) => usesEdges.has(`${from}→${to}`)))
            .filter((r): r is Rel => r !== null);
          if (JSON.stringify(next) !== JSON.stringify(rels)) {
            doc.set("relations", next);
            reasons.push("relationships");
            if (next.length < rels.length) count("mirror edges dropped");
          }
        }
        const kind = doc.get("kind");
        const attrs = (doc.toJS().attributes ?? {}) as Record<string, unknown>;
        if (
          kind === "concept" &&
          !facets.has(slug) &&
          (attrs.industry !== undefined ||
            memberTargets.has(slug) ||
            ORG_ROLE.test(`${String(attrs.role ?? "")} ${String(attrs.type ?? "")}`) ||
            orgParents.has(slug))
        ) {
          doc.set("kind", "organization");
          if (doc.has("type")) doc.set("type", "organization");
          reasons.push("kind → organization");
          count("organizations");
        }
        const fc = facets.get(slug);
        if (fc && !attrs.facet) {
          doc.setIn(["attributes", "facet"], fc.facet);
          reasons.push("facet");
          facets.delete(slug); // merged into an existing entity
        }
      });
    }
    const fs = facetsForOverview.get(f);
    if (fs) {
      after = withFrontmatter(after, (doc) => {
        const existing = (doc.toJS().facets ?? []) as string[];
        doc.set("facets", [...new Set([...existing, ...fs])]);
      });
      reasons.push("facets");
    }
    if (after !== before) {
      copyOps.push({ action: "write", path: `${ARCH}/${f}`, content: before, note: `Archive original of ${f}`, selected: true });
      writeOps.push({ action: "write", path: f, content: after, overwrite: true, note: `Update ${f} (${reasons.join(", ")})`, selected: true });
      for (const r of reasons) count(r);
    }
  }

  // new facet entities
  const today = new Date().toISOString().slice(0, 10);
  for (const fc of facets.values()) {
    const front = {
      name: fc.name,
      type: "concept",
      kind: "concept",
      aliases: fc.aliases,
      source: "asserted",
      confirmed: today,
      attributes: { facet: fc.facet },
    };
    writeOps.push({
      action: "write",
      path: `${entityDir}/${fc.slug}.md`,
      content: `---\n${YAML.stringify(front).trimEnd()}\n---\n\n${fc.notes.trim()}\n`,
      note: `Create facet entity "${fc.name}" (from context group)`,
      selected: true,
    });
    count("facet entities");
  }

  // AGENTS.md: config header + rulebook
  const agentsOld = await c.read("AGENTS.md");
  if (agentsOld !== null) {
    copyOps.push({ action: "write", path: `${ARCH}/AGENTS.md`, content: agentsOld, note: "Archive the v0.15 AGENTS.md", selected: true });
  }
  writeOps.push({
    action: "write",
    path: "AGENTS.md",
    content: renderAgentsMd(
      { workspaceName: opts.workspaceName, profile: String(header.profile), ownerName: owner.name ?? opts.workspaceName, ownerEmail: owner.email ?? "owner@unknown" },
      mounts,
      newDecl,
      header,
    ),
    overwrite: true,
    note: "AGENTS.md becomes the config file: header (from _Workspace.yaml + root overview) + re-rendered rulebook",
    selected: true,
  });

  // ---- folders and moves ----
  const mkdirOps: Op[] = [];
  for (const m of [mounts.entities!, mounts.proposals!]) {
    if (!rootNames.has(m)) mkdirOps.push({ action: "mkdir", path: m, note: `Create protocol folder "${m}"`, selected: true });
  }
  const moveOps: Op[] = [];
  const mv = (from: string, to: string, note: string) =>
    moveOps.push({ action: "move", path: from, to, note, selected: true, noCascade: true });
  for (const f of LEGACY_ROOT_FILES) {
    if (rootNames.has(f)) mv(f, `${ARCH}/${f}`, `Retire ${f} (v0.15) to the archive`);
  }
  for (const d of contextDirs) mv(d, `${ARCH}/${d}`, `Retire context-group folder ${d} (converted to facets)`);
  if (rootNames.has(oldTemplates)) {
    for (const f of files.filter((p) => posix.dirname(p) === oldTemplates)) {
      if (!keptTemplates.has(posix.basename(f))) mv(f, `${ARCH}/${f}`, `Retire template ${posix.basename(f)}`);
    }
    if (newTemplates !== oldTemplates) mv(oldTemplates, newTemplates, `Rename templates folder ${oldTemplates}/ → ${newTemplates}/`);
  }
  if (rootNames.has(oldJournal) && newJournal !== oldJournal) {
    mv(oldJournal, newJournal, `Rename journal ${oldJournal}/ → ${newJournal}/ (log only from now on)`);
  }
  const templateOps: Op[] = [];
  for (const t of TEMPLATE_FILES) {
    const oldPath = `${oldTemplates}/${t.workspace}`;
    if (!files.includes(oldPath)) {
      templateOps.push({
        action: "write",
        path: `${newTemplates}/${t.workspace}`,
        content: loadTemplate(t.spec, String(header.profile)),
        note: `Install template "${t.workspace}"`,
        selected: true,
      });
    }
  }

  summary["files archived before overwrite"] = copyOps.length;
  summary["files moved to archive"] = moveOps.filter((o) => o.to?.startsWith(`${ARCH}/`)).length;
  notes.push(
    `Migrates "${opts.workspaceName}" from protocol v${old.spec_version ?? "0.15"} to v${manifest.spec_version}. Originals of every changed file go to ${ARCH}/ first; nothing is deleted.`,
    `Journal: ${oldJournal}/ → ${newJournal}/. Templates: ${oldTemplates}/ → ${newTemplates}/ (4 kept). Proposals folder: ${mounts.proposals}/.`,
    "Check the drafted relationship descriptions (`as`) and the organization kinds in the review queue afterwards.",
    `Update agents that hard-code old paths (journal "${oldJournal}/", "_Overview.md", "_Index.md", "_Model.json", "_Workspace.yaml", "_Context/"): their prompts must point at AGENTS.md, ${newJournal}/ and ${mounts.proposals}/.`,
  );
  if (old.house_rules?.length) notes.push(`${old.house_rules.length} house rule(s) carried into the header.`);

  return { ops: [...copyOps, ...writeOps, ...mkdirOps, ...moveOps, ...templateOps], notes, manual, summary };
}
