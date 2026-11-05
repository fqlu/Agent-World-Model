import { Connector, Entry } from "./connector";
import { parseWorkspaceYaml } from "./workspace";

// Workspace ignore list (SPEC §2): paths declared under `ignore:` in the
// workspace's own _Workspace.yaml — so the setting travels with the knowledge
// layer, not the app. An ignored folder and everything below it is invisible
// to every tool built on a Connector: audit, adopt, index/model generation,
// entities, sync, exports.

const MANIFEST = "_Workspace.yaml";

// Workspace-relative, '/'-separated, no leading/trailing slashes (a leading
// '/' means the workspace root). Returns null for anything that escapes it.
export function normalizeIgnorePath(raw: string): string | null {
  const parts = raw.trim().replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  if (!parts.length || parts.some((s) => s === "..")) return null;
  return parts.join("/");
}

export function normalizeIgnoreList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const p = normalizeIgnorePath(item);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

export function isIgnored(path: string, ignore: string[]): boolean {
  if (!path) return false;
  return ignore.some((p) => path === p || path.startsWith(`${p}/`));
}

// Filters ignored entries out of list(); everything else passes through.
// Direct reads by path still work (e.g. a relationship that targets a file
// inside an ignored folder), so ignoring never breaks an explicit reference.
export class IgnoringConnector implements Connector {
  private ignore: Promise<string[]> | null = null;

  constructor(private inner: Connector) {}

  private load(): Promise<string[]> {
    this.ignore ??= this.inner
      .read(MANIFEST)
      .then((raw) => normalizeIgnoreList(raw ? parseWorkspaceYaml(raw)?.ignore : []))
      .catch(() => []);
    return this.ignore;
  }

  async list(path: string): Promise<Entry[]> {
    const [ignore, entries] = await Promise.all([this.load(), this.inner.list(path)]);
    if (isIgnored(path, ignore)) return [];
    return entries.filter((e) => !isIgnored(e.path, ignore));
  }

  read(path: string) {
    return this.inner.read(path);
  }

  exists(path: string) {
    return this.inner.exists(path);
  }

  async write(path: string, content: string, opts?: { overwrite?: boolean }) {
    await this.inner.write(path, content, opts);
    if (path === MANIFEST) this.ignore = null; // pick up an edited list
  }

  mkdir(path: string) {
    return this.inner.mkdir(path);
  }

  move(from: string, to: string) {
    return this.inner.move(from, to);
  }
}
