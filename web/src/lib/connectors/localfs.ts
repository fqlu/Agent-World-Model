import fs from "node:fs/promises";
import path from "node:path";
import { Connector, Entry, assertSafeRelPath } from "../connector";

const SKIP = new Set([".git", ".DS_Store", "node_modules", ".Trash"]);

export class LocalFsConnector implements Connector {
  constructor(private root: string) {}

  private abs(rel: string): string {
    const safe = assertSafeRelPath(rel);
    const full = path.resolve(this.root, safe);
    if (!full.startsWith(path.resolve(this.root))) {
      throw new Error(`Path escapes workspace root: ${rel}`);
    }
    return full;
  }

  async list(rel: string): Promise<Entry[]> {
    const dir = this.abs(rel);
    const items = await fs.readdir(dir, { withFileTypes: true });
    const prefix = assertSafeRelPath(rel);
    return items
      .filter((d) => !SKIP.has(d.name) && !d.name.startsWith(".") )
      .map((d) => ({
        name: d.name,
        path: prefix ? `${prefix}/${d.name}` : d.name,
        kind: d.isDirectory() ? ("folder" as const) : ("file" as const),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(rel: string): Promise<string | null> {
    try {
      return await fs.readFile(this.abs(rel), "utf-8");
    } catch {
      return null;
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.stat(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  async write(rel: string, content: string, opts?: { overwrite?: boolean }): Promise<void> {
    const full = this.abs(rel);
    if (!opts?.overwrite && (await this.exists(rel))) {
      throw new Error(`Refusing to overwrite existing file: ${rel}`);
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
  }

  async mkdir(rel: string): Promise<void> {
    await fs.mkdir(this.abs(rel), { recursive: true });
  }

  async move(from: string, to: string): Promise<void> {
    if (await this.exists(to)) {
      throw new Error(`Refusing to move onto existing path: ${to}`);
    }
    const dest = this.abs(to);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(this.abs(from), dest);
  }
}
