// A connector exposes a workspace as a tree of files/folders addressed by
// workspace-relative POSIX paths ('' = workspace root). All write operations
// are additive or moves — the interface deliberately has no delete.

export type Entry = {
  name: string;
  path: string; // workspace-relative, '/' separated
  kind: "file" | "folder";
};

export interface Connector {
  list(path: string): Promise<Entry[]>;
  read(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  write(path: string, content: string, opts?: { overwrite?: boolean }): Promise<void>;
  mkdir(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
}

export function assertSafeRelPath(p: string): string {
  const norm = p.split("/").filter((s) => s.length > 0);
  if (norm.some((s) => s === "." || s === "..")) {
    throw new Error(`Unsafe path rejected: ${p}`);
  }
  return norm.join("/");
}

export function parentPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function baseName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
