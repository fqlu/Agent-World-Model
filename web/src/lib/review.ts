import crypto from "node:crypto";
import YAML from "yaml";
import { Connector } from "./connector";
import { q } from "./db";
import { buildManifest, diffManifest, Manifest } from "./sync";
import { runAudit, Finding } from "./linter";
import { parseWorkspaceYaml } from "./workspace";
import { journalAgentActivity } from "./ops";

// Phase 2 — the review-and-verify loop (the "git model", SPEC §6.9).
// Any agent, in any tool, writes files directly at any time; the app never
// gates writes. It keeps a last-REVIEWED snapshot per workspace (hashes for
// detection + full text for diffs) and, whenever the human looks, shows what
// changed since they last verified the state — each file linted at review
// time, with a before/after diff. Verifying updates the baseline and stamps a
// `verified: human:<owner>` event on entity files and scope overviews
// (durable trust, OKF v0.2). Flagging records a problem to hand to the next
// agent session as a fix-up task.

export type ReviewItem = {
  path: string;
  change: "added" | "modified" | "removed";
  kind: "entity" | "overview" | "wip" | "journal" | "context" | "content";
  stampable: boolean; // gets a verified event when verified
  findings: { rule: string; severity: string; message: string }[];
};

export type Flag = { path: string; note: string; flagged_at: string };

export type ReviewQueue = {
  firstRun: boolean;
  reviewedAt: string | null;
  items: ReviewItem[];
  flags: Flag[];
};

export type DiffLine = { t: "add" | "del" | "ctx"; s: string };
export type FileDiff = {
  path: string;
  binary: boolean;
  hasPrevious: boolean;
  lines: DiffLine[] | null; // null when binary or too large
  current: string | null;
};

function hashLike(s: string): string {
  // must match sync.ts hashing exactly
  return "t:" + crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

// The local connector decodes binary files as mangled UTF-8 rather than
// returning null, so "did read() return text" is not a binary test. Use the
// extension plus a control-character density check.
const NON_TEXT_EXT = /\.(xlsx?|xlsm|pptx?|docx?|pdf|png|jpe?g|gif|webp|svgz|zip|gz|tar|numbers|key|pages|gdoc|gsheet|gslides|gform|drawio|mp4|mov|plugin|command)$/i;

function isBinaryish(path: string, content: string | null): boolean {
  if (NON_TEXT_EXT.test(path)) return true;
  if (content === null) return true;
  const sample = content.slice(0, 2000);
  let ctrl = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0)!;
    if (c === 0 || (c < 9 && c !== 0) || (c > 13 && c < 32) || c === 0xfffd) ctrl++;
  }
  return ctrl > sample.length * 0.02;
}

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

// Snapshot every text file's content (hash prefix "t:") so future reviews can
// show before/after diffs.
async function snapshotAll(c: Connector, wsId: number, manifest: Manifest): Promise<void> {
  for (const [p, h] of Object.entries(manifest)) {
    if (!h.startsWith("t:") || NON_TEXT_EXT.test(p)) continue;
    const md = await c.read(p);
    if (md !== null && !isBinaryish(p, md)) q.setSnapshot(wsId, p, md);
  }
}

export async function getReviewQueue(c: Connector, wsId: number): Promise<ReviewQueue> {
  const state = q.getReviewState(wsId);
  const current = await buildManifest(c);
  if (!state) {
    // Quiet start: baseline = now. Nothing is retroactively "unreviewed".
    q.saveReviewState(wsId, current, []);
    await snapshotAll(c, wsId, current);
    return { firstRun: true, reviewedAt: null, items: [], flags: [] };
  }
  const baseline = JSON.parse(state.manifest) as Manifest;
  const flags = JSON.parse(state.flags) as Flag[];

  // Backfill snapshots for baselines created before the snapshot store
  // existed: any UNCHANGED path's current content IS its reviewed version.
  for (const [p, h] of Object.entries(baseline)) {
    if (!h.startsWith("t:") || current[p] !== h || NON_TEXT_EXT.test(p)) continue;
    if (q.getSnapshot(wsId, p) === undefined) {
      const md = await c.read(p);
      if (md !== null && !isBinaryish(p, md)) q.setSnapshot(wsId, p, md);
    }
  }

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

// ---- Diffs -----------------------------------------------------------------

const MAX_DIFF_LINES = 3000;

// Plain LCS line diff — no dependencies, fine at workspace-file sizes.
function lineDiff(prev: string, curr: string): DiffLine[] | null {
  const a = prev.split("\n");
  const b = curr.split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null;
  const n = a.length;
  const mLen = b.length;
  // LCS table (n+1 x m+1), row-major Uint32
  const w = mLen + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = mLen - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < mLen) {
    if (a[i] === b[j]) {
      out.push({ t: "ctx", s: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      out.push({ t: "del", s: a[i] });
      i++;
    } else {
      out.push({ t: "add", s: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ t: "del", s: a[i++] });
  while (j < mLen) out.push({ t: "add", s: b[j++] });
  return out;
}

// Collapse long unchanged runs so the diff reads like a diff, not the file.
function collapseContext(lines: DiffLine[], keep = 3): DiffLine[] {
  const out: DiffLine[] = [];
  let run: DiffLine[] = [];
  const flush = (isEdge: boolean) => {
    if (run.length <= keep * 2 + 1) out.push(...run);
    else {
      if (!isEdge || out.length) out.push(...run.slice(0, keep));
      out.push({ t: "ctx", s: `… ${run.length - keep * 2} unchanged line(s) …` });
      out.push(...run.slice(-keep));
    }
    run = [];
  };
  for (const l of lines) {
    if (l.t === "ctx") run.push(l);
    else {
      flush(out.length === 0);
      out.push(l);
    }
  }
  flush(true);
  return out;
}

export async function getFileDiff(c: Connector, wsId: number, path: string): Promise<FileDiff> {
  const current = await c.read(path);
  const previous = q.getSnapshot(wsId, path);
  if (isBinaryish(path, current) && previous === undefined) {
    return { path, binary: true, hasPrevious: false, lines: null, current: null };
  }
  if (current === null && previous === undefined) {
    return { path, binary: true, hasPrevious: false, lines: null, current: null };
  }
  if (current === null) {
    // removed (or unreadable) — show the previous content as all-deletions
    const lines = (previous ?? "").split("\n").map((s) => ({ t: "del" as const, s }));
    return { path, binary: false, hasPrevious: previous !== undefined, lines, current: null };
  }
  if (previous === undefined) {
    // no before version (new file, or changed before diffs existed)
    const lines = current.split("\n").map((s) => ({ t: "add" as const, s }));
    return { path, binary: false, hasPrevious: false, lines, current };
  }
  const raw = lineDiff(previous, current);
  return {
    path,
    binary: false,
    hasPrevious: true,
    lines: raw ? collapseContext(raw) : null,
    current,
  };
}

// ---- Verify / flag ----------------------------------------------------------

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

export type VerifyResult = { verified: number; stamped: string[] };

// Verify paths: mark them reviewed (baseline := current hash, snapshot :=
// current content) and stamp verified events on entity files / scope
// overviews. Removed files are dropped from the baseline.
export async function verifyPaths(c: Connector, wsId: number, paths: string[]): Promise<VerifyResult> {
  const state = q.getReviewState(wsId);
  if (!state) throw new Error("No review baseline yet — open the review queue first");
  const baseline = JSON.parse(state.manifest) as Manifest;
  let flags = JSON.parse(state.flags) as Flag[];
  const m = await mounts(c);
  const today = new Date().toISOString().slice(0, 10);
  const current = await buildManifest(c);

  const stamped: string[] = [];
  let verified = 0;
  for (const p of paths) {
    if (!(p in current)) {
      // removed file — accept the removal
      delete baseline[p];
      q.deleteSnapshot(wsId, p);
      verified++;
      continue;
    }
    const kind = kindOf(p, m.entities, m.journal, m.context);
    if (kind === "entity" || kind === "overview") {
      const md = await c.read(p);
      if (md !== null) {
        const updated = injectVerified(md, m.owner, today, "verified via review queue");
        await c.write(p, updated, { overwrite: true });
        stamped.push(p);
      }
    }
    // baseline + snapshot get the post-stamp state so the stamp never re-queues
    const after = await c.read(p);
    if (after !== null) {
      baseline[p] = hashLike(after);
      if (!isBinaryish(p, after)) q.setSnapshot(wsId, p, after);
    } else {
      baseline[p] = current[p];
    }
    verified++;
    flags = flags.filter((f) => f.path !== p);
  }
  try {
    await journalAgentActivity(
      c,
      m.journal,
      `review: verified ${verified} file(s)${stamped.length ? `, ${stamped.length} trust stamp(s)` : ""}`,
    );
    // Fold the app's own journal append into the baseline — deterministic
    // bookkeeping must not re-queue itself.
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const jPath = `${m.journal}/${yyyy}/${yyyy}-${mm}/${yyyy}-${mm}-${dd}.md`;
    const jmd = await c.read(jPath);
    if (jmd !== null) {
      baseline[jPath] = hashLike(jmd);
      q.setSnapshot(wsId, jPath, jmd);
    }
  } catch {
    /* best-effort */
  }
  q.saveReviewState(wsId, baseline, flags);
  return { verified, stamped };
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
