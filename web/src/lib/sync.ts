import crypto from "node:crypto";
import { Connector } from "./connector";
import { parseWorkspaceYaml } from "./workspace";
import { writeIndex } from "./index-gen";
import { writeModel } from "./model-gen";
import { journalAgentActivity } from "./ops";

// The maintenance loop (SPEC §6.9). Deterministic detection only — the app
// notices drift and re-derives projections; an agent does the reflection.

export type Manifest = Record<string, string>; // workspace-relative path -> content hash
export type SyncDiff = { added: string[]; modified: string[]; removed: string[] };
export type SyncReport = {
  firstRun: boolean;
  diff: SyncDiff;
  tracked: number;
  changed: number;
};

// Derived artifacts are excluded so the loop never flags its own output.
const EXCLUDE_FILES = new Set(["_Index.md", "_Model.json", "_Digest.md"]);

function hashText(s: string): string {
  return "t:" + crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

async function archiveMount(c: Connector): Promise<string> {
  const raw = await c.read("_Workspace.yaml");
  const decl = raw ? parseWorkspaceYaml(raw) : null;
  return decl?.mounts?.archive ?? "Archive";
}

export async function buildManifest(c: Connector): Promise<Manifest> {
  const archive = await archiveMount(c);
  const m: Manifest = {};
  async function walk(path: string) {
    for (const e of await c.list(path)) {
      if (e.kind === "folder") {
        if (e.name === archive) continue; // skip the archive (churns, low signal)
        await walk(e.path);
      } else {
        if (EXCLUDE_FILES.has(e.path)) continue;
        const content = await c.read(e.path);
        m[e.path] = content !== null ? hashText(content) : `bin:${e.name}`;
      }
    }
  }
  await walk("");
  return m;
}

export function diffManifest(oldM: Manifest, newM: Manifest): SyncDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const [p, h] of Object.entries(newM)) {
    if (!(p in oldM)) added.push(p);
    else if (oldM[p] !== h) modified.push(p);
  }
  for (const p of Object.keys(oldM)) if (!(p in newM)) removed.push(p);
  added.sort();
  modified.sort();
  removed.sort();
  return { added, modified, removed };
}

export function diffCount(d: SyncDiff): number {
  return d.added.length + d.modified.length + d.removed.length;
}

// Read-only: what changed since the last stored sync?
export async function detectChanges(
  c: Connector,
  stored: Manifest | null,
): Promise<SyncReport> {
  const current = await buildManifest(c);
  if (!stored) {
    return { firstRun: true, diff: { added: [], modified: [], removed: [] }, tracked: Object.keys(current).length, changed: 0 };
  }
  const diff = diffManifest(stored, current);
  return { firstRun: false, diff, tracked: Object.keys(current).length, changed: diffCount(diff) };
}

// A reflection scaffold: the drift framed as a task for an agent. The app
// emits this; the agent interprets it and proposes model updates.
export function reflectionScaffold(diff: SyncDiff, syncedAt: string | null): string {
  const section = (title: string, items: string[]) =>
    items.length ? `\n### ${title}\n${items.map((p) => `- \`${p}\``).join("\n")}\n` : "";
  return [
    `# Reflection scaffold`,
    syncedAt ? `Drift since last sync (${syncedAt}).` : `Drift since baseline.`,
    ``,
    `Review the changed files below and propose world-model updates through the`,
    `app's normal flows — new/changed **entities** and **relationships**, updated`,
    `scope **overviews** (Active workstreams, Recent activity), and **context`,
    `group** membership. Do not invent facts; ground each update in a changed file.`,
    section("Modified", diff.modified),
    section("Added", diff.added),
    section("Removed", diff.removed),
  ].join("\n");
}
