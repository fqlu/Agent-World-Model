import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { Connector } from "./connector";
import { parseWorkspaceYaml } from "./workspace";
import { listEntities } from "./entities";
import { buildModel } from "./model-gen";

// OKF export (SPEC §12). Reads the workspace via the connector and writes a
// conformant OKF v0.1 bundle to the app's data dir — a generated artifact,
// regenerated on demand, never written into the user's Drive.

const DATA_DIR = process.env.HUB_DATA_DIR ?? path.join(process.cwd(), "data");

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

export type OkfResult = { path: string; concepts: number; entities: number; scopes: number; groups: number };

export async function exportOkfBundle(c: Connector, workspaceId: number, workspaceName: string): Promise<OkfResult> {
  const declRaw = await c.read("_Workspace.yaml");
  const decl = declRaw ? parseWorkspaceYaml(declRaw) : null;
  const model = await buildModel(c);
  if (!model) throw new Error("Workspace has no declared topology — nothing to export");

  const { entities } = await listEntities(c);
  const entityBySlug = new Map(entities.map((e) => [e.slug, e]));

  const outDir = path.join(DATA_DIR, "okf", String(workspaceId));
  // Clean rebuild — this is app scratch space, safe to remove.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, "entities"), { recursive: true });
  await fs.mkdir(path.join(outDir, "scopes"), { recursive: true });
  await fs.mkdir(path.join(outDir, "groups"), { recursive: true });

  // id -> bundle-relative href, for rendering relationship links
  const href = new Map<string, string>();
  for (const n of model.nodes) {
    if (n.id.startsWith("entity:")) href.set(n.id, `/entities/${slug(n.id.slice(7))}.md`);
    else if (n.id.startsWith("group:")) href.set(n.id, `/groups/${slug(n.label)}.md`);
    else if (n.id.startsWith("scope:")) href.set(n.id, `/scopes/${slug(n.id.slice(6))}.md`);
  }
  const edgesFrom = (id: string) => model.edges.filter((e) => e.from === id);

  let entityCount = 0;
  let scopeCount = 0;
  let groupCount = 0;
  const indexEntries: { section: string; line: string }[] = [];

  // ---- Entity concepts ----
  for (const e of entities) {
    const rels = e.relations.map((r) => {
      const targetId = entityBySlug.has(r.target) ? `entity:${r.target}` : `scope:${r.target}`;
      const link = href.get(targetId) ?? r.target;
      return { predicate: r.predicate, target: r.target, href: link, note: r.note };
    });
    const body = [
      e.notes.trim(),
      rels.length ? "\n## Relationships\n" + rels.map((r) => `- ${r.predicate} → [${r.target}](${r.href})${r.note ? ` — ${r.note}` : ""}`).join("\n") : "",
    ].filter(Boolean).join("\n");
    const fm = frontmatter({
      type: e.kind,
      title: e.name,
      description: firstSentence(e.notes),
      resource: e.attributes.resource ?? e.attributes.url ?? e.attributes.id,
      tags: Object.values(e.attributes).filter(Boolean),
      timestamp: e.confirmed,
      source: e.source,
      dcp_relations: rels.length ? rels.map((r) => ({ predicate: r.predicate, target: r.target })) : undefined,
    });
    await fs.writeFile(path.join(outDir, "entities", `${e.slug}.md`), `${fm}\n# ${e.name}\n\n${body}\n`);
    indexEntries.push({ section: "Entities", line: `[${e.name}](/entities/${e.slug}.md) — ${e.kind}` });
    entityCount++;
  }

  // ---- Scope concepts (one per overview) ----
  for (const n of model.nodes.filter((x) => x.kind === "scope" && x.id.startsWith("scope:"))) {
    const scopePath = n.id.slice(6);
    const overview = await c.read(`${scopePath}/_Overview.md`);
    const s = slug(scopePath);
    const links = edgesFrom(n.id)
      .map((e) => `- ${e.predicate} → [${e.to.replace(/^.*:/, "")}](${href.get(e.to) ?? e.to})`)
      .join("\n");
    const fm = frontmatter({
      type: "Scope",
      title: n.label,
      description: overview ? firstSentence(stripFrontmatter(overview)) : "",
      resource: scopePath,
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
  for (const n of model.nodes.filter((x) => x.id.startsWith("group:"))) {
    const members = model.edges
      .filter((e) => e.to === n.id)
      .map((e) => `- [${e.from.replace(/^.*:/, "")}](${href.get(e.from) ?? e.from})${e.note ? ` — ${e.note}` : ""}`)
      .join("\n");
    const fm = frontmatter({ type: "Group", title: n.label });
    await fs.writeFile(
      path.join(outDir, "groups", `${slug(n.label)}.md`),
      `${fm}\n# ${n.label}\n\n## Members\n${members || "- (none)"}\n`,
    );
    indexEntries.push({ section: "Groups", line: `[${n.label}](/groups/${slug(n.label)}.md)` });
    groupCount++;
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
  await writeLog(c, decl?.mounts?.journal ?? "Journal", outDir);

  // ---- root index.md (reserved; only place okf_version lives) ----
  const sections = new Map<string, string[]>();
  for (const e of indexEntries) {
    if (!sections.has(e.section)) sections.set(e.section, []);
    sections.get(e.section)!.push(`- ${e.line}`);
  }
  let index = `---\nokf_version: "0.1"\n---\n\n# ${workspaceName} — OKF bundle\n\n`;
  index += `> Exported from a Drive Context Protocol workspace. ${entityCount + scopeCount + groupCount} concepts.\n\n`;
  for (const [section, lines] of sections) index += `## ${section}\n${lines.join("\n")}\n\n`;
  await fs.writeFile(path.join(outDir, "index.md"), index);

  return { path: outDir, concepts: entityCount + scopeCount + groupCount, entities: entityCount, scopes: scopeCount, groups: groupCount };
}

function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (m ? m[1] : md).trim();
}

async function writeLog(c: Connector, journalMount: string, outDir: string): Promise<void> {
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
        if (md) days.push({ date: e.name.replace(/\.md$/, ""), body: stripFrontmatter(md) });
      }
    }
  }
  if (await c.exists(journalMount)) await walk(journalMount);
  days.sort((a, b) => b.date.localeCompare(a.date)); // newest first
  const log = "# Log\n\n" + days.map((d) => `## ${d.date}\n\n${d.body}\n`).join("\n");
  await fs.writeFile(path.join(outDir, "log.md"), log);
}
