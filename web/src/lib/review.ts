import crypto from "node:crypto";
import YAML from "yaml";
import { Connector } from "./connector";
import { q } from "./db";
import { buildManifest, diffManifest, Manifest } from "./sync";
import { runAudit, Finding } from "./linter";
import { parseWorkspaceYaml, parseFrontmatter } from "./workspace";
import { journalAgentActivity } from "./ops";

// Phase 2 — the review-and-verify loop (the "git model", SPEC §6.9).
// Any agent, in any tool, writes files directly at any time; the app never
// gates writes. Instead it keeps a last-REVIEWED snapshot per workspace and,
// whenever the human looks, shows what changed since they last blessed the
// state — each file linted at review time. Blessing updates the baseline and
// stamps a `verified: human:<owner>` event on entity files and scope
// overviews (durable trust, OKF v0.2). Flagging records a problem to hand to
// the next agent session as a reflection task.

export type ReviewItem = {
  path: string;
  change: "added" | "modified" | "removed";
  kind: "entity" | "overview" | "wip" | "journal" | "context" | "content";
  stampable: boolean; // gets a verified event on bless
  findings: { rule: string; severity: string; message: string }[];
};

export type Flag = { path: string; note: string; flagged_at: string };

export type ReviewQueue = {
  firstRun: boolean;
  reviewedAt: string | null;
  items: ReviewItem[];
  flags: Flag[];
};

function kindOf(path: string, entitiesMount: string, journalMount: string, contextDir: string): ReviewItem["kind"] {
  if (path.startsWith(`${entitiesMount}/`)) return "entity";
  if (path.endsWith("/_Overview.md") || path === "_Overview.md") return "overview";
  if (path.includes("| WIP Notes/")) return "wip";
  if (path.startsWith(`${journalMount}/`)) return "journal";
  if (path.includes(`/${contextDir}/`) || path.startsWith(`${contextDir}/`)) return "context";
  return "content";
}

async function mounts(c: Connector) {
  const raw = await c.read("_Workspace.yaml");
  const decl = raw ? parseWorkspaceYaml(raw) : null;
  return {
    entities: decl?.mounts?.entities ?? "_Entities",
    journal: decl?.mounts?.journal ?? "Journal",
    context: decl?.mounts?.context ?? "_Context",
    owner: decl?.owner?.email ? `human:${decl.owner.email}` : "human:owner",
  };
}

export async function getReviewQueue(c: Connector, wsId: number): Promise<ReviewQueue> {
  const state = q.getReviewState(wsId);
  const current = await buildManifest(c);
  if (!state) {
    // Quiet start: baseline = now. Nothing is retroactively "unreviewed".
    q.saveReviewState(wsId, current, []);
    return { firstRun: true, reviewedAt: null, items: [], flags: [] };
  }
  const baseline = JSON.parse(state.manifest) as Manifest;
  const flags = JSON.parse(state.flags) as Flag[];
  const diff = diffManifest(baseline, current);
  if (diff.added.length + diff.modified.length + diff.removed.length === 0) {
    return { firstRun: false, reviewedAt: state.reviewed_at, items: [], flags };
  }

  // Lint once, index findings by path — each changed file shows its current
  // protocol health right in the queue.
  const byPath = new Map<string, Finding[]>();
  try {
    const audit = await runAudit(c);
    for (const f of audit.findings) {
      if (!byPath.has(f.path)) byPath.set(f.path, []);
      byPath.get(f.path)!.push(f);
    }
  } catch {
    /* lint is best-effort in the queue */
  }

  const m = await mounts(c);
  const items: ReviewItem[] = [];
  const push = (path: string, change: ReviewItem["change"]) => {
    const kind = kindOf(path, m.entities, m.journal, m.context);
    items.push({
      path,
      change,
      kind,
      stampable: change !== "removed" && (kind === "entity" || kind === "overview"),
      findings: (byPath.get(path) ?? []).map((f) => ({ rule: f.rule, severity: f.severity, message: f.message })),
    });
  };
  for (const p of diff.added) push(p, "added");
  for (const p of diff.modified) push(p, "modified");
  for (const p of diff.removed) push(p, "removed");
  return { firstRun: false, reviewedAt: state.reviewed_at, items, flags };
}

// Append a verified event to a markdown file's frontmatter (creating the
// frontmatter block if absent). Returns the new content.
function injectVerified(md: string, by: string, at: string, note: string): string {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let data: Record<string, unknown> = {};
  let body = md;
  if (m) {
    try {
      data = (YAML.parse(m[1]) as Record<string, unknown>) ?? {};
    } catch {
      data = {};
    }
    body = m[2];
  }
  const verified = Array.isArray(data.verified) ? data.verified : [];
  verified.push({ by, at, note });
  data.verified = verified;
  return `---\n${YAML.stringify(data).trimEnd()}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}

export type BlessResult = { blessed: number; stamped: string[] };

// Bless paths: mark them reviewed (baseline := current hash) and stamp
// verified events on entity files / scope overviews. Removed files are simply
// dropped from the baseline.
export async function blessPaths(c: Connector, wsId: number, paths: string[]): Promise<BlessResult> {
  const state = q.getReviewState(wsId);
  if (!state) throw new Error("No review baseline yet — open the review queue first");
  const baseline = JSON.parse(state.manifest) as Manifest;
  let flags = JSON.parse(state.flags) as Flag[];
  const m = await mounts(c);
  const today = new Date().toISOString().slice(0, 10);
  const current = await buildManifest(c);

  const stamped: string[] = [];
  let blessed = 0;
  for (const p of paths) {
    if (!(p in current)) {
      // removed file — accept the removal
      delete baseline[p];
      blessed++;
      continue;
    }
    const kind = kindOf(p, m.entities, m.journal, m.context);
    if (kind === "entity" || kind === "overview") {
      const md = await c.read(p);
      if (md !== null) {
        const updated = injectVerified(md, m.owner, today, "reviewed via review queue");
        await c.write(p, updated, { overwrite: true });
        stamped.push(p);
      }
    }
    // baseline gets the post-stamp hash so the stamp itself never re-queues
    const after = await c.read(p);
    baseline[p] = after !== null ? hashLike(after) : current[p];
    blessed++;
    flags = flags.filter((f) => f.path !== p);
  }
  try {
    await journalAgentActivity(
      c,
      m.journal,
      `review: blessed ${blessed} file(s)${stamped.length ? `, ${stamped.length} verified stamp(s)` : ""}`,
    );
    // Fold the app's own journal append into the baseline — deterministic
    // bookkeeping must not re-queue itself.
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const jPath = `${m.journal}/${yyyy}/${yyyy}-${mm}/${yyyy}-${mm}-${dd}.md`;
    const jmd = await c.read(jPath);
    if (jmd !== null) baseline[jPath] = hashLike(jmd);
  } catch {
    /* best-effort */
  }
  q.saveReviewState(wsId, baseline, flags);
  return { blessed, stamped };
}

// Must match sync.ts hashing exactly (same "t:" + sha1/16 scheme).
function hashLike(s: string): string {
  return "t:" + crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

export async function flagPath(c: Connector, wsId: number, path: string, note: string): Promise<Flag[]> {
  const state = q.getReviewState(wsId);
  if (!state) throw new Error("No review baseline yet — open the review queue first");
  const flags = (JSON.parse(state.flags) as Flag[]).filter((f) => f.path !== path);
  flags.push({ path, note: note.trim() || "flagged for follow-up", flagged_at: new Date().toISOString().slice(0, 10) });
  q.saveReviewState(wsId, JSON.parse(state.manifest), flags);
  return flags;
}

export async function unflagPath(wsId: number, path: string): Promise<Flag[]> {
  const state = q.getReviewState(wsId);
  if (!state) throw new Error("No review baseline yet");
  const flags = (JSON.parse(state.flags) as Flag[]).filter((f) => f.path !== path);
  q.saveReviewState(wsId, JSON.parse(state.manifest), flags);
  return flags;
}

// The flags framed as a task for the next agent session (same pattern as the
// sync reflection scaffold).
export function flagsScaffold(flags: Flag[]): string {
  if (!flags.length) return "";
  return [
    "# Review flags — fix-up task",
    "",
    "A human reviewed recent changes in this workspace and flagged these files.",
    "For each: read the file, address the note, keep all protocol conventions",
    "(AGENTS.md), and never delete — archive instead.",
    "",
    ...flags.map((f) => `- \`${f.path}\` — ${f.note} *(flagged ${f.flagged_at})*`),
    "",
  ].join("\n");
}
