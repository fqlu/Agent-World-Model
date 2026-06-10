import YAML from "yaml";
import { Connector } from "./connector";
import { parseWorkspaceYaml } from "./workspace";
import { journalAgentActivity } from "./ops";

export type GroupMember = { path: string; note?: string }; // path = immediate child folder NAME
export type ContextGroup = {
  slug: string;
  title: string;
  description: string;
  members: GroupMember[];
};

export const DEFAULT_CONTEXT_DIR = "_Context";

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "group"
  );
}

export function parseGroupFile(md: string): ContextGroup | null {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  let data: unknown;
  try {
    data = YAML.parse(m[1]);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.name !== "string" || typeof d.title !== "string" || !Array.isArray(d.members)) {
    return null;
  }
  const members: GroupMember[] = [];
  for (const item of d.members) {
    if (typeof item === "string") members.push({ path: item });
    else if (item && typeof item === "object" && typeof (item as GroupMember).path === "string") {
      const gm = item as { path: string; note?: unknown };
      members.push({ path: gm.path, note: typeof gm.note === "string" ? gm.note : undefined });
    } else return null;
  }
  return { slug: d.name, title: d.title, description: m[2].trim(), members };
}

export function serializeGroup(g: ContextGroup): string {
  const front = YAML.stringify({
    name: g.slug,
    title: g.title,
    members: g.members.map((mb) => (mb.note ? { path: mb.path, note: mb.note } : { path: mb.path })),
  }).trimEnd();
  return `---\n${front}\n---\n\n${g.description.trim()}\n`;
}

async function readDecl(c: Connector) {
  const raw = await c.read("_Workspace.yaml");
  return raw ? parseWorkspaceYaml(raw) : null;
}

// The context directory NAME is fixed workspace-wide by the context mount.
export async function contextDirName(c: Connector): Promise<string> {
  const decl = await readDecl(c);
  return decl?.mounts?.context ?? DEFAULT_CONTEXT_DIR;
}

function join(folderPath: string, name: string): string {
  return folderPath ? `${folderPath}/${name}` : name;
}

// Groups declared AT a folder level (members = its immediate subfolders).
export async function listGroups(
  c: Connector,
  folderPath: string,
): Promise<{ dir: string; groups: ContextGroup[]; problems: string[] }> {
  const dir = join(folderPath, await contextDirName(c));
  const problems: string[] = [];
  const groups: ContextGroup[] = [];
  if (!(await c.exists(dir))) return { dir, groups, problems };
  for (const e of await c.list(dir)) {
    if (e.kind !== "file" || !e.name.endsWith(".md")) continue;
    const md = await c.read(e.path);
    const g = md !== null ? parseGroupFile(md) : null;
    if (!g) {
      problems.push(`${e.path}: not a valid context group file`);
      continue;
    }
    groups.push(g);
  }
  return { dir, groups, problems };
}

// Persist a folder level's full group set: write/overwrite group files,
// archive files for removed groups, register the root mount when saving at
// root, and journal the change. Never deletes.
export async function saveGroups(
  c: Connector,
  folderPath: string,
  groups: ContextGroup[],
): Promise<{ written: string[]; archived: string[] }> {
  const dirName = await contextDirName(c);
  const dir = join(folderPath, dirName);
  await c.mkdir(dir);

  // Saving at the workspace root: make sure the mount is declared
  if (folderPath === "") {
    const raw = await c.read("_Workspace.yaml");
    if (raw) {
      const doc = YAML.parse(raw) as Record<string, unknown> | null;
      if (doc && typeof doc === "object") {
        const mountsObj = (doc.mounts ?? {}) as Record<string, unknown>;
        if (!mountsObj.context) {
          mountsObj.context = dirName;
          doc.mounts = mountsObj;
          await c.write("_Workspace.yaml", YAML.stringify(doc), { overwrite: true });
        }
      }
    }
  }

  const written: string[] = [];
  for (const g of groups) {
    const path = `${dir}/${g.slug}.md`;
    await c.write(path, serializeGroup(g), { overwrite: true });
    written.push(path);
  }

  // Archive group files that no longer exist in the set
  const keep = new Set(groups.map((g) => `${g.slug}.md`));
  const archived: string[] = [];
  const decl = await readDecl(c);
  const archiveMount = decl?.mounts?.archive ?? "Archive";
  for (const e of await c.list(dir)) {
    if (e.kind !== "file" || !e.name.endsWith(".md") || keep.has(e.name)) continue;
    const dest = `${archiveMount}/${dir}/${e.name}`;
    try {
      await c.move(e.path, dest);
      archived.push(dest);
    } catch {
      // destination may exist from a previous archive — leave the file in place
    }
  }

  try {
    await journalAgentActivity(
      c,
      decl?.mounts?.journal ?? "Journal",
      `context groups saved at ${folderPath || "(root)"} — ${groups.length} group(s)${archived.length ? `, ${archived.length} archived` : ""}`,
    );
  } catch {
    // journal may not exist yet — the save itself stands
  }

  return { written, archived };
}

// Folder subtree under a base folder — the canvas's collapsible left-hand
// tree. `rel` is the path relative to the base (matches group member paths).
// Capability mounts are excluded at root; context dirs are excluded everywhere.
export type TreeNode = {
  rel: string;
  name: string;
  depth: number;
  parentRel: string | null;
  hasChildren: boolean;
};

export async function folderSubtree(
  c: Connector,
  basePath: string,
  maxDepth = 4,
): Promise<TreeNode[]> {
  const decl = await readDecl(c);
  const ctxName = decl?.mounts?.context ?? DEFAULT_CONTEXT_DIR;
  const rootExclude = new Set(
    [
      decl?.mounts?.journal ?? "Journal",
      decl?.mounts?.templates ?? "Templates",
      decl?.mounts?.archive ?? "Archive",
    ].filter(Boolean),
  );
  const out: TreeNode[] = [];

  async function walk(absPath: string, relPrefix: string, depth: number, parentRel: string | null) {
    if (depth > maxDepth) return;
    for (const e of await c.list(absPath)) {
      if (e.kind !== "folder") continue;
      if (e.name === ctxName) continue;
      if (absPath === "" && rootExclude.has(e.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      const node: TreeNode = { rel, name: e.name, depth, parentRel, hasChildren: false };
      out.push(node);
      const before = out.length;
      await walk(e.path, rel, depth + 1, rel);
      node.hasChildren = out.length > before;
    }
  }

  await walk(basePath, "", 1, null);
  return out;
}
