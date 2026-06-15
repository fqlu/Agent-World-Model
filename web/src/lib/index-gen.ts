import { Connector } from "./connector";
import { loadManifest } from "./spec";
import { parseWorkspaceYaml, sectionLines } from "./workspace";
import { parseGroupFile, ContextGroup, DEFAULT_CONTEXT_DIR } from "./context";
import { listEntities, Entity } from "./entities";

// _Index.md — the llms.txt pattern applied to a workspace (SPEC §6.5):
// one generated, high-recall document mapping every scope and context group,
// for assistants that reach the Drive through search/embedding connectors.

type ScopeEntry = { path: string; name: string; depth: number; whatItIs: string };
type GroupEntry = { dir: string; group: ContextGroup };

function firstLine(md: string, section: string): string {
  const lines = sectionLines(md, section)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("*(") && l !== "-");
  // a section whose first content line opens a "[…]" bracket is an unfilled template
  if (!lines.length || lines[0].startsWith("[")) return "";
  const text = lines[0].replace(/^[-*]\s*/, "");
  return text.length > 160 ? text.slice(0, 157) + "…" : text;
}

function enc(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export async function buildIndexMd(c: Connector, workspaceName: string): Promise<string | null> {
  const manifest = loadManifest();
  const raw = await c.read(manifest.workspace.manifest_file);
  const decl = raw ? parseWorkspaceYaml(raw) : null;
  if (!decl?.mounts?.areas?.length) return null;

  const mounts = {
    areas: decl.mounts.areas!,
    journal: decl.mounts.journal ?? "Journal",
    templates: decl.mounts.templates ?? "Templates",
    archive: decl.mounts.archive ?? "Archive",
    context: decl.mounts.context,
  };
  const ctxName = mounts.context ?? DEFAULT_CONTEXT_DIR;
  const scopesByArea = new Map<string, ScopeEntry[]>();
  const groups: GroupEntry[] = [];

  async function collectContextDir(dirPath: string) {
    for (const e of await c.list(dirPath)) {
      if (e.kind !== "file" || !e.name.endsWith(".md")) continue;
      const md = await c.read(e.path);
      const g = md !== null ? parseGroupFile(md) : null;
      if (g) groups.push({ dir: dirPath, group: g });
    }
  }

  async function walk(path: string, depth: number, into: ScopeEntry[]) {
    if (depth > 4) return;
    for (const e of await c.list(path)) {
      if (e.kind !== "folder") continue;
      if (e.name === ctxName) {
        await collectContextDir(e.path);
        continue;
      }
      if (e.name.endsWith(" | WIP Notes") || e.name === "WIP Notes") continue;
      const children = await c.list(e.path);
      const overview = children.find((x) => x.name === "_Overview.md");
      // v0.6: only entities and promoted scopes are indexed; content folders
      // are traversed (they may hold context dirs / promoted scopes) but not listed.
      if (overview) {
        const md = await c.read(overview.path);
        into.push({
          path: e.path,
          name: e.name,
          depth,
          whatItIs: md ? firstLine(md, "What it is") : "",
        });
      }
      await walk(e.path, depth + 1, into);
    }
  }

  // Root-level context dir
  if (mounts.context && (await c.exists(mounts.context))) {
    await collectContextDir(mounts.context);
  }
  for (const area of mounts.areas) {
    if (!(await c.exists(area))) continue;
    const list: ScopeEntry[] = [];
    await walk(area, 1, list);
    scopesByArea.set(area, list);
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const out: string[] = [];
  out.push(`# ${workspaceName} — Workspace Index`);
  out.push("");
  out.push(
    "> Generated — do not edit. Maps every scope and context group in this workspace. The folder tree and context directories are the source of truth; agents with file access should read `AGENTS.md` and retrieve by address.",
  );
  out.push("");
  out.push(
    `**Spec:** ${decl.spec_version ?? "?"} · **Profile:** ${decl.profile ?? "?"} · **Updated:** ${stamp}`,
  );
  out.push("");
  out.push("## Map");
  out.push("");
  for (const a of mounts.areas) out.push(`- \`${a}/\` — area (holds scopes)`);
  out.push(`- \`${mounts.journal}/\` — journal: daily index + agent activity log`);
  out.push(`- \`${mounts.templates}/\` — templates`);
  out.push(`- \`${mounts.archive}/\` — archive (superseded material; nothing is deleted)`);
  if (mounts.context) out.push(`- \`${ctxName}/\` — context groups (any folder may hold one)`);
  out.push("");
  out.push("## Scopes");

  for (const [area, list] of scopesByArea) {
    out.push("");
    out.push(`### ${area}`);
    if (!list.length) {
      out.push("*(empty)*");
      continue;
    }
    for (const s of list) {
      const indent = "  ".repeat(s.depth - 1);
      const desc = s.whatItIs ? ` — ${s.whatItIs}` : "";
      out.push(`${indent}- **[${s.name}](${enc(s.path)}/_Overview.md)**${desc}`);
    }
  }

  // Entities (the cast)
  let entities: Entity[] = [];
  try {
    entities = (await listEntities(c)).entities;
  } catch {
    /* entities optional */
  }
  if (entities.length) {
    out.push("");
    out.push("## Entities");
    const byKind: Record<string, Entity[]> = { person: [], system: [], concept: [] };
    for (const e of entities) (byKind[e.kind] ??= []).push(e);
    const label: Record<string, string> = {
      person: "People",
      system: "Systems",
      concept: "Concepts",
    };
    for (const kind of ["person", "system", "concept"]) {
      const list = byKind[kind];
      if (!list?.length) continue;
      out.push("");
      out.push(`### ${label[kind]}`);
      for (const e of list) {
        const attrs = Object.entries(e.attributes)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        out.push(`- **${e.name}**${attrs ? ` — ${attrs}` : ""}`);
      }
    }
  }

  out.push("");
  out.push("## Context groups");
  if (!groups.length) {
    out.push("");
    out.push("*(none declared yet)*");
  }
  for (const { dir, group } of groups) {
    out.push("");
    out.push(`### ${group.title} (\`${dir}/${group.slug}.md\`)`);
    if (group.description) out.push(group.description.split("\n")[0]);
    const base = dir.split("/").slice(0, -1).join("/");
    for (const m of group.members) {
      const full = base ? `${base}/${m.path}` : m.path;
      out.push(`- [${m.path}](${enc(full)}/)${m.note ? ` — ${m.note}` : ""}`);
    }
  }
  out.push("");
  return out.join("\n");
}

export async function writeIndex(c: Connector, workspaceName: string): Promise<boolean> {
  const md = await buildIndexMd(c, workspaceName);
  if (md === null) return false;
  await c.write("_Index.md", md, { overwrite: true });
  return true;
}
