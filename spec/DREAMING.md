# Drive Context Protocol — Dreaming

**Part of:** Drive Context Protocol v0.16 (SPEC.md §6.9–§6.10). **Status:** 🟡 beta.

Dreaming is the protocol's **out-of-band reflection loop**: an agent that runs on a schedule, reads
the whole workspace while nobody is working in it, and writes **proposals** — questions and small,
evidence-backed edits — for the owner to decide in the app's Dreaming inbox. It keeps the workspace
from drifting (hygiene) and acts as a daily triage helper (dates, outcomes, slipped plans).

## 1. What the app generates

The app (scaffold, adopt, migrate, and every config change) generates the dreaming agent's brief:

| Path | Generated from | Notes |
|---|---|---|
| `<proposals mount>/dreaming/INSTRUCTIONS.md` | `spec/templates/dreaming/INSTRUCTIONS.md` + the `dreaming:` block of the `AGENTS.md` header | The only text the dreaming agent follows as instructions. Never edited by hand or by agents. |

Its settings live in the `AGENTS.md` header (all optional; defaults shown):

```yaml
dreaming:
  agent_name: dreaming-agent          # how it signs journal lines and runs
  mode: dry-run                       # dry-run | live
  runtime: drive-mcp                  # drive-mcp | vm
  drive_path: My Drive/<workspace>    # where the agent finds the workspace
  timezone: UTC
  nightly: "02:30"
  weekly: "Sun 03:30"
  report_channel: the chat you were started from
  budget: about 400 files per run
  other_agents: []                    # [{name, note}] — agents that also write here
  notes: ""                           # owner notes rendered at the end of the brief
```

The app's **Dreaming → Setup** page edits these, re-generates the brief, and gives the owner the
kickoff message to start the agent with.

## 2. The agent's folder

`<proposals mount>/dreaming/` holds `INSTRUCTIONS.md` (app), `YYYY-MM-DD.proposals.json` and
`YYYY-MM-DD.md` (agent), `suppressions.json` (agent) and `YYYY-MM-DD.decisions.json` (the owner's
app). **Each file has exactly one writer**, so the agent and the app never overwrite each other.

## 3. Proposals file schema (`dcp-proposals/1`)

```json
{
  "schema": "dcp-proposals/1",
  "run": {
    "id": "2026-11-05T02:30+11:00",
    "agent": "grok-dreaming",
    "mode": "dry-run | live",
    "runtime": "vm | drive-mcp",
    "checks": ["staleness", "consistency", "graph", "review-queue", "lessons"],
    "files_read": 312,
    "maintain": "ran | skipped",
    "summary": "21 items (10 new, 11 carried). Nothing applied."
  },
  "items": [
    {
      "id": "D-20261104-B3",
      "first_seen": "2026-11-04",
      "carried_from": "Draft_ Workspace Consolidation 2026-11-04.md#B3",
      "lens": "triage | hygiene",
      "section": "status | consistency | graph | review-queue | lessons | generated | redundancy",
      "kind": "edit | question | move | create | info",
      "tier": "auto | approve | you",
      "priority": "now | soon | later",
      "scope": "Internal/Presales/Presales _ Intrepid CEP RFP",
      "title": "Intrepid CEP RFP: what was the outcome?",
      "why": "Status still reads 'Pre-read due today (Fri 16 Oct)'; MoEngage presented 2026-10-20; 14 pre-deadline tasks still open.",
      "evidence": [
        { "path": "Internal/Presales/Presales _ Intrepid CEP RFP/_Overview.md", "quote": "Pre-read due **today (Fri 16 Oct)**" }
      ],
      "confidence": "high | medium | low",
      "question": {
        "text": "What happened with the Intrepid bid?",
        "options": [
          { "id": "awaiting", "label": "Still waiting", "ops": [ /* set Status to 'Submitted; awaiting outcome', close pre-read tasks */ ] },
          { "id": "won-deliver", "label": "Won, I'm delivering", "ops": [], "follow_up": "Propose Clients/Intrepid Travel (Intrepid)/ scope" },
          { "id": "won-other", "label": "Won, someone else delivers", "ops": [ /* archive */ ] },
          { "id": "lost", "label": "Lost", "ops": [ /* archive */ ] }
        ],
        "free_text": true
      },
      "ops": []
    }
  ]
}
```

Rules:
- `lens` splits the inbox into the two jobs dreaming does. **triage** is project management: overdue
  dates, missing outcomes, slipped plans, commitments waiting on James. **hygiene** is protocol and
  drift: stale summaries, inconsistent facts, graph quality, naming, review-queue leftovers, lessons.
- `kind: question` items carry a `question`. Options that come with `ops` can be applied the moment
  James picks them. Options without ops, or a free-text answer, go back to the next dreaming run.
- `kind: edit | move | create` items carry `ops` and no question.
- `evidence` is required on every item. Each quote must be an exact, short excerpt (≤ 200 characters)
  from the cited file.
- `priority: now` items are the "Needs you first" list. Keep it to 3 or fewer.

### Op types

Every op that changes an existing file carries `base_md5` (the file's Drive `md5Checksum` when the
proposal was written). The app refuses to apply an op if the file has changed since.

| action | fields | notes |
|---|---|---|
| `replace` | `path`, `find`, `replace`, `base_md5` | `find` must match exactly once. This is the default for surgical edits. |
| `append_line` | `path`, `section`, `text`, `position: top \| bottom`, `base_md5` | For Recent activity (newest first) and journal lines. Trims to ≤ 10 where the protocol says so. |
| `frontmatter` | `path`, `set`, `base_md5` | Entity and context-group fields, e.g. changing a relation predicate or adding members |
| `move` | `path`, `to` | Archive moves only. Always `tier: you`. |
| `create` | `path`, `content` | Refused if the file already exists |
| ~~`delete`~~ | — | Not supported. Deletions are always a question for James. |


## 4. Decisions file schema (`dcp-decisions/1`)

```json
{
  "schema": "dcp-decisions/1",
  "proposals": "2026-11-05.proposals.json",
  "decisions": [
    {
      "id": "D-20261104-B3",
      "decision": "accept | edit | reject | answer | defer",
      "option": "awaiting",
      "answer": "Submitted 20 Oct, expecting a decision mid-Nov",
      "edited_ops": [],
      "reason": "",
      "defer_until": "2026-11-12",
      "by": "human:james.lu@vivanti.com",
      "at": "2026-11-05T19:12:00+11:00",
      "result": { "status": "applied | stale | failed | pending-agent", "detail": "", "applied_at": "" }
    }
  ]
}
```

- **accept**: the app applies `ops` straight away, journals it, and sets `result`.
- **edit**: James changes the proposed text first, and the app applies `edited_ops`.
- **reject**: requires a one-line `reason`. The next run adds it to `suppressions.json`, and uses the
  reason as evidence in the lessons check.
- **answer**: picks an `option` and/or writes `answer`. If the option has ops, the app applies them and
  the result is `applied`. Otherwise the result is `pending-agent` and the next run acts on it.
- **defer**: hides the item until `defer_until`. The agent carries it forward silently until then.
- If a file changed since the proposal, the result is `stale`. The next run re-reads the file and
  re-proposes the item if it's still needed.

## 5. Modes

- **dry-run** (default): the agent writes proposals, renderings, suppressions and its journal line —
  nothing else. It lists what it *would* apply.
- **live**: the agent also applies items the owner accepted outside the app (Markdown fallback) and
  answered follow-ups, with the same md5 stale-write check the app uses.
Switching mode is a header change in the app; the brief re-generates.
