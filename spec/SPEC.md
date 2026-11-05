# Drive Context Protocol — Specification

**Version:** 0.16.0
**Status:** 🟠 Draft — under review by James Lu
**Reference implementation:** a personal knowledge-work Drive (`incubeta` profile)

---

## 1. Purpose

This spec defines a standard structure for a knowledge Drive that both humans and
AI agents can navigate, edit, and extend without ambiguity. It exists so that:

- **Agents retrieve by address, not by search.** Any agent that knows the protocol
  knows exactly where context lives for a given client, project, or day — no
  embeddings, no retrieval guesswork, full transparency about what was read.
- **People are interoperable.** Two people running this structure on separate
  Drives can hand work (and agents) to each other; the rituals are identical.
- **Memory is durable and inspectable.** What agents and humans did, decided, and
  still owe is written into the structure itself, in plain markdown.

A Drive that follows this spec is called a **workspace**.

### Design principles

1. **Files are the database.** Markdown and folders are canonical. Any app or
   index built on top must be rebuildable from the files alone.
2. **Humans and agents share one substrate.** No agent-only side-channel state.
   Anything an agent knows or did is readable (and editable) by a human.
3. **Non-destructive by contract.** Nothing in a workspace is ever deleted by an
   agent or tool — superseded material moves to `Archive/`.
4. **Convention over enforcement, enforcement over chaos.** The spec defines a
   small set of MUSTs (machine-lintable) and a larger set of SHOULDs. Tools lint
   and propose; humans approve.
5. **Core vs profile.** Rules in this spec are universal. Organisation-specific
   rituals (e.g. Incubeta's `Draft_` lifecycle) live in a named **profile**
   (§10) layered on top.
6. **Sources, not copies.** The protocol stores only canonical sources in the
   workspace. Anything derivable — maps, graphs, digests, project lists — is
   computed by tooling when asked. A derived file in the Drive is a second copy
   that silently goes stale.

Keywords MUST / SHOULD / MAY follow RFC 2119 usage. Every MUST and SHOULD maps
to a lint rule in §9 and in `manifest.yaml`.

---

## 2. Workspace topology (declarative)

A workspace's folder layout is **data, not spec**. The spec fixes only the
primitives — scopes (§3), collections (§4), context files (§6), and the
capabilities **journal**, **templates**, **archive** (required) and
**entities**, **proposals** (optional) — and each workspace declares where they
are mounted in the **YAML header of `AGENTS.md`**, the one protocol file at the
workspace root:

```markdown
---
protocol: dcp/0.16
profile: incubeta
owner: { name: James Lu, email: james.lu@example.com }
about: Workspace of James Lu — client delivery, presales and internal tooling.
mounts:
  areas: [Clients, Internal]   # scope-bearing folders (≥1, any names)
  journal: _Journal            # agent activity log (§4.2, §7.3)
  templates: _Templates        # the 4 canonical templates
  archive: Archive             # superseded content (§8)
  entities: _Entities          # OPTIONAL: the cast (§6.6)
  proposals: _Proposals        # OPTIONAL: agent proposals + owner decisions (§6.10)
ignore:                        # OPTIONAL: paths outside the protocol
  - Internal/Solutions/some-code-repo
rules: { overrides: {}, conventions: {} }   # §9.1
house_rules: []                              # §9.2
---
# AGENTS.md — Workspace Protocol
…rulebook rendered from the header, the spec and the profile…
```

- The workspace root MUST contain `AGENTS.md` with a header that parses and
  carries `protocol`, `owner` and `mounts`. `[ST-001]`
- Every declared mount MUST exist. `[ST-002]`
- Journal, templates and archive MUST be mounted, and at least one **area**
  declared. Areas hold scopes; their names are free. `[ST-003]`
- Protocol mounts SHOULD use a `_` prefix (`_Journal`, `_Templates`,
  `_Entities`, `_Proposals`), so a workspace's protocol is exactly `AGENTS.md`
  plus its `_` folders — it can be copied, upgraded or removed without touching
  content. The archive holds superseded *content*, so it is not prefixed.
- `ignore:` lists workspace-relative paths that are **outside the protocol**
  (a code repository, a tool's scratch output). An ignored path and everything
  below it is skipped by the audit and by every tool that reads the tree.
  `AGENTS.md` cannot be ignored, nor can a declared mount.
- Root items not declared are flagged for triage; v0.15 leftovers
  (`_Workspace.yaml`, `_Overview.md`, `_Index.md`, `_Model.json`, `_Digest.md`,
  `_Context/`) are flagged with a migration hint (§13). Profiles MAY whitelist
  extra root files (e.g. `CLAUDE.md`). `[ST-004]`
- **The header is canonical; the body is rendered.** Tooling edits the header
  and re-renders the body from it. There is no second config file to keep in
  sync.

**Profiles ship starter topologies, not laws.** A profile might default to
`Clients/ + Internal/ + _Journal/ + _Templates/ + _Entities/ + _Proposals/ +
Archive/`; a teammate might mount `Projects/ + Knowledge/` instead; both lint
clean, and both speak the same protocol.

---

## 3. Scopes — content by default, promotion by choice

The protocol deliberately does NOT demand context files everywhere. Folders
are **content by default**; a folder becomes a **scope** only when someone
gives it an `_Overview.md`. Governance lives at a few mandatory anchors plus
whatever depth *you* choose to maintain — ceremony never exceeds value.

| Kind | How recognised | Obligations |
|---|---|---|
| **Entity** | depth-1 folder in an area (`Clients/Hanesbrands (Hanes)/`) | MUST have `_Overview.md` `[SC-001]`; no pipes in name `[NM-003]` |
| **Promoted scope** | any deeper folder containing `_Overview.md` | pipe-name mirrors ancestry `[NM-001]`; ISO dates `[NM-002]` |
| **Collection** | reserved suffix (`… \| WIP Notes`) | collection rules (§4) |
| **Content folder** | everything else | **none** — documentation bundles, asset dumps, working files need no context machinery |

- Entities are the mandatory context anchor: the level agents always need.
  For a typical workspace this is a handful of files, not hundreds.
- **Promotion is the act of adding an `_Overview.md`** to a deeper folder —
  do it when a folder is a living workstream whose context you'll maintain.
  The linter validates what exists; it never demands new overviews below
  entity level.
- Content folders inherit their context from the nearest scope above them,
  including that scope's effective facets (§3.1).
- Scopes MAY contain working files directly, collections, child scopes, and
  content folders.

### 3.1 Decomposition — workstreams, projects, and facets

Content-by-default says *which* folders are scopes; this says how to **divide a
scope into child scopes consistently**, so one client is organised like every
other and an agent always knows where to file. The rule is the taxonomy
**principle of division**: at any level, children are split by *one* axis.

Every scope carries a **`scope_type`** in its `_Overview.md` frontmatter:

- **`workstream`** — an *ongoing* area of work with no end date: a product, a
  function, a brand, a retainer (SR360, Offline CAPI, SEO). The default.
- **`project`** — a *time-bound* effort with a goal and a close (Headless CMS
  Migration, a one-off audit). Nests under the workstream it serves, or a
  client-level grouping if cross-cutting.

That single ongoing-vs-time-bound split is the structural hierarchy. Every
other way you'd want to see the work — **platform** (GA4, BigQuery),
**discipline** (analytics, SEO), **brand**, **strategic pillar** — is a
**facet, not a folder**.

A facet is an **entity** (§6.6) with `attributes.facet: pillar | platform |
discipline | brand`. A scope joins a facet by listing its slug in its
`_Overview.md` frontmatter:

```yaml
---
scope_type: project
facets: [cloud-data-platform, databricks]
---
```

- **Facets inherit downward.** A scope's effective facets are its own plus
  those of every ancestor scope. Declare a facet at the highest scope where it
  is true.
- "Everything in the Cloud Data Platform pillar" = every scope whose effective
  facets include `cloud-data-platform`, plus each one's descendants.
- Facet slugs MUST resolve to an entity. `[RL-002]`

Why: a folder tree nests one way, so it can't show "all analytics work" or
"the SEO pillar across clients" — facets and the world-model graph can, from
many angles at once. **Folders give consistency; facets give the big picture.**

The agent's filing decision (also in `AGENTS.md`):

1. Time-bound, with a goal and an end? → **project**.
2. Ongoing thing we're retained for? → **workstream**.
3. A platform, discipline, brand, or strategic theme? → **a facet**: an
   entity, listed in the scope's `facets:`. Never a folder.
4. Just a document or deliverable? → a **file** inside the relevant scope.

`scope_type` SHOULD be declared on the workstream/project scopes directly under
an entity. `[DC-001]` (warn) Deeper sub-scopes inherit their parent's nature
unless they declare their own.

---

## 4. Collections

Collections are folders of homogeneous, dated records.

### 4.1 WIP Notes

- Name: `<scope pipe-name> | WIP Notes`.
- Contents: meeting / working-session notes named `YYYY-MM-DD.md` or
  `YYYY-MM-DD - Title.md` (v0.14 — the date prefix is mandatory and keeps
  sorting + journal linking; the optional title adds scanability), following
  the WIP Note template. Same-day notes on the same topic merge into one file;
  distinct same-day meetings MAY use distinct titled files. `[CL-001]` `[CL-002]`
- Placement rule: notes scoped to one unit/sub-project live in that scope's
  WIP Notes; cross-unit entity meetings live in the entity-level WIP Notes.

### 4.2 Journal

- Path: `<journal mount>/YYYY/YYYY-MM/YYYY-MM-DD.md`. `[JR-001]`
- One file per day with activity. The journal is the **agent activity log**
  (§7.3) and nothing else: one line per change, linking to where the
  substance lives — `- HH:MM · <agent> · <scope> — <what> → [link]`.
- It is not a daily index (each scope's Recent activity covers that) and not
  a request channel: questions and proposals for the owner go to the
  proposals capability (§6.10).
- Daily files limit how many agents write to one file at once. Agents append
  and never rewrite existing lines.

---

## 5. Naming

### 5.1 The pipe convention

Promoted scopes below entity level and collections MUST be named as
pipe-separated paths that mirror their ancestry (content folders MAY follow
the convention — it helps search — but are not linted): `[NM-001]`

```
<Entity short name> | <Unit>
<Entity short name> | <Unit short name> | <Sub-project>
```

- **Drive-safe separator.** Google Drive for desktop rewrites `|` in folder
  names, so ` _ ` (space, underscore, space) is accepted as the same
  separator: `Hanes _ Bonds` is equivalent to `Hanes | Bonds`. Tools suggesting
  a rename keep whichever spelling the folder already uses.
- **Short names** are declared in parentheses at the end of a folder's own
  segment — `Hanesbrands (Hanes)`, `TMCA | NVI (New Vehicle Inventory)` — and
  descendants use the short form: `Hanes | Bonds`, `TMCA | NVI | Floodlight`.
  If no parenthesised short name exists, the full segment is the short name.
- **Declared aliases (v0.14).** A scope MAY declare additional short forms in
  its `_Overview.md` frontmatter — `aliases: [Crown]` — and descendants may
  use any declared alias as the ancestry segment: `Crown | Measurement
  Governance` under `Crown Resorts/`. Aliases fix the name-drift problem
  without folder renames: agents naturally shorten client names, and the
  declaration makes the short form official rather than an error. Prefer a
  parenthetical short name for new folders; use `aliases:` to legitimise
  forms that already exist in the wild.
- Rationale: every folder is self-describing in Drive search results and in
  agent tool output, at the cost of renames cascading. Tools MUST treat a
  parent rename as a propagating operation (§8).

### 5.2 Special files

- Scope context files are prefixed `_` so they sort first: `_Overview.md`,
  `_Tasks.md`. Protocol folders are prefixed `_` (`_Journal/`, `_Templates/`,
  `_Entities/`, `_Proposals/`). `AGENTS.md` is unprefixed deliberately — it
  follows the cross-vendor agent auto-discovery naming standard.
- Dates in the names of promoted scopes MUST be ISO `YYYY-MM-DD` (or
  `YYYY-MM` for months); content folders are not linted. `[NM-002]`
- Entity folder names MUST NOT contain pipes. `[NM-003]`

---

## 6. Context files

### 6.1 `_Overview.md` (entities and promoted scopes)

The workhorse — and deliberately **free-form**: its presence is what makes a
folder a scope; its content is not linted. The template recommends a proven
skeleton, but a two-line overview that a human actually maintains beats a
five-section stub nobody fills in.

Recommended sections (the template ships these; tooling like the index
generator reads "What it is" when present):

| Section | Content |
|---|---|
| `## What it is` | 1–3 sentences: what this scope is, the org's remit, who owns it |
| `## Active workstreams` | bullet list: **name** — one-line status → folder/file link |
| `## Key people` | client side / org side, with roles and emails where known |
| `## Recent activity` | newest-first dated one-liners → links; keep ~10 |
| `## Reference` | links: key docs, dashboards, production folders, related scopes |

Overview frontmatter MAY carry `scope_type` (§3.1), `aliases` (§5.1),
`facets` (§3.1) and trust fields (§12).

There is no root `_Overview.md`. The owner and a one-line `about` live in the
`AGENTS.md` header; the cross-workspace project list ("what's active?") is a
tooling view built from scope overviews, not a hand-maintained copy of them.

### 6.2 `_Tasks.md` (optional per scope)

Open commitments that outlive a single meeting. Format:

```markdown
# <Scope> — Tasks

## Open
- [ ] YYYY-MM-DD · @owner — task description → [source](link)

## Done (recent)
- [x] YYYY-MM-DD · @owner — task description → [outcome](link)
```

- Agents MUST read `_Tasks.md` (if present) before starting work in a scope
  and MUST move completed items to `## Done` rather than deleting them.
  `[TK-001]`
- Action items in WIP notes are the *origin* of tasks; promoting one to
  `_Tasks.md` is a judgement call — promote what must survive the week.

### 6.3 `AGENTS.md` (workspace root, required)

The workspace's single protocol file: a **YAML header** (the workspace config,
§2) and a **body** (the agent rulebook). Tooling renders the body from the
header, the spec and the active profile: the map of mounts, the operating rules
(§7–8), the enforced rules (§9.1), the house rules (§9.2), the journal line
format, and how to raise a proposal. Any agent — regardless of vendor — can be
pointed at the workspace root and behave correctly.

- Keep it short. It is loaded into every agent session, so every line costs
  tokens on every run; it links to scope files rather than inlining them.
- The filename follows the cross-vendor `AGENTS.md` convention that agentic
  tools auto-discover. Vendor files (`CLAUDE.md`, `GEMINI.md`…) SHOULD reduce
  to a pointer at `AGENTS.md` plus vendor-specific notes.

---

### 6.4 (removed in v0.16 — context groups)

Context groups are replaced by facets (§3.1). Migration (§13): each group
becomes an entity with `attributes.facet`, and each member scope lists its
slug in `facets:`.

### 6.5 Workspace map (tooling view)

Tooling serves a map of the workspace — every scope with its "What it is",
every entity and facet — on demand: in the app, through its API, and in
exported bundles (§12). It is **not stored in the Drive** (principle 6).
Agents with file access orient from `AGENTS.md`, then list the areas and read
scope overviews. Search-only assistants use exported bundles, whose `index.md`
serves the `llms.txt` role.

### 6.6 Entities (optional capability) — the "cast" of the world model

Scopes answer "where does work live"; **entities** answer "who and what are
the things the work is about." An entity is a first-class, addressable node
for a person, organization, system, or concept that recurs across scopes — a colleague, a
GTM container, a cross-cutting topic. Entities turn facts that were buried in
prose ("Sally Wilson — decision-maker", "GTM-WMW3QT") into nodes an agent can
resolve consistently everywhere they appear.

- Entities live in the **entities mount** (conventionally `_Entities/`), one
  markdown file per entity, slug = filename:

```markdown
# _Entities/sally-wilson.md
---
name: Sally Wilson
kind: person                       # person | organization | system | concept
aliases: [Sally]
source: derived                    # derived (extracted) | asserted (human-confirmed)
confirmed: 2026-06-10              # last time a human confirmed this is current
attributes:
  role: Senior decision-maker
  org: Hanes
  email: sally.wilson@hanes.com
---

Free-text notes. Both humans and agents read this to understand the entity.
```

- An entity file MUST have `name` and a `kind` of `person`, `organization`,
  `system`, or `concept`. `[EN-001]` An **organization** is a company, client,
  partner, vendor or agency; a **concept** is an idea, programme, theme or
  pillar.
- An entity used as a facet carries `attributes.facet: pillar | platform |
  discipline | brand`.
- The slug (`name` field) SHOULD match the filename. `[EN-002]`
- **Derived-first.** Tooling seeds entities by extracting them from existing
  overviews (Key people, infrastructure lists); a human confirms and enriches.
  `source` and `confirmed` record provenance so the model can show its own
  freshness rather than hide staleness. Extraction proposes; it never
  overwrites human-asserted entities.
- Entities are cross-cutting and so live at the workspace root, not per-scope.
- The entities capability is OPTIONAL; when its mount is declared it must
  exist (`[ST-002]`) and its files must be valid (`[EN-001]`).
- Entities are the **cast** of the world model. Typed relationships (§6.7) are
  the edges between them.

### 6.7 Relationships (the "edges" of the world model)

Relationships are stored as outgoing edges in the subject entity's
frontmatter. **There are two predicates**; what the relationship *is* goes in a
short description, `as`:

```yaml
# _Entities/james-lu.md
relations:
  - predicate: member-of            # member-of | related-to
    target: "Clients/Hanesbrands (Hanes)/Hanes | Offline CAPI"
    as: lead
    since: 2024-03-01               # optional, ISO date
  - predicate: member-of
    target: incubeta
    as: Analytics consultant
    until: 2026-09-30               # optional; in the past = a former relationship
  - predicate: related-to
    target: amperity
    as: uses as CDP
    note: Live ~12 months.          # optional longer note
```

- **`member-of`** — the subject is *part of* the target: a person in an
  organization, team or project scope; an organization in a parent
  organization; an entity in a facet.
- **`related-to`** — any other connection. `as` is **required**: a few words
  from the subject's point of view ("uses as CDP", "client", "partner on the
  PoV", "owner").
- **`as`** is shown on graph edges and read by agents. It is free text, so
  there is no vocabulary to maintain and no wrong verb to pick. `note` holds
  anything longer.
- **Time**: `since` / `until` are optional ISO dates; an edge whose `until` has
  passed is a *former* relationship.
- **Record each edge once**, on the entity the sentence is naturally about.
  Tooling shows inverses; don't add mirror edges.
- `predicate` MUST be `member-of` or `related-to`. `[RL-001]` Targets (an entity
  slug, else a scope path) SHOULD resolve; `related-to` edges SHOULD carry
  `as`; dates SHOULD be ISO. `[RL-002]`

Why so few: in the reference workspace 37 of 89 edges were `related-to` even
with seven specific verbs available, and several facts were recorded twice in
opposite directions. Two structural predicates plus a description capture the
same meaning with nothing to choose wrongly; the queries that matter ("who is
on this project?", "what is in this pillar?", "who used to work here?") are
membership queries.

### 6.8 World-model view (tooling)

The queryable graph — entities, scopes, relationships, facet memberships — is
computed by tooling and served through the app and its API. It is **not stored
in the Drive**; the entity files and scope overviews remain the only source.

### 6.9 Freshness & the maintenance loop (app-maintained)

The files are canonical, but they change — humans and agents edit them between
app sessions. A world model that doesn't notice change goes stale silently.
The maintenance loop keeps state current:

1. **Detect.** Tooling keeps a content manifest (path → hash) of the workspace
   in its own state (NOT in the Drive — it is rebuildable app bookkeeping).
   Comparing a fresh walk against the stored manifest yields the **drift**
   since last sync: files added, modified, removed.
2. **Re-derive.** Tooling recomputes its views (map, model, digest) from the
   files. Nothing is written to the Drive.
3. **Reflect (agent, out of band).** Interpreting drift — staleness,
   contradictions, graph quality, overdue decisions, lessons — is done by a
   reflection agent ("dreaming") that writes **proposals** (§6.10). Tooling
   never invents semantic facts; the owner decides in the proposals inbox.

This separation — deterministic detection + agent-driven reflection — keeps
the core dependency-free and every model change human-reviewable.

**The review-and-verify loop (v0.14).** Writes are never gated: any agent, in
any tool, MAY write files directly at any time — the protocol's contract is
reconciliation-after-write (the git model), not transactions. Tooling keeps a
second manifest, the **last-reviewed snapshot** (hashes for detection, full
text for before/after diffs), separate from the sync snapshot. When the owner
reviews, the diff since their last review is shown with each file **linted at
review time**. Two verdicts per file:

- **Verify** — marks it reviewed; on entity files and scope overviews this
  appends a `verified: human:<owner>` event (§12), turning the owner's review
  into durable trust metadata. The tool's own bookkeeping (its journal
  attribution line) folds into the baseline so it never re-queues itself.
- **Flag** — records a problem (path + note) and emits it as a fix-up task
  scaffold for the next agent session, through the normal conventions.

Unreviewed agent output is not an error state: it simply sits in a lower
trust tier (unverified) until reviewed — visible as such in the model and in
every exported bundle. Drift never corrupts; it queues.

### 6.10 Proposals (optional capability)

The one channel through which agents ask the owner questions and propose
changes, and through which the owner's decisions flow back.

- Layout: `<proposals mount>/<agent>/` holding `YYYY-MM-DD.proposals.json`
  (canonical), `YYYY-MM-DD.md` (readable rendering), `YYYY-MM-DD.decisions.json`
  and `suppressions.json`.
- **Single writer per file.** The proposing agent writes the proposals,
  rendering and suppressions files; the owner's tooling writes the decisions
  file. Nobody else writes either.
- Schemas: `dcp-proposals/1` and `dcp-decisions/1`. Every item carries a stable
  id, `lens` (`triage` | `hygiene`), `tier` (`auto` | `approve` | `you`),
  evidence (path + exact quote), and either a `question` with options or small
  `ops` (`replace`, `append_line`, `frontmatter`, `move`, `create`; never
  `delete`), each edit carrying the target file's `base_md5`.
- **Accepted edits apply immediately** through tooling, and only if the file
  still matches `base_md5`. Answers and rejections go back to the agent on its
  next run; a rejection is suppressed so it isn't proposed again, and a lesson
  drawn from it is only ever *proposed*.
- Structural changes (moves, renames, new scopes) are always `tier: you`
  (§8 rule 5).
- **Dreaming is part of the protocol.** Tooling generates the dreaming agent's
  brief at `<proposals mount>/dreaming/INSTRUCTIONS.md` from the spec template
  and the optional `dreaming:` block of the `AGENTS.md` header (agent name,
  mode, runtime, schedule, report channel, owner notes…). It is the only text
  the dreaming agent follows as instructions; nobody edits it by hand. Full
  definition: `DREAMING.md`.

## 7. Memory

The workspace gives agents three memory surfaces, from coarse to fine:

1. **`_Overview.md` / Recent activity** — curated highlights. The first thing
   read when entering a scope; capped so it stays signal.
2. **Journal** — the chronological agent activity log. "What changed, by
   whom, around date X?"
3. **WIP Notes + `_Tasks.md`** — full substance and open loops per scope.
4. **Proposals** — open questions and pending changes for the owner, with the
   decisions taken (§6.10).

### 7.3 Agent activity attribution

Any agent session that creates, edits, moves, or archives files MUST append to
that day's journal entry, under a `## Agent activity` heading: `[JR-003]`

```markdown
## Agent activity
- HH:MM · <agent/tool name> · <scope> — what was done → [link]
```

This is the transparency contract: a human can always reconstruct what agents
did to the workspace and when, with no tool-specific log access.

---

## 8. Operating rules (humans and agents)

1. **Read before write.** Entering a scope: read its `_Overview.md`, then
   `_Tasks.md` if present, then recent WIP notes as needed.
2. **Merge, don't overwrite.** Same-date WIP notes and journal files are merged
   into. Overviews are edited surgically, never regenerated wholesale.
3. **Close the loop after changes.** File changed → update the scope's
   `Recent activity` → add a journal line (agents: under `## Agent activity`).
4. **Archive, never delete.** Superseded material moves to the archive mount,
   preserving its path relative to the workspace root
   (`Archive/Clients/Hanes…/file.md`). The move is journaled. `[AR-001]`
5. **Propose, then apply.** Structural operations (renames, moves, new scopes,
   adoption migrations) are proposed as a reviewable plan and executed only on
   human approval. Content edits within the rituals above don't need proposals.
6. **Renames cascade.** Renaming a scope with a pipe-name updates all
   descendant folder names and intra-workspace links; tools must do this
   atomically or not at all.
7. **Ask when ambiguous.** Wrong-but-confident filing is worse than a question.
8. **Ask through proposals.** Questions for the owner and changes that need
   approval go to the proposals capability (§6.10), not into journal sections
   or chat. Never write another agent's or the owner's file in the proposals
   mount.

---

## 9. Lint rules

Severities: **error** (violates a MUST), **warn** (violates a SHOULD),
**info** (worth a look). Machine-readable form lives in `manifest.yaml`.

| ID | Sev | Rule |
|---|---|---|
| ST-001 | error | Root contains `AGENTS.md` with a valid config header (`protocol`, `owner`, `mounts`) |
| ST-002 | error | Every mount declared in the `AGENTS.md` header exists |
| ST-003 | error | Journal, templates, and archive capabilities are mounted; ≥1 area declared |
| ST-004 | warn | No undeclared loose files / top-level folders at root (v0.15 leftovers get a migration hint) |
| SC-001 | error | Every **entity** (depth-1 folder in an area) has `_Overview.md` |
| CL-001 | error | WIP note files are named `YYYY-MM-DD.md` |
| CL-002 | warn | WIP note follows template sections (Discussion/Decisions/Actions) |
| NM-001 | error | **Promoted scopes** and collections: pipe-name mirrors ancestry |
| NM-002 | warn | **Promoted scopes**: dates in names are ISO format |
| NM-003 | error | Entity folder names contain no pipes |
| TK-001 | warn | `_Tasks.md` items follow the open/done format |
| JR-001 | error | Journal files at `<journal mount>/YYYY/YYYY-MM/YYYY-MM-DD.md` |
| JR-003 | warn | File-changing agent sessions appear in `## Agent activity` |
| AR-001 | error | `Archive/` mirrors original paths; nothing deleted |
| EN-001 | error | Entity files have valid `name` and `kind` (person/organization/system/concept) |
| EN-002 | warn | Entity slug (name) matches filename |
| RL-001 | error | Relationship `predicate` is `member-of` or `related-to` |
| RL-002 | warn | Relationship targets and scope `facets` resolve; `related-to` has `as`; `since`/`until` are ISO dates |
| DC-001 | warn | Workstream/project scopes (depth-2) declare a `scope_type` (§3.1) |
| HR-n | (per rule) | Workspace house-rule check failed (§9.2; default warn) |

Removed in v0.16: ST-005 (single config file), CX-001/CX-002 (context groups
→ facets), JR-002 (the journal is a log). Removed in v0.6 (content-by-default pivot): SC-002 (per-type subfolders),
SC-003 (asset registration), SC-004 (unclassifiable folders), OV-001
(required overview sections), OV-002 (recent-activity cap). Content folders
are not lint subjects; overview content is free-form.

### 9.1 Per-workspace rule configuration

The table above is the **default** ruleset (from the core spec + active
profile). A workspace MAY tune it for its own needs by declaring a `rules:`
block in the `AGENTS.md` header:

```yaml
rules:
  overrides:                 # by rule id — change severity or disable
    NM-002: off              # this workspace doesn't enforce ISO dates
    JR-002: warn             # promote journal-index hygiene from info to warn
  conventions:               # tune the parameterised checks
    wip_required_sections: [Discussion, Decisions, Actions]
```

- An override sets a rule's severity to `error`/`warn`/`info`, or `off` to
  disable it for this workspace. Unlisted rules keep their default severity.
- `conventions` tune the data-driven checks (the WIP-note sections CL-002
  looks for). Relationship predicates are fixed by the spec (§6.7).
- The audit reads this block, so tuning takes effect immediately. The
  generated `AGENTS.md` includes an **Enforced rules** section rendered from
  the effective config, so agents and the linter always agree.
- Rules are configuration, not invention: a workspace can relax or re-weight
  the protocol's checks, but the rule *definitions* live in the spec — keeping
  workspaces interoperable.

### 9.2 House rules (workspace-authored, natural language)

Beyond the built-in rules, a workspace authors its own in plain language under
`house_rules:` in the `AGENTS.md` header:

```yaml
house_rules:
  - text: "Files use [DRAFT] until finalized, then [INT] for internal,
           [EXT] for files shared externally."
    severity: warn
    check:                       # optional — the mechanically-verifiable shadow
      type: filename_prefix
      applies_to: Clients        # path scope ('' = whole workspace)
      allowed: ["[DRAFT]", "[INT]", "[EXT]"]
  - text: "Don't leave 'final_final' or 'copy' in names."
    check:
      type: forbidden_substring
      values: ["final_final", "copy"]
```

Two enforcement tiers, by design:

- **Agent-followed (always).** Every rule's `text` is rendered into `AGENTS.md`,
  so any agent operating in the workspace reads and follows it — including
  judgment rules ("until I'm happy with it") that no deterministic check could
  evaluate. This is the primary mechanism.
- **Audit-verified (optional).** A rule MAY carry a declarative `check` that the
  deterministic audit runs, reporting violations as `HR-1`, `HR-2`… at the
  rule's `severity` (default warn). `[HR-001]` v0.11 checks: `filename_prefix`
  (files under `applies_to` must start with an allowed prefix) and
  `forbidden_substring` (names must not contain given substrings). Protocol
  files (names starting with `_`, dotfiles, `AGENTS.md`) are exempt; scope
  `applies_to` at a deliverables folder to avoid flagging notes.

A rule with no `check` is agent-followed only — not mechanically audited.

---

## 10. Profiles

A profile layers org-specific ritual onto the core: lint allowances, starter
topology, and **template overrides** (falling back to the organisation-neutral
base templates in `templates/`). Profiles are **not part of this spec**: every
profile is custom, defined by the implementation outside the spec (the
reference app keeps them in `profiles/<name>/profile.yaml` + `templates/` and
manages them from its Profiles page). When a workspace names no profile, or one
that doesn't exist, the manifest's `baseline` applies — generic topology
(`Projects/` + capabilities), no org rituals, no client vocabulary. Starter
topologies use `_Journal/`, `_Templates/`, `_Entities/`, `_Proposals/` and
`Archive/`; a profile's `templates/` overrides at most the four workspace
templates (overview, tasks, WIP note, entity) plus the `AGENTS.md` body.

The reference implementation ships two example profiles: **`core`**, which
mirrors the baseline, and **`incubeta`**, which adds:

- **Draft lifecycle:** working files are prefixed `Draft_`; promotion to the
  production Drive strips the prefix and adds `[INT]`/`[EXT]`. Draft files
  never leave the workspace; sharing happens only from production copies.
- **Status flags:** 🟢 Production/Active · 🟡 Beta · 🟠 Draft/Pending · 🔴 Deprecated.
- **Production mapping:** client entity overviews record their production
  Drive folder ID under `## Reference`.
- **Root allowance:** `CLAUDE.md` permitted at workspace root.
- **Internal taxonomy:** `Internal/Solutions/` follows the same scope rules as
  clients (`Solutions | <Category> | <Platform>`), holding cross-client IP with
  deployments cross-linked both ways.

---

## 12. OKF interoperability (bundles & trust)

DCP positions itself as a **governed superset of Google's Open Knowledge
Format (OKF v0.2)**. A workspace exports to conformant OKF bundles so any
OKF consumer can read them; the governance layer (audit, rules, repair,
sync) is what OKF deliberately omits. Full mapping in `OKF-COMPAT.md`.

**The Drive is the workshop; the bundle is the product.** The workspace root
is NOT itself claimed as an OKF bundle — deliverables and draft outputs are
never concepts (they are `resource` targets that concepts point to). Only
generated bundles claim `okf_version`.

- **Frontmatter alignment.** Entity files carry an OKF `type` field (mirroring
  their `kind`) so each is a valid OKF concept on its own. Our richer fields
  (`kind`, `source`, `confirmed`, `relations`) remain — OKF requires consumers
  to preserve unknown fields.
- **Trust signals (v0.14, from OKF v0.2).** Entity files and scope overviews
  MAY carry `generated: {by, at}` (who/when produced it — actor convention:
  `human:<id>` | `<producer>/<version>` | `process:<id>`), `verified:` (the
  file's CURRENT attestations — `{by, at, note?}`, at most one entry per
  actor; re-verifying refreshes that actor's `at`. It is not a change log:
  edit history lives in the journal and the review diff trail), `sources:`
  (`{id?, resource, title?}` provenance refs), `status:
  draft|stable|deprecated` (default stable), and `stale_after: YYYY-MM-DD`. Trust tier is derived: any
  `human:` verification → *human-reviewed*; any verification →
  *machine-confirmed*; else *unverified*. **The save ritual is the trust
  event**: tooling stamps `generated` on new entity files and appends a
  `verified: human:<owner>` event when the owner confirms a derived entity
  (derived → asserted) — verification is never fabricated. Hygiene:
  `[TR-001]` warns when `stale_after` is breached (unless deprecated);
  `[TR-002]` warns on malformed trust fields.
- **Attested Computations (v0.15, from OKF v0.2).** Important numbers come
  from queries; an attested computation makes the query itself a governed
  concept — "the official, tamper-proof recipe for a number." A markdown
  content file (living in the owning scope) with frontmatter
  `type: Attested Computation` plus:
  - `runtime:` (required — e.g. `BigQuery (GoogleSQL)`), `schedule:` and
    `executor:` (optional operational facts);
  - `parameters:` — the deliberately-fillable blanks (`{name, description,
    example?}`). An agent MAY set parameters; it MUST NOT alter anything else;
  - the **sanctioned computation** as the file's first ```sql fenced block —
    the single source of truth for the logic;
  - `receipts:` — evidence of runs, appended over time (`{at, by, params?,
    result_summary?, attested: pass|fail}`);
  - normal trust fields (`generated`, `verified`, `sources`, `status`).
  The **attester** is a deterministic, no-LLM script (`npm run attest`) that
  canonicalises the sanctioned SQL and the SQL-that-actually-ran (strip
  comments, collapse whitespace) and compares them; parameters are substituted
  before comparison. Verdicts MUST be surfaced, never silently dropped — a
  FAIL means someone (human or agent) changed the logic, which is either an
  incident or a proposal to re-verify the definition. Attested computations
  export to bundles as concepts like any content file. (Lint family `AC-*`
  planned for v0.15.1.)
- **Bundle export.** Tooling emits conformant OKF v0.2 bundles — a directory
  of concept documents, each with a required `type`, plus reserved `index.md`
  and `log.md`. A workspace produces MANY named bundles: whole-workspace, one
  client's subtree (entities, groups, and journal log sliced to match), or
  one facet's member scopes. Entities → concepts typed by kind; scopes →
  `Workstream`/`Project`/`Scope` concepts from their overviews; context
  facets → concepts of their entity kind, with member scopes linked; house rules → a `Reference` concept so consuming
  agents inherit them. Trust fields export as-is; `timestamp` is emitted only
  as a v0.1 fallback when no `generated` stamp exists. Typed relationships
  export as bundle-relative links (OKF-valid) **and** a `dcp_relations` extra
  field (lossless round-trip for DCP-aware consumers). Bundles are generated
  artifacts, regenerated on demand — never canonical.

## 11. Out of scope for v0.1 (deliberate)

- **Shared zones** — multiple humans co-owning one structure (Shared Drives).
  The multi-user model for now is *same protocol, separate Drives*.
- **Modules** — domain plug-ins (first planned: GTM container audits) that
  read/write inside the structure. Modules must follow §8 like any agent.
- **Non-markdown context** — Sheets/Docs/Slides are first-class *content* but
  not *context*; context files are markdown only.

## 13. Migrating v0.15 → v0.16

Tooling migrates a workspace through one reviewable plan (the reference app's
"Migrate to v0.16" proposal, or `npm run migrate -- --root <folder>`). Nothing
is deleted: every file the plan overwrites is first copied to
`<archive>/_protocol-v0.15/<path>`, and retired protocol files are moved there.

1. Merge `_Workspace.yaml` into the `AGENTS.md` header (owner, mounts, ignore,
   rule overrides minus removed rules, house rules); take `about` from the root
   overview's "What it is"; re-render the body.
2. Turn each context group into a facet entity (`attributes.facet: pillar` for
   pillar groups; plain groups are flagged for a human to classify) and add its
   slug to each member scope's `facets:`. Members that are content folders are
   listed for a human.
3. Rename the journal and templates mounts to `_Journal/` and `_Templates/`;
   keep the 4 templates and archive the rest.
4. Archive `_Workspace.yaml`, the root `_Overview.md`, `_Index.md`,
   `_Model.json`, `_Digest.md` and every `_Context/` directory.
5. Relationships: map each edge, drafting `as` from the old predicate and note —
   `leads` → `member-of` (as: lead); `works-on` → `member-of`;
   `previously-member-of` → `member-of` + `until`; `owns` → `member-of` (scope)
   or `related-to` (as: owner); `uses` / `provides` / `depends-on` /
   `reports-to` → `related-to`; `deployed-for` is dropped when the inverse
   `uses` edge exists. `concept` entities that are clearly organizations
   (an `industry` attribute, people who are members of them, or a client /
   partner / vendor role) become `organization`.
6. Rewrite inbound markdown links to moved paths. Journal files keep their
   depth, so their outbound links are unchanged.
7. Journal the migration. Agents whose prompts hard-code old paths (journal,
   root overview, index, model, `_Workspace.yaml`, `_Context/`) must be
   updated; open "Needs review" items in old journal files are carried into
   proposals by the next dreaming run rather than rewritten.

During migration, tooling reads both layouts: a v0.15 workspace audits with an
ST-001 "migrate" finding and can be viewed, but its config is only editable
after migrating.
