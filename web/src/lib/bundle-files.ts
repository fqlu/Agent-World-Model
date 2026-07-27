import fs from "node:fs/promises";
import path from "node:path";

// Read-only helpers for browsing a generated bundle directory in the app's
// data dir. Paths are validated to stay inside the bundle root.

export type BundleFile = { rel: string; section: string; title: string };

const SECTION_ORDER = ["index", "entities", "scopes", "groups", "reference", "log"];

function sectionOf(rel: string): string {
  if (rel === "index.md") return "index";
  if (rel === "log.md") return "log";
  const dir = rel.split("/")[0];
  if (dir === "entities" || dir === "scopes" || dir === "groups") return dir;
  return "reference";
}

export async function listBundleFiles(bundleDir: string): Promise<BundleFile[]> {
  const out: BundleFile[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".md")) {
        const rel = path.relative(bundleDir, p);
        out.push({ rel, section: sectionOf(rel), title: titleOf(await fs.readFile(p, "utf-8")) || e.name });
      }
    }
  }
  await walk(bundleDir);
  out.sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
      a.title.localeCompare(b.title),
  );
  return out;
}

function titleOf(md: string): string {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const t = fm[1].match(/^title:\s*(.+)$/m);
    if (t) return t[1].trim().replace(/^["']|["']$/g, "");
  }
  const h = md.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : "";
}

// Returns the file's content, or null if the path escapes the bundle dir or
// doesn't exist.
export async function readBundleFile(bundleDir: string, rel: string): Promise<string | null> {
  const abs = path.resolve(bundleDir, rel);
  if (!abs.startsWith(path.resolve(bundleDir) + path.sep) && abs !== path.resolve(bundleDir)) return null;
  if (!abs.endsWith(".md")) return null;
  try {
    return await fs.readFile(abs, "utf-8");
  } catch {
    return null;
  }
}
