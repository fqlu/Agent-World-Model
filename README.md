# Incubeta Hub

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

## Safety contract

The app only operates inside a designated root folder, never deletes (moves to
`Archive/` instead), proposes structural changes for human approval before
applying, and journals every action it takes.
