import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.HUB_DATA_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hub.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('local','gdrive')),
  root TEXT NOT NULL,
  account_email TEXT,
  profile TEXT NOT NULL DEFAULT 'incubeta',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  findings TEXT NOT NULL,
  stats TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('scaffold','adopt')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  result TEXT
);
CREATE TABLE IF NOT EXISTS google_tokens (
  email TEXT PRIMARY KEY,
  tokens TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export type WorkspaceRow = {
  id: number;
  name: string;
  kind: "local" | "gdrive";
  root: string;
  account_email: string | null;
  profile: string;
  created_at: string;
};

export type AuditRow = {
  id: number;
  workspace_id: number;
  created_at: string;
  findings: string;
  stats: string;
};

export type ProposalRow = {
  id: number;
  workspace_id: number;
  kind: "scaffold" | "adopt";
  created_at: string;
  plan: string;
  status: string;
  result: string | null;
};

export const q = {
  listWorkspaces: () =>
    db.prepare("SELECT * FROM workspaces ORDER BY id").all() as WorkspaceRow[],
  getWorkspace: (id: number) =>
    db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | undefined,
  createWorkspace: (w: {
    name: string;
    kind: string;
    root: string;
    account_email?: string | null;
    profile?: string;
  }) =>
    Number(
      db
        .prepare(
          "INSERT INTO workspaces (name, kind, root, account_email, profile) VALUES (?,?,?,?,?)",
        )
        .run(w.name, w.kind, w.root, w.account_email ?? null, w.profile ?? "incubeta")
        .lastInsertRowid,
    ),

  insertAudit: (workspaceId: number, findings: unknown, stats: unknown) =>
    Number(
      db
        .prepare("INSERT INTO audits (workspace_id, findings, stats) VALUES (?,?,?)")
        .run(workspaceId, JSON.stringify(findings), JSON.stringify(stats)).lastInsertRowid,
    ),
  getAudit: (id: number) =>
    db.prepare("SELECT * FROM audits WHERE id = ?").get(id) as AuditRow | undefined,
  listAudits: (workspaceId: number) =>
    db
      .prepare("SELECT * FROM audits WHERE workspace_id = ? ORDER BY id DESC")
      .all(workspaceId) as AuditRow[],

  insertProposal: (workspaceId: number, kind: string, plan: unknown) =>
    Number(
      db
        .prepare("INSERT INTO proposals (workspace_id, kind, plan) VALUES (?,?,?)")
        .run(workspaceId, kind, JSON.stringify(plan)).lastInsertRowid,
    ),
  getProposal: (id: number) =>
    db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow | undefined,
  listProposals: (workspaceId: number) =>
    db
      .prepare("SELECT * FROM proposals WHERE workspace_id = ? ORDER BY id DESC")
      .all(workspaceId) as ProposalRow[],
  finishProposal: (id: number, status: string, result: unknown) =>
    db
      .prepare("UPDATE proposals SET status = ?, result = ? WHERE id = ?")
      .run(status, JSON.stringify(result), id),

  saveTokens: (email: string, tokens: unknown) =>
    db
      .prepare(
        "INSERT INTO google_tokens (email, tokens) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET tokens = excluded.tokens",
      )
      .run(email, JSON.stringify(tokens)),
  getTokens: (email: string) =>
    db.prepare("SELECT tokens FROM google_tokens WHERE email = ?").get(email) as
      | { tokens: string }
      | undefined,
  listTokenEmails: () =>
    (db.prepare("SELECT email FROM google_tokens ORDER BY email").all() as { email: string }[]).map(
      (r) => r.email,
    ),
};

export default db;
