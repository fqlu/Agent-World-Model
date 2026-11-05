// The Dreaming inbox (Draft_ Dreaming Inbox Spec §3–6).
//
// Agents write `<proposals mount>/<agent>/YYYY-MM-DD.proposals.json`
// (schema dcp-proposals/1). Only the app writes the sibling
// `YYYY-MM-DD.decisions.json` (schema dcp-decisions/1). Neither side writes
// the other's file. Accepted ops are applied here with an md5 stale check;
// nothing is ever deleted.

import crypto from "node:crypto";
import YAML from "yaml";
import { Connector, parentPath } from "./connector";
import { readDecl, resolveMounts } from "./config";
import { journalAgentActivity } from "./ops";

export const PROPOSALS_SCHEMA = "dcp-proposals/1";
export const DECISIONS_SCHEMA = "dcp-decisions/1";

// ---------------------------------------------------------------- types

export type ProposalOp =
  | { action: "replace"; path: string; find: string; replace: string; base_md5?: string }
  | {
      action: "append_line";
      path: string;
      section: string;
      text: string;
      position: "top" | "bottom";
      base_md5?: string;
    }
  | { action: "frontmatter"; path: string; set: Record<string, unknown>; base_md5?: string }
  | { action: "move"; path: string; to: string }
  | { action: "create"; path: string; content: string };

export type Evidence = { path: string; quote: string };

export type QuestionOption = { id: string; label: string; ops: ProposalOp[]; follow_up?: string };

export type Question = { text: string; options: QuestionOption[]; free_text: boolean };

export type RunMeta = {
  id?: string;
  agent?: string;
  mode?: string;
  runtime?: string;
  checks?: string[];
  files_read?: number;
  maintain?: string;
  summary?: string;
};

export type ProposalItem = {
  id: string;
  first_seen?: string;
  carried_from?: string;
  lens: "triage" | "hygiene";
  section?: string;
  kind: "edit" | "question" | "move" | "create" | "info";
  tier?: string;
  priority?: "now" | "soon" | "later";
  scope?: string;
  title: string;
  why?: string;
  evidence: Evidence[];
  confidence?: string;
  question?: Question;
  ops: ProposalOp[];
};

export type DecisionKind = "accept" | "edit" | "reject" | "answer" | "defer";

export type ResultStatus = "applied" | "stale" | "failed" | "pending-agent";

export type DecisionResult = { status: ResultStatus; detail?: string; applied_at?: string };

export type Decision = {
  id: string;
  decision: DecisionKind;
  option?: string;
  answer?: string;
  edited_ops?: ProposalOp[];
  reason?: string;
  defer_until?: string;
  by: string;
  at: string;
  result?: DecisionResult;
};

export type DecisionsFile = { schema: string; proposals: string; decisions: Decision[] };

export type InboxRun = {
  agent: string; // agent folder name
  date: string; // YYYY-MM-DD from the file name
  file: string; // workspace-relative path of the proposals file
  run: RunMeta;
  itemCount: number;
};

export type ItemStatus = "open" | "deferred" | "decided";

export type InboxItem = ProposalItem & {
  source: { agent: string; date: string; file: string };
  status: ItemStatus;
  decision?: Decision & { file: string };
};

export type Inbox = {
  mount: string;
  mountExists: boolean;
  runs: InboxRun[]; // newest first
  items: InboxItem[];
  counts: { open: number; deferred: number; decided: number; now: number };
  problems: string[];
};

// ---------------------------------------------------------------- parsing

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const nonEmpty = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;

// Parse one op; returns a string describing the problem when malformed.
export function parseOp(raw: unknown): ProposalOp | string {
  if (!isObj(raw)) return "op is not an object";
  const action = str(raw.action);
  const path = nonEmpty(raw.path);
  if (!path) return `op ${action ?? "?"} has no path`;
  const base_md5 = nonEmpty(raw.base_md5);
  switch (action) {
    case "replace": {
      const find = nonEmpty(raw.find);
      const replace = str(raw.replace);
      if (!find || replace === undefined) return `replace on ${path} needs find + replace`;
      return { action, path, find, replace, base_md5 };
    }
    case "append_line": {
      const section = nonEmpty(raw.section);
      const text = nonEmpty(raw.text);
      if (!section || !text) return `append_line on ${path} needs section + text`;
      const position = raw.position === "bottom" ? "bottom" : "top";
      return { action, path, section, text, position, base_md5 };
    }
    case "frontmatter": {
      if (!isObj(raw.set)) return `frontmatter on ${path} needs a set object`;
      return { action, path, set: raw.set, base_md5 };
    }
    case "move": {
      const to = nonEmpty(raw.to);
      if (!to) return `move of ${path} needs to`;
      return { action, path, to };
    }
    case "create": {
      const content = str(raw.content);
      if (content === undefined) return `create of ${path} needs content`;
      return { action, path, content };
    }
    default:
      return `unsupported op action: ${String(raw.action)}`;
  }
}

function parseOps(raw: unknown, where: string, problems: string[]): ProposalOp[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${where}: ops is not an array`);
    return [];
  }
  const out: ProposalOp[] = [];
  raw.forEach((r, i) => {
    const op = parseOp(r);
    if (typeof op === "string") problems.push(`${where} op ${i}: ${op}`);
    else out.push(op);
  });
  return out;
}

const KINDS = new Set(["edit", "question", "move", "create", "info"]);

export function parseItem(raw: unknown, where: string, problems: string[]): ProposalItem | null {
  if (!isObj(raw)) {
    problems.push(`${where}: item is not an object`);
    return null;
  }
  const id = nonEmpty(raw.id);
  const title = nonEmpty(raw.title);
  if (!id || !title) {
    problems.push(`${where}: item missing id or title — skipped`);
    return null;
  }
  const at = `${where} ${id}`;
  const evidence: Evidence[] = Array.isArray(raw.evidence)
    ? raw.evidence
        .filter(isObj)
        .map((e) => ({ path: str(e.path) ?? "", quote: str(e.quote) ?? "" }))
        .filter((e) => e.path || e.quote)
    : [];
  let question: Question | undefined;
  if (isObj(raw.question)) {
    const q = raw.question;
    const options: QuestionOption[] = [];
    if (Array.isArray(q.options)) {
      q.options.forEach((o, i) => {
        if (!isObj(o) || !nonEmpty(o.id)) {
          problems.push(`${at}: option ${i} malformed — skipped`);
          return;
        }
        options.push({
          id: o.id as string,
          label: nonEmpty(o.label) ?? (o.id as string),
          ops: parseOps(o.ops, `${at} option ${String(o.id)}`, problems),
          follow_up: str(o.follow_up),
        });
      });
    }
    question = {
      text: str(q.text) ?? title,
      options,
      free_text: q.free_text !== false,
    };
  }
  const kindRaw = str(raw.kind);
  const kind = (kindRaw && KINDS.has(kindRaw) ? kindRaw : question ? "question" : "info") as ProposalItem["kind"];
  const priority = str(raw.priority);
  return {
    id,
    first_seen: str(raw.first_seen),
    carried_from: str(raw.carried_from),
    lens: raw.lens === "triage" ? "triage" : "hygiene",
    section: str(raw.section),
    kind,
    tier: str(raw.tier),
    priority: priority === "now" || priority === "soon" || priority === "later" ? priority : undefined,
    scope: nonEmpty(raw.scope),
    title,
    why: str(raw.why),
    evidence,
    confidence: str(raw.confidence),
    question,
    ops: parseOps(raw.ops, at, problems),
  };
}

export function parseProposalsFile(
  text: string,
  where: string,
): { run: RunMeta; items: ProposalItem[]; problems: string[] } {
  const problems: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { run: {}, items: [], problems: [`${where}: invalid JSON (${(e as Error).message})`] };
  }
  if (!isObj(data)) return { run: {}, items: [], problems: [`${where}: not a JSON object`] };
  if (data.schema !== PROPOSALS_SCHEMA) {
    problems.push(`${where}: schema is ${JSON.stringify(data.schema)}, expected ${PROPOSALS_SCHEMA}`);
  }
  const r = isObj(data.run) ? data.run : {};
  const run: RunMeta = {
    id: str(r.id),
    agent: str(r.agent),
    mode: str(r.mode),
    runtime: str(r.runtime),
    checks: Array.isArray(r.checks) ? r.checks.filter((x): x is string => typeof x === "string") : undefined,
    files_read: typeof r.files_read === "number" ? r.files_read : undefined,
    maintain: str(r.maintain),
    summary: str(r.summary),
  };
  const items: ProposalItem[] = [];
  if (!Array.isArray(data.items)) problems.push(`${where}: items is not an array`);
  else
    data.items.forEach((raw, i) => {
      const item = parseItem(raw, `${where} item ${i}`, problems);
      if (item) items.push(item);
    });
  return { run, items, problems };
}

const DECISION_KINDS = new Set(["accept", "edit", "reject", "answer", "defer"]);

export function parseDecisionsFile(
  text: string,
  where: string,
): { file: DecisionsFile | null; problems: string[] } {
  const problems: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { file: null, problems: [`${where}: invalid JSON (${(e as Error).message})`] };
  }
  if (!isObj(data)) return { file: null, problems: [`${where}: not a JSON object`] };
  const decisions: Decision[] = [];
  if (Array.isArray(data.decisions)) {
    data.decisions.forEach((d, i) => {
      if (!isObj(d) || !nonEmpty(d.id) || !DECISION_KINDS.has(String(d.decision))) {
        problems.push(`${where}: decision ${i} malformed — skipped`);
        return;
      }
      decisions.push(d as unknown as Decision);
    });
  }
  return {
    file: {
      schema: str(data.schema) ?? DECISIONS_SCHEMA,
      proposals: str(data.proposals) ?? "",
      decisions,
    },
    problems,
  };
}

// ---------------------------------------------------------------- inbox

const PROPOSALS_RE = /^(\d{4}-\d{2}-\d{2})\.proposals\.json$/;
const DECISIONS_RE = /^(\d{4}-\d{2}-\d{2})\.decisions\.json$/;

export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ISO timestamp with the server's local UTC offset, e.g. 2026-11-05T19:12:00+11:00.
export function localIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${localDate(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

export async function proposalsMount(c: Connector): Promise<string> {
  return resolveMounts(await readDecl(c)).proposals;
}

function isDeferredNow(d: Decision, today: string): boolean {
  return d.decision === "defer" && !!d.defer_until && d.defer_until.slice(0, 10) > today;
}

export async function listInbox(c: Connector): Promise<Inbox> {
  const mount = await proposalsMount(c);
  const empty: Inbox = {
    mount,
    mountExists: false,
    runs: [],
    items: [],
    counts: { open: 0, deferred: 0, decided: 0, now: 0 },
    problems: [],
  };
  if (!(await c.exists(mount))) return empty;

  const problems: string[] = [];
  const runs: (InboxRun & { items: ProposalItem[] })[] = [];
  // Latest decision per id across every decisions file of every agent.
  const decisions = new Map<string, Decision & { file: string; fileDate: string }>();

  const agents = (await c.list(mount)).filter((e) => e.kind === "folder");
  for (const agent of agents) {
    const files = (await c.list(agent.path)).filter((e) => e.kind === "file");
    for (const f of files) {
      const pm = f.name.match(PROPOSALS_RE);
      const dm = f.name.match(DECISIONS_RE);
      if (!pm && !dm) continue;
      const text = await c.read(f.path);
      if (text === null) {
        problems.push(`${f.path}: could not be read`);
        continue;
      }
      if (pm) {
        const parsed = parseProposalsFile(text, f.path);
        problems.push(...parsed.problems);
        runs.push({
          agent: agent.name,
          date: pm[1],
          file: f.path,
          run: parsed.run,
          itemCount: parsed.items.length,
          items: parsed.items,
        });
      } else if (dm) {
        const parsed = parseDecisionsFile(text, f.path);
        problems.push(...parsed.problems);
        for (const d of parsed.file?.decisions ?? []) {
          const prev = decisions.get(d.id);
          if (!prev || String(d.at ?? "") >= String(prev.at ?? "")) {
            decisions.set(d.id, { ...d, file: f.path, fileDate: dm[1] });
          }
        }
      }
    }
  }

  // Oldest first so the newest run's copy of an id wins.
  runs.sort((a, b) => a.date.localeCompare(b.date) || String(a.run.id ?? "").localeCompare(String(b.run.id ?? "")));
  const byId = new Map<string, InboxItem>();
  for (const r of runs) {
    for (const it of r.items) {
      byId.set(it.id, {
        ...it,
        source: { agent: r.agent, date: r.date, file: r.file },
        status: "open",
      });
    }
  }

  const today = localDate();
  const items: InboxItem[] = [];
  for (const it of byId.values()) {
    const d = decisions.get(it.id);
    if (d) {
      const { fileDate, ...decision } = d;
      it.decision = decision;
      if (d.decision === "defer") {
        it.status = isDeferredNow(d, today) ? "deferred" : "open";
      } else if (
        (d.result?.status === "stale" || d.result?.status === "failed") &&
        it.source.date > fileDate
      ) {
        // A newer run re-proposed the item after a stale/failed apply: open again.
        it.status = "open";
      } else {
        it.status = "decided";
      }
    }
    items.push(it);
  }

  const counts = { open: 0, deferred: 0, decided: 0, now: 0 };
  for (const it of items) {
    counts[it.status]++;
    if (it.status === "open" && it.priority === "now") counts.now++;
  }

  return {
    mount,
    mountExists: true,
    runs: runs
      .map(({ items: _items, ...r }) => {
        void _items;
        return r;
      })
      .reverse(),
    items,
    counts,
    problems,
  };
}

// ---------------------------------------------------------------- applying ops

export function md5(text: string): string {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

export type ApplyResult = {
  status: "applied" | "stale" | "failed";
  detail: string;
  applied: string[]; // human descriptions of ops that were applied
  changedPaths: string[];
};

export function describeOp(op: ProposalOp): string {
  switch (op.action) {
    case "move":
      return `move ${op.path} → ${op.to}`;
    case "append_line":
      return `append_line ${op.path} (## ${op.section}, ${op.position})`;
    default:
      return `${op.action} ${op.path}`;
  }
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function applyFrontmatter(md: string, set: Record<string, unknown>): string {
  const m = md.match(FM_RE);
  if (!m) {
    const block = YAML.stringify(set).trimEnd();
    return `---\n${block}\n---\n${md.startsWith("\n") ? "" : "\n"}${md}`;
  }
  const doc = YAML.parseDocument(m[1]);
  if (doc.errors.length) throw new Error(`frontmatter is not valid YAML: ${doc.errors[0].message}`);
  const nl = m[0].includes("\r\n") ? "\r\n" : "\n";
  let yamlText: string;
  if (doc.contents === null) {
    yamlText = YAML.stringify(set);
  } else {
    for (const [k, v] of Object.entries(set)) doc.set(k, v);
    yamlText = doc.toString();
  }
  return `---${nl}${yamlText.trimEnd()}${nl}---${nl}${md.slice(m[0].length)}`;
}

const headingText = (s: string) => s.replace(/^#+\s*/, "").trim().toLowerCase();

function applyAppendLine(md: string, section: string, text: string, position: "top" | "bottom"): string {
  const nl = md.includes("\r\n") ? "\r\n" : "\n";
  const lines = md.split(/\r?\n/);
  const want = headingText(section);
  const idx = lines.findIndex((l) => /^##\s/.test(l) && headingText(l) === want);
  if (idx < 0) throw new Error(`section "## ${section.replace(/^#+\s*/, "")}" not found`);
  if (position === "top") {
    lines.splice(idx + 1, 0, text);
  } else {
    let end = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^#{1,2}\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    // Insert after the last non-blank line of the section (or right after the heading).
    let at = end;
    while (at > idx + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, text);
  }
  return lines.join(nl);
}

const CHANGES_EXISTING = new Set(["replace", "append_line", "frontmatter"]);

// Apply one item's ops. Every op that edits an existing file must carry
// base_md5, and all of them are checked against the files' current text
// before anything is written — any mismatch refuses the whole item (stale).
// Ops then run in order; on the first failure we stop and report what
// already applied (earlier ops are not rolled back).
export async function applyItemOps(c: Connector, ops: ProposalOp[]): Promise<ApplyResult> {
  const res: ApplyResult = { status: "applied", detail: "", applied: [], changedPaths: [] };
  if (ops.length === 0) return { ...res, detail: "No ops to apply." };

  for (const op of ops) {
    if (!CHANGES_EXISTING.has(op.action)) continue;
    const base = (op as { base_md5?: string }).base_md5;
    if (!base) {
      return { ...res, status: "failed", detail: `${describeOp(op)}: missing base_md5` };
    }
    const cur = await c.read(op.path);
    if (cur === null) {
      return { ...res, status: "stale", detail: `${op.path} no longer exists` };
    }
    if (md5(cur).toLowerCase() !== base.toLowerCase()) {
      return { ...res, status: "stale", detail: `${op.path} has changed since the proposal was written` };
    }
  }

  for (const op of ops) {
    try {
      switch (op.action) {
        case "replace": {
          const cur = await c.read(op.path);
          if (cur === null) throw new Error("file not found");
          const n = cur.split(op.find).length - 1;
          if (n !== 1) throw new Error(`find text occurs ${n} times (must be exactly once)`);
          const i = cur.indexOf(op.find);
          await c.write(op.path, cur.slice(0, i) + op.replace + cur.slice(i + op.find.length), {
            overwrite: true,
          });
          break;
        }
        case "append_line": {
          const cur = await c.read(op.path);
          if (cur === null) throw new Error("file not found");
          await c.write(op.path, applyAppendLine(cur, op.section, op.text, op.position), { overwrite: true });
          break;
        }
        case "frontmatter": {
          const cur = await c.read(op.path);
          if (cur === null) throw new Error("file not found");
          await c.write(op.path, applyFrontmatter(cur, op.set), { overwrite: true });
          break;
        }
        case "create": {
          if (await c.exists(op.path)) throw new Error("file already exists");
          const parent = parentPath(op.path);
          if (parent) await c.mkdir(parent);
          await c.write(op.path, op.content);
          break;
        }
        case "move": {
          if (!(await c.exists(op.path))) throw new Error("source does not exist");
          if (await c.exists(op.to)) throw new Error("destination already exists");
          await c.move(op.path, op.to);
          break;
        }
      }
      res.applied.push(describeOp(op));
      res.changedPaths.push(op.path);
      if (op.action === "move") res.changedPaths.push(op.to);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const done = res.applied.length
        ? ` Already applied before the failure: ${res.applied.join("; ")}.`
        : " Nothing was applied.";
      return { ...res, status: "failed", detail: `${describeOp(op)}: ${msg}.${done}` };
    }
  }
  res.detail = `Applied ${res.applied.length} op${res.applied.length === 1 ? "" : "s"}.`;
  return res;
}

// ---------------------------------------------------------------- decisions

export type DecisionInput = {
  id: string;
  decision: DecisionKind;
  option?: string;
  answer?: string;
  reason?: string;
  defer_until?: string;
  edited_ops?: unknown[];
};

export class DecisionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

// Serialise read-modify-write of a decisions file within this process.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export async function recordDecision(
  c: Connector,
  wsOwnerEmail: string | null | undefined,
  input: DecisionInput,
): Promise<Decision> {
  const id = nonEmpty(input?.id);
  if (!id) throw new DecisionError("id is required");
  if (!DECISION_KINDS.has(String(input.decision))) {
    throw new DecisionError("decision must be accept, edit, reject, answer or defer");
  }

  const inbox = await listInbox(c);
  if (!inbox.mountExists) throw new DecisionError(`No ${inbox.mount}/ folder in this workspace`, 404);
  const item = inbox.items.find((i) => i.id === id);
  if (!item) throw new DecisionError(`No proposal with id ${id}`, 404);
  if (item.status === "decided" && item.decision?.result?.status === "applied") {
    throw new DecisionError(`${id} has already been applied`, 409);
  }

  const decision: Decision = {
    id,
    decision: input.decision,
    by: `human:${wsOwnerEmail || "owner"}`,
    at: localIso(),
  };

  let opsToApply: ProposalOp[] | null = null;
  switch (input.decision) {
    case "reject": {
      const reason = nonEmpty(input.reason);
      if (!reason) throw new DecisionError("A reject needs a reason");
      decision.reason = reason.trim();
      decision.result = { status: "pending-agent" };
      break;
    }
    case "defer": {
      const until = nonEmpty(input.defer_until)?.trim();
      if (!until || !ISO_DATE_RE.test(until) || Number.isNaN(Date.parse(until))) {
        throw new DecisionError("A defer needs defer_until as an ISO date (YYYY-MM-DD)");
      }
      decision.defer_until = until;
      if (nonEmpty(input.reason)) decision.reason = input.reason!.trim();
      break;
    }
    case "answer": {
      const optionId = nonEmpty(input.option);
      const answer = nonEmpty(input.answer)?.trim();
      if (!optionId && !answer) throw new DecisionError("An answer needs an option and/or answer text");
      if (optionId) {
        const opt = item.question?.options.find((o) => o.id === optionId);
        if (!opt) throw new DecisionError(`Unknown option "${optionId}" for ${id}`);
        decision.option = optionId;
        if (opt.ops.length) opsToApply = opt.ops;
      }
      if (answer) decision.answer = answer;
      if (!opsToApply) decision.result = { status: "pending-agent" };
      break;
    }
    case "accept": {
      if (item.kind === "question" && item.ops.length === 0) {
        throw new DecisionError("This is a question — answer it instead of accepting");
      }
      opsToApply = item.ops;
      break;
    }
    case "edit": {
      if (!Array.isArray(input.edited_ops) || input.edited_ops.length === 0) {
        throw new DecisionError("An edit needs edited_ops");
      }
      const parsed: ProposalOp[] = [];
      for (const [i, raw] of input.edited_ops.entries()) {
        const op = parseOp(raw);
        if (typeof op === "string") throw new DecisionError(`edited_ops[${i}]: ${op}`);
        parsed.push(op);
      }
      decision.edited_ops = parsed;
      opsToApply = parsed;
      break;
    }
  }

  let applied: ApplyResult | null = null;
  if (opsToApply) {
    applied = await applyItemOps(c, opsToApply);
    decision.result = { status: applied.status, detail: applied.detail };
    if (applied.status === "applied") decision.result.applied_at = localIso();
  }

  if (applied?.status === "applied" && opsToApply && opsToApply.length > 0) {
    try {
      const journal = resolveMounts(await readDecl(c)).journal;
      await journalAgentActivity(c, journal, `${item.scope ?? "workspace"} — applied dreaming ${id}: ${item.title}`);
    } catch (e) {
      decision.result!.detail = `${decision.result!.detail ?? ""} (journal line not written: ${
        e instanceof Error ? e.message : String(e)
      })`.trim();
    }
  }

  const decisionsPath = item.source.file.replace(/\.proposals\.json$/, ".decisions.json");
  const proposalsName = item.source.file.split("/").pop()!;
  await withLock(decisionsPath, async () => {
    const existing = await c.read(decisionsPath);
    let file: DecisionsFile;
    if (existing === null) {
      file = { schema: DECISIONS_SCHEMA, proposals: proposalsName, decisions: [] };
    } else {
      const parsed = parseDecisionsFile(existing, decisionsPath);
      // Never clobber a file we can't read back.
      if (!parsed.file) throw new DecisionError(`${decisionsPath} is unreadable: ${parsed.problems.join("; ")}`, 500);
      file = parsed.file;
      file.schema = DECISIONS_SCHEMA;
      file.proposals ||= proposalsName;
    }
    const idx = file.decisions.findIndex((d) => d.id === id);
    if (idx >= 0) file.decisions[idx] = decision;
    else file.decisions.push(decision);
    await c.write(decisionsPath, JSON.stringify(file, null, 2) + "\n", { overwrite: existing !== null });
  });

  return decision;
}
