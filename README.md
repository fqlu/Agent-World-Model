# Agent World Model

A protocol plus its installer: a standard structure for a knowledge Drive that
humans and AI agents share, and a web app that provisions, audits, and repairs
that structure on a connected Google Drive.

- **`spec/SPEC.md`** — the Drive Context Protocol (human-readable, versioned)
- **`spec/manifest.yaml`** — the same rules, machine-readable (consumed by the linter)
- **`spec/templates/`** — canonical templates a provisioned workspace receives

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 | Author the spec from the reference workspace | 🟢 v0.1.0 |
| M1 | Next.js app skeleton + Google OAuth wiring + read-only auditor | 🟢 |
| M2 | Scaffold flow — provision a fresh spec-compliant workspace | 🟢 |
| M3 | Adoption flow — propose-then-apply migration of existing folders | 🟢 |
| M3.5 | Context groups — collapsible-tree canvas, descendant members, downward inheritance (spec v0.4) | 🟢 |
| M3.6 | Agent-readiness: AGENTS.md rulebook (auto-discovery standard) + generated `_Index.md` RAG map (spec v0.5) | 🟢 |
| M3.7 | World model — first-class entities (people/systems/concepts), derived-first via extraction from overviews (spec v0.7) | 🟢 |
| M3.8 | World model — typed relationships (edges in entity frontmatter) + `_Model.json` projection + interactive graph view (spec v0.8) | 🟢 |
| M3.9 | Maintenance loop — on-demand change detection + sync, deterministic, with agent reflection scaffold (spec v0.9) | 🟢 |
| M3.10 | Governance visibility — per-workspace rule config (see + tune severities/conventions) in `_Workspace.yaml`, fed into audit + AGENTS.md (spec v0.10) | 🟢 |
| M3.11 | House rules — author rules in plain language (agents follow via AGENTS.md) + optional declarative checks (filename prefix, forbidden substring) the audit enforces (spec v0.11) | 🟢 |
| M3.12 | OKF interoperability (Phase 1) — entity frontmatter `type` alignment + Export OKF bundle (conformant concepts + index.md/log.md); DCP as a governed superset of Google's Open Knowledge Format v0.1 (spec v0.12) | 🟢 |
| M4 | Cloud Run deployment, incubeta.com-restricted OAuth | ⬜ |
| Later | GTM container audit module, contacts, shared team zones | ⬜ |

## Running it

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

Workspaces can be **local folders** (e.g. a Drive-for-Desktop synced folder) —
no credentials needed — or **Google Drive folders via API**. For the latter,
create an OAuth client (Web application) in Google Cloud Console with redirect
URI `http://localhost:3000/api/google/callback`, then put in `web/.env.local`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
HUB_OWNER_NAME=Your Name
HUB_OWNER_EMAIL=you@company.com
```

`HUB_OWNER_NAME`/`HUB_OWNER_EMAIL` are stamped into generated `_Workspace.yaml`
and `_PROTOCOL.md` files for local workspaces too.

### API (for agents and scripting)

- `POST /api/workspaces` `{name, kind: local|gdrive, root, account_email?}`
- `POST /api/workspaces/:id/audits` → findings + stats (read-only)
- `POST /api/workspaces/:id/proposals` `{kind: scaffold|adopt}` → plan (no writes)
- `POST /api/proposals/:pid/apply` `{selected?: number[]}` → applies ops
  (defaults to the plan's safe selection; risky ops must be opted into)
- `GET /api/workspaces/:id/tree?path=X&depth=4` → folder subtree under X
- `GET|PUT /api/workspaces/:id/context?path=X` → read/write the context groups
  declared at folder X (root when omitted). Members are descendant folder
  paths relative to X; subfolders inherit ancestors' groups. PUT writes one
  markdown file per group to `X/_Context/`; removed groups are archived,
  never deleted.

## Safety contract

The app only operates inside a designated root folder, never deletes (moves to
`Archive/` instead), proposes structural changes for human approval before
applying, and journals every action it takes.
