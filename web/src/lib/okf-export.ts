import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { Connector } from "./connector";
import { parseWorkspaceYaml, allowedForms, declaredAliases, parseFrontmatter } from "./workspace";
import { listEntities } from "./entities";
import { buildModel } from "./model-gen";

// OKF export (SPEC §12). Reads the workspace via the connector and writes a
// conformant OKF v0.2 bundle (trust signals: generated/verified/sources/
// status/stale_after) to the app's data dir — a generated artifact,
// regenerated on demand, never written into the user's Drive.
//
// v0.14: a workspace can produce MANY named bundles ("the Drive is the
// workshop; the bundle is the product"). A bundle is either the whole
// workspace or a slice — one client scope's subtree, or one context group's
// members — with entities/groups/log filtered to match.

const DATA_DIR = process.env.HUB_DATA_DIR ?? path.join(process.cwd(), "data");

export type BundleFilter =
  | { kind: "workspace" }
  | { kind: "scope"; ref: string } // ref = scope path, e.g. "Clients/Medibank"
  | { kind: "group"; ref: string }; // ref = group slug, e.g. "offline-conversions"

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x";
}

function frontmatter(obj: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    clean[k] = v;
  }
  return `---\n${YAML.stringify(clean).trimEnd()}\n---\n`;
}

function firstSentence(md: string): string {
  const line = md.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("["));
  if (!line) return "";
  return line.length > 200 ? line.slice(0, 197) + "…" : line;
}

export type OkfResult = { path: string; concepts: number; entities: number; scopes: number; groups: number; references: number };

export async function exportOkfBundle(
  c: Connector,
  workspaceId: number,
  workspaceName: string,
  opts?: { slug?: string; filter?: BundleFilter; includeContent?: boolean },
): Promise<OkfResult> {
  const declRaw = await c.read("_Workspace.yaml");
  const decl = declRaw ? parseWorkspaceYaml(declRaw) : null;
  const model = await buildModel(c);
  if (!model) throw new Error("Workspace has no declared topology — nothing to export");

  const { entities } = await listEntities(c);
  const entityBySlug = new Map(entities.map((e) => [e.slug, e]));
  const filter: BundleFilter = opts?.filter ?? { kind: "workspace" };

  // ---- Inclusion sets ------------------------------------------------------
  // includedScopePaths: scope paths in the slice. null = everything included.
  let includedScopePaths: Set<string> | null = null;
  let includedGroupIds: Set<string> | null = null;
  let sliceRoots: string[] = [];

  const scopeNodes = model.nodes.filter((n) => n.id.startsWith("scope:"));
  const groupNodes = model.nodes.filter((n) => n.id.startsWith("group:"));

  if (filter.kind === "scope") {
    const root = filter.ref.replace(/\/+$/, "");
    if (!(await c.exists(root))) throw new Error(`Bundle scope "${root}" does not exist`);
    sliceRoots = [root];
    includedScopePaths = new Set(
      scopeNodes.map((n) => n.id.slice(6)).filter((p) => p === root || p.startsWith(root + "/")),
    );
    // groups with at least one included member; membership edges are scope→group
    includedGroupIds = new Set(
      model.edges
        .filter((e) => e.predicate === "in-group" && includedScopePaths!.has(e.from.slice(6)))
        .map((e) => e.to),
    );
  } else if (filter.kind === "group") {
    const gnode = groupNodes.find(
      (n) => n.id === `group:${filter.ref}` || n.id.endsWith(`/${filter.ref}`) || slug(n.label) === filter.ref,
    );
    if (!gnode) throw new Error(`Bundle group "${filter.ref}" not found`);
    includedGroupIds = new Set([gnode.id]);
    const memberPaths = model.edges
      .filter((e) => e.predicate === "in-group" && e.to === gnode.id)
      .map((e) => e.from.slice(6));
    sliceRoots = memberPaths;
    includedScopePaths = new Set(
      scopeNodes
        .map((n) => n.id.slice(6))
        .filter((p) => memberPaths.some((m) => p === m || p.startsWith(m + "/"))),
    );
  }

  const scopeIncluded = (p: string) => includedScopePaths === null || includedScopePaths.has(p);
  const groupIncluded = (id: string) => includedGroupIds === null || includedGroupIds.has(id);
  const entityIncluded = (eSlug: string): boolean => {
    if (includedScopePaths === null) return true;
    const e = entityBySlug.get(eSlug);
    if (!e) return false;
    return e.relations.some(
      (r) => scopeIncluded(r.target) || (entityBySlug.has(r.target) && entityDirectlyIncluded(r.target)),
    );
  };
  // direct scope relation only (used to avoid chasing entity→entity chains forever)
  const entityDirectlyIncluded = (eSlug: string): boolean => {
    const e = entityBySlug.get(eSlug);
    return !!e && e.relations.some((r) => scopeIncluded(r.target));
  };

  const bundleSlug = opts?.slug ?? "_workspace";
  const outDir = path.join(DATA_DIR, "okf", String(workspaceId), bundleSlug);
  // Clean rebuild — this is app scratch space, safe to remove.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, "entities"), { recursive: true });
  await fs.mkdir(path.join(outDir, "scopes"), { recursive: true });
  await fs.mkdir(path.join(outDir, "groups"), { recursive: true });

  // id -> bundle-relative href, for rendering relationship links (included only)
  const href = new Map<string, string>();
  for (const n of model.nodes) {
    if (n.id.startsWith("entity:") && entityIncluded(n.id.slice(7))) href.set(n.id, `/entities/${slug(n.id.slice(7))}.md`);
    else if (n.id.startsWith("group:") && groupIncluded(n.id)) href.set(n.id, `/groups/${slug(n.label)}.md`);
    else if (n.id.startsWith("scope:") && scopeIncluded(n.id.slice(6))) href.set(n.id, `/scopes/${slug(n.id.slice(6))}.md`);
  }
  const edgesFrom = (id: string) => model.edges.filter((e) => e.from === id);

  let entityCount = 0;
  let scopeCount = 0;
  let groupCount = 0;
  let referenceCount = 0;
  const indexEntries: { section: string; line: string }[] = [];

  // ---- Entity concepts ----
  for (const e of entities) {
    if (!entityIncluded(e.slug)) continue;
    const rels = e.relations.map((r) => {
      const targetId = entityBySlug.has(r.target) ? `entity:${r.target}` : `scope:${r.target}`;
      return { predicate: r.predicate, target: r.target, href: href.get(targetId), note: r.note };
    });
    const body = [
      e.notes.trim(),
      rels.length
        ? "\n## Relationships\n" +
          rels
            .map((r) =>
              r.href
                ? `- ${r.predicate} → [${r.target}](${r.href})${r.note ? ` — ${r.note}` : ""}`
                : `- ${r.predicate} → ${r.target}${r.note ? ` — ${r.note}` : ""}`,
            )
            .join("\n")
        : "",
    ].filter(Boolean).join("\n");
    const fm = frontmatter({
      type: e.kind,
      title: e.name,
      description: firstSentence(e.notes),
      resource: e.attributes.resource ?? e.attributes.url ?? e.attributes.id,
      tags: Object.values(e.attributes).filter(Boolean),
      // OKF v0.2 trust signals; `timestamp` only as the v0.1 fallback when no
      // generated stamp exists yet
      generated: e.generated,
      timestamp: e.generated ? undefined : e.confirmed,
      verified: e.verified.length ? e.verified : undefined,
      sources: e.sources.length ? e.sources : undefined,
      status: e.status && e.status !== "stable" ? e.status : undefined,
      stale_after: e.stale_after,
      source: e.source,
      dcp_relations: rels.length ? rels.map((r) => ({ predicate: r.predicate, target: r.target })) : undefined,
    });
    await fs.writeFile(path.join(outDir, "entities", `${e.slug}.md`), `${fm}\n# ${e.name}\n\n${body}\n`);
    indexEntries.push({ section: "Entities", line: `[${e.name}](/entities/${e.slug}.md) — ${e.kind}` });
    entityCount++;
  }

  // ---- Scope concepts (one per overview) ----
  for (const n of scopeNodes) {
    const scopePath = n.id.slice(6);
    if (!scopeIncluded(scopePath)) continue;
    const overview = await c.read(`${scopePath}/_Overview.md`);
    const s = slug(scopePath);
    const links = edgesFrom(n.id)
      .filter((e) => href.has(e.to))
      .map((e) => `- ${e.predicate} → [${e.to.replace(/^.*:/, "")}](${href.get(e.to)})`)
      .join("\n");
    // Use the declared scope_type as the OKF concept type when present.
    const st = n.attributes?.scope_type;
    const conceptType = st === "project" ? "Project" : st === "workstream" ? "Workstream" : "Scope";
    // Pass scope-declared trust fields (OKF v0.2) through to the concept
    const ovFm = overview ? parseFrontmatter(overview).data : {};
    const fm = frontmatter({
      type: conceptType,
      title: n.label,
      description: overview ? firstSentence(stripFrontmatter(overview)) : "",
      resource: scopePath,
      generated: ovFm.generated,
      verified: ovFm.verified,
      sources: ovFm.sources,
      status: ovFm.status && ovFm.status !== "stable" ? ovFm.status : undefined,
      stale_after: ovFm.stale_after,
    });
    const body = overview ? stripFrontmatter(overview) : `# ${n.label}\n`;
    await fs.writeFile(
      path.join(outDir, "scopes", `${s}.md`),
      `${fm}\n${body}\n${links ? `\n## Related\n${links}\n` : ""}`,
    );
    indexEntries.push({ section: "Scopes", line: `[${n.label}](/scopes/${s}.md)` });
    scopeCount++;
  }

  // ---- Group concepts ----
  for (const n of groupNodes) {
    if (!groupIncluded(n.id)) continue;
    const members = model.edges
      .filter((e) => e.to === n.id && href.has(e.from))
      .map((e) => `- [${e.from.replace(/^.*:/, "")}](${href.get(e.from)})${e.note ? ` — ${e.note}` : ""}`)
      .join("\n");
    const fm = frontmatter({ type: "Group", title: n.label });
    await fs.writeFile(
      path.join(outDir, "groups", `${slug(n.label)}.md`),
      `${fm}\n# ${n.label}\n\n## Members\n${members || "- (none)"}\n`,
    );
    indexEntries.push({ section: "Groups", line: `[${n.label}](/groups/${slug(n.label)}.md)` });
    groupCount++;
  }

  // ---- Content files (opt-in, slice bundles only) ----
  // Carries the slice's markdown content files as Reference concepts and
  // lists non-markdown artifacts, so the bundle can answer questions the
  // overviews alone can't (specs, QA procedures, test plans). Excluded:
  // WIP Notes (internal meeting detail), Draft_-prefixed files (not stable),
  // _-prefixed context machinery, dotfiles.
  if (opts?.includeContent && sliceRoots.length) {
    await fs.mkdir(path.join(outDir, "reference"), { recursive: true });
    const artifacts: string[] = [];
    const seen = new Set<string>();
    const walkContent = async (dir: string) => {
      let entries;
      try {
        entries = await c.list(dir);
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
        if (e.kind === "folder") {
          if (e.name.endsWith("| WIP Notes")) continue;
          await walkContent(e.path);
          continue;
        }
        if (e.name.startsWith("Draft_") || e.name === "_Overview.md" || e.name === "_Tasks.md") continue;
        if (seen.has(e.path)) continue;
        seen.add(e.path);
        if (!e.name.endsWith(".md")) {
          artifacts.push(e.path);
          continue;
        }
        const md = await c.read(e.path);
        if (md === null) {
          artifacts.push(e.path);
          continue;
        }
        const src = parseFrontmatter(md);
        const body = stripFrontmatter(md);
        const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
        const title = (src.data.title as string) ?? heading ?? e.name.replace(/\.md$/, "");
        const fm = frontmatter({
          type: (src.data.type as string) ?? "Reference",
          title,
          description: (src.data.description as string) ?? firstSentence(body),
          resource: e.path,
          status: src.data.status && src.data.status !== "stable" ? src.data.status : undefined,
          generated: src.data.generated,
          verified: src.data.verified,
          sources: src.data.sources,
          stale_after: src.data.stale_after,
        });
        // Deep paths share long prefixes; a bare 80-char slug collides and
        // silently overwrites siblings. Suffix with a short path hash.
        const cSlug = `${slug(e.path).slice(0, 64)}-${crypto.createHash("sha1").update(e.path).digest("hex").slice(0, 6)}`;
        await fs.writeFile(path.join(outDir, "reference", `${cSlug}.md`), `${fm}\n${body}\n`);
        indexEntries.push({ section: "Reference", line: `[${title}](/reference/${cSlug}.md)` });
        referenceCount++;
      }
    };
    for (const root of sliceRoots) await walkContent(root);
    if (artifacts.length) {
      const fm = frontmatter({
        type: "Reference",
        title: "Artifacts",
        description: "Non-markdown files in this slice — retrieve them from the workspace paths below.",
      });
      const body = artifacts.sort().map((p) => `- \`${p}\``).join("\n");
      await fs.writeFile(path.join(outDir, "artifacts.md"), `${fm}\n# Artifacts\n\n${body}\n`);
      indexEntries.push({ section: "Reference", line: `[Artifacts](/artifacts.md) — ${artifacts.length} file(s)` });
    }
  }

  // ---- House rules → a Reference concept (so consuming agents inherit them) ----
  const houseRules = decl?.house_rules ?? [];
  if (houseRules.length) {
    const fm = frontmatter({ type: "Reference", title: "House rules", description: "Workspace rules agents should follow." });
    const body = houseRules.map((h, i) => `${i + 1}. ${h.text}`).join("\n");
    await fs.writeFile(path.join(outDir, "house-rules.md"), `${fm}\n# House rules\n\n${body}\n`);
    indexEntries.push({ section: "Reference", line: `[House rules](/house-rules.md)` });
  }

  // ---- log.md from the journal (date-grouped, newest first) ----
  // Scope slices keep only the journal sections about this slice.
  let sectionNames: string[] | null = null;
  if (filter.kind === "scope") {
    const base = filter.ref.split("/").pop() ?? filter.ref;
    const forms = allowedForms(base);
    for (const a of declaredAliases(await c.read(`${filter.ref}/_Overview.md`))) forms.add(a);
    sectionNames = [...forms];
  } else if (filter.kind === "group") {
    sectionNames = null; // group slices keep the full log for now (cross-client by nature)
  }
  await writeLog(c, decl?.mounts?.journal ?? "Journal", outDir, sectionNames);

  // ---- root index.md (reserved; only place okf_version lives) ----
  const sections = new Map<string, string[]>();
  for (const e of indexEntries) {
    if (!sections.has(e.section)) sections.set(e.section, []);
    sections.get(e.section)!.push(`- ${e.line}`);
  }
  const bundleTitle =
    filter.kind === "workspace" ? workspaceName : `${workspaceName} — ${opts?.slug ?? filter.ref}`;
  let index = `---\nokf_version: "0.2"\n---\n\n# ${bundleTitle} — OKF bundle\n\n`;
  index += `> Exported from a Drive Context Protocol workspace. ${entityCount + scopeCount + groupCount + referenceCount} concepts.`;
  if (filter.kind !== "workspace") index += ` Slice: ${filter.kind} "${filter.ref}".`;
  index += `\n\n`;
  for (const [section, lines] of sections) index += `## ${section}\n${lines.join("\n")}\n\n`;
  await fs.writeFile(path.join(outDir, "index.md"), index);

  // Self-contained interactive graph (viz.html) — travels with the bundle.
  try {
    const { generateBundleViz } = await import("./okf-viz");
    await generateBundleViz(outDir, bundleTitle);
  } catch {
    /* the bundle is valid without its viz */
  }

  return { path: outDir, concepts: entityCount + scopeCount + groupCount + referenceCount, entities: entityCount, scopes: scopeCount, groups: groupCount, references: referenceCount };
}

function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (m ? m[1] : md).trim();
}

// Keep only "## <heading>" sections whose heading mentions one of `names`
// (used to slice the cross-client journal down to one client's lines).
function filterSections(body: string, names: string[]): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let keeping = false;
  let sawSection = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      sawSection = true;
      const h = line.slice(3).trim();
      keeping = names.some((n) => h.toLowerCase().includes(n.toLowerCase()));
      if (keeping) out.push(line);
      continue;
    }
    if (!sawSection) continue; // preamble (title/blockquote) — skip in slices
    if (keeping) out.push(line);
  }
  return out.join("\n").trim();
}

async function writeLog(
  c: Connector,
  journalMount: string,
  outDir: string,
  sectionNames: string[] | null,
): Promise<void> {
  const days: { date: string; body: string }[] = [];
  async function walk(p: string) {
    let entries;
    try {
      entries = await c.list(p);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.kind === "folder") await walk(e.path);
      else if (/^\d{4}-\d{2}-\d{2}\.md$/.test(e.name)) {
        const md = await c.read(e.path);
        if (md === null) continue;
        let body = stripFrontmatter(md);
        if (sectionNames) {
          body = filterSections(body, sectionNames);
          if (!body) continue; // day says nothing about this slice
        }
        days.push({ date: e.name.replace(/\.md$/, ""), body });
      }
    }
  }
  if (await c.exists(journalMount)) await walk(journalMount);
  days.sort((a, b) => b.date.localeCompare(a.date)); // newest first
  const log = "# Log\n\n" + days.map((d) => `## ${d.date}\n\n${d.body}\n`).join("\n");
  await fs.writeFile(path.join(outDir, "log.md"), log);
}

export async function removeBundleDir(workspaceId: number, bundleSlug: string): Promise<void> {
  // Only ever deletes inside the app's own data dir — never the Drive.
  const dir = path.join(DATA_DIR, "okf", String(workspaceId), bundleSlug);
  await fs.rm(dir, { recursive: true, force: true });
}

export function bundleSlugify(name: string): string {
  return slug(name);
}
