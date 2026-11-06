import type { drive_v3 } from "googleapis";
import YAML from "yaml";
import { Connector, Entry, assertSafeRelPath, parentPath, baseName } from "../connector";

const FOLDER = "application/vnd.google-apps.folder";
const GOOGLE_NATIVE = "application/vnd.google-apps.";
// Never walked: dependency / build / VCS folders and macOS / Drive icon files.
const SKIP = new Set(["node_modules", ".git", ".next", ".DS_Store", "Icon\r"]);
const TEXT_EXT = /\.(md|json|ya?ml|txt|csv)$/i;
const TREE_TTL_MS = 30_000;
const PARENTS_PER_QUERY = 40;
const READ_CONCURRENCY = 16;
const PREFETCH_MAX_BYTES = 2_000_000;

type Node = { id: string; name: string; path: string; folder: boolean; mime: string; modified: string; size: number };

type Tree = {
  builtAt: number;
  byPath: Map<string, Node>;
  children: Map<string, Entry[]>; // folder path → entries
  unexpanded: Set<string>; // ignored folders, listed lazily
  archive: string;
  prefetched: boolean;
};

// Shared across requests (each request builds a new connector): the folder
// tree for TREE_TTL_MS, and file contents until Drive reports a newer
// modifiedTime. Keyed by the workspace's root folder ID / file ID.
const trees = new Map<string, Tree>();
const building = new Map<string, Promise<Tree>>();
const contents = new Map<string, { modified: string; text: string | null }>();

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// Google Drive connector rooted at a folder ID. The whole tree is listed in a
// few batched queries (one per ~40 folders per level) instead of one query per
// folder and per path segment.
export class GDriveConnector implements Connector {
  constructor(private drive: drive_v3.Drive, private rootId: string) {}

  // ---- tree ----

  private async tree(): Promise<Tree> {
    const t = trees.get(this.rootId);
    if (t && Date.now() - t.builtAt < TREE_TTL_MS) return t;
    let p = building.get(this.rootId);
    if (!p) {
      p = this.buildTree().finally(() => building.delete(this.rootId));
      building.set(this.rootId, p);
    }
    return p;
  }

  // Record a newly created file/folder in the cached tree (no re-walk).
  private remember(path: string, id: string, folder: boolean, mime: string, modified: string) {
    const t = trees.get(this.rootId);
    if (!t || t.byPath.has(path)) return;
    const parent = parentPath(path);
    t.byPath.set(path, { id, name: baseName(path), path, folder, mime, modified, size: 0 });
    const list = t.children.get(parent);
    if (list) {
      list.push({ name: baseName(path), path, kind: folder ? "folder" : "file" });
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (folder) t.children.set(path, []);
  }

  private invalidate() {
    const t = trees.get(this.rootId);
    if (t) t.builtAt = 0;
  }

  private async listChildren(parentIds: string[]): Promise<drive_v3.Schema$File[]> {
    const out: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;
    const q = `(${parentIds.map((id) => `'${esc(id)}' in parents`).join(" or ")}) and trashed = false`;
    do {
      const res = await this.drive.files.list({
        q,
        fields: "nextPageToken, files(id, name, mimeType, parents, modifiedTime, size)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      out.push(...(res.data.files ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  private async buildTree(): Promise<Tree> {
    const byPath = new Map<string, Node>();
    const children = new Map<string, Entry[]>();
    const unexpanded = new Set<string>();
    const idToPath = new Map<string, string>([[this.rootId, ""]]);
    byPath.set("", { id: this.rootId, name: "", path: "", folder: true, mime: FOLDER, modified: "", size: 0 });

    const add = (f: drive_v3.Schema$File): Node | null => {
      const parent = (f.parents ?? []).map((p) => idToPath.get(p)).find((p) => p !== undefined);
      if (parent === undefined || !f.name || !f.id || SKIP.has(f.name)) return null;
      const path = parent ? `${parent}/${f.name}` : f.name;
      if (byPath.has(path)) return null; // duplicate name: first one wins
      const node: Node = {
        id: f.id,
        name: f.name,
        path,
        folder: f.mimeType === FOLDER,
        mime: f.mimeType ?? "",
        modified: f.modifiedTime ?? "",
        size: Number(f.size ?? 0),
      };
      byPath.set(path, node);
      idToPath.set(f.id, path);
      const list = children.get(parent) ?? [];
      list.push({ name: f.name, path, kind: node.folder ? "folder" : "file" });
      children.set(parent, list);
      return node;
    };

    // Level 0, then read the workspace config so ignored folders (code repos,
    // tool output) aren't walked at all.
    let frontier: Node[] = [];
    for (const f of await this.listChildren([this.rootId])) {
      const n = add(f);
      if (n?.folder) frontier.push(n);
    }
    children.set("", children.get("") ?? []);
    const { ignore, archive } = await this.config(byPath);
    const isIgnored = (p: string) => ignore.some((i) => p === i || p.startsWith(`${i}/`));

    while (frontier.length) {
      const expand = frontier.filter((n) => {
        if (isIgnored(n.path)) {
          unexpanded.add(n.path);
          return false;
        }
        children.set(n.path, children.get(n.path) ?? []);
        return true;
      });
      const next: Node[] = [];
      for (let i = 0; i < expand.length; i += PARENTS_PER_QUERY) {
        const chunk = expand.slice(i, i + PARENTS_PER_QUERY);
        for (const f of await this.listChildren(chunk.map((n) => n.id))) {
          const n = add(f);
          if (n?.folder) next.push(n);
        }
      }
      frontier = next;
    }
    for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    const tree: Tree = { builtAt: Date.now(), byPath, children, unexpanded, archive, prefetched: false };
    trees.set(this.rootId, tree);
    return tree;
  }

  private async config(byPath: Map<string, Node>): Promise<{ ignore: string[]; archive: string }> {
    const norm = (v: unknown) =>
      Array.isArray(v) ? v.map(String).map((s) => s.replace(/^\/+|\/+$/g, "")).filter(Boolean) : [];
    for (const name of ["AGENTS.md", "_Workspace.yaml"]) {
      const n = byPath.get(name);
      if (!n) continue;
      const text = await this.fetch(n);
      if (!text) continue;
      try {
        const raw = name === "AGENTS.md" ? text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] : text;
        const d = (raw ? YAML.parse(raw) : null) as Record<string, unknown> | null;
        if (!d) continue;
        const mounts = (d.mounts ?? {}) as Record<string, unknown>;
        return { ignore: norm(d.ignore), archive: typeof mounts.archive === "string" ? mounts.archive : "Archive" };
      } catch {
        /* unparseable config: walk everything */
      }
    }
    return { ignore: [], archive: "Archive" };
  }

  // Paths under an ignored (unexpanded) folder are resolved segment by segment.
  private async node(rel: string): Promise<Node | null> {
    const safe = assertSafeRelPath(rel);
    const t = await this.tree();
    const hit = t.byPath.get(safe);
    if (hit) return hit;
    const under = [...t.unexpanded].find((u) => safe.startsWith(`${u}/`));
    if (!under) return null;
    let cur = t.byPath.get(under)!;
    for (const part of safe.slice(under.length + 1).split("/")) {
      const res = await this.drive.files.list({
        q: `'${esc(cur.id)}' in parents and name = '${esc(part)}' and trashed = false`,
        fields: "files(id, name, mimeType, modifiedTime, size)",
        pageSize: 2,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const f = res.data.files?.[0];
      if (!f?.id) return null;
      cur = {
        id: f.id,
        name: f.name ?? part,
        path: `${cur.path}/${part}`,
        folder: f.mimeType === FOLDER,
        mime: f.mimeType ?? "",
        modified: f.modifiedTime ?? "",
        size: Number(f.size ?? 0),
      };
    }
    return cur;
  }

  // ---- contents ----

  private async fetch(n: Node): Promise<string | null> {
    if (n.folder || n.mime.startsWith(GOOGLE_NATIVE)) return null; // Docs/Slides aren't text files
    const c = contents.get(n.id);
    if (c && c.modified === n.modified) return c.text;
    let text: string | null = null;
    try {
      const res = await this.drive.files.get(
        { fileId: n.id, alt: "media", supportsAllDrives: true },
        { responseType: "text" },
      );
      text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    } catch {
      text = null; // binary / unreadable files are opaque to the tools
    }
    contents.set(n.id, { modified: n.modified, text });
    return text;
  }

  // First read after a tree build: pull every small text file outside the
  // archive in parallel, so the tools' sequential reads are served from memory.
  private async prefetch(t: Tree) {
    if (t.prefetched) return;
    t.prefetched = true;
    const archive = `${t.archive}/`;
    const todo = [...t.byPath.values()].filter((n) => {
      if (n.folder || !TEXT_EXT.test(n.name) || n.size > PREFETCH_MAX_BYTES) return false;
      if (n.path.startsWith(archive)) return false;
      const c = contents.get(n.id);
      return !(c && c.modified === n.modified);
    });
    await pool(todo, READ_CONCURRENCY, async (n) => {
      await this.fetch(n);
    });
  }

  // ---- Connector ----

  async list(rel: string): Promise<Entry[]> {
    const safe = assertSafeRelPath(rel);
    const t = await this.tree();
    const listed = t.children.get(safe);
    if (listed) return [...listed];
    const n = await this.node(safe);
    if (!n || !n.folder) throw new Error(`Path not found in Drive: ${rel}`);
    // inside an ignored folder: list it directly
    const out: Entry[] = (await this.listChildren([n.id]))
      .filter((f) => f.name && !SKIP.has(f.name))
      .map((f) => ({
        name: f.name!,
        path: safe ? `${safe}/${f.name}` : f.name!,
        kind: f.mimeType === FOLDER ? ("folder" as const) : ("file" as const),
      }));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(rel: string): Promise<string | null> {
    const t = await this.tree();
    const n = await this.node(rel);
    if (!n) return null;
    if (TEXT_EXT.test(n.name) && !n.path.startsWith(`${t.archive}/`)) await this.prefetch(t);
    return this.fetch(n);
  }

  async exists(rel: string): Promise<boolean> {
    return (await this.node(rel)) !== null;
  }

  async mkdir(rel: string): Promise<void> {
    const safe = assertSafeRelPath(rel);
    if (await this.node(safe)) return;
    const parent = parentPath(safe);
    if (parent && !(await this.node(parent))) await this.mkdir(parent);
    const parentNode = (await this.node(parent))!;
    const res = await this.drive.files.create({
      requestBody: { name: baseName(safe), mimeType: FOLDER, parents: [parentNode.id] },
      fields: "id",
      supportsAllDrives: true,
    });
    if (res.data.id) this.remember(safe, res.data.id, true, FOLDER, "");
  }

  async write(rel: string, content: string, opts?: { overwrite?: boolean }): Promise<void> {
    const safe = assertSafeRelPath(rel);
    const existing = await this.node(safe);
    if (existing && !opts?.overwrite) {
      throw new Error(`Refusing to overwrite existing file: ${rel}`);
    }
    if (existing) {
      const res = await this.drive.files.update({
        fileId: existing.id,
        media: { mimeType: mimeFor(safe), body: content },
        fields: "id, modifiedTime, size",
        supportsAllDrives: true,
      });
      existing.modified = res.data.modifiedTime ?? existing.modified;
      existing.size = Number(res.data.size ?? content.length);
      contents.set(existing.id, { modified: existing.modified, text: content });
      return;
    }
    const parent = parentPath(safe);
    if (parent && !(await this.node(parent))) await this.mkdir(parent);
    const parentNode = (await this.node(parent))!;
    const res = await this.drive.files.create({
      requestBody: { name: baseName(safe), parents: [parentNode.id] },
      media: { mimeType: mimeFor(safe), body: content },
      fields: "id, modifiedTime",
      supportsAllDrives: true,
    });
    if (res.data.id) {
      contents.set(res.data.id, { modified: res.data.modifiedTime ?? "", text: content });
      this.remember(safe, res.data.id, false, mimeFor(safe), res.data.modifiedTime ?? "");
    }
  }

  async move(from: string, to: string): Promise<void> {
    const src = await this.node(from);
    if (!src) throw new Error(`Path not found in Drive: ${from}`);
    if (await this.node(to)) throw new Error(`Refusing to move onto existing path: ${to}`);
    const toParent = parentPath(assertSafeRelPath(to));
    if (toParent && !(await this.node(toParent))) await this.mkdir(toParent);
    const newParent = (await this.node(toParent))!;
    const oldParent = (await this.node(parentPath(assertSafeRelPath(from))))!;
    await this.drive.files.update({
      fileId: src.id,
      requestBody: { name: baseName(to) },
      addParents: newParent.id,
      removeParents: oldParent.id,
      supportsAllDrives: true,
    });
    this.invalidate();
  }
}

// Content type from the extension (proposals/decisions are JSON, not markdown).
function mimeFor(p: string): string {
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".yaml") || p.endsWith(".yml")) return "application/yaml";
  return "text/markdown";
}
